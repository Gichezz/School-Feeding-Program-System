import { db } from '../db';

/**
 * Local cache of the most recent meal-demand forecast per school,
 * so the last forecast stays viewable offline.
 */

/**
 * Store a forecast response from GET /api/forecasts, replacing the previous one for the school.
 */
export async function cacheForecast(schoolId, forecast) {
  try {
    const entry = { schoolId, forecast, fetchedAt: new Date().toISOString() };
    await db.forecasts.put(entry);
    return entry;
  } catch (error) {
    console.error('Error caching forecast:', error);
    return null;
  }
}

/**
 * The most recently cached forecast for the school, or null.
 * @returns {Promise<{ schoolId: string, forecast: object, fetchedAt: string } | null>}
 */
export async function getCachedForecast(schoolId) {
  try {
    return (await db.forecasts.get(schoolId)) || null;
  } catch (error) {
    console.error('Error reading cached forecast:', error);
    return null;
  }
}
