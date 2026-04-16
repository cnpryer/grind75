# grind75 Implementation Plan

## Context

A self-hosted, LeetCode-style interview-prep tool that renders the Grind75 curated problem list as runnable Python exercises, starting with the 13 easys. Built because third-party sites (LeetCode, techinterviewhandbook.org) can disappear or degrade, and the user's prep workflow is to "lap" the easys — build deep familiarity with patterns, efficient implementations, and testing idioms. The stack mirrors `/Users/chrispryer/github/pryerdisposal.com/` (Rust/Axum + Postgres + SvelteKit) so architecture and ops feel identical. Python executes entirely in the browser via Pyodide in a Web Worker — no server-side sandbox. Progress, notes, and attempts persist in Postgres through a small REST API guarded by a single `X-API-Key` header; real multi-user auth is scaffolded but unmounted.

## Decisions locked with the user

- **Python runtime**: Pyodide in browser, in a Web Worker. Timeouts enforced by `worker.terminate()` from the main thread, then respawn.
- **Backend**: Full stack mirror — Rust/Axum + Postgres.
- **Auth (MVP)**: Single-user `X-API-Key` via env; copy `jwt.rs`/`password.rs` from pryerdisposal unmounted, for future multi-user.
- **Problem format**: `problems/<slug>/{problem.md, starter.py, tests.py, meta.json}` at the repo root. Pytest-style tests.
- **Editor**: Monaco, lazy-loaded, ESM with Vite `?worker` imports for the editor worker.
- **First milestone**: All 13 Grind75 easys authored end-to-end.

## Top-level layout

```
grind75/
├── Cargo.toml                  workspace { members = ["api"] }
├── docker-compose.yml          db + api + web with healthchecks
├── ecosystem.config.cjs        pm2 for api + web
├── .env.example                GRIND75_API_KEY, DATABASE_URL, API_URL, ORIGIN
├── README.md / CLAUDE.md / docs/architecture.md
├── scripts/
│   └── generate-problems-manifest.ts   walks problems/, validates meta, emits manifest, copies md/py into web/static/problems/
├── problems/                   content root (13 folders for M5)
│   └── <slug>/{problem.md, starter.py, tests.py, meta.json}
├── api/                        adapted from pryerdisposal.com/api
│   ├── Cargo.toml              drop stripe/lettre/validator; keep axum, sqlx, argon2, jsonwebtoken, utoipa
│   ├── migrations/
│   │   ├── 20260416000001_create_problems_progress.sql
│   │   └── 20260416000002_create_attempts.sql
│   └── src/
│       ├── main.rs / lib.rs / app.rs / config.rs / db.rs / error.rs
│       ├── auth/{mod.rs, middleware.rs (ApiKey extractor), jwt.rs, password.rs}   jwt/password copied but unmounted
│       ├── dto/{progress.rs, attempt.rs}
│       ├── models/{progress.rs, attempt.rs}
│       └── routes/{health.rs, problems.rs, progress.rs, attempts.rs}
└── web/                        adapted from pryerdisposal.com/web
    ├── package.json            add monaco-editor, marked, dompurify; drop stripe/leaflet
    ├── vite.config.ts          chunks: pyodide, monaco-editor, vendor-svelte; optimizeDeps.exclude: ['pyodide']
    ├── svelte.config.js        adapter-node only
    ├── biome.json / tsconfig.json / tailwind.config.js   copy; simplify brand palette
    ├── static/problems/<slug>/  populated by the build script
    └── src/
        ├── hooks.server.ts     loads GRIND75_API_KEY from $env/dynamic/private into locals
        ├── lib/
        │   ├── api/{client.ts, errors.ts}   mirror pryerdisposal, X-API-Key header
        │   ├── problems/{loader.ts, manifest.ts, types.ts, generated-manifest.json}
        │   ├── pyodide/{worker.ts, runner.ts, protocol.ts, pytest-harness.py}
        │   ├── monaco/{editor.ts, MonacoEditor.svelte}
        │   ├── components/{ProblemCard, DifficultyChip, PatternGroup, TestResults, OutputPane, MarkdownView}.svelte
        │   └── utils/{time.ts, markdown.ts}
        └── routes/
            ├── +layout.{svelte,ts}
            ├── +page.{svelte,server.ts}               dashboard
            ├── problem/[slug]/+page.{svelte,server.ts}
            ├── settings/+page.svelte
            └── api/{health,progress/[slug],attempts}/+server.ts   same-origin proxies for the browser
```

