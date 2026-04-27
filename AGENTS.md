# Portfolio Analytics Tracker — context for assistants

## Goal

Student portfolio project: **full-stack investment dashboard** — auth, holdings CRUD, live prices, P/L summary, charts, CSV (stretch), deployable with env-based config. Resume-focused; avoid over-engineering.

## What to work on

- **`backend/`** — FastAPI, SQLAlchemy, JWT auth, Yahoo chart API for prices. SQLite locally; Postgres-ready via `DATABASE_URL`.
- **`frontend/`** — Vite + React + TypeScript + Recharts. API base: `VITE_API_BASE_URL` (see `.env.example`).

## How to run (local)

1. Backend: `cd backend`, activate venv, `pip install -r requirements.txt`, then  
   `python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload`  
   Health: `http://127.0.0.1:8080/health`

2. Frontend: `cd frontend`, `npm install`, `npm run dev`  
   Dev server proxies `/api` → `http://127.0.0.1:8080` by default; keep the API on 8080 or set `VITE_DEV_API_ORIGIN` / `VITE_API_BASE_URL` in `.env` (see `frontend/.env.example`).

## Windows note

Port **8000** often hits `WinError 10013`; this repo defaults to **8080**. On **Windows PowerShell 5.1**, chain commands with `;` (not `bash`’s `&&`). If **8080** is in use, pick another port in the uvicorn command and set `frontend/.env` `VITE_API_BASE_URL` to match.

## Single sources of truth

- Python deps (main app): `backend/requirements.txt`
- Node deps: `frontend/package.json`
