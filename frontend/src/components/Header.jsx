/**
 * Application header with system name and school context.
 */
function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <p className="site-header__eyebrow">School Feeding Programme</p>
        <h1 className="site-header__title">School Feeding System</h1>
        <p className="site-header__subtitle">
          Offline-first attendance and meal distribution for one school
        </p>
      </div>
    </header>
  );
}

export default Header;
