import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import {
  Alert,
  APP_NAME,
  Button,
  Card,
  DataTable,
  DateRangeFilter,
  PageHeader,
  rangeForPreset,
} from '../components/ui';
import InsightStatCards from '../features/insights/InsightStatCards';
import { useInsights } from '../features/insights/useInsights';
import { downloadFile, toCsv } from '../features/insights/exportCsv';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { formatDateTime, formatNumber, formatShare } from '../utils/format';

const ATTENDANCE_COLUMNS = [
  { key: 'date', header: 'Date', primary: true },
  { key: 'schoolName', header: 'School' },
  { key: 'registered', header: 'Registered', align: 'end', render: (r) => formatNumber(r.registered) },
  { key: 'present', header: 'Present', align: 'end', render: (r) => formatNumber(r.present) },
  { key: 'absent', header: 'Absent', align: 'end', render: (r) => formatNumber(r.absent) },
  { key: 'rate', header: 'Rate', align: 'end', render: (r) => formatShare(r.present, r.registered) },
];

const MEAL_COLUMNS = [
  { key: 'date', header: 'Date', primary: true },
  { key: 'schoolName', header: 'School' },
  { key: 'prepared', header: 'Prepared', align: 'end', render: (r) => formatNumber(r.prepared) },
  { key: 'served', header: 'Served', align: 'end', render: (r) => formatNumber(r.served) },
  { key: 'waste', header: 'Waste', align: 'end', render: (r) => formatNumber(r.waste) },
];

// One file, one row per record: attendance and meal records side by side by type
const CSV_COLUMNS = [
  { header: 'Type', value: (r) => r.type },
  { header: 'Date', value: (r) => r.date },
  { header: 'School', value: (r) => r.schoolName },
  { header: 'Registered', value: (r) => r.registered },
  { header: 'Present', value: (r) => r.present },
  { header: 'Absent', value: (r) => r.absent },
  { header: 'Meals prepared', value: (r) => r.prepared },
  { header: 'Meals served', value: (r) => r.served },
  { header: 'Waste', value: (r) => r.waste },
  { header: 'Synced', value: (r) => (r.unsynced ? 'No' : 'Yes') },
];

/**
 * Attendance and meal records for a period, for programme officers. Prints cleanly
 * (see the print styles in pages.css) and exports to CSV.
 */
function Reports() {
  const [range, setRange] = useState(() => ({ preset: '30days', ...rangeForPreset('30days') }));
  const { loading, attendance, meals, totals, previousTotals, daily, fromDevice } = useInsights(range);
  const { pendingCount } = useSyncStatus();
  const period = range.start === range.end ? range.start : `${range.start} to ${range.end}`;

  const exportCsv = () => {
    const rows = [
      ...attendance.map((row) => ({ ...row, type: 'Attendance' })),
      ...meals.map((row) => ({ ...row, type: 'Meals' })),
    ];
    downloadFile(`${APP_NAME.toLowerCase()}-report-${range.start}-to-${range.end}.csv`, toCsv(rows, CSV_COLUMNS));
  };

  const hasRecords = attendance.length + meals.length > 0;

  return (
    <>
      <div className="print-only reports__print-header">
        <p className="reports__print-name">{APP_NAME}</p>
        <p>School feeding report · {period}</p>
        <p>Printed {formatDateTime(new Date())}</p>
      </div>

      <PageHeader
        title="Reports"
        description="Attendance and meals by date, ready to print or export."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={loading || !hasRecords}>
              Export CSV
            </Button>
            <Button icon={Printer} onClick={() => window.print()} disabled={loading}>
              Print
            </Button>
          </>
        )}
      />

      <div className="ui-stack">
        <Card className="no-print">
          <DateRangeFilter value={range} onChange={setRange} />
        </Card>

        {fromDevice && !loading && (
          <Alert tone="neutral" title="Showing records on this device">
            The server could not be reached, so this report only includes records saved here.
          </Alert>
        )}

        <InsightStatCards
          totals={totals}
          previousTotals={previousTotals}
          daily={daily}
          pendingCount={pendingCount}
          loading={loading}
        />

        <Card title="Attendance by date" description={`${formatNumber(attendance.length)} records · ${period}`}>
          <DataTable
            caption="Attendance by date"
            columns={ATTENDANCE_COLUMNS}
            rows={attendance}
            getRowKey={(row) => row.key}
            isUnsynced={(row) => row.unsynced}
            loading={loading}
            emptyState={{ title: 'No attendance for this period', description: 'Choose a different period, or record attendance first.' }}
          />
        </Card>

        <Card title="Meals by date" description={`${formatNumber(meals.length)} records · ${period}`}>
          <DataTable
            caption="Meals by date"
            columns={MEAL_COLUMNS}
            rows={meals}
            getRowKey={(row) => row.key}
            isUnsynced={(row) => row.unsynced}
            loading={loading}
            emptyState={{ title: 'No meals for this period', description: 'Choose a different period, or record meals first.' }}
          />
        </Card>
      </div>
    </>
  );
}

export default Reports;
