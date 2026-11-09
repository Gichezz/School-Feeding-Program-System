require('dotenv').config();

const app = require('./app');
const { getJwtSecret } = require('./config/auth');
const { startWeeklyReviewSchedule } = require('./services/weeklyReviewSchedule');
const { migrate } = require('./db/migrate');

const PORT = process.env.PORT || 5000;

// Refuse to start without a signing secret rather than failing on the first sign-in
try {
  getJwtSecret();
} catch (error) {
  console.error(`Configuration error: ${error.message}.`);
  console.error('Add JWT_SECRET to backend/.env (see backend/.env.example).');
  process.exit(1);
}

async function start() {
  // Bring the database up to date before serving anything (db/migrate.js). A script that
  // fails stops the API, rather than letting it run on a half-migrated schema; a
  // database that cannot be reached is reported by /api/health as before.
  try {
    await migrate();
  } catch (error) {
    if (error.message.startsWith('Migration') || error.message.startsWith('MIGRATIONS_BASELINE')) {
      console.error(error.message);
      process.exit(1);
    }
    console.error(`Migrations not checked: ${error.message}`);
  }

  app.listen(PORT, () => {
    console.log(`School Feeding API listening on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    // Each sub-county's finished weeks are scored for the weekly review list without
    // anyone pressing a button (services/weeklyReviewSchedule.js)
    startWeeklyReviewSchedule();
  });
}

start();
