const mysql = require('mysql2/promise');
require('dotenv').config();
const autoSetupDatabase = require('./utils/autoSetup');
const { config } = require('./config/app.config');

async function testConnection() {
  const dbName = config.mysql.database;
  
  // First, try to setup database if it doesn't exist
  const connectionConfig = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password
  };

  console.log('🔌 Testing database connection...');
  console.log('Host:', connectionConfig.host);
  console.log('Port:', connectionConfig.port);
  console.log('User:', connectionConfig.user);
  console.log('Database:', dbName);

  try {
    // First, connect without database to create it if needed
    console.log('\n📦 Checking/Creating database...');
    const setupConnection = await mysql.createConnection(connectionConfig);
    
    // Create database if it doesn't exist (use query for DDL)
    await setupConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ Database "${dbName}" ready`);
    
    // Use the database (must use query, not execute)
    await setupConnection.query(`USE \`${dbName}\``);
    
    // Create users table if it doesn't exist
    await setupConnection.query(`
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
    
    await setupConnection.end();
    
    // Now test the connection with database
    console.log('\n🔍 Testing connection to database...');
    const testConfig = {
      ...connectionConfig,
      database: dbName
    };
    
    const connection = await mysql.createConnection(testConfig);
    console.log('✅ Connection successful!');
    
    // Test query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Query test successful');
    
    // Check if users table exists
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'users'"
    );
    
    if (tables.length > 0) {
      console.log('✅ Users table exists');
      
      // Get table structure
      const [structure] = await connection.execute('DESCRIBE users');
      console.log('\n📋 Table structure:');
      console.table(structure);
      
      // Count records
      const [count] = await connection.execute('SELECT COUNT(*) as total FROM users');
      console.log(`\n📊 Total users: ${count[0].total}`);
    }
    
    await connection.end();
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('1. Make sure MySQL server is running on', connectionConfig.host);
    console.error('2. Verify username and password are correct');
    console.error('3. Check if user "apiuser" has CREATE DATABASE privileges');
    console.error('4. Grant privileges - Run in phpMyAdmin:');
    console.error(`   GRANT ALL PRIVILEGES ON ${dbName}.* TO 'apiuser'@'%';`);
    console.error('   FLUSH PRIVILEGES;');
    console.error('5. Or run: npm run setup-db');
    process.exit(1);
  }
}

testConnection();

