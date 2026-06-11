const path = require('path');

function loadRootEnv(root) {
  require('dotenv').config({ path: path.join(root, '.env') });
}

/**
 * @param {object} opts
 * @param {string} opts.root - hrms_backend absolute path
 * @param {boolean} [opts.initializeAllPortals]
 * @param {boolean} [opts.mongooseQueryTracker]
 */
async function bootstrapMongo(opts) {
  const { root, initializeAllPortals = false, mongooseQueryTracker = false } = opts;
  const { connectMongo, initializeAllPortals: initPortals } = require(path.join(root, 'config/mongo'));

  try {
    await connectMongo();
    console.log('MongoDB connected');
    if (initializeAllPortals) {
      try {
        await initPortals();
      } catch (e) {
        console.warn('initializeAllPortals:', e.message);
      }
    }
  } catch (e) {
    console.warn('MongoDB:', e.message);
  }

  if (mongooseQueryTracker) {
    try {
      const mongoose = require('mongoose');
      const { config, getMongoUri } = require(path.join(root, 'config/app.config'));
      const uri = getMongoUri(config.mongodb.queryTrackerDbName);
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Query Tracker mongoose:', config.mongodb.queryTrackerDbName);
      }
    } catch (e) {
      console.warn('Mongoose (query-tracker):', e.message);
    }
  }
}

module.exports = { loadRootEnv, bootstrapMongo };
