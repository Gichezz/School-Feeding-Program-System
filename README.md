# Offline-First Data Synchronization System for School Feeding Programs

Final-year project. A system for one selected Kenyan school that records daily attendance and meal distribution **offline**, synchronises the records with a central PostgreSQL server when connectivity returns, detects and resolves conflicting edits, and forecasts meal demand to support planning.

## Features

| Area | What it does |
|---|---|
| **Offline capture** | Attendance and meal records are saved in the browser (IndexedDB via Dexie.js) first, so the app works without a connection. Installable as a PWA. |
| **Synchronisation** | Each change is queued with the version it was based on and sent when the device is online (automatically, or with **Sync Now**). Replays are idempotent; failed operations are retried up to 3 times. |
| **Conflict handling** | If the server's copy changed since the device's edit was based on it, the edit is recorded as a conflict instead of overwriting. An administrator compares both versions and keeps one. |
| **Validation** | The same rules apply in the form, the API, sync and the database (e.g. present + absent must equal registered). |
| **Dashboard and reports** | Attendance and meal totals, rates and trends for a date range. |
| **Meal-demand forecast** | Expected meals per school day with a likely range, from a Prophet model served by a Flask service. The latest forecast is kept on the device for offline viewing. |
| **Sign-in and roles** | School staff and administrators sign in; only administrators resolve conflicts. Recording keeps working offline when a sign-in expires. |

## Architecture

```text
 Browser (React PWA)                    Express API (Node.js)              PostgreSQL
 ┌──────────────────────────┐ HTTP(S) ┌─────────────────────────┐  SQL  ┌──────────────┐
 │ Pages ─ IndexedDB (Dexie) │◄──────►│ auth · records · sync   │◄─────►│ records,     │
 │        └ sync queue       │  /api  │ conflicts · reports     │       │ sync log,    │
 │ Service worker (app shell)│        │ forecasts (proxy+store) │       │ conflicts,   │
 └──────────────────────────┘        └───────────┬─────────────┘       │ forecasts    │
                                                  │ HTTP                 └──────────────┘
                                       ┌──────────▼─────────────┐
                                       │ Flask + Prophet (5001) │
                                       └────────────────────────┘
```

Details: [docs/architecture.md](docs/architecture.md) (components and sync protocol), [docs/forecasting.md](docs/forecasting.md) (model and evaluation), [docs/synthetic-dataset.md](docs/synthetic-dataset.md) (training data).

## Technology stack

| Layer | Technologies |
|-------|----------------|
| Frontend | React 18, Vite, PWA (vite-plugin-pwa / Workbox), IndexedDB with Dexie.js |
| Backend | Node.js, Express, JWT sessions, bcrypt |
| Database | PostgreSQL |
| Forecasting | Python, Flask, Prophet, pandas |
| Testing and CI | Jest + Supertest, Vitest + fake-indexeddb, pytest, GitHub Actions |

## Project structure

```text
├── frontend/      React PWA: pages, Dexie database, sync queue and manager, tests
├── backend/       Express REST API: auth, records, sync and conflicts, reports, forecasts, tests
├── forecasting/   Flask + Prophet service, dataset and training scripts, model artifacts, tests
├── database/      schema.sql, seed.sql, migrations/
├── docs/          Architecture, forecasting and dataset documentation
└── .github/       CI workflow, issue forms, pull request template
```

## Prerequisites

- Node.js 20 and npm
- PostgreSQL 14 or later (tested with 17 and 18)
- Python 3.12 (3.10+ should work)

Commands below use Windows syntax (`copy`, `venv\Scripts\...`); on macOS/Linux use `cp` and `venv/bin/...`.

## Setup

Run each service in its own terminal, from the project folder.

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE school_feeding;"
psql -U postgres -d school_feeding -f database/schema.sql
psql -U postgres -d school_feeding -f database/seed.sql
```

`seed.sql` creates one demo school and two demo accounts for local development; their passwords are listed at the top of that file. The demo school's only attendance record has 3 registered learners, so forecasts are close to zero until realistic attendance is recorded.

**Existing databases:** `schema.sql` only creates missing tables. Apply later schema changes with the scripts in `database/migrations/`, in order:

```bash
psql -U postgres -d school_feeding -f database/migrations/001_attendance_present_absent_equals_registered.sql
```

`001` requires present + absent to equal registered for new and updated attendance records, and lists existing records that do not add up. Correct those records, then run `ALTER TABLE attendance_records VALIDATE CONSTRAINT attendance_present_absent_equals_registered;`.

### 2. Backend API (port 5000)

```bash
cd backend
copy .env.example .env
npm install
npm run dev
```

In `backend/.env`, set the PostgreSQL connection (`DATABASE_URL`) and a `JWT_SECRET`. The server will not start without a secret of at least 32 characters. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Health check: `GET http://localhost:5000/api/health`

