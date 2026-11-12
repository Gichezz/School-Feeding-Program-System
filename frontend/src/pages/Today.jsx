import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, Save, Wheat } from 'lucide-react';
import {
  Alert, Button, Card, ChoiceGroup, DataTable, DateField, EmptyState, FormField, PageHeader, RecordStatus, StatusLine,
  recordStateFor, useToast,
} from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import {
  NOT_FED_REASONS, UNUSUAL_REASONS, averageFed, dayKey, foodRemaining, schoolDays, stockBalances, todayKey,
  validateFeeding, COMMODITY_LABELS,
} from '../features/feeding/planning';
import { foodStatus } from '../features/feeding/foodStatus';
import { saveDailyFeeding } from '../services/feedingDb';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatNumber, toDate, todayDate } from '../utils/format';

const SYNC_DELAY_MS = 2000;
const RECENT_DAYS = 10;

function emptyForm(schoolId, date = todayDate()) {
  return { schoolId, date, feedingHappened: '', learnersPresent: '', learnersFed: '', cerealsKg: '', pulsesKg: '', reasonCode: '', note: '', lateReason: '' };
}

function formFrom(record) {
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    schoolId: record.schoolId,
    date: record.feedingDate,
    feedingHappened: record.feedingHappened ? 'yes' : 'no',
    learnersPresent: text(record.learnersPresent),
    learnersFed: record.feedingHappened ? text(record.learnersFed) : '',
    cerealsKg: record.feedingHappened ? text(record.cerealsKg) : '',
    pulsesKg: record.feedingHappened ? text(record.pulsesKg) : '',
    reasonCode: record.reasonCode || '',
    note: record.note || '',
    lateReason: '',
  };
}

/** Why a date is not a school day in the calendar, or null when it is one (or is incomplete). */
function whyNotSchoolDay(date, terms, events) {
  if (!toDate(date)) return null;
  const key = dayKey(date);
  if (schoolDays(terms, events, key, key).length === 1) return null;
  const weekday = toDate(date).getDay();
  if (weekday === 0 || weekday === 6) return 'It is a weekend';
  const covering = (e) => key >= dayKey(e.startsOn) && key <= dayKey(e.endsOn);
  const holiday = events.find((e) => (e.kind === 'public_holiday' || e.kind === 'school_closure') && covering(e));
  if (holiday) return `It is ${holiday.name}`;
  const term = terms.find((t) => key >= dayKey(t.opensOn) && key <= dayKey(t.closesOn));
  return term ? 'It falls in the half-term break' : 'It is outside the school terms';
}

// Short lists are shown as large buttons, so every reason is visible at once
function reasonOptions(happened) {
  const reasons = happened === 'no' ? NOT_FED_REASONS : UNUSUAL_REASONS;
  return [
    ...(happened === 'no' ? [] : [{ value: '', label: 'Nothing unusual' }]),
    ...Object.entries(reasons).map(([value, label]) => ({ value, label })),
  ];
}

/**
 * The daily feeding record: whether learners were fed, how many, and the cereals and
 * pulses issued from the store. Checked on the device against the school's own enrolment
 * and stock, saved offline first and synced when there is a connection.
 */
