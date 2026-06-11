const express = require('express');
const router = express.Router();

const c = require('../../controllers/tools/amazonCreditNoteController');

router.post('/tools/amazon-credit-note/process-folder', c.processFolder);
router.post('/tools/amazon-credit-note/process-file', c.processFile);

module.exports = router;

