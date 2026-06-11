const mysql = require('mysql2/promise');
require('dotenv').config();
const { config } = require('./app.config');

if (!config.mysql.host || !config.mysql.user || !config.mysql.database) {
  // Mongo-first setup: MySQL is optional. Export a stub so legacy imports don't crash.
  const stub = {};
  stub.isConnected = () => false;
  stub.getConnectionError = () => new Error('MySQL disabled: DB_* env vars not set');
  stub.getConnection = async () => {
    throw new Error('MySQL disabled: DB_* env vars not set');
  };
  module.exports = stub;
  return;
}

const DB_CONFIG = {
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: config.mysql.poolSize,
  queueLimit: 0,
  connectTimeout: 10000 // 10 seconds connection timeout
};

const pool = mysql.createPool(DB_CONFIG);

// Track connection status
let isConnected = false;
let connectionError = null;

// Test connection with retry logic
async function testConnection(retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await pool.getConnection();
      console.log('✅ Database connected successfully');
      console.log(`   Host: ${DB_CONFIG.host}`);
      console.log(`   Port: ${DB_CONFIG.port}`);
      console.log(`   User: ${DB_CONFIG.user}`);
      console.log(`   Database: ${DB_CONFIG.database}`);
      connection.release();
      isConnected = true;
      connectionError = null;
      return true;
    } catch (err) {
      connectionError = err;
      if (i < retries - 1) {
        console.log(`⚠️  Connection attempt ${i + 1}/${retries} failed, retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ Database connection failed after', retries, 'attempts');
        console.error('   Error:', err.message);
        console.error('\n💡 Troubleshooting steps:');
        console.error('1. Check if MySQL server is running on', DB_CONFIG.host);
        console.error('2. Verify network connectivity: ping', DB_CONFIG.host);
        console.error('3. Check firewall settings - port', DB_CONFIG.port, 'should be open');
        console.error('4. Verify MySQL user credentials in .env file');
        console.error('5. Check MySQL bind-address configuration (should allow remote connections)');
        console.error('6. Run: npm run test-connection (to test database connection)');
        console.error('\n📝 Current Configuration:');
        console.error('   DB_HOST:', DB_CONFIG.host);
        console.error('   DB_PORT:', DB_CONFIG.port);
        console.error('   DB_USER:', DB_CONFIG.user);
        console.error('   DB_NAME:', DB_CONFIG.database);
        isConnected = false;
        return false;
      }
    }
  }
}

// MySQL connection test disabled - MongoDB is now the primary database
// Only test MySQL connection when explicitly needed by other portals
// testConnection() is commented out to prevent startup errors

// Helper function to check if database is available
pool.isConnected = () => isConnected;
pool.getConnectionError = () => connectionError;

// Override getConnection to provide better error handling
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async function() {
  if (!isConnected && connectionError) {
    throw new Error(`Database connection unavailable: ${connectionError.message}`);
  }
  return originalGetConnection();
};

module.exports = pool;

