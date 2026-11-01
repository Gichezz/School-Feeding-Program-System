# Offline-First Data Synchronization System for School Feeding Programs

Final-year project. Schools in a Kenyan school meals programme record enrolment, daily feeding and their food store **offline** on a school device; the records synchronise with a central PostgreSQL server when a connection returns, with conflicting edits kept for a person to decide. Sub-county programme officers see each school's term in figures, and a weekly list of the schools whose records look most unusual, ranked by Extended Isolation Forest, to look into first.

Pipeline: **offline capture → sync → descriptive analytics → anomaly scoring → officer review**.

## Features

| Area | What it does |
|---|---|
| **Today's feeding record** | Learners fed (and, optionally, present), cereals and pulses issued, or why there was no feeding. Checked on the device as it is typed: against enrolment, the ration and what the store holds. |
| **Stock** | Deliveries against their delivery notes, purchases, losses, store counts. An append-only ledger: entries are never changed, a correction is a reversing entry. The device shows the balance and how many school days of food are left. |
| **Enrolment and the term** | Termly enrolment by class and sex; the termly food requirement (enrolment × school days × ration, less what is in store) and an end-of-term report, all worked out offline from the Ministry of Education calendar. |
| **Synchronisation** | Every change is queued and sent automatically when a connection returns, retried while records wait, and applied exactly once. Each device downloads its school's changes, so two devices at a school hold the same records and stock balance. |
| **Conflicts** | An edit made on an outdated copy, or the same day recorded differently on two devices, is kept as a conflict instead of overwriting. The programme officer compares both versions from their own laptop and keeps one or enters the correct numbers; the decision reaches the school's devices with their next download. |
| **Duplicate deliveries** | The same delivery note entered on two devices is held instead of counted twice, until an administrator applies or discards it. |
| **Analytics** | For each school in the sub-county, the term so far: days recorded, learners fed against enrolment, food against the ration, days of food left, delivery timeliness and shortfalls, and how far behind its synced records are. |
| **Weekly review list** | Each week the sub-county's schools are ranked by how unusual their records look; the top 3 come with their reasons in plain words, always "needs review". The officer marks each one explained or follow-up with a note. |
| **Record integrity** | Every record keeps who captured it, on which device, when it was captured and received, and its sync batch; every version is kept. Late entries need a reason; unusual records are flagged for review, never blocked. |
| **Sign-in and roles** | School staff sign in on approved school devices with a PIN (offline too, for 7 days); programme officers see their own sub-county; administrators use passkeys or an authenticator app. |

## Architecture

```text
 School device (React PWA)              Express API (Node.js)                PostgreSQL
 ┌──────────────────────────┐ HTTP(S) ┌───────────────────────────┐  SQL  ┌───────────────┐
 │ Today · Stock · Term      │◄──────►│ auth · sync · downloads   │◄─────►│ records,      │
 │ IndexedDB (Dexie)         │  /api  │ conflicts · held records  │       │ stock ledger, │
 │  └ sync queue, ledger     │        │ analytics · review lists  │       │ history,      │
 │ Service worker (app)      │        └─────────────┬─────────────┘       │ conflicts,    │
 └──────────────────────────┘                       │ HTTP                │ review lists  │
 Officer laptop: analytics, weekly      ┌───────────▼────────────────┐    └───────────────┘
 review, conflicts (online)             │ Scoring service (Flask,     │
                                        │ Extended Isolation Forest)  │
                                        └─────────────────────────────┘
```

Details: [docs/architecture.md](docs/architecture.md) (components, sync protocol, conflicts, monitoring), [docs/anomaly-detection.md](docs/anomaly-detection.md) (why monitoring, the method comparison and its results), [docs/sync-evaluation.md](docs/sync-evaluation.md) (sync success rate, conflict detection, latency and convergence), [docs/deployment.md](docs/deployment.md).

## Technology stack

