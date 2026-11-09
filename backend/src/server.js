require('dotenv').config();

const app = require('./app');
const { getJwtSecret } = require('./config/auth');
const { startWeeklyReviewSchedule } = require('./services/weeklyReviewSchedule');

const PORT = process.env.PORT || 5000;

// Refuse to start without a signing secret rather than failing on the first sign-in
try {
  getJwtSecret();
} catch (error) {
  console.error(`Configuration error: ${error.message}.`);
  console.error('Add JWT_SECRET to backend/.env (see backend/.env.example).');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`School Feeding API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  // Each sub-county's finished weeks are scored for the weekly review list without
  // anyone pressing a button (services/weeklyReviewSchedule.js)
  startWeeklyReviewSchedule();
});
