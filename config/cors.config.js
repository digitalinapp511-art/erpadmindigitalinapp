require('dotenv').config();

function normalizeOrigin(o) {
  return String(o || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * CORS options for Express `cors` middleware.
 *
 * - CORS_ORIGIN: comma-separated allowed browser origins (recommended for production).
 * - Else in production: if FRONTEND_BASE_URL is set, only that origin is allowed.
 * - Else: permissive (reflect request origin) — typical for local development.
 */
function getCorsOptions() {
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
  const allowedHeaders = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'x-company',
  ];
  const base = {
    credentials: true,
    methods,
    allowedHeaders,
  };

  const raw = process.env.CORS_ORIGIN;
  const list = raw
    ? String(raw)
        .split(',')
        .map((s) => normalizeOrigin(s))
        .filter(Boolean)
    : [];

  if (list.length > 0) {
    return {
      ...base,
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        return cb(null, list.includes(normalizeOrigin(origin)));
      },
    };
  }

  const prod = process.env.NODE_ENV === 'production';
  const fe = normalizeOrigin(process.env.FRONTEND_BASE_URL);
  if (prod && fe) {
    return {
      ...base,
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        return cb(null, normalizeOrigin(origin) === fe);
      },
    };
  }

  if (prod && !fe) {
    console.warn(
      '[CORS] NODE_ENV=production but neither CORS_ORIGIN nor FRONTEND_BASE_URL is set; allowing any origin. Set CORS_ORIGIN or FRONTEND_BASE_URL to lock this down.'
    );
  }

  return {
    ...base,
    origin: true,
  };
}

module.exports = { getCorsOptions };
