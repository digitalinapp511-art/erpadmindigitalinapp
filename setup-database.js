const mysql = require('mysql2/promise');
require('dotenv').config();
const { config } = require('./config/app.config');

async function setupDatabase() {
  const dbName = config.mysql.database;
  
  // Connect without database first (since it might not exist)
  const connectionConfig = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password
  };

  try {
    console.log('🔌 Connecting to MySQL server...');
    console.log(`   Host: ${connectionConfig.host}`);
    console.log(`   User: ${connectionConfig.user}`);
    
    const connection = await mysql.createConnection(connectionConfig);
    console.log('✅ Connected to MySQL server');
    
    // Create database if it doesn't exist (use query for DDL)
    console.log(`📦 Creating database "${dbName}" if not exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ Database "${dbName}" created/verified`);
    
    // Use the database (must use query, not execute)
    await connection.query(`USE \`${dbName}\``);
    
    // Create users table
    console.log('📋 Creating users table...');
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
    console.log('✅ Users table created/verified');
    
    await connection.end();
    console.log('🎉 Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  }
}

setupDatabase();

