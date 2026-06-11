const express = require('express');
const router = express.Router();
const c = require('../controllers/recruitmentAdminController');
router.get('/recruitment/recruiters', c.listRecruiters);
router.post('/recruitment/recruiters', c.createRecruiter);
router.put('/recruitment/recruiters/:id', c.updateRecruiter);
router.delete('/recruitment/recruiters/:id', c.deleteRecruiter);
router.get('/recruitment/interviews', c.listInterviews);
module.exports = router;
