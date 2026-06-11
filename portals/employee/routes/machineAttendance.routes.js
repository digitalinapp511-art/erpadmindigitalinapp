const express = require('express');
const router = express.Router();

const c = require('../controllers/machineAttendanceController');

router.get('/machine-attendance', c.getMachineAttendance);

module.exports = router;

