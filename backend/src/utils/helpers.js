/**
 * Shared backend utility helpers.
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  isNonEmptyString,
};
