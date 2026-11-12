import { PageHeader } from '../components/ui';
import DevicesCard from '../features/devices/DevicesCard';

/**
 * School devices, for system administrators: approve a school's tablet or phone,
 * unlock a teacher's PIN and remove a lost device. Devices waiting for approval come first.
 */
function Devices() {
  return (
    <div data-density="compact">
      <PageHeader title="Devices" description="The school tablets and phones that teachers sign in on." />
      <DevicesCard />
    </div>
  );
}

export default Devices;
