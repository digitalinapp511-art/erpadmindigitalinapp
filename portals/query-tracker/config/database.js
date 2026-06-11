const mongoose = require('mongoose');
const { getMongoUriForCompany } = require('../../../config/database.config');
const { resolveCompanyDbName } = require('../../../config/mongo');

// In the new setup, Query Tracker data is stored inside the company DB (on company Mongo server).
async function ensureQueryTrackerConnection(company) {
  try {
    if (!company) {
      throw new Error('company is required for Query Tracker');
    }
    const dbName = resolveCompanyDbName(company);
    const uriBase = getMongoUriForCompany(company);
    const base = uriBase.endsWith('/') ? uriBase : `${uriBase}/`;
    const fullUri = `${base}${encodeURIComponent(dbName)}`;

    // If not connected, connect to company DB
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(fullUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log(`[Query Tracker DB] Connected to company DB: ${dbName}`);
    } else {
      // If connected to a different database, switch to company DB
      const currentDbName = mongoose.connection.db?.databaseName;
      if (currentDbName !== dbName) {
        mongoose.connection.useDb(dbName);
        console.log(`[Query Tracker DB] Switched to company DB: ${dbName}`);
      }
    }
    return mongoose.connection;
  } catch (error) {
    console.error('[Query Tracker DB] Connection error:', error);
    throw error;
  }
}

module.exports = {
  ensureQueryTrackerConnection,
};

