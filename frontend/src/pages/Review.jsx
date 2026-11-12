import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, Flag, History } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterChips,
  FormField,
  LoadingRegion,
  PageHeader,
  SkeletonText,
  StatusLine,
  SummaryList,
  useToast,
} from '../components/ui';
import { checkReviewFlag, getRecordHistory, getReviewFlags } from '../services/api';
import { flagSummaryRows, historyChanges, recordHeading } from '../features/review/reviewData';
import { useResolvesConflicts } from '../features/conflicts/useServerConflictCount';
import { FLAGS_CHANGED_EVENT } from '../features/review/useOpenFlagCount';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useDataFreshness } from '../hooks/useDataFreshness';
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
 * Record review (#62), for programme officers (their sub-county):
 * records that look unusual are flagged, never blocked. Check each against the school's
 * register or store book, then mark it checked with a note of what you found.
 */
function Review() {
  const isOnline = useOnlineStatus();
  const reviews = useResolvesConflicts();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [school, setSchool] = useState('');
  const { refreshKey, markLoaded } = useDataFreshness();
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
      markLoaded();
    } catch (err) {
      setFlags([]);
      setError(err.message);
    }
  }, [status, markLoaded]);

  useEffect(() => {
    setFlags(null);
    if (isOnline && reviews) load();
  }, [isOnline, reviews, load, refreshKey]);

  const startCheck = (flag) => {
    setChecking(flag.id);
    setNote('');
  };

  const submitCheck = async (flag) => {
    setBusy(true);
    setError(null);
    try {
      await checkReviewFlag(flag.id, note.trim() || undefined);
      toast.show({ tone: 'success', title: 'Marked as checked', description: `${recordHeading(flag)} at ${flag.school}.` });
      setChecking(null);
      window.dispatchEvent(new Event(FLAGS_CHANGED_EVENT));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!reviews) {
    return (
      <>
        <PageHeader title="Record review" />
        <Alert tone="neutral" title="For programme officers">Programme officers review flagged records.</Alert>
      </>
    );
  }

  const schools = [...new Set((flags || []).map((f) => f.school))].sort();
  const shown = (flags || []).filter((f) => !school || f.school === school);

  return (
    <div data-density="compact">
      <PageHeader
        title="Record review"
        description="Records that look unusual are saved as normal and flagged here. Check each one against the school's register."
      />

      <div className="ui-stack">
        <Card>
          <FilterChips
            groups={[
              { key: 'status', label: 'Show', options: [{ value: 'open', label: 'To check' }, { value: 'checked', label: 'Checked' }] },
              ...(schools.length > 1 ? [{ key: 'school', label: 'School', options: schools.map((name) => ({ value: name, label: name })) }] : []),
            ]}
            value={{ status, school }}
            onChange={(next) => {
              // There is always a list to show: clearing goes back to the records to check
              const nextStatus = next.status || 'open';
              if (nextStatus !== status) { setStatus(nextStatus); setSchool(''); setHistoryFor(null); setChecking(null); }
              else setSchool(next.school || '');
            }}
            resultText={flags ? `${shown.length} ${shown.length === 1 ? 'record' : 'records'}` : undefined}
          />
        </Card>

        {!isOnline && <StatusLine icon={CloudOff}>Offline. Reviewing records needs a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {isOnline && flags === null && <Card><LoadingRegion label="Loading flagged records"><SkeletonText lines={4} /></LoadingRegion></Card>}
        {flags?.length === 0 && !error && (
          <Card>
            <EmptyState
              icon={CheckCircle2}
              title={status === 'open' ? 'Nothing to check' : 'Nothing checked yet'}
              description={status === 'open'
                ? 'Records that look unusual appear here.'
                : 'Flags you mark as checked appear here with your notes.'}
            />
          </Card>
        )}

        {shown.map((flag) => (
          <Card key={flag.id}>
            <article className="review__item" aria-labelledby={`flag-${flag.id}`}>
              <div className="review__head">
                <Flag className={`review__icon review__icon--${flag.status}`} aria-hidden="true" />
                <div className="review__text">
                  <h2 id={`flag-${flag.id}`} className="review__title">
                    {flag.title}
                    <Badge tone={flag.status === 'open' ? 'warning' : 'success'} icon={flag.status === 'open' ? Flag : CheckCircle2}>
                      {flag.status === 'open' ? 'To check' : 'Checked'}
                    </Badge>
                  </h2>
                  <p className="review__detail">{flag.detail}</p>
                  <p className="review__record">
                    {recordHeading(flag)} · {flag.school}
                    {flag.version > 1 && ' · edited'}
                  </p>
                </div>
              </div>

              <SummaryList rows={flagSummaryRows(flag)} />

              {flag.status === 'checked' && (
                <p className="review__note">
                  Checked by {flag.checkedBy || 'a programme officer'} on {formatDateTime(flag.checkedAt)}
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
    </div>
  );
}

export default Review;
