import db from '../db/database';
import { getOrCreateClientId } from '../db/database';
import { resolveConflict as apiResolveConflict, getConflicts as apiGetConflicts } from '../services/api';

/**
 * Conflict Service for Phase 7
 * Handles conflict storage, retrieval, and resolution
 */

/**
 * Save a conflict to the local database
 */
export async function saveConflict(conflictData) {
  try {
    const now = new Date().toISOString();
    
    const conflict = {
      operationId: conflictData.operationId,
      entityType: conflictData.entityType,
      recordId: conflictData.recordId,
      baseVersion: conflictData.baseVersion,
      serverVersion: conflictData.serverVersion,
      localPayload: conflictData.localPayload,
      serverRecord: conflictData.serverRecord,
      conflictId: conflictData.conflictId,
      status: conflictData.status || 'unresolved',
      createdAt: now,
      resolvedAt: null,
      resolution: null
    };
    
    // Check if conflict already exists for this operation
    const existing = await db.conflicts.where('operationId').equals(conflictData.operationId).first();
    
    if (existing) {
      // Update existing conflict
      await db.conflicts.update(existing.id, conflict);
      return { ...existing, ...conflict };
    } else {
      // Add new conflict
      const id = await db.conflicts.add(conflict);
      return { id, ...conflict };
    }
  } catch (error) {
    console.error('Error saving conflict:', error);
    throw new Error('Failed to save conflict');
  }
}

/**
 * Get all unresolved conflicts from local database
 */
export async function getUnresolvedConflicts() {
  try {
    return await db.conflicts
      .where('status')
      .equals('unresolved')
      .reverse()
      .sortBy('createdAt');
  } catch (error) {
    console.error('Error getting unresolved conflicts:', error);
    throw new Error('Failed to retrieve unresolved conflicts');
  }
}

/**
 * Get all conflicts from local database
 */
export async function getAllConflicts() {
  try {
    return await db.conflicts.reverse().sortBy('createdAt');
  } catch (error) {
    console.error('Error getting all conflicts:', error);
    throw new Error('Failed to retrieve conflicts');
  }
}

/**
 * Get a specific conflict by operation ID
 */
export async function getConflictByOperationId(operationId) {
  try {
    return await db.conflicts.where('operationId').equals(operationId).first();
  } catch (error) {
    console.error('Error getting conflict by operation ID:', error);
    throw new Error('Failed to retrieve conflict');
  }
}

/**
 * Get a specific conflict by local ID
 */
export async function getConflictById(id) {
  try {
    return await db.conflicts.get(id);
  } catch (error) {
    console.error('Error getting conflict by ID:', error);
    throw new Error('Failed to retrieve conflict');
  }
}

/**
 * Get conflict statistics
 */
export async function getConflictStats() {
  try {
    const allConflicts = await db.conflicts.toArray();
    
    const stats = {
      total: allConflicts.length,
      unresolved: 0,
      resolved: 0
    };
    
    allConflicts.forEach(conflict => {
      if (conflict.status === 'unresolved') {
        stats.unresolved++;
      } else if (conflict.status === 'resolved') {
        stats.resolved++;
      }
    });
    
    return stats;
  } catch (error) {
    console.error('Error getting conflict stats:', error);
    throw new Error('Failed to get conflict statistics');
  }
}

/**
 * Resolve a conflict by calling the backend API
 */
export async function resolveConflictOnServer(conflictId, resolution) {
  try {
    const clientId = await getOrCreateClientId();
    
    const response = await apiResolveConflict(conflictId, {
      resolution,
      clientId
    });
    
    return response;
  } catch (error) {
    console.error('Error resolving conflict on server:', error);
    throw error;
  }
}

/**
 * Process conflict resolution - handles both server and local updates
 */
export async function resolveConflict(localConflictId, resolution) {
  try {
    // Get the local conflict record
    const conflict = await getConflictById(localConflictId);
    if (!conflict) {
      throw new Error('Conflict not found locally');
    }
    
    // Call server to resolve the conflict
    const serverResponse = await resolveConflictOnServer(conflict.conflictId, resolution);
    
    if (!serverResponse.success) {
      throw new Error(serverResponse.message || 'Failed to resolve conflict on server');
    }
    
    // Update local conflict record
    await markConflictResolved(localConflictId, resolution, serverResponse.version);
    
    // Update the associated local record based on resolution
    if (resolution === 'keep_server') {
      // Update local record with server version
      await updateLocalRecordAfterResolution(conflict, serverResponse.record);
    } else if (resolution === 'keep_local') {
      // Update local record with new server version
      await updateLocalRecordAfterResolution(conflict, serverResponse.record);
    }
    
    // Mark the associated sync queue operation as resolved
    await markSyncOperationResolved(conflict.operationId);
    
    return {
      success: true,
      resolution: resolution,
      version: serverResponse.version,
      record: serverResponse.record
    };
  } catch (error) {
    console.error('Error processing conflict resolution:', error);
    throw error;
  }
}

