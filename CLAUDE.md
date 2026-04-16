# grind75

Self-hosted LeetCode-style interview-prep tool for the Grind75 curated problem list. See `PLAN.md` for the full implementation plan.

## Stack

- **API**: Rust/Axum + Postgres + JWT Bearer auth (single user, env-driven creds).
- **Web**: SvelteKit + Monaco editor + Pyodide (Python in browser via Web Worker).
- **Content**: `problems/<slug>/{problem.md, starter.py, tests.py, meta.json}` at repo root.
- **Python tooling**: `uv` + `ruff` + `ty` (host-side, Astral Rust tools).

## Quickstart (dev)

```
cp .env.example .env
# Fill in JWT_SECRET (openssl rand -hex 32) and ADMIN_PASSWORD_HASH
# (cargo run -p api --bin hash-password -- 'dev')
docker compose up -d db
cd api && cargo run
# new shell:
cd web && npm install && npm run dev
```

Open http://localhost:5173 → login → dashboard.
