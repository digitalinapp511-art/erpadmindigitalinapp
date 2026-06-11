const financeService = require('../services/financeService');

async function getDashboard(req, res) {
  try {
    const data = await financeService.getDashboard(req);
    res.json({ success: true, message: 'Finance dashboard endpoint - to be implemented', data });
  } catch (error) {
    console.error('Finance dashboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function processInvoices(req, res) {
  try {
    const data = await financeService.processInvoices(req);
    res.json({ success: true, message: 'Finance invoice processing endpoint - to be implemented', data });
  } catch (error) {
    console.error('Finance invoice processing error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getDashboard, processInvoices };