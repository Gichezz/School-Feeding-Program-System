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

  // Handle specific error types
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

  // Default error response
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
