# Deploying Lishe

Lishe runs as four containers, described in [`docker-compose.yml`](../docker-compose.yml):

| Service | Image | What it does |
|---|---|---|
| `db` | `postgres:17-alpine` | The central PostgreSQL database. Data lives in the `db-data` volume. |
| `forecasting` | built from [`forecasting/Dockerfile`](../forecasting/Dockerfile) | Flask + Prophet forecasting service (gunicorn). Loads the trained model in `forecasting/models/artifacts` at startup. |
| `backend` | built from [`backend/Dockerfile`](../backend/Dockerfile) | Express API. |
| `web` | built from [`frontend/Dockerfile`](../frontend/Dockerfile) | nginx serving the built PWA and forwarding `/api` to the API, so the browser talks to one origin. |

On a public server, [`docker-compose.prod.yml`](../docker-compose.prod.yml) adds **Caddy** in front of `web` for HTTPS. The PWA needs HTTPS to install and to work offline on phones. Locally, `http://localhost` is treated as secure, so plain HTTP is enough.

Only `web` (locally) or `caddy` (on a server) publishes a port. The database, API and forecasting service are reachable only inside the Docker network.

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

Any Linux server that can run Docker works, for example a small cloud VM. Use one with at least 2 GB of memory, because Prophet needs it when the images are built and forecasts run.

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
| `WEB_PORT` | no | Local port for the app (`8080`). |
| `DOMAIN` | server only | Domain name for HTTPS (`docker-compose.prod.yml`). |

No secrets are stored in the repository. Changing `JWT_SECRET` signs everyone out.

The API's passkey settings are set by the compose files: `localhost` and `http://localhost:<WEB_PORT>` locally, and `DOMAIN` with `https://<DOMAIN>` on the server. Changing the domain means administrators must add new passkeys, so they need their recovery codes or another administrator to reset their passkeys.

## Database: first start, migrations and backups

**First start.** When the `db-data` volume is empty, [`database/docker/init.sh`](../database/docker/init.sh) creates the tables from `database/schema.sql`. If `LOAD_DEMO_DATA=true`, it also loads `database/seed.sql`. This runs only once. Changing `LOAD_DEMO_DATA` later has no effect unless you delete the volume.

**Migrations.** A new database already has the latest schema. When a later version adds a script to `database/migrations/`, apply it to the running database (the folder is mounted read-only at `/database`):

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /database/migrations/004_staff_devices.sql'
```

Apply the scripts in number order. Each one explains in its header what it changes.

**Backups.** Take a dump before updating:

```bash
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > lishe-backup.sql
```

Restore into an empty database with `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < lishe-backup.sql`.

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Then apply any new migrations. Devices pick up the new version of the app automatically the next time they open it online.

## Smoke test

[`deploy/smoke-test.mjs`](../deploy/smoke-test.mjs) checks a running deployment from any machine with Node 18 or later. It checks that:

- the app, deep links, service worker and manifest are served correctly
- the API is healthy and refuses requests without sign-in
- you can sign in
- an attendance record can be saved online
- a meal record captured offline syncs and shows in reports
- the forecasting service returns a live forecast

```bash
BASE_URL=https://lishe.example.org SMOKE_EMAIL=you@example.org SMOKE_PASSWORD=... node deploy/smoke-test.mjs
```

(In PowerShell, set the variables first with `$env:BASE_URL = "..."` and so on.) Each run writes one attendance record and one meal record on a random day between 2000 and 2009, so real school days are untouched.

The browser parts of offline use cannot be scripted against a server. After deploying, check them on a phone:

1. Open the site and install it (**Add to Home screen**).
2. Turn on airplane mode, open Lishe from the home screen, and record attendance. It is saved on the device.
3. Turn airplane mode off. The record syncs, and **Sync status** shows it as synced.
4. Open **Forecast** and check that it shows.

The CI workflow runs the same smoke test on every pull request. It builds all four images, starts the stack with the demo data, runs the test, creates an administrator with the script, and applies the migrations.

## Troubleshooting

- **"Passkeys are not set up for this web address"** or a passkey that is never accepted: the address in the browser must match `DOMAIN` (or `localhost` locally). Passkeys made for another address do not work.

- **`Set PGPASSWORD in .env`** or **`Set JWT_SECRET in .env`**: `.env` is missing or incomplete.
- **The database password seems wrong**: Docker Compose prefers variables already set in your terminal over `.env`. If you set `PGPASSWORD` in your shell for `psql`, that value is used; open a new terminal without it.
- **The API keeps restarting with `JWT_SECRET must be set`**: the secret is shorter than 32 characters or still the placeholder.
- **No HTTPS certificate**: check that the domain's DNS points at the server and that ports 80 and 443 are open, then look at `docker compose logs caddy`.
- **Forecast says the model is not loaded**: look at `docker compose logs forecasting`. The image must include `forecasting/models/artifacts`.
- **See what is running:** `docker compose ps`. Follow logs with `docker compose logs -f backend`.