**Dropped from pryerdisposal**: Stripe, Leaflet, lettre/SMTP, Google OAuth, Google Analytics, holidays, closed-beta, announcements, admin/providers/orders/quotes/billing/users, register/login/reset flows (scaffolded, unmounted).

## Problem data flow

Recommended: **build-time manifest + static asset serving** (rejected alternatives: cross-root `import.meta.glob`, API-served problems).

- `scripts/generate-problems-manifest.ts` is wired as `predev` and `prebuild` in `web/package.json`.
- It walks `../problems/*/`, validates each `meta.json` (hand-rolled check, no zod dep), copies `problem.md`/`starter.py`/`tests.py` into `web/static/problems/<slug>/`, and emits `web/src/lib/problems/generated-manifest.json`.
- `lib/problems/loader.ts` imports the JSON manifest; `+page.server.ts` uses `event.fetch('/problems/<slug>/...')` to load source files on demand.

## `meta.json` schema

```json
{
  "schema_version": 1,
  "id": 1,
  "slug": "two-sum",
  "title": "Two Sum",
  "difficulty": "easy",
  "pattern": "hashmap",
  "leetcode_url": "https://leetcode.com/problems/two-sum/",
  "recommended_minutes": 15,
  "execution_timeout_seconds": 10,
  "tags": ["array", "hashmap"],
  "order": 1,
  "entry_function": "two_sum"
}
```

`pattern` ∈ `array | hashmap | two-pointer | stack | linked-list | tree | binary-search | graph | sliding-window`.

## Pyodide worker

- **Self-host Pyodide** at `web/static/pyodide/` — version-pinned bundle, staged at build time from the `pyodide/pyodide` GitHub release by `scripts/stage-pyodide.mjs`. No CDN at runtime: deterministic, offline-capable after first app load, same-origin cache-friendly. Pinning the Pyodide release pins Python **and** every bundled package (including pytest) via `pyodide-lock.json`.
- Main thread never imports Pyodide. `runner.ts` spawns the worker lazily on the first Run click, not on page load. Show a one-time "Loading Python…" indicator (~6s cold start).
- **Worker init**: `await pyodide.loadPackage('pytest')` — pytest is part of Pyodide's bundled package set, so provisioning is a single call against the same-origin Pyodide distribution. No PyPI at runtime. No wheel staging. No `micropip`. Persists across runs in the same problem session.
- Per run: write `solution.py` and `test_problem.py` to `/home/pyodide/`, run `pytest.main([...])` under a custom collector plugin (`pytest-harness.py`) that hooks `pytest_runtest_logreport` to collect `{name, outcome, durationMs, failureMessage(≤2KB), stdout}` per test. Return structured JSON.

### Message protocol (`lib/pyodide/protocol.ts`)

```ts
type WorkerRequest =
  | { type: 'init';  requestId: string }
  | { type: 'run';   requestId: string; code: string; tests: string; entryFunction: string }
  | { type: 'reset'; requestId: string }

type WorkerResponse =
  | { type: 'init:progress'; requestId: string; phase: 'loading-pyodide'|'installing-pytest'; message: string }
  | { type: 'init:ready';    requestId: string }
  | { type: 'run:result';    requestId: string; summary: PytestSummary; stdout: string; stderr: string; durationMs: number }
  | { type: 'error';         requestId: string; message: string; stack?: string }

type PytestSummary = {
  passed: number; failed: number; errored: number; total: number
  tests: Array<{ name: string; outcome: 'passed'|'failed'|'error'|'skipped'; durationMs: number; failureMessage?: string; stdout?: string }>
}
```

