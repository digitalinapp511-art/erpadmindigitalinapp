const express = require('express');
const router = express.Router();
const c = require('../controllers/historyController');

router.get('/history', c.getHistory);
router.post('/history', c.addHistory);

module.exports = router;
