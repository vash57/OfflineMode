#!/usr/bin/env python3
"""
OfflineMode - local web server.

Python standard library only (no third-party dependencies).

What it does:
  * serves the static frontend (static/index.html, app.js, style.css)
  * proxies POST /api/chat to a local Ollama instance, converting
    Ollama's NDJSON stream into a clean, browser-consumable NDJSON stream
    so the browser never talks to Ollama directly.
  * exposes GET /api/health for a quick connectivity check.

The app binds to 127.0.0.1 only and is never exposed to the network.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
ENV_FILE = os.path.join(BASE_DIR, ".env")


SYSTEM_PROMPT = (
    "You are OfflineMode, a kind AI whose only goal is to help the user put the phone down "
    "and do one real, offline activity.\n"
    "Be brief, warm and human: 2-5 sentences, ONE concrete activity, free or nearly free, "
    "no internet. Vary it: nature, time outside, family, friends, creativity, handmade "
    "things, elders, helping someone, simple daily life; do not always suggest walking.\n"
    "Adapt to their situation: who they are with, how much time, where they are, how they feel.\n"
    "Never assume culture, festival, religion, family structure or traditions. Only if the "
    "user mentions one, suggest taking part respectfully.\n"
    "Never shame technology use; never say technology is bad. Do not act like a therapist; "
    "if someone sounds distressed, gently suggest talking to a trusted person.\n"
    "Never encourage long chats with yourself; give them a reason to go do the activity. "
    "Optionally add one line about a phone rule (no photos, no tutorials, no posting).\n"
    "When you suggest a concrete activity you may end with up to 3 optional lines:\n"
    "  Activity: <name>\n"
    "  Time: <e.g. 20 minutes>\n"
    "  Rule: <optional>\n"
    "Otherwise respond naturally.\n"
)


def read_env_file(path):
    """Read a small .env file into a dict (no dependency needed)."""
    values = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def detect_wsl_gateway():
    """Best-effort default Ollama URL using the WSL default gateway."""
    try:
        out = subprocess.check_output(["ip", "route"], text=True, timeout=5)
        for line in out.splitlines():
            parts = line.split()
            if len(parts) > 1 and parts[0] == "default":
                dev = parts.index("dev")
                return "http://{}:11434".format(parts[dev - 1])
    except Exception:
        pass
    return None


_env = read_env_file(ENV_FILE)


def _config(name, default):
    return (os.environ.get(name) or _env.get(name) or default).strip()


OLLAMA_BASE_URL = _config(
    "OLLAMA_BASE_URL", detect_wsl_gateway() or "http://localhost:11434"
).rstrip("/")
OLLAMA_MODEL = _config("OLLAMA_MODEL", "gemma4:e2b")
APP_HOST = _config("APP_HOST", "127.0.0.1")
APP_PORT = int(_config("APP_PORT", "8080"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # ---- routing ----
    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            self._health()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] == "/api/chat":
            self._chat()
            return
        self.send_error(404)

    # ---- GET /api/health ----
    def _health(self):
        status = "unknown"
        version = ""
        try:
            req = urllib.request.Request(OLLAMA_BASE_URL + "/api/version", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                info = json.loads(resp.read().decode("utf-8", "replace"))
                version = info.get("version", "")
                status = "ok"
        except Exception as exc:  # report reachability issues without crashing
            status = "unreachable: {}".format(exc)
        body = json.dumps(
            {
                "ok": status == "ok",
                "ollama": status,
                "ollama_version": version,
                "model": OLLAMA_MODEL,
                "base_url": OLLAMA_BASE_URL,
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- POST /api/chat ----
    def _chat(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8", "replace") or "{}")
            messages = data.get("messages")
            if not isinstance(messages, list):
                raise ValueError("messages must be a list")
        except Exception as exc:
            self._json_error(400, "Invalid request: {}".format(exc))
            return

        for message in messages:
            message.setdefault("role", "user")

        payload = {
            "model": OLLAMA_MODEL,
            "stream": True,
            "think": False,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT}
            ] + messages,
            "options": {"temperature": 0.7, "num_predict": 120},
        }

        req = urllib.request.Request(
            OLLAMA_BASE_URL + "/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        # Open the stream first so connectivity problems get a proper HTTP
        # status instead of a mid-stream error.
        try:
            ollama_resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            self._json_error(
                502, "Ollama returned HTTP {}: {}".format(exc.code, detail)
            )
            return
        except urllib.error.URLError as exc:
            self._json_error(
                502,
                "Could not reach Ollama at {} ({}). Is the Ollama server running?".format(
                    OLLAMA_BASE_URL, getattr(exc, "reason", exc)
                ),
            )
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        try:
            seen_done = False
            done_content = ""
            sent_chars = 0
            for raw_line in ollama_resp:
                line = raw_line.strip().decode("utf-8", "replace")
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                msg = obj.get("message") or {}
                if obj.get("done"):
                    # On some models (e.g. ones with a "thinking" phase) the
                    # streamed chunks have empty content and the final "done"
                    # chunk carries the whole answer. Keep it so nothing is lost.
                    seen_done = True
                    done_content = msg.get("content") or ""
                    break
                delta = msg.get("content") or ""
                if delta:
                    sent_chars += len(delta)
                    self._stream_line({"delta": delta, "finished": False})
            if seen_done and done_content and not sent_chars:
                self._stream_line({"delta": done_content, "finished": False})
            self._stream_line({"finished": True})
        except Exception as exc:
            self._stream_line({"error": "Stream failed: {}".format(exc)})
        finally:
            self.wfile.flush()

    # ---- helpers ----
    def _stream_line(self, obj):
        self.wfile.write((json.dumps(obj) + "\n").encode("utf-8"))
        self.wfile.flush()

    def _json_error(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    try:
        server = ThreadingHTTPServer((APP_HOST, APP_PORT), Handler)
    except OSError as exc:
        sys.exit("Could not bind {}:{} - {}".format(APP_HOST, APP_PORT, exc))
    server.daemon_threads = True
    print("OfflineMode running at http://{}:{}".format(APP_HOST, APP_PORT))
    print("Ollama endpoint: {}  (model: {})".format(OLLAMA_BASE_URL, OLLAMA_MODEL))
    print(
        "Open it in your browser: http://localhost:{} (from Windows) "
        "or http://127.0.0.1:{} (inside WSL).".format(APP_PORT, APP_PORT)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()