"""Build a single-page copy of the app for the Claude artifact preview.

The preview serves one HTML page plus files next to it, so this inlines styles.css,
sample/seed.js and app.js (with calendar.js) into dist/index.html and copies the sample photos.

    python3 tools/build_preview.py [outdir]    # default: dist
"""
import os, re, shutil, sys

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(APP, "dist")


def read(name):
    with open(os.path.join(APP, name), encoding="utf-8") as f:
        return f.read()


body = re.search(r"<body>(.*)</body>", read("index.html"), re.S).group(1)
body = body.replace('  <script src="sw-register.js" defer></script>\n', "")  # no offline cache in the preview
body = body.replace('<script src="sample/seed.js"></script>', "<script>\n" + read("sample/seed.js") + "\n</script>")
# app.js imports calendar.js; inline it in place of the import, as plain declarations.
app = re.sub(r'^import \{[^}]*\} from "\./calendar\.js";$', lambda m: re.sub(r"^export ", "", read("calendar.js"), flags=re.M), read("app.js"), count=1, flags=re.M)
body = body.replace('<script type="module" src="app.js"></script>', '<script type="module">\n' + app.replace("</script", "<\\/script") + "\n</script>")
page = f"<title>Smart Wardrobe</title>\n<style>\n{read('styles.css')}\n</style>\n{body}"

os.makedirs(os.path.join(OUT, "sample", "cut"), exist_ok=True)
with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
    f.write(page)
for sub, ext in (("sample", ".jpg"), ("sample/cut", ".webp")):
    for name in os.listdir(os.path.join(APP, sub)):
        if name.endswith(ext):
            shutil.copy(os.path.join(APP, sub, name), os.path.join(OUT, sub, name))
print(f"{len(page):,} bytes -> {os.path.join(OUT, 'index.html')}")
