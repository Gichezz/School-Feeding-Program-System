/**
 * Small status label. Tones: neutral, brand, success, warning, danger, info.
 */
function Badge({ tone = 'neutral', icon: Icon, className = '', children, ...rest }) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()} {...rest}>
      {Icon && <Icon className="ui-badge__icon" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Badge;
