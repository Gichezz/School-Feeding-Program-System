import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Alert, Badge, Button, Card, FormField, PageHeader, useToast } from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import { toCount } from '../features/recording/validation';
import { saveEnrolment } from '../services/feedingDb';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatNumber } from '../utils/format';
import { termName } from '../features/feeding/planning';
import { carriedForward } from '../features/feeding/enrolmentCarry';

const CLASSES = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
const SEXES = [['F', 'Girls'], ['M', 'Boys']];
const SYNC_DELAY_MS = 2000;

const cellKey = (schoolClass, sex) => `${schoolClass}|${sex}`;

function termLabel(t) {
  return `${termName(t)} (${t.opensOn} – ${t.closesOn})`;
}

function EnrolmentForm({ data }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [termId, setTermId] = useState(data.term?.id || '');
  const rows = useMemo(() => data.enrolment.filter((e) => e.termId === termId), [data.enrolment, termId]);
  const saved = useMemo(() => Object.fromEntries(rows.map((e) => [cellKey(e.class, e.sex), e])), [rows]);
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  // A term with no enrolment yet starts from the last term's (moved up a class into a new
  // school year), for staff to check against the register and save
  const carried = useMemo(() => carriedForward({
    terms: data.terms, enrolment: data.enrolment, termId, classes: CLASSES, sexes: SEXES.map(([s]) => s),
  }), [data.terms, data.enrolment, termId]);

  useEffect(() => {
    const start = (key) => {
      if (saved[key]) return String(saved[key].learners);
      return carried?.values[key] !== undefined ? String(carried.values[key]) : '';
    };
    setValues(Object.fromEntries(CLASSES.flatMap((c) => SEXES.map(([s]) => [cellKey(c, s), start(cellKey(c, s))]))));
    setSubmitted(false);
  }, [saved, carried]);

  const errors = Object.fromEntries(Object.entries(values)
    .filter(([, v]) => v !== '' && toCount(v) === null)
    .map(([k]) => [k, 'Whole number, 0 or more']));
  const changed = Object.entries(values).filter(([k, v]) => v !== '' && toCount(v) !== null && toCount(v) !== saved[k]?.learners);
  const total = Object.values(values).reduce((s, v) => s + (toCount(v) || 0), 0);
  const totalBy = (sex) => CLASSES.reduce((s, c) => s + (toCount(values[cellKey(c, sex)]) || 0), 0);
  const verifiedCount = rows.filter((e) => e.verified).length;

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || changed.length === 0) return;
    setSaving(true);
    try {
      for (const [key, value] of changed) {
        const [schoolClass, sex] = key.split('|');
        await saveEnrolment({ schoolId: data.schoolId, termId, class: schoolClass, sex, learners: toCount(value) });
      }
      if (isOnline) setTimeout(() => { manualSync().catch(() => {}); }, SYNC_DELAY_MS);
      toast.show({ title: 'Enrolment saved', description: 'It counts towards the food request once it is verified.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Learners on the register" description="By class and sex, from the admission register. Leave classes the school does not have empty.">
      <form className="recording__form" onSubmit={save} noValidate>
        <FormField id="enrolment-term" label="Term" as="select" value={termId} onChange={(e) => setTermId(e.target.value)}
          options={[...data.terms].sort((a, b) => b.year - a.year || b.term - a.term).map((t) => ({ value: t.id, label: termLabel(t) }))} />
        {rows.length > 0 && (
          <Alert tone={verifiedCount === rows.length ? 'success' : 'info'}>
            {verifiedCount === rows.length
              ? 'A programme officer has verified this enrolment.'
              : `${verifiedCount} of ${rows.length} entries verified. Changing a number means it is verified again.`}
          </Alert>
        )}
        {carried && (
          <Alert tone="info" title={`Filled in from ${termName(carried.fromTerm)}`}>
            {carried.promoted
              ? 'Each class has last year’s learners from the class below, and Grade 9 has left. PP1 is empty for new admissions. '
              : 'The numbers are last term’s. '}
            Check each class against the admission register, change what is different, then save.
          </Alert>
        )}
        {submitted && changed.length === 0 && Object.keys(errors).length === 0 && <Alert tone="info">Nothing has changed.</Alert>}
        <div className="enrolment__grid" role="group" aria-label="Learners by class and sex">
          <span className="enrolment__head">Class</span>
          {SEXES.map(([s, label]) => <span key={s} className="enrolment__head">{label}</span>)}
          {CLASSES.map((c) => (
            <div key={c} className="enrolment__row">
              <span className="enrolment__class">
                {c}
                {SEXES.some(([s]) => saved[cellKey(c, s)]?.verified) && <Badge tone="success">Verified</Badge>}
              </span>
              {SEXES.map(([s, label]) => (
                <FormField key={s} id={`enrolment-${c}-${s}`} label={`${c} ${label.toLowerCase()}`} className="enrolment__cell"
                  type="number" inputMode="numeric" min="0" value={values[cellKey(c, s)] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [cellKey(c, s)]: e.target.value }))}
                  error={submitted ? errors[cellKey(c, s)] : undefined} />
              ))}
            </div>
          ))}
        </div>
        <p className="recording__note">
          {formatNumber(total)} learners: {formatNumber(totalBy('F'))} girls and {formatNumber(totalBy('M'))} boys.
        </p>
        <div className="recording__actions">
          <Button type="submit" size="lg" icon={Save} loading={saving}>Save enrolment</Button>
        </div>
      </form>
    </Card>
  );
}

function Enrolment() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Enrolment" description="Learners registered each term, by class and sex. It sets the food the school can request." />
      <SchoolGate data={data}>
        <EnrolmentForm data={data} />
      </SchoolGate>
    </>
  );
}

export default Enrolment;
