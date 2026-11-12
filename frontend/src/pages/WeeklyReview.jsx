import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, CloudOff, Eye, ListChecks, RefreshCw, Search } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChoiceGroup,
  EmptyState,
  FormField,
  LoadingRegion,
  PageHeader,
  PrintButton,
  PrintHeader,
  SkeletonText,
  StatusLine,
  useToast,
} from '../components/ui';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { decideReviewItem, getReviewList, getReviewWeeks, scoreReviewWeek } from '../services/api';
import { DECISIONS, MODES, recentMondays, scoredText, weekLabel } from '../features/weeklyReview/weeks';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatDateTime } from '../utils/format';

const MAX_NOTE_LENGTH = 500;
// A decision's badge has an icon as well as a colour
const DECISION_ICONS = { explained: CheckCircle2, follow_up: Eye };

/**
 * The officer's decision on one listed school's week: explained (what explained it) or
 * follow-up (what will be checked). A note is required either way.
 */
function DecisionForm({ item, week, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(item.decision?.status || 'explained');
  const [note, setNote] = useState(item.decision?.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!note.trim()) {
      setError('Say what explained the records, or what you will follow up.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideReviewItem(week, item.schoolId, { status, note: note.trim() });
      toast.show({ tone: 'success', title: `Marked ${DECISIONS[status].label.toLowerCase()}`, description: `${item.schoolName}, week of ${week}.` });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="weekly-review__decide">
      <ChoiceGroup id={`decision-${item.schoolId}`} label="What did you find?" value={status} onChange={setStatus}
        options={Object.entries(DECISIONS).map(([value, { label }]) => ({ value, label }))} />
      <FormField
        id={`note-${item.schoolId}`}
        label={status === 'explained' ? 'What explained it?' : 'What will you follow up?'}
        hint={status === 'explained'
          ? 'For example: sports day, visitors were fed; or the register matched on a call to the head teacher.'
          : 'For example: visit to compare the daily record with the class registers and the store.'}
        as="textarea"
        rows={2}
        required
        maxLength={MAX_NOTE_LENGTH}
        value={note}
        error={error}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="review__actions">
        <Button size="sm" icon={CheckCircle2} loading={busy} onClick={save}>Save decision</Button>
      </div>
    </div>
  );
}

function ListedSchool({ item, week, canDecide, onSaved }) {
  const [editing, setEditing] = useState(false);
  const decision = item.decision && DECISIONS[item.decision.status];

  return (
    <Card>
      <article className="review__item" aria-labelledby={`school-${item.schoolId}`}>
        <div className="review__head">
          <span className="weekly-review__rank" aria-label={`Rank ${item.rank}`}>{item.rank}</span>
          <div className="review__text">
            <h2 id={`school-${item.schoolId}`} className="review__title">
              {item.schoolName}
              <Badge tone={decision ? decision.tone : 'neutral'} icon={decision ? DECISION_ICONS[item.decision.status] || CheckCircle2 : Circle}>
                {decision ? decision.label : 'To review'}
              </Badge>
            </h2>
            <p className="review__detail">{item.explanation}</p>
            <p className="review__record">
              Most unusual day: {item.topDate}
              {item.listedLastWeek && ' · also listed last week'}
            </p>
          </div>
        </div>

        {!item.decision && item.earlierDecision && (
          <p className="review__note">
            {DECISIONS[item.earlierDecision.status].label} for the week of {item.earlierDecision.week}: {item.earlierDecision.note}.
            If the same reasons still apply, the same note may do.
          </p>
        )}

        {item.decision && !editing && (
          <p className="review__note">
            {decision.label} by {item.decision.reviewedBy || 'an officer'} on {formatDateTime(item.decision.reviewedAt)}: {item.decision.note}
          </p>
        )}

        {canDecide && (editing || !item.decision) && (
          <DecisionForm item={item} week={week} onSaved={() => { setEditing(false); onSaved(); }} />
        )}
        {canDecide && item.decision && !editing && (
          <div className="review__actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Change decision</Button>
          </div>
        )}
      </article>
    </Card>
  );
}

/**
 * Weekly review list, for programme officers (their sub-county) and administrators.
 * Each week every school is ranked by how unusual its records look against the
 * sub-county's usual pattern; the officer looks into the top few and records what they
 * found. The list says what to check first, never that anything is wrong.
 */
function WeeklyReview() {
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const toast = useToast();
  const isOfficer = user?.role === 'programme_officer';
  const allowed = isOfficer;

  const [scoredWeeks, setScoredWeeks] = useState({});
  const mondays = useMemo(() => recentMondays(new Date(), 8), []);
  // Last week first: finished weeks are scored automatically, the week in progress is not
  const [week, setWeek] = useState(mondays[1]);
  const [list, setList] = useState(undefined);
  const [error, setError] = useState(null);
  const [scoring, setScoring] = useState(false);

  const { refreshKey, markLoaded } = useDataFreshness();
  const ready = allowed && isOnline;

  const load = useCallback(async () => {
    setError(null);
    try {
      const weeks = await getReviewWeeks();
      setScoredWeeks(Object.fromEntries((weeks.weeks || []).map((w) => [w.week, w])));
      setList(await getReviewList(week));
      markLoaded();
    } catch (err) {
      if (err.status === 404) { setList(null); markLoaded(); } else { setList(null); setError(err.message); }
    }
  }, [week, markLoaded]);

  useEffect(() => {
    setList(undefined);
    if (ready) load();
  }, [ready, load, refreshKey]);

  const score = async () => {
    setScoring(true);
    setError(null);
    try {
      const result = await scoreReviewWeek(week);
      setList(result);
      toast.show({ tone: 'success', title: 'Week scored', description: `${result.items.filter((i) => i.listed).length} schools listed for the week of ${week}.` });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setScoring(false);
    }
  };

  if (!allowed) {
    return (
      <>
        <PageHeader title="Weekly review" />
        <Alert tone="neutral" title="For programme officers">Weekly review lists are for programme officers.</Alert>
      </>
    );
  }

  const listed = list?.items?.filter((i) => i.listed) || [];
  const others = list?.items?.filter((i) => !i.listed) || [];
  const decided = listed.filter((i) => i.decision).length;

  return (
    <div data-density="compact">
      <PageHeader
        title="Weekly review"
        description="Each week the schools in your sub-county are ranked by how unusual their feeding records look. Look into the top few and record what you found."
        actions={list && <PrintButton />}
      />
      {list && <PrintHeader title={`Weekly review, week of ${week}`} scope={`${decided} of ${listed.length} listed schools reviewed`} />}

      <div className="ui-stack">
        <Card className="no-print">
          <div className="weekly-review__controls">
            <FormField
              id="review-week"
              label="Week"
              as="select"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              options={mondays.map((monday, i) => ({ value: monday, label: weekLabel(monday, scoredWeeks[monday], i) }))}
            />
            <Button icon={RefreshCw} loading={scoring} disabled={!ready} onClick={score}>
              {list ? 'Score again' : 'Score this week'}
            </Button>
          </div>
          {list && (
            <p className="weekly-review__meta">
              {MODES[list.mode]} {scoredText(list, formatDateTime(list.scoredAt))}
              Late records for a recent week get it scored again automatically; decisions are kept.
            </p>
          )}
        </Card>

        {!isOnline && <StatusLine icon={CloudOff}>Offline. The weekly review list needs a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {ready && list === undefined && <Card><LoadingRegion label="Loading the week"><SkeletonText lines={4} /></LoadingRegion></Card>}
        {ready && list === null && !error && (
          <Card>
            <EmptyState
              icon={ListChecks}
              title="This week has not been scored"
              description="Each week is scored automatically once it is over and its records have synced. To see the week in progress now, score it here."
            />
          </Card>
        )}

        {list && listed.length > 0 && (
          <StatusLine icon={ListChecks} tone={decided === listed.length ? 'success' : 'neutral'}>
            <strong>{decided} of {listed.length} listed schools reviewed.</strong>{' '}
            A school is listed because its records differ from what is usual for it and for similar schools nearby;
            there is often an ordinary reason, such as a school event or a late sync.
          </StatusLine>
        )}

        {list && listed.length === 0 && list.mode !== 'no_records' && (
          <Card>
            <EmptyState
              icon={CheckCircle2}
              title="No schools listed"
              description={list.mode === 'rules_only'
                ? 'No school broke a fixed check this week. Every school is still ranked below.'
                : 'No school’s records were unusual enough to list this week. Every school is still ranked below.'}
            />
          </Card>
        )}

        {listed.map((item) => (
          <ListedSchool key={item.schoolId} item={item} week={week} canDecide={isOnline && isOfficer} onSaved={load} />
        ))}

        {list?.ruleBreaches?.length > 0 && (
          <Card>
            <section className="review__item" aria-labelledby="rule-breaches">
              <h2 id="rule-breaches" className="review__title"><Search className="review__icon" aria-hidden="true" />Fixed checks this week</h2>
              <p className="review__record">These are shown for every school, whatever its rank.</p>
              <ul className="weekly-review__breaches">
                {list.ruleBreaches.map((b) => (
                  <li key={`${b.schoolId}-${b.date}-${b.rule}`}>
                    <strong>{b.schoolName || 'A school'}</strong>, {b.date}: {b.detail}
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        )}

        {others.length > 0 && (
          <Card>
            <details className="weekly-review__others">
              <summary>Other schools this week ({others.length})</summary>
              <ol className="weekly-review__breaches" start={listed.length + 1}>
                {others.map((item) => (
                  <li key={item.schoolId}>
                    <strong>{item.schoolName}</strong>: {item.explanation}
                    {item.decision && ` (${DECISIONS[item.decision.status].label.toLowerCase()})`}
                  </li>
                ))}
              </ol>
            </details>
          </Card>
        )}
      </div>
    </div>
  );
}

export default WeeklyReview;
