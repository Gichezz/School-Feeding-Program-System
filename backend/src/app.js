const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');

/**
 * Express application setup.
 * Routes for attendance, meals, sync, and conflicts will be added later.
 */
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRoutes);

// Placeholder mount points for later phases
// app.use('/api/students', studentRoutes);
// app.use('/api/attendance', attendanceRoutes);
// app.use('/api/meals', mealRoutes);
// app.use('/api/sync', syncRoutes);
// app.use('/api/conflicts', conflictRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
