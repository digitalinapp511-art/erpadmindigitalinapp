const express = require('express');
const router = express.Router();

const c = require('../controllers/authController');

router.post('/signup', c.signup);
router.post('/login', c.login);
router.get('/verify', c.verify);

module.exports = router;
