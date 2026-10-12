/**
 * Lishe mark (a plate with a leaf) and optional wordmark. Colours come from tokens
 * through CSS classes; the same artwork is used for the favicon and app icons.
 */
export function LisheMark({ className = '' }) {
  return (
    <svg className={`lishe-mark ${className}`.trim()} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle className="lishe-mark__plate" cx="24" cy="24" r="20" />
      <g transform="rotate(35 24 24)">
        <path className="lishe-mark__leaf" d="M24 10.5 C33 17 33 31 24 37.5 C15 31 15 17 24 10.5 Z" />
        <line className="lishe-mark__vein" x1="24" y1="16" x2="24" y2="33" />
      </g>
    </svg>
  );
}

function LisheLogo({ withTagline = false, className = '' }) {
  return (
    <span className={`lishe-logo ${className}`.trim()}>
      <LisheMark />
      <span className="lishe-logo__text">
        <span className="lishe-logo__wordmark">Lishe</span>
        {withTagline && <span className="lishe-logo__tagline">Every meal counted, even offline.</span>}
      </span>
    </span>
  );
}

export default LisheLogo;
