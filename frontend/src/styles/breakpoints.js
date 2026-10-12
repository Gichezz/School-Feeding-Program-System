/**
 * Breakpoints shared with src/styles/tokens.css (media queries repeat these values).
 */
export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
};

export const MEDIA = {
  mobile: `(max-width: ${BREAKPOINTS.tablet - 1}px)`,
  tablet: `(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.desktop - 1}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
};
