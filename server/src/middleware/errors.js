export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON' });
  if (error.name === 'MulterError') {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 15 MB or smaller' : 'The upload could not be processed';
    return res.status(400).json({ error: message });
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ error: 'The request contains invalid data' });
  }
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error('Unhandled request error:', error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Try again.' });
}
