const amazonCreditNoteService = require('../../services/tools/amazonCreditNoteService');

async function processFolder(req, res) {
  try {
    const data = await amazonCreditNoteService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-credit-note] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await amazonCreditNoteService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-credit-note] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

