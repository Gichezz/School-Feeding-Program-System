import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ClipboardCheck, CloudOff } from 'lucide-react';
import { Alert, Button, Card, FoodIcon, FormField, LoadingRegion, SkeletonText, StatusLine, useToast } from '../components/ui';
import { getEnrolmentChecks, getReviewFlags, getSchoolFeeding, getTermAnalytics, verifyEnrolment } from '../services/api';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { lowOnFood } from '../features/analytics/analyticsData';
import { ENROLMENT_STATUS, TO_CHECK } from '../features/enrolment/checkStatus';
import { registerWeeks, termSentence } from '../features/feeding/register';
import { formatDateTime, formatNumber, formatPercent } from '../utils/format';
import { useChosenTerm } from '../hooks/useChosenTerm';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const CELL_WORDS = {
  fed: 'fed',
  not_fed: 'not fed',
  not_recorded: 'no record',
  upcoming: 'still to come',
  holiday: 'public holiday',
  half_term: 'half-term',
  closure: 'school closed',
};

function RegisterCell({ day }) {
  if (!day) return <span className="register__cell register__cell--none" aria-hidden="true" />;
  const dayNumber = Number(day.date.slice(0, 2));
  const label = `${day.date}: ${day.name || CELL_WORDS[day.kind]}${day.learnersFed !== undefined ? `, ${formatNumber(day.learnersFed)} learners` : ''}`;
  const text = {
    fed: dayNumber,
    not_fed: `✕ ${dayNumber}`,
    not_recorded: `? ${dayNumber}`,
    upcoming: dayNumber,
    holiday: 'Holiday',
    half_term: 'Half-term',
    closure: 'Closed',
  }[day.kind];
  return <span className={`register__cell register__cell--${day.kind}`} title={label} aria-label={label} role="img">{text}</span>;
}

/**
 * One school, for its programme officer: the term day by day as a feeding register,
 * the term's figures, and what is waiting (enrolment to verify, flagged records).
 * Everything comes from the school's records that have reached the server.
 */
