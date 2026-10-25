"""Serve Smart Wardrobe and keep one shared wardrobe for every device on the network.

    python3 server.py [--port 8000] [--data data] [--cert cert.pem --key key.pem]

It serves the app like `python3 -m http.server` and adds a small sync API. Each
device keeps its own copy in IndexedDB (so it still works offline) and swaps
changes with this server; a piece added on the phone shows up on the tablet and
the computer within a second or two.

    GET  /api/ping                      {"ok": true, "rev": n}
    GET  /api/changes?since=r&wait=s    records changed after rev r; waits up to s
                                        seconds for a change (long polling)
    POST /api/records                   {"records": [{col, id, updatedAt, deleted, data}]}
                                        the newest updatedAt wins
    HEAD/GET/PUT /api/blob/<key>        photos, stored once by content hash

Everything is stored in the data folder (db.json plus blobs/). Nothing leaves this
computer, and API keys are never synced.
"""
import argparse, json, os, re, socket, ssl, threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP = os.path.dirname(os.path.abspath(__file__))
COLS = {"items", "log", "kv", "wants", "scents", "events"}
BLOB_KEY = re.compile(r"^[0-9a-z-]{4,80}\.(jpg|webp|png|bin)$")
BLOB_TYPE = {"jpg": "image/jpeg", "webp": "image/webp", "png": "image/png", "bin": "application/octet-stream"}
MAX_BLOB = 25 * 1024 * 1024


class Store:
    def __init__(self, folder):
        self.folder = folder
        self.blobs = os.path.join(folder, "blobs")
        self.path = os.path.join(folder, "db.json")
        os.makedirs(self.blobs, exist_ok=True)
        self.rev, self.records = 0, {}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                saved = json.load(f)
            self.rev, self.records = saved["rev"], saved["records"]
        self.changed = threading.Condition()

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"rev": self.rev, "records": self.records}, f)
        os.replace(tmp, self.path)

    def since(self, rev):
        return [r for r in self.records.values() if r["rev"] > rev]

    def wait(self, rev, seconds):
        with self.changed:
            self.changed.wait_for(lambda: self.rev > rev, timeout=seconds)
            return self.rev, self.since(rev)

    def missing_blobs(self, data):
        if isinstance(data, dict):
            if isinstance(data.get("$blob"), str):
                key = data["$blob"]
                return [] if BLOB_KEY.match(key) and os.path.exists(os.path.join(self.blobs, key)) else [key]
            data = list(data.values())
        return [k for v in data for k in self.missing_blobs(v)] if isinstance(data, list) else []

    def put(self, incoming):
        accepted, missing = [], []
        with self.changed:
            for r in incoming:
                if r.get("col") not in COLS or not isinstance(r.get("id"), str) or not isinstance(r.get("updatedAt"), str):
                    continue
                lacking = self.missing_blobs(r.get("data"))
                if lacking:  # the device thinks it uploaded these photos; it sends them again
                    missing += lacking
                    continue
                key = f'{r["col"]}/{r["id"]}'
                old = self.records.get(key)
                if old and old["updatedAt"] > r["updatedAt"]:
                    continue  # someone changed it more recently
                self.rev += 1
                self.records[key] = {
                    "col": r["col"], "id": r["id"], "rev": self.rev, "updatedAt": r["updatedAt"],
                    "deleted": bool(r.get("deleted")), "data": r.get("data"),
                }
                accepted.append(key)
            if accepted:
                self.save()
                self.changed.notify_all()
            return self.rev, accepted, missing


class Handler(SimpleHTTPRequestHandler):
    store: Store = None
    # Don't rely on the Windows registry for these: a wrong .js type stops the app loading.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webp": "image/webp",
                      ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP, **kwargs)

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/changes"):
            super().log_message(fmt, *args)

    def end_headers(self):
        if not self.path.startswith("/api/blob/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def blob_path(self):
        key = urlparse(self.path).path[len("/api/blob/"):]
        return (key, os.path.join(self.store.blobs, key)) if BLOB_KEY.match(key) else (None, None)

    def send_blob(self, head):
        key, path = self.blob_path()
        if not path or not os.path.exists(path):
            return self.send_error(HTTPStatus.NOT_FOUND)
        size = os.path.getsize(path)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", BLOB_TYPE[key.rsplit(".", 1)[1]])
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        if not head:
            with open(path, "rb") as f:
                self.wfile.write(f.read())

    def do_HEAD(self):
        if self.path.startswith("/api/blob/"):
            return self.send_blob(head=True)
        return super().do_HEAD()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/ping":
            return self.send_json({"ok": True, "rev": self.store.rev})
        if url.path == "/api/changes":
            q = parse_qs(url.query)
            since = int(q.get("since", ["0"])[0])
            wait = min(30.0, float(q.get("wait", ["0"])[0]))
            rev, records = self.store.wait(since, wait) if wait > 0 else (self.store.rev, self.store.since(since))
            return self.send_json({"rev": rev, "records": records})
        if url.path.startswith("/api/blob/"):
            return self.send_blob(head=False)
        if url.path.startswith("/api/") or url.path.startswith("/data/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("too large")
        return self.rfile.read(n)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/records", "/api/missing"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        try:
            body = json.loads(self.read_body(MAX_BLOB))
            if path == "/api/missing":  # which of these photos does the server still need?
                keys = [k for k in body["keys"] if BLOB_KEY.match(k)]
                return self.send_json({"missing": [k for k in keys if not os.path.exists(os.path.join(self.store.blobs, k))]})
            records = body["records"]
        except (ValueError, KeyError, TypeError):
            return self.send_error(HTTPStatus.BAD_REQUEST)
        rev, accepted, missing = self.store.put(records)
        self.send_json({"rev": rev, "accepted": accepted, "missing": missing})

    def do_PUT(self):
        key, path = self.blob_path() if self.path.startswith("/api/blob/") else (None, None)
        if not path:
            return self.send_error(HTTPStatus.NOT_FOUND)
        try:
            body = self.read_body(MAX_BLOB)
        except ValueError:
            return self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        if not os.path.exists(path):
            tmp = f"{path}.{threading.get_ident()}.tmp"
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, path)
        self.send_json({"ok": True, "key": key})


class DualStackServer(ThreadingHTTPServer):
    # Listen on IPv6 and IPv4 at once. Browsers on Windows try "localhost" over IPv6
    # first, and an IPv4-only server makes every request wait for that to fail.
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


def lan_addresses():
    found = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the LAN interface
            found.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in found if not a.startswith(("127.", "169.254.")))


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--data", default=os.path.join(APP, "data"), help="folder for the shared wardrobe (default: ./data)")
    p.add_argument("--cert", help="certificate file, to serve over https (needed for the camera on other devices)")
    p.add_argument("--key", help="private key file for --cert")
    a = p.parse_args()

    Handler.store = Store(os.path.abspath(a.data))
    server = DualStackServer(("::", a.port), Handler)
    server.daemon_threads = True
    scheme = "http"
    if a.cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert, a.key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        scheme = "https"

    print(f"Smart Wardrobe on {scheme}://localhost:{a.port}")
    for ip in lan_addresses():
        print(f"  other devices on this Wi-Fi: {scheme}://{ip}:{a.port}")
    print(f"Shared wardrobe: {Handler.store.folder} ({len(Handler.store.records)} records)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