| Layer | Technologies |
|-------|----------------|
| Frontend | React 18, Vite, PWA (vite-plugin-pwa / Workbox), IndexedDB with Dexie.js |
| Backend | Node.js, Express, JWT sessions, bcrypt, WebAuthn |
| Database | PostgreSQL |
| Scoring and evaluation | Python, Flask, isotree, scikit-learn, pandas |
| Testing and CI | Jest + Supertest, Vitest + fake-indexeddb, pytest, GitHub Actions |

## Project structure

```text
├── frontend/      React PWA: school, officer and admin screens, Dexie database, sync client, tests, sync evaluation
├── backend/       Express REST API: auth, sync, conflicts, analytics, review lists, tests, demo loader
├── forecasting/   Scoring service, anomaly features and methods, synthetic dataset generator, evaluations, tests
├── database/      schema.sql, calendar_kenya.sql, seed.sql, migrations/, Docker first-start script
├── deploy/        Caddy (HTTPS) config and the deployment smoke test
├── docs/          Architecture, anomaly detection, sync evaluation, deployment and dataset documentation
└── .github/       CI workflow, issue forms, pull request template
```

`docker-compose.yml` runs the whole system in containers; `docker-compose.prod.yml` adds HTTPS for a public server.

## Quick start with Docker

With [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed, one command runs the database, API, scoring service and app:

```bash
copy .env.example .env
docker compose up --build
```

First set `PGPASSWORD` and `JWT_SECRET` in `.env`, and `LOAD_DEMO_DATA=true` for the demo accounts. Then open `http://localhost:8080`. [docs/deployment.md](docs/deployment.md) covers configuration, migrations, backups, deploying to a server with HTTPS, and the smoke test.

To run the services without Docker, for development, follow the steps below.

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
psql -U postgres -d school_feeding -f database/calendar_kenya.sql
psql -U postgres -d school_feeding -f database/seed.sql
```

`calendar_kenya.sql` loads the national school calendar (term dates, half-terms, public holidays and national exams for 2024–2026), which every installation needs. `seed.sql` creates four fictional schools in one fictional sub-county and three demo accounts (administrator, programme officer, school staff) for **local development only**; their passwords are listed at the top of that file, so never load it on a hosted or shared database.

**Existing databases:** `schema.sql` only creates missing tables. Apply later schema changes with the scripts in `database/migrations/`, in order (`001` to `015`), then load `calendar_kenya.sql`:

```bash
psql -U postgres -d school_feeding -f database/migrations/001_attendance_present_absent_equals_registered.sql
```

`001`–`007` cover attendance validation, user accounts, administrator passkeys, school devices and PINs, offline capture and held records, record integrity, and authenticator app codes. `008` adds each school's county, sub-county, programme type and ration, and the programme officer role. `009` adds the school calendar. `010` adds sync batches, the transaction stamp devices download changes by, and the append-only guard. `011` adds termly enrolment and the daily feeding record. `012` adds the stock ledger and store counts. `013` adds the weekly review lists and officers' decisions, and drops the old stored forecasts. `014` holds a delivery note entered twice and lets devices download decisions on held records. `015` lets review runs be stored as scored by Extended Isolation Forest. `001` lists any old attendance records that do not add up; correct them, then run `ALTER TABLE attendance_records VALIDATE CONSTRAINT attendance_present_absent_equals_registered;`.

**Demo records (optional).** To give the officer screens two years of history, generate the synthetic dataset and load one simulated sub-county into a demo database (built from `schema.sql`, `calendar_kenya.sql` and `seed.sql`). The loader only adds records, and stops if the demo sub-county already has some:

```bash
python forecasting/scripts/generate_feeding_dataset.py
cd backend
npm run demo:records
```

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

**First administrator (without the demo accounts):** on a database where `seed.sql` was not loaded, create the first administrator from the `backend` folder. The script asks for the password without showing it (or reads `ADMIN_PASSWORD`). Then sign in, add a passkey from **Settings → Passkeys**, and add everyone else from **Settings → Users**. Passkeys belong to one domain (`WEBAUTHN_RP_ID` in `backend/.env`, `localhost` by default), so passkeys made on `localhost` do not work on a hosted server.

```bash
node scripts/create-admin.js --name "Your Name" --email you@example.org
```

### 3. Scoring service (port 5001)

```bash
cd forecasting
python -m venv venv
venv\Scripts\activate
pip install -r requirements-dev.txt
python app.py
```

It needs no trained model: each weekly list is scored with a model fitted on the sub-county's own recent records. Health check: `GET http://localhost:5001/health`. The app reaches it through the backend (`POST /api/review-lists/:week/run`), never directly. The weekly review list is the only screen that needs it.

### 4. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with a demo account. The Vite dev server forwards `/api` to the backend on port 5000.

School staff do not sign in with a password alone: on the sign-in page choose **Set up this school device**, enter the demo staff email, choose **I have a password** and use the demo staff password, and pick a PIN. Then sign in as the administrator, approve the device in **Settings → School devices**, and sign back in as staff with the email and PIN.

### Evaluations (optional)

```bash
python forecasting/scripts/evaluate_anomaly_detection.py
python forecasting/scripts/run_anomaly_robustness.py
python forecasting/scripts/run_anomaly_deployment_test.py
cd frontend
npm run evaluate:sync
```

Each writes its report under `forecasting/data/reports/anomaly/` or `frontend/evaluation/sync/results/`; the protocols they follow were committed before they were run.

## Tests

| Service | Command | Notes |
|---|---|---|
| Backend | `cd backend` then `npm test` | Needs PostgreSQL. Creates `<database>_test` (or uses `TEST_DATABASE_URL`) and drops it afterwards; refuses any database not ending in `_test`. |
| Frontend | `cd frontend` then `npm test` | Vitest with an in-memory IndexedDB; no backend needed. `npm run build` checks the production build. |
| Scoring and evaluation | `cd forecasting` then `venv\Scripts\python -m pytest tests` | |

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
| `SCORING_SERVICE_URL` | Scoring service URL (default `http://localhost:5001`; the older `FORECASTING_SERVICE_URL` also works) |
| `SCORING_TIMEOUT_MS` | How long the backend waits for a week's ranking (default `30000`) |
| `SCHOOL_TIMEZONE` | Time zone for school days and entry times (default `Africa/Nairobi`) |
| `FRONTEND_URL` | Browser origin allowed by CORS (default `http://localhost:5173`; set to the deployed frontend URL) |
| `JSON_BODY_LIMIT` | Maximum JSON request body size (default `100kb`) |
| `TEST_DATABASE_URL` | Optional database for `npm test`; its name must end in `_test` |

### Frontend (`frontend/.env`, optional)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base path (default `/api`, served through the Vite proxy in development) |

### Scoring service

The Flask service reads environment variables only from the shell; it does not load a `.env` file.

| Variable | Purpose |
|----------|---------|
| `FLASK_RUN_PORT` | Flask port (default `5001`) |

## Project management

Work is tracked in [GitHub issues](https://github.com/Gichezz/School-Feeding-Program-System/issues), grouped into [milestones](https://github.com/Gichezz/School-Feeding-Program-System/milestones), on the [project board](https://github.com/users/Gichezz/projects/1). Every change reaches `main` through a pull request; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limitations

- **Synthetic data.** No real school feeding records were available. The anomaly methods were compared, and the weekly list's settings chosen, on a synthetic dataset built from real Kenyan inputs; they need checking against real records before use ([docs/anomaly-detection.md](docs/anomaly-detection.md)).
- **The list ranks, it does not judge.** Many listed weeks have an ordinary explanation; only the officer's notes are judgements. Records that never sync cannot be ranked, so analytics show how far behind each school is.
- **Sync while the app is closed.** Devices sync when the app is opened, brought into view, or reconnects, not in the background: background sync is not available on every phone browser (notably iPhones). A kitchen device opened each school day syncs daily.
- **Calendar.** The national calendar covers 2024–2026; each later year's term dates are added when the Ministry publishes them.
- **Sign-in.** The first sign-in on a device needs a connection. There is no rate limiting on sign-in yet.
- **Hosting.** Docker Compose and an HTTPS setup for any Linux server are ready ([docs/deployment.md](docs/deployment.md)); the public demo server itself is still to be set up ([#25](https://github.com/Gichezz/School-Feeding-Program-System/issues/25)).
