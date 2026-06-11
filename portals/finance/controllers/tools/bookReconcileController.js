const bookReconcileService = require('../../services/tools/bookReconcileService');

async function processFolder(req, res) {
  try {
    const data = await bookReconcileService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][book-reconcile] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await bookReconcileService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][book-reconcile] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

