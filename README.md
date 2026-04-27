# Portfolio Analytics Tracker

A small full-stack app for tracking a personal stock portfolio: sign up, add holdings, pull live quotes, see allocation and unrealized P/L, and export CSV. Meant to run locally with SQLite or against PostgreSQL when deployed.

**Prerequisites:** Python 3.10+ with `pip`, Node.js 18+ and npm (for the frontend).

## Features

Verified in this repo (see routes under `backend/app/api/v1/routes/` and the dashboard in `frontend/src/App.tsx`):

- JWT auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`; passwords hashed with bcrypt
- Holdings: list, add, update quantity/average buy, delete — all scoped to the logged-in user via the JWT
- Dashboard: portfolio summary (totals and position count), symbol filter on the holdings table, inline edit, delete with confirm, add-holding form
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
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (include your Vercel URL when deployed) |
| `PRICE_API_URL` | Optional Yahoo chart base URL override |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Optional JWT lifetime |

**Frontend** (`frontend/.env`):

| Variable | Purpose |
| -------- | ------- |
| `VITE_API_BASE_URL` | Full API base with `/api/v1` for production builds |
| `VITE_DEV_API_ORIGIN` | Backend origin for the dev proxy (default `http://127.0.0.1:8080`) |

Never commit real `.env` files or secrets.

## Deployment notes

**Frontend (Vercel)**  
Set `VITE_API_BASE_URL` to your deployed API (e.g. `https://your-service.onrender.com/api/v1`). Add the same frontend origin to the backend `ALLOWED_ORIGINS`.

**Backend (Render / Railway / Fly.io)**  
Run something like: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (exact command depends on the platform). Set `JWT_SECRET_KEY` (32+ random characters, not the placeholder), `DATABASE_URL`, and `ALLOWED_ORIGINS`. Use the platform’s secret store for sensitive values. If the app exits immediately on boot, check the JWT error in the logs—weak secrets are rejected for non-SQLite databases.

**Database (Neon / Supabase / Render Postgres)**  
Use a SQLAlchemy URL with the **psycopg3** dialect, e.g. `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require`. The repo lists `psycopg[binary]` in `backend/requirements.txt` for this path. If your host gives a `postgres://` or `postgresql://` URL without a driver, prepend `postgresql+psycopg://` (and keep query params such as `sslmode=require` as provided).

**CORS**  
`ALLOWED_ORIGINS` is a comma-separated list; surrounding whitespace on each origin is stripped in code. Origins must **exactly** match what the browser sends (`https://…`, correct hostname, no path). Include both `https://your-app.vercel.app` and any preview URLs you actually use; add `https://www.…` separately if you serve both apex and `www`.

## Manual testing checklist

Use this after a fresh clone or before you tag a release.

**Backend (curl or `/docs`)**

- [ ] With `DATABASE_URL` pointing at PostgreSQL, the process exits on startup if `JWT_SECRET_KEY` is missing, shorter than 32 characters, or still the dev/placeholder value (expected: fix env and restart)
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] Register a new user (`POST /api/v1/auth/register`), then login (`POST /api/v1/auth/login`) and receive a JWT
- [ ] `GET /api/v1/auth/me` with `Authorization: Bearer <token>` returns that user
- [ ] `POST /api/v1/holdings` adds a holding; duplicate symbol + asset type for the same user returns `400`
- [ ] `GET /api/v1/holdings` returns rows with `current_price` / `total_value` / `profit_loss` when a snapshot exists
- [ ] `PATCH /api/v1/holdings/{id}` updates quantity and average buy; `404` for another user’s id
- [ ] `DELETE /api/v1/holdings/{id}` returns `204`
- [ ] `GET /api/v1/holdings/export.csv` downloads CSV with expected headers
- [ ] `GET /api/v1/portfolio/summary` returns `unpriced_symbols` for rows without a price snapshot; unrealized P/L matches the sum of per-row P/L only where a price exists
- [ ] `POST /api/v1/prices/refresh` returns `{ "updated", "failed" }`; invalid/expired JWT returns `401`

**Frontend**

- [ ] Register and login; session persists after refresh (token in `localStorage`); after refresh, the signed-in email still matches `GET /auth/me` (re-synced on dashboard load)
- [ ] Dashboard loads summary and table; filter input narrows rows by symbol; with a holding that has no quote yet, the dashboard shows the unpriced warning and totals stay consistent with priced rows only
- [ ] Add holding: Save stays disabled until symbol, quantity, and average buy are valid; invalid patterns show clear client-side errors before submit
- [ ] Edit and save a row; delete asks for confirm and removes the row
- [ ] Refresh prices shows success and, if applicable, a warning for failed symbols
- [ ] Export CSV downloads a file
- [ ] Logout clears the session; `401` from the API clears the session

**Quotes:** Live prices depend on Yahoo/Stooq; it is normal for some symbols to appear in `failed` during refresh.

## Known limitations

- **Schema changes:** Tables are created with SQLAlchemy `create_all` plus small SQLite `ALTER` patches; there is no Alembic migration history yet.
- **Quotes:** Third-party endpoints can rate-limit or change behavior; the app degrades gracefully but does not guarantee a quote for every symbol.
- **Portfolio summary:** `total_cost` is always the full portfolio cost basis. `total_value` and `unrealized_pl` include only holdings that have at least one `price_snapshots` row; see `unpriced_symbols` in the summary JSON when anything is missing a quote.
- **Single page UI:** The dashboard lives in `frontend/src/App.tsx` (not split into route modules); fine for this MVP scope.

## Future improvements

### A) Near-term (1–2 weeks)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| Strict `ENVIRONMENT=production` checks (CORS allowlist, optional extra JWT rules) | Fewer misconfigurations when splitting frontend and API | S | High | Medium |
| GitHub Actions: `npm run build`, `npm run lint`, `pip install` + import/smoke of FastAPI app | Catches broken deploys early | S | High | Medium |
| Targeted pytest for auth, holdings CRUD, and portfolio summary math | Regressions on money math are costly | M | High | High |
| Structured logging for quote refresh failures | Faster debugging in production | S | Medium | Medium |

### B) Mid-term (2–6 weeks)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| Alembic migrations + Postgres-first workflow | Safe schema iteration | M | High | High |
| Docker + docker-compose for backend + Postgres + optional frontend | One-command demos for recruiters | M | Medium | High |
| Rate limiting or short-TTL cache on `/prices/refresh` | Protects the app and upstream APIs | M | Medium | Medium |
| API and env var reference (OpenAPI is partial; a short doc helps operators) | Reduces onboarding friction | S | Medium | Low |

### C) Long-term (later)

| Item | Why it matters | Effort | Priority | Resume impact |
|------|----------------|--------|----------|---------------|
| Transaction history, cost-lot tracking, dividends | Real portfolio accuracy | L | Low | High |
| CSV import with validation and dry-run | Power users; more surface area to secure | L | Low | Medium |
| Observability (metrics, tracing) and hardened SLOs | Production at scale | L | Low | Medium |

---


Single source of truth for dependencies: `backend/requirements.txt` and `frontend/package.json`. Root `requirements.txt` is only a pointer.