`runner.run()` is a Promise with an internal `Map<requestId, {resolve, reject, timer}>`. On timeout: `worker.terminate()`, reject with `TimeoutError`, reset the worker instance so the next run respawns.

## Python tooling: uv, ruff, ty

`uv`, `ruff`, and `ty` (Astral's type checker) are native Rust binaries — none run inside Pyodide. Pyodide uses `micropip` for its own WASM-wheel installs. So: **host-side via uv** (authoring, CI, dep locking, lint, typecheck) and **browser-side via micropip** (pytest execution), with a pinned requirements file keeping them in sync.

### uv (host-side)

Repo-level Python toolchain for authoring and CI. Files:
- `pyproject.toml` at repo root — declares `requires-python`, `[dependency-groups] dev = ["pytest", "ruff", "ty"]`, `[tool.ruff]`, `[tool.ty]`. Pin `pytest` to the version Pyodide bundles (check `pyodide-lock.json` in the staged Pyodide distribution) so `uv run pytest` matches browser behavior.
- `uv.lock` — committed.

Author / CI workflow:
- `uv sync` → dev env with pytest + ruff + ty.
- `uv run pytest problems/<slug>/tests.py` → verify a problem's tests run against a solution on the host (no browser, no Pyodide) — the fastest authoring loop.
- `uv run ruff check problems/` / `uv run ruff format problems/` → lint/format authored Python.
- `uv run ty check problems/` → type-check starters, solutions, and tests. Catches signature drift between `entry_function` in `meta.json` and the actual `starter.py`/`tests.py` before the browser ever sees it.
- CI: `uv sync --locked && uv run pytest && uv run ruff check && uv run ty check`.

### Browser-side pytest

No `micropip.install` at runtime. Pytest comes from Pyodide's own bundled package set via `pyodide.loadPackage('pytest')` against the self-hosted `/pyodide/` distribution. The Pyodide release **is** our lockfile — pinning the Pyodide version pins the pytest version too. Keep the host-side pytest pin in `pyproject.toml` in step with what `pyodide-lock.json` ships (check on every Pyodide bump) so `uv run pytest` and browser pytest behave identically.

### ruff & ty in the browser (future, post-MVP)

For in-editor lint/format (and eventually type-check), use Astral's WASM bindings — **independent of Pyodide**.

- **ruff**: `@astral-sh/ruff-wasm-web` (confirm exact package name at implementation time; Astral ships web/node variants). ~3MB WASM; exposes `Workspace.check()` / `Workspace.format()`. Integration:
  - `web/src/lib/ruff/linter.ts` — lazy-imported, runs in its own Web Worker.
  - Monaco: map violations → `monaco.editor.MarkerData[]` via `setModelMarkers`; format-on-save bound to Cmd/Ctrl-S.
  - Config: `[tool.ruff]` in `pyproject.toml`, read at build time and injected into the Ruff Workspace constructor — single source of truth with host-side `uv run ruff`.
- **ty**: track Astral's ty-wasm release (ty is newer than ruff; a browser-targetable build may land after MVP). When available, mirror the ruff wiring: dedicated worker, Monaco markers for type diagnostics, config from `[tool.ty]`. Until then, type-checking stays host-only via `uv run ty`.

Scoped to **M6 (optional)**, not M1–M5.

## Monaco integration

- Install `monaco-editor` only. No wrapper lib.
- `lib/monaco/editor.ts` ESM-imports the editor API and registers workers via Vite `?worker`:
  ```ts
  import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
  ```
- Import only `monaco-editor/esm/vs/basic-languages/python/python.contribution` for Python syntax.
- `MonacoEditor.svelte` (Svelte 5 runes): `$effect` to mount/dispose, `$props()` for `value/onChange/readOnly/height`.
- SSR guard: all Monaco imports behind `{#if browser}` / dynamic `import()`.
- Chunk-split `monaco-editor` and `pyodide` via `vite.config.ts manualChunks` so the dashboard doesn't download them.
- Known gotchas: Tailwind `preflight` vs Monaco CSS (in practice fine in Tailwind 3); must never evaluate on the server; readonly Tests tab is a second Monaco instance.

## Routes

- `/` — dashboard. `+page.server.ts` merges the static manifest with `ApiClient.getProgress()`. Groups cards by pattern. Header strip shows "N of 13 solved".
- `/problem/[slug]` — editor view. Loads meta + files + per-slug progress. Layout: markdown left, tabbed pane right (Code / Tests readonly / Output). Buttons: Run (no persist), Submit (persists attempt + status), Save draft, Reset to starter. Notes textarea below editor with debounced (500ms) autosave.
- `/settings` — API base URL, API-key fingerprint, counts; export attempts as JSON; reset progress.
- `/api/health`, `/api/progress/[slug]`, `/api/attempts` — SvelteKit `+server.ts` endpoints that proxy to the Rust API using `locals.apiKey`. The browser only ever talks same-origin.

## Rust API

Base `/api`. Auth via `X-API-Key` middleware (constant-time compare). `GET /api/health` and `GET /api/problems` are unauthenticated.

```
GET    /api/health
GET    /api/problems                      (optional: reads problems/ at startup, caches)
GET    /api/progress
GET    /api/progress/:slug
PUT    /api/progress/:slug                upsert {status?, last_code?, notes?}
POST   /api/attempts                      {slug, code, passed, duration_ms, pytest_summary}
GET    /api/attempts?slug=&limit=
DELETE /api/progress                      reset all
```

`POST /api/attempts` transactionally inserts into `attempts` AND upserts `problems_progress` (increment `attempt_count`, stamp `solved_at` on first transition to `solved`) so one round-trip records both.

`Config` drops stripe/google/smtp/closed_beta; adds `api_key: String` (required). `auth/middleware.rs`:

```rust
pub struct ApiKey; // marker
impl<S: Send+Sync> FromRequestParts<S> for ApiKey where Config: FromRef<S> {
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let cfg = Config::from_ref(state);
        let header = parts.headers.get("x-api-key").and_then(|v| v.to_str().ok()).ok_or(AppError::Unauthorized)?;
        if constant_time_eq(header.as_bytes(), cfg.api_key.as_bytes()) { Ok(ApiKey) } else { Err(AppError::Unauthorized) }
    }
}
```

## Postgres schema

`api/migrations/20260416000001_create_problems_progress.sql`
```sql
CREATE TYPE progress_status AS ENUM ('not_started', 'attempted', 'solved');
CREATE TABLE problems_progress (
  slug          TEXT PRIMARY KEY,
  status        progress_status NOT NULL DEFAULT 'not_started',
  last_code     TEXT,
  notes         TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  solved_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_problems_progress_status ON problems_progress(status);
```

`api/migrations/20260416000002_create_attempts.sql`
```sql
CREATE TABLE attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL,
  code           TEXT NOT NULL,
  passed         BOOLEAN NOT NULL,
  duration_ms    INTEGER NOT NULL,
  pytest_summary JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attempts_slug_created ON attempts(slug, created_at DESC);
CREATE INDEX idx_attempts_passed ON attempts(passed);
```

## Web ↔ API client

Mirror `/Users/chrispryer/github/pryerdisposal.com/web/src/lib/api/client.ts`: same class shape, swap `Authorization: Bearer` for `X-API-Key`.

**Secret handling** — mirrors pryerdisposal's `event.locals.accessToken` pattern:
- `GRIND75_API_KEY` is server-only (no `PUBLIC_` prefix). Read via `$env/dynamic/private`.
- `hooks.server.ts` stores it in `event.locals.apiKey`.
- `ApiClient` is only constructed in `+*.server.ts` / `+server.ts` files.
- Browser mutations go through same-origin `/api/*/+server.ts` endpoints that forward to the Rust API.

## Tooling config

Copy as-is: `web/biome.json`, `web/tsconfig.json`, `web/postcss.config.js`, `web/.browserslistrc`, `web/.npmrc`, `web/.dockerignore`, `api/.cargo/`, `api/rust-toolchain.toml`, `api/Dockerfile`, `api/.dockerignore`.

Adapt:
- `web/package.json`: remove `@stripe/stripe-js`, `stripe`, `leaflet`, `@types/leaflet`, `adapter-static`. Add `monaco-editor`, `marked`, `dompurify`.
- `web/tailwind.config.js`: strip red brand palette; defaults.
- `web/vite.config.ts`: `manualChunks` → `pyodide`, `monaco-editor`, `vendor-svelte`, `vendor`; `optimizeDeps.exclude: ['pyodide']`.
- `web/svelte.config.js`: adapter-node only; drop BUILD_PREVIEW branch.
- `api/Cargo.toml`: drop `async-stripe`, `lettre`, heavy validators. Keep axum, sqlx, argon2, jsonwebtoken, utoipa, utoipa-swagger-ui, tower, tower-http, chrono, uuid, serde, dotenvy, tracing, thiserror.
- Root: `Cargo.toml` workspace, `docker-compose.yml` (db `grind75_dev`, strip Stripe/JWT vars, add `GRIND75_API_KEY`), `ecosystem.config.cjs` (two apps).

## Milestones

**M0 — Scaffolding.** Layout above exists with stub handlers. `docker compose up` boots db + api + web; `/api/health` returns 200; `/` renders placeholder. Migrations apply. `npm run check` + `cargo check` green.

**M1 — Pyodide worker.** `worker.ts`/`runner.ts`/`protocol.ts`/`pytest-harness.py` in place. Vitest or a throwaway dev page exercises: hardcoded two-sum starter+tests returns a structured `PytestSummary`; `while True: pass` triggers timeout termination and next run still works (respawn).

**M2 — Editor view.** `/problem/two-sum` renders markdown + Monaco (lazy, Python highlighted). Run wired to M1 worker. No persistence yet.

**M3 — Dashboard + navigation.** Manifest script wired to `predev`/`prebuild`. `/` lists all 13 easys grouped by pattern. All slugs navigable (placeholders for non-authored folders are OK at this stage).

**M4 — Persistence.** Migrations + handlers + `ApiClient` wired. Submit on Two Sum persists; reload restores code/notes/status/attempt count. Notes autosave debounced 500ms.

**M5 — Content complete.** All 13 easys authored (`problem.md`, `starter.py`, `tests.py`, `meta.json` ≥5 pytest cases each incl. obvious + edge). Smoke test: `uv run pytest problems/` iterates every slug (starters fail cleanly; canonical solutions pass). README quickstart updated.

**M6 — In-browser lint/format (optional, post-MVP).** Wire `@astral-sh/ruff-wasm-web` in a dedicated Web Worker; surface diagnostics as Monaco markers; format-on-save action. Ruff config sourced from `[tool.ruff]` in `pyproject.toml`. See "Python tooling: uv & ruff".

Slugs: `two-sum, valid-parentheses, merge-two-sorted-lists, best-time-to-buy-and-sell-stock, valid-palindrome, invert-binary-tree, valid-anagram, binary-search, flood-fill, lowest-common-ancestor-of-a-bst, balanced-binary-tree, linked-list-cycle, implement-queue-using-stacks`.

## Critical files

**Pyodide (new, no reference)**
- `web/src/lib/pyodide/worker.ts`
- `web/src/lib/pyodide/runner.ts`
- `web/src/lib/pyodide/protocol.ts`
- `web/src/lib/pyodide/pytest-harness.py`

**Monaco (new)**
- `web/src/lib/monaco/editor.ts`
- `web/src/lib/monaco/MonacoEditor.svelte`

**Problem pipeline (new)**
- `scripts/generate-problems-manifest.ts`
- `web/src/lib/problems/{loader.ts, manifest.ts, types.ts}`

**Routes**
- `web/src/routes/+page.{svelte,server.ts}`
- `web/src/routes/problem/[slug]/+page.{svelte,server.ts}`
- `web/src/routes/api/{progress/[slug],attempts}/+server.ts`

**Reuse from pryerdisposal (adapt, don't rewrite)**
- `web/src/lib/api/client.ts` — pattern from `/Users/chrispryer/github/pryerdisposal.com/web/src/lib/api/client.ts`
- `web/src/lib/api/errors.ts`
- `web/src/hooks.server.ts` — skeleton from pryerdisposal's, strip auth/refresh
- `api/src/{main.rs, lib.rs, db.rs, error.rs, config.rs, auth/*}` — from pryerdisposal's `api/src/*`
- `api/src/routes/health.rs` — copy as-is

**Python tooling (new)**
- `pyproject.toml` (repo root) — `[dependency-groups]`, `[tool.ruff]`, `[tool.ty]`
- `uv.lock` (generated, committed)
- `scripts/stage-pyodide.mjs` — downloads & unpacks the pinned Pyodide release into `web/static/pyodide/` (run at install/build; output is gitignored)
- `web/src/lib/ruff/linter.ts` (M6 only)
- `web/src/lib/ty/checker.ts` (M6 only, if ty-wasm available)

**Infra**
- `Cargo.toml`, `docker-compose.yml`, `ecosystem.config.cjs`, `api/Dockerfile`, `web/Dockerfile`
- `api/migrations/20260416000001_create_problems_progress.sql`
- `api/migrations/20260416000002_create_attempts.sql`

## Risks

- **Monaco bundle (~1MB gz)**: mitigated by chunk-splitting and `browser`-guarded dynamic import. Fallback: swap to CodeMirror 6 (~200KB) if problematic.
- **Pyodide cold start (~6s)**: defer to first Run click; dashboard remains instant. No preload in MVP.
- **pytest in Pyodide**: write per-run to a fresh tmp dir; pin `pytest` version; no `conftest.py` for authored problems.
- **Worker terminate cost**: respawn = another ~6s after a timeout. Surface in the output pane.
- **API key**: single shared secret fine for single-user self-hosted. Never logged, never in `PUBLIC_` env. Rotation requires restarting api + web together.
- **Content hot-reload**: editing `problems/<slug>/*` during `npm run dev` needs manifest re-run; add a chokidar watcher in the script or accept a restart.
- **Pyodide release = Python version + package lockfile**: bumping Pyodide changes the Python version and every bundled package (including pytest) in lockstep. Treat upgrades as a ritual — re-stage the bundle, re-sync the host-side pytest pin in `pyproject.toml` to match `pyodide-lock.json`, re-run CI, verify test output shape hasn't drifted in ways the worker's pytest harness cares about.
- **Packages Pyodide doesn't bundle**: if we ever add a dep that isn't in Pyodide's lockfile, the provisioning story changes — pure-Python deps can `micropip.install` from PyPI (stage locally for offline), but C-extension deps **must** come from Pyodide's registry (PyPI wheels target host OS, not Emscripten). Not an MVP concern since pytest is bundled.

## Verification (end-to-end)

1. `cp .env.example .env`, set `GRIND75_API_KEY=dev-key`; propagate to `api/.env` and `web/.env`.
2. `docker compose up -d db`; wait for `pg_isready`.
3. `cd api && cargo run` — migrations apply, listens on `:3001`.
4. `curl -i localhost:3001/api/health` → 200.
5. `curl -H "X-API-Key: wrong" localhost:3001/api/progress` → 401; with correct key → `[]`.
6. `cd web && npm install && npm run check && npm test` — Biome, svelte-check, Vitest green. Vitest covers protocol types + manifest loader.
7. `npm run dev`, open `http://localhost:5173/` — 13 cards, all "not started".
8. Click **Two Sum**. First Run shows "Loading Python…" (~6s), then all tests fail on unmodified starter.
9. Paste a correct hashmap solution; Run → all pass; Submit → card flips to "solved".
10. Full reload — code, notes, status, attempt_count persist.
11. `while True: pass` → timeout message within 10s; next Run of a correct solution still works (respawn).
12. `docker compose down && docker compose up -d --build`; open `http://localhost:3000/` (adapter-node); Two Sum still "solved" (Postgres volume).
13. Optional content smoke: `node scripts/verify-problems.mjs` walks `problems/*`, runs each starter against each tests.py (fails cleanly), then each canonical solution (all pass).
