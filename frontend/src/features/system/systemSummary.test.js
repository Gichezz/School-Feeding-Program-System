import { describe, expect, it } from 'vitest';
import { systemSummary } from './SystemDashboard';

describe('the system administrator dashboard counts', () => {
  it('counts devices waiting, locked sign-ins on devices still in use, and administrators without a second factor', () => {
    const devices = [
      { status: 'pending', staff: [] },
      { status: 'approved', staff: [{ locked: true }, { locked: false }] },
      { status: 'revoked', staff: [{ locked: true }] },
    ];
    const users = [
      { role: 'admin', isActive: true, passkeyCount: '0', totpEnabled: false },
      { role: 'admin', isActive: true, passkeyCount: '1', totpEnabled: false },
      { role: 'school_staff', isActive: true },
      { role: 'programme_officer', isActive: false },
    ];

    expect(systemSummary(devices, users)).toEqual({
      pendingDevices: 1, approvedDevices: 1, lockedSignIns: 1, activeUsers: 3, withoutSecondFactor: 1,
    });
  });
});
