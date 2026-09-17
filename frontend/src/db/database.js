import Dexie from 'dexie';

/**
 * SchoolFeedingDB - Local IndexedDB database for offline-first functionality
 * Uses Dexie.js as an abstraction layer over IndexedDB
 */
class SchoolFeedingDB extends Dexie {
  constructor() {
    super('SchoolFeedingDB');
    
    // Define database schema with versioning
    // Version 1: Complete schema with all tables including schools
    this.version(1).stores({
      attendance: '++id, schoolId, attendanceDate, syncStatus, clientId, updatedAt',
      mealDistribution: '++id, schoolId, distributionDate, syncStatus, clientId, updatedAt',
      schools: 'id, name',
      metadata: 'key, value'
    });
  }
}

const db = new SchoolFeedingDB();

/**
 * Generate a UUID v4 for client identification
 * Uses a simple implementation that doesn't require external dependencies
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Get or create the client ID for this browser installation
 * The client ID is stored in the metadata table and persists across sessions
 */
export async function getOrCreateClientId() {
  try {
    const clientEntry = await db.metadata.get('clientId');
    if (clientEntry) {
      return clientEntry.value;
    }
    
    // Generate and store a new client ID
    const clientId = generateUUID();
    await db.metadata.put({ key: 'clientId', value: clientId });
    return clientId;
  } catch (error) {
    console.error('Error getting/creating client ID:', error);
    // Fallback: generate a temporary client ID if database is unavailable
    return generateUUID();
  }
}

/**
 * Get metadata value by key
 */
export async function getMetadata(key) {
  try {
    const entry = await db.metadata.get(key);
    return entry ? entry.value : null;
  } catch (error) {
    console.error(`Error getting metadata for key ${key}:`, error);
    return null;
  }
}

/**
 * Set metadata value by key
 */
export async function setMetadata(key, value) {
  try {
    await db.metadata.put({ key, value });
    return true;
  } catch (error) {
    console.error(`Error setting metadata for key ${key}:`, error);
    return false;
  }
}

export default db;

/**
 * Reset the database - delete and recreate
 * Use this if there are schema conflicts
 */
export async function resetDatabase() {
  try {
    await db.delete();
    console.log('Database deleted successfully');
    // The page will need to be reloaded to recreate the database
    return true;
  } catch (error) {
    console.error('Error deleting database:', error);
    return false;
  }
}
