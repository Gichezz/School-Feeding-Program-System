/**
 * Browser environment for one simulated school device (sync evaluation, #72).
 *
 * Imported before any app module, so the PWA's own code runs unchanged in Node:
 *   - IndexedDB comes from fake-indexeddb (one private database per device process);
 *   - localStorage, window (events) and navigator.onLine are provided;
 *   - fetch goes through a controllable network: offline, slow, or flaky (requests that
 *     never reach the server, and responses lost after the server applied the change).
 * Every /sync response is timed per operation, so latency is measured at the moment the
 * device learns the outcome.
 */
import 'fake-indexeddb/auto';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

globalThis.window = new EventTarget();

export const network = {
  baseUrl: 'http://localhost:5065',
  mode: 'online', // 'online' | 'offline'
  delayMs: 0,
  dropRequest: 0, // share of requests that never reach the server
  dropResponse: 0, // share of responses lost after the server handled the request
  random: Math.random,
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { get onLine() { return network.mode !== 'offline'; }, userAgent: 'sync-evaluation' },
});

/** Seeded random numbers (mulberry32), so a run can be repeated exactly. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per operation: when the device received its final answer, and what it was
export const outcomes = new Map();
export const traffic = { requests: 0, droppedRequests: 0, lostResponses: 0, syncRequests: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = globalThis.fetch;

function offlineError() {
  // What a browser's fetch throws when there is no connection
  return new TypeError('Failed to fetch');
}

globalThis.fetch = async (input, options = {}) => {
  const url = String(input).startsWith('/') ? `${network.baseUrl}${input}` : String(input);
  traffic.requests += 1;
  if (network.mode === 'offline') throw offlineError();
  if (network.delayMs) await sleep(network.delayMs / 2);
  if (network.random() < network.dropRequest) {
    traffic.droppedRequests += 1;
    throw offlineError();
  }

  const response = await realFetch(url, options);
  const isSync = url.endsWith('/api/sync') && options.method === 'POST';
  let body = null;
  if (isSync) {
    traffic.syncRequests += 1;
    body = await response.clone().json().catch(() => null);
  }
  if (network.delayMs) await sleep(network.delayMs / 2);
  if (network.random() < network.dropResponse) {
    // The server has already applied the change; the device never hears about it
    traffic.lostResponses += 1;
    throw offlineError();
  }
  if (isSync && body?.results) {
    const receivedAt = performance.now();
    for (const result of body.results) {
      if (result.status === 'synced' || result.status === 'conflict') {
        outcomes.set(result.operationId, { status: result.status, receivedAt });
      }
    }
  }
  return response;
};
