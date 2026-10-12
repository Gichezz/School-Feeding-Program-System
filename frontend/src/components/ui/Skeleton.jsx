/**
 * Loading placeholders (used instead of spinners). Size comes from the variant
 * and CSS classes, so they match the content they stand in for.
 */
function Skeleton({ variant = 'text', className = '' }) {
  return <span className={`ui-skeleton ui-skeleton--${variant} ${className}`.trim()} aria-hidden="true" />;
}

/**
 * Several text lines; the last one is shorter.
 */
export function SkeletonText({ lines = 3 }) {
  return (
    <span className="ui-skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} variant={i === lines - 1 && lines > 1 ? 'text-short' : 'text'} />
      ))}
    </span>
  );
}

/**
 * Accessible wrapper: announces that content is loading while showing placeholders.
 */
export function LoadingRegion({ label = 'Loading', children }) {
  return (
    <div className="ui-loading-region" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

export default Skeleton;
