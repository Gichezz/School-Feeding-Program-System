const { ValidationError } = require('../utils/errors');

/**
 * HTTP client for the Flask review scoring service (forecasting/app.py).
 * The browser never calls it directly; the backend sends a sub-county's records and
 * stores the ranking it returns.
 */

const DEFAULT_SERVICE_URL = 'http://localhost:5001';
const DEFAULT_TIMEOUT_MS = 30000;

class ScoringServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringServiceUnavailableError';
    this.statusCode = 503;
  }
}

class ScoringServiceBadResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringServiceBadResponseError';
    this.statusCode = 502;
  }
}

// FORECASTING_* names are read too, so existing .env files keep working
function getServiceUrl() {
  return (process.env.SCORING_SERVICE_URL || process.env.FORECASTING_SERVICE_URL || DEFAULT_SERVICE_URL).replace(/\/+$/, '');
}

function getTimeoutMs() {
  const value = Number(process.env.SCORING_TIMEOUT_MS || process.env.FORECASTING_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/**
 * Score one sub-county's week. `body` is the request described in
 * forecasting/services/scoring_service.py; returns the service's response.
 */
async function requestScores(body) {
  const timeoutMs = getTimeoutMs();
  let response;
  try {
    response = await fetch(`${getServiceUrl()}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new ScoringServiceUnavailableError(`The scoring service did not respond within ${timeoutMs} ms`);
    }
    throw new ScoringServiceUnavailableError('The scoring service is not reachable');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ScoringServiceBadResponseError('The scoring service returned an invalid response');
  }
  if (response.status === 400) throw new ValidationError(result.error || 'Invalid scoring request');
  if (!response.ok) throw new ScoringServiceBadResponseError(`Scoring service error (HTTP ${response.status})`);
  if (!Array.isArray(result.items)) throw new ScoringServiceBadResponseError('The scoring service response has no ranking');
  return result;
}

/** Whether the scoring service answers its health check, within a short wait. */
async function scoringServiceReachable(timeoutMs = 2000) {
  try {
    const response = await fetch(`${getServiceUrl()}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { requestScores, scoringServiceReachable, ScoringServiceUnavailableError, ScoringServiceBadResponseError };
