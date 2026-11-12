# Architecture

Offline-first records for the school meals programme, with risk-based monitoring for sub-county programme officers. Schools record enrolment, daily feeding and their food store on a school device that is often offline; the records synchronise with a central PostgreSQL database when a connection is available. Programme officers see each school's term in figures, and a weekly list of the school-weeks whose records look most unusual, to look into first.

Pipeline: **offline capture → sync → descriptive analytics → anomaly scoring → officer review**.

## Components

| Component | Technology | Responsibility |
|---|---|---|
| School app | React PWA (Vite, Workbox service worker) | Today's feeding record, stock, enrolment, the term plan and report, sync status. Works fully offline: the service worker caches the app, records live in IndexedDB, and stock balances, days of food left and the termly requirement are worked out on the device. |
| Officer and admin screens | The same PWA, by role | Weekly review list, analytics, conflicts, record review, held records, users and devices. These need a connection. |
| Local store | IndexedDB via Dexie.js (`frontend/src/db/database.js`) | The school's records, the stock ledger, the sync queue, conflicts, the calendar and the school's ration, and the download cursor. |
| Sync client | `frontend/src/sync/` | Queues every change, sends the queue, downloads the school's changes, and settles conflicts and held records decided on the server. |
| API | Node.js + Express (`backend/src/`) | Sign-in, validation, the sync and download endpoints, conflict resolution, held records, analytics, the weekly review list. |
| Database | PostgreSQL (`database/schema.sql`) | The authoritative copy of all records, their history, the sync log, conflicts, held records, review lists and officers' decisions. |
| Scoring service | Python + Flask + isotree + scikit-learn (`forecasting/`) | Ranks a sub-county's school-weeks with Extended Isolation Forest refitted on the sub-county's own recent records. It never connects to the database: the API sends the records and stores the result. |

## Roles

Three roles, each with its own job: one records, one checks and decides, one runs the system. Every check is made by someone other than the person whose work is checked.

| Role (shown as) | Who it is | Works on | Can | Cannot |
|---|---|---|---|---|
| `school_staff` (**Feeding teacher**) | The teacher in charge of school feeding; a head teacher who records uses the same role | A school device, signed in with the device and a PIN | Record and sync for their own school, offline included: daily feeding, deliveries (with who witnessed them), losses, store counts, termly enrolment | See other schools; verify their own enrolment; decide conflicts |
| `programme_officer` (**Programme officer**) | Sub-county education office staff responsible for school meals | A laptop, online | For every school in their sub-county: verify termly enrolment, read analytics, mark weekly review listings explained or follow-up, check flagged records, resolve conflicts and held records | Record school data; manage accounts or devices |
| `admin` (**System administrator**) | County or ministry staff who run the system | A laptop, online | Create and deactivate accounts (feeding teachers with their school, programme officers with their sub-county), approve and remove devices, unlock PIN sign-ins, reset passwords and passkeys | See or send any school's records: feeding, stock, enrolment, analytics, review lists, flags, conflicts or held records; make any programme decision |

**Least privilege for the system administrator.** The administrator's job is accounts, devices and configuration, so the API refuses them every school record: `/api/analytics`, `/api/review-lists`, `/api/review`, `/api/enrolment`, the sync record endpoints (`POST /api/sync`, `/changes`, `/conflicts`, `/held`) and the older `/api/attendance`, `/api/meals` and `/api/reports` endpoints (403). The app shows them a dashboard of devices waiting for approval, locked sign-ins and accounts, and only the Dashboard and Settings pages. Approving a device shows its school and who set it up, but none of the school's records. A ministry auditor or county coordinator who needs to read programme records across sub-counties would be a separate read-only role, not the administrator.

**Who syncs a school device.** Only a feeding teacher sends a school's records and downloads its changes. An administrator or programme officer may sign in on a school device (for example to approve it or manage accounts), but while they are signed in the device does not sync: records waiting on it stay queued, with nothing sent or downloaded, until a feeding teacher signs in again. The server refuses them too (403), so this is enforced in both places. Switching between a teacher and an administrator on the same device loses nothing.

Class teachers keep attendance in the class registers; the feeding teacher copies the day's total if counted. Cooks and the school meals committee do not sign in: the committee member who witnesses a delivery is recorded by name with it (migration 018).

**Enrolment verification.** A school's termly enrolment sets the food it can request, so the programme officer checks it against the admission register and verifies it (**Enrolment checks**, `GET /api/enrolment`, `POST /api/enrolment/:schoolId/:termId/verify`). Verifying records who and when, as a new version in each class's history, so the school's devices download it. A later change on the device clears the verification of the classes it changes, so only numbers as they were checked count as verified.

