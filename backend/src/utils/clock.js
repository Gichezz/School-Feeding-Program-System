/**
 * The current time for business rules that depend on the date, such as the entry
 * window (#62). One place to read it, so tests can fix "today".
 */
const clock = {
  now: () => new Date(),
};

module.exports = clock;
