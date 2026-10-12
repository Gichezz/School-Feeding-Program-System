import { useState } from 'react';
import { CalendarCheck, Utensils, Trash2, CloudUpload, Save, RefreshCw, Plus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartCard,
  DataTable,
  DateRangeFilter,
  EmptyState,
  FormField,
  PageHeader,
  Skeleton,
  SkeletonText,
  StatCard,
  SyncStatusBar,
  rangeForPreset,
  useToast,
} from '../components/ui';
import { formatDate, formatNumber, formatPercent, formatDelta } from '../utils/format';
import '../styles/styleguide.css';

/**
 * Development-only page showing every design token and shared component, so the
 * system can be reviewed as one family before pages are rebuilt (issue #40).
 */

const COLOR_GROUPS = [
  { title: 'Brand', tokens: ['--color-brand-50', '--color-brand-100', '--color-brand-200', '--color-brand-600', '--color-brand-700', '--color-brand-800', '--color-brand-900'] },
  { title: 'Surfaces and text', tokens: ['--color-bg', '--color-surface', '--color-surface-sunken', '--color-border', '--color-border-strong', '--color-ink-subtle', '--color-ink-muted', '--color-ink'] },
  { title: 'Semantic', tokens: ['--color-success', '--color-success-bg', '--color-warning', '--color-warning-bg', '--color-danger', '--color-danger-bg', '--color-info', '--color-info-bg', '--color-neutral', '--color-neutral-bg'] },
  { title: 'Sync states', tokens: ['--color-sync-offline', '--color-sync-syncing', '--color-sync-synced', '--color-sync-failed'] },
  { title: 'Chart series (one per metric)', tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4'] },
];
const CHART_LABELS = { '--chart-1': 'Attendance / present', '--chart-2': 'Meals served', '--chart-3': 'Meals prepared', '--chart-4': 'Forecast' };
const TYPE_SCALE = ['4xl', '3xl', '2xl', 'xl', 'lg', 'base', 'sm', 'xs'];
const SPACING = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];
const RADII = ['sm', 'md', 'lg', 'xl', 'pill'];
const SHADOWS = ['sm', 'md', 'lg'];

