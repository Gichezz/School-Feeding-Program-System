import 'fake-indexeddb/auto';
import { beforeEach, vi } from 'vitest';
import db from '../db/database';

beforeEach(async () => {
  // Start every test with an empty local database
  await Promise.all(db.tables.map((table) => table.clear()));
  // The sync modules log every step; keep test output readable
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