Each school's term has one of five states: **Not entered**, **To check** (entered, never verified), **Changed since checked**, **Verified**, and **Discrepancy**. The changes are auditable (migration 020):

- **Discrepancy.** When the numbers do not match the register, the officer records a discrepancy with a note (`POST /api/enrolment/:schoolId/:termId/discrepancy`), for example "Grade 4 girls are 47 in the admission register". Every class for the term becomes a new version, no longer verified, with the note. The school's devices download it and show it on the Enrolment page. The school's next change answers it: the note is cleared and the term goes back to the officer as changed.
- **A reason for changing a verified class.** Changing a class that the officer has verified needs a reason: new admissions, transfers in or out, or a correction. The device asks for it; the server refuses the change without one. The reason is kept with the record and in its history. A class never verified can be corrected without one.
- **The last verified number stays in use.** `verified_learners` keeps the number as last verified. Until the officer checks a change, the term plan counts the class at that number and says so, so a raised enrolment cannot raise the food request before it is checked.

## Data

**Food issued, eaten and in store are different quantities.**
- *Issued* is what the teacher records as taken from the store for the day's meal. Cereals and pulses are weighed; oil and salt are worked out from the ration (5 g and 2 g per learner per meal) for the learners fed.
- *Eaten* is not measured: leftovers and plate waste are not recorded, so the system never claims food issued was eaten.
- *In store* by the records is everything received, minus everything issued, lost or returned. A *store count* is what was actually weighed.

The ration check compares food issued with the ration for the **learners fed**. A difference between the records and a count is an **unexplained stock variance** to look into, not a finding of theft.

**Hard rules and warnings on the device.**
- **Hard rules** stop a record from being saved, and are the same ones the server applies: missing answers, a future date, learners fed above the present count when one is given, food recorded on a day without feeding, and a late entry without a reason.
- **Warnings** are checks against what the device knows, which can be out of date: more fed than enrolled (enrolment may not be updated yet), and more issued or lost than the device's stock balance (a delivery recorded on another device may not have arrived). The teacher sees "Check before saving" and can save anyway.
- **The server is authoritative.** It checks every record against its own complete records and **flags** it for the programme officer to review (`fed_exceeds_enrolled`, `issue_exceeds_stock`, `usage_far_from_ration`), keeping the record as entered. Two devices that each issue within their own balance, but together exceed the store, are caught this way.

**Device (IndexedDB, Dexie version 8)**

| Table | Contents |
|---|---|
| `enrolment`, `dailyFeeding` | Editable records: one per class and sex per term, and one per school day. Each has `version`, `serverId` once synced, and `syncStatus` (`pending`, `synced`, `conflict`, `held`). A term with no enrolment yet opens filled in from the school's last term, for staff to check against the register and save. Into a new school year every learner moves up a class, Grade 9 leaves, and PP1 is left for new admissions. |
| `stockMovements`, `stockCounts` | Append-only stock entries (deliveries, purchases, losses, returns, reversals; store counts), keyed by an id made on the device |
| `syncQueue` | One entry per change: entity type, operation, payload, `baseVersion`, status, retry count |
| `conflicts` | Conflicts the server reported for this device's changes, until they are resolved |
| `terms`, `calendarEvents`, `schoolSettings`, `syncCursors` | The school calendar and ration from the last download, and the download cursor |

**Server (PostgreSQL)**

| Table | Contents |
|---|---|
| `schools`, `users`, `devices` | Schools with county, sub-county, programme type (food delivered or a cash transfer) and ration; accounts with role and sub-county; approved school devices |
| `school_terms`, `calendar_events` | Term dates and half-terms; national holidays and exams; a school's own closures |
| `enrolment`, `daily_feeding` | Versioned records, one per natural key, with who captured each, on which device, when it was captured and received, its sync batch, and a late-entry reason |
| `stock_movements`, `stock_counts` | The append-only ledger: database triggers refuse any update or delete, and a correction is a reversing entry. The view `stock_flows` turns the ledger and the daily issues into one stream of kilograms in and out |
| `record_history`, `record_flags` | Every saved version; flags for records worth checking (never blocking) |
| `sync_batches`, `sync_operations` | Each sync request, and every operation received with its outcome (for idempotent replay) |
| `conflicts`, `held_operations` | Changes kept for a person to decide, with the decision and the transaction that made it |
| `review_runs`, `review_items`, `review_decisions` | Each sub-county's weekly ranking with its reasons, and officers' decisions |

