/**
 * API client helpers for talking to the Express REST backend.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Generic API request handler with error handling
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
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
