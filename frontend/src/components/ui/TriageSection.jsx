import { useId } from 'react';

/**
 * One reason for an officer to look at some schools: a heading with the count, the
 * rule in plain words right under it, then whatever shows the schools (a list, a
 * chart). The rule sits where it applies, not in small print elsewhere.
 */
function TriageSection({ icon: Icon, title, count, rule, tone = 'neutral', children }) {
  const headingId = useId();
  return (
    <section className={`ui-triage ui-triage--${tone}`} aria-labelledby={headingId}>
      <header className="ui-triage__header">
        {Icon && <Icon className="ui-triage__icon" aria-hidden="true" />}
        <div className="ui-triage__heading">
          <h2 id={headingId} className="ui-triage__title">
            {title}
            {count !== undefined && <span className="ui-triage__count tabular-nums"> ({count})</span>}
          </h2>
          {rule && <p className="ui-triage__rule">{rule}</p>}
        </div>
      </header>
      <div className="ui-triage__body">{children}</div>
    </section>
  );
}

export default TriageSection;
