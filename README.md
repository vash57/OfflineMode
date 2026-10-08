# OfflineMode

A fully local, offline "put the phone down" app. It uses the existing Windows Ollama
install (model `gemma4:e2b`) so nothing, ever, touches the internet: no cloud APIs, no
CDNs, no tracking, no database. The whole point is to give you one real, offline activity
and then get out of your way.

## What it does

1. **Chat** — tell it how you feel / who you're with / how much time you have; it suggests
   ONE concrete, free, offline activity in 2–5 sentences, optionally with
   `Activity:` / `Time:` / `Rule:` lines.
2. **Today's Offline Idea** — a hand-written, curated local list (works even if the AI is
   cold or unreachable).
3. **Activity Mode** — pick the suggestion and it gives you a quiet countdown timer.
4. **Go Offline** — a "no screens" count-up timer that keeps running in the tab.
5. **Reflection** — when you're back, two optional questions; answers are saved in the
   browser's `localStorage` only.

## Requirements

- WSL2 (Ubuntu) with **Python 3.11+** (standard library only — no pip installs).
- Windows **Ollama** v0.40.1 with model `gemma4:e2b` (the only model used).
- Windows Firewall must allow TCP/11434 from the WSL vEthernet adapter (see below).

## How to run

```bash
cd /mnt/d/OfflineMode
python3 server.py
# open http://127.0.0.1:8080
```

The default config points at the Ollama on the Windows host and auto-detects the WSL
gateway IP. You can override via `.env` (copy `.env.example`) or environment variables:

| Variable            | Default meaning                                            |
|---------------------|------------------------------------------------------------|
| `OLLAMA_BASE_URL`   | `http://<auto-detected WSL gateway>:11434`                 |
| `OLLAMA_MODEL`      | `gemma4:e2b`                                               |
| `APP_HOST` / `APP_PORT` | `127.0.0.1` / `8080` (loopback only)                   |

## Ollama setup (one-time)

1. Make the Windows Ollama server reachable from WSL:
   - Set user env `OLLAMA_HOST=http://0.0.0.0:11434` and restart Ollama,
     **or** start it with `$env:OLLAMA_HOST = "http://0.0.0.0:11434"` each time.
   - Add a Firewall rule: Inbound TCP/11434, restricted to the
     `vEthernet (WSL (Hyper-V firewall))` interface. Disable the broad
     "ollama.exe" allow rules added by the installer (they're too open).
2. Verify:
   ```bash
   ip route | awk '/default/{print $3}'   # WSL gateway, e.g. 172.22.224.1
   curl http://<gateway>:11434/api/version
   ```
   Note: the gateway IP can change after a WSL/PC restart — the app auto-detects it.

## Architecture

Browser → `http://127.0.0.1:8080` → `server.py` (stdlib HTTP) → Ollama at `:11434`.
The browser never talks to Ollama directly. `server.py` converts Ollama's NDJSON stream
into a clean `{"delta"} / {"finished"} / {"error"}` stream, so nothing about Ollama leaks
to the page. Reflections live in `localStorage`; there is no server-side state.

## Known limitations

- **Speed depends on the PC.** On this 7.2 GB machine (CPU-only, memory-compressed)
  the first cold reply takes ~1–2 min (model load + CPU eval), a warm reply ~10–30 s.
  Free up RAM (close browser tabs) for best results; don't run many large apps at once.
- The reply is capped (~120 tokens) on purpose to keep it short and fast.
- `gemma4:e2b` is a thinking-capable multimodal model (~4.6 GB); its vision projector is
  loaded too, which uses memory, but it responds in text as configured here.

## Files

```
server.py            stdlib HTTP server + /api/chat streaming proxy + /api/health
static/index.html    all five views
static/style.css     warm, minimal, responsive styling
static/app.js        view logic, curated offline ideas, streaming chat, timers, reflections
.env / .env.example  config (gitignored)
```

## Tests

```bash
python3 -m py_compile server.py
node --check static/app.js
curl -s http://127.0.0.1:8080/api/health     # {"ok":true,...}
curl -sN -X POST http://127.0.0.1:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"I am bored and my parents are at home."}]}'
```