## Synchronisation

Version-based optimistic concurrency for editable records, an append-only ledger for stock, and a pull channel so every device at a school ends with the same records. Not a CRDT: these are counts that feed payments and audits, a school has one or two devices, and when two versions differ a person should decide; an automatic merge would produce numbers nobody entered.

**Sending (device → server).**

1. Saving writes to IndexedDB and queues an operation. A new record has `baseVersion` 0; an edit carries the version it was made on.
2. The device sends its queue 5 s after the connection returns, when the app is opened or brought back into view, and when someone presses Sync now; while records are still waiting it retries after 5 s, 15 s, 30 s, 1, 2 and 5 minutes. A dropped connection never counts as a failed attempt.
3. Each request is one sync batch. The server handles each operation in its own transaction:
   - an operation id it has already applied is answered from `sync_operations`, so a resend after a lost reply is not applied twice;
   - an editable record whose `baseVersion` matches is saved as the next version; one made on an older version is a **conflict**, unless its numbers already match the server's;
   - a new record for a key that already exists (the same day recorded on two devices) is the same record if the numbers match, and a conflict if they differ;
   - except that two copies differing only where one left an optional field empty (learners present, the reason, the note) are **merged** without a conflict. Each such field takes the value that was given, the merge must still be a valid record, and it is saved as a new version in the record's history. The device is sent back the fields it did not have, so its copy matches. Learners fed, food issued and whether feeding happened are never empty, so a difference in any of them, or two different notes, is still a conflict for a person to decide;
   - a stock entry is added once, whatever order entries arrive in. A delivery with the same delivery note, school and commodity as a delivery still counting in the ledger is **held** as a possible duplicate instead, so food entered by both the cook and the head teacher is not counted twice;
   - a record captured by someone since deactivated, or on a device since removed, is **held** too.
4. While a record is in conflict, later edits to it wait on the device, so nothing overwrites a decision that has not been made.

**Downloading (server → device).** After each sync the device asks for its school's changes since its cursor (`GET /api/sync/changes`). The cursor is a PostgreSQL transaction id (`xid8`). Each saved row is stamped with the id of the transaction that wrote it (a trigger, using `pg_current_xact_id()`). A download runs in one `REPEATABLE READ` snapshot and returns the rows stamped from the device's cursor up to, but not including, that snapshot's `xmin`: **the oldest transaction still running when the download started**. The next cursor is that `xmin`.

Why this cannot permanently miss a committed change, even when transactions start and commit in a different order:
- Every transaction with an id below `xmin` had finished (committed or rolled back) before the snapshot was taken. So every committed row in the returned range is visible to the download, and rolled-back rows never are.
- A transaction still running has an id at or above `xmin`, so the cursor never moves past it. Its rows are sent in a later download, once it commits.
- The cost is that a transaction left open holds the cursor back. Rows saved after it may be sent again in the next downloads, but the device ignores a version it already has, so a repeat changes nothing.
- A cursor based on the **newest** transaction id, or on a timestamp, *could* miss a slow save. That is why `xmin` is used.
- `xid8` includes the epoch, so it does not wrap around.

Tests cover a save that commits after a later one, a save left open across several downloads, a rolled-back save, a device catching up after missing several edits (it gets only the latest version), and a repeated download (`backend/tests/syncChanges.test.js`). Rows are never deleted from the synced tables (the stock ledger is append-only, and a discarded held record travels as a decision), so a cursor of changed rows is enough.

The same download carries conflicts resolved and held records decided since the cursor:
- a resolved conflict closes the device's copy; if the device's version was kept, the edits waiting behind it are re-based on the new version;
- a discarded held record leaves the device: a stock entry is removed (so it leaves the balance), and an editable record takes the server's copy.

A delivery held as a possible duplicate is left out of the device's stock balance while it waits, and the Stock page says why.

**Measured.** The sync evaluation runs the PWA's own code on simulated devices against the real API, on good, slow and flaky networks, and checks every record on the server and on each device: success rate, conflict detection accuracy, latency, and whether the devices converge ([sync-evaluation.md](sync-evaluation.md)).

## Conflicts and held records

A conflict happens on a school's device; the programme officer for that school's sub-county resolves it from the server's list, on their own laptop. They see the device's values beside the server's and choose:

- **Keep the server's version:** the device's change is dropped.
- **Keep the device's version:** applied as a new version.
- **Enter the correct numbers:** for example after phoning the school; checked like any other record. For a feeding record this is offered when both versions say learners were fed.

