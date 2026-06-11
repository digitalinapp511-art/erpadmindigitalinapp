const express = require('express');
const router = express.Router();
const c = require('../controllers/statsController');

router.get('/category-counts', c.getCategoryCounts);

module.exports = router;
