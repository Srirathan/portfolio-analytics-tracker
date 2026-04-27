# Portfolio Analytics Tracker

A small full-stack app for tracking a personal stock portfolio: sign up, add holdings, pull live quotes, see allocation and unrealized P/L, and export CSV. Meant to run locally with SQLite or against PostgreSQL when deployed.

**Prerequisites:** Python 3.10+ with `pip`, Node.js 18+ and npm (for the frontend).

**Repository:** [github.com/Srirathan/portfolio-analytics-tracker](https://github.com/Srirathan/portfolio-analytics-tracker)

## Live deployment

Production URLs (from the repo GitHub **Website** field and the current Vercel production bundle). If you rename services, update this table and your env vars.

| Role | URL |
| --- | --- |
| Frontend (Vercel) | [https://portfolio-analytics-tracker.vercel.app](https://portfolio-analytics-tracker.vercel.app) |
| API base for `VITE_API_BASE_URL` | `https://portfolio-analytics-tracker-api.onrender.com/api/v1` (include `/api/v1`, **no trailing slash**) |
| OpenAPI (Swagger UI) | [https://portfolio-analytics-tracker-api.onrender.com/docs](https://portfolio-analytics-tracker-api.onrender.com/docs) |
| Health | [https://portfolio-analytics-tracker-api.onrender.com/health](https://portfolio-analytics-tracker-api.onrender.com/health) |

**For reviewers:** Register once, add a few tickers (e.g. a large-cap and a deliberate typo), hit **Refresh prices**, and open **Export CSV**. Summary cards intentionally exclude unpriced rows from market value and unrealized P/L so the headline numbers stay honest when quotes fail.

## Screenshots

Capture from the **live** app and commit images under [`docs/screenshots/`](docs/screenshots/). Filenames and framing tips are in [`docs/screenshots/README.md`](docs/screenshots/README.md). After files exist, embed them here with standard Markdown, for example `![Login](docs/screenshots/01-auth-register.png)`.

## Features

Verified in this repo (see routes under `backend/app/api/v1/routes/` and the dashboard in `frontend/src/App.tsx`):

- JWT auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`; passwords hashed with bcrypt
- Holdings: list, add, update quantity/average buy, delete — all scoped to the logged-in user via the JWT
- Dashboard: portfolio summary (totals and position count), symbol filter on the holdings table, inline edit, delete with confirm, add-holding form with client-side validation (quantity and average buy must be greater than zero)
- Duplicate symbol per user is blocked at the API; the UI surfaces that as a clear error
- Allocation pie chart (Recharts) when rows have a computed market value
- Price refresh (`POST /prices/refresh`): Yahoo Finance chart endpoint first, Stooq CSV fallback; response includes `failed` symbols when a quote cannot be fetched; API does not crash on partial failure
- CSV download (`GET /holdings/export.csv`) with cost basis and P/L columns
- SQLite by default; `DATABASE_URL` can point at PostgreSQL using the driver in `backend/requirements.txt`
- CORS allowlist from `ALLOWED_ORIGINS` (and alias `CORS_ORIGINS`) for a split frontend and API

## Tech stack

| Layer    | Choices |
| -------- | ------- |
| Frontend | React 19, TypeScript, Vite, Recharts |
| Backend  | FastAPI, SQLAlchemy 2, Pydantic v2 |
| Auth     | JWT (python-jose), bcrypt |
| Database | SQLite (dev) / PostgreSQL via `DATABASE_URL` |
| HTTP     | httpx (async quotes) |

## Architecture

```text
Browser (React)
  → VITE_API_BASE_URL or dev proxy /api → FastAPI (/api/v1)
       → SQLAlchemy → SQLite or PostgreSQL
       → External: Yahoo chart API, Stooq CSV (fallback)
```

Backend layout (high level):

- `app/api/v1/routes/` — thin HTTP handlers (auth, holdings, portfolio, prices)
- `app/models/` — SQLAlchemy models
- `app/schemas/` — Pydantic request/response models and validation
- `app/services/quotes.py` — external quote fetching
- `app/services/portfolio_service.py` — valuation and summary math (Decimal-based)
- `app/core/` — settings, database session, security helpers, optional SQLite column patches for older local DBs

## API routes

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | No | `{"status":"ok"}` |
| POST | `/api/v1/auth/register` | No | Create user (email, password ≥ 8 chars) |
| POST | `/api/v1/auth/login` | No | JSON body `{ "email", "password" }`; returns JWT |
| GET | `/api/v1/auth/me` | Bearer | Current user |
| GET | `/api/v1/holdings` | Bearer | List holdings with computed price, value, P/L |
| POST | `/api/v1/holdings` | Bearer | Add holding (symbol, quantity, avg buy, asset type) |
| PATCH | `/api/v1/holdings/{id}` | Bearer | Update quantity and avg buy |
| DELETE | `/api/v1/holdings/{id}` | Bearer | Remove holding |
| GET | `/api/v1/holdings/export.csv` | Bearer | CSV download |
| GET | `/api/v1/portfolio/summary` | Bearer | Totals, position count, unrealized P/L on **priced** holdings only, optional `%` on priced cost basis, and `unpriced_symbols` when any row has no snapshot |
| POST | `/api/v1/prices/refresh` | Bearer | Refresh quotes; response `{ updated, failed: string[] }` |

## Database schema (conceptual)

- **users** — `id`, unique `email`, `password_hash`, `created_at`, `updated_at`
- **assets** — `id`, `symbol`, `asset_type`, `name`, timestamps; unique `(symbol, asset_type)`
- **holdings** — `id`, `user_id`, `asset_id`, `quantity`, `avg_buy_price`, `created_at`, `updated_at`; unique `(user_id, asset_id)` so a user cannot duplicate the same asset row
- **price_snapshots** — `id`, `asset_id`, `price`, `source`, `captured_at` (append-only style history; “current” is latest by time)

Money fields use `Numeric` in the database layer and `Decimal` in Python for calculations to limit avoidable float drift; the JSON API still uses JSON numbers for simplicity.

## Local setup (fresh clone)

1. Clone the repository.
2. Start the **backend** (keep this terminal open).
3. Start the **frontend** in a second terminal.
4. Open **http://localhost:5173** in the browser. The API should be on **http://127.0.0.1:8080**.

### Backend

From the `backend/` directory:

**Windows (PowerShell):**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

**macOS / Linux:**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

- Health: [http://127.0.0.1:8080/health](http://127.0.0.1:8080/health) → `{"status":"ok"}`
- OpenAPI: [http://127.0.0.1:8080/docs](http://127.0.0.1:8080/docs)

Copying `.env.example` to `.env` is optional for a quick **SQLite** local run (the app has a dev default signing key). For **PostgreSQL** (or any non-SQLite `DATABASE_URL`), the API **refuses to start** unless `JWT_SECRET_KEY` is a random string of at least 32 characters and is not the dev default or the `.env.example` placeholder—this avoids shipping with a known weak secret.

### Frontend

From the `frontend/` directory:

```bash
cd frontend
npm install
npm run dev
```

With the default Vite proxy, the browser calls `/api/v1` on the dev server, which forwards to `http://127.0.0.1:8080`. If the API uses another port, set `VITE_DEV_API_ORIGIN` in `frontend/.env` (see `frontend/.env.example`).

**Production build (sanity check):** `npm run build` — for a static deploy you **must** set `VITE_API_BASE_URL` to your live API base URL including the `/api/v1` path, **with no trailing slash** (e.g. `https://api.example.com/api/v1`). If you omit it, the built app falls back to `http://127.0.0.1:8080/api/v1`, which only works for local testing.

More Windows port notes: [`AGENTS.md`](AGENTS.md).

### Local SQLite upgrades

If you had an older checkout, the app runs lightweight `ALTER TABLE` patches for SQLite so new timestamp columns appear without you deleting data. If anything looks inconsistent, you can still delete `backend/portfolio_tracker.db` and restart to get a clean file.

## Environment variables

**Backend** (`backend/.env`):

| Variable | Purpose |
| -------- | ------- |
| `JWT_SECRET_KEY` or `SECRET_KEY` | JWT signing secret (required strong secret when using non-SQLite `DATABASE_URL`; see note above) |
| `DATABASE_URL` | `sqlite:///./portfolio_tracker.db` or PostgreSQL URL |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins: scheme + host (+ port if non-default). **No path, no trailing slash** on each entry (e.g. `https://portfolio-analytics-tracker.vercel.app`). Include every Vercel production and preview origin you use. |
| `PRICE_API_URL` | Optional Yahoo chart base URL override |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Optional JWT lifetime |

**Frontend** (`frontend/.env`):

| Variable | Purpose |
| -------- | ------- |
| `VITE_API_BASE_URL` | Full API base including `/api/v1`, **no trailing slash** (required on Vercel so the browser never calls `localhost` for API) |
| `VITE_DEV_API_ORIGIN` | Backend origin for the dev proxy (default `http://127.0.0.1:8080`) |

Never commit real `.env` files or secrets.

## Deployment notes

**Render (backend)** — set at least:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL, typically `postgresql+psycopg://…` |
| `JWT_SECRET_KEY` | Random string, 32+ characters, not the placeholder |
| `ALLOWED_ORIGINS` | Exact Vercel origins, comma-separated, **no trailing slash** |

Start command (example): `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. If the process exits on boot with a JWT validation error, fix `JWT_SECRET_KEY` for non-SQLite databases.

**Vercel (frontend)** — set:

| Variable | Notes |
| --- | --- |
| `VITE_API_BASE_URL` | e.g. `https://portfolio-analytics-tracker-api.onrender.com/api/v1` — must include `/api/v1` and **no trailing slash** so production never falls back to `http://127.0.0.1:8080/api/v1` |

Add each deployed frontend origin to Render `ALLOWED_ORIGINS`.

**Other hosts (Railway / Fly.io)**  
Same env pattern: strong JWT secret, Postgres URL, CORS allowlist, and `$PORT` binding for uvicorn.

**Database (Neon / Supabase / Render Postgres)**  
Use a SQLAlchemy URL with the **psycopg3** dialect, e.g. `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require`. The repo lists `psycopg[binary]` in `backend/requirements.txt` for this path. If your host gives a `postgres://` or `postgresql://` URL without a driver, prepend `postgresql+psycopg://` (and keep query params such as `sslmode=require` as provided).

**CORS**  
`ALLOWED_ORIGINS` is a comma-separated list; surrounding whitespace on each origin is stripped in code, and empty entries are ignored. Origins must **exactly** match what the browser sends (`https://…`, correct hostname, **no trailing slash**, no path). Include both `https://your-app.vercel.app` and any preview URLs you actually use; add `https://www.…` separately if you serve both apex and `www`.

**API responses:** Additional field semantics for holdings, portfolio summary, and price refresh are described on the `/docs` models (Pydantic `Field` descriptions).

## Manual testing checklist

Use this after a fresh clone, after changing env vars, or before you tag a release.

**Backend (curl or `/docs`)**

- [ ] With `DATABASE_URL` pointing at PostgreSQL, the process exits on startup if `JWT_SECRET_KEY` is missing, shorter than 32 characters, or still the dev/placeholder value (expected: fix env and restart)
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] Register a new user (`POST /api/v1/auth/register`), then login (`POST /api/v1/auth/login`) and receive a JWT
- [ ] `GET /api/v1/auth/me` with `Authorization: Bearer <token>` returns that user
- [ ] `POST /api/v1/holdings` adds a holding; duplicate symbol + asset type for the same user returns `400` with a clear message
- [ ] `GET /api/v1/holdings` returns rows with `current_price` / `total_value` / `profit_loss` when a snapshot exists
- [ ] `PATCH /api/v1/holdings/{id}` updates quantity and average buy; `404` for another user’s id
- [ ] `DELETE /api/v1/holdings/{id}` returns `204`
- [ ] `GET /api/v1/holdings/export.csv` downloads CSV with expected headers
- [ ] `GET /api/v1/portfolio/summary` returns `unpriced_symbols` for rows without a price snapshot; unrealized P/L matches the sum of per-row P/L only where a price exists
- [ ] `POST /api/v1/prices/refresh` returns `{ "updated", "failed" }`; invalid/expired JWT returns `401`

**Frontend (local or production)**

- [ ] Register; login; **Log out** returns to the auth screen and clears holdings
- [ ] Session persists after refresh (token in `localStorage`); signed-in email matches `GET /auth/me` after reload
- [ ] Dashboard loads summary and table; symbol filter narrows rows
- [ ] Add holding: **Save** stays disabled until symbol, quantity, and average buy are valid; invalid values show inline field feedback
- [ ] **Duplicate** symbol for the same account shows a clear error (API message prefixed in the UI)
- [ ] **Edit** and **Save** a row; **Remove** asks for confirm and removes the row
- [ ] **Invalid** quantity or average buy (zero or negative) does not save; inline hints explain the rule
- [ ] **Fake / unpriced** symbol: row shows dashes for price/value/P/L; yellow banner explains summary excludes unpriced rows until a quote exists
- [ ] **Refresh prices**: success copy when snapshots save; warning lists symbols with no quote; info line when nothing new was saved but refresh ran
- [ ] **Export CSV** downloads a file
- [ ] **401** from the API (e.g. expired token) clears the session and shows sign-in again
- [ ] **Multi-user isolation:** two accounts do not see each other’s holdings or IDs (spot-check with two browsers or incognito)
- [ ] **Production:** in browser devtools Network tab, API calls go to your Render host (from `VITE_API_BASE_URL`), not `127.0.0.1` or `localhost`

**Quotes:** Live prices depend on Yahoo/Stooq; it is normal for some symbols to appear in `failed` during refresh.

## Known limitations

- **Schema changes:** Tables are created with SQLAlchemy `create_all` plus small SQLite `ALTER` patches; there is no Alembic migration history yet.
- **Quotes:** Third-party endpoints can rate-limit or change behavior; the app degrades gracefully but does not guarantee a quote for every symbol.
- **Portfolio summary:** `total_cost` is always the full portfolio cost basis. `total_value` and `unrealized_pl` include only holdings that have at least one `price_snapshots` row; see `unpriced_symbols` in the summary JSON when anything is missing a quote.
- **Single page UI:** The dashboard lives in `frontend/src/App.tsx` (not split into route modules); fine for this MVP scope.

## Future improvements

Planned direction only — not implemented in this MVP.

### A) Near-term (1–2 weeks)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| Stronger disabled states and inline validation polish on forms | Clearer UX for edge inputs; fewer mistaken submits | S | High | Medium |
| More consistent error / success / loading banners | Professional feel for demos and screenshots | S | Medium | Medium |
| Richer copy for unpriced holdings and partial quote failures | Sets expectations without sounding broken | S | Medium | Medium |
| Targeted pytest for portfolio summary math and rounding | Protects the most business-critical logic | M | High | High |
| Small auth + holdings API tests (happy path + 401 + duplicate) | Prevents regressions on isolation and JWT | M | High | High |
| Screenshots in-repo and README gallery | Faster skim for recruiters | S | Medium | High |
| Manual QA / release checklist in CI or a `CONTRIBUTING` note | Repeatable quality gate | S | Medium | Medium |
| Strict `ENVIRONMENT=production` checks (CORS, JWT) | Fewer misconfigurations when splitting frontend and API | S | High | Medium |

### B) Mid-term (2–6 weeks)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| GitHub Actions: `npm run build`, lint, backend install + smoke import | Catches broken deploys before merge | M | High | High |
| Alembic migrations + Postgres-first workflow | Safe schema iteration | M | High | High |
| Simple Docker Compose (backend + Postgres, optional frontend) | One-command local parity with production | M | Medium | High |
| Structured logging (request id, quote failures) | Easier production debugging | M | Medium | Medium |
| Quote caching / rate-limit handling for `/prices/refresh` | Resilience when Yahoo/Stooq throttle | M | Medium | Medium |
| Pagination or sorting on the holdings table | Scales past a dozen rows | M | Low | Medium |
| Portfolio history chart from stored snapshots | Shows momentum beyond a single refresh | L | Low | High |

### C) Long-term (later)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| Transaction history and lot-level cost basis | Accurate realized and unrealized P/L over time | L | Medium | High |
| CSV import with validation and dry-run | Faster onboarding; more validation surface | L | Low | Medium |
| Multiple portfolios per user | Household / goal-based views | L | Low | Medium |
| More asset types (ETFs, funds, crypto) | Broader real-world use | L | Low | Medium |
| Rule-based portfolio insights (concentration, sector) | Actionable views without ML | L | Medium | High |
| Optional AI-generated summary, clearly labeled, not financial advice | Narrative layer for demos | L | Low | Medium |
| Richer analytics dashboard | Depth for power users | L | Low | High |
| Demo account with seeded sample data | Zero-friction reviewer experience | M | Medium | High |
| Observability (metrics, tracing) and SLOs | Production maturity story | L | Low | Medium |

---


Single source of truth for dependencies: `backend/requirements.txt` and `frontend/package.json`. Root `requirements.txt` is only a pointer.
