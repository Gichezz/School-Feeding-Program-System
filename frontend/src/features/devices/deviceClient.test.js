import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDeviceApproval } from './deviceClient';
import { clearDeviceIdentity, createDeviceKeys, getDeviceIdentity, saveDeviceIdentity } from './deviceIdentity';
import { getDeviceApprovalStatus } from '../../services/api';

vi.mock('../../services/api', () => ({
  enrolDevice: vi.fn(),
  getDeviceChallenge: vi.fn(),
  signInOnDevice: vi.fn(),
  getDeviceApprovalStatus: vi.fn(),
}));

async function waitingDevice() {
  const { privateKey } = await createDeviceKeys();
  await saveDeviceIdentity({ deviceId: 'device-1', name: 'Kitchen tablet', schoolId: 'school-1', status: 'pending', privateKey });
}

beforeEach(async () => {
  vi.mocked(getDeviceApprovalStatus).mockReset();
  await clearDeviceIdentity();
});

describe('checkDeviceApproval', () => {
  it('keeps the answer once the device is approved', async () => {
    await waitingDevice();
    vi.mocked(getDeviceApprovalStatus).mockResolvedValue({ status: 'approved' });

    expect(await checkDeviceApproval()).toBe('approved');
    expect(getDeviceApprovalStatus).toHaveBeenCalledWith('device-1');
    expect((await getDeviceIdentity()).status).toBe('approved');
  });

  it('leaves a waiting device waiting', async () => {
    await waitingDevice();
    vi.mocked(getDeviceApprovalStatus).mockResolvedValue({ status: 'pending' });

    expect(await checkDeviceApproval()).toBe('pending');
    expect((await getDeviceIdentity()).status).toBe('pending');
  });

  it('forgets a device that was removed, or that the server no longer knows, so it can be set up again', async () => {
    await waitingDevice();
    vi.mocked(getDeviceApprovalStatus).mockResolvedValue({ status: 'revoked' });
    expect(await checkDeviceApproval()).toBe('revoked');
    expect(await getDeviceIdentity()).toBeNull();

    await waitingDevice();
    vi.mocked(getDeviceApprovalStatus).mockRejectedValue(Object.assign(new Error('Device not found'), { status: 404 }));
    expect(await checkDeviceApproval()).toBe('revoked');
    expect(await getDeviceIdentity()).toBeNull();
  });

  it('forgets a device whose set-up expired before it was approved, so it is set up again as a new device', async () => {
    await waitingDevice();
    vi.mocked(getDeviceApprovalStatus).mockRejectedValue(Object.assign(new Error('Expired'), { status: 410 }));

    expect(await checkDeviceApproval()).toBe('expired');
    expect(await getDeviceIdentity()).toBeNull();
  });

  it('does nothing on a browser that is not a school device', async () => {
    expect(await checkDeviceApproval()).toBeNull();
    expect(getDeviceApprovalStatus).not.toHaveBeenCalled();
  });
});
