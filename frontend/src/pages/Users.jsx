import { PageHeader } from '../components/ui';
import UsersSection from '../features/users/UsersSection';

/**
 * Accounts, for system administrators: add people, change their role or school, reset
 * sign-ins and deactivate accounts. Moved out of Settings so it is not under the
 * administrator's own security set-up.
 */
function Users() {
  return (
    <div data-density="compact">
      <PageHeader title="Users" description="Everyone who can sign in to Lishe." />
      <UsersSection />
    </div>
  );
}

export default Users;
