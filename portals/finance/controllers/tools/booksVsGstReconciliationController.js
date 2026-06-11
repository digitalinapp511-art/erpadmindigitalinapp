const booksVsGstReconciliationService = require('../../services/tools/booksVsGstReconciliationService');

async function processFolder(req, res) {
  try {
    const data = await booksVsGstReconciliationService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][books-vs-gst-reconciliation] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await booksVsGstReconciliationService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][books-vs-gst-reconciliation] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

