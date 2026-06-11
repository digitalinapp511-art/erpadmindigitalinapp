const mysql = require('mysql2/promise');
require('dotenv').config();
const { config } = require('../config/app.config');

async function autoSetupDatabase() {
  const dbName = config.mysql.database;
  
  // Connect without database first
  const connectionConfig = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    connectTimeout: 10000 // 10 seconds timeout
  };

  try {
    console.log('🔧 Auto-setting up database...');
    console.log(`   Connecting to ${connectionConfig.host}:${connectionConfig.port}...`);
    
    const connection = await Promise.race([
      mysql.createConnection(connectionConfig),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000)
      )
    ]);
    
    // Create database if it doesn't exist (use query for DDL)
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ Database "${dbName}" ready`);
    
    // Use the database (must use query, not execute)
    await connection.query(`USE \`${dbName}\``);
    
    // Create users table if it doesn't exist
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(20) NOT NULL,
        role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Users table ready');
    
    await connection.end();
    return true;
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      // Don't show error - MySQL is optional, MongoDB is primary for employee portal
      console.log('ℹ️  MySQL auto-setup skipped (MongoDB is primary for employee portal)');
      console.log(`   MySQL server: ${connectionConfig.host}:${connectionConfig.port} (optional)`);
    } else {
      console.log('ℹ️  MySQL auto-setup skipped:', error.message);
    }
    return false;
  }
}

module.exports = autoSetupDatabase;

