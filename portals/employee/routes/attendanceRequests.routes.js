const express = require('express');
const router = express.Router();

const c = require('../controllers/attendanceRequestsController');

router.post('/attendance-request', c.submitAttendanceRequest);
router.get('/attendance-requests', c.listAttendanceRequests);
router.get('/manager-scope', c.managerScope);
router.get('/team-attendance-requests', c.listTeamAttendanceRequests);
router.post('/team-attendance-requests/:requestId/decide', c.decideTeamAttendanceRequest);

module.exports = router;