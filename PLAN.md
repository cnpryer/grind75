# grind75 Implementation Plan

## Context

A self-hosted, LeetCode-style interview-prep tool that renders the Grind75 curated problem list as runnable Python exercises, starting with the 13 easys. Built because third-party sites (LeetCode, techinterviewhandbook.org) can disappear or degrade, and the user's prep workflow is to "lap" the easys — build deep familiarity with patterns, efficient implementations, and testing idioms. The stack mirrors `/Users/chrispryer/github/pryerdisposal.com/` (Rust/Axum + Postgres + SvelteKit) so architecture and ops feel identical. Python executes entirely in the browser via Pyodide in a Web Worker — no server-side sandbox. Progress, notes, and attempts persist in Postgres through a small REST API guarded by a **JWT Bearer auth flow** mirroring pryerdisposal (login → access + refresh tokens → httpOnly cookies → server hooks auto-refresh). Single-user for MVP: one hardcoded `ADMIN_USERNAME` + argon2 `ADMIN_PASSWORD_HASH` in env. Multi-user (registration, multi-account) is a drop-in upgrade later.

## Decisions locked with the user

- **Python runtime**: Pyodide in browser, in a Web Worker. Timeouts enforced by `worker.terminate()` from the main thread, then respawn.
- **Backend**: Full stack mirror — Rust/Axum + Postgres.
- **Auth (MVP)**: Full JWT Bearer flow, mirroring pryerdisposal verbatim. Single user — `ADMIN_USERNAME` + argon2 `ADMIN_PASSWORD_HASH` in env. `jwt.rs`/`password.rs` copied **and mounted**. Login page, access + refresh tokens in httpOnly cookies, auto-refresh in `hooks.server.ts`. Upgrade to multi-user later = drop hardcoded creds, add a `users` table, restore register/reset routes.
- **Problem format**: `problems/<slug>/{problem.md, starter.py, tests.py, meta.json}` at the repo root. Pytest-style tests.
- **Editor**: Monaco, lazy-loaded, ESM with Vite `?worker` imports for the editor worker.
- **First milestone**: All 13 Grind75 easys authored end-to-end.

## Top-level layout

```
grind75/
├── Cargo.toml                  workspace { members = ["api"] }
├── docker-compose.yml          db + api + web with healthchecks
├── ecosystem.config.cjs        pm2 for api + web
├── .env.example                JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, ACCESS_TOKEN_TTL_SECS, REFRESH_TOKEN_TTL_SECS, DATABASE_URL, API_URL, ORIGIN
├── README.md / CLAUDE.md / docs/architecture.md
├── scripts/
│   └── generate-problems-manifest.ts   walks problems/, validates meta, emits manifest, copies md/py into web/static/problems/
├── problems/                   content root (13 folders for M5)
│   └── <slug>/{problem.md, starter.py, tests.py, meta.json}
├── api/                        adapted from pryerdisposal.com/api
│   ├── Cargo.toml              drop stripe/lettre/validator; keep axum, sqlx, argon2, jsonwebtoken, utoipa
│   ├── migrations/
│   │   ├── 20260416000001_create_problems_progress.sql
│   │   ├── 20260416000002_create_attempts.sql
│   │   └── 20260416000003_create_refresh_tokens.sql
│   └── src/
│       ├── main.rs / lib.rs / app.rs / config.rs / db.rs / error.rs
│       ├── auth/{mod.rs, middleware.rs (AuthUser JWT extractor), jwt.rs (issue/verify access + refresh), password.rs (argon2)}   mounted
│       ├── dto/{auth.rs, progress.rs, attempt.rs}
│       ├── models/{progress.rs, attempt.rs}
│       └── routes/{health.rs, auth.rs (login/refresh/me), problems.rs, progress.rs, attempts.rs}
└── web/                        adapted from pryerdisposal.com/web
    ├── package.json            add monaco-editor, marked, dompurify; drop stripe/leaflet
    ├── vite.config.ts          chunks: pyodide, monaco-editor, vendor-svelte; optimizeDeps.exclude: ['pyodide']
    ├── svelte.config.js        adapter-node only
    ├── biome.json / tsconfig.json / tailwind.config.js   copy; simplify brand palette
    ├── static/problems/<slug>/  populated by the build script
    └── src/
        ├── hooks.server.ts     reads access_token/refresh_token cookies, auto-refreshes on expiry, populates locals.user + locals.accessToken (mirrors pryerdisposal)
        ├── lib/
        │   ├── api/{client.ts, errors.ts}   mirror pryerdisposal, Authorization: Bearer <jwt> header
        │   ├── problems/{loader.ts, manifest.ts, types.ts, generated-manifest.json}
        │   ├── pyodide/{worker.ts, runner.ts, protocol.ts, pytest-harness.py}
        │   ├── monaco/{editor.ts, MonacoEditor.svelte}
        │   ├── components/{ProblemCard, DifficultyChip, PatternGroup, TestResults, OutputPane, MarkdownView}.svelte
        │   └── utils/{time.ts, markdown.ts}
        └── routes/
            ├── +layout.{svelte,ts}
            ├── +page.{svelte,server.ts}               dashboard (auth-guarded)
            ├── login/+page.{svelte,server.ts}          login form → server action posts to /api/auth/login, sets httpOnly cookies
            ├── problem/[slug]/+page.{svelte,server.ts}
            ├── settings/+page.svelte                   user info, logout, reset progress
            └── api/{auth/login,auth/logout,health,progress/[slug],attempts}/+server.ts   same-origin proxies
```

