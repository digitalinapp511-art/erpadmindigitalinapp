const express = require('express');
const router = express.Router();
const c = require('../controllers/leavePolicyController');
router.get('/leave-policy', c.getLeavePolicy);
router.put('/leave-policy', c.putLeavePolicy);
module.exports = router;
