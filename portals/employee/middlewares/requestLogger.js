function safe(val) {
  if (val == null) return '';
  return String(val).replace(/\s+/g, ' ').trim();
}

/**
 * Minimal request logger for Employee Portal.
 * Logs once per request with duration + status code.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    const company = safe(req.query?.company || req.headers?.['x-company']);
    const companyPart = company ? ` company=${company}` : '';
    // Keep it short; avoid logging large bodies/headers.
    console.log(
      `[employee-portal] ${res.statusCode} ${req.method} ${req.originalUrl} (${ms}ms)${companyPart}`
    );
  });

  next();
}

module.exports = { requestLogger };

