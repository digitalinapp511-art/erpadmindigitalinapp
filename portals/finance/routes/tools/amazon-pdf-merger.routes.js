const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/amazonPdfMergerController');

router.post('/tools/amazon-pdf-merger/process-folder', c.processFolder);
router.post('/tools/amazon-pdf-merger/process-file', c.processFile);

module.exports = router;