### 3. Forecasting service (port 5001)

```bash
cd forecasting
python -m venv venv
venv\Scripts\activate
pip install -r requirements-dev.txt
python app.py
```

The trained model is committed in `forecasting/models/artifacts/`, so no training is needed to start. To retrain or re-evaluate (from the project folder):

```bash
python forecasting/scripts/evaluate_forecasting_models.py
python forecasting/scripts/train_forecasting_model.py
```

Health check: `GET http://localhost:5001/health`. The app reaches forecasts through the backend (`GET /api/forecasts`), not directly.

### 4. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with a demo account. The Vite dev server forwards `/api` to the backend on port 5000.

### Historical dataset (optional)

The synthetic dataset used to train the model is committed. To regenerate and check it (from the project folder):

```bash
python forecasting/scripts/inspect_us_dataset.py
python forecasting/scripts/generate_synthetic_dataset.py
python forecasting/scripts/validate_synthetic_dataset.py
python forecasting/scripts/data_quality_report.py
```

## Tests

| Service | Command | Notes |
|---|---|---|
| Backend | `cd backend` then `npm test` | Needs PostgreSQL. Creates `<database>_test` (or uses `TEST_DATABASE_URL`) and drops it afterwards; refuses any database not ending in `_test`. |
| Frontend | `cd frontend` then `npm test` | Vitest with an in-memory IndexedDB; no backend needed. `npm run build` checks the production build. |
| Forecasting | `cd forecasting` then `venv\Scripts\python -m pytest tests` | |

GitHub Actions runs all three on every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)). `main` only accepts changes through pull requests that pass these checks.

## Environment variables

### Backend (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | Express port (default `5000`) |
| `NODE_ENV` | `development` shows error details; anything else hides internal error messages |
| `DATABASE_URL` | PostgreSQL connection string (preferred) |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Alternative PostgreSQL connection fields |
| `JWT_SECRET` | **Required.** Random secret (32+ characters) that signs sign-in sessions |
| `JWT_EXPIRES_IN` | How long a sign-in lasts (default `7d`) |
| `FORECASTING_SERVICE_URL` | Flask forecasting service URL (default `http://localhost:5001`) |
| `FORECASTING_TIMEOUT_MS` | How long the backend waits for a forecast (default `15000`) |
| `FRONTEND_URL` | Browser origin allowed by CORS (default `http://localhost:5173`; set to the deployed frontend URL) |
| `JSON_BODY_LIMIT` | Maximum JSON request body size (default `100kb`) |
| `TEST_DATABASE_URL` | Optional database for `npm test`; its name must end in `_test` |

### Frontend (`frontend/.env`, optional)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base path (default `/api`, served through the Vite proxy in development) |

### Forecasting

The Flask service reads environment variables only from the shell; it does not load a `.env` file.

| Variable | Purpose |
|----------|---------|
| `FLASK_RUN_PORT` | Flask port (default `5001`) |

## Project management

Work is tracked in [GitHub issues](https://github.com/Gichezz/School-Feeding-Program-System/issues), grouped into [milestones](https://github.com/Gichezz/School-Feeding-Program-System/milestones), on the [project board](https://github.com/users/Gichezz/projects/1). Every change reaches `main` through a pull request; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limitations

- **One school.** The data model allows more, but the prototype and its forecasting model target one school.
- **Synthetic training data.** The forecasting model is trained and evaluated on a synthetic dataset for one simulated Kenyan school; it has not been validated against real school records ([docs/forecasting.md](docs/forecasting.md)).
- **Offline scope.** The service worker caches the app shell, and records live in IndexedDB. Offline behaviour is tested through the browser's online/offline state rather than a real network outage.
- **Sign-in.** The first sign-in on a device needs a connection. There is no rate limiting on sign-in yet, and a session cannot be revoked before it expires.
- **Deployment and UI.** Deployment configuration is planned ([#25](https://github.com/Gichezz/School-Feeding-Program-System/issues/25)), and the interface is due for a redesign ([#40](https://github.com/Gichezz/School-Feeding-Program-System/issues/40)).
