const express = require('express');
const router = express.Router();

router.use(require('./portalData.routes'));
router.use(require('./checkin.routes'));
router.use(require('./attendanceRequests.routes'));
router.use(require('./machineAttendance.routes'));

module.exports = router;