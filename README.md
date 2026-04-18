# grind75

[![CI](https://github.com/cnpryer/grind75/actions/workflows/ci.yml/badge.svg)](https://github.com/cnpryer/grind75/actions/workflows/ci.yml)

Self-hosted, LeetCode-style interview-prep tool for the [Grind75](https://www.techinterviewhandbook.org/grind75) curated problem list. Renders each problem as a runnable Python exercise, with tests executing entirely in the browser via Pyodide — no server-side sandbox.

Built because third-party prep sites can disappear or degrade, and the intended workflow is to *lap* the easys: deep familiarity with patterns, efficient implementations, and testing idioms.

## Stack

- **API** — Rust / Axum 0.8 / Postgres 16 / JWT Bearer auth (single-user MVP, env-driven creds). OpenAPI served at `/api/docs/`.
- **Web** — SvelteKit 2 / Svelte 5 / Monaco / Pyodide in a Web Worker. adapter-node.
- **Content** — `problems/<slug>/{problem.md, starter.py, tests.py, meta.json}` at repo root. Pytest-style tests.
- **Python tooling** — `uv` + `ruff` + `ty` host-side (Astral). In-browser pytest via `pyodide.loadPackage('pytest')`.

See [PLAN.md](./PLAN.md) for architecture, milestones, and design decisions.

## Quickstart

```sh
# 1. Generate secrets
cp .env.example .env
# Fill JWT_SECRET:
openssl rand -hex 32
# Fill ADMIN_PASSWORD_HASH (note: single-quote the value in .env to protect the `$` chars):
cargo run -p api --bin hash-password -- 'dev'

# 2. Start Postgres (Docker Compose, or any local Postgres with a matching DATABASE_URL)
docker compose up -d db

# 3. Run the API — migrations apply automatically on boot
cargo run -p api

# 4. In a second shell, run the web dev server
cd web && bun install && bun run dev
```

Open <http://localhost:5173> → sign in with `ADMIN_USERNAME` + the password you hashed → dashboard.

## Layout

```
grind75/
├── api/                Rust/Axum + sqlx + utoipa. Single `api` binary + `hash-password` helper.
│   ├── migrations/     sqlx migrations (problems_progress, attempts, refresh_tokens)
│   ├── src/            auth (jwt/password/middleware), routes, dto, error, app
│   └── tests/          integration tests against a real Postgres via sqlx::test
├── web/                SvelteKit app. adapter-node, Biome, Tailwind.
│   ├── src/lib/api/    ApiClient, typed errors, JWT decode, cookie helpers
│   ├── src/routes/     /login, /, /api/auth/logout, /api/health (proxy)
│   └── src/hooks.server.ts  cookie auth + transparent refresh
├── problems/           Curated problem set (populated in M5)
├── docker-compose.yml  db + api + web with healthchecks
├── ecosystem.config.cjs pm2 config for single-host deploy
└── PLAN.md             Full implementation plan
```

## Auth model (MVP)

Single admin user, credentials in env. Login returns a JWT access token (15 min) + refresh token (30 days). Refresh rotates the token and revokes the previous one; replay of a revoked refresh triggers a chain revocation (theft signal — OAuth2 BCP). Tokens ride in `HttpOnly; Secure; SameSite=Strict` cookies; the browser never talks to the Rust API directly. See [PLAN.md § Auth hardening](./PLAN.md) for the full threat model and migration path to multi-user.

## Development

```sh
# API — fmt, lint, test
cargo fmt --manifest-path api/Cargo.toml
cargo clippy -p api --all-targets -- -D warnings
cargo test -p api                         # requires DATABASE_URL set

# Web — lint, typecheck, unit test, build
cd web
bun run check                             # biome + svelte-check
bun run test                              # vitest
bun run build

# Problems — canonical-solution smoke test
uv sync
uv run pytest problems/                   # every slug's tests against its solution.py
uv run ruff check problems/
```

Each `problems/<slug>/` ships `starter.py` (what the user sees in the editor),
`solution.py` (the canonical reference — host-only, not copied into the web
bundle), and `tests.py`. `problems/conftest.py` + `--import-mode=importlib`
in `pyproject.toml` isolate the repeated `solution` module name across slugs
when pytest walks the whole `problems/` tree in a single session.

To sanity-check that a starter still raises cleanly against its tests
(without hand-editing), temporarily copy `starter.py` over `solution.py` and
rerun `uv run pytest problems/<slug>/`. Every test should fail with
`NotImplementedError`.

CI (see `.github/workflows/ci.yml`) runs all of the above on every push to `main` and every pull request.

### Regenerating TypeScript types from the API

The Rust API is the source of truth for DTO shapes via `utoipa`. TypeScript types are generated from the served OpenAPI spec — explicit, not automatic (avoids needing a live API for every web build):

```sh
# with the API running locally on :3001
cd web && bun run api:types
```

Commits `web/src/lib/api/generated.ts` and `web/src/lib/api/openapi.json` alongside the code change. See [PLAN.md § Type synchronization via OpenAPI](./PLAN.md).

## Status

See [PLAN.md § Milestones](./PLAN.md#milestones) for the initial roadmap.
