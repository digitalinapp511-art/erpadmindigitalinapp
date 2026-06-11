/**
 * Finance portal (mounted at /api/finance).
 */
const express = require('express');
const { requestLogger } = require('./middlewares/requestLogger');

const router = express.Router();
router.use(requestLogger);
router.use(require('./routes'));

module.exports = router;