The server refuses a decision if the record changed again since the conflict was recorded, so a decision is always made on current data. Every decision is a new version in the record's history, with the person's name; earlier versions are kept. The school's devices get the decision with their next download.

Held records (possible duplicate deliveries, records from deactivated users or removed devices) wait under Conflicts → Held records for the school's programme officer (or an administrator) to apply, keeping the original author, or discard. The school's devices get the decision with their next download.

## Monitoring

**Analytics** (`GET /api/analytics/term`) show each school's term so far: school days recorded against the calendar, learners fed against enrolment, food issued against the ration, days of cereals left by the ledger, the first delivery and any shortfall against the delivery notes, and how far behind its synced records are (counted to the term's last day, so schools are not "behind" in the holidays). Figures outside stated rules are marked for a look.

**Weekly review list.** For a sub-county and week, the API gathers the sub-county's records (`backend/src/services/reviewInputs.js`) and sends them to the scoring service, which:

1. builds context-adjusted features per school-day (learners fed against what is usual for that kind of day, against peers, against last term; food against the ration; store-count gaps; how late records were entered and how many in one sitting (not when they synced, so an outage is not evidence); round numbers; after-hours entry);
2. fits Extended Isolation Forest on the sub-county's previous 125 school days, refitting every 20 school days and leaving out school-weeks an officer marked follow-up;
3. scores the week, takes each school's highest day, and lists up to 3 above a review threshold (more unusual than 98% of the training window's school-weeks, so a quiet week can list none), with their two main reasons in plain words, always worded "needs review";
4. ranks by fixed rules alone while a sub-county has fewer than 60 school days of records, and then lists only schools that broke a rule, so a quiet week lists nobody.

A school listed again shows the officer's latest decision on it from the previous four weeks.

**Scored without a button.** Every hour the API checks each sub-county's last four finished weeks (Monday to Sunday, in the schools' time zone) and scores a week that:
- has feeding records but has never been scored, or
- has had a feeding record or store count saved or changed since it was last scored, for example records that synced late or a conflict decided since.

So each officer finds last week's list ready on Monday morning, and a late school is still ranked with its records ([`weeklyReviewSchedule.js`](../backend/src/services/weeklyReviewSchedule.js)). A database lock keeps passes from overlapping. A week that fails, for example because the scoring service is down, is tried again on the next pass. Officers can still score the week in progress, or score a week again, from the page. The page says whether a list was scored automatically or by whom. `REVIEW_SCHEDULE=off` turns the schedule off.

The officer marks each listed school's week explained or follow-up, with a note. The method and its settings were chosen in a pre-registered evaluation; see [anomaly-detection.md](anomaly-detection.md).

## Sign-in and record integrity

