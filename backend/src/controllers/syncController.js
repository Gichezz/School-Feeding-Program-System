const { pool } = require('../db/pool');
const { ValidationError, DatabaseError, NotFoundError } = require('../utils/errors');
const { isUuid, syncPayloadError } = require('../validation/records');
const { captureError, decideCapture } = require('../services/captureCheck');
const { checkEntryWindow } = require('../validation/entryWindow');
const { afterRecordSaved } = require('../services/integrity');
const clock = require('../utils/clock');

// Upper bound on operations per POST /api/sync (the client sends one at a time)
const MAX_OPERATIONS_PER_REQUEST = 100;

/**
 * Synchronization controller for Phase 6
 * Handles offline synchronization with version checking
 */

/**
 * Process synchronization operations from frontend
 */
async function syncOperations(req, res, next) {
  const client = await pool.connect();
  
  try {
    const { clientId, operations } = req.body;
    // Recorded as updated_by on every record this request writes
    const userId = req.user?.id || null;

    // Validate request structure
    if (!clientId || typeof clientId !== 'string') {
      throw new ValidationError('Client ID is required');
    }

    if (!Array.isArray(operations)) {
      throw new ValidationError('Operations must be an array');
    }

    if (operations.length > MAX_OPERATIONS_PER_REQUEST) {
      throw new ValidationError(`A sync request can contain at most ${MAX_OPERATIONS_PER_REQUEST} operations`);
    }

    if (operations.length === 0) {
      return res.json({
        success: true,
        results: []
      });
    }

    // Validate each operation
    const allowedEntityTypes = ['attendance', 'mealDistribution'];
    const allowedOperations = ['create', 'update'];

    for (const op of operations) {
      if (!op.id || typeof op.id !== 'string') {
        throw new ValidationError('Each operation must have a valid ID');
      }
      if (!op.entityType || !allowedEntityTypes.includes(op.entityType)) {
        throw new ValidationError(`Invalid entity type: ${op.entityType}`);
      }
      if (!op.operation || !allowedOperations.includes(op.operation)) {
        throw new ValidationError(`Invalid operation type: ${op.operation}`);
      }
      if (!op.payload || typeof op.payload !== 'object') {
        throw new ValidationError('Each operation must have a valid payload');
      }
      if (op.baseVersion === undefined || op.baseVersion === null || typeof op.baseVersion !== 'number') {
        throw new ValidationError('Each operation must have a valid baseVersion');
      }
      const invalidPayload = syncPayloadError(op.entityType, op.payload);
      if (invalidPayload) {
        throw new ValidationError(`Operation ${op.id}: ${invalidPayload}`);
      }
      const badCapture = captureError(op);
      if (badCapture) {
        throw new ValidationError(`Operation ${op.id}: ${badCapture}`);
      }
      // Entry window, measured from when the record was captured on the device (#62)
      const recordDate = op.entityType === 'attendance' ? op.payload.attendanceDate : op.payload.distributionDate;
      const entry = checkEntryWindow(recordDate, {
        capturedAt: op.capturedAt ? new Date(op.capturedAt) : undefined,
        lateReason: op.payload.lateReason,
      });
      if (entry.error) {
        throw new ValidationError(`Operation ${op.id}: ${entry.error}`);
      }
      op.late = entry.late;
      // School staff can only send records for their own school (#60)
      if (req.user?.role === 'school_staff' && op.payload.schoolId !== req.user.schoolId) {
        throw new ValidationError(`Operation ${op.id}: you can only record for your own school`);
      }
    }

    // Map frontend entity types to database entity types
    const entityTypeMap = {
      'attendance': 'attendance',
      'mealDistribution': 'meal_distribution'
    };

    const results = [];

    // Process each operation - each gets its own transaction
    for (const operation of operations) {
      await client.query('BEGIN');
      try {
        // Check for idempotency - has this operation already been processed?
        const existingSyncOp = await client.query(
          'SELECT * FROM sync_operations WHERE operation_id = $1',
          [operation.id]
        );

        if (existingSyncOp.rows.length > 0) {
          const existingOp = existingSyncOp.rows[0];
          
          if (existingOp.status === 'applied') {
            // Return the previous successful result
            const currentVersion = await getRecordVersion(operation.entityType, existingOp.record_id, client);
            results.push({
              success: true,
              operationId: operation.id,
              entityType: operation.entityType,
              recordId: existingOp.record_id,
              status: 'synced',
              version: currentVersion,
              message: 'Operation already applied (idempotent)'
            });
            continue;
          } else if (existingOp.status === 'conflict') {
            // Return the previous conflict result with conflict ID
            const existingConflict = await client.query(
              'SELECT * FROM conflicts WHERE operation_id = $1',
              [operation.id]
            );
            
            const serverRecord = await getServerRecord(operation.entityType, operation.payload, client);
            results.push({
              success: false,
              operationId: operation.id,
              status: 'conflict',
              message: 'Previous attempt resulted in conflict',
              conflictId: existingConflict.rows[0]?.conflict_id || null,
              serverRecord: serverRecord,
              baseVersion: operation.baseVersion,
              serverVersion: serverRecord?.version || null,
              localPayload: operation.payload
            });
            continue;
          } else if (existingOp.status === 'failed') {
            // Allow retry of failed operations
            console.log(`Retrying previously failed operation: ${operation.id}`);
          }
        }

        // Records are only applied under the session of the person who captured them (#61)
        const alreadyHeld = (await client.query(
          'SELECT reason FROM held_operations WHERE operation_id = $1',
          [operation.id]
        )).rows[0];
        const decision = alreadyHeld
          ? { action: 'hold', reason: alreadyHeld.reason }
          : await decideCapture(client, operation, req.user);
        if (decision.action === 'defer') {
          await client.query('COMMIT');
          results.push({ success: false, operationId: operation.id, status: 'deferred', message: 'Waiting for the person who captured it to sync' });
          continue;
        }
        if (decision.action === 'hold') {
          if (!alreadyHeld) {
            const { capture } = decision;
            await client.query(
              `INSERT INTO held_operations
               (operation_id, entity_type, operation_type, payload, base_version, client_id,
                captured_by, device_id, captured_at, submitted_by, reason)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (operation_id) DO NOTHING`,
              [
                operation.id,
                entityTypeMap[operation.entityType],
                operation.operation,
                JSON.stringify(operation.payload),
                operation.baseVersion,
                clientId,
                capture.capturedBy,
                capture.deviceId,
                capture.capturedAt,
                userId,
                decision.reason,
              ]
            );
          }
          await client.query('COMMIT');
          results.push({ success: false, operationId: operation.id, status: 'held', reason: decision.reason, capturedBy: decision.capture?.capturedBy });
          continue;
        }
        const { capture } = decision;

        // Process the operation based on type
        let result;
        if (operation.operation === 'create') {
          result = await handleCreateOperation(client, operation, clientId, userId);
        } else if (operation.operation === 'update') {
          result = await handleUpdateOperation(client, operation, clientId, userId);
        }

        // Map entity type for database
        const dbEntityType = entityTypeMap[operation.entityType] || operation.entityType;

        // Record the sync operation (delete existing first if it exists)
        await client.query(
          'DELETE FROM sync_operations WHERE operation_id = $1',
          [operation.id]
        );
        
        await client.query(
          `INSERT INTO sync_operations 
           (operation_id, entity_type, record_id, operation_type, payload, client_id, base_version, status, processed_at,
            captured_by, device_id, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', NOW(), $8, $9, $10)`,
          [
            operation.id,
            dbEntityType,
            result.recordId,
            operation.operation.toUpperCase(),
            JSON.stringify(operation.payload),
            clientId,
            operation.baseVersion,
            capture.capturedBy,
            capture.deviceId,
            capture.capturedAt
          ]
        );

        // Who captured it, the saved version, and any review flags (#62)
        await afterRecordSaved(client, {
          entityType: dbEntityType,
          recordId: result.recordId,
          capture,
          lateReason: operation.payload.lateReason,
          late: operation.late,
        });

        results.push({
          success: true,
          operationId: operation.id,
          entityType: operation.entityType,
          recordId: result.recordId,
          version: result.version,
          status: 'synced'
        });

        await client.query('COMMIT');

      } catch (error) {
        // Rollback the current transaction due to error
        await client.query('ROLLBACK');
        
        // Start a new transaction for error handling
        await client.query('BEGIN');
        
        // Handle individual operation errors
        const serverRecord = await getServerRecord(operation.entityType, operation.payload, client);
        
        // Determine if this is a conflict (version mismatch) or other error
        let status = 'failed';
        let conflictId = null;

        if (error.message.includes('version mismatch') ||
            error.message.includes('Version mismatch') ||
            error.message.includes('conflict')) {
          status = 'conflict';
        }

        const dbEntityType = entityTypeMap[operation.entityType] || operation.entityType;

        // sync_operations.record_id is required. A failed operation with no matching server
        // record (for example an update to a record that does not exist) is reported to the
        // client but not recorded, because there is no record to attach it to.
        const canRecord = Boolean(serverRecord?.id);
        if (!canRecord) {
          console.warn(`Sync operation ${operation.id} failed with no matching server record; not recorded`);
        }

        if (canRecord) {
          try {
            // Record the operation status first: conflicts.operation_id references
            // sync_operations.operation_id, so the conflict row can only be inserted after it.
            await client.query(
              'DELETE FROM sync_operations WHERE operation_id = $1',
              [operation.id]
            );
  
            await client.query(
              `INSERT INTO sync_operations
               (operation_id, entity_type, record_id, operation_type, payload, client_id, base_version, status, processed_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
              [
                operation.id,
                dbEntityType,
                serverRecord?.id || null,
                operation.operation.toUpperCase(),
                JSON.stringify(operation.payload),
                clientId,
                operation.baseVersion,
                status
              ]
            );
  
            if (status === 'conflict') {
              // Create conflict record in database
              const conflictResult = await client.query(
                `INSERT INTO conflicts
                 (entity_type, record_id, operation_id, client_id, base_version, server_version,
                  local_payload, server_payload, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unresolved')
                 RETURNING conflict_id`,
                [
                  dbEntityType,
                  serverRecord?.id || null,
                  operation.id,
                  clientId,
                  operation.baseVersion,
                  serverRecord?.version || null,
                  JSON.stringify(operation.payload),
                  JSON.stringify(serverRecord)
                ]
              );
              conflictId = conflictResult.rows[0].conflict_id;
            }
          } catch (recordError) {
            console.error('Error recording operation status:', recordError);
          }
        }

        // Commit the error handling transaction
        await client.query('COMMIT');

        results.push({
          success: false,
          operationId: operation.id,
          status: status,
          // Database errors carry a code; don't pass their internal messages to the client
          message: error.code ? 'The operation could not be applied' : error.message,
          conflictId: conflictId,
          serverRecord: serverRecord,
          baseVersion: operation.baseVersion,
          serverVersion: serverRecord?.version || null,
          localPayload: operation.payload
        });
      }
    }

    res.json({
      success: true,
      results
    });

  } catch (error) {
    // Only rollback if there's an active transaction
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error during rollback:', rollbackError);
    }
    
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  } finally {
    client.release();
  }
}

/**
 * Handle CREATE operation
 */
async function handleCreateOperation(client, operation, clientId, userId) {
  if (operation.entityType === 'attendance') {
    return await createAttendanceRecord(client, operation.payload, clientId, userId);
  } else if (operation.entityType === 'mealDistribution') {
    return await createMealDistributionRecord(client, operation.payload, clientId, userId);
  }
}

/**
 * Handle UPDATE operation with version checking
 */
async function handleUpdateOperation(client, operation, clientId, userId) {
  if (operation.entityType === 'attendance') {
    return await updateAttendanceRecord(client, operation.payload, operation.baseVersion, clientId, userId);
  } else if (operation.entityType === 'mealDistribution') {
    return await updateMealDistributionRecord(client, operation.payload, operation.baseVersion, clientId, userId);
  }
}

/**
 * Map frontend entity types to database entity types
 */
function mapEntityType(entityType) {
  const entityTypeMap = {
    'attendance': 'attendance',
    'mealDistribution': 'meal_distribution'
  };
  return entityTypeMap[entityType] || entityType;
}

/**
 * Create attendance record
 */
async function createAttendanceRecord(client, payload, clientId, userId) {
  const { schoolId, attendanceDate, totalRegistered, totalPresent, totalAbsent } = payload;

  // Convert DD-MM-YYYY to YYYY-MM-DD
  const formattedDate = convertDateFormat(attendanceDate);

  // Check if record already exists (idempotency)
  const existing = await client.query(
    'SELECT id, version FROM attendance_records WHERE school_id = $1 AND attendance_date = $2',
    [schoolId, formattedDate]
  );

  if (existing.rows.length > 0) {
    // Record already exists, return it
    return {
      recordId: existing.rows[0].id,
      version: existing.rows[0].version
    };
  }

  // Create new record
  const result = await client.query(
    `INSERT INTO attendance_records 
     (school_id, attendance_date, total_registered, total_present, total_absent, client_id, version, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
     RETURNING id, version`,
    [schoolId, formattedDate, totalRegistered, totalPresent, totalAbsent, clientId, userId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Update attendance record with version checking
 */
async function updateAttendanceRecord(client, payload, baseVersion, clientId, userId) {
  const { schoolId, attendanceDate, totalRegistered, totalPresent, totalAbsent } = payload;

  // Convert DD-MM-YYYY to YYYY-MM-DD
  const formattedDate = convertDateFormat(attendanceDate);

  // Get current record
  const current = await client.query(
    'SELECT id, version FROM attendance_records WHERE school_id = $1 AND attendance_date = $2',
    [schoolId, formattedDate]
  );

  if (current.rows.length === 0) {
    throw new Error('Record not found');
  }

  const currentRecord = current.rows[0];

  // Version check
  if (currentRecord.version !== baseVersion) {
    throw new Error(`Version mismatch: base version ${baseVersion}, server version ${currentRecord.version}`);
  }

  // Update record with incremented version
  const result = await client.query(
    `UPDATE attendance_records 
     SET total_registered = $1, total_present = $2, total_absent = $3, 
         version = version + 1, updated_at = NOW(), client_id = $4, updated_by = $6
     WHERE id = $5
     RETURNING id, version`,
    [totalRegistered, totalPresent, totalAbsent, clientId, currentRecord.id, userId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Create meal distribution record
 */
async function createMealDistributionRecord(client, payload, clientId, userId) {
  const { schoolId, distributionDate, mealsPrepared, mealsServed } = payload;

  // Convert DD-MM-YYYY to YYYY-MM-DD
  const formattedDate = convertDateFormat(distributionDate);

  // Check if record already exists (idempotency)
  const existing = await client.query(
    'SELECT id, version FROM meal_distributions WHERE school_id = $1 AND distribution_date = $2',
    [schoolId, formattedDate]
  );

  if (existing.rows.length > 0) {
    // Record already exists, return it
    return {
      recordId: existing.rows[0].id,
      version: existing.rows[0].version
    };
  }

  // Create new record
  const result = await client.query(
    `INSERT INTO meal_distributions 
     (school_id, distribution_date, meals_prepared, meals_served, client_id, version, updated_by)
     VALUES ($1, $2, $3, $4, $5, 1, $6)
     RETURNING id, version`,
    [schoolId, formattedDate, mealsPrepared, mealsServed, clientId, userId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Update meal distribution record with version checking
 */
async function updateMealDistributionRecord(client, payload, baseVersion, clientId, userId) {
  const { schoolId, distributionDate, mealsPrepared, mealsServed } = payload;

  // Convert DD-MM-YYYY to YYYY-MM-DD
  const formattedDate = convertDateFormat(distributionDate);

  // Get current record
  const current = await client.query(
    'SELECT id, version FROM meal_distributions WHERE school_id = $1 AND distribution_date = $2',
    [schoolId, formattedDate]
  );

  if (current.rows.length === 0) {
    throw new Error('Record not found');
  }

  const currentRecord = current.rows[0];

  // Version check
  if (currentRecord.version !== baseVersion) {
    throw new Error(`Version mismatch: base version ${baseVersion}, server version ${currentRecord.version}`);
  }

  // Update record with incremented version
  const result = await client.query(
    `UPDATE meal_distributions 
     SET meals_prepared = $1, meals_served = $2, version = version + 1, updated_at = NOW(), client_id = $3, updated_by = $5
     WHERE id = $4
     RETURNING id, version`,
    [mealsPrepared, mealsServed, clientId, currentRecord.id, userId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Get server record for conflict information
 */
async function getServerRecord(entityType, payload, client) {
  try {
    if (entityType === 'attendance') {
      const { schoolId, attendanceDate } = payload;
      const formattedDate = convertDateFormat(attendanceDate);
      
      const result = await client.query(
        'SELECT * FROM attendance_records WHERE school_id = $1 AND attendance_date = $2',
        [schoolId, formattedDate]
      );
      
      return result.rows[0] || null;
    } else if (entityType === 'mealDistribution') {
      const { schoolId, distributionDate } = payload;
      const formattedDate = convertDateFormat(distributionDate);
      
      const result = await client.query(
        'SELECT * FROM meal_distributions WHERE school_id = $1 AND distribution_date = $2',
        [schoolId, formattedDate]
      );
      
      return result.rows[0] || null;
    }
  } catch (error) {
    console.error('Error getting server record:', error);
    return null;
  }
}

/**
 * Get record version
 */
async function getRecordVersion(entityType, recordId, client) {
  try {
    if (entityType === 'attendance') {
      const result = await client.query(
        'SELECT version FROM attendance_records WHERE id = $1',
        [recordId]
      );
      return result.rows[0]?.version || null;
    } else if (entityType === 'mealDistribution') {
      const result = await client.query(
        'SELECT version FROM meal_distributions WHERE id = $1',
        [recordId]
      );
      return result.rows[0]?.version || null;
    }
  } catch (error) {
    console.error('Error getting record version:', error);
    return null;
  }
}

/**
 * Convert DD-MM-YYYY to YYYY-MM-DD
 */
function convertDateFormat(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateString;
}

// Count fields an administrator may edit when merging, per entity type
const MERGE_FIELDS = {
  attendance: ['totalRegistered', 'totalPresent', 'totalAbsent'],
  meal_distribution: ['mealsPrepared', 'mealsServed'],
};

/**
 * The record an administrator built by merging: the device's record (school and
 * date stay fixed) with the counts from `values`. Throws ValidationError when the
 * values are missing or break the usual record rules.
 */
function mergedPayload(conflict, values) {
  const fields = MERGE_FIELDS[conflict.entity_type];
  if (!values || typeof values !== 'object' || !fields.every((field) => field in values)) {
    throw new ValidationError(`A merge needs values for: ${fields.join(', ')}`);
  }
  const payload = { ...conflict.local_payload };
  for (const field of fields) payload[field] = values[field];
  const invalid = syncPayloadError(conflict.entity_type === 'attendance' ? 'attendance' : 'mealDistribution', payload);
  if (invalid) throw new ValidationError(invalid);
  return payload;
}

/**
 * Resolve a conflict: keep the device's version, keep the server's version, or
 * merge (an administrator's edited values, checked like any other record).
 */
async function resolveConflict(req, res, next) {
  const client = await pool.connect();
  
  try {
    const { conflictId } = req.params;
    if (!isUuid(conflictId)) {
      throw new ValidationError('Invalid conflict ID format');
    }
    const { resolution, values } = req.body;
    const clientId = req.body.clientId;
    // The signed-in user who resolves the conflict (conflicts.resolved_by references users.id)
    const resolvedBy = req.user?.id || null;

    // Validate resolution choice
    const allowedResolutions = ['keep_local', 'keep_server', 'merge'];
    if (!resolution || !allowedResolutions.includes(resolution)) {
      throw new ValidationError(`Invalid resolution. Must be one of: ${allowedResolutions.join(', ')}`);
    }

    await client.query('BEGIN');

    // Get the conflict record
    const conflictResult = await client.query(
      'SELECT * FROM conflicts WHERE conflict_id = $1',
      [conflictId]
    );

    if (conflictResult.rows.length === 0) {
      throw new NotFoundError('Conflict not found');
    }

    const conflict = conflictResult.rows[0];

    // Check if conflict is already resolved
    if (conflict.status !== 'unresolved') {
      throw new ValidationError('Conflict has already been resolved');
    }

    // Get current server record to prevent stale resolutions
    const currentServerRecord = await getServerRecord(
      conflict.entity_type === 'attendance' ? 'attendance' : 'mealDistribution',
      conflict.local_payload,
      client
    );

    // Verify the conflict is still valid (server version hasn't changed)
    if (currentServerRecord && currentServerRecord.version !== conflict.server_version) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Stale conflict',
        message: 'The server record has been modified since this conflict was created. Please refresh and try again.',
        currentServerVersion: currentServerRecord.version,
        expectedServerVersion: conflict.server_version
      });
    }

    let resultRecord;
    let newVersion;

    if (resolution === 'keep_server') {
      // Keep server version - update local record with server data
      // The server record remains unchanged
      resultRecord = currentServerRecord;
      newVersion = currentServerRecord.version;

      // Mark conflict as resolved
      await client.query(
        `UPDATE conflicts 
         SET status = 'resolved', 
             resolution = $1, 
             resolved_at = NOW(),
             resolved_by = $2
         WHERE conflict_id = $3`,
        ['keep_server', resolvedBy, conflictId]
      );

    } else {
      // keep_local applies the device's values; merge applies the administrator's edited values
      const localPayload = resolution === 'merge' ? mergedPayload(conflict, values) : conflict.local_payload;
      
      if (conflict.entity_type === 'attendance') {
        const updateResult = await applyLocalAttendanceUpdate(client, localPayload, conflict.server_version, clientId, resolvedBy);
        resultRecord = updateResult.record;
        newVersion = updateResult.version;
      } else if (conflict.entity_type === 'meal_distribution') {
        const updateResult = await applyLocalMealUpdate(client, localPayload, conflict.server_version, clientId, resolvedBy);
        resultRecord = updateResult.record;
        newVersion = updateResult.version;
      }

      // The administrator's decision is a new version in the record's history (not flagged)
      await afterRecordSaved(client, {
        entityType: conflict.entity_type,
        recordId: resultRecord.id,
        capture: { capturedBy: resolvedBy, capturedAt: clock.now() },
        flag: false,
      });

      // Mark conflict as resolved
      await client.query(
        `UPDATE conflicts 
         SET status = 'resolved', 
             resolution = $1, 
             resolved_at = NOW(),
             resolved_by = $2
         WHERE conflict_id = $3`,
        [resolution, resolvedBy, conflictId]
      );
    }

    // Update the associated sync operation status
    await client.query(
      `UPDATE sync_operations 
       SET status = 'applied', 
           processed_at = NOW()
       WHERE operation_id = $1`,
      [conflict.operation_id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      conflictId: conflictId,
      resolution: resolution,
      record: resultRecord,
      version: newVersion,
      message: `Conflict resolved using ${resolution} strategy`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  } finally {
    client.release();
  }
}

/**
 * Apply local attendance update as part of conflict resolution
 */
async function applyLocalAttendanceUpdate(client, payload, currentServerVersion, clientId, userId) {
  const { schoolId, attendanceDate, totalRegistered, totalPresent, totalAbsent } = payload;
  const formattedDate = convertDateFormat(attendanceDate);

  // Get current record
  const current = await client.query(
    'SELECT id, version FROM attendance_records WHERE school_id = $1 AND attendance_date = $2',
    [schoolId, formattedDate]
  );

  if (current.rows.length === 0) {
    throw new Error('Record not found');
  }

  const currentRecord = current.rows[0];

  // Update record with incremented version
  const result = await client.query(
    `UPDATE attendance_records 
     SET total_registered = $1, total_present = $2, total_absent = $3, 
         version = version + 1, updated_at = NOW(), client_id = $4, updated_by = $6
     WHERE id = $5
     RETURNING *`,
    [totalRegistered, totalPresent, totalAbsent, clientId, currentRecord.id, userId]
  );

  return {
    record: result.rows[0],
    version: result.rows[0].version
  };
}

/**
 * Apply local meal distribution update as part of conflict resolution
 */
async function applyLocalMealUpdate(client, payload, currentServerVersion, clientId, userId) {
  const { schoolId, distributionDate, mealsPrepared, mealsServed } = payload;
  const formattedDate = convertDateFormat(distributionDate);

  // Get current record
  const current = await client.query(
    'SELECT id, version FROM meal_distributions WHERE school_id = $1 AND distribution_date = $2',
    [schoolId, formattedDate]
  );

  if (current.rows.length === 0) {
    throw new Error('Record not found');
  }

  const currentRecord = current.rows[0];

  // Update record with incremented version
  const result = await client.query(
    `UPDATE meal_distributions 
     SET meals_prepared = $1, meals_served = $2, version = version + 1, updated_at = NOW(), client_id = $3, updated_by = $5
     WHERE id = $4
     RETURNING *`,
    [mealsPrepared, mealsServed, clientId, currentRecord.id, userId]
  );

  return {
    record: result.rows[0],
    version: result.rows[0].version
  };
}

/**
 * Get all unresolved conflicts for a client
 */
async function getConflicts(req, res, next) {
  const client = await pool.connect();
  
  try {
    const { clientId } = req.query;
    const { status } = req.query;

    let query = 'SELECT * FROM conflicts';
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (clientId) {
      conditions.push(`client_id = $${paramIndex}`);
      params.push(clientId);
      paramIndex++;
    }

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const result = await client.query(query, params);

    res.json({
      success: true,
      conflicts: result.rows
    });

  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
}

/**
 * Get a specific conflict by ID
 */
async function getConflictById(req, res, next) {
  const client = await pool.connect();
  
  try {
    const { conflictId } = req.params;
    if (!isUuid(conflictId)) {
      throw new ValidationError('Invalid conflict ID format');
    }

    const result = await client.query(
      'SELECT * FROM conflicts WHERE conflict_id = $1',
      [conflictId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Conflict not found');
    }

    res.json({
      success: true,
      conflict: result.rows[0]
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  } finally {
    client.release();
  }
}

module.exports = {
  handleCreateOperation,
  handleUpdateOperation,
  syncOperations,
  resolveConflict,
  getConflicts,
  getConflictById
};