/**
 * Update local record after conflict resolution
 */
async function updateLocalRecordAfterResolution(conflict, serverRecord) {
  try {
    if (conflict.entityType === 'attendance') {
      const { updateLocalAttendance } = await import('../services/localDb');
      await updateLocalAttendance(conflict.recordId, {
        syncStatus: 'synced',
        version: serverRecord.version,
        totalRegistered: serverRecord.total_registered,
        totalPresent: serverRecord.total_present,
        totalAbsent: serverRecord.total_absent,
        skipSyncQueue: true
      });
    } else if (conflict.entityType === 'mealDistribution') {
      const { updateLocalMeal } = await import('../services/localDb');
      await updateLocalMeal(conflict.recordId, {
        syncStatus: 'synced',
        version: serverRecord.version,
        mealsPrepared: serverRecord.meals_prepared,
        mealsServed: serverRecord.meals_served,
        skipSyncQueue: true
      });
    }
  } catch (error) {
    console.error('Error updating local record after resolution:', error);
  }
}

/**
 * Mark sync operation as resolved
 */
async function markSyncOperationResolved(operationId) {
  try {
    const { markOperationSynced } = await import('./syncQueue');
    await markOperationSynced(operationId);
  } catch (error) {
    console.error('Error marking sync operation as resolved:', error);
  }
}

/**
 * Mark a conflict as resolved in the local database
 */
export async function markConflictResolved(localConflictId, resolution, serverVersion) {
  try {
    const now = new Date().toISOString();
    
    await db.conflicts.update(localConflictId, {
      status: 'resolved',
      resolution: resolution,
      resolvedAt: now,
      serverVersion: serverVersion
    });
    
    return true;
  } catch (error) {
    console.error('Error marking conflict as resolved:', error);
    throw new Error('Failed to mark conflict as resolved');
  }
}

/**
 * Delete a resolved conflict from local database
 */
export async function deleteConflict(localConflictId) {
  try {
    await db.conflicts.delete(localConflictId);
    return true;
  } catch (error) {
    console.error('Error deleting conflict:', error);
    throw new Error('Failed to delete conflict');
  }
}

/**
 * Clear all resolved conflicts from local database
 */
export async function clearResolvedConflicts() {
  try {
    await db.conflicts.where('status').equals('resolved').delete();
    return true;
  } catch (error) {
    console.error('Error clearing resolved conflicts:', error);
    throw new Error('Failed to clear resolved conflicts');
  }
}

/**
 * Fetch conflicts from server for a specific client
 */
export async function fetchServerConflicts(clientId) {
  try {
    const response = await apiGetConflicts({ clientId, status: 'unresolved' });
    return response.conflicts || [];
  } catch (error) {
    console.error('Error fetching server conflicts:', error);
    throw error;
  }
}

/**
 * Sync server conflicts to local database
 */
export async function syncServerConflictsToLocal(clientId) {
  try {
    const serverConflicts = await fetchServerConflicts(clientId);
    
    for (const serverConflict of serverConflicts) {
      // Check if conflict already exists locally
      const existing = await db.conflicts
        .where('conflictId')
        .equals(serverConflict.conflict_id)
        .first();
      
      const conflictData = {
        operationId: serverConflict.operation_id,
        entityType: serverConflict.entity_type,
        recordId: serverConflict.record_id,
        baseVersion: serverConflict.base_version,
        serverVersion: serverConflict.server_version,
        localPayload: serverConflict.local_payload,
        serverRecord: serverConflict.server_payload,
        conflictId: serverConflict.conflict_id,
        status: serverConflict.status,
        createdAt: serverConflict.created_at,
        resolvedAt: serverConflict.resolved_at,
        resolution: serverConflict.resolution
      };
      
      if (existing) {
        // Update existing conflict
        await db.conflicts.update(existing.id, conflictData);
      } else {
        // Add new conflict
        await db.conflicts.add(conflictData);
      }
    }
    
    return { success: true, count: serverConflicts.length };
  } catch (error) {
    console.error('Error syncing server conflicts to local:', error);
    throw error;
  }
}
