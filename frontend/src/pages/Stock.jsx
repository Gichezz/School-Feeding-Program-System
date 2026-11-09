import { useState } from 'react';
import { PackagePlus, Scale, Undo2, Warehouse } from 'lucide-react';
import {
  Alert, Badge, Button, Card, DataTable, DateField, EmptyState, FormField, PageHeader, StatCard, useToast,
} from '../components/ui';
import SchoolGate from '../features/feeding/SchoolGate';
import { useSchoolData } from '../features/feeding/useSchoolData';
import {
  COMMODITIES, COMMODITY_LABELS, averageFed, dayKey, foodRemaining, schoolDays, stockBalances, todayKey,
} from '../features/feeding/planning';
import { checkEntryWindow, lateReasonError } from '../features/recording/entryWindow';
import { addStockCount, addStockMovement } from '../services/feedingDb';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatNumber, toDate, todayDate } from '../utils/format';

const SYNC_DELAY_MS = 2000;

const KINDS = {
  delivery: { label: 'Delivery received', sign: 1, reference: 'Delivery note or dispatch number' },
  purchase: { label: 'Food bought', sign: 1, reference: 'Receipt or invoice number' },
  loss: { label: 'Loss (spoiled, pests, theft)', sign: -1 },
  return: { label: 'Returned to the supplier', sign: -1 },
};

const commodityOptions = COMMODITIES.map((c) => ({ value: c, label: COMMODITY_LABELS[c] }));

function toKg(text) {
  const n = Number(text);
  return text !== '' && Number.isFinite(n) && n > 0 && Math.round(n * 100) === n * 100 ? n : null;
}

function syncSoon(isOnline) {
  if (isOnline) setTimeout(() => { manualSync().catch(() => {}); }, SYNC_DELAY_MS);
}

function Balances({ data }) {
  const balances = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration });
  const remaining = data.term ? schoolDays(data.terms, data.events, todayKey(), dayKey(data.term.closesOn)) : [];
  const food = foodRemaining({ balances, fedPerDay: averageFed(data.feedingDays), ration: data.ration, remainingDays: remaining });
  const short = food ? COMMODITIES.filter((c) => food.perCommodity[c].runsOut) : [];
  return (
    <>
      {short.length > 0 && (
        <Alert tone="warning" title="Food runs out before the term ends">
          <ul className="recording__error-list">
            {short.map((c) => {
              const p = food.perCommodity[c];
              return (
                <li key={c}>
                  {COMMODITY_LABELS[c]}: enough for {formatNumber(p.days)} more school days
                  {p.lastsUntil ? ` (until ${p.lastsUntil})` : ''}, {formatNumber(remaining.length)} remain. Request about {formatNumber(Math.ceil(p.shortKg))} kg.
                </li>
              );
            })}
          </ul>
        </Alert>
      )}
      <div className="ui-grid ui-grid--4">
        {COMMODITIES.map((c) => {
          const p = food?.perCommodity[c];
          return (
            <StatCard key={c} label={COMMODITY_LABELS[c]} value={`${formatNumber(balances[c])} kg`}
              hint={p && p.days !== null ? `About ${formatNumber(p.days)} school days at ${formatNumber(p.kgPerDay)} kg a day` : 'Record feeding to work out days left'} />
          );
        })}
      </div>
    </>
  );
}

