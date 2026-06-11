const amazonPdfMergerService = require('../../services/tools/amazonPdfMergerService');

async function processFolder(req, res) {
  try {
    const data = await amazonPdfMergerService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-pdf-merger] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await amazonPdfMergerService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-pdf-merger] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

