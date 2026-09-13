/**
 * API client helpers for talking to the Express REST backend.
 * Endpoints will be added as features are implemented.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function getHealth() {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) {
    throw new Error('Backend health check failed');
  }
  return response.json();
}
