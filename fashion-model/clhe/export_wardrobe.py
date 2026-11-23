"""Export the wardrobe from a Smart Wardrobe backup for the CLHE experiment (see README.md here).

    python clhe/export_wardrobe.py <backup.json> <out folder>

Writes <out>/items.json (id, name, type, colours, styles, fit, stars, and a one-line description for
the text features) and <out>/img/<id>.<ext> (each piece's first cut-out photo), plus <out>/worn.json:
the outfits you actually wore or rated 4-5 stars (piece ids), the yardstick a learnt "goes together"
model must beat the fashion bible on. Pure standard library; nothing is sent anywhere. The folder
holds your photos: keep it out of the repository (it's in .gitignore as clhe-out/).
"""
import base64
import json
import sys
from pathlib import Path

EXT = {b"RIFF": "webp", b"\x89PNG": "png", b"\xff\xd8\xff": "jpg"}


def _list(v):
    if isinstance(v, list):
        return v
    try:  # some backups store lists as their Python text ("['red', 'black']")
        return json.loads(str(v).replace("'", '"'))
    except ValueError:
        return []


def _photo(data_url):
    raw = base64.b64decode(data_url.split(",", 1)[1])
    ext = next((e for magic, e in EXT.items() if raw.startswith(magic)), "bin")
    return raw, ext


def main(backup, out):
    b = json.loads(Path(backup).read_text(encoding="utf-8"))
    out = Path(out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    items = []
    for i in b.get("items", []):
        if i.get("category") in ("underwear", "socks") or i.get("fate") in ("donate", "sell", "gone"):
            continue
        photos = _list(i.get("photos"))
        entry = {
            "id": i["id"], "name": i.get("name", ""), "type": i.get("category", ""), "colours": _list(i.get("colors")),
            "styles": _list(i.get("styles")), "fit": i.get("fit") or "", "brand": i.get("brand") or "",
            "stars": int(i["rating"]) if str(i.get("rating", "")).isdigit() else (5 if str(i.get("favorite")) == "True" else None),
        }
        entry["text"] = " ".join(filter(None, [*entry["colours"], entry["fit"], *entry["styles"], entry["brand"], entry["name"], entry["type"]]))
        if photos and str(photos[0]).startswith("data:"):
            raw, ext = _photo(photos[0])
            (out / "img" / f"{i['id']}.{ext}").write_bytes(raw)
            entry["image"] = f"img/{i['id']}.{ext}"
        items.append(entry)
    known = {e["id"] for e in items}
    worn = [{"date": l.get("date"), "kind": l.get("kind") or "wear", "items": [x for x in l.get("itemIds", []) if x in known]}
            for l in b.get("log", [])
            if (l.get("kind") in (None, "wear") or (l.get("kind") in ("rate", "like") and int(l.get("stars") or 5) >= 4))]
    worn = [w for w in worn if len(w["items"]) >= 2]
    (out / "items.json").write_text(json.dumps(items, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "worn.json").write_text(json.dumps(worn, indent=1), encoding="utf-8")
    print(f"{len(items)} pieces ({sum('image' in e for e in items)} with a photo), {len(worn)} worn or loved outfits -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
