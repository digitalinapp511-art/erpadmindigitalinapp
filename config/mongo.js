const { MongoClient } = require('mongodb');
const { config } = require('./app.config');
const { getDatabaseName, getMongoUriMain, getMongoUriForCompany } = require('./database.config');
const { getTenantCompanyFromRequest } = require('./tenantCompany');

// MongoDB connection URI - supports both dev and production
// If MONGO_URI is set, use it. Otherwise, use non-authenticated connection
// (Authentication can be enabled later via environment variable)
const MAIN_MONGO_URI = getMongoUriMain();

const LOGIN_DB_NAME = config.mongodb.loginDbName;
const EMPLOYEE_DB_NAME = config.mongodb.employeeDbName;
const USERS_COLLECTION = config.mongodb.usersCollection;

// Portal configuration - defines database and collections for each portal
const PORTAL_CONFIG = {
  hrms: {
    collections: ['employees', 'attendance', 'leaves', 'departments', 'designations', 'recruitment', 'leave_policies']
  },
  assets: {
    collections: ['assets', 'asset_categories', 'asset_assignments', 'asset_history', 'companies']
  },
  finance: {
    collections: ['invoices', 'transactions', 'expenses', 'budgets', 'financial_reports']
  },
  employee: {
    collections: [
      'portal_dashboard',
      'portal_attendance',
      'portal_requests',
      'portal_org',
      'portal_reports',
      'attendance_requests',
      'employee_checkins',
    ],
  },
  'query-tracker': {
    collections: ['queries', 'users', 'reports'] // Note: query-tracker has its own setup
  }
};

const clients = new Map(); // key -> MongoClient
const dbCache = new Map(); // `${key}:${dbName}` -> Db
let loginDb;
let isConnecting = false;

// Check if client is connected and topology is open
function isClientConnected(c) {
  return c && c.topology && c.topology.isConnected();
}

function getMongoUriForKey(key) {
  // Single MongoDB instance for all DBs (login + company DBs).
  // Keep key parameter for backward compatibility with existing cache keys.
  return MAIN_MONGO_URI;
}

function getClientKeyForDb(dbName) {
  // All DBs live on the same MongoDB server now.
  return 'main';
}

/**
 * Normalize user-facing company names to valid MongoDB database names.
 * MongoDB namespaces cannot contain spaces (e.g. "Ecosoul Home.employee_checkins" is invalid).
 *
 * Canonical company DBs in this project:
 * - Thrive        -> "thrive"
 * - Ecosoul Home  -> "ecosoul"
 */
function normalizeCompanyDbName(dbName) {
  if (!dbName) return dbName;
  const raw = String(dbName).trim();
  if (!raw) return raw;
  const t = raw.toLowerCase();
  if (t === LOGIN_DB_NAME.toLowerCase()) return LOGIN_DB_NAME;
  if (t === 'thrive' || t.includes('thrive'))
    return (process.env.MONGO_COMPANY_DB_THRIVE || 'thrive').trim();
  if (t === 'ecosoul' || t.includes('ecosoul') || t.includes('eco soul'))
    return (process.env.MONGO_COMPANY_DB_ECOSOUL || 'ecosoul').trim();
  // fallback: sanitize
  return raw.replace(/\s+/g, '_');
}

async function ensureClient(key) {
  const existing = clients.get(key);
  if (existing && isClientConnected(existing)) return existing;

  if (isConnecting) {
    let attempts = 0;
    while (isConnecting && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
    const maybe = clients.get(key);
    if (maybe && isClientConnected(maybe)) return maybe;
  }

  isConnecting = true;
  try {
    if (existing) {
      try {
        await existing.close();
      } catch (_e) {}
    }

    // Clear cached db handles for this client key
    for (const cacheKey of Array.from(dbCache.keys())) {
      if (cacheKey.startsWith(`${key}:`)) dbCache.delete(cacheKey);
    }

    const uri = getMongoUriForKey(key);
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      connectTimeoutMS: 15008,
      serverSelectionTimeoutMS: 15008,
      socketTimeoutMS: 45008,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      retryReads: true,
    });
    await client.connect();
    clients.set(key, client);
    console.log(`✅ [mongo] Connected to MongoDB (${key})`);
    return client;
  } finally {
    isConnecting = false;
  }
}

async function ensureConnection() {
  await ensureClient('main');
}

async function connectMongo(dbName = null) {
  const targetDb = normalizeCompanyDbName(dbName || EMPLOYEE_DB_NAME);
  const key = getClientKeyForDb(targetDb);
  const client = await ensureClient(key);

  if (targetDb === LOGIN_DB_NAME) {
    if (!loginDb) {
      loginDb = client.db(LOGIN_DB_NAME);
      console.log(`[mongo] Using login database: ${LOGIN_DB_NAME}`);
    }
    return loginDb;
  }

  const cacheKey = `${key}:${targetDb}`;
  if (!dbCache.has(cacheKey)) {
    dbCache.set(cacheKey, client.db(targetDb));
    console.log(`[mongo] Using database (${key}): ${targetDb}`);
  }
  return dbCache.get(cacheKey);
}

