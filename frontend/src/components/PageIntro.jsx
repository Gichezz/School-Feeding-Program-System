/**
 * Shared heading block for placeholder pages.
 */
function PageIntro({ title, purpose, children }) {
  return (
    <section className="page-intro">
      <h2 className="page-intro__title">{title}</h2>
      <p className="page-intro__purpose">{purpose}</p>
      {children}
    </section>
  );
}

export default PageIntro;