function MovementForm({ data }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const defaultKind = data.school?.programmeType === 'cash_transfer' ? 'purchase' : 'delivery';
  const empty = { date: todayDate(), kind: defaultKind, commodity: 'cereals', quantityKg: '', noteQuantityKg: '', reference: '', supplier: '', note: '', lateReason: '' };
  const [form, setForm] = useState(empty);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  const kind = KINDS[form.kind];
  const entry = toDate(form.date) ? checkEntryWindow(form.date) : { late: false, future: false };

  const errors = {};
  if (!toDate(form.date)) errors.date = 'Enter the date as DD-MM-YYYY';
  else if (entry.future) errors.date = 'The date cannot be in the future';
  if (entry.late && lateReasonError(form.lateReason)) errors.lateReason = lateReasonError(form.lateReason);
  if (toKg(form.quantityKg) === null) errors.quantityKg = 'Enter the kilograms, more than 0, to at most 2 decimals';
  if (form.noteQuantityKg !== '' && toKg(form.noteQuantityKg) === null) errors.noteQuantityKg = 'Enter the kilograms on the note, or leave it empty';
  if (kind.reference && !form.reference.trim()) errors.reference = `Enter the ${kind.reference.toLowerCase()}`;
  if (kind.sign < 0 && !form.note.trim()) errors.note = 'Say why the food left the store';
  if (kind.sign < 0 && toKg(form.quantityKg) !== null) {
    const balance = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration })[form.commodity];
    if (toKg(form.quantityKg) > balance) errors.quantityKg = `The store has only ${formatNumber(balance)} kg of ${COMMODITY_LABELS[form.commodity].toLowerCase()}`;
  }
  const shown = submitted ? errors : {};

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await addStockMovement({
        schoolId: data.schoolId,
        movementDate: form.date,
        commodity: form.commodity,
        kind: form.kind,
        quantityKg: toKg(form.quantityKg),
        ...(kind.reference && { reference: form.reference.trim(), noteQuantityKg: toKg(form.noteQuantityKg) }),
        ...(form.supplier.trim() && { supplier: form.supplier.trim() }),
        ...(form.note.trim() && { note: form.note.trim() }),
        ...(entry.late && { lateReason: form.lateReason.trim() }),
      });
      syncSoon(isOnline);
      toast.show({ title: `${kind.label} recorded`, description: isOnline ? 'Lishe is syncing it now.' : 'It will sync when you are back online.' });
      setForm({ ...empty, kind: form.kind });
      setSubmitted(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Record food in or out" description="To fix a mistake, reverse the entry and record it again.">
      <form className="recording__form" onSubmit={save} noValidate>
        <div className="ui-grid ui-grid--3">
          <FormField id="stock-kind" label="What happened" as="select" value={form.kind} onChange={set('kind')}
            options={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))} />
          <FormField id="stock-commodity" label="Food" as="select" value={form.commodity} onChange={set('commodity')} options={commodityOptions} />
          <DateField id="stock-date" label="Date" required value={form.date} onChange={(date) => setForm((f) => ({ ...f, date }))} error={shown.date} />
        </div>
        {entry.late && (
          <FormField id="stock-lateReason" label="Reason for entering this date late" as="textarea" rows={2} maxLength={300} required
            value={form.lateReason} onChange={set('lateReason')} error={shown.lateReason} />
        )}
        <div className="ui-grid ui-grid--2">
          <FormField id="stock-quantityKg" label={kind.sign > 0 ? 'Quantity received (weighed)' : 'Quantity'} size="lg" type="number" inputMode="decimal"
            min="0" step="0.01" required suffix="kg" value={form.quantityKg} onChange={set('quantityKg')} error={shown.quantityKg} />
          {kind.reference && (
            <FormField id="stock-noteQuantityKg" label="Quantity on the note (optional)" size="lg" type="number" inputMode="decimal" min="0" step="0.01"
              suffix="kg" hint="If it differs from what was weighed" value={form.noteQuantityKg} onChange={set('noteQuantityKg')} error={shown.noteQuantityKg} />
          )}
        </div>
        {kind.reference ? (
          <div className="ui-grid ui-grid--2">
            <FormField id="stock-reference" label={kind.reference} required value={form.reference} onChange={set('reference')} error={shown.reference} maxLength={80} />
            <FormField id="stock-supplier" label="Supplier (optional)" value={form.supplier} onChange={set('supplier')} maxLength={120} />
          </div>
        ) : (
          <FormField id="stock-note" label="Why it left the store" required value={form.note} onChange={set('note')} error={shown.note} maxLength={300} />
        )}
        <div className="recording__actions">
          <Button type="submit" size="lg" icon={PackagePlus} loading={saving}>Save entry</Button>
        </div>
      </form>
    </Card>
  );
}

function CountForm({ data }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [form, setForm] = useState({ date: todayDate(), commodity: 'cereals', countedKg: '' });
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const counted = form.countedKg === '' ? null : Number(form.countedKg);
  const errors = {};
  if (!toDate(form.date)) errors.date = 'Enter the date as DD-MM-YYYY';
  if (counted === null || !Number.isFinite(counted) || counted < 0 || Math.round(counted * 100) !== counted * 100) errors.countedKg = 'Enter the kilograms counted, 0 or more';
  const shown = submitted ? errors : {};

  const save = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    const ledger = stockBalances({ movements: data.movements, feedingDays: data.feedingDays, ration: data.ration, upTo: dayKey(form.date) })[form.commodity];
    await addStockCount({ schoolId: data.schoolId, countDate: form.date, commodity: form.commodity, countedKg: counted });
    syncSoon(isOnline);
    setResult({ commodity: form.commodity, counted, ledger, difference: Math.round((counted - ledger) * 100) / 100 });
    toast.show({ title: 'Count recorded' });
    setForm((f) => ({ ...f, countedKg: '' }));
    setSubmitted(false);
  };

  return (
    <Card title="Count the store" description="Weigh the food in the store and enter what you count.">
      <form className="recording__form" onSubmit={save} noValidate>
        <div className="ui-grid ui-grid--3">
          <FormField id="count-commodity" label="Food" as="select" value={form.commodity} onChange={(e) => setForm((f) => ({ ...f, commodity: e.target.value }))} options={commodityOptions} />
          <DateField id="count-date" label="Date" required value={form.date} onChange={(date) => setForm((f) => ({ ...f, date }))} error={shown.date} />
          <FormField id="count-countedKg" label="Counted" size="lg" type="number" inputMode="decimal" min="0" step="0.01" required suffix="kg"
            value={form.countedKg} onChange={(e) => setForm((f) => ({ ...f, countedKg: e.target.value }))} error={shown.countedKg} />
        </div>
        {result && (
          <Alert tone={Math.abs(result.difference) < 0.5 ? 'success' : 'warning'} title={`${COMMODITY_LABELS[result.commodity]}: ${formatNumber(result.counted)} kg counted`}>
            The records say {formatNumber(result.ledger)} kg
            {Math.abs(result.difference) < 0.5 ? ', so the store matches.' : `: ${formatNumber(Math.abs(result.difference))} kg ${result.difference < 0 ? 'less' : 'more'} than recorded.`}
          </Alert>
        )}
        <div className="recording__actions">
          <Button type="submit" size="lg" icon={Scale}>Save count</Button>
        </div>
      </form>
    </Card>
  );
}

