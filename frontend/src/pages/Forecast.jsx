import { useEffect, useState } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import ForecastChart from '../components/ForecastChart';
import { getForecast, getSchools } from '../services/api';
import { cacheSchools, getCachedSchools } from '../services/localDb';
import { cacheForecast, getCachedForecast } from '../services/forecastCache';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const HORIZONS = [7, 14, 30];

/**
 * Today's date as DD-MM-YYYY (the API date format).
 */
function todayDisplayDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${now.getFullYear()}`;
}

function toInputDate(displayDate) {
  const [day, month, year] = displayDate.split('-');
  return `${year}-${month}-${day}`;
}

function fromInputDate(inputDate) {
  const [year, month, day] = inputDate.split('-');
  return `${day}-${month}-${year}`;
}

/**
 * Weekday name for a DD-MM-YYYY date (stored forecasts do not include it).
 */
function weekdayOf(displayDate) {
  const [day, month, year] = displayDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/**
 * Meal-demand forecast page: decision support for planning meal preparation.
 */
function Forecast() {
  const isOnline = useOnlineStatus();
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState('');
  const [startDate, setStartDate] = useState(todayDisplayDate());
  const [horizonDays, setHorizonDays] = useState(14);
  const [forecast, setForecast] = useState(null);
  const [cachedAt, setCachedAt] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load schools (from the server when possible, otherwise from the offline cache)
  useEffect(() => {
    async function loadSchools() {
      let list = [];
      try {
        const response = await getSchools();
        list = response.schools || [];
        await cacheSchools(list);
      } catch {
        list = await getCachedSchools();
      }
      setSchools(list);
      if (list.length > 0) setSchoolId((current) => current || list[0].id);
      if (list.length === 0) setLoading(false);
    }
    loadSchools();
  }, []);

  useEffect(() => {
    if (!schoolId) return;

    async function showCached(reason) {
      const cached = await getCachedForecast(schoolId);
      if (cached) {
        setForecast(cached.forecast);
        setCachedAt(cached.fetchedAt);
        setNotice(`${reason} Showing the last forecast saved on this device.`);
        setError(null);
      } else {
        setForecast(null);
        setCachedAt(null);
        setNotice(null);
        setError(`${reason} No forecast has been saved on this device yet.`);
      }
    }

    async function loadForecast() {
      setLoading(true);
      setNotice(null);
      setError(null);

      if (!isOnline) {
        await showCached('You are offline.');
        setLoading(false);
        return;
      }

      try {
        const result = await getForecast({ school_id: schoolId, start_date: startDate, horizon_days: horizonDays });
        setForecast(result);
        setCachedAt(null);
        if (result.source === 'stored') {
          setNotice(result.warning || 'The forecasting service is unavailable. Showing previously stored forecasts.');
        }
        await cacheForecast(schoolId, result);
      } catch (err) {
        if (err.status >= 400 && err.status < 500) {
          // A problem with the request itself (for example a date outside the model's range)
          setForecast(null);
          setError(err.message);
        } else {
          // Network failure or server-side error: fall back to the copy on this device
          await showCached('The forecast could not be loaded from the server.');
        }
      } finally {
        setLoading(false);
      }
    }

    loadForecast();
  }, [schoolId, startDate, horizonDays, isOnline]);

  const days = forecast?.forecast || [];
  const totalMeals = days.reduce((sum, d) => sum + d.predicted_demand, 0);
  const averageMeals = days.length > 0 ? Math.round(totalMeals / days.length) : 0;
  const busiest = days.reduce((best, d) => (!best || d.predicted_demand > best.predicted_demand ? d : best), null);

  return (
    <PageIntro
      title="Meal Demand Forecast"
      purpose="Expected meals needed on upcoming school days, to support meal planning"
    >
      <section className="form-section">
        <h2>Forecast Settings</h2>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="forecast-school">School</label>
            <select id="forecast-school" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="forecast-start">Start date</label>
            <input
              id="forecast-start"
              type="date"
              value={toInputDate(startDate)}
              onChange={(e) => e.target.value && setStartDate(fromInputDate(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="forecast-horizon">Period</label>
            <select id="forecast-horizon" value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>Next {h} days</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {notice && (
        <div className="form-warning" role="status">
          {notice}
          {cachedAt && <> Saved {new Date(cachedAt).toLocaleString()}.</>}
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading forecast..." />
      ) : error ? (
        <div className="error-state">
          <h3>Forecast unavailable</h3>
          <p>{error}</p>
        </div>
      ) : forecast && (
        <>
          <section className="form-section">
            <h2>Summary</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <p className="stat-card__label">School days</p>
                <p className="stat-card__value stat-card__value--small">{days.length}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Total meals expected</p>
                <p className="stat-card__value stat-card__value--small">{totalMeals.toLocaleString()}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Average per day</p>
                <p className="stat-card__value stat-card__value--small">{averageMeals}</p>
              </div>
              <div className="stat-card">
                <p className="stat-card__label">Busiest day</p>
                <p className="stat-card__value stat-card__value--small">{busiest ? busiest.predicted_demand : '–'}</p>
                {busiest && <p className="stat-card__label">{busiest.date}</p>}
              </div>
            </div>
          </section>

          {days.length === 0 ? (
            <div className="empty-state">
              <p>There are no school days in this period (weekends, holidays or half-term).</p>
            </div>
          ) : (
            <>
              <section className="form-section">
                <h2>Expected meals per school day</h2>
                <ForecastChart days={days} />
                <p className="placeholder-note">
                  The line shows the expected number of meals; the shaded band is the likely range
                  {forecast.interval_width ? ` (${Math.round(forecast.interval_width * 100)}% interval)` : ''}.
                  Non-school days are not forecast.
                </p>
              </section>

              <section className="history-section">
                <h2>Forecast by Date</h2>
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Day</th>
                        <th>Expected meals</th>
                        <th>Likely range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td>{d.day_of_week || weekdayOf(d.date)}</td>
                          <td>{d.predicted_demand}</td>
                          <td>{d.lower_bound != null ? `${d.lower_bound} – ${d.upper_bound}` : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <section className="form-section">
            <h2>About this forecast</h2>
            <p className="placeholder-note">
              {forecast.data_notice || 'Forecasts come from a model trained on synthetic data and are a planning aid, not a guarantee.'}
            </p>
            {forecast.assumptions?.length > 0 && (
              <ul>
                {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
            )}
            {forecast.model_name && (
              <p className="placeholder-note">
                Model: {forecast.model_name}
                {forecast.training_data_end && ` · trained on data up to ${forecast.training_data_end}`}
              </p>
            )}
          </section>
        </>
      )}
    </PageIntro>
  );
}

export default Forecast;
