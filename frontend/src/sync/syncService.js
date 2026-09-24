import { getOrCreateClientId } from '../db/database';
import { syncOperations as apiSyncOperations } from '../services/api';

/**
 * Synchronization service for Phase 6
 * Handles communication with the backend sync endpoint
 */

export const SYNC_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  FAILED: 'failed',
};

/**
 * Send synchronization operations to the backend
 */
export async function syncOperations(operations) {
  try {
    console.log('syncOperations called with operations:', operations);
    const clientId = await getOrCreateClientId();
    console.log('Client ID:', clientId);
    
    const payload = {
      clientId,
      operations: operations.map(op => ({
        id: op.id,
        entityType: op.entityType,
        recordId: op.recordId,
        operation: op.operation,
        payload: op.payload,
        baseVersion: op.baseVersion,
        createdAt: op.createdAt
      }))
    };
    
    console.log('Sending sync payload:', payload);
    const response = await apiSyncOperations(payload);
    console.log('Sync response:', response);
    
    return response;
  } catch (error) {
    console.error('Error syncing operations:', error);
    throw error;
  }
}

/**
 * Process a single synchronization operation
 */
export async function processSingleOperation(operation) {
  try {
    const response = await syncOperations([operation]);
    
    if (response.success && response.results && response.results.length > 0) {
      const result = response.results[0];
      
      if (result.status === 'synced') {
        return {
          success: true,
          operationId: operation.id,
          recordId: result.recordId,
          version: result.version,
          status: 'synced'
        };
      } else if (result.status === 'conflict') {
        return {
          success: false,
          operationId: operation.id,
          status: 'conflict',
          conflictData: result
        };
      } else {
        return {
          success: false,
          operationId: operation.id,
          status: 'failed',
          error: result.error || 'Unknown error'
        };
      }
    }
    
    return {
      success: false,
      operationId: operation.id,
      status: 'failed',
      error: 'Invalid response from server'
    };
  } catch (error) {
    return {
      success: false,
      operationId: operation.id,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Check if the browser is online
 */
export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Get sync status summary
 */
export async function getSyncStatusSummary() {
  try {
    const response = await apiRequest('/sync/status');
    return response;
  } catch (error) {
    console.error('Error getting sync status:', error);
    return {
      online: isOnline(),
      lastSync: null,
      pendingCount: 0
    };
  }
}
