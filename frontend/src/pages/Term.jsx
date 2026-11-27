import { useState } from 'react';
import { Users } from 'lucide-react';
import {
  Alert, Card, ChartCard, DataTable, FormField, PageHeader, PrintButton, PrintHeader, StatCard, StatusLine, SummaryList,
} from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import {
  COMMODITIES, COMMODITY_LABELS, NOT_FED_REASONS, averageFed, dayKey, schoolDays, stockBalances, termReport, termRequirement, todayKey,
  termName,
} from '../features/feeding/planning';
import { displayBalance } from '../features/feeding/foodStatus';
import { formatNumber, formatPercent } from '../utils/format';

function termLabel(t) {
  return termName(t);
}

/** A stock figure for a table: never below 0 kg; a gap is written out ("0 (10 kg short)"). */
function kgFigure(kg) {
  const { shownKg, shortfallKg } = displayBalance(kg);
  return shortfallKg > 0 ? `0 (${formatNumber(shortfallKg)} kg short)` : formatNumber(shownKg);
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
    { key: 'carryKg', header: 'Carried over (kg)', align: 'end', render: (r) => kgFigure(r.carryKg) },
    { key: 'requestKg', header: 'To request (kg)', align: 'end', render: (r) => <strong>{formatNumber(Math.ceil(r.requestKg))}</strong> },
  ];

  return (
    <Card title={`Food needed for ${termLabel(term)}`}
      description={`${formatNumber(need.learners)} learners · ${formatNumber(days.length)} school days`}>
      {enrolment.length === 0 && <Alert tone="warning" title="No enrolment for this term">Record this term’s enrolment first.</Alert>}
      {enrolment.length > 0 && !need.verified && (
        <Alert tone="warning" title="Enrolment not verified yet">These figures may change once it is verified.</Alert>
      )}
      {need.awaitingCheck > 0 && (
        <Alert tone="info">Changed classes count at their last verified number.</Alert>
      )}
      {need.verified && !need.allVerified && need.awaitingCheck === 0 && <Alert tone="info">Only the verified classes are counted.</Alert>}
      <DataTable caption={`Food needed for ${termLabel(term)}`} columns={columns} rows={rows} getRowKey={(r) => r.key} />
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
    { key: 'opening', header: 'Opening (kg)', align: 'end', render: (x) => kgFigure(x.opening) },
    { key: 'received', header: 'Received (kg)', align: 'end', render: (x) => formatNumber(x.received) },
    { key: 'issuedKg', header: 'Issued (kg)', align: 'end', render: (x) => formatNumber(x.issuedKg) },
    { key: 'rationKg', header: 'Ration for learners fed (kg)', align: 'end', render: (x) => formatNumber(x.rationKg) },
    { key: 'ratio', header: 'Issued vs ration', align: 'end', render: (x) => (x.ratio === null ? '–' : formatPercent(x.ratio)) },
    { key: 'closing', header: 'Closing (kg)', align: 'end', render: (x) => kgFigure(x.closing) },
  ];
  const days = [
    { key: 'notRecorded', label: 'School days not recorded', value: formatNumber(r.notRecordedDays) },
    { key: 'notFed', label: 'Days without feeding', value: formatNumber(r.notFedDays) },
    ...Object.entries(r.notFed).map(([code, n]) => ({ key: code, label: `· ${NOT_FED_REASONS[code] || code}`, value: formatNumber(n) })),
  ];
  const deliveryColumns = [
    { key: 'movementDate', header: 'Date', primary: true, nowrap: true },
    { key: 'kind', header: 'Entry', render: (d) => (d.kind === 'purchase' ? 'Bought' : 'Delivered') },
    { key: 'commodity', header: 'Food', render: (d) => COMMODITY_LABELS[d.commodity] },
    { key: 'quantityKg', header: 'Weighed (kg)', align: 'end', render: (d) => formatNumber(d.quantityKg) },
    { key: 'noteQuantityKg', header: 'On the note (kg)', align: 'end', render: (d) => (d.noteQuantityKg ? formatNumber(d.noteQuantityKg) : '–') },
    { key: 'reference', header: 'Note or receipt', nowrap: true, render: (d) => d.reference || '–' },
  ];
  const counts = COMMODITIES.filter((c) => r.lastCount[c]).map((c) => ({ key: c, commodity: COMMODITY_LABELS[c], ...r.lastCount[c] }));
  const countColumns = [
    { key: 'commodity', header: 'Food', primary: true },
    { key: 'date', header: 'Counted on', nowrap: true },
    { key: 'countedKg', header: 'Counted (kg)', align: 'end', render: (x) => formatNumber(x.countedKg) },
    { key: 'ledgerKg', header: 'Records (kg)', align: 'end', render: (x) => formatNumber(x.ledgerKg) },
    { key: 'differenceKg', header: 'Difference (kg)', align: 'end', render: (x) => `${x.differenceKg > 0 ? '+' : ''}${formatNumber(x.differenceKg)}` },
  ];

  return (
    <Card title={`Termly report: ${termLabel(term)}`} description={`${data.school?.name || ''} · ${term.opensOn} – ${term.closesOn} · figures up to ${r.upTo}`}
      actions={<PrintButton />}>
      <div className="ui-stack">
        <div className="ui-grid ui-grid--4">
          <StatCard label="Feeding days" value={`${formatNumber(r.fedDays)} of ${formatNumber(r.expectedDays)}`} />
          <StatCard label="Learners enrolled" value={formatNumber(r.enrolled)} hint={`${formatNumber(r.bySex.F)} girls, ${formatNumber(r.bySex.M)} boys`} />
          <StatCard label="Average fed" value={r.avgFed === null ? '–' : formatNumber(Math.round(r.avgFed))} hint="On days with feeding" />
          <StatCard label="Coverage" value={r.coverage === null ? '–' : formatPercent(r.coverage)} hint="Average fed ÷ enrolled" />
        </div>
        <section className="term-report__section" aria-labelledby="term-days">
          <h3 id="term-days" className="term-report__heading">School days</h3>
          <SummaryList rows={days} />
        </section>
        <section className="term-report__section" aria-labelledby="term-food">
          <h3 id="term-food" className="term-report__heading">Food</h3>
          <DataTable caption={`Food for ${termLabel(term)}`} columns={columns} rows={consumption} getRowKey={(x) => x.key} />
        </section>
        <section className="term-report__section" aria-labelledby="term-deliveries">
          <h3 id="term-deliveries" className="term-report__heading">Deliveries and purchases</h3>
          <DataTable caption="Deliveries and purchases" columns={deliveryColumns} rows={r.deliveries} getRowKey={(d) => d.id}
            emptyState={{ title: 'None this term' }} />
        </section>
        <section className="term-report__section" aria-labelledby="term-counts">
          <h3 id="term-counts" className="term-report__heading">Store counts</h3>
          <DataTable caption="Store counts" columns={countColumns} rows={counts} getRowKey={(x) => x.key}
            emptyState={{ title: 'No count this term' }} />
        </section>
      </div>
    </Card>
  );
}

