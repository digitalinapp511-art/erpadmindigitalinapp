const jwt = require('jsonwebtoken');

function firstStr(val) {
  if (val == null || val === '') return null;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || null;
}

function normalizeCompanyIdParam(val) {
  const s = firstStr(val);
  if (!s) return null;
  const lc = s.toLowerCase();
  if (lc === '1') return 'Ecosoul Home';
  if (lc === '2') return 'Thrive';
  return s;
}

/**
 * Resolve tenant company for Mongo (assets, HRMS, employee portal, etc.).
 * Order: JSON body.company → ?company → ?companyId (1/2 mapped) → x-company → JWT company.
 */
function getTenantCompanyFromRequest(req) {
  const fromBody =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? firstStr(req.body.company)
      : null;
  const fromQuery = firstStr(req.query?.company);
  const fromQueryId = normalizeCompanyIdParam(req.query?.companyId);
  const fromHeader = firstStr(req.headers['x-company']);

  if (fromBody) return fromBody;
  if (fromQuery) return fromQuery;
  if (fromQueryId) return fromQueryId;
  if (fromHeader) return fromHeader;

  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (!token) return null;
    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key-change-in-production'
      );
      if (decoded?.company) {
        const c = String(decoded.company).trim();
        return c || null;
      }
    } catch (_e) {
      // ignore invalid token
    }
  }
  return null;
}

module.exports = {
  getTenantCompanyFromRequest,
  firstStr,
};
