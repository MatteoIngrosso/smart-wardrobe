"""A tiny Gemini client (Google AI Studio key), with no packages to install.

The key comes from --key, the GEMINI_KEY environment variable, or a line
GEMINI_KEY=... in fashion-model/.env (that file is never committed).
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "gemini-flash-latest"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def find_key(key=None):
    if key:
        return key
    for name in ("GEMINI_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        if os.environ.get(name):
            return os.environ[name]
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() in ("GEMINI_KEY", "GEMINI_API_KEY") and value.strip():
                return value.strip().strip('"').strip("'")
    raise RuntimeError("No Gemini key. Put GEMINI_KEY=AIza... in fashion-model/.env, or pass --key.")


def generate_json(system, text, schema, key=None, model=DEFAULT_MODEL, max_tokens=8192):
    """One call that must answer with JSON matching `schema`. Returns (data, usage)."""
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": text}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "thinkingConfig": {"thinkingBudget": 0},  # no hidden thinking tokens: extraction doesn't need them
        },
    }
    try:
        j = _post(model, body, find_key(key))
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise RuntimeError(f"Gemini error {e.code}: {_message(e)}")
        # Some models don't accept a thinking budget: retry with the model's default.
        del body["generationConfig"]["thinkingConfig"]
        try:
            j = _post(model, body, find_key(key))
        except urllib.error.HTTPError as e2:
            raise RuntimeError(f"Gemini error {e2.code}: {_message(e2)}")
    parts = (j.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    out = "".join(p.get("text", "") for p in parts).strip()
    if not out:
        raise RuntimeError("Gemini returned no answer. Try again.")
    u = j.get("usageMetadata", {})
    usage = {"in": u.get("promptTokenCount", 0), "out": u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)}
    return json.loads(out), usage


def _post(model, body, key):
    req = urllib.request.Request(
        ENDPOINT.format(model=model), data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def _message(err):
    try:
        return json.loads(err.read()).get("error", {}).get("message", "")
    except Exception:
        return str(err)
