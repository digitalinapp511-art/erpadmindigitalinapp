const express = require('express');
const router = express.Router();

const c = require('../controllers/financeController');

router.get('/dashboard', c.getDashboard);
router.post('/invoices/process', c.processInvoices);

// Finance tools (split per feature)
router.use(require('./tools'));

module.exports = router;