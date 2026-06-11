/**
 * HRMS Admin portal – cross-company recruitment ops (recruiters, interviews across DBs).
 * Mounted at /api/hrms before the main HRMS router.
 */
const express = require('express');

const router = express.Router();

router.use(require('../hrms/routes/recruitmentAdmin.routes'));

module.exports = router;