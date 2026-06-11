require('dotenv').config({ override: true });

/**
 * CENTRALIZED DATABASE CONFIGURATION
 *
 * Mongo connection strings and host/port are read only from environment variables
 * (see .env.example). There are no hardcoded cluster URLs or localhost defaults here.
 */

// ============================================
// MONGODB CONFIGURATION
// ============================================
const mongoPortRaw = process.env.MONGO_PORT;
const mongoPortParsed =
  mongoPortRaw != null && String(mongoPortRaw).trim() !== ''
    ? parseInt(mongoPortRaw, 10)
    : NaN;

const MONGODB_CONFIG = {
  host: process.env.MONGO_HOST ? String(process.env.MONGO_HOST).trim() : null,
  port: mongoPortParsed,
  uri: process.env.MONGO_URI || process.env.MONGODB_URI
    ? String(process.env.MONGO_URI || process.env.MONGODB_URI).trim() || null
    : null,

  databases: {
    assetTracker:
      process.env.ASSET_TRACKER_DB_NAME ||
      process.env.MONGODB_ASSET_DB_NAME ||
      'asset_tracker',
    login: process.env.MONGO_LOGIN_DB_NAME || 'main_db',
    employee:
      process.env.MONGO_DB_NAME ||
      (process.env.NODE_ENV === 'production' ? 'hrms_prod' : 'Employee'),
    queryTracker: process.env.QUERY_TRACKER_DB_NAME || 'query_tracker',
    hrms: process.env.HRMS_DB_NAME || 'hrms',
    finance: process.env.FINANCE_DB_NAME || 'finance',
  },

  collections: {
    assets: 'assets',
    users: process.env.MONGO_USERS_COLLECTION || 'employee_details',
    warehouseUsers: process.env.MONGO_WAREHOUSEUSERS_COLLECTION || 'warehouse_employee_details',
  },

  options: {
    maxPoolSize: 10,
    connectTimeoutMS: 15008,
    serverSelectionTimeoutMS: 15008,
    socketTimeoutMS: 45008,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function firstNonEmptyEnvUri(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && String(v).trim() !== '') {
      return String(v).trim().replace(/\/$/, '');
    }
  }
  return null;
}

/**
 * Base Mongo connection string from .env only.
 * Priority: MONGO_URI_MAIN → MONGO_URI / MONGODB_URI → MONGO_HOST + MONGO_PORT
 * @returns {string}
 */
function getMongoConnectionBaseRaw() {
  const fromMain = firstNonEmptyEnvUri('MONGO_URI_MAIN');
  if (fromMain) return fromMain;

  if (MONGODB_CONFIG.uri) return MONGODB_CONFIG.uri;

  const host = MONGODB_CONFIG.host;
  const port = MONGODB_CONFIG.port;
  if (host && !Number.isNaN(port)) {
    return `mongodb://${host}:${port}`;
  }

  throw new Error(
    'MongoDB connection is not configured. Set one of the following in .env: ' +
      'MONGO_URI_MAIN, or MONGO_URI (or MONGODB_URI), or both MONGO_HOST and MONGO_PORT.'
  );
}

function getMainMongoBaseRaw() {
  return getMongoConnectionBaseRaw();
}

/**
 * Append optional database name to a Mongo base URI.
 * @param {string} base
 * @param {string|null} databaseName
 * @returns {string}
 */
function buildMongoUriWithDatabase(base, databaseName = null) {
  if (!databaseName) return base;
  const separator = base.endsWith('/') ? '' : '/';
  return `${base}${separator}${databaseName}`;
}

/**
 * Get MongoDB connection URI
 * @param {string|null} databaseName - Optional database name to append
 * @returns {string} MongoDB connection URI
 */
function getMongoUri(databaseName = null) {
  return buildMongoUriWithDatabase(getMongoConnectionBaseRaw(), databaseName);
}

/**
 * Get company name from email domain
 * @param {string} email - User email address
 * @returns {string|null} Company name ('Thrive' or 'Ecosoul Home') or null
 */
function getCompanyFromEmail(email) {
  if (!email) return null;
  const emailLower = email.toLowerCase();
  if (emailLower.endsWith('@thrivebrands.ai')) {
    return 'Thrive';
  } else if (emailLower.endsWith('@ecosoulhome.com')) {
    return 'Ecosoul Home';
  }
  return null;
}

/**
 * Canonical company DB name (must be a valid Mongo DB name: no spaces).
 * Override via env: MONGO_COMPANY_DB_THRIVE, MONGO_COMPANY_DB_ECOSOUL
 */
function normalizeCompanyKey(company) {
  if (!company || typeof company !== 'string') return '';
  const t = company.trim().toLowerCase();
  if (t.includes('thrive')) return (process.env.MONGO_COMPANY_DB_THRIVE || 'thrive').trim();
  if (t.includes('ecosoul') || t.includes('eco soul'))
    return (process.env.MONGO_COMPANY_DB_ECOSOUL || 'ecosoul').trim();
  return company.trim().replace(/\s+/g, '_');
}

/**
 * Get company-specific database name
 * @param {string} module - Module name: 'assetTracker', 'hrms', 'finance', 'queryTracker', 'employee'
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home'
 * @returns {string|null} Company-specific database name
 */
function getCompanyDatabaseName(module = 'assetTracker', company = null) {
  if (module === 'login') {
    return MONGODB_CONFIG.databases.login;
  }

  if (!company) return null;
  return normalizeCompanyKey(company);
}

function getMongoUriMain(databaseName = null) {
  return buildMongoUriWithDatabase(getMongoConnectionBaseRaw(), databaseName);
}

/**
 * Per-company Mongo base (same instance as login; company isolation via DB name).
 */
function getMongoUriForCompany(company, databaseName = null) {
  return buildMongoUriWithDatabase(getMongoConnectionBaseRaw(), databaseName);
}

function getDatabaseName(module = 'assetTracker') {
  return MONGODB_CONFIG.databases[module] || MONGODB_CONFIG.databases.assetTracker;
}

function getCollectionName(collection = 'assets') {
  return MONGODB_CONFIG.collections[collection] || collection;
}

module.exports = {
  MONGODB_CONFIG,
  getMongoUri,
  getMongoUriMain,
  getMongoUriForCompany,
  getDatabaseName,
  getCompanyDatabaseName,
  getCompanyFromEmail,
  getCollectionName,
};

