import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, CloudOff, Eye, ListChecks, RefreshCw, Search } from 'lucide-react';
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
import { DECISIONS, groupBreaches, listRecord, MODES, notScoredText, reasonList, recentMondays, reviewWeeks, scoredText, weekLabel } from '../features/weeklyReview/weeks';
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
            <ul className="weekly-review__reasons" aria-label="Why it is listed">
              {reasonList(item.explanation).map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <p className="review__record">
              Most unusual day {item.topDate}
              {item.listedLastWeek && ' · also listed last week'}
            </p>
          </div>
        </div>

        {!item.decision && item.earlierDecision && (
          <p className="review__note">
            <strong>Earlier: {DECISIONS[item.earlierDecision.status].label}</strong> · week of {item.earlierDecision.week}
            <span className="weekly-review__note-text">{item.earlierDecision.note}</span>
          </p>
        )}

        {item.decision && !editing && (
          <p className="review__note">
            <strong>{decision.label}</strong> · {item.decision.reviewedBy || 'an officer'} · {formatDateTime(item.decision.reviewedAt)}
            <span className="weekly-review__note-text">{item.decision.note}</span>
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

/** The schools below the list, ranked, with their strongest reasons: folded away on screen, always on paper. */
function OtherSchools({ others, startRank }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Card title={`Other schools this week (${others.length})`}
      actions={(
        <Button variant="ghost" size="sm" className="no-print" icon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={listId}
          onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      )}>
      <table id={listId} className={`weekly-review__others ${open ? '' : 'weekly-review__others--closed'}`.trim()}>
        <caption className="visually-hidden">Other schools this week, ranked</caption>
        <thead>
          <tr><th scope="col">Rank</th><th scope="col">School</th><th scope="col">Reasons</th></tr>
        </thead>
        <tbody>
          {others.map((item, i) => (
            <tr key={item.schoolId}>
              <td className="tabular-nums">{startRank + i}</td>
              <th scope="row">{item.schoolName}</th>
              <td>
                <ul className="weekly-review__reasons">
                  {reasonList(item.explanation).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                {item.decision && <Badge tone={DECISIONS[item.decision.status].tone}>{DECISIONS[item.decision.status].label}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [firstWeek, setFirstWeek] = useState(null);
  const mondays = useMemo(
    () => reviewWeeks(new Date(), firstWeek, Object.keys(scoredWeeks)),
    [firstWeek, scoredWeeks]
  );
  // How the list has done since the term opened, from the officers' own decisions
  const record = useMemo(() => listRecord(Object.values(scoredWeeks), firstWeek), [scoredWeeks, firstWeek]);
  // Last week first: finished weeks are scored automatically, the week in progress is not
  const [week, setWeek] = useState(() => recentMondays(new Date(), 2)[1]);
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
      setFirstWeek(weeks.firstWeek || null);
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
      {list && <PrintHeader title={`Weekly review, week of ${week}`} scope={`${decided} of ${listed.length} listed schools reviewed`} />}
      <PageHeader
        title="Weekly review"
        actions={list && <PrintButton />}
      />

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
              {list ? 'Score again' : 'Score now'}
            </Button>
          </div>
          {list && (
            <p className="weekly-review__meta">
              {scoredText(list, formatDateTime(list.scoredAt))}
              {MODES[list.mode] && <> · {MODES[list.mode]}</>}
            </p>
          )}
          {record.listed > 0 && (
            <p className="weekly-review__meta">
              <strong>Since the week of {firstWeek || 'the term opening'}:</strong>{' '}
              {record.listed} listed · {record.followUp} needed follow-up · {record.explained} explained
              {record.toReview > 0 && ` · ${record.toReview} to review`}
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
              {...notScoredText(week, mondays.indexOf(week))}
            />
          </Card>
        )}

        {list && listed.length > 0 && (
          <StatusLine icon={ListChecks} tone={decided === listed.length ? 'success' : 'neutral'}>
            <strong>{decided} of {listed.length} listed schools reviewed</strong>
          </StatusLine>
        )}

        {list && listed.length === 0 && list.mode !== 'no_records' && (
          <Card>
            <EmptyState
              icon={CheckCircle2}
              title="No schools listed"
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
              <ul className="weekly-review__breaches">
                {groupBreaches(list.ruleBreaches).map((b) => (
                  <li key={b.key}>
                    <strong>{b.schoolName || 'A school'}</strong>: {b.detail}
                    <span className="weekly-review__dates"> · {b.dates.length === 1 ? b.dates[0] : `${b.dates.length} days (${b.dates.join(', ')})`}</span>
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        )}

        {others.length > 0 && <OtherSchools others={others} startRank={listed.length + 1} />}
      </div>
    </div>
  );
}

export default WeeklyReview;
