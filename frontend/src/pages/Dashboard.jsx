import PageIntro from '../components/PageIntro';

const OVERVIEW_CARDS = [
  {
    title: 'Attendance',
    text: 'Daily learner attendance will be recorded here in a later phase.',
  },
  {
    title: 'Meal distribution',
    text: 'Meal servings will be captured here in a later phase.',
  },
  {
    title: 'Synchronization',
    text: 'Offline queue and server sync status will appear here later.',
  },
];

/**
 * Dashboard landing page (placeholder).
 */
function Dashboard() {
  return (
    <PageIntro
      title="Dashboard"
      purpose="Overview of school feeding activity for this school. Summary figures and shortcuts will be added when attendance, meals, and synchronization are implemented."
    >
      <ul className="overview-grid">
        {OVERVIEW_CARDS.map((card) => (
          <li key={card.title} className="overview-card">
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </li>
        ))}
      </ul>
    </PageIntro>
  );
}

export default Dashboard;
