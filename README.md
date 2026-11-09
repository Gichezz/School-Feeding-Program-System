# Lishe

**Offline-first records and monitoring for school feeding programmes.**

[![CI](https://github.com/Gichezz/School-Feeding-Program-System/actions/workflows/ci.yml/badge.svg)](https://github.com/Gichezz/School-Feeding-Program-System/actions/workflows/ci.yml)

Lishe ("nutrition" in Swahili) helps public primary and junior schools in a Kenyan school meals programme keep their feeding and food-store records on a school tablet or phone, with or without a connection. The records synchronise with a central server when a connection returns. Sub-county programme officers see each school's term in figures, plus a weekly list of the schools whose records look most unusual, so they know which to look into first.

```text
offline capture  →  sync  →  analytics  →  anomaly scoring  →  officer review
```

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Running the tests](#running-the-tests)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Known limitations](#known-limitations)
- [License](#license)

## Features

### For school staff (on the school's device)

- **Daily feeding record:** learners fed (and, optionally, present), cereals and pulses issued, or the reason there was no feeding. Each entry is checked as it is typed, against enrolment, the ration and what the store holds.
- **Food store:** deliveries against their delivery notes, purchases, losses and store counts. The device shows the stock balance and how many school days of food are left.
- **Enrolment and the term plan:** enrolment by class and sex each term, carried forward from the last term for checking. The term's food requirement and an end-of-term report follow the Ministry of Education calendar.
- **Works offline:** everything is saved on the device first and syncs on its own when a connection returns. Staff can sign in offline with their PIN for 7 days after signing in online.

### For programme officers

- **Analytics:** each school's term so far, covering days recorded, learners fed against enrolment, food against the ration, days of food left, deliveries and how up to date its records are.
- **Weekly review list:** each finished week, the sub-county's schools are ranked by how unusual their records look (Extended Isolation Forest). The top schools come with plain-language reasons, worded "needs review", never "fraud". The officer marks each one explained or for follow-up.
- **Record review:** unusual records (late, outside school hours, above enrolment, far from the ration, a short delivery) are flagged for checking, never blocked.
- **Conflicts and held records:** when two devices record different numbers for the same day, the officer decides which to keep. A delivery note entered twice is held, not counted twice.

### For administrators

- Users and roles, school devices (each needs approval), passkey or authenticator-app sign-in, and recovery codes.

### Automatic

- Syncing with retries.
- Merging copies that differ only in an optional field.
- Weekly scoring, with a week scored again when late records arrive.
- Database migrations on start-up, and daily backups.

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

PostgreSQL is the single source of truth. Each school device keeps a working copy of its school's records in the browser's storage (IndexedDB), so staff can work offline. Changes are queued and synced:
- edits are checked against the version they were made on;
- the stock ledger is append-only;
- devices download their school's changes using a transaction-based cursor, so no change is missed.

See [docs/architecture.md](docs/architecture.md).

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, Vite, PWA (vite-plugin-pwa / Workbox), IndexedDB with Dexie.js |
| Backend | Node.js 20, Express, JWT sessions, bcrypt, WebAuthn (passkeys) |
| Database | PostgreSQL 14+ |
| Scoring and evaluation | Python 3.12, Flask, isotree, scikit-learn, pandas |
| Testing and CI | Jest and Supertest, Vitest and fake-indexeddb, pytest, GitHub Actions |
| Deployment | Docker Compose, Caddy (HTTPS) |

## Getting started

### Option 1: Docker (quickest)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/Gichezz/School-Feeding-Program-System.git
cd School-Feeding-Program-System
cp .env.example .env        # Windows: copy .env.example .env
```

In `.env`, set `PGPASSWORD` and `JWT_SECRET`, and set `LOAD_DEMO_DATA=true` for the demo accounts. Then:

```bash
docker compose up --build -d
```

Open <http://localhost:8080>. This runs the database, API, scoring service, web app and daily backups.

To update later, pull and rebuild; database migrations apply themselves:

```bash
git pull
docker compose up --build -d
```

To start again with an empty database, run `docker compose down --volumes` first. This deletes the Docker database.

Deploying to a server with HTTPS is covered in [docs/deployment.md](docs/deployment.md).

### Option 2: Local development

**Prerequisites:** Node.js 20, PostgreSQL 14 or later, Python 3.12. The commands use macOS/Linux syntax; on Windows use `copy` for `cp` and `venv\Scripts\` for `venv/bin/`.

**1. Create the database**

```bash
psql -U postgres -c "CREATE DATABASE school_feeding;"
psql -U postgres -d school_feeding -f database/schema.sql
psql -U postgres -d school_feeding -f database/calendar_kenya.sql
psql -U postgres -d school_feeding -f database/seed.sql
```

- `calendar_kenya.sql` loads the national school calendar (terms, half-terms, public holidays, national exams). Every installation needs it.
- `seed.sql` adds four fictional schools and three demo accounts, for **local use only**. Their passwords are listed at the top of the file.

**2. Start the API** (port 5000)

```bash
cd backend
cp .env.example .env        # then set DATABASE_URL and JWT_SECRET (32+ characters)
npm install
npm run dev
```

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The API applies any new database migrations when it starts.

**3. Start the scoring service** (port 5001)

```bash
cd forecasting
python -m venv venv
venv/bin/pip install -r requirements-dev.txt
venv/bin/python app.py
```

**4. Start the web app** (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api` to the API.

### Demo data (optional)

To give the officer screens two years of history, generate the synthetic dataset and load one sub-county into a database built from `seed.sql`:

```bash
python forecasting/scripts/generate_feeding_dataset.py
cd backend && npm run demo:records
```

For a live demonstration outside the national calendar's terms, `database/demo/practice_term.sql` adds a clearly labelled practice term. Never load it on a real installation.

### Trying it out

1. Sign in as the demo **administrator** or **programme officer** (see `database/seed.sql`).
2. In a second browser window, choose **Set up this school device** and use the demo **staff** account with **I have a password**. Then approve the device as the administrator and sign in as staff with the PIN.
3. Record a day's feeding, then go offline in the browser's developer tools, record again, and reconnect to watch it sync.

## Running the tests

| Part | Command | Notes |
|---|---|---|
| API | `cd backend && npm test` | Needs PostgreSQL. Uses its own `<database>_test` database and drops it afterwards. |
| Web app | `cd frontend && npm test` | No backend needed. `npm run build` checks the production build. |
| Scoring service | `cd forecasting && venv/bin/python -m pytest tests` | |

GitHub Actions runs all of them, plus a Docker Compose smoke test, on every pull request ([ci.yml](.github/workflows/ci.yml)).

**Evaluations.** These reproduce the reported results; each protocol was committed before it was run:

```bash
python forecasting/scripts/evaluate_anomaly_detection.py      # method comparison
python forecasting/scripts/run_anomaly_robustness.py          # robustness across scenarios
python forecasting/scripts/run_anomaly_deployment_test.py     # as the system runs it
python forecasting/scripts/check_explanation_faithfulness.py  # are the reasons faithful
cd frontend && npm run evaluate:sync                          # sync success, conflicts, latency
```

## Configuration

The API reads `backend/.env`; Docker Compose reads `.env` in the project folder. The main settings:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | **Required.** Signs sign-in sessions; at least 32 random characters |
| `SCORING_SERVICE_URL` | Scoring service address (default `http://localhost:5001`) |
| `SCHOOL_TIMEZONE` | Time zone for school days (default `Africa/Nairobi`) |
| `REVIEW_SCHEDULE`, `REVIEW_SCHEDULE_MINUTES` | Automatic weekly scoring (`on`, every `60` minutes) |
| `MIGRATIONS_BASELINE` | Only for a database migrated by hand before migrations were automatic: the last script it has, set once |
| `BACKUP_KEEP_DAYS` | Days of daily backups kept by Docker Compose (default `14`) |

Every setting is listed in [backend/.env.example](backend/.env.example), [.env.example](.env.example) and [docs/deployment.md](docs/deployment.md#configuration).

**Database changes** are scripts in `database/migrations/`, applied by the API in number order when it starts. Each script's header says what it changes. `cd backend && npm run migrate` applies them without starting the API.

## Documentation

| Document | Covers |
|---|---|
| [Architecture](docs/architecture.md) | Components, data, the sync protocol, conflicts, monitoring, sign-in and record integrity |
| [Anomaly detection](docs/anomaly-detection.md) | Why monitoring instead of forecasting, the features, the method comparison and its results |
| [Model audit](docs/anomaly-model-audit.md) | The audit behind the final method choice |
| [Sync evaluation](docs/sync-evaluation.md) | Success rate, conflict detection, latency and convergence |
| [Synthetic dataset](docs/synthetic-dataset.md) | How the evaluation data is generated from real Kenyan inputs |
| [Deployment](docs/deployment.md) | Docker, HTTPS, configuration, migrations, backups and the smoke test |

## Project structure

```text
├── frontend/      React PWA: school, officer and admin screens, offline database, sync client
├── backend/       Express API: sign-in, sync, conflicts, analytics, review lists, migrations
├── forecasting/   Scoring service, anomaly features and methods, dataset generator, evaluations
├── database/      schema.sql, calendar_kenya.sql, seed.sql, migrations/
├── deploy/        Caddy (HTTPS) config, backup script, deployment smoke test
├── docs/          Project documentation
└── .github/       CI workflow, issue forms, pull request template
```

## Contributing

Work is tracked in [issues](https://github.com/Gichezz/School-Feeding-Program-System/issues) and on the [project board](https://github.com/users/Gichezz/projects/1). `main` is protected: every change arrives through a pull request that passes CI. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit and issue conventions.

## Known limitations

- **Synthetic data.** No real school feeding records were available. The anomaly method was chosen on a synthetic dataset built from real Kenyan inputs, and needs checking against real records before use.
- **A list, not a verdict.** A listed school often has an ordinary explanation; only the officer's notes are judgements. Records that never sync cannot be ranked.
- **Background sync.** Devices sync when the app is open or reconnects, not in the background, which not every phone browser supports.
- **Calendar.** The national calendar covers 2024–2026; later years are added when the Ministry publishes them.
- **Scope.** Public primary and junior school day schools with one meal a day. Boarding schools are not covered.
- **Sign-in.** The first sign-in on a device needs a connection, and sign-in is not yet rate-limited.
- **Backups.** Daily backups are kept on the same machine; copy them elsewhere regularly.

## License

No licence has been granted for this project; all rights are reserved by the author.

---

Developed by Ryan Gicheru at Strathmore University as a final-year project.
