const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const schoolsRoutes = require('./routes/schoolsRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const mealsRoutes = require('./routes/mealsRoutes');
const syncRoutes = require('./routes/syncRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const forecastRoutes = require('./routes/forecastRoutes');
const authRoutes = require('./routes/authRoutes');
const usersRoutes = require('./routes/usersRoutes');
const devicesRoutes = require('./routes/devicesRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const { requireAuth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

/**
 * Express application setup.
 */
const app = express();

// CORS configuration for local development
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Records are small; reject oversized bodies early
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));

// Public routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
// Device set-up and staff sign-in are public; device management checks sign-in itself
app.use('/api/devices', devicesRoutes);

// Everything else under /api requires a signed-in user
app.use('/api', requireAuth);
app.use('/api/schools', schoolsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/meals', mealsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/forecasts', forecastRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/review', reviewRoutes);

// Placeholder mount points for later phases
// app.use('/api/students', studentRoutes);
// app.use('/api/conflicts', conflictRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handling middleware
app.use(errorHandler);

module.exports = app;
