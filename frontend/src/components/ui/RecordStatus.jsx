import { RECORD_STATES } from './recordStates';

/**
 * Where a record is, in words with an icon (see recordStates.js for the five states).
 * reason: shown after "On hold", in plain words, e.g. "Delivery note already recorded".
 */
function RecordStatus({ state, reason, className = '' }) {
  const { label, icon: Icon } = RECORD_STATES[state] || RECORD_STATES.local;
  return (
    <span className={`ui-record-status ui-record-status--${state} ${className}`.trim()}>
      <Icon className="ui-record-status__icon" aria-hidden="true" />
      <span className="ui-record-status__label">
        {label}
        {reason && <span className="ui-record-status__reason">: {reason}</span>}
      </span>
    </span>
  );
}

export default RecordStatus;
