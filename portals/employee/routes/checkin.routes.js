const express = require('express');
const router = express.Router();

const c = require('../controllers/checkinController');

router.post('/checkin', c.checkin);
router.post('/checkout', c.checkout);
router.get('/checkin/status', c.getCheckinStatus);
router.get('/checkin/history', c.getCheckinHistory);

module.exports = router;