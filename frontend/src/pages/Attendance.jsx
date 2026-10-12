import RecordingPage from '../features/recording/RecordingPage';
import { ATTENDANCE } from '../features/recording/recordTypes';

/**
 * Record daily attendance (same layout as Meals; see RecordingPage).
 */
function Attendance() {
  return <RecordingPage type={ATTENDANCE} />;
}

export default Attendance;
