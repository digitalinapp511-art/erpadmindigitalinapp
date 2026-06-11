require('dotenv').config({ override: true });

/**
 * Centralized application configuration — URLs, ports, and DB hosts come from .env only
 * (no hardcoded host/port defaults in this file).
 */

const { MONGODB_CONFIG, getMongoUri: getDbMongoUri, getDatabaseName, getCollectionName } = require('./database.config');
const { networkConfig } = require('./network.config');

function requireEnvInt(name) {
  const v = process.env[name];
  if (v == null || !String(v).trim()) {
    throw new Error(`${name} must be set in .env file`);
  }
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) {
    throw new Error(`${name} must be a valid integer`);
  }
  return n;
}

function trimOrNull(name) {
  const v = process.env[name];
  if (v == null || !String(v).trim()) return null;
  return String(v).trim();
}

const poolSizeRaw = process.env.DB_POOL_SIZE;
const poolSize =
  poolSizeRaw != null && String(poolSizeRaw).trim() !== ''
    ? parseInt(poolSizeRaw, 10)
    : 12;

const config = {
  ports: {
    backend: requireEnvInt('BACKEND_PORT'),
    frontend: requireEnvInt('FRONTEND_PORT'),
  },

  mongodb: {
    host: MONGODB_CONFIG.host,
    port: MONGODB_CONFIG.port,
    uri: MONGODB_CONFIG.uri,
    loginDbName: getDatabaseName('login'),
    employeeDbName: getDatabaseName('employee'),
    queryTrackerDbName: getDatabaseName('queryTracker'),
    assetTrackerDbName: getDatabaseName('assetTracker'),
    usersCollection: getCollectionName('users'),
  },

  mysql: {
    host: process.env.DB_HOST ? String(process.env.DB_HOST).trim() : null,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : null,
    user: process.env.DB_USER ? String(process.env.DB_USER).trim() : null,
    password: process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD).trim() : null,
    database: process.env.DB_NAME ? String(process.env.DB_NAME).trim() : null,
    poolSize: Number.isNaN(poolSize) ? 12 : poolSize,
  },

  urls: {
    backendBase: trimOrNull('BACKEND_BASE_URL'),
    frontendBase: trimOrNull('FRONTEND_BASE_URL'),
    backendApi: trimOrNull('BACKEND_API_URL'),
    healthCheck: trimOrNull('HEALTH_CHECK_URL'),
  },

  network: {
    serverIp: networkConfig.serverIp,
  },

  env: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',
  },
};

function getMongoUri(databaseName = null) {
  return getDbMongoUri(databaseName);
}

function getBackendUrl() {
  if (config.urls.backendBase) {
    return config.urls.backendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.backend}`;
}

function getFrontendUrl() {
  if (config.urls.frontendBase) {
    return config.urls.frontendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.frontend}`;
}

function getApiUrl() {
  if (config.urls.backendApi) {
    return config.urls.backendApi;
  }
  return `${getBackendUrl()}/api`;
}

function getHealthCheckUrl() {
  if (config.urls.healthCheck) {
    return config.urls.healthCheck;
  }
  return `${getBackendUrl()}/api/health`;
}

module.exports = {
  config,
  getMongoUri,
  getBackendUrl,
  getFrontendUrl,
  getApiUrl,
  getHealthCheckUrl,
  ports: config.ports,
  mongodb: config.mongodb,
  mysql: config.mysql,
  urls: config.urls,
  network: config.network,
  env: config.env,
};
