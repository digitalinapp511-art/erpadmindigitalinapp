function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[admin-portal] ${res.statusCode} ${req.method} ${req.originalUrl} (${ms}ms)`);
  });
  next();
}

module.exports = { requestLogger };

