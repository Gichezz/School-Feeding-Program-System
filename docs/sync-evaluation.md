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

**The app's own timings apply.** After reconnecting, the app waits 5 s and then sends its queue once. An operation whose request fails is retried at the next sync and marked failed after 3 retries. In the scenarios, users press "Sync now" at most 3 times when records are left over.

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

## 4. Results (first run)

| Scenario | Records | On the server, correct | Missing | Applied twice | Stuck as failed | Median latency | 95th percentile |
|---|---|---|---|---|---|---|---|
| Good connection | 60 | 60 (100%) | 0 | 0 | 0 | 6.5 s | 7.7 s |
| Slow connection | 60 | 60 (100%) | 0 | 0 | 0 | 17.4 s | 28.5 s |
| Flaky connection | 60 | 59 (98.3%) | 1 | 0 | 1 | 9.6 s | 18.0 s |

On the flaky connection, the automatic sync delivered 39 of the 60 records; "Sync now" was needed three times to deliver 19 more, and 1 record was left marked failed. Two responses were lost after the server had applied the change; both were sent again and recognised by their operation id, so nothing was applied twice.

| | Conflict reported | No conflict reported |
|---|---|---|
| **Real conflict** | 12 (true positives) | 0 (false negatives) |
| **No real conflict** | 6 (false positives) | 42 (true negatives) |

Accuracy 90.0%, precision 66.7%, recall 100%. Every real conflict was caught, and no record was overwritten: when a conflict is reported, the server keeps the first device's numbers until an administrator decides. All 6 false positives come from one case: both devices changing a record to the **same** numbers.

## 5. Findings

1. **A record can be stranded on a flaky connection.** A request that never gets a response counts as a failed attempt; after 3 the operation is marked failed and never sent again, although the Sync Status page says failed records are retried automatically. The app also does not retry on its own while online: records left after the automatic sync wait until someone presses "Sync now".
2. **Identical changes are reported as conflicts.** When two devices change a record to the same numbers, the second change is based on an older version, so it is reported as a conflict although there is nothing to decide. It adds work for administrators but loses no data.

Both are being fixed, after which the evaluation is run again and the results compared.

## 6. Running it

```bash
cd frontend
npm run evaluate:sync
```

It needs PostgreSQL with the connection settings in `backend/.env`, and the backend's and frontend's packages installed. It creates its own database (`school_feeding_sync_evaluation`) and API server on port 5065, removes both at the end, and takes about 70 seconds.

## 7. Limitations

- The network is simulated in each device process (delays and losses on whole requests). Real networks also vary in ways this does not model, such as very long interruptions in the middle of a sync.
- Devices sign in as the seeded administrator, because staff sign-in needs an enrolled device with a hardware-backed key (#60). Sync treats both roles the same way, so this does not change the results.
- Everything runs on one machine, so the latencies show the effect of the app's behaviour and the network profile, not of a real server's distance or load.
