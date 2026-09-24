/**
 * Phase 7 Conflict Detection and Resolution Testing
 * This script tests the complete conflict detection and resolution flow
 */

const API_BASE = 'http://localhost:5000/api';

// Test data
const TEST_SCHOOL_ID = '1'; // Assuming school ID 1 exists from seed data
const TEST_DATE = '24-09-2026';

/**
 * Test 1: Create initial attendance record
 */
async function test1_createInitialRecord() {
  console.log('\n=== Test 1: Create Initial Attendance Record ===');
  
  try {
    const response = await fetch(`${API_BASE}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_id: TEST_SCHOOL_ID,
        attendance_date: TEST_DATE,
        total_registered: 100,
        total_present: 95,
        total_absent: 5
      })
    });
    
    const data = await response.json();
    console.log('Response:', data);
    
    if (response.ok) {
      console.log('✅ Test 1 PASSED: Initial record created');
      return data.attendance || data;
    } else {
      console.log('❌ Test 1 FAILED:', data.error);
      return null;
    }
  } catch (error) {
    console.log('❌ Test 1 ERROR:', error.message);
    return null;
  }
}

/**
 * Test 2: Create a conflict by simulating version mismatch
 */
async function test2_createConflict() {
  console.log('\n=== Test 2: Create Conflict via Version Mismatch ===');
  
  try {
    // First, get the current record to see its version
    const getResponse = await fetch(`${API_BASE}/attendance?school_id=${TEST_SCHOOL_ID}&attendance_date=${TEST_DATE}`);
    const getData = await getResponse.json();
    
    if (getData.attendance && getData.attendance.length > 0) {
      const currentRecord = getData.attendance[0];
      console.log('Current record version:', currentRecord.version);
      
      // Now try to update with an old version (version - 1) to simulate conflict
      const oldVersion = Math.max(0, currentRecord.version - 1);
      
      const syncResponse = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-client-1',
          operations: [{
            id: `test-op-${Date.now()}`,
            entityType: 'attendance',
            recordId: currentRecord.id,
            operation: 'update',
            payload: {
              schoolId: TEST_SCHOOL_ID,
              attendanceDate: TEST_DATE,
              totalRegistered: 100,
              totalPresent: 90, // Different value
              totalAbsent: 10
            },
            baseVersion: oldVersion, // Intentionally wrong version
            createdAt: new Date().toISOString()
          }]
        })
      });
      
      const syncData = await syncResponse.json();
      console.log('Sync response:', JSON.stringify(syncData, null, 2));
      
      if (syncData.success && syncData.results && syncData.results[0].status === 'conflict') {
        console.log('✅ Test 2 PASSED: Conflict detected successfully');
        return {
          conflictId: syncData.results[0].conflictId,
          operationId: syncData.results[0].operationId
        };
      } else {
        console.log('❌ Test 2 FAILED: Conflict not detected');
        return null;
      }
    } else {
      console.log('❌ Test 2 FAILED: Could not find initial record');
      return null;
    }
  } catch (error) {
    console.log('❌ Test 2 ERROR:', error.message);
    return null;
  }
}

/**
 * Test 3: Test keep_server resolution
 */
async function test3_keepServerResolution(conflictId) {
  console.log('\n=== Test 3: Keep Server Resolution ===');
  
  if (!conflictId) {
    console.log('❌ Test 3 SKIPPED: No conflict ID available');
    return false;
  }
  
  try {
    const response = await fetch(`${API_BASE}/sync/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution: 'keep_server',
        clientId: 'test-client-1'
      })
    });
    
    const data = await response.json();
    console.log('Resolution response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Test 3 PASSED: Keep server resolution successful');
      return true;
    } else {
      console.log('❌ Test 3 FAILED:', data.error || 'Resolution failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Test 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Create another conflict for keep_local test
 */
async function test4_createConflictForKeepLocal() {
  console.log('\n=== Test 4: Create Conflict for Keep Local Test ===');
  
  try {
    // Get current record
    const getResponse = await fetch(`${API_BASE}/attendance?school_id=${TEST_SCHOOL_ID}&attendance_date=${TEST_DATE}`);
    const getData = await getResponse.json();
    
    if (getData.attendance && getData.attendance.length > 0) {
      const currentRecord = getData.attendance[0];
      console.log('Current record version:', currentRecord.version);
      
      // Create conflict with old version
      const oldVersion = Math.max(0, currentRecord.version - 1);
      
      const syncResponse = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-client-2',
          operations: [{
            id: `test-op-${Date.now()}`,
            entityType: 'attendance',
            recordId: currentRecord.id,
            operation: 'update',
            payload: {
              schoolId: TEST_SCHOOL_ID,
              attendanceDate: TEST_DATE,
              totalRegistered: 100,
              totalPresent: 85, // Different value for keep_local test
              totalAbsent: 15
            },
            baseVersion: oldVersion,
            createdAt: new Date().toISOString()
          }]
        })
      });
      
      const syncData = await syncResponse.json();
      console.log('Sync response:', JSON.stringify(syncData, null, 2));
      
      if (syncData.success && syncData.results && syncData.results[0].status === 'conflict') {
        console.log('✅ Test 4 PASSED: Second conflict created');
        return syncData.results[0].conflictId;
      } else {
        console.log('❌ Test 4 FAILED: Second conflict not created');
        return null;
      }
    } else {
      console.log('❌ Test 4 FAILED: Could not find record');
      return null;
    }
  } catch (error) {
    console.log('❌ Test 4 ERROR:', error.message);
    return null;
  }
}

/**
 * Test 5: Test keep_local resolution
 */
