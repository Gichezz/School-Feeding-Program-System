# Offline-First Data Synchronization System for School Feeding Programs

University final-year prototype for one selected school. Attendance and meal-distribution data can be captured offline, stored locally, and later synchronized with a central PostgreSQL server. Meal-demand forecasting (Flask + Prophet) is an integrated decision-support component and is **not** implemented in this phase.

## Technology stack

| Layer | Technologies |
|-------|----------------|
| Frontend | React.js, PWA, Service Workers, IndexedDB, Dexie.js |
| Backend | Node.js, Express.js, REST API |
| Database | PostgreSQL |
| Forecasting (later) | Python, Flask, Facebook Prophet |

## Project structure

```text
school-feeding-system/
├── frontend/          # React PWA (Dexie, sync stubs, service worker via Vite PWA)
├── backend/           # Express REST API
├── forecasting/       # Flask + Prophet placeholder (not implemented yet)
├── database/          # schema.sql, seed.sql
├── docs/              # Architecture notes
└── README.md
```

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ (required when you apply the schema; not needed just to run API health check)
- Python 3.10+ (only needed when you start the forecasting service)

## Setup

### 1. Backend

```bash
cd backend
copy .env.example .env
# Edit .env with your PostgreSQL credentials
npm install
npm run dev
```

API default: `http://localhost:3001`  
Health check: `GET http://localhost:3001/api/health`

### 2. Frontend

```bash
cd frontend
copy .env.example .env
npm install
npm run dev
```

App default: `http://localhost:5173`  
Dev proxy forwards `/api` to the backend.

### 3. Database (when ready)

```bash
psql -U postgres -c "CREATE DATABASE school_feeding;"
psql -U postgres -d school_feeding -f database/schema.sql
psql -U postgres -d school_feeding -f database/seed.sql
```

### 4. Forecasting service (placeholder only)

```bash
cd forecasting
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Health check: `GET http://localhost:5000/health`  
Forecast endpoint returns `501` until a later phase.

## Environment variables (needed now or later)

### Backend (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | Express port (default `3001`) |
| `NODE_ENV` | `development` / `production` |
| `DATABASE_URL` | PostgreSQL connection string (preferred) |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Alternative PostgreSQL connection fields |
| `FORECASTING_SERVICE_URL` | Flask service URL (later phase) |

### Frontend (`frontend/.env`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base path (default `/api` with Vite proxy) |

### Forecasting (`forecasting/.env`)

| Variable | Purpose |
|----------|---------|
| `FLASK_ENV` | Flask environment |
| `FLASK_RUN_PORT` | Flask port (default `5000`) |
| `DATABASE_URL` | Optional DB URL when forecasting reads history later |

## Phase 1 scope

**Done:** folder layout, runnable skeletons, Dexie DB shell, Express health route, SQL foundation, forecasting stub.

**Not in this phase:** sync logic, conflict-resolution UI, forecasting models, full domain features.

## Assumptions

- Workspace was empty; this phase created the initial architecture from scratch.
- Prototype targets **one school**.
- Sync uses a **version-based** protocol (not CRDTs).
- Conflict UI and forecasting come in later phases.
- Local development uses Windows-style commands in examples; adjust for other OS if needed.
