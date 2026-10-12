import { useId } from 'react';

/**
 * Card: the container for every block of content on a page.
 */
function Card({ title, description, actions, footer, padding = 'md', as: Component = 'section', className = '', children, ...rest }) {
  const titleId = useId();
  const hasHeader = title || description || actions;

  return (
    <Component
      className={`ui-card ui-card--pad-${padding} ${className}`.trim()}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {hasHeader && (
        <header className="ui-card__header">
          <div className="ui-card__heading">
            {title && <h2 id={titleId} className="ui-card__title">{title}</h2>}
            {description && <p className="ui-card__description">{description}</p>}
          </div>
          {actions && <div className="ui-card__actions">{actions}</div>}
        </header>
      )}
      <div className="ui-card__body">{children}</div>
      {footer && <footer className="ui-card__footer">{footer}</footer>}
    </Component>
  );
}

export default Card;
