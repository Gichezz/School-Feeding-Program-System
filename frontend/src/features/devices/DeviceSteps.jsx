import { StepTrack } from '../../components/ui';

const STEPS = [
  { key: 'setup', label: 'Set up' },
  { key: 'approved', label: 'Approved' },
  { key: 'ready', label: 'Ready to sign in' },
];

/**
 * Where a school device is on its way to being used: set up, approved, ready.
 * A removed or expired set-up is not a step; those screens say so on their own.
 *
 * status: null (not set up yet), 'pending' or 'approved'
 */
function DeviceSteps({ status }) {
  const current = status === 'approved' ? 'ready' : status === 'pending' ? 'approved' : 'setup';
  return <StepTrack label="Setting up this device" steps={STEPS} current={current} />;
}

export default DeviceSteps;
