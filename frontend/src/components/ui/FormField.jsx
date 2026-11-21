import { useId } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Labelled form control with hint and error text wired up for assistive technology.
 * as: 'input' (default), 'select' or 'textarea'. size 'lg' gives large,
 * thumb-friendly inputs for number entry on phones.
 * The hint sits under the control, so fields side by side line up whatever their hints.
 * suffix: a unit as text ("kg") is shown inside the input; anything else (a button) beside it.
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
  const unit = typeof suffix === 'string';

  return (
    <div className={`ui-field ui-field--${size} ${error ? 'ui-field--invalid' : ''} ${className}`.replace(/\s+/g, ' ').trim()}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </label>
      <div className={`ui-field__control-row ${unit ? 'ui-field__control-row--unit' : ''}`.trim()}>
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
        {suffix && <span className={unit ? 'ui-field__unit' : 'ui-field__suffix'}>{suffix}</span>}
      </div>
      {hint && <p id={hintId} className="ui-field__hint">{hint}</p>}
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
