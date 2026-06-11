const express = require('express');
const router = express.Router();
const c = require('../controllers/employeesController');
router.get('/employees', c.listEmployees);
module.exports = router;
