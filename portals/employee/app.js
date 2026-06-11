/**
 * Employee self-service portal (mounted at /api/employee).
 */
const express = require('express');
const { requestLogger } = require('./middlewares/requestLogger');

const router = express.Router();

router.use(requestLogger);
router.use(require('./routes'));

module.exports = router;
