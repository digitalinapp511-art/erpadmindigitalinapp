const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/amazonTaxInvoiceController');

router.post('/tools/amazon-tax-invoice/process-folder', c.processFolder);
router.post('/tools/amazon-tax-invoice/process-file', c.processFile);

module.exports = router;

