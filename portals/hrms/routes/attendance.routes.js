const express = require('express');
const router = express.Router();
const c = require('../controllers/attendanceController');
router.get('/attendance', c.listAttendance);
router.get('/attendance/stats', c.attendanceStats);
router.get('/attendance/stats/by-department', c.attendanceStatsByDepartment);
router.get('/attendance/stats/trends', c.attendanceStatsTrends);
router.get('/attendance/machine-reports/export', c.exportMachineAttendanceReports);
module.exports = router;