// Sample data in the shapes the pages use
const DAYS = ['05-10-2026', '06-10-2026', '07-10-2026', '08-10-2026', '09-10-2026', '12-10-2026', '13-10-2026'];
const TREND = DAYS.map((date, i) => ({
  date,
  present: [571, 580, 566, 590, 585, 560, 588][i],
  prepared: [600, 600, 590, 600, 600, 590, 600][i],
  served: [568, 579, 560, 589, 582, 555, 586][i],
}));
const FORECAST = ['14-10-2026', '15-10-2026', '16-10-2026', '19-10-2026', '21-10-2026', '22-10-2026', '23-10-2026'].map((date, i) => {
  const predicted = [530, 533, 526, 532, 536, 535, 529][i];
  return { date, predicted, lower: predicted - 16, upper: predicted + 16 };
});
const RECORDS = [
  { id: 1, date: '13-10-2026', registered: 600, present: 588, absent: 12, synced: false },
  { id: 2, date: '12-10-2026', registered: 600, present: 560, absent: 40, synced: true },
  { id: 3, date: '09-10-2026', registered: 600, present: 585, absent: 15, synced: true },
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

function Styleguide() {
  const toast = useToast();
  const [range, setRange] = useState({ preset: '7days', ...rangeForPreset('7days') });
  const [present, setPresent] = useState('588');

  const columns = [
    { key: 'date', header: 'Date', primary: true },
    { key: 'registered', header: 'Registered', align: 'end', render: (r) => formatNumber(r.registered) },
    { key: 'present', header: 'Present', align: 'end', render: (r) => formatNumber(r.present) },
    { key: 'absent', header: 'Absent', align: 'end', render: (r) => formatNumber(r.absent) },
    { key: 'rate', header: 'Rate', align: 'end', render: (r) => formatPercent(r.present / r.registered) },
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

        <Section title="Typography" description="Fraunces for page titles and the wordmark; Inter everywhere else.">
          <p className="sg-wordmark">Lishe</p>
          <p className="sg-tagline">Every meal counted, even offline.</p>
          <div className="sg-type-scale">
            {TYPE_SCALE.map((size) => (
              <p key={size} className={`sg-type sg-type--${size}`}>
                <code>--font-size-{size}</code> Attendance recorded for 588 learners
              </p>
            ))}
          </div>
          <p className="sg-sample">
            Numbers: {formatNumber(4786)} meals · {formatPercent(0.915)} attendance · {formatDelta(-12)} vs last week · {formatDate('2026-10-12')}
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
            <Button icon={Save}>Save record</Button>
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
            <Badge tone="success">Synced</Badge>
            <Badge tone="warning" icon={CloudUpload}>Not yet synced</Badge>
            <Badge tone="danger">Conflict</Badge>
            <Badge tone="info">Syncing</Badge>
          </div>
          <div className="ui-stack sg-tight">
            <Alert tone="info" title="Forecasts use synthetic training data">Treat them as a planning aid.</Alert>
            <Alert tone="success" title="Saved on this device">Lishe will sync it when you are online.</Alert>
            <Alert tone="warning" title="Your sign-in has expired" action={<Button size="sm" variant="secondary">Sign in</Button>}>
              You can keep recording on this device; sign in again to sync.
            </Alert>
            <Alert tone="danger" title="Could not save">Present + absent must equal registered.</Alert>
          </div>
        </Section>

        <Section title="Toasts">
          <div className="sg-row">
            <Button variant="secondary" onClick={() => toast.show({ title: 'Saved on this device', description: 'Lishe will sync when you are online.' })}>Success toast</Button>
            <Button variant="secondary" onClick={() => toast.show({ tone: 'info', title: 'Sync started' })}>Info toast</Button>
            <Button variant="secondary" onClick={() => toast.show({ tone: 'warning', title: '2 changes did not sync', description: 'They will be retried.' })}>Warning toast</Button>
          </div>
        </Section>

        <Section title="Form fields" description="Large number inputs for daily entry on phones.">
          <div className="ui-grid ui-grid--3">
            <FormField label="Date" type="date" defaultValue="2026-10-12" hint="Defaults to today" />
            <FormField label="School" as="select" options={[{ value: '1', label: 'Demo Primary School' }]} />
            <FormField label="Notes" placeholder="Optional" />
            <FormField label="Registered" size="lg" type="number" inputMode="numeric" defaultValue="600" suffix="learners" />
            <FormField label="Present" size="lg" type="number" inputMode="numeric" value={present} onChange={(e) => setPresent(e.target.value)} required />
            <FormField label="Absent" size="lg" type="number" inputMode="numeric" defaultValue="20" error="Present + absent must equal registered (588 + 20 = 608, registered 600)" required />
          </div>
        </Section>

        <Section title="Date range filter">
          <DateRangeFilter value={range} onChange={setRange} />
          <p className="sg-sample">Selected: {range.start} to {range.end}</p>
        </Section>

        <Section title="Stat cards" description="2 × 2 on phones; the accent bar uses the metric colour.">
          <div className="ui-grid ui-grid--4">
            <StatCard label="Attendance rate" value={formatPercent(0.979)} metric="attendance" icon={CalendarCheck}
              delta={{ value: '+1.2 pts', direction: 'up', good: true, label: 'vs last week' }}
              sparkline={{ data: TREND, dataKey: 'present', metric: 'attendance' }} />
            <StatCard label="Meals served" value={formatNumber(4019)} metric="served" icon={Utensils}
              delta={{ value: formatDelta(120), direction: 'up', good: true }}
              sparkline={{ data: TREND, dataKey: 'served', metric: 'served' }} />
            <StatCard label="Waste (prepared − served)" value={formatNumber(171)} metric="prepared"
              delta={{ value: formatDelta(18), direction: 'up', good: false, label: 'more than last week' }}
              sparkline={{ data: TREND, dataKey: 'prepared', metric: 'prepared' }} />
            <StatCard label="Waiting to sync" value="3" hint="changes on this device" icon={CloudUpload} />
            <StatCard label="Loading example" loading />
          </div>
        </Section>

        <div className="ui-grid ui-grid--2">
          <ChartCard title="Attendance trend" description="Learners present per school day" type="line" data={TREND} xKey="date"
            xTickFormatter={(d) => d.slice(0, 5)} series={[{ dataKey: 'present', metric: 'attendance' }]} />
          <ChartCard title="Prepared vs served" description="Meals per school day" type="bar" data={TREND} xKey="date"
            xTickFormatter={(d) => d.slice(0, 5)} series={[{ dataKey: 'prepared', metric: 'prepared' }, { dataKey: 'served', metric: 'served' }]} />
          <ChartCard title="Meal demand forecast" description="Expected meals with the likely range" type="band" data={FORECAST} xKey="date"
            xTickFormatter={(d) => d.slice(0, 5)} series={[{ dataKey: 'predicted', metric: 'forecast' }]}
            band={{ lowerKey: 'lower', upperKey: 'upper', metric: 'forecast', label: 'Likely range (80%)' }} />
          <ChartCard title="Empty and loading" type="line" data={[]} xKey="date" series={[{ dataKey: 'present', metric: 'attendance' }]} />
        </div>

        <Section title="Data table" description="A table on tablet and desktop, a card list on phones.">
          <DataTable caption="Attendance history" columns={columns} rows={RECORDS} isUnsynced={(r) => !r.synced} />
          <DataTable caption="Empty example" columns={columns} rows={[]}
            emptyState={{ title: 'No attendance recorded yet', description: 'Records you save appear here.' }} />
          <DataTable caption="Loading example" columns={columns} rows={[]} loading />
        </Section>

        <Section title="Sync status" description="Offline is calm grey, never alarming.">
          <div className="ui-stack sg-tight">
            <SyncStatusBar state="offline" pendingCount={3} onSyncNow={() => {}} />
            <SyncStatusBar state="syncing" pendingCount={3} progress={40} onSyncNow={() => {}} />
            <SyncStatusBar state="synced" pendingCount={0} lastSyncedAt={minutesAgo(5)} onSyncNow={() => {}} />
            <SyncStatusBar state="failed" pendingCount={2} failure={{ what: '2 changes did not sync' }} onSyncNow={() => {}} />
            <SyncStatusBar
              variant="expanded"
              state="failed"
              pendingCount={2}
              lastSyncedAt={minutesAgo(90)}
              failure={{
                what: '2 attendance records did not sync',
                why: 'The server could not be reached.',
                fix: 'Check the connection and press Sync now. Your records are safe on this device.',
              }}
              onSyncNow={() => {}}
            />
          </div>
        </Section>

        <Section title="Empty states and skeletons">
          <div className="ui-grid ui-grid--2">
            <EmptyState title="No conflicts" description="Everything on this device matches the server." />
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
