import { useEffect, useState } from 'react';
import { CalendarDays, Sigma, TrendingUp, Utensils } from 'lucide-react';
import {
  Alert,
  Card,
  ChartCard,
  DataTable,
  DateField,
  EmptyState,
  FormField,
  PageHeader,
  StatCard,
} from '../components/ui';
import { getForecast, getSchools } from '../services/api';
import { cacheSchools, getCachedSchools } from '../services/localDb';
import { cacheForecast, getCachedForecast } from '../services/forecastCache';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatDateTime, formatNumber, todayDate, toDate } from '../utils/format';

const HORIZONS = [7, 14, 30];
const shortDate = (date) => date.slice(0, 5);

/**
 * Weekday name for a DD-MM-YYYY date (stored forecasts do not include it).
 */
function weekdayOf(displayDate) {
  const date = toDate(displayDate);
  return date ? date.toLocaleDateString('en-GB', { weekday: 'long' }) : '';
}

const COLUMNS = [
  { key: 'date', header: 'Date', primary: true },
  { key: 'day', header: 'Day' },
  { key: 'predicted', header: 'Expected meals', align: 'end', render: (d) => formatNumber(d.predicted) },
  { key: 'range', header: 'Likely range', align: 'end', render: (d) => (d.lower !== null ? `${formatNumber(d.lower)} – ${formatNumber(d.upper)}` : '–') },
];

/**
 * Meal-demand forecast: decision support for planning meal preparation.
 * Data handling is unchanged: the server forecast when online, otherwise the last
 * forecast saved on this device.
 */
function Forecast() {
  const isOnline = useOnlineStatus();
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState('');
  const [startDate, setStartDate] = useState(todayDate());
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
        list = await getCachedSchools().catch(() => []);
      }
      setSchools(list);
      if (list.length > 0) setSchoolId((current) => current || list[0].id);
      if (list.length === 0) setLoading(false);
    }
    loadSchools();
  }, []);

  useEffect(() => {
    if (!schoolId || !startDate) return;

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

  const days = (forecast?.forecast || []).map((d) => ({
    date: d.date,
    day: d.day_of_week || weekdayOf(d.date),
    predicted: d.predicted_demand,
    lower: d.lower_bound ?? null,
    upper: d.upper_bound ?? null,
  }));
  const totalMeals = days.reduce((sum, d) => sum + d.predicted, 0);
  const averageMeals = days.length > 0 ? totalMeals / days.length : null;
  const busiest = days.reduce((best, d) => (!best || d.predicted > best.predicted ? d : best), null);
  const intervalLabel = forecast?.interval_width ? `${Math.round(forecast.interval_width * 100)}%` : null;
  const showResults = !error && (loading || forecast);

  return (
    <>
      <PageHeader title="Forecast" description="Expected meals on upcoming school days, to plan how much to prepare." />

      <div className="ui-stack">
        <Card>
          <div className="forecast__settings">
            <FormField
              as="select"
              label="School"
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              options={schools.map((school) => ({ value: school.id, label: school.name }))}
              disabled={schools.length === 0}
            />
            <DateField label="Start date" value={startDate} onChange={(date) => date && setStartDate(date)} />
            <FormField
              as="select"
              label="Period"
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              options={HORIZONS.map((h) => ({ value: h, label: `Next ${h} days` }))}
            />
          </div>
        </Card>

        {notice && (
          <Alert tone="neutral" title="Saved forecast">
            {notice}
            {cachedAt && <> Saved {formatDateTime(cachedAt)}.</>}
          </Alert>
        )}

        {error && !loading && (
          <Alert tone="warning" title="Forecast unavailable">{error}</Alert>
        )}

        {!loading && schools.length === 0 && (
          <EmptyState title="No schools yet" description="Sign in while online once so Lishe can load your schools." />
        )}

        {showResults && (
          <>
            <div className="ui-grid ui-grid--4">
              <StatCard label="School days" icon={CalendarDays} loading={loading} value={formatNumber(days.length)}
                hint={`In the next ${horizonDays} days`} />
              <StatCard label="Total meals expected" icon={Sigma} metric="forecast" loading={loading} value={formatNumber(totalMeals)} />
              <StatCard label="Average per day" icon={Utensils} metric="forecast" loading={loading} value={formatNumber(averageMeals)} />
              <StatCard label="Busiest day" icon={TrendingUp} metric="forecast" loading={loading}
                value={busiest ? formatNumber(busiest.predicted) : '–'}
                hint={busiest ? `${busiest.day} ${busiest.date}` : undefined} />
            </div>

            <ChartCard
              title="Expected meals per school day"
              description={intervalLabel ? `The line is the forecast; the band is the likely range (${intervalLabel}).` : 'The line is the forecast; the band is the likely range.'}
              type="band"
              height="lg"
              data={days}
              xKey="date"
              xTickFormatter={shortDate}
              labelFormatter={(date) => `${weekdayOf(date)} ${date}`}
              series={[{ dataKey: 'predicted', metric: 'forecast', label: 'Expected meals' }]}
              band={days.some((d) => d.lower !== null) ? { lowerKey: 'lower', upperKey: 'upper', metric: 'forecast', label: 'Likely range' } : undefined}
              loading={loading}
              emptyMessage="No school days in this period (weekends, holidays or half-term)"
            />

            <Card title="How to read this">
              <div className="forecast__note">
                <p>
                  The line shows how many meals Lishe expects each school day. The shaded band is the likely
                  range{intervalLabel && ` (${intervalLabel} of days should fall inside it)`}: prepare close to the line,
                  and plan for the top of the band on days when running short would be a problem.
                </p>
                <p>Weekends, holidays and half-term are not forecast.</p>
                <p className="forecast__meta">
                  {forecast?.data_notice || 'Forecasts come from a model trained on synthetic data and are a planning aid, not a guarantee.'}
                </p>
                {forecast?.assumptions?.length > 0 && (
                  <ul className="forecast__assumptions">
                    {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                  </ul>
                )}
                {forecast?.model_name && (
                  <p className="forecast__meta">
                    Model: {forecast.model_name}
                    {forecast.training_data_end && ` · trained on data up to ${forecast.training_data_end}`}
                  </p>
                )}
              </div>
            </Card>

            <Card title="Forecast by date">
              <DataTable
                caption="Forecast by date"
                columns={COLUMNS}
                rows={days}
                getRowKey={(d) => d.date}
                loading={loading}
                emptyState={{ title: 'No school days in this period', description: 'Weekends, holidays and half-term are not forecast.' }}
              />
            </Card>
          </>
        )}
      </div>
    </>
  );
}

export default Forecast;
