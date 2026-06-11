const express = require('express');
const router = express.Router();

router.use(require('./amazon-tax-invoice.routes'));
router.use(require('./amazon-credit-note.routes'));
router.use(require('./book-reconcile.routes'));
router.use(require('./gst-reconcile.routes'));
router.use(require('./books-vs-gst-reconciliation.routes'));
router.use(require('./amazon-pdf-merger.routes'));

module.exports = router;

