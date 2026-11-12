import { Check, X } from 'lucide-react';

/**
 * Filters as visible chips (never hidden in a menu). Chips in the same group are
 * alternatives; picking one again clears it. They wrap onto more lines rather than
 * being cut off.
 *
 * groups: [{ key, label, options: [{ value, label }] }]
 * value: { [groupKey]: optionValue }
 * resultText: e.g. "12 of 40 schools", announced when it changes
 */
function FilterChips({ groups, value, onChange, resultText }) {
  const active = Object.values(value).some((v) => v !== undefined && v !== '');
  const set = (group, option) => {
    onChange({ ...value, [group]: value[group] === option ? '' : option });
  };

  return (
    <div className="ui-filters">
      {groups.map((group) => (
        <div key={group.key} className="ui-filters__group" role="group" aria-label={group.label}>
          <span className="ui-filters__label" aria-hidden="true">{group.label}</span>
          <div className="ui-filters__chips">
            {group.options.map((option) => {
              const pressed = value[group.key] === option.value;
              return (
                <button key={option.value} type="button" className="ui-chip" aria-pressed={pressed}
                  onClick={() => set(group.key, option.value)}>
                  {pressed && <Check className="ui-chip__icon" aria-hidden="true" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="ui-filters__foot">
        {resultText && <p className="ui-filters__result" role="status" aria-atomic="true">{resultText}</p>}
        {active && (
          <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => onChange({})}>
            <X className="ui-button__icon" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

export default FilterChips;
