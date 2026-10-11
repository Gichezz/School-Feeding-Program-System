# Architecture

Offline-first system for one school. Staff record daily attendance and meal distribution on a device that may be offline; the records are synchronised with a central PostgreSQL database when a connection is available. A forecasting service estimates meal demand for upcoming school days.

## Components

| Component | Technology | Responsibility |
|---|---|---|
| Frontend | React PWA (Vite, Workbox service worker) | Pages for recording, sync status, conflicts, reports and forecasts. Works offline: the service worker caches the app shell, and data lives in IndexedDB. |
| Local store | IndexedDB via Dexie.js (`frontend/src/db/database.js`) | Records captured on the device, the sync queue, local copies of conflicts, cached schools and the latest forecast. |
| Sync client | `frontend/src/sync/` | Queues every change, sends the queue to the API, records the outcome of each operation. |
| API | Node.js + Express (`backend/src/`) | Sign-in, validation, records, the sync endpoint, conflict resolution, reports, and the forecast proxy. |
| Database | PostgreSQL (`database/schema.sql`) | The authoritative copy of all records, the sync log, conflicts and stored forecasts. |
| Forecasting | Python + Flask + Prophet (`forecasting/`) | Serves meal-demand forecasts from a trained model. It never connects to the database. |

## Data

**Device (IndexedDB, Dexie version 4)**

| Table | Contents |
|---|---|
| `attendance`, `mealDistribution` | Records captured or edited on the device, with `version`, `syncStatus` (`pending`, `synced`, `conflict`) and, once synced, the server's `serverId` |
| `syncQueue` | One entry per change: operation id, entity type, operation (`create` / `update`), payload, `baseVersion`, status (`pending`, `synced`, `conflict`, `failed`), retry count |
| `conflicts` | Conflicts reported by the server, with both versions and the server's conflict id |
| `schools`, `metadata`, `forecasts` | Cached schools, the device's client id, and the latest forecast per school |

**Server (PostgreSQL)**

| Table | Contents |
|---|---|
| `attendance_records`, `meal_distributions` | One record per school per date, with `version`, `client_id` (device) and `updated_by` (user) |
| `sync_operations` | Every operation received through sync and its outcome, keyed by the device's operation id |
| `conflicts` | Stale updates kept for review: base and server versions, both payloads, status and resolution, `resolved_by` |
| `forecast_results` | The latest forecast per school, date and model, used when the forecasting service is unavailable |
| `users`, `schools`, `students` | Accounts (bcrypt password hashes, role `admin` or `school_staff`), the school, and an optional roster |

## Synchronisation protocol

Version-based optimistic concurrency, not a CRDT: the server never silently overwrites a newer record.

1. **Capture.** Saving or editing a record writes it to IndexedDB and adds an operation to `syncQueue`. A new record has `baseVersion` 0; an edit carries the version it was based on.
2. **Send.** When the device comes back online (or the user presses **Sync Now**) and the session is valid, pending operations are sent to `POST /api/sync`, one at a time.
3. **Apply.** The server validates the payload, then handles each operation in its own transaction:
   - an operation id it has already applied is answered from `sync_operations` (idempotent replay)
   - a create, or an update whose `baseVersion` equals the server's version, is applied; the version increases by 1
   - an update with an older `baseVersion` is recorded as a **conflict**, and the server record is left unchanged
4. **Record the outcome.** The device marks the operation `synced` and stores the new version and the server id, or marks it `conflict` and saves the conflict locally. Network or server errors leave it `pending` and add one retry; after 3 retries it is marked `failed`. An expired or rejected sign-in pauses sync without counting a retry.

## Conflict resolution

An administrator opens the conflict, which shows the device's values beside the server's, and chooses:

- **Keep server version:** the server record stays as it is; the device takes the server values.
- **Keep local version:** the device's values are applied on the server as a new version.

The server rejects a resolution if the record has changed again since the conflict was recorded (409), so a decision is always made against current data. The conflict stores who resolved it and when.

## Sign-in and roles

`POST /api/auth/login` checks the password against the bcrypt hash and returns a signed session token (JWT, 7 days by default). Every other API route except the health check requires it. School staff can record, sync and view everything; only administrators can resolve conflicts. The device keeps the session so it can still be used offline after the token expires; only requests to the server need a valid session.

## Forecasting flow

1. The Forecast page asks the API for `GET /api/forecasts` with the school, start date and period.
2. The API takes the school's enrollment from the latest attendance record and calls the Flask service.
3. Flask forecasts each school day in the period from the trained Prophet model (non-school days are excluded) and returns expected meals with a likely range.
4. The API stores the result in `forecast_results` and returns it. If Flask is unavailable, the API returns the stored forecast marked as stale; if the server cannot be reached, the page shows the last forecast saved on the device.

See [forecasting.md](forecasting.md) for the model, features and evaluation.

## Folder roles

| Folder | Role |
|--------|------|
| `frontend/` | React PWA: pages, components, Dexie database, sync client, services, tests |
| `backend/` | Express API: routes, controllers, validation, auth middleware, tests |
| `forecasting/` | Flask service, Prophet model and artifacts, dataset and training scripts, tests |
| `database/` | `schema.sql`, `seed.sql`, `migrations/` |
| `docs/` | Architecture, forecasting and dataset documentation |
