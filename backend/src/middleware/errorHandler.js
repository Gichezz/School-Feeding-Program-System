/**
 * Centralized error handling middleware.
 * Provides consistent JSON error responses without exposing sensitive information.
 */

function errorHandler(err, req, res, next) {
  // Log error for debugging (without sensitive data)
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // Request body errors from express.json()
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  // Handle specific error types
  if (err.code === '22P02') {
    // Invalid text representation (e.g. a malformed UUID reached the database)
    return res.status(400).json({ error: 'Invalid data format' });
  }

  if (err.code === '23505') {
    // Unique constraint violation
    return res.status(409).json({
      error: 'Conflict - Record already exists',
      details: process.env.NODE_ENV === 'development' ? err.detail : undefined,
    });
  }

  if (err.code === '23503') {
    // Foreign key violation
    return res.status(400).json({
      error: 'Invalid reference - Related record not found',
      details: process.env.NODE_ENV === 'development' ? err.detail : undefined,
    });
  }

  if (err.code === '23502') {
    // Not null violation
    return res.status(400).json({
      error: 'Invalid data - Required field missing',
      details: process.env.NODE_ENV === 'development' ? err.detail : undefined,
    });
  }

  if (err.code === '23514') {
    // Check constraint violation
    return res.status(400).json({
      error: 'Invalid data - Constraint violation',
      details: process.env.NODE_ENV === 'development' ? err.detail : undefined,
    });
  }

  // Default error response. Errors raised deliberately by the app carry a statusCode and a
  // message meant for clients; anything else may contain internal details (SQL, file paths),
  // so outside development its message is replaced with a generic one.
  const statusCode = err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';
  const message = err.statusCode || isDevelopment
    ? err.message || 'Internal server error'
    : 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
