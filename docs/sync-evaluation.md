# Synchronisation Evaluation

This evaluation measures the three synchronisation metrics from the project documentation (§3.8.1, Table 3.2): **sync success rate**, **conflict detection accuracy** and **sync latency**, under simulated offline and online network conditions.

Generated results: [`frontend/evaluation/sync/results/sync_evaluation_report.md`](../frontend/evaluation/sync/results/sync_evaluation_report.md) (raw data in `sync_evaluation.json`).

## 1. Method

**The real system, not a model of it.** Each simulated school device is a separate Node.js process that runs the PWA's own modules unchanged: the local database (IndexedDB through Dexie, provided in Node by `fake-indexeddb`), the sync queue, the sync manager with its automatic sync on reconnecting, and the API client. The devices sync with the real Express API and a throwaway PostgreSQL database built from `database/schema.sql` and `seed.sql`. Every device signs in with its own session and has its own client id and local database, as separate phones or tablets would.

**Controlled network.** Each device's network can be switched off (the browser's `fetch` fails and `navigator.onLine` is false) and back on (the browser's `online` event fires), and given a profile:

| Profile | Per request | Requests lost before reaching the server | Responses lost after the server applied the change |
|---|---|---|---|
| Good | 100 ms | – | – |
| Slow (2G-like) | 1.2 s | – | – |
| Flaky | 300 ms | 25% | 10% |

Lost responses are the hardest case: the server has saved the record but the device never hears about it, so it sends it again. Losses use a seeded random number generator, so every run makes the same choices.

**The app's own timings apply.** After reconnecting, the app waits 5 s and then sends its queue. Since #74, while records are still waiting it retries automatically: 5 s after a sync that got some through, then after 15 s, 30 s, 1, 2 and 5 minutes while nothing gets through. A dropped connection does not count as a failed attempt; an operation the server rejects is marked failed after 3 retries. The automatic sync is left alone for up to 3 minutes; users press "Sync now" (at most 3 times) only if records are still waiting after that. (Before #74, the app sent its queue once after reconnecting, counted dropped connections as failed attempts, and never retried on its own.)

**Known answers.** Every scenario has a correct outcome decided in advance, and afterwards the server's database is checked record by record: is each record there, with exactly the numbers the device saved, applied only once (one version in its history)?

## 2. Scenarios

**Offline capture, then reconnecting (success rate and latency).** Three devices each record 10 days of attendance and 10 days of meals while offline (60 records, different days per device, so no conflicts are expected), then reconnect with the good, slow or flaky profile.

**Conflicts with known answers (accuracy).** Two devices, A and B, change records while offline; A always syncs first, so only B's change can be a conflict. Each case runs 6 times on different days, alternating attendance and meals:

| Case | Correct answer for B |
|---|---|
| Both edit the same record, different numbers | Conflict |
| Both edit the same record to the same numbers | No conflict (nothing to decide) |
| The two devices edit different records | No conflict |
| Both record the same new day, different numbers (#70) | Conflict |
| Both record the same new day, same numbers (#70) | No conflict |

A's 30 changes (never conflicts) and B's 30 changes are judged: 60 operations in total.

## 3. Metrics

- **Sync success rate:** records on the server with exactly the numbers the device saved, out of all records captured. Missing records, wrong numbers and records applied more than once are reported separately.
- **Conflict detection accuracy:** accuracy = (TP + TN) / all; precision = TP / (TP + FP), the share of reported conflicts that were real; recall = TP / (TP + FN), the share of real conflicts that were caught.
- **Sync latency:** time from reconnecting until the device receives the server's answer for each record (median and 95th percentile). It includes the app's deliberate 5 s wait after reconnecting.

## 4. Results

The evaluation was run before and after the fixes in #74 (section 5), on the same scenarios with the same seeded network losses.

**Sync success rate and latency**

| Scenario | Records | Correct on the server, before | Correct on the server, after | "Sync now" presses needed, before → after | Median latency, after | 95th percentile, after |
|---|---|---|---|---|---|---|
| Good connection | 60 | 60 (100%) | 60 (100%) | 0 → 0 | 6.4 s | 7.7 s |
| Slow connection | 60 | 60 (100%) | 60 (100%) | 0 → 0 | 17.4 s | 28.5 s |
| Flaky connection | 60 | **59 (98.3%)**, 1 stranded as failed | **60 (100%)** | **3 → 0** | 10.4 s | 28.2 s |

In every run, no record was missing, altered or applied twice. On the flaky connection, 2 responses were lost after the server had applied the change; both records were sent again and recognised by their operation id. Before the fixes, the automatic sync delivered 39 of 60 records there, "Sync now" was needed three times for 19 more, and 1 record was left marked failed, never to be sent again. After the fixes, the app's own retries delivered all 60 with nobody pressing anything. The flaky connection's 95th percentile rose from 18.0 s to 28.2 s because the last records now arrive through the automatic retries; before, they were only measured once someone pressed "Sync now", and one never arrived.

Latency includes the app's deliberate 5 s wait after reconnecting, so on a good connection a record reaches the server about 1.5 s after the sync starts.

**Conflict detection accuracy** (60 judged operations)

| | True positives | False positives | True negatives | False negatives | Accuracy | Precision | Recall |
|---|---|---|---|---|---|---|---|
| Before | 12 | 6 | 42 | 0 | 90.0% | 66.7% | 100% |
| After | 12 | 0 | 48 | 0 | **100%** | **100%** | **100%** |

Every real conflict was caught in both runs, and no record was ever overwritten: when a conflict is reported, the server keeps the first device's numbers until an administrator decides. The 6 false positives before the fix were all the same case: both devices changing a record to the same numbers.

## 5. Findings and fixes

1. **A record could be stranded on a flaky connection** (fixed in #74). A request that never got a response counted as a failed attempt; after 3 the operation was marked failed and never sent again, although the Sync Status page said failed records were retried automatically. The app also did not retry on its own while online. Now a dropped connection (or a gateway error while the server restarts) does not count as an attempt, the app keeps retrying on the schedule in section 1 while records are waiting, and it also syncs when it is opened or comes back into view. Records that older versions marked failed because of the connection are put back in the queue.
2. **Identical changes were reported as conflicts** (fixed in #74). A change based on an older version whose numbers already match the server's is now treated as the same record: it syncs without a conflict and without a new version. Different numbers are still a conflict.

## 5a. Version 2: the school records (plan, written before it was run)

Version 1 covers attendance and meals. The system now records daily feeding and termly enrolment (editable, versioned) and a stock ledger of deliveries, losses and counts (append-only), and school devices download each other's records. Version 2 adds two scenarios on these, with the same devices, network profiles, timings and server checks as above. Version 1's scenarios are run again unchanged.

**Scenario 6: one school, two devices, a week offline (success rate, convergence, duplicate delivery).** A kitchen tablet records 10 school days of daily feeding and one store count; the office phone records the term's enrolment (4 classes × girls and boys), two deliveries (cereals and pulses, one delivery note) and one loss. The kitchen tablet also records the cereals delivery from the same delivery note, as happens when the cook and the head teacher both enter it. Both are offline, then reconnect on the flaky profile. Once the automatic sync has finished, an administrator discards the held duplicate and both devices sync again. Run with the good and the flaky profile.

| Check | Correct answer |
|---|---|
| Each record on the server | exactly once, with the device's values (21 records) |
| The second entry of the delivery note | held as a possible duplicate, never in the ledger |
| Each device after its next download | the same feeding days, enrolment, stock entries and cereal balance as the server |

**Scenario 7: conflicts on daily feeding and enrolment, resolved by the programme officer (accuracy, convergence).** Devices A and B, A syncing first, as in scenario 4, on daily feeding (all five cases) and enrolment (the same class and sex, different counts; and the same counts), 3 repetitions each. Afterwards the programme officer resolves every conflict from the server's list (keeping the server's version) and both devices sync again.

| Check | Correct answer |
|---|---|
| B's changes | a conflict exactly where the two versions differ |
| Each device after resolution and a download | no unresolved conflict left, and its records equal the server's |

**New metric: convergence**, the share of devices whose records (and cereal balance) equal the server's after their next download. Offline-first only works if every device at a school ends up with the same numbers as the server, so this is reported next to the success rate.

## 5b. Version 2 results

Run on the plan above; version 1's scenarios were run again in the same run and gave the same answers as before (all 60 records correct on each network; conflict detection 60 of 60 correct). Full report: [`sync_evaluation_report.md`](../frontend/evaluation/sync/results/sync_evaluation_report.md).

**Scenario 6: one school, two devices, a week offline.** The plan said 21 records; with the store count it is 22.

| Network | On the server, correct | Applied twice | Duplicate note | Devices converged | Cereals: server and each device | Median latency | 95th percentile |
|---|---|---|---|---|---|---|---|
| Good | 22 of 22 | 0 | held, never in the ledger | 2 of 2 | 1,389.5 kg on all three | 6.0 s | 6.7 s |
| Flaky | 22 of 22 | 0 | held, never in the ledger | 2 of 2 | 1,389.5 kg on all three | 8.0 s | 20.9 s |

**Scenario 7: conflicts on daily feeding and enrolment.** 42 operations judged: 9 true positives, 33 true negatives, no false positives or negatives (accuracy, precision and recall 100%), in every case of the table above. The programme officer resolved all 9 conflicts from the server's list, and after their next download both devices held exactly the server's records with no open conflict (2 of 2 converged).

**What the plan itself found.** Writing scenario 6 showed that the same delivery note entered on two devices would have been counted twice, because stock entries never conflict; and that a held record discarded on the server never left the device that sent it. Both were fixed before the run (the second entry of a note is now held; decisions on held records are downloaded). The first full run then reported devices as not converged in two scenarios: the check compared each device's records with the server's as text, which depends on the order records were stored in. Comparing record by record, every device matched; the check was corrected and the evaluation re-run.

## 6. Running it

```bash
cd frontend
npm run evaluate:sync
```

It needs PostgreSQL with the connection settings in `backend/.env`, and the backend's and frontend's packages installed. It creates its own database (`school_feeding_sync_evaluation`) and API server on port 5065, removes both at the end, and takes about 3 minutes.

## 7. Limitations

- The network is simulated in each device process (delays and losses on whole requests). Real networks also vary in ways this does not model, such as very long interruptions in the middle of a sync.
- Devices sign in as the seeded administrator, because staff sign-in needs an enrolled device with a non-extractable WebCrypto key and a PIN (#60). Sync treats both roles the same way, so this does not change the results.
- Everything runs on one machine, so the latencies show the effect of the app's behaviour and the network profile, not of a real server's distance or load.
- Convergence is measured after each device's next sync, which in the app happens when it is opened, brought into view or reconnects. A device nobody opens stays behind until it is opened; analytics show officers how far behind each school's records are.
