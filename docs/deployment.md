# Deploying Lishe

Lishe runs as four containers, described in [`docker-compose.yml`](../docker-compose.yml):

| Service | Image | What it does |
|---|---|---|
| `db` | `postgres:17-alpine` | The central PostgreSQL database. Data lives in the `db-data` volume. |
| `scoring` | built from [`forecasting/Dockerfile`](../forecasting/Dockerfile) | Flask scoring service for the weekly review list (gunicorn, scikit-learn). It keeps no model and no data: each request brings a sub-county's records. |
| `backend` | built from [`backend/Dockerfile`](../backend/Dockerfile) | Express API. |
| `web` | built from [`frontend/Dockerfile`](../frontend/Dockerfile) | nginx serving the built PWA and forwarding `/api` to the API, so the browser talks to one origin. |

On a public server, [`docker-compose.prod.yml`](../docker-compose.prod.yml) adds **Caddy** in front of `web` for HTTPS. The PWA needs HTTPS to install and to work offline on phones. Locally, `http://localhost` is treated as secure, so plain HTTP is enough.

Only `web` (locally) or `caddy` (on a server) publishes a port. The database, API and scoring service are reachable only inside the Docker network.

## Run it locally

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows or macOS) or Docker Engine with the Compose plugin (Linux).

1. From the project folder, create your settings file:

   ```bash
   copy .env.example .env
   ```

   (`cp .env.example .env` on macOS or Linux.)

2. In `.env`, set `PGPASSWORD` and `JWT_SECRET` to long random values; the commands to generate them are in the file. For a local demo, also set `LOAD_DEMO_DATA=true` to get the demo school and the two demo accounts from `database/seed.sql`.

3. Build and start everything:

   ```bash
   docker compose up --build
   ```

4. Open <http://localhost:8080> and sign in. Set `WEB_PORT` in `.env` to use another port.

Stop with `Ctrl+C`, or `docker compose down` from another terminal. The database is kept in the `db-data` volume; `docker compose down --volumes` deletes it and starts from scratch next time.

## Deploy to a public server with HTTPS

Any Linux server that can run Docker works, for example a small cloud VM. Use one with at least 2 GB of memory, for building the images and scoring a sub-county's weekly list.

