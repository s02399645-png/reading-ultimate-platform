# Marginalia — private IELTS Academic Reading practice

- `web/` — static front end (vanilla JS, no build step). Open it with any static server for **offline mode** (data stays in the browser).
- `worker/` — Cloudflare Worker API, D1 schema, private passage JSON (`worker/passages/`).
- `scripts/` — passage validator/bundler and site builder.
- `DEPLOY.md` — Cloudflare deployment steps, security checklist, privacy notes.

Quick look (no accounts): `cd web && python3 -m http.server 8000` → http://localhost:8000
Full stack locally: see section 8 of `DEPLOY.md`.
