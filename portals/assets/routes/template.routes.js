const express = require('express');
const router = express.Router();
const c = require('../controllers/templateController');

router.get('/template', c.getTemplate);

module.exports = router;
