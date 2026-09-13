/**
 * Generate a simple client/device identifier for sync metadata.
 * Persists in localStorage so the same browser keeps the same id.
 */
const STORAGE_KEY = 'sfs_client_id';

export function getClientId() {
  let clientId = localStorage.getItem(STORAGE_KEY);
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, clientId);
  }
  return clientId;
}

/**
 * Format an ISO timestamp for display or storage.
 */
export function nowIso() {
  return new Date().toISOString();
}
