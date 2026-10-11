/**
 * API client helpers for talking to the Express REST backend.
 */

import { getSession, markSessionExpired } from './session';

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
      // The server no longer accepts this session; the user needs to sign in again
      if (response.status === 401 && session?.token) {
        markSessionExpired();
      }
      throw error;
    }

    return response.json();
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
