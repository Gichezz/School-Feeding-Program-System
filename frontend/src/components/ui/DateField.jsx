import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import FormField from './FormField';
import { formatDate, fromInputDate, toDate, toInputDate } from '../../utils/format';

/**
 * Insert dashes as digits are typed: "12102026" → "12-10-2026".
 */
export function maskDate(text) {
  const digits = String(text).replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('-');
}

/**
 * A real calendar date in DD-MM-YYYY form, or null.
 */
export function parseDisplayDate(text) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!match) return null;
  const date = toDate(text);
  return date && formatDate(date) === text ? text : null;
}

/**
 * Date input that always shows DD-MM-YYYY on every device. Type the date
 * (numeric keypad, dashes added automatically) or use the calendar button, which
 * opens the device's own date picker.
 *
 * value / onChange use DD-MM-YYYY; onChange receives '' while the date is incomplete.
 */
function DateField({ label, value, onChange, hint, error, required, id: providedId, min, max, size, onBlur }) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const [draft, setDraft] = useState(value || '');
  const [blurred, setBlurred] = useState(false);
  const nativeRef = useRef(null);

  // Follow changes made outside this field (picker, form reset, editing a record)
  useEffect(() => {
    setDraft((current) => (parseDisplayDate(current) === value ? current : value || ''));
  }, [value]);

  const update = (text) => {
    const masked = maskDate(text);
    setDraft(masked);
    onChange(parseDisplayDate(masked) || '');
  };

  const openPicker = () => {
    const input = nativeRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };

  // A complete date that is not real (31-02-2026) gets its own message
  const ownError = draft.length === 10 && !parseDisplayDate(draft)
    ? 'Enter a real date, for example 12-10-2026'
    : blurred && draft.length > 0 && draft.length < 10 ? 'Enter the date as DD-MM-YYYY' : null;

  return (
    <FormField
      id={id}
      label={label}
      hint={hint || 'DD-MM-YYYY'}
      error={ownError || error}
      required={required}
      size={size}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="DD-MM-YYYY"
      maxLength={10}
      value={draft}
      onChange={(event) => update(event.target.value)}
      onBlur={(event) => { setBlurred(true); onBlur?.(event); }}
      className="ui-date-field"
      suffix={(
        <span className="ui-date-field__picker">
          <button type="button" className="ui-date-field__button" onClick={openPicker} aria-label={`Open calendar for ${label}`}>
            <CalendarDays aria-hidden="true" />
          </button>
          <input
            ref={nativeRef}
            type="date"
            className="ui-date-field__native"
            tabIndex={-1}
            aria-hidden="true"
            value={toInputDate(value)}
            min={min ? toInputDate(min) : undefined}
            max={max ? toInputDate(max) : undefined}
            onChange={(event) => {
              const picked = fromInputDate(event.target.value);
              setDraft(picked);
              onChange(picked);
            }}
          />
        </span>
      )}
    />
  );
}

export default DateField;
