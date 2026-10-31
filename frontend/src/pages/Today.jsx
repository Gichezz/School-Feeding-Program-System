import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Save } from 'lucide-react';
import {
  Alert, Badge, Button, Card, DataTable, DateField, EmptyState, FormField, PageHeader, StatCard, useToast,
} from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import {
  NOT_FED_REASONS, UNUSUAL_REASONS, averageFed, dayKey, foodRemaining, schoolDays, stockBalances, todayKey,
  validateFeeding, COMMODITY_LABELS,
} from '../features/feeding/planning';
import { saveDailyFeeding } from '../services/feedingDb';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatNumber, toDate, todayDate } from '../utils/format';

const SYNC_DELAY_MS = 2000;
const RECENT_DAYS = 10;

const STATUS = {
  pending: { tone: 'neutral', label: 'Not yet synced' },
  synced: { tone: 'success', label: 'Synced' },
  conflict: { tone: 'danger', label: 'Conflict' },
  held: { tone: 'warning', label: 'Held for review' },
};

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

function reasonOptions(happened) {
  const reasons = happened === 'no' ? NOT_FED_REASONS : UNUSUAL_REASONS;
  return [
    { value: '', label: happened === 'no' ? 'Choose the reason' : 'Nothing unusual' },
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
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));

  const fed = Number(form.learnersFed);
  const rationHint = (commodity) => (form.learnersFed && Number.isFinite(fed)
    ? `Ration for ${formatNumber(fed)} learners: ${formatNumber((fed * data.ration[commodity]) / 1000)} kg`
    : `${data.ration[commodity]} g per learner`);

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(check.errors).length > 0) return;
    setSaving(true);
    try {
      await saveDailyFeeding(check.values);
      if (isOnline) setTimeout(() => { manualSync().catch(() => {}); }, SYNC_DELAY_MS);
      toast.show({
        title: existing ? 'Feeding record updated' : 'Feeding recorded',
        description: isOnline ? 'Lishe is syncing it now.' : 'Saved on this device. It will sync when you are back online.',
      });
      setSubmitted(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={existing ? `Feeding on ${form.date}` : 'Record feeding'} description={data.school?.name}>
      <form className="recording__form" onSubmit={save} noValidate>
        {existing && <Alert tone="info" title="This date is already recorded">Saving changes it; the change is kept in the record's history.</Alert>}
        {notSchoolDay && (
          <Alert tone="warning" title={`${form.date} is not a school day`}>
            {notSchoolDay}. Record feeding for it only if learners really were fed (for example a holiday feeding programme).
          </Alert>
        )}
        {submitted && Object.keys(check.errors).length > 0 && (
          <Alert tone="danger" title="Check the highlighted answers">
            <ul className="recording__error-list">
              {Object.entries(check.errors).map(([name, message]) => <li key={name}><a href={`#today-${name}`}>{message}</a></li>)}
            </ul>
          </Alert>
        )}
        <div className="ui-grid ui-grid--2">
          <DateField id="today-date" label="Date" required hint="DD-MM-YYYY" value={form.date}
            onChange={(date) => setForm((f) => ({ ...f, date }))} error={errors.date} />
          <FormField id="today-feedingHappened" label="Were learners fed?" as="select" required value={form.feedingHappened}
            onChange={set('feedingHappened')} error={errors.feedingHappened}
            options={[{ value: '', label: 'Choose' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, not today' }]} />
        </div>
        {check.late && (
          <FormField id="today-lateReason" label="Reason for entering this date late" as="textarea" rows={2} maxLength={300} required
            hint="A programme officer checks late entries against the register." value={form.lateReason}
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
          <div className="ui-grid ui-grid--2">
            <FormField id="today-reasonCode" label={form.feedingHappened === 'no' ? 'Why not?' : 'Anything unusual today?'} as="select"
              required={form.feedingHappened === 'no'} value={form.reasonCode} onChange={set('reasonCode')} error={errors.reasonCode}
              options={reasonOptions(form.feedingHappened)} />
            <FormField id="today-note" label="Note" hint={form.reasonCode === 'other' ? 'Required for “Other”' : 'Optional'} maxLength={300}
              value={form.note} onChange={set('note')} error={errors.note} />
          </div>
        )}
        <p className="recording__note">
          {isOnline ? 'Saved on this device and synced straight away.' : 'You are offline. Saved on this device and synced when you are back online.'}
        </p>
        <div className="recording__actions">
          <Button type="submit" size="lg" icon={Save} loading={saving}>{existing ? 'Save changes' : 'Save'}</Button>
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
    { key: 'status', header: 'Status', render: (r) => <Badge tone={(STATUS[r.syncStatus] || STATUS.pending).tone}>{(STATUS[r.syncStatus] || STATUS.pending).label}</Badge> },
  ];
  return (
    <Card title="Recent days" description="Newest first, from every device at the school.">
      {rows.length === 0
        ? <EmptyState icon={CalendarCheck} title="No feeding recorded yet" description="Days you record appear here." compact />
        : <DataTable caption="Recent feeding days" columns={columns} rows={rows} getRowKey={(r) => r.key} isUnsynced={(r) => r.syncStatus === 'pending'} />}
    </Card>
  );
}

function Summary({ data }) {
  const balances = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration });
  const avg = averageFed(data.feedingDays);
  const remaining = data.term ? schoolDays(data.terms, data.events, todayKey(), dayKey(data.term.closesOn)) : [];
  const food = foodRemaining({ balances, fedPerDay: avg, ration: data.ration, remainingDays: remaining });
  const limiting = food?.limiting ? food.perCommodity[food.limiting] : null;
  return (
    <div className="ui-grid ui-grid--3">
      <StatCard label="Learners fed (10-day average)" value={avg === null ? '–' : formatNumber(Math.round(avg))} hint="Used to plan food" />
      <StatCard label="Days of food left" value={limiting ? formatNumber(limiting.days) : '–'}
        hint={limiting ? `${COMMODITY_LABELS[food.limiting]} runs out first` : 'Record feeding to work this out'} />
      <StatCard label="School days left this term" value={formatNumber(remaining.length)} hint={data.term ? `Term ${data.term.term} closes ${data.term.closesOn}` : undefined} />
    </div>
  );
}

function Today() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Today" description="Record whether learners were fed and the food issued from the store." />
      <SchoolGate data={data}>
        <div className="ui-stack">
          <Summary data={data} />
          <TodayForm data={data} />
          <Recent data={data} />
        </div>
      </SchoolGate>
    </>
  );
}

export default Today;
