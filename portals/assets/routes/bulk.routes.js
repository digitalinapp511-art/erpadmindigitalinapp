const express = require('express');
const router = express.Router();
const c = require('../controllers/bulkController');

router.post('/assets/bulk', c.bulkUpsertAssets);

module.exports = router;
