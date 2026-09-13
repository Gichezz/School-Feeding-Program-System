import PageIntro from '../components/PageIntro';

/**
 * Reports section placeholder.
 */
function Reports() {
  return (
    <PageIntro
      title="Reports"
      purpose="This section will present attendance, meal, and (later) demand-forecast summaries for programme officers. Report views will be added after data capture is in place."
    >
      <p className="placeholder-note">
        Reports are not available yet. Forecasting is out of scope for this phase.
      </p>
    </PageIntro>
  );
}

export default Reports;