**Dropped from pryerdisposal**: Stripe, Leaflet, lettre/SMTP, Google OAuth, Google Analytics, holidays, closed-beta, announcements, admin/providers/orders/quotes/billing/users, register/reset flows. **Login flow is kept and mounted** (single-user, env-driven creds).

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

`uv`, `ruff`, and `ty` (Astral's type checker) are native Rust binaries — none run inside Pyodide. So: **host-side via uv** (authoring, CI, dep locking, lint, typecheck) and **browser-side via `pyodide.loadPackage('pytest')`** pulling from the self-hosted Pyodide distribution (no `micropip`, no PyPI at runtime). Keep the host-side `pytest` pin in `pyproject.toml` in step with `pyodide-lock.json`.

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

All routes except `/login` require auth — `hooks.server.ts` redirects unauthenticated requests to `/login?redirect=<original>`.

- `/login` — username + password form. Server action POSTs to `/api/auth/login`, which forwards to the Rust API; on success the server sets httpOnly `access_token` + `refresh_token` cookies and redirects to `?redirect` (default `/`).
- `/` — dashboard. `+page.server.ts` merges the static manifest with `ApiClient.getProgress()`. Groups cards by pattern. Header strip shows "N of 13 solved" + logged-in username.
- `/problem/[slug]` — editor view. Loads meta + files + per-slug progress. Layout: markdown left, tabbed pane right (Code / Tests readonly / Output). Buttons: Run (no persist), Submit (persists attempt + status), Save draft, Reset to starter. Notes textarea below editor with debounced (500ms) autosave.
- `/settings` — logged-in user info, API base URL, access-token expiry, counts; export attempts as JSON; reset progress; logout.
- `/api/auth/{login,logout}`, `/api/health`, `/api/progress/[slug]`, `/api/attempts` — SvelteKit `+server.ts` endpoints that proxy to the Rust API using `locals.accessToken` (auto-refreshed in hooks.server.ts). The browser only ever talks same-origin.

## Rust API

Base `/api`. Auth via `AuthUser` extractor that validates `Authorization: Bearer <jwt>` against `JWT_SECRET`. `GET /api/health` and `POST /api/auth/login` + `POST /api/auth/refresh` are unauthenticated. `GET /api/problems` is unauthenticated (problem content is not secret).

```
GET    /api/health
POST   /api/auth/login                    {username, password}       -> {access_token, refresh_token, user}
POST   /api/auth/refresh                  {refresh_token}            -> {access_token, refresh_token}
GET    /api/auth/me                       (auth)                     -> {username}
GET    /api/problems                      (optional: reads problems/ at startup, caches)
GET    /api/progress                      (auth)
GET    /api/progress/:slug                (auth)
PUT    /api/progress/:slug                (auth) upsert {status?, last_code?, notes?}
POST   /api/attempts                      (auth) {slug, code, passed, duration_ms, pytest_summary}
GET    /api/attempts?slug=&limit=         (auth)
DELETE /api/progress                      (auth) reset all
```

`POST /api/attempts` transactionally inserts into `attempts` AND upserts `problems_progress` (increment `attempt_count`, stamp `solved_at` on first transition to `solved`) so one round-trip records both.

### Config

`Config` drops stripe/google/smtp/closed_beta. Adds (all required, no defaults in prod):
- `jwt_secret: String` — HMAC signing key for access + refresh tokens.
- `admin_username: String` — the single permitted username.
- `admin_password_hash: String` — argon2 hash; generate via a one-off `cargo run --bin hash-password -- 'mypassword'` helper copied from pryerdisposal (or reused if present).
- `access_token_ttl_secs: u64` — default 900 (15 min).
- `refresh_token_ttl_secs: u64` — default 2592000 (30 days).

### Middleware

Copy `AuthUser` extractor from pryerdisposal. It pulls the `Authorization: Bearer <jwt>` header, verifies the signature + expiry against `JWT_SECRET`, and exposes `user.username` to handlers. Unauthenticated routes are registered on a separate router branch that doesn't apply the extractor.

### Login flow

`POST /api/auth/login` loads `admin_username` / `admin_password_hash` from config, constant-time-compares the submitted username, verifies the submitted password against the argon2 hash, then issues a signed access + refresh JWT pair (both carry a random UUIDv4 `jti`). `POST /api/auth/refresh` validates the submitted refresh token's signature + expiry + revocation status, rotates it (see below), and issues a new access + refresh pair.

### Auth hardening

**Token TTLs & secret rotation**
- Access token: **15 min** (`ACCESS_TOKEN_TTL_SECS=900`). Short enough that leaked access tokens expire before they're useful; long enough that `hooks.server.ts` isn't refreshing on every request.
- Refresh token: **30 days** (`REFRESH_TOKEN_TTL_SECS=2592000`). Refreshed (rotated) on every use, so actual per-token lifetime is typically the session idle time.
- `JWT_SECRET` rotation = restart → all tokens invalid → single forced re-login. Acceptable for a personal tool. If zero-downtime rotation ever matters, support `JWT_SECRET_PREVIOUS` as a read-only validation key for a grace window (copy the pattern from the usual JWT key-rotation recipe; not needed now).

**Refresh token rotation + replay protection**
- Every refresh token has a `jti` (UUIDv4) claim embedded at issue time.
- `refresh_tokens` table stores `(jti PK, username, issued_at, expires_at, revoked_at, replaced_by, user_agent, ip)`.
- On refresh: JWT sig/expiry valid AND row exists AND `revoked_at IS NULL` → mark old row `revoked_at=NOW()`, insert new row with `replaced_by` pointing back, return new pair.
- On refresh with an already-revoked token → **theft signal**: revoke the entire chain (walk `replaced_by` forward, set all `revoked_at`), force re-login. Log at `WARN` with `jti`, IP, user-agent. Both the attacker and the legitimate user get kicked out — this is by design and matches OAuth2 BCP.
- On `POST /api/auth/logout`: revoke the current refresh token's `jti`, clear cookies. Access tokens ride out their <=15min expiry (acceptable).
- Expired rows are cleaned lazily (refresh handler deletes rows where `expires_at < NOW() - '7 days'::interval`) — no cron needed.

**Error responses**
Typed error codes (not free-text), so the web can branch reliably:
```json
{ "error": "token_expired",     "message": "..." }   // 401, access token past expiry
{ "error": "token_invalid",     "message": "..." }   // 401, signature/format bad
{ "error": "token_missing",     "message": "..." }   // 401, no Authorization header
{ "error": "refresh_expired",   "message": "..." }   // 401, refresh past expiry
{ "error": "refresh_revoked",   "message": "..." }   // 401, refresh already used/revoked (theft-signal variant logged separately)
{ "error": "credentials_invalid","message": "Invalid username or password" }  // 401 on /login — same text for bad username vs bad password to avoid user enumeration
{ "error": "rate_limited",      "message": "..." }   // 429 on /login after too many attempts
```
`hooks.server.ts` maps `token_expired` → attempt refresh; `refresh_expired` / `refresh_revoked` / `refresh_invalid` → clear cookies, redirect to `/login`.

**Logging & rate limiting**
- Log all auth events via `tracing` at structured levels: `INFO` for successful login/refresh/logout; `WARN` for failed login, expired/invalid tokens, refresh rotation of revoked token; `ERROR` for theft signals.
- Include `username` (attempted), source IP, user-agent, `jti` where relevant. **Never** log passwords, JWT strings, or cookie contents.
- Rate-limit `POST /api/auth/login` with `tower-governor` (or equivalent): **5 attempts / minute / IP**, respond with `429 Retry-After`. Per-instance in-memory counter is fine for our single-replica deploy.

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

`api/migrations/20260416000003_create_refresh_tokens.sql`
```sql
CREATE TABLE refresh_tokens (
  jti          UUID PRIMARY KEY,
  username     TEXT NOT NULL,           -- single-user MVP; replace with user_id FK on multi-user migration
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID REFERENCES refresh_tokens(jti),
  user_agent   TEXT,
  ip           INET
);
CREATE INDEX idx_refresh_tokens_active ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_username ON refresh_tokens(username);
```

## Web ↔ API client

Mirror `/Users/chrispryer/github/pryerdisposal.com/web/src/lib/api/client.ts` verbatim — same `Authorization: Bearer <accessToken>` header, same error-class hierarchy, same constructor shape.

**Token + cookie handling** (mirrors pryerdisposal exactly):
- `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` are server-only (no `PUBLIC_` prefix). Read via `$env/dynamic/private` on the Rust API side; web side never sees them.
- On successful `POST /api/auth/login` (proxied through `web/src/routes/api/auth/login/+server.ts`), the server sets **httpOnly, Secure, SameSite=Strict, Path=/** cookies `access_token` and `refresh_token` with `Max-Age` matching their TTLs. `SameSite=Strict` (stricter than pryerdisposal's Lax) is appropriate because grind75 has no cross-site integration surface — the cost is that links from email/external sites land logged-out, which is fine for a bookmarked personal tool. `Secure` is set in all environments; browsers accept it over `http://localhost` for dev.
- `hooks.server.ts` runs on every request: reads the two cookies, validates `access_token` locally (decode + expiry check only, no API round-trip), and if expired calls `POST /api/auth/refresh` with the refresh token to rotate. Populates `event.locals.user` and `event.locals.accessToken` for downstream `load` / server actions.
- `ApiClient` is constructed only in `+*.server.ts` / `+server.ts` files with `locals.accessToken`.
- Browser never sees tokens (httpOnly cookies) and never calls the Rust API directly. All mutations go through same-origin `/api/*/+server.ts` endpoints that forward with the Bearer header.
- Logout (`POST /api/auth/logout`) clears both cookies **and** calls the Rust API to revoke the current refresh token's `jti` (sets `revoked_at=NOW()` on its row). Access tokens ride out their ≤15min expiry — acceptable given the TTL floor.

## Type synchronization via OpenAPI

The Rust API is the single source of truth for request/response shapes. `utoipa` annotations on DTOs + route handlers produce an OpenAPI 3 spec, which is served at `/api/docs/openapi.json` (SwaggerUi mounted in `app.rs`). The web side consumes generated TypeScript types from that spec so `ApiClient` signatures and `+*.server.ts` load functions can't drift from the backend.

**Pipeline (all web-side — no api crate changes needed)**:
- `openapi-typescript` (web devDependency) reads the spec and emits `web/src/lib/api/generated.ts`.
- Regeneration is manual: `npm run api:types`, which does `openapi-typescript "$API_URL/api/docs/openapi.json" -o src/lib/api/generated.ts`. Run it after adding/changing a route handler or DTO.
- **Not** wired into `predev`/`prebuild`: that would force the API to be running for every web build (including CI and offline type-checks). Explicit regeneration is the lesser evil for a repo with a small, stable API surface.
- Alongside the generated TS, a snapshot `web/src/lib/api/openapi.json` is committed so diffs show API shape changes explicitly in PR review. Both files are committed (not gitignored): IDE autocomplete works without cargo, and `svelte-check` / `tsc` run without a live API.

**Usage in `ApiClient`**: types are imported from `./generated`, e.g.
```ts
import type { components } from './generated'
type LoginRequest = components['schemas']['LoginRequest']
type AuthResponse  = components['schemas']['AuthResponse']
```
Error payloads reuse `ErrorBody` (typed-code + message) from the Rust side via `components['schemas']['ErrorBody']` — matches `AuthErrorCode` enum on the server.

**Interim (until generated types exist)**: a small number of DTOs (login/refresh/logout/me) are hand-typed in `lib/api/errors.ts` and `lib/api/client.ts` for M0. When M4 adds progress + attempts endpoints, switch those over to the generated types and backport the auth types too.

**When to wire this in**: scheduled for late in M0 or as the first piece of M4, whichever comes first — i.e., before the second wave of DTOs land. Hand-typing the 4 auth endpoints is quicker than standing up the pipeline if it's only those 4; the pipeline pays off starting at ~6–8 endpoints.

## Tooling config

Copy as-is: `web/biome.json`, `web/tsconfig.json`, `web/postcss.config.js`, `web/.browserslistrc`, `web/.npmrc`, `web/.dockerignore`, `api/.cargo/`, `api/rust-toolchain.toml`, `api/Dockerfile`, `api/.dockerignore`.

Adapt:
- `web/package.json`: remove `@stripe/stripe-js`, `stripe`, `leaflet`, `@types/leaflet`, `adapter-static`. Add `monaco-editor`, `marked`, `dompurify`.
- `web/tailwind.config.js`: strip red brand palette; defaults.
- `web/vite.config.ts`: `manualChunks` → `pyodide`, `monaco-editor`, `vendor-svelte`, `vendor`; `optimizeDeps.exclude: ['pyodide']`.
- `web/svelte.config.js`: adapter-node only; drop BUILD_PREVIEW branch.
- `api/Cargo.toml`: drop `async-stripe`, `lettre`, heavy validators. Keep axum, sqlx, argon2, jsonwebtoken, utoipa, utoipa-swagger-ui, tower, tower-http, chrono, uuid, serde, dotenvy, tracing, thiserror.
- Root: `Cargo.toml` workspace, `docker-compose.yml` (db `grind75_dev`, strip Stripe; add `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ACCESS_TOKEN_TTL_SECS`, `REFRESH_TOKEN_TTL_SECS`), `ecosystem.config.cjs` (two apps).

## Milestones

**M0 — Scaffolding + auth.** Layout above exists with stub handlers. `docker compose up` boots db + api + web; `/api/health` returns 200; `/` redirects to `/login`; a valid login → cookies set → `/` renders (placeholder). Migrations apply. `POST /api/auth/login` + `/refresh` + `AuthUser` extractor all mounted and exercised by an integration test. `npm run check` + `cargo check` green.

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
- `web/src/routes/login/+page.{svelte,server.ts}`
- `web/src/routes/problem/[slug]/+page.{svelte,server.ts}`
- `web/src/routes/settings/+page.svelte`
- `web/src/routes/api/{auth/login,auth/logout,progress/[slug],attempts,health}/+server.ts`

**Reuse from pryerdisposal (adapt, don't rewrite)**
- `web/src/lib/api/client.ts` — pattern from `/Users/chrispryer/github/pryerdisposal.com/web/src/lib/api/client.ts` (Bearer header)
- `web/src/lib/api/errors.ts`
- `web/src/hooks.server.ts` — full auth/refresh flow from pryerdisposal's, kept intact
- `api/src/{main.rs, lib.rs, db.rs, error.rs, config.rs}` — from pryerdisposal's `api/src/*`
- `api/src/auth/{mod.rs, middleware.rs, jwt.rs, password.rs}` — **mounted**, including `AuthUser` extractor
- `api/src/routes/{health.rs, auth.rs}` — login/refresh/me handlers from pryerdisposal, trimmed to single-user env-backed creds

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
- `api/migrations/20260416000003_create_refresh_tokens.sql`

## Risks

- **Monaco bundle (~1MB gz)**: mitigated by chunk-splitting and `browser`-guarded dynamic import. Fallback: swap to CodeMirror 6 (~200KB) if problematic.
- **Pyodide cold start (~6s)**: defer to first Run click; dashboard remains instant. No preload in MVP.
- **pytest in Pyodide**: write per-run to a fresh tmp dir; pin `pytest` version; no `conftest.py` for authored problems.
- **Worker terminate cost**: respawn = another ~6s after a timeout. Surface in the output pane.
- **Auth secrets**: `JWT_SECRET`, `ADMIN_PASSWORD_HASH`, and raw JWT strings never logged, never in `PUBLIC_` env. Rotating `JWT_SECRET` invalidates all outstanding tokens (intentional kill-switch). Rotating the admin password = regenerate the argon2 hash, update env, restart api. A stolen access token is usable for ≤15 min; a stolen refresh token is rotation-single-use — the first reuse kills the entire chain (see Auth hardening).
- **Refresh token chain cleanup**: the `refresh_tokens` table grows linearly with session activity. The lazy cleanup in the refresh handler (delete rows where `expires_at < NOW() - '7 days'`) keeps it bounded in normal operation, but a pathological login-loop could still accrete rows between runs of that path. If the table ever gets large, add a scheduled `DELETE` job — not needed at MVP scale (one user, a few sessions/week).
- **Rate limiting is per-instance**: `tower-governor` state lives in memory. A single replica is our target deploy, so this is fine. If we ever horizontally scale, move to a shared store (Redis) or accept per-replica limits as a loose upper bound.
- **Content hot-reload**: editing `problems/<slug>/*` during `npm run dev` needs manifest re-run; add a chokidar watcher in the script or accept a restart.
- **Pyodide release = Python version + package lockfile**: bumping Pyodide changes the Python version and every bundled package (including pytest) in lockstep. Treat upgrades as a ritual — re-stage the bundle, re-sync the host-side pytest pin in `pyproject.toml` to match `pyodide-lock.json`, re-run CI, verify test output shape hasn't drifted in ways the worker's pytest harness cares about.
- **Packages Pyodide doesn't bundle**: if we ever add a dep that isn't in Pyodide's lockfile, the provisioning story changes — pure-Python deps can `micropip.install` from PyPI (stage locally for offline), but C-extension deps **must** come from Pyodide's registry (PyPI wheels target host OS, not Emscripten). Not an MVP concern since pytest is bundled.

## Multi-user migration outline (future)

When we outgrow single-user, the MVP upgrades cleanly — no schema rewrite, just additions:

1. **`users` table** — `id UUID PK, username UNIQUE, email UNIQUE, password_hash, created_at, last_login_at`. Backfill the MVP admin as row 1.
2. **JWT claims** — add `sub = user_id` (UUID) alongside `username`. `AuthUser` extractor switches to resolving by `sub`; `username` becomes a display-only claim.
3. **FK migrations** — `problems_progress.slug` becomes `(user_id, slug)` composite PK; `attempts` gains `user_id NOT NULL`; `refresh_tokens.username TEXT` becomes `user_id UUID REFERENCES users(id) ON DELETE CASCADE`. Migration backfills everything to admin row 1, then adds the constraints.
4. **Config** — drop `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`. Keep `JWT_SECRET`, TTLs.
5. **Restore routes from pryerdisposal**: `POST /api/auth/register`, `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`. Password reset re-introduces the SMTP dependency (re-add `lettre` + `SMTP_*` env). Registration gates behind an invite code or email verification — details TBD.
6. **Web** — `/login` gains a "Register" link; add `/register`, `/forgot-password`, `/reset-password/[token]` routes. Dashboard header shows the logged-in user's name instead of a hardcoded admin badge.
7. **Rate limiting** — per-user (not just per-IP) lockout on repeated login failures.

Scope to keep in mind now: the `refresh_tokens` schema already uses `username TEXT` so the migration to `user_id UUID` is a single `ALTER TABLE` + backfill. The JWT library and cookie flow carry over verbatim.

## Verification (end-to-end)

1. `cp .env.example .env`. Generate a dev `JWT_SECRET` (`openssl rand -hex 32`) and an argon2 hash of your password (`cargo run --bin hash-password -- 'dev'`), set `ADMIN_USERNAME=me` + `ADMIN_PASSWORD_HASH=<hash>`; propagate to `api/.env` and `web/.env`.
2. `docker compose up -d db`; wait for `pg_isready`.
3. `cd api && cargo run` — migrations apply, listens on `:3001`.
4. `curl -i localhost:3001/api/health` → 200.
5. `curl -i localhost:3001/api/progress` → 401 (no bearer). `curl -H "Authorization: Bearer garbage" localhost:3001/api/progress` → 401.
6. `curl -X POST -H 'content-type: application/json' -d '{"username":"me","password":"wrong"}' localhost:3001/api/auth/login` → 401. With `"password":"dev"` → 200 with `{access_token, refresh_token, user}`.
7. `curl -H "Authorization: Bearer $ACCESS" localhost:3001/api/progress` → `[]`.
8. `cd web && npm install && npm run check && npm test` — Biome, svelte-check, Vitest green. Vitest covers protocol types, manifest loader, and auth hooks.
9. `npm run dev`, open `http://localhost:5173/` — redirects to `/login`. Submit creds → redirects to `/` with 13 cards, all "not started".
10. Click **Two Sum**. First Run shows "Loading Python…" (~6s), then all tests fail on unmodified starter.
11. Paste a correct hashmap solution; Run → all pass; Submit → card flips to "solved".
12. Full reload — still logged in (cookies), code/notes/status/attempt_count persist.
13. Let access token expire (or edit its TTL down for the test); next request triggers transparent refresh in `hooks.server.ts` — user never sees a re-login. In DB: old `refresh_tokens.jti` has `revoked_at` set and `replaced_by` pointing at the new row.
14. **Refresh replay / theft-signal**: capture `refresh_token` cookie after login, trigger a refresh so it rotates, then replay the now-revoked token directly against `POST /api/auth/refresh` → 401 with `{"error":"refresh_revoked"}`; the active successor chain is also revoked, and the legitimate browser session is forced to re-login on its next `hooks.server.ts` cycle. A `WARN`-level log line with `jti`, IP, and user-agent is emitted.
15. **Logout revocation**: click Logout in `/settings` → cookies cleared → `refresh_tokens` row for that `jti` has `revoked_at` set → attempting to reuse the captured refresh token returns 401 `refresh_revoked`.
16. **Login rate limit**: 6 rapid bad-password POSTs to `/api/auth/login` from the same IP → the 6th responds `429 rate_limited` with a `Retry-After` header.
17. `while True: pass` → timeout message within 10s; next Run of a correct solution still works (respawn).
18. `docker compose down && docker compose up -d --build`; open `http://localhost:3000/` (adapter-node); login → Two Sum still "solved" (Postgres volume).
19. Optional content smoke: `uv run pytest problems/` walks every slug, starters fail cleanly, canonical solutions pass.
