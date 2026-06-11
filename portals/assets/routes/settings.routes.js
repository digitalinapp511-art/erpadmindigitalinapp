const express = require('express');
const router = express.Router();
const c = require('../controllers/settingsController');

router.get('/settings/categories', c.getCategories);
router.put('/settings/categories', c.putCategories);
router.get('/settings/locations', c.getLocations);
router.put('/settings/locations', c.putLocations);

module.exports = router;
