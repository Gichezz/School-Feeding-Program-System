/**
 * Drawn icons for the four foods in a school store: a maize cob (cereals), beans
 * (pulses), an oil tin and a salt shaker. Colours come from tokens through CSS classes.
 * Always shown beside the food's name, so they never stand alone.
 */
// Functions, so nothing is drawn until an icon is rendered
const SHAPES = {
  cereals: () => (
    <>
      <path className="food-icon__grain" d="M12 2c-2.4 3-3.6 6.5-3.6 10.5S9.6 20 12 22c2.4-2 3.6-5.5 3.6-9.5S14.4 5 12 2z" />
      <path className="food-icon__line" d="M12 4v16M9.5 8h5M9 11.5h6M9 15h6M9.6 18.4h4.8" />
      <path className="food-icon__leaf" d="M8.4 14C6 12 4.6 9.6 4.4 7c2.6 1 4.2 3.2 4.6 5.4M15.6 14c2.4-2 3.8-4.4 4-7-2.6 1-4.2 3.2-4.6 5.4" />
    </>
  ),
  pulses: () => (
    <>
      <path className="food-icon__bean" d="M7 6.5c2.6-1.6 6.5-.2 6.8 2.8.2 2-1.4 2.3-1.2 4.3.2 2.2 2.6 2.6 1.6 5-1 2.5-5.4 3-7.6.6C4.1 16.5 3.5 8.6 7 6.5z" />
      <path className="food-icon__bean food-icon__bean--light" d="M14.8 4.6c2.4-1 5.4.6 5.2 3.2-.1 1.6-1.4 1.8-1.3 3.4.1 1.8 2 2.2 1.1 4-.9 1.9-4.2 2-5.6 0" />
    </>
  ),
  oil: () => (
    <>
      <path className="food-icon__tin" d="M6 7h10l2 3v11H6z" />
      <path className="food-icon__cap" d="M9 3h4v4H9z" />
      <path className="food-icon__line" d="M9 13h6" />
    </>
  ),
  salt: () => (
    <>
      <path className="food-icon__shaker" d="M8 8h8l1 13H7z" />
      <path className="food-icon__lid" d="M9 4h6l1 4H8z" />
      <circle className="food-icon__hole" cx="11" cy="6" r=".8" />
      <circle className="food-icon__hole" cx="13.5" cy="6" r=".8" />
    </>
  ),
};

function FoodIcon({ food, className = '' }) {
  const draw = SHAPES[food];
  if (!draw) return null;
  return (
    <svg className={`food-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {draw()}
    </svg>
  );
}

export default FoodIcon;
