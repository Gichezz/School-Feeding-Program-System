import { useId } from 'react';
import DateField from './DateField';
import { formatDate, toDate } from '../../utils/format';

export const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7 days' },
  { value: '30days', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

/**
 * Start and end dates (DD-MM-YYYY) for a preset, counted back from `now`.
 */
export function rangeForPreset(preset, now = new Date()) {
  const end = formatDate(now);
  const daysBack = { today: 0, '7days': 6, '30days': 29 }[preset];
  if (daysBack === undefined) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  return { start: formatDate(start), end };
}

/**
 * Date range control used by the Dashboard and Reports.
 * value: { preset, start, end } with dates as DD-MM-YYYY; onChange receives the same shape.
 */
function DateRangeFilter({ value, onChange, label = 'Date range' }) {
  const groupId = useId();
  const choosePreset = (preset) => {
    const range = rangeForPreset(preset) || { start: value.start, end: value.end };
    onChange({ preset, ...range });
  };
  const setCustom = (field, date) => {
    if (!date) return; // wait until a complete, real date is entered
    const next = { ...value, preset: 'custom', [field]: date };
    // Keep the range valid: the end can never be before the start
    if (toDate(next.end) < toDate(next.start)) {
      if (field === 'start') next.end = next.start;
      else next.start = next.end;
    }
    onChange(next);
  };

  return (
    <div className="ui-date-range">
      <span id={groupId} className="ui-date-range__label">{label}</span>
      <div className="ui-segmented" role="group" aria-labelledby={groupId}>
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="ui-segmented__option"
            aria-pressed={value.preset === preset.value}
            onClick={() => choosePreset(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="ui-date-range__custom">
          <DateField label="From" value={value.start} onChange={(date) => setCustom('start', date)} />
          <DateField label="To" value={value.end} onChange={(date) => setCustom('end', date)} />
        </div>
      )}
    </div>
  );
}

export default DateRangeFilter;
