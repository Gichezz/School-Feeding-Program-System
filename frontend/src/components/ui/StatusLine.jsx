/**
 * One line that says how things stand, with an icon and an optional action.
 * Not a banner: it is part of the page, cannot be dismissed and does not interrupt.
 *
 * tone: 'neutral' | 'warning' | 'success'
 */
function StatusLine({ icon: Icon, tone = 'neutral', action, className = '', children, ...rest }) {
  return (
    <div className={`ui-status-line ui-status-line--${tone} ${className}`.trim()} {...rest}>
      {Icon && <Icon className="ui-status-line__icon" aria-hidden="true" />}
      <p className="ui-status-line__text">{children}</p>
      {action && <div className="ui-status-line__action">{action}</div>}
    </div>
  );
}

export default StatusLine;
