/**
 * Admin portal – authentication and admin user management.
 */
const express = require('express');
const { requestLogger } = require('./middlewares/requestLogger');
const authRoutes = require('./routes/auth');
const adminUsersRoutes = require('./routes/admin-users');
const adminWarehouseUsersRoutes = require('./routes/admin-warehouse-users');

const router = express.Router();
router.use(requestLogger);

module.exports = {
  router,
  authRoutes,
  adminUsersRoutes,
  adminWarehouseUsersRoutes,
};
