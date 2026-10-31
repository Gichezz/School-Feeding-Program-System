import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Alert, Button, Card, DataTable, FormField, PageHeader, StatCard, SummaryList } from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import {
  COMMODITIES, COMMODITY_LABELS, NOT_FED_REASONS, dayKey, schoolDays, stockBalances, termReport, termRequirement, todayKey,
} from '../features/feeding/planning';
import { formatNumber, formatPercent } from '../utils/format';

function termLabel(t) {
  return `Term ${t.term} ${t.year}`;
}

/**
 * Food to request for a term: verified enrolment × the term's school days × the ration,
 * less the stock carried over from before the term opens (for a term already running,
 * the stock at its start).
 */
function Requirement({ data, term }) {
  const days = schoolDays(data.terms, data.events, dayKey(term.opensOn), dayKey(term.closesOn));
  const dayBefore = new Date(`${dayKey(term.opensOn)}T12:00:00`);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const startKey = dayKey(term.opensOn) > todayKey()
    ? todayKey()
    : `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}`;
  const carryOver = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration, upTo: startKey });
  const enrolment = data.enrolment.filter((e) => e.termId === term.id);
  const need = termRequirement({ enrolment, schoolDayCount: days.length, ration: data.ration, carryOver });
  const rows = COMMODITIES.map((c) => ({ key: c, commodity: COMMODITY_LABELS[c], grams: data.ration[c], ...need.perCommodity[c] }));
  const columns = [
    { key: 'commodity', header: 'Food', primary: true },
    { key: 'grams', header: 'Ration (g a day)', align: 'end', render: (r) => formatNumber(r.grams) },
    // Whole kilograms, rounded up like the request, so the columns add up
    { key: 'needKg', header: 'Needed (kg)', align: 'end', render: (r) => formatNumber(Math.ceil(r.needKg)) },
    { key: 'carryKg', header: 'In store (kg)', align: 'end', render: (r) => formatNumber(r.carryKg) },
    { key: 'requestKg', header: 'To request (kg)', align: 'end', render: (r) => <strong>{formatNumber(Math.ceil(r.requestKg))}</strong> },
  ];

  return (
    <Card title={`Food needed for ${termLabel(term)}`}
      description={`${formatNumber(need.learners)} learners × ${formatNumber(days.length)} school days × the ration, less the food already in the store.`}>
      {enrolment.length === 0 && <Alert tone="warning" title="No enrolment for this term">Record this term’s enrolment first.</Alert>}
      {enrolment.length > 0 && !need.verified && (
        <Alert tone="warning" title="Enrolment not verified yet">These figures use the school’s own count. The request counts only once a programme officer verifies the enrolment.</Alert>
      )}
      {need.verified && !need.allVerified && <Alert tone="info">Only the verified classes are counted.</Alert>}
      <DataTable caption={`Food needed for ${termLabel(term)}`} columns={columns} rows={rows} getRowKey={(r) => r.key} />
      <p className="recording__note">
        School days come from the Ministry calendar: weekdays in the term, less half-term, public holidays and school closures.
      </p>
    </Card>
  );
}

