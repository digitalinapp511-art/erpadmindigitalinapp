const { MongoClient } = require('mongodb');
const { getMongoUri } = require('./config/app.config');

const MONGO_URI = getMongoUri();

async function testConnection() {
  console.log('🔍 Testing MongoDB connection...');
  console.log(`📍 Connection URI: ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}`);
  console.log('');

  let client;
  try {
    client = new MongoClient(MONGO_URI, {
      connectTimeoutMS: 5008,
      serverSelectionTimeoutMS: 5008,
    });

    console.log('⏳ Attempting to connect...');
    await client.connect();
    console.log('✅ Connection successful!');

    // Test ping
    const adminDb = client.db('admin');
    const result = await adminDb.command({ ping: 1 });
    console.log('✅ Ping successful:', result);

    // List databases
    const dbs = await client.db().admin().listDatabases();
    console.log('\n📊 Available databases:');
    dbs.databases.forEach(db => {
      console.log(`   - ${db.name} (${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    });

    console.log('\n✅ All tests passed! MongoDB is accessible.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection failed!');
    console.error(`   Error: ${error.message}`);
    console.error('');

    if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
      console.log('💡 Troubleshooting steps:');
      console.log('   1. Verify MongoDB is running on localhost');
      console.log('   2. Check if MongoDB service is running: net start MongoDB');
      console.log('   3. Verify MongoDB is listening: netstat -ano | findstr :27017');
      console.log('   4. Check MongoDB logs: type C:\\data\\log\\mongod.log');
      console.log('');
      console.log('   See MONGODB_NETWORK_SETUP.md for detailed instructions');
    } else if (error.message.includes('Authentication failed')) {
      console.log('💡 Authentication failed. Try without credentials or check user/password.');
    } else if (error.message.includes('timeout')) {
      console.log('💡 Connection timeout. Check network connectivity and firewall rules.');
    }

    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

testConnection();

