const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./lib/logFilter').installLogFilter();

// Network (BACKEND_PORT) then app config (ports, DB, Mongo from .env)
require('./config/network.config');
const { config, ports, getMongoUri, getBackendUrl: getAppBackendUrl } = require('./config/app.config');
const { networkConfig, backendPort } = require('./config/network.config');
const { getCorsOptions } = require('./config/cors.config');
const { subscribeAttendanceEvents } = require('./lib/attendanceEvents');
const { initRedis } = require('./lib/responseCache');

initRedis().catch(() => {});

// Portals (see /portals/<name>/app.js — shared config/ and this server.js at repo root)
const { authRoutes, adminUsersRoutes, adminWarehouseUsersRoutes } = require('./portals/admin-portal/app');
const hrmsAdminRoutes = require('./portals/hrms-admin/app');
const hrmsRoutes = require('./portals/hrms/app');
const assetTrackerRoutes = require('./portals/assets/app');
const financeRoutes = require('./portals/finance/app');
const employeeRoutes = require('./portals/employee/app');
const queryTrackerRoutes = require('./portals/query-tracker/app');

// MySQL auto-setup disabled - using MongoDB only
// const autoSetupDatabase = require('./utils/autoSetup');

const app = express();
// Use port from network.config.js (single source of truth)
const PORT = backendPort;

// Middleware — CORS from config/cors.config.js (CORS_ORIGIN / FRONTEND_BASE_URL in production)
app.use(cors(getCorsOptions()));

// SSE: attendance invalidation stream (push updates; client revalidates via ETag)
app.get('/api/events/attendance', (req, res) => subscribeAttendanceEvents(req, res));

// Add request logging middleware for debugging
const ENABLE_REQUEST_LOGS = process.env.REQUEST_LOGS === 'true' || process.env.NODE_ENV !== 'production';
const REQUEST_LOG_EXCLUDE_PATHS = new Set([
  '/api/health',
  '/api/employee/checkin/status',
]);

if (ENABLE_REQUEST_LOGS) {
  app.use((req, res, next) => {
    // Avoid noisy hot-path logs in production/PM2
    if (!REQUEST_LOG_EXCLUDE_PATHS.has(req.path)) {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
  });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Admin portal (auth + admin users)
app.use('/api/auth', authRoutes);
app.use('/api/admin-users', adminUsersRoutes);
app.use('/api/admin-warehouse-users', adminWarehouseUsersRoutes);

// HRMS: admin surface first, then main HRMS API
const mountHrms = () => {
  app.use('/api/hrms', hrmsAdminRoutes);
  app.use('/api/hrms', hrmsRoutes);
  // Legacy frontend paths use /api/hrms-portal/* — same handlers
  app.use('/api/hrms-portal', hrmsAdminRoutes);
  app.use('/api/hrms-portal', hrmsRoutes);
};
mountHrms();
app.use('/api/asset-tracker', assetTrackerRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/query-tracker', queryTrackerRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  let mongoStatus = false;
  let mongoError = null;
  
  // Check MongoDB connection
  try {
    const { connectMongo } = require('./config/mongo');
    await connectMongo();
    mongoStatus = true;
  } catch (err) {
    mongoStatus = false;
    mongoError = err.message;
  }
  
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    database: {
      type: 'MongoDB',
      connected: mongoStatus,
      error: mongoError,
      uri: getMongoUri()
    }
  });
});

// Error handling middleware - must be after all routes
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Start server and test MongoDB connection
async function startServer() {
  // Test MongoDB connection on startup
  try {
    const { connectMongo, initializeAllPortals } = require('./config/mongo');
    await connectMongo();
    console.log('✅ MongoDB connected successfully');
    
    // Initialize all portal databases and collections
    try {
      await initializeAllPortals();
    } catch (initErr) {
      console.error('⚠️  Portal initialization warning:', initErr.message);
      console.log('   Server will continue, but some portal features may not work until databases are created');
    }
  } catch (err) {
    console.error('⚠️  MongoDB connection warning:', err.message);
    console.log('   Server will start, but MongoDB features may not work until connection is established');
  }
  
  // Query Tracker: mongoose connects per company in middleware (no global DB at startup).

  // Start server
  // Listen on all interfaces (0.0.0.0) to allow network access
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running — public API base: ${getAppBackendUrl()}`);
    console.log(`   Resolved host (dev/LAN hint): ${networkConfig.serverIp} | listen port: ${PORT}`);
    console.log(`📝 MongoDB: main/login mongod default :27012; Ecosoul :27013; Thrive :27014 (override with MONGO_HOST / MONGO_URI_*)`);
    console.log(`   Login DB: ${config.mongodb.loginDbName} / ${config.mongodb.usersCollection}`);
    console.log(`   Company portal data: DB name per company on MONGO_URI_ECOSOUL / MONGO_URI_THRIVE (defaults :27013 / :27014)`);
    console.log(`   (Legacy env names MONGO_DB_NAME / QUERY_TRACKER_DB_NAME etc. no longer select separate DBs per module — company DB holds all portal collections.)`);
  });
}

startServer();