function Report({ data, term }) {
  const r = termReport({ term, terms: data.terms, events: data.events, feedingDays: data.feedingDays, enrolment: data.enrolment, movements: data.movements, counts: data.counts, ration: data.ration });
  const consumption = COMMODITIES.map((c) => ({
    key: c, commodity: COMMODITY_LABELS[c], ...r.consumption[c],
    opening: r.opening[c], received: r.received[c], closing: r.closing[c],
  }));
  const columns = [
    { key: 'commodity', header: 'Food', primary: true },
    { key: 'opening', header: 'Opening (kg)', align: 'end', render: (x) => formatNumber(x.opening) },
    { key: 'received', header: 'Received (kg)', align: 'end', render: (x) => formatNumber(x.received) },
    { key: 'issuedKg', header: 'Issued (kg)', align: 'end', render: (x) => formatNumber(x.issuedKg) },
    { key: 'rationKg', header: 'Ration for learners fed (kg)', align: 'end', render: (x) => formatNumber(x.rationKg) },
    { key: 'ratio', header: 'Issued vs ration', align: 'end', render: (x) => (x.ratio === null ? '–' : formatPercent(x.ratio)) },
    { key: 'closing', header: 'Closing (kg)', align: 'end', render: (x) => formatNumber(x.closing) },
  ];
  const notFed = Object.entries(r.notFed).map(([code, n]) => `${NOT_FED_REASONS[code] || code}: ${n}`).join('; ');
  const counts = COMMODITIES.filter((c) => r.lastCount[c]).map((c) => ({
    key: c, label: COMMODITY_LABELS[c],
    value: `${formatNumber(r.lastCount[c].countedKg)} kg counted on ${r.lastCount[c].date}; records said ${formatNumber(r.lastCount[c].ledgerKg)} kg (${r.lastCount[c].differenceKg > 0 ? '+' : ''}${formatNumber(r.lastCount[c].differenceKg)} kg)`,
  }));

  return (
    <Card title={`Termly report: ${termLabel(term)}`} description={`${data.school?.name || ''} · ${term.opensOn} – ${term.closesOn} · figures up to ${r.upTo}`}
      actions={<Button variant="secondary" icon={Printer} onClick={() => window.print()} className="no-print">Print or save as PDF</Button>}>
      <div className="ui-stack">
        <div className="ui-grid ui-grid--4">
          <StatCard label="Feeding days" value={`${formatNumber(r.fedDays)} of ${formatNumber(r.expectedDays)}`} hint="School days so far in the term" />
          <StatCard label="Learners enrolled" value={formatNumber(r.enrolled)} hint={`${formatNumber(r.bySex.F)} girls, ${formatNumber(r.bySex.M)} boys`} />
          <StatCard label="Average fed" value={r.avgFed === null ? '–' : formatNumber(Math.round(r.avgFed))} hint="On days with feeding" />
          <StatCard label="Coverage" value={r.coverage === null ? '–' : formatPercent(r.coverage)} hint="Average fed ÷ enrolled" />
        </div>
        <SummaryList rows={[
          { key: 'notFed', label: 'Days without feeding', value: r.notFedDays ? `${r.notFedDays} (${notFed})` : 'None' },
          { key: 'notRecorded', label: 'School days not recorded', value: formatNumber(r.notRecordedDays) },
          { key: 'deliveries', label: 'Deliveries and purchases', value: r.deliveries.length ? r.deliveries.map((d) => `${d.movementDate} ${COMMODITY_LABELS[d.commodity]} ${formatNumber(d.quantityKg)} kg (${d.reference || 'no reference'})`).join('; ') : 'None' },
          ...(counts.length ? counts : [{ key: 'counts', label: 'Stock counts', value: 'No physical count this term' }]),
        ]} />
        <DataTable caption={`Food for ${termLabel(term)}`} columns={columns} rows={consumption} getRowKey={(x) => x.key} />
      </div>
    </Card>
  );
}

function TermScreens({ data }) {
  const [termId, setTermId] = useState(data.term?.id || '');
  const term = data.terms.find((t) => t.id === termId) || data.term;
  return (
    <div className="ui-stack">
      <div className="no-print">
        <FormField id="term-select" label="Term" as="select" value={term.id} onChange={(e) => setTermId(e.target.value)}
          options={[...data.terms].sort((a, b) => b.year - a.year || b.term - a.term).map((t) => ({ value: t.id, label: termLabel(t) }))} />
      </div>
      <Requirement data={data} term={term} />
      <Report data={data} term={term} />
    </div>
  );
}

function Term() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Term" description="The food to request for a term, and the termly report from this device's records." />
      <SchoolGate data={data}>
        <TermScreens data={data} />
      </SchoolGate>
    </>
  );
}

export default Term;
