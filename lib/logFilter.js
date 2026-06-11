/**
 * Optional log filter: keep console output focused.
 *
 * Goal: show only request logs like:
 *   2026-04-20T06:02:59.331Z - GET /api/hrms/attendance
 *
 * Errors/warnings still print.
 *
 * Enable with:
 *   LOG_ONLY_REQUESTS=true
 *
 * Default: enabled unless explicitly set to 'false'.
 */

function shouldEnable() {
  const v = process.env.LOG_ONLY_REQUESTS;
  if (v == null || String(v).trim() === '') return true;
  return String(v).trim().toLowerCase() !== 'false';
}

function looksLikeRequestLine(s) {
  // Matches: ISO timestamp + " - " + METHOD + " " + /path
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - (GET|POST|PUT|PATCH|DELETE|OPTIONS) \//.test(s);
}

function coerceToString(args) {
  try {
    return args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message || String(a);
        return JSON.stringify(a);
      })
      .join(' ');
  } catch {
    try {
      return args.map((a) => String(a)).join(' ');
    } catch {
      return '';
    }
  }
}

function installLogFilter() {
  if (!shouldEnable()) return;

  const orig = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  const passThrough = (fn) => (...args) => fn.apply(console, args);

  // Always allow warnings/errors.
  console.warn = passThrough(orig.warn);
  console.error = passThrough(orig.error);

  // Filter log/info/debug.
  const filtered = (fn) => (...args) => {
    const s = coerceToString(args);
    if (looksLikeRequestLine(s)) return fn.apply(console, args);
  };

  console.log = filtered(orig.log);
  console.info = filtered(orig.info);
  console.debug = filtered(orig.debug);
}

module.exports = { installLogFilter };

