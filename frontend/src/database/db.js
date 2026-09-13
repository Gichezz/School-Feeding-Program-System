import Dexie from 'dexie';

/**
 * Local IndexedDB database via Dexie.js.
 * Tables and sync queue schema will be expanded in later phases.
 * This file only establishes the offline storage foundation.
 */
class SchoolFeedingDB extends Dexie {
  constructor() {
    super('SchoolFeedingDB');

    // Version 1: placeholder stores for architecture setup only.
    this.version(1).stores({
      // Local copies of domain records (fields refined later)
      students: 'id, updatedAt, version',
      attendance: 'id, studentId, date, updatedAt, version',
      mealDistributions: 'id, studentId, date, updatedAt, version',

      // Offline synchronization queue (logic implemented in a later phase)
      syncQueue:
        '++localId, operationId, entityType, recordId, status, createdAt',
    });
  }
}

export const db = new SchoolFeedingDB();
