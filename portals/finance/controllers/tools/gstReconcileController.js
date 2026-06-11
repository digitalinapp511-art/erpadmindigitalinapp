const gstReconcileService = require('../../services/tools/gstReconcileService');

async function processFolder(req, res) {
  try {
    const data = await gstReconcileService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][gst-reconcile] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await gstReconcileService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][gst-reconcile] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

