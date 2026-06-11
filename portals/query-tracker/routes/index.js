const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const queriesRoutes = require('./queries');
const usersRoutes = require('./users');
const reportsRoutes = require('./reports');

// Mount routes
router.use('/auth', authRoutes);
router.use('/queries', queriesRoutes);
router.use('/users', usersRoutes);
router.use('/reports', reportsRoutes);

module.exports = router;

