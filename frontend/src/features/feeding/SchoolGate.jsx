import { School } from 'lucide-react';
import { Alert, Card, EmptyState, LoadingRegion, SkeletonText } from '../../components/ui';

/**
 * What the school screens show until the device's school data is ready: loading, not a
 * school device, or a school device that has never downloaded the calendar.
 */
function SchoolGate({ data, children }) {
  if (data.status === 'loading') {
    return <Card><LoadingRegion label="Loading the school's records"><SkeletonText lines={4} /></LoadingRegion></Card>;
  }
  if (data.status === 'no-school') {
    return (
      <Card>
        <EmptyState
          icon={School}
          title="This is not a school device"
          description="Feeding and stock are recorded on the school's own devices."
        />
      </Card>
    );
  }
  if (data.status === 'no-calendar') {
    return (
      <Alert tone="warning" title="Connect once to download the school calendar">
        Connect to the internet once. After that, Lishe works offline.
      </Alert>
    );
  }
  return children;
}

export default SchoolGate;
