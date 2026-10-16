"""Getting the text of a source: a YouTube video's transcript, a web article, or a file.

Only the extracted rules are kept afterwards (see learn.py), never the full text.
"""
import json
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

MAX_CHARS = 60_000  # about 15k tokens: a long video or article, kept cheap for Gemini
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
YT_ID = re.compile(r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/))([\w-]{11})")


def youtube_id(s):
    m = YT_ID.search(s)
    return m.group(1) if m else None


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en,it;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        charset = r.headers.get_content_charset() or "utf-8"
        return r.read().decode(charset, errors="replace")


def fetch(source):
    """source: a YouTube link, a web link, or a path to a .txt/.md/.html file.
    Returns {kind, url, title, author, text}."""
    path = Path(source)
    if not source.startswith(("http://", "https://")) and path.exists():
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() in (".html", ".htm"):
            title, text = article_text(raw)
        else:
            title, text = path.stem.replace("-", " ").replace("_", " "), raw
        return {"kind": "file", "url": str(path), "title": title, "author": "", "text": text[:MAX_CHARS]}
    vid = youtube_id(source)
    if vid:
        return youtube(vid)
    if source.startswith(("http://", "https://")):
        title, text = article_text(get(source))
        if len(text) < 500:
            raise RuntimeError("Found almost no text on that page (it may be behind a paywall or built with scripts). "
                               "Save the article as a .txt file and learn from the file instead.")
        return {"kind": "article", "url": source, "title": title, "author": urllib.parse.urlparse(source).netloc, "text": text[:MAX_CHARS]}
    raise FileNotFoundError(f"Not a link or an existing file: {source}")


def youtube(vid):
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        raise RuntimeError("To learn from videos, install the transcript reader once: pip install youtube-transcript-api")
    api = YouTubeTranscriptApi()
    try:
        parts = api.fetch(vid, languages=["en", "en-US", "en-GB", "it"])
    except Exception:
        # No English or Italian captions: take whatever language there is (Gemini reads it anyway).
        transcripts = list(api.list(vid))
        if not transcripts:
            raise RuntimeError(f"Video {vid} has no captions to read.")
        parts = transcripts[0].fetch()
    text = " ".join(p.text for p in parts).replace("\n", " ")
    url = f"https://www.youtube.com/watch?v={vid}"
    title, author = vid, ""
    try:  # title and channel, from YouTube's public oEmbed (no key needed)
        meta = json.loads(get(f"https://www.youtube.com/oembed?format=json&url={urllib.parse.quote(url)}", timeout=10))
        title, author = meta.get("title", vid), meta.get("author_name", "")
    except Exception:
        pass
    return {"kind": "video", "url": url, "title": title, "author": author, "text": text[:MAX_CHARS]}


class _Text(HTMLParser):
    """Collects headings, paragraphs and list items; skips scripts, menus and footers."""
    KEEP = {"p", "h1", "h2", "h3", "h4", "li", "blockquote"}
    SKIP = {"script", "style", "nav", "footer", "header", "aside", "form", "noscript", "svg", "button"}

    def __init__(self):
        super().__init__()
        self.blocks, self.cur, self.depth_skip, self.depth_keep = [], [], 0, 0
        self.in_article, self.article_blocks = 0, []
        self.title, self.in_title, self.og_title = "", False, ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("property") == "og:title":
            self.og_title = a.get("content", "")
        if tag == "title":
            self.in_title = True
        if tag == "article":
            self.in_article += 1
        if tag in self.SKIP:
            self.depth_skip += 1
        elif tag in self.KEEP:
            self.depth_keep += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "article":
            self.in_article = max(0, self.in_article - 1)
        if tag in self.SKIP:
            self.depth_skip = max(0, self.depth_skip - 1)
        elif tag in self.KEEP and self.depth_keep:
            self.depth_keep -= 1
            if not self.depth_keep:
                block = " ".join("".join(self.cur).split())
                if len(block) > 30:
                    self.blocks.append(block)
                    if self.in_article:
                        self.article_blocks.append(block)
                self.cur = []

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.depth_keep and not self.depth_skip:
            self.cur.append(data)


def article_text(html):
    p = _Text()
    p.feed(html)
    blocks = p.article_blocks if sum(map(len, p.article_blocks)) > 1000 else p.blocks
    title = (p.og_title or p.title).strip()
    return title, "\n".join(blocks)
