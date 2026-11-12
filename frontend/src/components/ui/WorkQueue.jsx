import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Skeleton from './Skeleton';

/**
 * A to-do list of work waiting for someone, one row per kind of work.
 *
 * items: [{
 *   key, icon, title,            // e.g. "3 records to decide"
 *   description?,                // one short line
 *   progress?: { done, total },  // e.g. 4 of 9 reviewed
 *   to, actionLabel?,            // where the work is done ("Continue" by default)
 *   done?: true                  // nothing waiting: shown as a quiet line
 * }]
 */
function WorkQueue({ items, loading = false, label = 'Work waiting' }) {
  if (loading) {
    return (
      <div className="ui-queue" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} variant="row" />)}
      </div>
    );
  }

  return (
    <ul className="ui-queue" aria-label={label}>
      {items.map(({ key, icon: Icon, title, description, progress, to, actionLabel = 'Continue', done }) => (
        <li key={key} className={`ui-queue__row ${done ? 'ui-queue__row--done' : ''}`.trim()}>
          {done
            ? <CheckCircle2 className="ui-queue__icon ui-queue__icon--done" aria-hidden="true" />
            : Icon && <Icon className="ui-queue__icon" aria-hidden="true" />}
          <div className="ui-queue__text">
            <p className="ui-queue__title">{title}</p>
            {description && <p className="ui-queue__description">{description}</p>}
            {progress && progress.total > 0 && (
              <progress className="ui-queue__progress" max={progress.total} value={progress.done}
                aria-label={`${progress.done} of ${progress.total} done`} />
            )}
          </div>
          {to && (
            <Link to={to} className={`ui-button ui-button--${done ? 'ghost' : 'secondary'} ui-button--sm ui-queue__action`}>
              {done ? 'Open' : actionLabel}
              <ArrowRight className="ui-button__icon" aria-hidden="true" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export default WorkQueue;
