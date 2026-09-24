const { pool } = require('../db/pool');
const { ValidationError, DatabaseError, NotFoundError } = require('../utils/errors');

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

    // Validate request structure
    if (!clientId || typeof clientId !== 'string') {
      throw new ValidationError('Client ID is required');
    }

    if (!Array.isArray(operations)) {
      throw new ValidationError('Operations must be an array');
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
    }

    // Map frontend entity types to database entity types
    const entityTypeMap = {
      'attendance': 'attendance',
      'mealDistribution': 'meal_distribution'
    };

    const results = [];

    // Process each operation within a transaction
    await client.query('BEGIN');

    for (const operation of operations) {
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
            // Return the previous conflict result
            const serverRecord = await getServerRecord(operation.entityType, operation.payload, client);
            results.push({
              success: false,
              operationId: operation.id,
              status: 'conflict',
              message: 'Previous attempt resulted in conflict',
              serverRecord: serverRecord,
              baseVersion: operation.baseVersion,
              serverVersion: serverRecord?.version || null
            });
            continue;
          } else if (existingOp.status === 'failed') {
            // Allow retry of failed operations
            console.log(`Retrying previously failed operation: ${operation.id}`);
          }
        }

        // Process the operation based on type
        let result;
        if (operation.operation === 'create') {
          result = await handleCreateOperation(client, operation, clientId);
        } else if (operation.operation === 'update') {
          result = await handleUpdateOperation(client, operation, clientId);
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
           (operation_id, entity_type, record_id, operation_type, payload, client_id, base_version, status, processed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', NOW())`,
          [
            operation.id,
            dbEntityType,
            result.recordId,
            operation.operation.toUpperCase(),
            JSON.stringify(operation.payload),
            clientId,
            operation.baseVersion
          ]
        );

        results.push({
          success: true,
          operationId: operation.id,
          entityType: operation.entityType,
          recordId: result.recordId,
          version: result.version,
          status: 'synced'
        });

      } catch (error) {
        // Handle individual operation errors
        const serverRecord = await getServerRecord(operation.entityType, operation.payload, client);
        
        // Determine if this is a conflict (version mismatch) or other error
        let status = 'failed';
        if (error.message.includes('version mismatch') || 
            error.message.includes('Version mismatch') ||
            error.message.includes('conflict')) {
          status = 'conflict';
        }
        
        // Record the operation status
        try {
          const dbEntityType = entityTypeMap[operation.entityType] || operation.entityType;
          
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
        } catch (recordError) {
          console.error('Error recording operation status:', recordError);
        }

        results.push({
          success: false,
          operationId: operation.id,
          status: status,
          message: error.message,
          serverRecord: serverRecord,
          baseVersion: operation.baseVersion,
          serverVersion: serverRecord?.version || null
        });
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      results
    });

  } catch (error) {
    await client.query('ROLLBACK');
    
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
async function handleCreateOperation(client, operation, clientId) {
  if (operation.entityType === 'attendance') {
    return await createAttendanceRecord(client, operation.payload, clientId);
  } else if (operation.entityType === 'mealDistribution') {
    return await createMealDistributionRecord(client, operation.payload, clientId);
  }
}

/**
 * Handle UPDATE operation with version checking
 */
async function handleUpdateOperation(client, operation, clientId) {
  if (operation.entityType === 'attendance') {
    return await updateAttendanceRecord(client, operation.payload, operation.baseVersion, clientId);
  } else if (operation.entityType === 'mealDistribution') {
    return await updateMealDistributionRecord(client, operation.payload, operation.baseVersion, clientId);
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
async function createAttendanceRecord(client, payload, clientId) {
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
     (school_id, attendance_date, total_registered, total_present, total_absent, client_id, version)
     VALUES ($1, $2, $3, $4, $5, $6, 1)
     RETURNING id, version`,
    [schoolId, formattedDate, totalRegistered, totalPresent, totalAbsent, clientId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Update attendance record with version checking
 */
async function updateAttendanceRecord(client, payload, baseVersion, clientId) {
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
         version = version + 1, updated_at = NOW(), client_id = $4
     WHERE id = $5
     RETURNING id, version`,
    [totalRegistered, totalPresent, totalAbsent, clientId, currentRecord.id]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Create meal distribution record
 */
async function createMealDistributionRecord(client, payload, clientId) {
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
     (school_id, distribution_date, meals_prepared, meals_served, client_id, version)
     VALUES ($1, $2, $3, $4, $5, 1)
     RETURNING id, version`,
    [schoolId, formattedDate, mealsPrepared, mealsServed, clientId]
  );

  return {
    recordId: result.rows[0].id,
    version: result.rows[0].version
  };
}

/**
 * Update meal distribution record with version checking
 */
async function updateMealDistributionRecord(client, payload, baseVersion, clientId) {
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
     SET meals_prepared = $1, meals_served = $2, version = version + 1, updated_at = NOW(), client_id = $3
     WHERE id = $4
     RETURNING id, version`,
    [mealsPrepared, mealsServed, clientId, currentRecord.id]
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

module.exports = {
  syncOperations
};
