const amazonTaxInvoiceService = require('../../services/tools/amazonTaxInvoiceService');

async function processFolder(req, res) {
  try {
    const data = await amazonTaxInvoiceService.processFolder(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-tax-invoice] processFolder error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processFile(req, res) {
  try {
    const data = await amazonTaxInvoiceService.processFile(req);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[finance][amazon-tax-invoice] processFile error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { processFolder, processFile };

