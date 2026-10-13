const { pool } = require('../db/pool');

/**
 * One-time challenges for passkeys (#57) and school devices (#60). A challenge is
 * stored when issued, deleted when used, and expires after a few minutes, so a signed
 * response can never be replayed.
 */

const CHALLENGE_TTL_MINUTES = 5;

/**
 * purpose: 'register' | 'authenticate' (passkeys) or 'device' (school devices)
 */
async function saveChallenge(challenge, purpose, userId = null) {
  await pool.query('DELETE FROM auth_challenges WHERE expires_at < NOW()');
  await pool.query(
    `INSERT INTO auth_challenges (challenge, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [challenge, purpose, userId, CHALLENGE_TTL_MINUTES]
  );
}

/**
 * Use up a stored challenge: returns true once for a valid, unexpired challenge that
 * matches the purpose (and user, for passkey registration), then never again.
 */
async function consumeChallenge(challenge, purpose, userId = null) {
  if (typeof challenge !== 'string' || !challenge) return false;
  const result = await pool.query(
    `DELETE FROM auth_challenges
     WHERE challenge = $1 AND purpose = $2 AND expires_at > NOW()
       AND user_id IS NOT DISTINCT FROM $3
     RETURNING id`,
    [challenge, purpose, userId]
  );
  return result.rows.length === 1;
}

module.exports = {
  saveChallenge,
  consumeChallenge,
};
