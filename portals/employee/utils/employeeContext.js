const { getTenantCompanyFromRequest } = require('../../../config/tenantCompany');

/** Same as global tenant resolver (body, query, headers, JWT). */
function getCompanyFromRequest(req) {
  return getTenantCompanyFromRequest(req);
}

// Very small in-memory cache to reduce DB load for hot polling endpoints.
const checkinStatusCache = new Map();
// 30s TTL — aligns with frontend status polling; cuts DB load without changing status semantics.
const CHECKIN_STATUS_CACHE_TTL_MS = 30000;

module.exports = {
  getCompanyFromRequest,
  checkinStatusCache,
  CHECKIN_STATUS_CACHE_TTL_MS,
};
