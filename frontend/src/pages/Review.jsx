import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Flag, History } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  LoadingRegion,
  PageHeader,
  SkeletonText,
  SummaryList,
  useToast,
} from '../components/ui';
import { checkReviewFlag, getRecordHistory, getReviewFlags } from '../services/api';
import { ENTITY_LABELS, flagSummaryRows, historyChanges } from '../features/review/reviewData';
import { FLAGS_CHANGED_EVENT } from '../features/review/useOpenFlagCount';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatDateTime } from '../utils/format';

const MAX_NOTE_LENGTH = 500;

/**
 * Every saved version of one record: who changed what, from which device, and when.
 */
function RecordHistory({ entityType, recordId }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getRecordHistory(entityType, recordId)
      .then((res) => { if (active) setHistory(historyChanges(res.history || [])); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [entityType, recordId]);

  if (error) return <Alert tone="danger" title="Could not load the history">{error}</Alert>;
  if (!history) return <LoadingRegion label="Loading history"><SkeletonText lines={2} /></LoadingRegion>;
  return (
    <ol className="review__history">
      {history.map((entry) => (
        <li key={entry.version} className="review__history-item">
          <p className="review__history-title">
            Version {entry.version} · {entry.changedBy}
            {entry.device && <span className="review__history-meta"> on {entry.device}</span>}
          </p>
          <p className="review__history-meta">
            {formatDateTime(entry.changedAt)} · {entry.first ? 'First saved' : entry.changes.join(', ') || 'Saved again with the same numbers'}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Record review (#62), for administrators: records that look unusual are flagged, never
 * blocked. Check each against the school's paper register, then mark it checked with a
 * note of what you found.
 */
function Review() {
  const isOnline = useOnlineStatus();
  const { isAdmin } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [checking, setChecking] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setFlags((await getReviewFlags(status)).flags || []);
    } catch (err) {
      setFlags([]);
      setError(err.message);
    }
  }, [status]);

  useEffect(() => {
    setFlags(null);
    if (isOnline && isAdmin) load();
  }, [isOnline, isAdmin, load]);

  const startCheck = (flag) => {
    setChecking(flag.id);
    setNote('');
  };

  const submitCheck = async (flag) => {
    setBusy(true);
    setError(null);
    try {
      await checkReviewFlag(flag.id, note.trim() || undefined);
      toast.show({ tone: 'success', title: 'Marked as checked', description: `${ENTITY_LABELS[flag.entityType]} for ${flag.values.date} at ${flag.school}.` });
      setChecking(null);
      window.dispatchEvent(new Event(FLAGS_CHANGED_EVENT));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Record review" />
        <Alert tone="neutral" title="For administrators">Only administrators review flagged records.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Record review"
        description="Records that look unusual are saved as normal and flagged here. Check each one against the school's register."
      />

      <div className="ui-stack">
        <Card>
          <div className="ui-segmented" role="group" aria-label="Which flags to show">
            {[['open', 'To check'], ['checked', 'Checked']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="ui-segmented__option"
                aria-pressed={status === value}
                onClick={() => { setStatus(value); setHistoryFor(null); setChecking(null); }}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        {!isOnline && <Alert tone="neutral" title="You are offline">Reviewing records needs a connection.</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {isOnline && flags === null && <Card><LoadingRegion label="Loading flagged records"><SkeletonText lines={4} /></LoadingRegion></Card>}
        {flags?.length === 0 && !error && (
          <Card>
            <EmptyState
              icon={CheckCircle2}
              title={status === 'open' ? 'Nothing to check' : 'Nothing checked yet'}
              description={status === 'open'
                ? 'Records are flagged when they are captured outside school hours, entered or synced late, have more meals served than learners present, or are far from the school’s usual numbers.'
                : 'Flags you mark as checked appear here with your notes.'}
            />
          </Card>
        )}

        {flags?.map((flag) => (
          <Card key={flag.id}>
            <article className="review__item" aria-labelledby={`flag-${flag.id}`}>
              <div className="review__head">
                <Flag className={`review__icon review__icon--${flag.status}`} aria-hidden="true" />
                <div className="review__text">
                  <h2 id={`flag-${flag.id}`} className="review__title">
                    {flag.title}
                    <Badge tone={flag.status === 'open' ? 'warning' : 'success'}>{flag.status === 'open' ? 'To check' : 'Checked'}</Badge>
                  </h2>
                  <p className="review__detail">{flag.detail}</p>
                  <p className="review__record">
                    {ENTITY_LABELS[flag.entityType]} · {flag.values.date} · {flag.school}
                    {flag.version > 1 && ` · edit (version ${flag.version})`}
                  </p>
                </div>
              </div>

              <SummaryList rows={flagSummaryRows(flag)} />

              {flag.status === 'checked' && (
                <p className="review__note">
                  Checked by {flag.checkedBy || 'an administrator'} on {formatDateTime(flag.checkedAt)}
                  {flag.note ? `: ${flag.note}` : '.'}
                </p>
              )}

              {historyFor === flag.id && <RecordHistory entityType={flag.entityType} recordId={flag.recordId} />}

              {checking === flag.id ? (
                <div className="review__check">
                  <FormField
                    id={`note-${flag.id}`}
                    label="What did you find?"
                    hint="Optional. For example: matches the paper register, or the head teacher confirmed the late entry."
                    as="textarea"
                    rows={2}
                    maxLength={MAX_NOTE_LENGTH}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="review__actions">
                    <Button size="sm" icon={CheckCircle2} loading={busy} disabled={!isOnline} onClick={() => submitCheck(flag)}>
                      Mark as checked
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setChecking(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="review__actions">
                  {flag.status === 'open' && (
                    <Button size="sm" icon={CheckCircle2} disabled={!isOnline} onClick={() => startCheck(flag)}>
                      Mark as checked
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={History}
                    aria-expanded={historyFor === flag.id}
                    onClick={() => setHistoryFor(historyFor === flag.id ? null : flag.id)}
                  >
                    {historyFor === flag.id ? 'Hide history' : 'Show history'}
                  </Button>
                </div>
              )}
            </article>
          </Card>
        ))}
      </div>
    </>
  );
}

export default Review;
