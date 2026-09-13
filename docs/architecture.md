# Project architecture (Phase 1)

## Overview

Offline-first prototype for one school:

1. **React PWA** captures attendance and meal data locally (IndexedDB via Dexie).
2. **Service Worker** supports offline availability of the app shell.
3. **Sync queue** (designed, not implemented yet) holds offline operations.
4. **Node.js + Express** REST API validates requests and will later apply sync, version checks, and conflict recording.
5. **PostgreSQL** is the authoritative central store.
6. **Python + Flask + Prophet** will later provide meal-demand forecasting using historical data from this system.

## Conflict-resolution approach (designed for later phases)

Version-based protocol (not a full CRDT):

- Each synchronized record carries `version`, `updatedAt`, `clientId`, and operation metadata.
- Offline changes enter a local sync queue with `operationId`, entity type, payload, `baseVersion`, and status.
- On sync: if `baseVersion` matches the server version, apply; otherwise record a conflict for authorized resolution (no silent overwrite).

## Folder roles

| Folder | Role |
|--------|------|
| `frontend/` | React PWA, Dexie, sync stubs |
| `backend/` | Express REST API |
| `forecasting/` | Flask + Prophet (placeholder) |
| `database/` | PostgreSQL schema and seed SQL |
| `docs/` | Design notes |
