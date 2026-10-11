const { pool } = require('../db/pool');
const { ValidationError, NotFoundError } = require('../utils/errors');
const {
  requestForecast,
  ForecastServiceUnavailableError,
} = require('../services/forecastClient');

const MIN_HORIZON_DAYS = 1;
const MAX_HORIZON_DAYS = 60;
const DEFAULT_HORIZON_DAYS = 14;
const MAX_ENROLLMENT = 20000;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a DD-MM-YYYY date into YYYY-MM-DD, or return null if it is not a real date.
 */
function parseDisplayDate(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Convert YYYY-MM-DD to DD-MM-YYYY for API responses.
 */
function toDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

/**
 * Add whole days to a YYYY-MM-DD date.
 */
function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Today's date on the server, as YYYY-MM-DD.
 */
function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function parsePositiveInteger(value, name, min, max) {
  if (!/^\d+$/.test(String(value).trim())) {
    throw new ValidationError(`${name} must be a whole number`);
  }
  const number = Number(value);
  if (number < min || number > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

function parseForecastQuery(query) {
  const { school_id: schoolId, horizon_days: horizonDays, start_date: startDate, enrollment } = query;

  if (!schoolId || !uuidRegex.test(schoolId)) {
    throw new ValidationError('A valid school_id is required');
  }

  let startIso = todayIso();
  if (startDate !== undefined) {
    startIso = parseDisplayDate(startDate);
    if (!startIso) {
      throw new ValidationError('start_date must be a valid date in DD-MM-YYYY format');
    }
  }

  return {
    schoolId,
    startIso,
    horizonDays: horizonDays === undefined
      ? DEFAULT_HORIZON_DAYS
      : parsePositiveInteger(horizonDays, 'horizon_days', MIN_HORIZON_DAYS, MAX_HORIZON_DAYS),
    enrollment: enrollment === undefined
      ? null
      : parsePositiveInteger(enrollment, 'enrollment', 1, MAX_ENROLLMENT),
  };
}

/**
 * Latest registered learner count recorded for the school, or null if none.
 */
async function getLatestEnrollment(schoolId) {
  const result = await pool.query(
    `SELECT total_registered
     FROM attendance_records
     WHERE school_id = $1
     ORDER BY attendance_date DESC
     LIMIT 1`,
    [schoolId]
  );
  return result.rows[0]?.total_registered ?? null;
}

/**
 * Replace stored forecasts for the same school, model and dates with the new ones.
 */
async function storeForecast(schoolId, modelName, forecast) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM forecast_results
       WHERE school_id = $1 AND model_name = $2 AND forecast_date = ANY($3::date[])`,
      [schoolId, modelName, forecast.map((day) => day.date)]
    );
    // Demand cannot be negative; clamp interval bounds to satisfy the table constraints.
    await client.query(
      `INSERT INTO forecast_results
       (school_id, forecast_date, predicted_meals, lower_bound, upper_bound, model_name)
       SELECT $1, d, p, l, u, $2
       FROM unnest($3::date[], $4::numeric[], $5::numeric[], $6::numeric[]) AS t(d, p, l, u)`,
      [
        schoolId,
        modelName,
        forecast.map((day) => day.date),
        forecast.map((day) => Math.max(0, day.predicted_demand)),
        forecast.map((day) => Math.max(0, day.lower_bound)),
        forecast.map((day) => Math.max(0, day.upper_bound)),
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Most recently generated stored forecast for each school day in the range.
 */
async function getStoredForecast(schoolId, startIso, endIso) {
  const result = await pool.query(
    `SELECT DISTINCT ON (forecast_date)
            to_char(forecast_date, 'YYYY-MM-DD') AS forecast_date,
            predicted_meals, lower_bound, upper_bound, model_name, generated_at
     FROM forecast_results
     WHERE school_id = $1 AND forecast_date BETWEEN $2 AND $3
     ORDER BY forecast_date, generated_at DESC`,
    [schoolId, startIso, endIso]
  );
  return result.rows.map((row) => ({
    date: toDisplayDate(row.forecast_date),
    predicted_demand: Number(row.predicted_meals),
    lower_bound: row.lower_bound === null ? null : Number(row.lower_bound),
    upper_bound: row.upper_bound === null ? null : Number(row.upper_bound),
    model_name: row.model_name,
    generated_at: row.generated_at,
  }));
}

/**
 * GET /api/forecasts
 * Meal-demand forecast for a school, fetched from the forecasting service and stored.
 * Falls back to previously stored forecasts when the service is unavailable.
 */
async function getForecast(req, res, next) {
  try {
    const { schoolId, startIso, horizonDays, enrollment } = parseForecastQuery(req.query);
    const endIso = addDays(startIso, horizonDays - 1);

    const school = await pool.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
    if (school.rows.length === 0) {
      throw new NotFoundError('School not found');
    }

    let enrollmentUsed = enrollment;
    let enrollmentSource = 'request';
    if (enrollmentUsed === null) {
      enrollmentUsed = await getLatestEnrollment(schoolId);
      enrollmentSource = enrollmentUsed === null ? 'model_default' : 'attendance_records';
    }

    let result;
    try {
      result = await requestForecast({ startDate: startIso, horizonDays, enrollment: enrollmentUsed });
    } catch (error) {
      if (!(error instanceof ForecastServiceUnavailableError)) {
        throw error;
      }
      const stored = await getStoredForecast(schoolId, startIso, endIso);
      if (stored.length === 0) {
        throw error;
      }
      return res.json({
        school_id: schoolId,
        source: 'stored',
        stale: true,
        warning: `${error.message}. Showing previously stored forecasts.`,
        start_date: toDisplayDate(startIso),
        end_date: toDisplayDate(endIso),
        horizon_days: horizonDays,
        school_days_forecast: stored.length,
        forecast: stored,
      });
    }

    let stored = true;
    try {
      await storeForecast(schoolId, result.model_name, result.forecast);
    } catch (error) {
      stored = false;
      console.error('Error storing forecast results:', error.message);
    }

    res.json({
      school_id: schoolId,
      source: 'live',
      stale: false,
      stored,
      enrollment_used: enrollmentSource === 'model_default' ? null : enrollmentUsed,
      enrollment_source: enrollmentSource,
      model: result.model,
      model_name: result.model_name,
      trained_at: result.trained_at,
      training_data_end: result.training_data_end,
      start_date: toDisplayDate(result.start_date),
      end_date: toDisplayDate(result.end_date),
      horizon_days: result.horizon_days,
      interval_width: result.interval_width,
      school_days_forecast: result.school_days_forecast,
      non_school_days_excluded: result.non_school_days_excluded,
      forecast: result.forecast.map((day) => ({ ...day, date: toDisplayDate(day.date) })),
      assumptions: result.assumptions,
      data_notice: result.data_notice,
    });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getForecast,
};
