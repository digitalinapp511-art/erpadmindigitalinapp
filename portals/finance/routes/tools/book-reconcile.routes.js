const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/bookReconcileController');

router.post('/tools/book-reconcile/process-folder', c.processFolder);
router.post('/tools/book-reconcile/process-file', c.processFile);

module.exports = router;

