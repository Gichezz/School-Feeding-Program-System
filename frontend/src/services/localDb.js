import { db, getOrCreateClientId } from '../db';

/**
 * Schools caching functions for offline operation
 */

/**
 * Cache schools in local database
 */
export async function cacheSchools(schools) {
  try {
    // Use bulkPut instead of bulkAdd to handle existing records gracefully
    // bulkPut will update existing records and add new ones
    await db.schools.bulkPut(schools);
    return true;
  } catch (error) {
    console.error('Error caching schools:', error);
    // If bulkPut fails, try clearing and adding
    try {
      await db.schools.clear();
      await db.schools.bulkAdd(schools);
      return true;
    } catch (fallbackError) {
      console.error('Fallback school caching also failed:', fallbackError);
      return false;
    }
  }
}

/**
 * Get cached schools from local database
 */
export async function getCachedSchools() {
  try {
    return await db.schools.toArray();
  } catch (error) {
    console.error('Error getting cached schools:', error);
    return [];
  }
}

/**
 * Get a specific school by ID from cache
 */
export async function getCachedSchoolById(id) {
  try {
    return await db.schools.get(id);
  } catch (error) {
    console.error('Error getting cached school:', error);
    return null;
  }
}

/**
 * Local database service functions for attendance operations
 * These functions interact with Dexie/IndexedDB for offline persistence
 */

/**
 * Get all attendance records from local database
 */
export async function getLocalAttendance() {
  try {
    return await db.attendance.toArray();
  } catch (error) {
    console.error('Error getting local attendance records:', error);
    throw new Error('Failed to retrieve local attendance records');
  }
}

/**
 * Get attendance record by ID from local database
 */
export async function getLocalAttendanceById(id) {
  try {
    return await db.attendance.get(id);
  } catch (error) {
    console.error('Error getting local attendance record:', error);
    throw new Error('Failed to retrieve local attendance record');
  }
}

/**
 * Save attendance record to local database
 * Adds client ID, version, timestamp, and sync status
 */
export async function saveLocalAttendance(attendanceData) {
  try {
    const clientId = await getOrCreateClientId();
    const now = new Date().toISOString();
    
    const record = {
      ...attendanceData,
      clientId,
      version: 1,
      updatedAt: now,
      syncStatus: 'pending',
      createdAt: now
    };
    
    const id = await db.attendance.add(record);
    return { ...record, id };
  } catch (error) {
    console.error('Error saving local attendance record:', error);
    throw new Error('Failed to save attendance record locally');
  }
}

/**
 * Update attendance record in local database
 */
export async function updateLocalAttendance(id, updates) {
  try {
    const existing = await db.attendance.get(id);
    if (!existing) {
      throw new Error('Attendance record not found');
    }
    
    const updatedRecord = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending'
    };
    
    await db.attendance.update(id, updatedRecord);
    return updatedRecord;
  } catch (error) {
    console.error('Error updating local attendance record:', error);
    throw new Error('Failed to update attendance record locally');
  }
}

/**
 * Delete attendance record from local database
 */
export async function deleteLocalAttendance(id) {
  try {
    await db.attendance.delete(id);
    return true;
  } catch (error) {
    console.error('Error deleting local attendance record:', error);
    throw new Error('Failed to delete attendance record locally');
  }
}

/**
 * Local database service functions for meal distribution operations
 */

/**
 * Get all meal distribution records from local database
 */
export async function getLocalMeals() {
  try {
    return await db.mealDistribution.toArray();
  } catch (error) {
    console.error('Error getting local meal records:', error);
    throw new Error('Failed to retrieve local meal records');
  }
}

/**
 * Get meal distribution record by ID from local database
 */
export async function getLocalMealById(id) {
  try {
    return await db.mealDistribution.get(id);
  } catch (error) {
    console.error('Error getting local meal record:', error);
    throw new Error('Failed to retrieve local meal record');
  }
}

/**
 * Save meal distribution record to local database
 * Adds client ID, version, timestamp, and sync status
 */
export async function saveLocalMeal(mealData) {
  try {
    const clientId = await getOrCreateClientId();
    const now = new Date().toISOString();
    
    const record = {
      ...mealData,
      clientId,
      version: 1,
      updatedAt: now,
      syncStatus: 'pending',
      createdAt: now
    };
    
    const id = await db.mealDistribution.add(record);
    return { ...record, id };
  } catch (error) {
    console.error('Error saving local meal record:', error);
    throw new Error('Failed to save meal record locally');
  }
}

/**
 * Update meal distribution record in local database
 */
export async function updateLocalMeal(id, updates) {
  try {
    const existing = await db.mealDistribution.get(id);
    if (!existing) {
      throw new Error('Meal record not found');
    }
    
    const updatedRecord = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending'
    };
    
    await db.mealDistribution.update(id, updatedRecord);
    return updatedRecord;
  } catch (error) {
    console.error('Error updating local meal record:', error);
    throw new Error('Failed to update meal record locally');
  }
}

/**
 * Delete meal distribution record from local database
 */
export async function deleteLocalMeal(id) {
  try {
    await db.mealDistribution.delete(id);
    return true;
  } catch (error) {
    console.error('Error deleting local meal record:', error);
    throw new Error('Failed to delete meal record locally');
  }
}
