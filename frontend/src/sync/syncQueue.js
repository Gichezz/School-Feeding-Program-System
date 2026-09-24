import db from '../db/database';
import { getOrCreateClientId } from '../db/database';

/**
 * Generate a unique operation ID for synchronization
 */
function generateOperationId() {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Add an operation to the sync queue
 */
export async function addToSyncQueue(operation) {
  try {
    const clientId = await getOrCreateClientId();
    const now = new Date().toISOString();
    
    const queueItem = {
      id: generateOperationId(),
      entityType: operation.entityType,
      recordId: operation.recordId,
      operation: operation.operation,
      payload: operation.payload,
      baseVersion: operation.baseVersion || 0,
      clientId,
      createdAt: now,
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: null,
      errorMessage: null
    };
    
    await db.syncQueue.add(queueItem);
    return queueItem;
  } catch (error) {
    console.error('Error adding to sync queue:', error);
    throw new Error('Failed to add operation to sync queue');
  }
}

/**
 * Get all pending operations from the sync queue
 */
export async function getPendingOperations() {
  try {
    return await db.syncQueue
      .where('status')
      .equals('pending')
      .toArray();
  } catch (error) {
    console.error('Error getting pending operations:', error);
    throw new Error('Failed to retrieve pending operations');
  }
}

/**
 * Get operations by status
 */
export async function getOperationsByStatus(status) {
  try {
    return await db.syncQueue
      .where('status')
      .equals(status)
      .toArray();
  } catch (error) {
    console.error('Error getting operations by status:', error);
    throw new Error('Failed to retrieve operations');
  }
}

/**
 * Get all operations from the sync queue
 */
export async function getAllOperations() {
  try {
    return await db.syncQueue.toArray();
  } catch (error) {
    console.error('Error getting all operations:', error);
    throw new Error('Failed to retrieve operations');
  }
}

/**
 * Mark an operation as synced
 */
export async function markOperationSynced(operationId) {
  try {
    await db.syncQueue.update(operationId, {
      status: 'synced',
      lastAttemptAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error marking operation as synced:', error);
    throw new Error('Failed to mark operation as synced');
  }
}

/**
 * Mark an operation as failed
 */
export async function markOperationFailed(operationId, errorMessage) {
  try {
    await db.syncQueue.update(operationId, {
      status: 'failed',
      retryCount: db.syncQueue.get(operationId).then(op => (op?.retryCount || 0) + 1),
      lastAttemptAt: new Date().toISOString(),
      errorMessage
    });
    return true;
  } catch (error) {
    console.error('Error marking operation as failed:', error);
    throw new Error('Failed to mark operation as failed');
  }
}

/**
 * Mark an operation as conflict
 */
export async function markOperationConflict(operationId, conflictData) {
  try {
    await db.syncQueue.update(operationId, {
      status: 'conflict',
      lastAttemptAt: new Date().toISOString(),
      errorMessage: conflictData?.message || 'Version mismatch detected',
      conflictData
    });
    return true;
  } catch (error) {
    console.error('Error marking operation as conflict:', error);
    throw new Error('Failed to mark operation as conflict');
  }
}

/**
 * Increment retry count for an operation
 */
export async function incrementRetryCount(operationId, errorMessage) {
  try {
    const operation = await db.syncQueue.get(operationId);
    if (!operation) {
      throw new Error('Operation not found');
    }
    
    await db.syncQueue.update(operationId, {
      retryCount: (operation.retryCount || 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      errorMessage: errorMessage || operation.errorMessage
    });
    return true;
  } catch (error) {
    console.error('Error incrementing retry count:', error);
    throw new Error('Failed to increment retry count');
  }
}

/**
 * Delete an operation from the sync queue
 */
export async function deleteOperation(operationId) {
  try {
    await db.syncQueue.delete(operationId);
    return true;
  } catch (error) {
    console.error('Error deleting operation:', error);
    throw new Error('Failed to delete operation');
  }
}

/**
 * Clear all operations from the sync queue
 */
export async function clearSyncQueue() {
  try {
    await db.syncQueue.clear();
    return true;
  } catch (error) {
    console.error('Error clearing sync queue:', error);
    throw new Error('Failed to clear sync queue');
  }
}

/**
 * Get sync queue statistics
 */
export async function getSyncQueueStats() {
  try {
    const allOperations = await db.syncQueue.toArray();
    
    const stats = {
      total: allOperations.length,
      pending: 0,
      synced: 0,
      failed: 0,
      conflict: 0
    };
    
    allOperations.forEach(op => {
      stats[op.status] = (stats[op.status] || 0) + 1;
    });
    
    return stats;
  } catch (error) {
    console.error('Error getting sync queue stats:', error);
    throw new Error('Failed to get sync queue statistics');
  }
}
