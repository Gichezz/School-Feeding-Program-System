import RecordingPage from '../features/recording/RecordingPage';
import { MEALS } from '../features/recording/recordTypes';

/**
 * Record daily meals prepared and served (same layout as Attendance; see RecordingPage).
 */
function MealDistribution() {
  return <RecordingPage type={MEALS} />;
}

export default MealDistribution;