function Ledger({ data }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [confirming, setConfirming] = useState(null);
  const reversed = new Set(data.movements.filter((m) => m.kind === 'reversal').map((m) => m.reversesId));
  const byId = new Map(data.movements.map((m) => [m.id, m]));
  const rows = [...data.movements]
    .sort((a, b) => dayKey(b.movementDate).localeCompare(dayKey(a.movementDate)) || (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((m) => ({ ...m, key: m.id }));

  const reverse = async (entry) => {
    await addStockMovement({
      schoolId: data.schoolId, movementDate: todayDate(), commodity: entry.commodity, kind: 'reversal',
      quantityKg: Number(entry.quantityKg), reversesId: entry.id, note: `Reverses ${KINDS[entry.kind]?.label.toLowerCase() || entry.kind} of ${entry.movementDate}`,
    });
    syncSoon(isOnline);
    setConfirming(null);
    toast.show({ title: 'Entry reversed', description: 'Record the correct entry if one is needed.' });
  };

  const label = (m) => (m.kind === 'reversal'
    ? `Reversal of ${KINDS[byId.get(m.reversesId)?.kind]?.label.toLowerCase() || 'an entry'}`
    : KINDS[m.kind]?.label || m.kind);
  const signed = (m) => (m.kind === 'reversal' ? -(KINDS[byId.get(m.reversesId)?.kind]?.sign || 1) : KINDS[m.kind]?.sign || 1) * Number(m.quantityKg);

  const columns = [
    { key: 'movementDate', header: 'Date', primary: true },
    { key: 'kind', header: 'Entry', render: (m) => (<>{label(m)}{reversed.has(m.id) && <> <Badge tone="neutral">Reversed</Badge></>}</>) },
    { key: 'commodity', header: 'Food', render: (m) => COMMODITY_LABELS[m.commodity] },
    { key: 'quantityKg', header: 'Kg', align: 'end', render: (m) => `${signed(m) > 0 ? '+' : '−'}${formatNumber(Math.abs(signed(m)))}` },
    { key: 'reference', header: 'Reference', render: (m) => m.reference || m.note || '–' },
    {
      key: 'actions', header: <span className="visually-hidden">Actions</span>, align: 'end',
      render: (m) => (m.kind === 'reversal' || reversed.has(m.id) ? null : confirming === m.id ? (
        <span className="stock__confirm">
          <Button size="sm" variant="danger" onClick={() => reverse(m)}>Reverse it</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setConfirming(m.id)} aria-label={`Reverse the entry of ${m.movementDate}`}>Reverse</Button>
      )),
    },
  ];

  return (
    <Card title="Store ledger" description="Food received and removed, newest first. Daily issues come from the feeding records.">
      {rows.length === 0
        ? <EmptyState icon={Warehouse} title="No entries yet" description="Record the first delivery or purchase above." compact />
        : <DataTable caption="Store ledger" columns={columns} rows={rows} getRowKey={(r) => r.key} isUnsynced={(r) => r.syncStatus === 'pending'} />}
    </Card>
  );
}

function Stock() {
  const data = useSchoolData();
  return (
    <>
      <PageHeader title="Stock" description="What is in the store, how long it lasts, and every delivery, loss and count." />
      <SchoolGate data={data}>
        <div className="ui-stack">
          {data.heldDeliveries?.length > 0 && (
            <Alert tone="info" title={data.heldDeliveries.length === 1 ? '1 delivery is being checked' : `${data.heldDeliveries.length} deliveries are being checked`}>
              {data.heldDeliveries.map((m) => m.reference).join(', ')}: this delivery note was already recorded, so it is not in
              the store yet. If it was a second delivery, it will be added once it is confirmed.
            </Alert>
          )}
          <Balances data={data} />
          <MovementForm data={data} />
          <CountForm data={data} />
          <Ledger data={data} />
        </div>
      </SchoolGate>
    </>
  );
}

export default Stock;
