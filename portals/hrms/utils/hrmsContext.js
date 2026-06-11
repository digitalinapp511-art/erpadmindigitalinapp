const { connectMongo, getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { getTenantCompanyFromRequest } = require('../../../config/tenantCompany');

/**
 * Company for HRMS: body.company, ?company, ?companyId (1/2 → names), x-company, JWT.
 */
function getCompanyFromRequest(req) {
  return getTenantCompanyFromRequest(req);
}

/**
 * Normalize company value to canonical name ('Ecosoul Home' or 'Thrive').
 * Returns null if missing or invalid (multi-tenant: never return other company's data).
 */
function normalizeCompany(value) {
  if (value == null || value === '' || value === 'undefined') return null;
  const raw = String(value).trim();
  if (!raw || raw === 'all') return null;
  const lc = raw.toLowerCase();
  if (lc === '1' || lc === 'ecosoul' || lc === 'ecosoulhome' || lc === 'eco soul' || lc === 'ecosoul home') return 'Ecosoul Home';
  if (lc === '2' || lc === 'thrive' || lc === 'thrive brands' || lc === 'thrivebrands') return 'Thrive';
  return raw;
}

/**
 * Require company for company-scoped routes. Sends 400 if missing.
 * @returns {string|null} Normalized company name or null (response already sent)
 */
function requireCompany(req, res) {
  const company = normalizeCompany(getCompanyFromRequest(req));
  if (!company) {
    res.status(400).json({ success: false, error: 'Company is required. Please ensure your company is selected.' });
    return null;
  }
  return company;
}

/** Fixed recruiter names for "All Recruiters" dropdown in recruitment */
const RECRUITMENT_RECRUITER_NAMES = ['Priyanka', 'Charu', 'Megha', 'Harshita', 'Deepali'];

/**
 * Get HRMS database (company-specific or all data for admin)
 * For HRMS Admin Portal, if company is null or 'all', return default database with all data
 */
async function getHrmsDb(company = null) {
  // New setup: HRMS data is stored in the company DB (company-specific Mongo server).
  // For admin "all", callers should query both companies explicitly.
  if (!company || company === 'all' || company === 'undefined') {
    throw new Error('company is required (Ecosoul Home / Thrive)');
  }
  return await getDb(company);
}

/**
 * Get all HRMS databases for aggregating data across companies
 * Optimized for fast loading - uses parallel queries
 */
async function getAllHrmsDbs() {
  // New setup: always return both company DBs (they live on different Mongo servers).
  // If one server is down, it will be skipped.
  const companyNames = ['Ecosoul Home', 'Thrive'];
  const dbs = await Promise.all(
    companyNames.map(async (company) => {
      try {
        await connectMongo(company);
        return await getDb(company);
      } catch (_e) {
        return null;
      }
    })
  );
  return dbs.filter(Boolean);
}

/**
 * Get Employee database (company-specific) - for accessing attendance requests
 */
async function getEmployeeDbForHrms(company = null) {
  await connectMongo();
  if (!company) throw new Error('company is required (Ecosoul Home / Thrive)');
  return await getEmployeePortalDb(company);
}

module.exports = {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  RECRUITMENT_RECRUITER_NAMES,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
};
