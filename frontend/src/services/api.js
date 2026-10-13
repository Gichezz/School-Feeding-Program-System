/**
 * API client helpers for talking to the Express REST backend.
 */

import { getSession, markSessionExpired } from './session';
import { clearDeviceIdentity } from '../features/devices/deviceIdentity';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Generic API request handler with error handling
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const session = getSession();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token && { Authorization: `Bearer ${session.token}` }),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      error.status = response.status;
      // Extra details from the server, e.g. { passkeyRequired: true }
      error.data = errorData;
      // The server no longer accepts this session; the user needs to sign in again
      if (response.status === 401 && session?.token) {
        markSessionExpired(errorData.deviceRevoked ? 'deviceRevoked' : undefined);
      }
      // An administrator removed this school device: forget its identity (records stay)
      if (errorData.deviceRevoked) {
        await clearDeviceIdentity().catch(() => {});
      }
      throw error;
    }

    // 204 No Content (e.g. after a delete)
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error - unable to connect to server');
    }
    throw error;
  }
}

/**
 * Health check
 */
export async function getHealth() {
  return apiRequest('/health');
}

/**
 * Schools API
 */
export async function getSchools() {
  return apiRequest('/schools');
}

export async function getSchoolById(id) {
  return apiRequest(`/schools/${id}`);
}

/**
 * Attendance API
 */
export async function getAttendance(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/attendance?${queryString}` : '/attendance';
  return apiRequest(endpoint);
}

export async function getAttendanceById(id) {
  return apiRequest(`/attendance/${id}`);
}

export async function createAttendance(data) {
  return apiRequest('/attendance', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Meals API
 */
export async function getMeals(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/meals?${queryString}` : '/meals';
  return apiRequest(endpoint);
}

export async function getMealById(id) {
  return apiRequest(`/meals/${id}`);
}

export async function createMeal(data) {
  return apiRequest('/meals', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Sync API
 */
export async function syncOperations(data) {
  return apiRequest('/sync', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Conflicts API
 */
export async function getConflicts(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/sync/conflicts?${queryString}` : '/sync/conflicts';
  return apiRequest(endpoint);
}

export async function getConflictById(conflictId) {
  return apiRequest(`/sync/conflicts/${conflictId}`);
}

export async function resolveConflict(conflictId, data) {
  return apiRequest(`/sync/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Reports API
 */
export async function getDashboardSummary(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/reports/dashboard?${queryString}` : '/reports/dashboard';
  return apiRequest(endpoint);
}

export async function getAttendanceReport(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/reports/attendance?${queryString}` : '/reports/attendance';
  return apiRequest(endpoint);
}

export async function getMealsReport(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/reports/meals?${queryString}` : '/reports/meals';
  return apiRequest(endpoint);
}

export async function getAttendanceTrend(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/reports/attendance/trend?${queryString}` : '/reports/attendance/trend';
  return apiRequest(endpoint);
}

export async function getMealsTrend(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const endpoint = queryString ? `/reports/meals/trend?${queryString}` : '/reports/meals/trend';
  return apiRequest(endpoint);
}

/**
 * Forecasts API
 * params: school_id (required), start_date (DD-MM-YYYY), horizon_days, enrollment
 */
export async function getForecast(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest(`/forecasts?${queryString}`);
}

/**
 * Auth API
 */
export async function login(email, password) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Change the signed-in user's own password. Returns a new session
 * ({ token, expiresAt, user }); other sessions for the account end.
 */
export async function changePassword(currentPassword, newPassword) {
  return apiRequest('/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/**
 * User accounts (administrators only)
 */
export async function getUsers() {
  return apiRequest('/users');
}

export async function createUser(data) {
  return apiRequest('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * changes: any of { name, role, isActive }
 */
export async function updateUser(id, changes) {
  return apiRequest(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export async function resetUserPassword(id, password) {
  return apiRequest(`/users/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

/**
 * Passkeys (administrators)
 */
export async function getPasskeyLoginOptions() {
  return apiRequest('/auth/passkeys/login/options', { method: 'POST' });
}

export async function verifyPasskeyLogin(response) {
  return apiRequest('/auth/passkeys/login/verify', {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

export async function signInWithRecoveryCode(email, password, code) {
  return apiRequest('/auth/recovery', {
    method: 'POST',
    body: JSON.stringify({ email, password, code }),
  });
}

export async function getPasskeys() {
  return apiRequest('/auth/passkeys');
}

export async function getPasskeyRegistrationOptions() {
  return apiRequest('/auth/passkeys/register/options', { method: 'POST' });
}

export async function verifyPasskeyRegistration(response, name) {
  return apiRequest('/auth/passkeys/register/verify', {
    method: 'POST',
    body: JSON.stringify({ response, name }),
  });
}

export async function removePasskey(id) {
  return apiRequest(`/auth/passkeys/${id}`, { method: 'DELETE' });
}

export async function regenerateRecoveryCodes() {
  return apiRequest('/auth/recovery-codes', { method: 'POST' });
}

export async function resetUserPasskeys(id) {
  return apiRequest(`/users/${id}/passkeys/reset`, { method: 'POST' });
}

/**
 * School devices and staff PIN sign-in (#60)
 */
export async function getDeviceChallenge() {
  return apiRequest('/devices/challenge', { method: 'POST' });
}

export async function enrolDevice(data) {
  return apiRequest('/devices/enrol', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function signInOnDevice(data) {
  return apiRequest('/devices/sign-in', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getDevices() {
  return apiRequest('/devices');
}

export async function approveDevice(id) {
  return apiRequest(`/devices/${id}/approve`, { method: 'POST' });
}

export async function revokeDevice(id) {
  return apiRequest(`/devices/${id}/revoke`, { method: 'POST' });
}

export async function unlockDeviceUser(deviceId, userId) {
  return apiRequest(`/devices/${deviceId}/users/${userId}/unlock`, { method: 'POST' });
}

export async function newActivationCode(userId) {
  return apiRequest(`/users/${userId}/activation-code`, { method: 'POST' });
}
