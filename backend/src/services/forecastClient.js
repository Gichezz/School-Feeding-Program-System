const { ValidationError } = require('../utils/errors');

/**
 * HTTP client for the Flask forecasting service.
 * The browser never calls Flask directly; the backend proxies and stores results.
 */

const DEFAULT_SERVICE_URL = 'http://localhost:5001';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Raised when the forecasting service cannot produce a forecast right now
 * (not running, timed out, or no trained model loaded).
 */
class ForecastServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForecastServiceUnavailableError';
    this.statusCode = 503;
  }
}

/**
 * Raised when the forecasting service answers with something unusable.
 */
class ForecastServiceBadResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForecastServiceBadResponseError';
    this.statusCode = 502;
  }
}

function getServiceUrl() {
  return (process.env.FORECASTING_SERVICE_URL || DEFAULT_SERVICE_URL).replace(/\/+$/, '');
}

function getTimeoutMs() {
  const value = Number(process.env.FORECASTING_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/**
 * Request a forecast from the Flask service.
 * @param {{ startDate: string, horizonDays: number, enrollment?: number|null }} params
 *   startDate in YYYY-MM-DD format
 * @returns {Promise<object>} the Flask response body
 */
async function requestForecast({ startDate, horizonDays, enrollment }) {
  const query = new URLSearchParams({
    start_date: startDate,
    horizon_days: String(horizonDays),
  });
  if (enrollment) {
    query.set('enrollment', String(enrollment));
  }

  const url = `${getServiceUrl()}/api/forecast?${query}`;
  const timeoutMs = getTimeoutMs();

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new ForecastServiceUnavailableError(`Forecasting service did not respond within ${timeoutMs} ms`);
    }
    throw new ForecastServiceUnavailableError('Forecasting service is not reachable');
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new ForecastServiceBadResponseError('Forecasting service returned an invalid response');
  }

  if (response.status === 400) {
    throw new ValidationError(body.error || 'Invalid forecast request');
  }
  if (response.status === 503) {
    throw new ForecastServiceUnavailableError(body.error || 'Forecasting model is not available');
  }
  if (!response.ok) {
    throw new ForecastServiceBadResponseError(`Forecasting service error (HTTP ${response.status})`);
  }
  if (!Array.isArray(body.forecast)) {
    throw new ForecastServiceBadResponseError('Forecasting service response is missing forecast data');
  }

  return body;
}

module.exports = {
  requestForecast,
  ForecastServiceUnavailableError,
  ForecastServiceBadResponseError,
};
