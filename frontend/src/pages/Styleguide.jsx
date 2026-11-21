import { useState } from 'react';
import { Trash2, CloudUpload, Save, RefreshCw, Plus, Wheat, GitCompareArrows, Flag, ListChecks, Truck } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartCard,
  ChoiceGroup,
  DataTable,
  DateField,
  DateRangeFilter,
  EmptyState,
  FormField,
  PageHeader,
  PrintButton,
  RecordStatus,
  Skeleton,
  SkeletonText,
  StatCard,
  StatusLine,
  StepTrack,
  SummaryList,
  SyncStatusBar,
  TriageSection,
  WorkQueue,
  rangeForPreset,
  useToast,
} from '../components/ui';
import { formatDate, formatNumber, formatPercent } from '../utils/format';
import '../styles/styleguide.css';

/**
 * Development-only page showing every design token and shared component, with sample
 * data shaped like the daily feeding record, so the system is reviewed as one family.
 */

const COLOR_GROUPS = [
  { title: 'Brand', tokens: ['--color-brand-50', '--color-brand-100', '--color-brand-200', '--color-brand-600', '--color-brand-700', '--color-brand-800', '--color-brand-900'] },
  { title: 'Surfaces and text', tokens: ['--color-bg', '--color-surface', '--color-surface-sunken', '--color-border', '--color-border-strong', '--color-ink-subtle', '--color-ink-muted', '--color-ink'] },
  { title: 'Semantic', tokens: ['--color-success', '--color-success-bg', '--color-warning', '--color-warning-bg', '--color-danger', '--color-danger-bg', '--color-info', '--color-info-bg', '--color-neutral', '--color-neutral-bg'] },
  { title: 'Sync states', tokens: ['--color-sync-offline', '--color-sync-syncing', '--color-sync-synced', '--color-sync-failed', '--color-sync-paused'] },
  { title: 'Record status', tokens: ['--status-local', '--status-sent', '--status-waiting', '--status-hold', '--status-retry'] },
  { title: 'Chart series (one per metric)', tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-rule'] },
];
const CHART_LABELS = { '--chart-1': 'Learners fed', '--chart-2': 'Pulses', '--chart-3': 'Cereals', '--chart-rule': "A rule's threshold (dashed)" };
const TYPE_SCALE = ['4xl', '3xl', '2xl', 'xl', 'lg', 'base', 'sm', 'xs'];
const SPACING = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];
const RADII = ['sm', 'md', 'lg', 'xl', 'pill'];
const SHADOWS = ['sm', 'md', 'lg'];

// Sample data in the shapes the pages use
const DAYS = ['05-10-2026', '06-10-2026', '07-10-2026', '08-10-2026', '09-10-2026', '12-10-2026', '13-10-2026'];
const TREND = DAYS.map((date, i) => ({
  date,
  fed: [506, 513, 490, 528, 514, 495, 516][i],
  cereals: [79, 76, 79, 81, 78, 80, 75][i],
  pulses: [20, 21, 20, 22, 21, 20, 22][i],
}));
const RANKED = [
  { school: 'Jamhuri Primary', days: 3 },
  { school: 'Baraka Primary', days: 6 },
  { school: 'Amani Primary', days: 8 },
  { school: 'Kilele Primary', days: 9 },
];
const RECORDS = [
  { id: 1, date: '13-10-2026', fed: 513, cereals: 76, pulses: 21, synced: false },
  { id: 2, date: '12-10-2026', fed: 490, cereals: 79, pulses: 20, synced: true },
  { id: 3, date: '09-10-2026', fed: 528, cereals: 81, pulses: 22, synced: true },
];
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();

function Section({ title, description, children }) {
  return (
    <Card title={title} description={description}>
      <div className="sg-section">{children}</div>
    </Card>
  );
}

function Swatch({ token }) {
  return (
    <div className="sg-swatch">
      {/* The only inline style: points the swatch at the token it documents */}
      <span className="sg-swatch__color" style={{ '--sg-swatch': `var(${token})` }} />
      <code className="sg-swatch__name">{token}</code>
      {CHART_LABELS[token] && <span className="sg-swatch__note">{CHART_LABELS[token]}</span>}
    </div>
  );
}

function ChoiceSample() {
  const [fed, setFed] = useState('');
  return (
    <ChoiceGroup label="Were learners fed?" required value={fed} onChange={setFed}
      options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, not today' }]} />
  );
}