function TodayForm({ data }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [form, setForm] = useState(() => emptyForm(data.schoolId));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const existing = data.feedingDays.find((d) => d.feedingDate === form.date);
  const existingKey = existing ? `${existing.id}:${existing.version}` : null;
  // Which saved record the form shows, so typed answers are kept when only the date changes
  const [loadedKey, setLoadedKey] = useState(null);
  useEffect(() => {
    if (existingKey === loadedKey) return;
    if (existing) setForm(formFrom(existing));
    else setForm((f) => emptyForm(data.schoolId, f.date));
    setLoadedKey(existingKey);
    setSubmitted(false);
  }, [existingKey, loadedKey, existing, data.schoolId]);

  const enrolled = useMemo(() => {
    const rows = data.enrolment.filter((e) => e.termId === data.term?.id);
    return rows.length ? rows.reduce((s, e) => s + e.learners, 0) : null;
  }, [data.enrolment, data.term]);
  // Stock before this day's issue (an edit adds back what the day issued before)
  const available = useMemo(() => {
    if (!form.date) return null;
    return stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration, upTo: dayKey(form.date), excludeDate: form.date });
  }, [data.movements, data.feedingDays, data.ration, form.date]);

  const notSchoolDay = useMemo(() => whyNotSchoolDay(form.date, data.terms, data.events), [form.date, data.terms, data.events]);
  const check = validateFeeding(form, { enrolled, available });
  const errors = submitted ? check.errors : {};
  // Warnings can be out of date on this device, so they are shown once and can be confirmed
  const warningKey = Object.values(check.warnings).join('|');
  const [confirming, setConfirming] = useState(null);
  const needsConfirm = warningKey !== '' && confirming !== warningKey;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  const choose = (name) => (value) => setForm((f) => ({ ...f, [name]: value }));

  const fed = Number(form.learnersFed);
  const rationHint = (commodity) => (form.learnersFed && Number.isFinite(fed)
    ? `Ration for ${formatNumber(fed)} learners: ${formatNumber((fed * data.ration[commodity]) / 1000)} kg`
    : `${data.ration[commodity]} g per learner`);

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(check.errors).length > 0) return;
    if (needsConfirm) {
      setConfirming(warningKey);
      return;
    }
    setSaving(true);
    try {
      await saveDailyFeeding(check.values);
      if (isOnline) setTimeout(() => { manualSync().catch(() => {}); }, SYNC_DELAY_MS);
      toast.show({
        title: `${existing ? 'Feeding updated' : 'Feeding saved'} for ${form.date}`,
        description: isOnline ? 'Saved on this device. Lishe is sending it now.' : 'Saved on this device. Lishe sends it when you are back online.',
      });
      setSubmitted(false);
      setConfirming(null);
    } finally {
      setSaving(false);
    }
  };
  const showWarnings = confirming === warningKey && warningKey !== '';

  return (
    <Card title={existing ? `Feeding on ${form.date}` : 'Record feeding'} description={data.school?.name}>
      <form className="recording__form" onSubmit={save} noValidate>
        {existing && <Alert tone="info" title="This date is already recorded">Saving will update it.</Alert>}
        {notSchoolDay && (
          <Alert tone="warning" title={`${form.date} is not a school day`}>
            {notSchoolDay}. Only record feeding if learners were fed.
          </Alert>
        )}
        {submitted && Object.keys(check.errors).length > 0 && (
          <Alert tone="danger" title="Check the highlighted answers">
            <ul className="recording__error-list">
              {Object.entries(check.errors).map(([name, message]) => <li key={name}><a href={`#today-${name}`}>{message}</a></li>)}
            </ul>
          </Alert>
        )}
        <DateField id="today-date" label="Date" required hint="DD-MM-YYYY" value={form.date}
          onChange={(date) => setForm((f) => ({ ...f, date }))} error={errors.date} />
        <ChoiceGroup id="today-feedingHappened" label="Were learners fed?" required value={form.feedingHappened}
          onChange={choose('feedingHappened')} error={errors.feedingHappened}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, not today' }]} />
        {check.late && (
          <FormField id="today-lateReason" label="Why is this being entered late?" as="textarea" rows={2} maxLength={300} required
            value={form.lateReason}
            onChange={set('lateReason')} error={errors.lateReason} />
        )}
        {form.feedingHappened === 'yes' && (
          <>
            <div className="ui-grid ui-grid--2">
              <FormField id="today-learnersFed" label="Learners fed" size="lg" type="number" inputMode="numeric" min="0" required suffix="learners"
                hint={enrolled !== null ? `${formatNumber(enrolled)} enrolled this term` : 'Record this term’s enrolment to check against it'}
                value={form.learnersFed} onChange={set('learnersFed')} error={errors.learnersFed} />
              <FormField id="today-learnersPresent" label="Learners present (optional)" size="lg" type="number" inputMode="numeric" min="0" suffix="learners"
                hint="From the class registers, if counted" value={form.learnersPresent} onChange={set('learnersPresent')} error={errors.learnersPresent} />
            </div>
            <div className="ui-grid ui-grid--2">
              <FormField id="today-cerealsKg" label="Cereals issued" size="lg" type="number" inputMode="decimal" min="0" step="0.01" required suffix="kg"
                hint={rationHint('cereals')} value={form.cerealsKg} onChange={set('cerealsKg')} error={errors.cerealsKg} />
              <FormField id="today-pulsesKg" label="Pulses issued" size="lg" type="number" inputMode="decimal" min="0" step="0.01" required suffix="kg"
                hint={rationHint('pulses')} value={form.pulsesKg} onChange={set('pulsesKg')} error={errors.pulsesKg} />
            </div>
          </>
        )}
        {form.feedingHappened && (
          <>
            <ChoiceGroup id="today-reasonCode" layout="stack" label={form.feedingHappened === 'no' ? 'Why not?' : 'Anything unusual today?'}
              required={form.feedingHappened === 'no'} value={form.reasonCode} onChange={choose('reasonCode')} error={errors.reasonCode}
              options={reasonOptions(form.feedingHappened)} />
            <FormField id="today-note" label="Note" hint={form.reasonCode === 'other' ? 'Required for “Other”' : 'Optional'} maxLength={300}
              value={form.note} onChange={set('note')} error={errors.note} />
          </>
        )}
        {showWarnings && (
          <Alert tone="warning" title="Check before saving">
            <ul className="recording__error-list">
              {Object.values(check.warnings).map((message) => <li key={message}>{message}.</li>)}
            </ul>
            If the numbers are right, save anyway. A delivery or enrolment change recorded on another device may not be here yet.
          </Alert>
        )}
        <p className="recording__note">
          {isOnline ? 'Saved on this device first, then sent straight away.' : 'You are offline. It is saved on this device and sent when you are back online.'}
        </p>
        <div className="recording__actions">
          <Button type="submit" size="lg" icon={Save} loading={saving}>
            {showWarnings ? 'Save anyway' : `${existing ? 'Save changes for' : 'Save feeding for'} ${form.date || 'this day'}`}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Recent({ data }) {
  const rows = [...data.feedingDays]
    .sort((a, b) => dayKey(b.feedingDate).localeCompare(dayKey(a.feedingDate)))
    .slice(0, RECENT_DAYS)
    .map((d) => ({ ...d, key: d.id }));
  const columns = [
    { key: 'feedingDate', header: 'Date', primary: true },
    { key: 'learnersFed', header: 'Learners fed', align: 'end', render: (r) => (r.feedingHappened ? formatNumber(r.learnersFed) : 'Not fed') },
    { key: 'cerealsKg', header: 'Cereals (kg)', align: 'end', render: (r) => formatNumber(r.cerealsKg) },
    { key: 'pulsesKg', header: 'Pulses (kg)', align: 'end', render: (r) => formatNumber(r.pulsesKg) },
    { key: 'status', header: 'Status', render: (r) => <RecordStatus state={recordStateFor(r.syncStatus)} /> },
  ];
  return (
    <Card title="Recent days" description="Newest first, from every device at the school.">
      {rows.length === 0
        ? <EmptyState icon={CalendarCheck} title="No feeding recorded yet" description="Days you record appear here." compact />
        : <DataTable caption="Recent feeding days" columns={columns} rows={rows} getRowKey={(r) => r.key} />}
    </Card>
  );
}

/**
 * One line on whether the food will last the term. Only this interrupts the day's
 * task: when food runs short, the teacher tells the head teacher, who arranges more.
 */
function FoodLine({ data }) {
  const balances = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration });
  const avg = averageFed(data.feedingDays);
  const remaining = data.term ? schoolDays(data.terms, data.events, todayKey(), dayKey(data.term.closesOn)) : [];
  const food = foodRemaining({ balances, fedPerDay: avg, ration: data.ration, remainingDays: remaining });
  const status = foodStatus({ balances, food, remainingDays: remaining.length });
  const days = (n) => (n === 1 ? '1 more school day' : `${formatNumber(n)} more school days`);
  const left = (n) => (n === 1 ? '1 school day left this term' : `${formatNumber(n)} school days left this term`);

  if (status.kind === 'incomplete') {
    return (
      <StatusLine icon={AlertTriangle} tone="warning"
        action={<Button as={Link} to="/stock" variant="secondary" size="sm">Open Stock</Button>}>
        <strong>Stock records look incomplete.</strong> More was used than received:{' '}
        {status.short.map((s) => `${formatNumber(s.shortfallKg)} kg of ${COMMODITY_LABELS[s.commodity].toLowerCase()}`).join(' and ')}.
        Record the missing delivery, or count the store.
      </StatusLine>
    );
  }
  if (status.kind === 'runsOut') {
    return (
      <StatusLine icon={AlertTriangle} tone="warning">
        <strong>Low on food:</strong> {COMMODITY_LABELS[status.commodity].toLowerCase()} for {days(status.days)}, but {left(status.remainingDays)}. Let the head teacher know.
      </StatusLine>
    );
  }
  if (status.kind === 'enough') {
    return <StatusLine icon={Wheat}>Food for <strong>{days(status.days)}</strong> · {left(status.remainingDays)}</StatusLine>;
  }
  if (status.kind === 'unknown') {
    return <StatusLine icon={Wheat}>Record feeding for a few days to see how long the food will last · {left(status.remainingDays)}</StatusLine>;
  }
  return <StatusLine icon={Wheat}>No school days are left this term.</StatusLine>;
}

function Today() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Today" description="Record whether learners were fed and the food issued from the store." />
      <SchoolGate data={data}>
        <div className="today__layout">
          <div className="today__main ui-stack">
            <FoodLine data={data} />
            <TodayForm data={data} />
          </div>
          <div className="today__side">
            <Recent data={data} />
          </div>
        </div>
      </SchoolGate>
    </>
  );
}

export default Today;