/**
 * Get company-specific database for employee portal
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home'
 * @returns {Promise<Db>} Company-specific database
 */
async function getEmployeePortalDb(company = null) {
  if (!company) {
    return connectMongo(EMPLOYEE_DB_NAME);
  }
  
  // Company portal data is stored in company DB on its own Mongo server
  return connectMongo(company);
}

async function getDb(dbName = null) {
  return connectMongo(dbName || EMPLOYEE_DB_NAME);
}

/**
 * Get the employee collection name based on email domain or company name
 * @param {string} email - User email address (optional)
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home' (optional)
 * @returns {string} Collection name (Thrive_Employees or Ecosoul_Employees)
 */
async function getUsersCollection(email = null, company = null) {
  // For login/users, use the configured login database (main_db)
  const db = await getDb(LOGIN_DB_NAME);
  // Backward compatibility: legacy deployments use `employee_details` (not `users`).
  try {
    const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
    if (existing.has(USERS_COLLECTION)) return db.collection(USERS_COLLECTION);
    if (existing.has('employee_details')) return db.collection('employee_details');
  } catch (_e) {
    // fall through
  }
  return db.collection(USERS_COLLECTION);
}

/**
 * Warehouse employees are stored in a separate collection inside the login DB.
 * Collection name is controlled by MONGO_WAREHOUSEUSERS_COLLECTION (defaults to `warehouse_employee_details`).
 */
async function getWarehouseUsersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  const name = (process.env.MONGO_WAREHOUSEUSERS_COLLECTION || 'warehouse_employee_details').trim();
  return db.collection(name);
}

/**
 * Initialize database and collections for a specific portal
 * @param {string} portalName - Portal key from PORTAL_CONFIG (e.g. 'hrms', 'assets')
 * @returns {Promise<void>}
 */
async function initializePortalDatabase(portalName) {
  try {
    const portalConfig = PORTAL_CONFIG[portalName];
    if (!portalConfig) {
      console.warn(`⚠️  [portal-setup] No configuration found for portal: ${portalName}`);
      return;
    }
    const dbName = portalConfig.database;
    throw new Error('initializePortalDatabase now requires a database name. Use initializePortalDatabaseForDb(portal, dbName).');
  } catch (error) {
    console.error(`❌ [portal-setup] Failed to initialize portal '${portalName}': ${error.message}`);
    throw error;
  }
}

/**
 * Initialize collections for a portal inside a specific DB.
 * In the new setup, dbName is typically company DB (e.g., "Ecosoul Home" or "thrive").
 */
async function initializePortalDatabaseForDb(portalName, dbName, options = {}) {
  const quiet = options.quiet === true;
  try {
    const portalConfig = PORTAL_CONFIG[portalName];
    if (!portalConfig) {
      console.warn(`⚠️  [portal-setup] No configuration found for portal: ${portalName}`);
      return;
    }
    const collections = portalConfig.collections;

    const db = await connectMongo(dbName);

    const existingCollections = await db.listCollections().toArray();
    const existingCollectionNames = existingCollections.map(col => col.name);

    for (const collectionName of collections) {
      if (!existingCollectionNames.includes(collectionName)) {
        try {
          const collection = db.collection(collectionName);
          await collection.insertOne({ _initialized: true, createdAt: new Date() });
          await collection.deleteOne({ _initialized: true });
          if (!quiet) {
            console.log(`✅ [portal-setup] Created collection '${collectionName}' in database '${dbName}'`);
          }
        } catch (err) {
          try {
            await db.createCollection(collectionName);
            if (!quiet) {
              console.log(`✅ [portal-setup] Created collection '${collectionName}' in database '${dbName}'`);
            }
          } catch (createErr) {
            console.error(`❌ [portal-setup] Failed to create collection '${collectionName}': ${createErr.message}`);
          }
        }
      } else if (!quiet) {
        console.log(`ℹ️  [portal-setup] Collection '${collectionName}' already exists in database '${dbName}'`);
      }
    }

    if (!quiet) {
      console.log(`✅ [portal-setup] Portal '${portalName}' database '${dbName}' initialized with ${collections.length} collections`);
    }
  } catch (error) {
    console.error(`❌ [portal-setup] Failed to initialize portal '${portalName}': ${error.message}`);
    throw error;
  }
}