function Styleguide() {
  const toast = useToast();
  const [range, setRange] = useState({ preset: '7days', ...rangeForPreset('7days') });
  const [fed, setFed] = useState('514');
  const [date, setDate] = useState('12-10-2026');

  const columns = [
    { key: 'date', header: 'Date', primary: true, nowrap: true },
    { key: 'fed', header: 'Learners fed', align: 'end', render: (r) => formatNumber(r.fed) },
    { key: 'cereals', header: 'Cereals (kg)', align: 'end', render: (r) => formatNumber(r.cereals) },
    { key: 'pulses', header: 'Pulses (kg)', align: 'end', render: (r) => formatNumber(r.pulses) },
  ];

  return (
    <main className="sg" id="main-content">
      <PageHeader
        title="Lishe style guide"
        description="Every token and shared component in one place. Pages are built only from these."
        documentTitle="Style guide"
        actions={<Badge tone="brand">Development only</Badge>}
      />

      <div className="ui-stack">
        <Section title="Colour" description="Tokens from src/styles/tokens.css. Text pairs meet WCAG AA.">
          {COLOR_GROUPS.map((group) => (
            <div key={group.title} className="sg-group">
              <h3 className="sg-group__title">{group.title}</h3>
              <div className="sg-swatches">{group.tokens.map((t) => <Swatch key={t} token={t} />)}</div>
            </div>
          ))}
        </Section>

        <Section title="Typography" description="Lexend for headings, figures and the wordmark; Source Sans 3 for text.">
          <p className="sg-wordmark">Lishe</p>
          <p className="sg-tagline">Every meal counted, even offline.</p>
          <div className="sg-type-scale">
            {TYPE_SCALE.map((size) => (
              <p key={size} className={`sg-type sg-type--${size}`}>
                <code>--font-size-{size}</code> 514 learners fed, 78 kg of cereals issued
              </p>
            ))}
          </div>
          <p className="sg-sample">
            Numbers: {formatNumber(1520)} kg · {formatPercent(0.836)} of enrolment fed · {formatDate('2026-10-12')}
          </p>
        </Section>

        <Section title="Spacing, radius and shadow" description="4px spacing base.">
          <div className="sg-spacing">
            {SPACING.map((step) => (
              <div key={step} className="sg-spacing__row">
                <code>--space-{step}</code>
                <span className={`sg-spacing__bar sg-spacing__bar--${step}`} />
              </div>
            ))}
          </div>
          <div className="sg-shapes">
            {RADII.map((r) => <div key={r} className={`sg-shape sg-radius--${r}`}><code>--radius-{r}</code></div>)}
            {SHADOWS.map((s) => <div key={s} className={`sg-shape sg-shadow--${s}`}><code>--shadow-{s}</code></div>)}
          </div>
        </Section>

        <Section title="Buttons" description="All at least 44px tall.">
          <div className="sg-row">
            <Button icon={Save}>Save feeding</Button>
            <Button variant="secondary" icon={RefreshCw}>Sync now</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger" icon={Trash2}>Delete</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button size="lg" icon={Plus}>Large</Button>
            <Button size="sm" variant="secondary">Small</Button>
            <Button variant="secondary" icon={RefreshCw} aria-label="Refresh" />
          </div>
        </Section>

        <Section title="Badges and alerts">
          <div className="sg-row">
            <Badge>Neutral</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="success">Verified</Badge>
            <Badge tone="warning" icon={CloudUpload}>Not sent yet</Badge>
            <Badge tone="danger">Activation email failed</Badge>
            <Badge tone="info">Public holiday</Badge>
          </div>
          <div className="ui-stack sg-tight">
            <Alert tone="success" title="Saved on this device">Lishe sends it when you are online.</Alert>
            <Alert tone="warning" title="Your sign-in has expired" action={<Button size="sm" variant="secondary">Sign in again</Button>}>
              You can keep recording. Sign in again to send your records.
            </Alert>
            <Alert tone="danger" title="Could not save">More learners fed than are enrolled.</Alert>
          </div>
        </Section>

        <Section title="Toasts">
          <div className="sg-row">
            <Button variant="secondary" onClick={() => toast.show({ title: 'Feeding saved for 12-10-2026', description: 'Saved on this device. Lishe is sending it now.' })}>Success toast</Button>
            <Button variant="secondary" onClick={() => toast.show({ tone: 'info', title: 'Sync started' })}>Info toast</Button>
            <Button variant="secondary" onClick={() => toast.show({ tone: 'warning', title: '2 changes were not sent', description: 'Lishe tries again by itself.' })}>Warning toast</Button>
          </div>
        </Section>

        <Section title="Form fields" description="Large number inputs for daily entry on phones. Hints sit under the control; a unit sits inside it.">
          <div className="ui-grid ui-grid--3">
            <DateField label="Date" value={date} onChange={setDate} hint="DD-MM-YYYY on every device. Type it, or use the calendar" />
            <FormField label="School" as="select" options={[{ value: '1', label: 'Demo Primary School' }]} />
            <FormField label="Notes" placeholder="Optional" />
            <FormField label="Learners fed" size="lg" type="number" inputMode="numeric" value={fed} onChange={(e) => setFed(e.target.value)}
              suffix="learners" hint="Record this term's enrolment to check against it" required />
            <FormField label="Cereals issued" size="lg" type="number" inputMode="decimal" defaultValue="78" suffix="kg" hint="150 g per learner" required />
            <FormField label="Pulses issued" size="lg" type="number" inputMode="decimal" defaultValue="" suffix="kg" error="Enter the kilograms of pulses issued" required />
          </div>
        </Section>

        <Section title="Summary list" description="Label and value pairs, each with an optional action.">
          <SummaryList rows={[
            { key: 'date', label: 'Date', value: '12-10-2026' },
            { key: 'fed', label: 'Learners fed', value: '514 learners' },
            { key: 'cereals', label: 'Cereals issued', value: '78 kg', action: <Button variant="ghost" size="sm">Change</Button> },
          ]} />
        </Section>

        <Section title="Date range filter">
          <DateRangeFilter value={range} onChange={setRange} />
          <p className="sg-sample">Selected: {range.start} to {range.end}</p>
        </Section>

        <Section title="Stat cards" description="A label, a figure and one line of detail. 2 × 2 on phones.">
          <div className="ui-grid ui-grid--4">
            <StatCard label="Cereals" value="1,520 kg" hint="About 19 school days at 80 kg a day" />
            <StatCard label="Pulses" value="15 kg" hint="Less than a school day of food, 20 school days left. Request about 377 kg." />
            <StatCard label="Learners fed" value={formatPercent(0.836)} hint="764 of 914 enrolled, on feeding days" />
            <StatCard label="Waiting to send" value="3" hint="changes on this device" icon={CloudUpload} />
            <StatCard label="Loading example" loading />
          </div>
        </Section>

        <div className="ui-grid ui-grid--2">
          <ChartCard title="Learners fed each school day" description="Term 3 2026" type="line" data={TREND} xKey="date"
            xTickFormatter={(d) => d.slice(0, 5)} series={[{ dataKey: 'fed', metric: 'fed' }]} />
          <ChartCard title="Food issued" description="Kilograms per school day" type="bar" data={TREND} xKey="date"
            xTickFormatter={(d) => d.slice(0, 5)} series={[{ dataKey: 'cereals', metric: 'cereals' }, { dataKey: 'pulses', metric: 'pulses' }]} />
          <ChartCard title="Days of food left" description="Schools under the rule, fewest days first" type="ranked" data={RANKED}
            xKey="school" xLabel="School" summary="4 schools have under 10 school days of cereals; Jamhuri Primary has 3."
            series={[{ dataKey: 'days', metric: 'figure', label: 'School days of cereals' }]}
            referenceLine={{ value: 10, label: 'Rule: 10 days' }} />
          <ChartCard title="Empty and loading" type="line" data={[]} xKey="date" series={[{ dataKey: 'fed', metric: 'fed' }]} />
        </div>

        <Section title="Data table" description="A table on tablet and desktop, a card list on phones.">
          <DataTable caption="Feeding days" columns={columns} rows={RECORDS} isUnsynced={(r) => !r.synced} />
          <div data-density="compact">
            <DataTable caption="Compact, with search, sort and filters" noun="days" stickyFirstColumn
              columns={columns.map((c) => (c.key === 'fed' ? { ...c, sortValue: (r) => r.fed } : c))}
              rows={RECORDS}
              search={{ label: 'Search by date', textOf: (r) => [r.date] }}
              filters={[{ key: 'synced', label: 'Sent', options: [{ value: 'yes', label: 'Sent' }, { value: 'no', label: 'Not sent' }], matches: (r, v) => r.synced === (v === 'yes') }]} />
          </div>
          <DataTable caption="Empty example" columns={columns} rows={[]}
            emptyState={{ title: 'No feeding recorded yet', description: 'Days you record appear here.' }} />
          <DataTable caption="Loading example" columns={columns} rows={[]} loading />
        </Section>

        <Section title="Sync status" description="Offline is calm grey, never alarming.">
          <div className="ui-stack sg-tight">
            <SyncStatusBar state="offline" pendingCount={3} onSyncNow={() => {}} />
            <SyncStatusBar state="syncing" pendingCount={3} progress={40} onSyncNow={() => {}} />
            <SyncStatusBar state="synced" pendingCount={0} lastSyncedAt={minutesAgo(5)} onSyncNow={() => {}} />
            <SyncStatusBar state="failed" pendingCount={2} failure={{ what: '2 changes were not sent' }} onSyncNow={() => {}} />
            <SyncStatusBar state="conflict" conflictCount={1} onSyncNow={() => {}} />
            <SyncStatusBar
              variant="expanded"
              state="failed"
              pendingCount={2}
              lastSyncedAt={minutesAgo(90)}
              failure={{
                what: '2 feeding days were not sent',
                why: 'The server could not be reached.',
                fix: 'Check the connection and press Sync now. Your records are safe on this device.',
              }}
              onSyncNow={() => {}}
            />
          </div>
        </Section>

        <Section title="Record status" description="The one set of words for where a record is. Always an icon and words.">
          <div className="sg-row">
            <RecordStatus state="local" />
            <RecordStatus state="sent" />
            <RecordStatus state="waiting" />
            <RecordStatus state="hold" reason="Delivery note already recorded" />
            <RecordStatus state="retry" />
          </div>
        </Section>

        <Section title="Choice buttons" description="Short lists as large radio buttons; arrow keys move between them.">
          <ChoiceSample />
        </Section>

        <Section title="Status line and step track">
          <div className="ui-stack sg-tight">
            <StatusLine icon={Wheat}>Food for <strong>14 more school days</strong> · 34 school days left this term</StatusLine>
            <StatusLine icon={Wheat} tone="warning"><strong>Low on food:</strong> cereals for 6 more school days, but 34 school days left this term. Let the head teacher know.</StatusLine>
            <StepTrack label="Setting up this device" current="approved"
              steps={[{ key: 'setup', label: 'Set up' }, { key: 'approved', label: 'Approved' }, { key: 'ready', label: 'Ready to sign in' }]} />
          </div>
        </Section>

        <Section title="Work queue" description="Officer and administrator dashboards: what is waiting, and where to do it.">
          <WorkQueue items={[
            { key: 'conflicts', icon: GitCompareArrows, title: '2 records to decide', description: 'Changed on two devices', to: '/styleguide' },
            { key: 'weekly', icon: ListChecks, title: 'Weekly review: 4 of 9 schools reviewed', progress: { done: 4, total: 9 }, to: '/styleguide' },
            { key: 'flags', icon: Flag, title: 'No flagged records to check', done: true, to: '/styleguide' },
            { key: 'enrolment', icon: Flag, title: 'No enrolment to check', done: true, to: '/styleguide' },
          ]} />
        </Section>

        <Section title="Triage section" description="One reason to look at some schools, with its rule right under the heading.">
          <TriageSection icon={Truck} tone="warning" title="Late first delivery" count={3}
            rule="The first delivery of the term came more than 10 days after the school opened, or has not come.">
            <p className="sg-sample">Each school links to its row in All schools.</p>
          </TriageSection>
        </Section>

        <Section title="Printing">
          <PrintButton />
        </Section>

        <Section title="Empty states and skeletons">
          <div className="ui-grid ui-grid--2">
            <EmptyState title="No conflicts" description="A record changed on two devices with different numbers appears here." />
            <div className="ui-stack sg-tight">
              <Skeleton variant="stat" />
              <SkeletonText lines={3} />
              <Skeleton variant="block" />
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}

export default Styleguide;
