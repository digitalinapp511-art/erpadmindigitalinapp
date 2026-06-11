const express = require('express');
const router = express.Router();

router.use(require('./assets.routes'));
router.use(require('./history.routes'));
router.use(require('./settings.routes'));
router.use(require('./stats.routes'));
router.use(require('./bulk.routes'));
router.use(require('./template.routes'));

module.exports = router;