async function test5_keepLocalResolution(conflictId) {
  console.log('\n=== Test 5: Keep Local Resolution ===');
  
  if (!conflictId) {
    console.log('❌ Test 5 SKIPPED: No conflict ID available');
    return false;
  }
  
  try {
    const response = await fetch(`${API_BASE}/sync/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution: 'keep_local',
        clientId: 'test-client-2'
      })
    });
    
    const data = await response.json();
    console.log('Resolution response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Test 5 PASSED: Keep local resolution successful');
      console.log('New version:', data.version);
      return true;
    } else {
      console.log('❌ Test 5 FAILED:', data.error || 'Resolution failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Test 5 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 6: Verify audit trail
 */
async function test6_verifyAuditTrail() {
  console.log('\n=== Test 6: Verify Audit Trail ===');
  
  try {
    const response = await fetch(`${API_BASE}/sync/conflicts`);
    const data = await response.json();
    
    console.log('Total conflicts in database:', data.conflicts.length);
    
    if (data.conflicts.length > 0) {
      console.log('Sample conflict record:');
      const sampleConflict = data.conflicts[0];
      console.log('- Conflict ID:', sampleConflict.conflict_id);
      console.log('- Status:', sampleConflict.status);
      console.log('- Resolution:', sampleConflict.resolution);
      console.log('- Created:', sampleConflict.created_at);
      console.log('- Resolved:', sampleConflict.resolved_at);
      console.log('- Base Version:', sampleConflict.base_version);
      console.log('- Server Version:', sampleConflict.server_version);
      
      const hasAuditFields = sampleConflict.conflict_id && 
                            sampleConflict.status && 
                            sampleConflict.created_at &&
                            sampleConflict.base_version !== undefined &&
                            sampleConflict.server_version !== undefined;
      
      if (hasAuditFields) {
        console.log('✅ Test 6 PASSED: Audit trail fields present');
        return true;
      } else {
        console.log('❌ Test 6 FAILED: Missing audit trail fields');
        return false;
      }
    } else {
      console.log('⚠️ Test 6 WARNING: No conflicts found in database');
      return true;
    }
  } catch (error) {
    console.log('❌ Test 6 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 7: Test stale conflict protection
 */
async function test7_staleConflictProtection() {
  console.log('\n=== Test 7: Stale Conflict Protection ===');
  
  try {
    // Get current record
    const getResponse = await fetch(`${API_BASE}/attendance?school_id=${TEST_SCHOOL_ID}&attendance_date=${TEST_DATE}`);
    const getData = await getResponse.json();
    
    if (getData.attendance && getData.attendance.length > 0) {
      const currentRecord = getData.attendance[0];
      
      // Create a conflict
      const oldVersion = Math.max(0, currentRecord.version - 1);
      
      const syncResponse = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-client-stale',
          operations: [{
            id: `test-op-stale-${Date.now()}`,
            entityType: 'attendance',
            recordId: currentRecord.id,
            operation: 'update',
            payload: {
              schoolId: TEST_SCHOOL_ID,
              attendanceDate: TEST_DATE,
              totalRegistered: 100,
              totalPresent: 80,
              totalAbsent: 20
            },
            baseVersion: oldVersion,
            createdAt: new Date().toISOString()
          }]
        })
      });
      
      const syncData = await syncResponse.json();
      
      if (syncData.success && syncData.results && syncData.results[0].status === 'conflict') {
        const conflictId = syncData.results[0].conflictId;
        
        // Update the record to change server version
        await fetch(`${API_BASE}/attendance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            school_id: TEST_SCHOOL_ID,
            attendance_date: TEST_DATE,
            total_registered: 100,
            total_present: 75,
            total_absent: 25
          })
        });
        
        // Try to resolve the now-stale conflict
        const resolveResponse = await fetch(`${API_BASE}/sync/conflicts/${conflictId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resolution: 'keep_local',
            clientId: 'test-client-stale'
          })
        });
        
        const resolveData = await resolveResponse.json();
        
        if (resolveResponse.status === 409 && resolveData.error === 'Stale conflict') {
          console.log('✅ Test 7 PASSED: Stale conflict protection working');
          return true;
        } else {
          console.log('❌ Test 7 FAILED: Stale conflict not detected');
          console.log('Response:', resolveData);
          return false;
        }
      } else {
        console.log('❌ Test 7 FAILED: Could not create initial conflict');
        return false;
      }
    } else {
      console.log('❌ Test 7 FAILED: Could not find record');
      return false;
    }
  } catch (error) {
    console.log('❌ Test 7 ERROR:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Phase 7 Conflict Detection & Resolution Tests          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const results = {};
  
  results.test1 = await test1_createInitialRecord();
  results.test2 = await test2_createConflict();
  
  if (results.test2) {
    results.test3 = await test3_keepServerResolution(results.test2.conflictId);
  }
  
  results.test4 = await test4_createConflictForKeepLocal();
  
  if (results.test4) {
    results.test5 = await test5_keepLocalResolution(results.test4);
  }
  
  results.test6 = await test6_verifyAuditTrail();
  results.test7 = await test7_staleConflictProtection();
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      Test Summary                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('Test 1 (Create Initial Record):', results.test1 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 2 (Conflict Detection):', results.test2 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 3 (Keep Server Resolution):', results.test3 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 4 (Create Second Conflict):', results.test4 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 5 (Keep Local Resolution):', results.test5 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 6 (Audit Trail):', results.test6 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 7 (Stale Conflict Protection):', results.test7 ? '✅ PASSED' : '❌ FAILED');
}

// Run tests
runAllTests().catch(console.error);
