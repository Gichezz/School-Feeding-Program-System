import { describe, expect, it } from 'vitest';
import { cacheForecast, getCachedForecast } from './forecastCache';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

function forecastResponse(predicted) {
  return {
    school_id: SCHOOL_ID,
    source: 'live',
    start_date: '12-10-2026',
    forecast: [{ date: '12-10-2026', predicted_demand: predicted, lower_bound: predicted - 30, upper_bound: predicted + 30 }],
  };
}

describe('forecast cache', () => {
  it('returns null when nothing is cached for the school', async () => {
    expect(await getCachedForecast(SCHOOL_ID)).toBeNull();
  });

  it('stores the forecast with the time it was fetched', async () => {
    await cacheForecast(SCHOOL_ID, forecastResponse(520));

    const cached = await getCachedForecast(SCHOOL_ID);

    expect(cached).toMatchObject({ schoolId: SCHOOL_ID, forecast: forecastResponse(520) });
    expect(new Date(cached.fetchedAt).toString()).not.toBe('Invalid Date');
  });

  it('keeps only the most recent forecast per school', async () => {
    await cacheForecast(SCHOOL_ID, forecastResponse(520));
    await cacheForecast(SCHOOL_ID, forecastResponse(540));

    const cached = await getCachedForecast(SCHOOL_ID);

    expect(cached.forecast.forecast[0].predicted_demand).toBe(540);
  });

  it('keeps forecasts for different schools apart', async () => {
    await cacheForecast(SCHOOL_ID, forecastResponse(520));
    await cacheForecast('other-school', forecastResponse(300));

    expect((await getCachedForecast(SCHOOL_ID)).forecast.forecast[0].predicted_demand).toBe(520);
    expect((await getCachedForecast('other-school')).forecast.forecast[0].predicted_demand).toBe(300);
  });
});
