const express = require('express');
const router = express.Router();
const c = require('../controllers/assetsController');

router.get('/assets', c.getAssets);
router.post('/assets', c.createAsset);
router.put('/assets', c.updateAsset);
router.delete('/assets', c.deleteAsset);
router.get('/assets/:assetId', c.getAssetDetail);

module.exports = router;
