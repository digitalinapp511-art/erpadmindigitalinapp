const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/booksVsGstReconciliationController');

router.post('/tools/books-vs-gst-reconciliation/process-folder', c.processFolder);
router.post('/tools/books-vs-gst-reconciliation/process-file', c.processFile);

module.exports = router;

