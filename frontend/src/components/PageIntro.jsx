import { useEffect } from 'react';
import { APP_NAME } from './ui';

/**
 * Heading block used by pages that have not yet been rebuilt with PageHeader (#40).
 * Also sets the browser tab title to "<title> · Lishe".
 */
function PageIntro({ title, purpose, children }) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  return (
    <section className="page-intro">
      <h2 className="page-intro__title">{title}</h2>
      <p className="page-intro__purpose">{purpose}</p>
      {children}
    </section>
  );
}

export default PageIntro;
