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
| `attendance_records`, `meal_distributions` | One record per school per date, with `version`, `client_id` (device) and `updated_by` (user), plus who captured it, on which school device, when it was captured and received, and any reason for a late entry |
| `record_history` | Every saved version of each record: its values, who changed it, from which device, and when |
| `record_flags` | Records flagged for an administrator to check, with the reason, status (`open`, `checked`) and the administrator's note |
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
   - a create for a school and date that already has a record (the same day recorded on two devices while offline, #70) is the same record if the numbers match; if they differ it is recorded as a **conflict**, so neither device's numbers are lost
4. **Record the outcome.** The device marks the operation `synced` and stores the new version and the server id, or marks it `conflict` and saves the conflict locally. An update based on an older version whose numbers already match the server's is the same record, not a conflict (#74). If the server answers with an error, the operation stays `pending` and counts one retry; after 3 retries it is marked `failed`. A dropped connection (no answer, or a gateway error while the server restarts) does not count as a retry, and after three in a row the device stops until the next try. An expired or rejected sign-in pauses sync without counting a retry.
5. **Retry.** While online and records are still waiting, the device syncs again automatically: 5 s after a sync that got some through, then after 15 s, 30 s, 1, 2 and 5 minutes while nothing gets through. It also syncs 5 s after the connection returns and when the app is opened or comes back into view. Records that older versions marked failed because of the connection are put back in the queue (#74). The sync evaluation measures this behaviour ([sync-evaluation.md](sync-evaluation.md)).

## Conflict resolution

An administrator opens the conflict, which shows the device's values beside the server's, and chooses:

- **Keep server version:** the server record stays as it is; the device takes the server values.
- **Keep local version:** the device's values are applied on the server as a new version.
- **Edit and merge:** the administrator enters the correct values, which are checked like any other record and applied as a new version.

The server rejects a resolution if the record has changed again since the conflict was recorded (409), so a decision is always made against current data. The conflict stores who resolved it and when.

## Sign-in and roles

`POST /api/auth/login` checks the password against the bcrypt hash and returns a signed session token (JWT, 7 days by default). Every other API route except the health check requires it. School staff can record, sync and view everything; only administrators can resolve conflicts and manage user accounts (`/api/users`). The auth middleware looks up the account on every request, so a deactivated user, or a session issued before a password change or reset, is rejected straight away, and a role change applies immediately. Anyone signed in can change their own password with `PUT /api/auth/password`; the response is a new session for that device.

**Administrator passkeys (#57).** Administrators sign in with a WebAuthn passkey, which is multi-factor and phishing-resistant. The device keeps the private key in its secure hardware and asks for a fingerprint, face or device PIN; the server stores only the public key. Each registration and sign-in uses a one-time challenge stored in `auth_challenges` (deleted on use, expiring after 5 minutes). The server checks the signature, the origin (`WEBAUTHN_ORIGINS`), the RP ID (`WEBAUTHN_RP_ID`), user verification and the signature counter. Passkeys are discoverable, so passkey sign-in needs no email. Once an account has a passkey, `POST /api/auth/login` refuses the password alone (403 with `passkeyRequired`). The first passkey comes with ten one-time recovery codes, stored as bcrypt hashes. An administrator who cannot use a passkey signs in with password + recovery code (`POST /api/auth/recovery`), and another administrator can reset their passkeys, which also ends their sessions. Administrators without a passkey can still use their password, but the app asks them to add a passkey.

**Authenticator app codes for administrators (#63).** An administrator whose computer or phone cannot hold a passkey can set up an authenticator app (TOTP, RFC 6238) under Settings → Authenticator app: they scan a QR code and confirm one code before it takes effect. After that, signing in with a password also needs a 6-digit code from the app (`POST /api/auth/totp/login`). The password is checked first, so wrong passwords cannot lock anyone out of code sign-in. Codes are accepted within one 30-second step either side of the server time, and only for a later step than the last code used, so a code cannot be replayed. Five wrong codes in a row pause code sign-in for 15 minutes; passkeys and recovery codes still work. The secret is stored in `totp_credentials` encrypted with AES-256-GCM (key from `TOTP_ENCRYPTION_KEY`, or derived from `JWT_SECRET` with HKDF) and is never returned after set-up. The recovery codes work for either method; an administrator without a passkey gets them when the app is confirmed. Removing the app needs a passkey, so an administrator always keeps a second step, and another administrator can reset someone's passkeys and app together. The server checks every code, so this needs a connection; it is not offered to school staff, because an offline check would keep the secret on the same device as the PIN.

**School devices and staff PINs (#60).** Staff record on designated school devices, which is how funded programmes usually work (for example DHIS2 and CommCare deployments). A staff member belongs to one school. An administrator creates the account and gets a one-time activation code (stored as a bcrypt hash, expiring after 48 hours). On the school device the staff member enters the code, chooses a password and a 6-digit PIN, and the browser creates a P-256 key pair with WebCrypto: the private key is non-extractable and stays in IndexedDB on the device, and only the public key (JWK) reaches the server. A device starts as pending and is approved by an administrator in Settings → School devices. Staff sign in on an approved device with email + PIN (`POST /api/devices/sign-in`); the server checks the PIN (bcrypt) and the device's signature over a fresh one-time challenge, so sign-in is multi-factor (the enrolled device + the PIN) and verified on the server. Five wrong PINs lock that staff member on that device until an administrator unlocks them. Password-only sign-in is refused for staff. A staff session carries its device ID, and the auth middleware checks on every request that the device is still approved and belongs to the staff member's school, so removing a device ends its sessions at once; the app then forgets the device's key but keeps its records. Staff can only see their own school and can only record and sync for it. An existing staff member can add themselves to an approved device, or set a new PIN, with their password.

**Offline sign-in and who captured each record (#61).** Following DHIS2 Android Capture and CommCare, a staff member who has signed in online on a school device can later sign in there without a connection. After each online PIN sign-in the device stores, for that person only: a PBKDF2-SHA256 hash of the PIN (600,000 iterations, random salt; never the PIN), the time of the online sign-in, and their last session. Offline, the same email + PIN signs them in on that device for up to 7 days after their last online sign-in; 5 wrong PINs lock offline sign-in until they sign in online. Offline sign-in uses two factors (the enrolled device and the PIN), but the check runs on the device, so it is lower assurance than online sign-in and is treated that way: **the server stays the authority.** Every queued record carries who captured it, on which device and when, and the server decides per record (`backend/src/services/captureCheck.js`): records captured by the signed-in user are applied; records captured by a colleague on the same device are deferred and wait on the device until that colleague syncs them, so a record is never applied under someone else's account; records from someone who has since been deactivated, or whose password an administrator reset after they captured them, or from a device that has been removed, are held in `held_operations` (Conflicts → Held records) for an administrator to apply, keeping the original author, or discard. When the server reports such a hold, the device forgets that person's offline sign-in. Removing a device also clears everyone's offline sign-in on it. The device keeps the session so it can still be used offline after the token expires; only requests to the server need a valid session.

**Record integrity (#62).** Device and PIN controls stop outsiders, but not an authorised person entering false numbers, so the system also makes misuse visible, as DHIS2 does with audit trails and validation rules. Each record keeps who captured it, on which device, when it was captured on the device and when it reached the server, and every saved version goes into `record_history`. A record can be for today or up to 3 school days back (Monday to Friday); older dates need a short reason, and future dates are refused. The window is measured from when the record was captured on the device, so a device that was offline for a week is not penalised, and the device checks the same rule so staff give the reason while recording, even offline. After each save the server raises flags (`backend/src/services/integrity.js`): captured outside school hours (06:00 to 18:00 in the school time zone), entered late, kept offline for more than 3 days before syncing, more meals served than learners present (with a 10% margin), and far from the school's usual numbers (more than 3 standard deviations from its last 20 records, once it has 10). Flags never block a record. Administrators see them under Record review, with the record, the person, the device, both times and the full history, check each one (for example against the paper register) and mark it checked with a note. Administrators' own conflict decisions are kept in the history without being flagged. Settings: `SCHOOL_TIMEZONE`, `SCHOOL_DAY_START`, `SCHOOL_DAY_END`, `OFFLINE_FLAG_HOURS`.

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