/** Canonical company DB name on Mongo (matches connectMongo / getClientKeyForDb). */
function resolveCompanyDbName(company) {
  if (company == null || String(company).trim() === '') return null;
  const t = String(company).trim().toLowerCase();
  if (t.includes('thrive')) return (process.env.MONGO_COMPANY_DB_THRIVE || 'thrive').trim();
  if (t.includes('ecosoul') || t.includes('eco soul'))
    return (process.env.MONGO_COMPANY_DB_ECOSOUL || 'ecosoul').trim();
  return String(company).trim().replace(/\s+/g, '_');
}

/** All unique collection names required on a company database (all portals). */
function getAllRequiredCompanyCollectionNames() {
  const names = new Set();
  for (const portal of Object.values(PORTAL_CONFIG)) {
    for (const c of portal.collections) names.add(c);
  }
  return Array.from(names).sort();
}

/**
 * After login/signup: ensure every required collection exists on that company’s Mongo DB.
 * One listCollections + create missing only (quiet when nothing was created).
 */
async function ensureCollectionsForCompanyDb(company) {
  const dbName = resolveCompanyDbName(company);
  if (!dbName) return { dbName: null, created: [], skipped: true };

  const db = await connectMongo(dbName);
  const existingNames = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const required = getAllRequiredCompanyCollectionNames();
  const created = [];

  for (const collectionName of required) {
    if (existingNames.has(collectionName)) continue;
    try {
      await db.createCollection(collectionName);
      created.push(collectionName);
    } catch (_e) {
      try {
        const col = db.collection(collectionName);
        await col.insertOne({ _initialized: true, createdAt: new Date() });
        await col.deleteOne({ _initialized: true });
        created.push(collectionName);
      } catch (e2) {
        console.error(`❌ [portal-setup] Could not create collection '${collectionName}' in '${dbName}': ${e2.message}`);
      }
    }
  }

  if (created.length > 0) {
    console.log(
      `✅ [portal-setup] Company DB '${dbName}': created ${created.length} missing collection(s): ${created.join(', ')}`
    );
  }

  return { dbName, created, requiredCount: required.length };
}

async function initializeCompanyPortals(company) {
  if (!company) return;
  await ensureCollectionsForCompanyDb(company);
}

/**
 * Ensure all portal collections exist on the company DB for the current request (upload / writes).
 * Uses body.company, ?company, ?companyId, x-company, JWT.
 */
async function ensureCompanyPortalsForTenantRequest(req) {
  const company = getTenantCompanyFromRequest(req);
  if (!company) {
    return { ok: false, company: null };
  }
  try {
    await ensureCollectionsForCompanyDb(company);
  } catch (e) {
    console.warn('[portal-setup] ensureCompanyPortalsForTenantRequest:', e.message);
    return { ok: false, company, error: e.message };
  }
  return { ok: true, company };
}

/**
 * Initialize all portal databases and collections
 * @returns {Promise<void>}
 */
async function initializeAllPortals() {
  try {
    await ensureConnection();
    console.log(`\n📦 [portal-setup] Initializing all portal databases and collections...\n`);
    
    // Also ensure login database has users collection
    const mainClient = await ensureClient('main');
    const loginDb = mainClient.db(LOGIN_DB_NAME);
    const loginCollections = await loginDb.listCollections().toArray();
    const loginCollectionNames = loginCollections.map(col => col.name);
    
    if (!loginCollectionNames.includes(USERS_COLLECTION)) {
      try {
        const usersCol = loginDb.collection(USERS_COLLECTION);
        await usersCol.insertOne({ _initialized: true, createdAt: new Date() });
        await usersCol.deleteOne({ _initialized: true });
        console.log(`✅ [portal-setup] Created collection '${USERS_COLLECTION}' in login database '${LOGIN_DB_NAME}'`);
      } catch (err) {
        console.error(`❌ [portal-setup] Failed to create users collection: ${err.message}`);
      }
    }
    
    // Initialize each portal
    // NOTE: In new multi-company setup, company DBs are initialized at login time.
    
    console.log(`\n✅ [portal-setup] All portal databases and collections initialized successfully!\n`);
  } catch (error) {
    console.error(`❌ [portal-setup] Failed to initialize portals: ${error.message}`);
    throw error;
  }
}

module.exports = {
  connectMongo,
  getDb,
  getEmployeePortalDb,
  getUsersCollection,
  getWarehouseUsersCollection,
  initializePortalDatabaseForDb,
  initializeCompanyPortals,
  ensureCompanyPortalsForTenantRequest,
  ensureCollectionsForCompanyDb,
  resolveCompanyDbName,
  getAllRequiredCompanyCollectionNames,
  initializeAllPortals,
  PORTAL_CONFIG,
  LOGIN_DB_NAME,
  EMPLOYEE_DB_NAME,
};
