#!/usr/bin/env node
/**
 * Create the first administrator on a fresh deployment, without the demo accounts
 * from database/seed.sql.
 *
 *   node scripts/create-admin.js --name "Jane Wanjiku" --email jane@example.org
 *
 * The password is asked for without being shown. For automated setups it can be
 * given in the ADMIN_PASSWORD environment variable instead. Uses DATABASE_URL (or
 * the PG* variables) from backend/.env, like the API.
 */
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../src/db/pool');
const { hashPassword } = require('../src/services/userAccounts');
const { nameError, emailError, passwordError, normaliseEmail } = require('../src/validation/users');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

/**
 * Read a line from the terminal without echoing what is typed.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = (text) => {
      if (!rl.stdoutMuted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

async function main() {
  const name = argument('name');
  const email = argument('email');
  const invalid = nameError(name) || emailError(email);
  if (invalid) {
    throw new Error(`${invalid}.\nUsage: node scripts/create-admin.js --name "Full Name" --email admin@example.org`);
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Password for the new administrator: ');
    const again = await askHidden('Type it again: ');
    if (password !== again) throw new Error('The passwords did not match. Nothing was changed.');
  }
  const weak = passwordError(password);
  if (weak) throw new Error(`${weak}. Nothing was changed.`);

  const address = normaliseEmail(email);
  const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [address]);
  if (existing.rows.length > 0) {
    throw new Error(`There is already an account for ${address}. Nothing was changed.`);
  }

  await pool.query(
    "INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, 'admin', $3)",
    [name.trim(), address, await hashPassword(password)]
  );
  console.log(`Administrator ${address} created. Sign in to Lishe and add other users from Settings → Users.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