/** Learners fed on each school day of the term, from this device's records. */
function FedChart({ data, term }) {
  const from = dayKey(term.opensOn);
  const to = dayKey(term.closesOn);
  const days = data.feedingDays
    .filter((d) => d.feedingHappened && dayKey(d.feedingDate) >= from && dayKey(d.feedingDate) <= to)
    .sort((a, b) => dayKey(a.feedingDate).localeCompare(dayKey(b.feedingDate)))
    .map((d) => ({ date: d.feedingDate, fed: Number(d.learnersFed) }));
  const fed = days.map((d) => d.fed);
  const summary = days.length
    ? `${formatNumber(days.length)} days with feeding. Learners fed ranged from ${formatNumber(Math.min(...fed))} to ${formatNumber(Math.max(...fed))}.`
    : undefined;
  return (
    <ChartCard title="Learners fed each school day" description={termLabel(term)} type="line" data={days} xKey="date"
      xTickFormatter={(d) => d.slice(0, 5)} summary={summary} emptyMessage="No feeding recorded in this term yet"
      series={[{ dataKey: 'fed', metric: 'fed', label: 'Learners fed' }]} />
  );
}

function TermScreens({ data }) {
  const [termId, setTermId] = useState(data.term?.id || '');
  const term = data.terms.find((t) => t.id === termId) || data.term;
  const avg = averageFed(data.feedingDays);
  return (
    <div className="ui-stack">
      <PrintHeader title={`Termly report, ${termLabel(term)}`} scope={data.school?.name} />
      <div className="no-print">
        <FormField id="term-select" label="Term" as="select" value={term.id} onChange={(e) => setTermId(e.target.value)}
          options={[...data.terms].sort((a, b) => b.year - a.year || b.term - a.term).map((t) => ({ value: t.id, label: termLabel(t) }))} />
      </div>
      <StatusLine icon={Users} className="no-print">
        Average fed, last 10 feeding days:{' '}
        <strong>{avg === null ? 'not known yet' : formatNumber(Math.round(avg))}</strong>
      </StatusLine>
      <Requirement data={data} term={term} />
      <Report data={data} term={term} />
      <FedChart data={data} term={term} />
    </div>
  );
}

function Term() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Term plan and report" />
      <SchoolGate data={data}>
        <TermScreens data={data} />
      </SchoolGate>
    </>
  );
}

export default Term;