function School() {
  const { id } = useParams();
  const { user } = useSession();
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const { refreshKey, markLoaded } = useDataFreshness();
  const [termId, setTermId] = useChosenTerm();
  const [feeding, setFeeding] = useState(null);
  const [figures, setFigures] = useState(null);
  const [enrolment, setEnrolment] = useState(null);
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const allowed = user?.role === 'programme_officer';
  const ready = allowed && isOnline;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getSchoolFeeding(id, termId ? { termId } : {});
      setFeeding(res);
      markLoaded(res.school.subCounty);
      const params = { termId: res.term.id };
      getTermAnalytics(params).then((a) => setFigures(a.schools.find((s) => s.schoolId === id) || null)).catch(() => setFigures(null));
      getEnrolmentChecks(params).then((e) => setEnrolment((e.schools || []).find((s) => s.schoolId === id) || null)).catch(() => setEnrolment(null));
      getReviewFlags('open').then((f) => setFlags((f.flags || []).filter((x) => x.school === res.school.name))).catch(() => setFlags(null));
    } catch (err) {
      setError(err.message);
    }
  }, [id, termId, markLoaded]);

  useEffect(() => {
    setFeeding(null);
    if (ready) load();
  }, [ready, load, refreshKey]);

  const weeks = useMemo(() => (feeding ? registerWeeks(feeding.days) : []), [feeding]);
  useEffect(() => { document.title = `${feeding?.school.name || 'School'} · Lishe`; }, [feeding]);

  if (!allowed) return <Navigate to="/" replace />;

  const verify = async () => {
    setVerifying(true);
    try {
      await verifyEnrolment(id, feeding.term.id);
      toast.show({ tone: 'success', title: `Enrolment verified for ${feeding.school.name}` });
      load();
    } catch (err) {
      toast.show({ tone: 'danger', title: 'Not verified', description: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const name = feeding?.school.name || 'School';
  const sentence = feeding ? termSentence(feeding.summary, feeding.days) : null;
  const toCheck = enrolment && TO_CHECK.includes(enrolment.status);

  return (
    <div data-density="compact" className="school-page">
      <nav aria-label="Breadcrumb" className="school-page__crumbs">
        <Link to="/">Dashboard</Link><span aria-hidden="true">/</span><Link to="/analytics">Analytics</Link><span aria-hidden="true">/</span><span>{name}</span>
      </nav>

      <header className="school-page__head">
        <div>
          <h1 className="school-page__title">{name}</h1>
          {feeding && (
            <p className="school-page__meta">
              {feeding.school.subCounty} · {feeding.school.programmeType === 'in_kind' ? 'receives food from the programme' : 'buys its own food'}
              {feeding.enrolled ? ` · ${formatNumber(feeding.enrolled)} learners enrolled` : ''}
            </p>
          )}
        </div>
        {feeding && (
          <div className="school-page__term">
            <FormField id="school-term" label="Term" as="select" value={termId || feeding.term.id}
              onChange={(e) => setTermId(e.target.value)}
              options={feeding.terms.map((t) => ({ value: t.id, label: t.label }))} />
          </div>
        )}
      </header>

      {!isOnline && <StatusLine icon={CloudOff}>Offline. A school’s page needs a connection.</StatusLine>}
      {error && <Alert tone="danger" title="Could not load this school">{error}</Alert>}
      {ready && !feeding && !error && <LoadingRegion label="Loading the school"><SkeletonText lines={6} /></LoadingRegion>}

      {feeding && (
        <div className="school-page__grid">
          <section aria-labelledby="register-h" className="school-page__register">
            <h2 id="register-h">Feeding register</h2>
            <p className="school-page__sentence">
              <b>{sentence.text}</b>{' '}
              {sentence.stopped && <span className="school-page__stopped">{sentence.stopped}</span>}
              {sentence.notRecorded > 0 && ` ${formatNumber(sentence.notRecorded)} school ${sentence.notRecorded === 1 ? 'day has' : 'days have'} no record.`}
            </p>
            <div className="register" role="group" aria-label={`Feeding register, ${feeding.term.label}`}>
              <span aria-hidden="true" />
              {WEEKDAYS.map((d) => <span key={d} className="register__day" aria-hidden="true">{d}</span>)}
              {weeks.map((cells, w) => (
                <div key={w} className="register__row" role="presentation">
                  <span className="register__week">Week {w + 1}</span>
                  {cells.map((day, i) => <RegisterCell key={day?.date || `${w}-${i}`} day={day} />)}
                </div>
              ))}
            </div>
            <ul className="register__key" aria-label="Key">
              <li><span className="register__swatch register__cell--fed" aria-hidden="true" />Fed (date shown)</li>
              <li><span className="register__swatch register__cell--not_fed" aria-hidden="true" />✕ Not fed</li>
              <li><span className="register__swatch register__cell--not_recorded" aria-hidden="true" />? No record</li>
              <li><span className="register__swatch register__cell--holiday" aria-hidden="true" />Holiday or break</li>
            </ul>
          </section>

          <aside className="school-page__side" aria-label="This term">
            <section>
              <h2>This term</h2>
              {figures ? (
                <dl className="school-page__facts">
                  <div><dt>Learners fed, on feeding days</dt><dd>{figures.coverage === null ? '–' : `${formatNumber(figures.meanFed)} of ${formatNumber(figures.enrolled)} (${formatPercent(figures.coverage)})`}</dd></div>
                  {figures.programmeType === 'in_kind' && (
                    <div><dt>First delivery</dt><dd>{figures.firstDelivery ? `${figures.firstDelivery}, ${figures.deliveryDaysAfterOpening === 0 ? 'on opening day' : `${formatNumber(figures.deliveryDaysAfterOpening)} ${figures.deliveryDaysAfterOpening === 1 ? 'day' : 'days'} after opening`}` : 'None yet'}</dd></div>
                  )}
                  <div>
                    <dt><FoodIcon food="cereals" className="school-page__food" />Cereals in store</dt>
                    <dd className={lowOnFood(figures) ? 'school-page__short' : undefined}>
                      {figures.cerealsInStoreKg === null ? '–' : `${formatNumber(Math.max(figures.cerealsInStoreKg, 0))} kg`}
                      {figures.daysOfFood !== null && ` · ${formatNumber(figures.daysOfFood)} school days`}
                      {lowOnFood(figures) && `, ${formatNumber(figures.schoolDaysLeft)} left in term`}
                    </dd>
                  </div>
                  <div><dt>Records</dt><dd>{figures.lastSync === null ? 'None have arrived' : figures.daysSinceSync === 0 ? `All arrived, last on ${formatDateTime(figures.lastSync).slice(0, 10)}` : `${formatNumber(figures.daysSinceSync)} days behind`}</dd></div>
                  <div><dt>Flagged records</dt><dd>{flags === null ? '–' : flags.length === 0 ? 'None open' : <Link to="/review">{formatNumber(flags.length)} to check</Link>}</dd></div>
                </dl>
              ) : <SkeletonText lines={4} />}
            </section>

            {enrolment && (
              <Card
                className={toCheck ? 'school-page__todo' : undefined}
                title={toCheck ? 'Enrolment to check' : 'Enrolment'}
              >
                <p className="school-page__todo-text">
                  {enrolment.status === 'not_entered'
                    ? `${name} has not entered its enrolment for ${feeding.term.label} yet.`
                    : `${formatNumber(enrolment.learners)} learners entered for ${feeding.term.label}: ${ENROLMENT_STATUS[enrolment.status].label.toLowerCase()}.`}
                  {toCheck && ' Compare them with the admission register; it sets the food the school can request.'}
                </p>
                <div className="school-page__actions">
                  {toCheck && <Button icon={ClipboardCheck} loading={verifying} onClick={verify}>Verify enrolment</Button>}
                  <Link to="/enrolment-checks" className="ui-button ui-button--secondary">See the classes</Link>
                </div>
              </Card>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export default School;
