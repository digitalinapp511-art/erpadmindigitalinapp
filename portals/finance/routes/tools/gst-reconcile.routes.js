const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/gstReconcileController');

router.post('/tools/gst-reconcile/process-folder', c.processFolder);
router.post('/tools/gst-reconcile/process-file', c.processFile);

module.exports = router;

