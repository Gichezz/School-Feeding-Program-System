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
          description="Feeding and stock records are kept on the school's own devices. Set this device up for a school from the sign-in page, or open the programme pages instead."
        />
      </Card>
    );
  }
  if (data.status === 'no-calendar') {
    return (
      <Alert tone="warning" title="Connect once to download the school calendar">
        Lishe needs the term dates and the school's ration before it can plan. Connect to the internet and sync; after that it works offline.
      </Alert>
    );
  }
  return children;
}

export default SchoolGate;
