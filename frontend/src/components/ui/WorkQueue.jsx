import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Skeleton from './Skeleton';
import { splitQueue } from './queueParts';

/**
 * A to-do list of work waiting for someone, one row per kind of work.
 * Work that is waiting comes first; finished rows fold into one quiet line at the end.
 *
 * items: [{
 *   key, icon, title,            // e.g. "3 records to decide"
 *   description?,                // one short line
 *   progress?: { done, total },  // e.g. 4 of 9 reviewed
 *   to, actionLabel?,            // where the work is done ("Continue" by default)
 *   done?: true                  // nothing waiting: folded into the closing line
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

  const { open, done } = splitQueue(items);

  return (
    <ul className="ui-queue" aria-label={label}>
      {open.map(({ key, icon: Icon, title, description, progress, to, actionLabel = 'Continue' }) => (
        <li key={key} className="ui-queue__row">
          {Icon && <Icon className="ui-queue__icon" aria-hidden="true" />}
          <div className="ui-queue__text">
            <p className="ui-queue__title">{title}</p>
            {description && <p className="ui-queue__description">{description}</p>}
            {progress && progress.total > 0 && (
              <progress className="ui-queue__progress" max={progress.total} value={progress.done}
                aria-label={`${progress.done} of ${progress.total} done`} />
            )}
          </div>
          {to && (
            <Link to={to} className="ui-button ui-button--secondary ui-button--sm ui-queue__action">
              {actionLabel}
              <ArrowRight className="ui-button__icon" aria-hidden="true" />
            </Link>
          )}
        </li>
      ))}
      {done.length > 0 && (
        <li className="ui-queue__row ui-queue__row--done">
          <CheckCircle2 className="ui-queue__icon ui-queue__icon--done" aria-hidden="true" />
          <p className="ui-queue__done">
            {done.map(({ key, title, to }, i) => (
              <Fragment key={key}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {to ? <Link to={to} className="ui-queue__done-link">{title}</Link> : title}
              </Fragment>
            ))}
          </p>
        </li>
      )}
    </ul>
  );
}

export default WorkQueue;