**Administrator passkeys (#57) and authenticator app codes (#63).** Administrators sign in with a WebAuthn passkey (the server stores only the public key), or with a password and a 6-digit code from an authenticator app. Ten one-time recovery codes cover a lost device. Once an account has a passkey, the password alone is refused.

**School devices and staff PINs (#60).** Staff record on designated school devices. An administrator creates the account and gets a one-time activation code; on the device the staff member chooses a password and a 6-digit PIN, and the browser creates a non-extractable P-256 key pair. An administrator approves the device. Staff sign in with email and PIN, and the server checks the PIN and the device's signature over a fresh challenge, so sign-in needs both the enrolled device and the PIN. Removing a device ends its sessions at once.

**Email, and knowing a device is approved.** The email address is the sign-in name. Identity is proved by the one-time activation code and the device's approval, and no password reset or recovery ever goes through email, so an address alone cannot give anyone access.
- **Activation codes go by email and are never shown to the administrator.** A new feeding teacher's code is emailed to their address (`SMTP_HOST`). Only the owner of the address can activate the account, and using an emailed code marks the address **verified** (`users.email_verified_at`, migration 019). The administrator checks that the account is for the right teacher and school; email only proves control of the inbox.
- **Codes:** 12 characters from a cryptographic random source, single-use, valid for 48 hours, stored only as a bcrypt hash, and never logged or returned by the API after an email. A new code cancels the old one, and a code stops working after 5 wrong tries (migration 021).
- **If the email fails, or the server has no email,** the account waits for activation. The administrator sees the delivery state in the accounts list and can **Email a new code**.
- **Handing a code over in person** is a separate, deliberate action for a teacher who cannot get email. The administrator writes why and how ("No email access; given at the sub-county office"), and the note, who did it and when are kept in the account's history (`account_events`). The code is shown once and the address stays unverified. It is not a fallback that happens by itself.
- **Every email is recorded** (`email_deliveries`): *queued*, *failed* (with the reason) or *accepted*. Accepted means the provider took the message, not that it arrived or was read, and the app never says "delivered". Logs record only that a send failed, never the address, the message or a code.
- **Knowing a device is approved.** A device waiting for approval asks `POST /api/devices/status` every 15 seconds while its screen is open and online. This is application-specific polling, similar to the polling in the OAuth device authorization grant (RFC 8628), not an implementation of that protocol. It stops when the device is approved, removed or expired, goes offline, or the screen closes. For an expired set-up the server answers 410 and refuses to answer again. After a check that gets no answer it waits twice as long, up to 2 minutes. The device ID is a random 122-bit UUID, so the answer gives only the status. The waiting screen changes to "You are set up" as soon as it is approved.
- **The approval email is only a notice.** It is sent after the approval is saved and answered, only to staff on the device whose address is verified, and holds no password, PIN, code or key. A failed one is recorded, never undoes the approval, and the administrator can send it again from the device list without approving again.

**What the device key and the PIN protect, stated carefully.**
- The device key is a P-256 key the browser creates with WebCrypto as **non-extractable**: the browser refuses to export it, so the app cannot read or send it. It is not proven to be held in secure hardware; it lives in the browser's storage for this site.
- **The key and the PIN are two separate factors, both checked by the server.** The key proves the request comes from the approved device; the PIN proves which person is using it. The PIN does not encrypt or unlock the key. Online, five wrong PINs lock that person on that device until an administrator unlocks them, and this is enforced by the server.
- **Offline,** the PIN is checked against a PBKDF2 hash kept on the device (600,000 iterations), with a lock after five wrong tries. Someone who copied the browser's storage could try every 6-digit PIN against that hash on another computer. The harm is limited: offline sign-in only allows recording, and every offline record is checked again by the server at sync (the person and device must still be active), and names who captured it.
- Administrator passkeys are WebAuthn credentials: the server stores only the public key, and the private key stays with the person's authenticator (a phone or laptop screen lock, a security key, or a password manager that may sync it to the cloud).

**What happens when …**

| Event | Result |
|---|---|
| The browser's storage for Lishe is cleared, or the device is reset | The device key, offline sign-in and **any records not yet synced are lost**. The device must be set up again and approved as a new device. Records already synced are safe on the server. |
| A device is lost or stolen | An administrator removes it: its sessions end at once, it can no longer sign in or sync, and records it sends afterwards are held for review. Records not yet synced are lost with it. |
| A device is set up but not approved within 14 days | Its set-up **expires** (`DEVICE_PENDING_DAYS`, 14 by default, counted from when it was set up). It can no longer be approved, ask whether it is approved, or sign anyone in, and it tells the teacher to set it up again. Setting it up again makes a **new registration** with a new key, which waits for approval as usual; the expired one stays in the device list, with when it expired, as a record. Approved devices never expire; they are only ever removed. |
| The 7-day offline period runs out | Offline sign-in stops until the person signs in online once. Records already saved stay on the device and sync when someone signs in. |
| A person is deactivated | They cannot sign in; records they captured offline and sync afterwards are held for review. |

**Offline sign-in and who captured each record (#61).** A staff member who has signed in online on a device can sign in there offline for up to 7 days (PBKDF2 hash of the PIN, 600,000 iterations). Every queued record carries who captured it, on which device and when, and the server decides per record: applied if the signed-in user captured it; deferred if a colleague on the same device did, until that colleague syncs; held if the person was deactivated or the device removed since.

**Record integrity (#62).** Each record keeps who captured it, on which device, when it was captured and received, and its sync batch, and every version goes into `record_history`. Records more than 3 school days old need a reason. After each save the server raises flags for records worth checking: captured outside school hours, entered late, kept offline for long, more learners fed than enrolled, food far from the ration, more issued than the store held, a delivery short of its note. Flags never block a record; the school's programme officer (or an administrator) checks each under Record review and notes what they found.

## Folder roles

| Folder | Role |
|--------|------|
| `frontend/` | React PWA: school screens, officer and admin screens, Dexie database, sync client, tests, sync evaluation |
| `backend/` | Express API: routes, controllers, validation, auth, sync, analytics, review lists, tests, demo loader |
| `forecasting/` | Scoring service, anomaly features and methods, synthetic dataset generator, evaluation scripts and reports, tests |
| `database/` | `schema.sql`, `calendar_kenya.sql`, `seed.sql`, `migrations/` |
| `docs/` | Architecture, deployment, anomaly detection, sync evaluation and dataset documentation |
