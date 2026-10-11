import 'fake-indexeddb/auto';
import { beforeEach, vi } from 'vitest';
import db from '../db/database';

// Node has no localStorage; provide a simple in-memory one for the session store
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(async () => {
  // Start every test with an empty local database and no session
  await Promise.all(db.tables.map((table) => table.clear()));
  localStorage.clear();
  // The sync modules log every step; keep test output readable
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