1. **Point a domain at the server.** Create a DNS `A` record (for example `lishe.example.org`) for the server's public IP address. Open ports **80** and **443** in the server's firewall or cloud security group. Caddy needs both to obtain the certificate.
2. **Install Docker** with the Compose plugin ([instructions](https://docs.docker.com/engine/install/)).
3. **Get the code:** `git clone https://github.com/Gichezz/School-Feeding-Program-System.git` and `cd` into it.
4. **Create `.env`** from `.env.example` with new random values for `PGPASSWORD` and `JWT_SECRET`. Keep `LOAD_DEMO_DATA=false`, because the demo accounts' passwords are public. Set `DOMAIN` to your domain name.
5. **Start it:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

   Caddy requests a Let's Encrypt certificate on the first visit and renews it automatically.
6. **Create the first administrator.** The script asks for the password without showing it:

   ```bash
   docker compose exec backend node scripts/create-admin.js --name "Your Name" --email you@example.org
   ```

7. **Sign in** at `https://<your domain>` and add a passkey from **Settings → Passkeys**. Passkeys belong to the domain, so passkeys made on another address (for example `localhost`) do not work here. Then add everyone else from **Settings → Users**: administrators with an initial password, school staff with their school. Each staff member gets a one-time activation code to set up the school device, which you then approve in **Settings → School devices**.
8. **Run the smoke test** (below) against the server.

To shorten the commands on the server, you can set `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` in `.env`. After that, a plain `docker compose up -d --build` uses both files.

## Configuration

All settings come from `.env` in the project folder, which Git ignores. [`.env.example`](../.env.example) lists them:

| Variable | Required | Purpose |
|---|---|---|
| `PGPASSWORD` | yes | Database password, used by `db` and `backend`. Letters and digits only. |
| `JWT_SECRET` | yes | Signs sign-in sessions; at least 32 random characters. The API refuses to start with the placeholder. |
| `PGUSER`, `PGDATABASE` | no | Database user and name (`postgres`, `school_feeding_db`). The names match `backend/.env`; inside Docker the host is always `db`, so `PGHOST`, `PGPORT` and `DATABASE_URL` are not used. |
| `JWT_EXPIRES_IN` | no | How long a sign-in lasts (`7d`). |
| `LOAD_DEMO_DATA` | no | `true` loads the demo school and demo accounts on the database's **first** start. Local use only. |
| `REVIEW_SCHEDULE`, `REVIEW_SCHEDULE_MINUTES` | no | The API scores each sub-county's finished weeks for the weekly review list by itself, and scores a recent week again when records for it sync late (`on`, every `60` minutes). `off` leaves scoring to officers. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | The mail server the API sends activation codes and device approvals through. Locally it is Mailpit, a test mailbox that catches every message (<http://localhost:8025>). On a server, set the programme's mail server or an email provider; without `SMTP_HOST`, activation codes are shown to the administrator to hand over. |
| `PUBLIC_URL` | no | The address people open Lishe at, used for links in emails. |
| `BACKUP_KEEP_DAYS` | no | How many days of daily backups the `backup` service keeps in `./backups` (`14`). |
| `MIGRATIONS_BASELINE` | once, if needed | Only for a database migrated by hand before the API applied migrations itself: the last script it already has (for example `016`). |
| `WEB_PORT` | no | Local port for the app (`8080`). |
| `DOMAIN` | server only | Domain name for HTTPS (`docker-compose.prod.yml`). |

No secrets are stored in the repository. Changing `JWT_SECRET` signs everyone out.

The API's passkey settings are set by the compose files: `localhost` and `http://localhost:<WEB_PORT>` locally, and `DOMAIN` with `https://<DOMAIN>` on the server. Changing the domain means administrators must add new passkeys, so they need their recovery codes or another administrator to reset their passkeys.

## Database: first start, migrations and backups

**First start.** When the `db-data` volume is empty, [`database/docker/init.sh`](../database/docker/init.sh) creates the tables from `database/schema.sql`. If `LOAD_DEMO_DATA=true`, it also loads `database/seed.sql`. This runs only once. Changing `LOAD_DEMO_DATA` later has no effect unless you delete the volume.

**Migrations are automatic.** A new database already has the latest schema, and `schema_migrations` records every script as applied. When a later version adds a script to `database/migrations/`, the API applies it when it starts, in number order, and records it ([`backend/src/db/migrate.js`](../backend/src/db/migrate.js)). If a script fails, the API stops instead of running on a half-changed schema, and the log names the script. Outside Docker, `npm run migrate` in `backend/` does the same without starting the API.

A database migrated by hand before this existed has no record of its scripts, and older scripts are not safe to run twice. Set `MIGRATIONS_BASELINE` once, in `.env` (or `backend/.env`), to the number of the last script applied by hand, for example `016`. The API records the scripts up to it and applies the later ones. Until then it applies nothing and says so in the log.

**Backups are automatic.** The `backup` service writes a compressed dump to `./backups` when it starts and every 24 hours after (`lishe-YYYY-MM-DD-HHMM.sql.gz`), keeping the last `BACKUP_KEEP_DAYS` days (14). Copy them off the server now and then; a backup on the same disk does not survive the disk. To take one now, for example before an update:

```bash
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > lishe-backup.sql
```

Restore into an empty database with `gunzip -c backups/<file>.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` (or `< lishe-backup.sql` for an uncompressed dump).

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The API applies any new migrations when it restarts. Devices pick up the new version of the app automatically the next time they open it online.

## Smoke test

[`deploy/smoke-test.mjs`](../deploy/smoke-test.mjs) checks a running deployment from any machine with Node 18 or later. It checks that:

- the app, deep links, service worker and manifest are served correctly
- the API is healthy and refuses requests without sign-in
- you can sign in
- an attendance record can be saved online
- a meal record captured offline syncs and shows in reports
- the API reaches the scoring service

```bash
BASE_URL=https://lishe.example.org SMOKE_EMAIL=you@example.org SMOKE_PASSWORD=... node deploy/smoke-test.mjs
```

(In PowerShell, set the variables first with `$env:BASE_URL = "..."` and so on.) Each run writes one attendance record and one meal record on a random day between 2000 and 2009, so real school days are untouched.

The browser parts of offline use cannot be scripted against a server. After deploying, check them on a phone:

1. Open the site and install it (**Add to Home screen**).
2. Turn on airplane mode, open Lishe from the home screen, and record attendance. It is saved on the device.
3. Turn airplane mode off. The record syncs, and **Sync status** shows it as synced.
4. Sign in as a programme officer on a laptop, open **Weekly review** and score the current week.

The CI workflow runs the same smoke test on every pull request. It builds all four images, starts the stack with the demo data, runs the test, creates an administrator with the script, and applies the migrations.

## Troubleshooting

- **"Passkeys are not set up for this web address"** or a passkey that is never accepted: the address in the browser must match `DOMAIN` (or `localhost` locally). Passkeys made for another address do not work.

- **`Set PGPASSWORD in .env`** or **`Set JWT_SECRET in .env`**: `.env` is missing or incomplete.
- **The database password seems wrong**: Docker Compose prefers variables already set in your terminal over `.env`. If you set `PGPASSWORD` in your shell for `psql`, that value is used; open a new terminal without it.
- **The API keeps restarting with `JWT_SECRET must be set`**: the secret is shorter than 32 characters or still the placeholder.
- **No HTTPS certificate**: check that the domain's DNS points at the server and that ports 80 and 443 are open, then look at `docker compose logs caddy`.
- **The weekly review list says the scoring service is not reachable**: look at `docker compose logs scoring`, and at `scoring` in `GET /api/health`.
- **See what is running:** `docker compose ps`. Follow logs with `docker compose logs -f backend`.
