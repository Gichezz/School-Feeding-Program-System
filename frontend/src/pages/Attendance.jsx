import PageIntro from '../components/PageIntro';

/**
 * Attendance section placeholder.
 */
function Attendance() {
  return (
    <PageIntro
      title="Attendance"
      purpose="This section will support recording and reviewing learner attendance for school feeding days. Capture forms, class lists, and offline saving will be implemented in a later phase."
    >
      <p className="placeholder-note">
        Attendance functionality is not available yet.
      </p>
    </PageIntro>
  );
}

export default Attendance;
