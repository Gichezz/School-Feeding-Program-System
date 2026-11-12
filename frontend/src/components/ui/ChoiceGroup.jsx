import { useId } from 'react';
import { AlertCircle, Check } from 'lucide-react';

/**
 * A short list of choices (two to about six) shown as large buttons, so every
 * option is visible and one tap picks it. It is a real radio group: arrow keys move
 * between options, and the selected one has a check mark and bold text as well as
 * a coloured border, so it does not rely on colour.
 *
 * options: [{ value, label, hint? }]
 * layout: 'row' (side by side where they fit) or 'stack' (one per line)
 */
function ChoiceGroup({
  id: providedId,
  name,
  label,
  hint,
  error,
  required = false,
  options,
  value,
  onChange,
  layout = 'row',
  className = '',
}) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset
      id={id}
      className={`ui-choice ui-choice--${layout} ${error ? 'ui-choice--invalid' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      aria-describedby={describedBy}
    >
      <legend className="ui-field__label">
        {label}
        {required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </legend>
      {hint && <p id={hintId} className="ui-field__hint">{hint}</p>}
      <div className="ui-choice__options">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const checked = value === option.value;
          return (
            <label key={option.value} htmlFor={optionId} className={`ui-choice__option ${checked ? 'ui-choice__option--checked' : ''}`.trim()}>
              <input
                id={optionId}
                type="radio"
                name={name || id}
                value={option.value}
                checked={checked}
                required={required}
                aria-invalid={error ? true : undefined}
                onChange={() => onChange(option.value)}
                className="ui-choice__input"
              />
              <span className="ui-choice__mark" aria-hidden="true">{checked && <Check />}</span>
              <span className="ui-choice__text">
                <span className="ui-choice__label">{option.label}</span>
                {option.hint && <span className="ui-choice__hint">{option.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="ui-field__error">
          <AlertCircle className="ui-field__error-icon" aria-hidden="true" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

export default ChoiceGroup;
