import { PageHeader } from '../components/ui';
import SchoolCalendar from '../features/calendar/SchoolCalendar';

/**
 * The national school calendar, for system administrators: terms, half-terms, public
 * holidays and national exams for each year, from the Ministry of Education's calendar.
 */
function SchoolCalendarPage() {
  return (
    <div data-density="compact">
      <PageHeader
        title="School calendar"
        description="Term dates, half-terms, public holidays and national exams. School devices get changes the next time they sync."
      />
      <SchoolCalendar />
    </div>
  );
}

export default SchoolCalendarPage;
