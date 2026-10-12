import { useEffect } from 'react';

export const APP_NAME = 'Lishe';

/**
 * Page title, one-line purpose and optional actions. Also sets the browser tab
 * title to "<title> · Lishe".
 */
function PageHeader({ title, description, actions, documentTitle }) {
  useEffect(() => {
    document.title = `${documentTitle || title} · ${APP_NAME}`;
  }, [title, documentTitle]);

  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__description">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}

export default PageHeader;
