const { getCompanyFromRequest } = require('../utils/employeeContext');
const { checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS } = require('../utils/employeeContext');
const { checkinEmployee, checkoutEmployee, getTodayStatus, getHistory } = require('../services/checkinService');
const { initializeCompanyPortals } = require('../../../config/mongo');
const { emitAttendanceChanged } = require('../../../lib/attendanceEvents');
const { invalidateAttendanceCaches } = require('../../../lib/cacheInvalidation');

async function checkin(req, res) {
  try {
    const { employeeId } = req.body;
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    try {
      await initializeCompanyPortals(company);
    } catch (e) {
      console.warn('[checkin] initializeCompanyPortals:', e.message);
    }

    const data = await checkinEmployee({ employeeId, company });
    emitAttendanceChanged({ company, type: 'checkin', date: new Date().toISOString().slice(0, 10) });
    invalidateAttendanceCaches(company).catch(() => {});
    res.json({ success: true, message: 'Checked in successfully', data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function checkout(req, res) {
  try {
    const { employeeId } = req.body;
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    try {
      await initializeCompanyPortals(company);
    } catch (e) {
      console.warn('[checkout] initializeCompanyPortals:', e.message);
    }

    const data = await checkoutEmployee({ employeeId, company });
    emitAttendanceChanged({ company, type: 'checkout', date: new Date().toISOString().slice(0, 10) });
    invalidateAttendanceCaches(company).catch(() => {});
    res.json({ success: true, message: 'Checked out successfully', data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkout] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCheckinStatus(req, res) {
  try {
    const employeeId = req.query.employeeId;
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const data = await getTodayStatus({
      employeeId,
      company,
      cache: { map: checkinStatusCache, ttlMs: CHECKIN_STATUS_CACHE_TTL_MS },
    });

    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin/status] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCheckinHistory(req, res) {
  try {
    const employeeId = req.query.employeeId;
    const limit = parseInt(req.query.limit, 10) || 30;
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const data = await getHistory({ employeeId, company, limit });
    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin/history] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { checkin, checkout, getCheckinStatus, getCheckinHistory };