const mongoose = require('mongoose');
const User = require('../models/User');
const dotenv = require('dotenv');
const { config, getMongoUri } = require('../../../config/app.config');

dotenv.config();

const seedAdmin = async () => {
  try {
    const queryTrackerUri = getMongoUri(config.mongodb.queryTrackerDbName);
    await mongoose.connect(queryTrackerUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@querytracker.com' });
    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    // Create admin user
    const admin = new User({
      name: 'Admin User',
      email: 'admin@querytracker.com',
      password: 'admin123',
      role: 'admin'
    });

    await admin.save();
    console.log('Admin user created successfully!');
    console.log('Email: admin@querytracker.com');
    console.log('Password: admin123');
    console.log('Please change the password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();

