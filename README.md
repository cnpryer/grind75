# grind75

[![CI](https://github.com/cnpryer/grind75/actions/workflows/ci.yml/badge.svg)](https://github.com/cnpryer/grind75/actions/workflows/ci.yml)

An experimental selt-hosted grind75 app focused on tool-enhanced learning and a delightful user experience.

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

Open <http://localhost:5173> and sign in with `ADMIN_USERNAME` + the password you hashed → dashboard.

## Layout

```
├── api/                Rust/Axum + sqlx + utoipa. Single `api` binary + `hash-password` helper.
├── web/                SvelteKit app. adapter-node, Biome, Tailwind.
└── problems/           Curated problem set (populated in M5)
```

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

Each `problems/<slug>/` ships `starter.py`, `solution.py`, and `tests.py`.
