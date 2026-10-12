/**
 * Key–value summary for "check your answers" steps.
 * rows: [{ key, label, value, action? }]
 */
function SummaryList({ rows }) {
  return (
    <dl className="ui-summary">
      {rows.map((row) => (
        <div key={row.key} className="ui-summary__row">
          <dt className="ui-summary__label">{row.label}</dt>
          <dd className="ui-summary__value">{row.value}</dd>
          {row.action && <dd className="ui-summary__action">{row.action}</dd>}
        </div>
      ))}
    </dl>
  );
}

export default SummaryList;
