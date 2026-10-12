import { useId } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Labelled form control with hint and error text wired up for assistive technology.
 * as: 'input' (default), 'select' or 'textarea'. size 'lg' gives large,
 * thumb-friendly inputs for number entry on phones.
 */
function FormField({
  label,
  hint,
  error,
  required = false,
  as = 'input',
  size = 'md',
  options,
  suffix,
  id: providedId,
  className = '',
  ...controlProps
}) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const Control = as;

  return (
    <div className={`ui-field ui-field--${size} ${error ? 'ui-field--invalid' : ''} ${className}`.replace(/\s+/g, ' ').trim()}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </label>
      {hint && <p id={hintId} className="ui-field__hint">{hint}</p>}
      <div className="ui-field__control-row">
        <Control
          id={id}
          className="ui-field__control"
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...controlProps}
        >
          {/* Only selects take children; inputs are void elements */}
          {as === 'select'
            ? options?.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
            ))
            : undefined}
        </Control>
        {suffix && <span className="ui-field__suffix">{suffix}</span>}
      </div>
      {error && (
        <p id={errorId} className="ui-field__error">
          <AlertCircle className="ui-field__error-icon" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export default FormField;
