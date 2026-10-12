import { AlertTriangle, CheckCircle2, Info, XCircle, CircleDot } from 'lucide-react';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: CircleDot,
};

/**
 * Inline message. Danger alerts are announced immediately; others politely.
 */
function Alert({ tone = 'info', title, action, icon, className = '', children }) {
  const Icon = icon || ICONS[tone];
  return (
    <div className={`ui-alert ui-alert--${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="ui-alert__icon" aria-hidden="true" />
      <div className="ui-alert__content">
        {title && <p className="ui-alert__title">{title}</p>}
        {children && <div className="ui-alert__body">{children}</div>}
      </div>
      {action && <div className="ui-alert__action">{action}</div>}
    </div>
  );
}

export default Alert;
