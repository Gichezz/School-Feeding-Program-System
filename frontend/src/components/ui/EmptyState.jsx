import { Inbox } from 'lucide-react';

/**
 * Shown when a list, table or chart has nothing to display yet.
 */
function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false }) {
  return (
    <div className={`ui-empty ${compact ? 'ui-empty--compact' : ''}`.trim()}>
      <Icon className="ui-empty__icon" aria-hidden="true" />
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
