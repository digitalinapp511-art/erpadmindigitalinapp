const express = require('express');
const router = express.Router();
const c = require('../controllers/leavesController');
router.get('/leaves', c.listLeaves);
router.get('/attendance-requests', c.listAttendanceRequests);
router.get('/leaves/overview/stats', c.leaveOverviewStats);
router.get('/leaves/overview/utilization', c.leaveUtilization);
// Leave balance allocation + history (HR-managed)
router.get('/leave-balances', c.listLeaveBalances);
router.get('/leave-balances/:employeeId', c.getLeaveBalance);
router.post('/leave-balances/:employeeId/adjust', c.adjustLeaveBalance);
router.get('/leave-balances/:employeeId/history', c.getLeaveBalanceHistory);
router.get('/attendance-requests/stats', c.attendanceRequestStats);
router.post('/attendance-requests/:requestId/approve', c.approveAttendanceRequest);
router.post('/attendance-requests/:requestId/reject', c.rejectAttendanceRequest);
router.put('/attendance-requests/:requestId', c.updateAttendanceRequest);
router.delete('/attendance-requests/:requestId', c.deleteAttendanceRequest);
router.post('/attendance-requests', c.createAttendanceRequest);
module.exports = router;
