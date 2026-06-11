const { getCompanyFromRequest } = require('../utils/employeeContext');
const { submitRequest, listRequests, getManagerScope, listTeamRequests, decideRequest } = require('../services/attendanceRequestsService');

async function submitAttendanceRequest(req, res) {
  try {
    const { employeeId } = req.body || {};
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const data = await submitRequest({ employeeId, company, body: req.body });

    res.json({
      success: true,
      message: 'Attendance request submitted successfully',
      data,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[attendance-request] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listAttendanceRequests(req, res) {
  try {
    const employeeId = req.query.employeeId;
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const data = await listRequests({ employeeId, company });

    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[attendance-requests] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function managerScope(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const userId = req.query.userId;
    const data = await getManagerScope({ userId, company });
    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[manager-scope] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listTeamAttendanceRequests(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const managerUserId = req.query.managerUserId;
    const status = req.query.status || 'pending';
    const type = req.query.type || 'time-off';
    const data = await listTeamRequests({ managerUserId, company, status, type });
    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (code === 409) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('[team-attendance-requests] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function decideTeamAttendanceRequest(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const { requestId } = req.params;
    const { action, decidedByUserId, decidedByName, rejectionReason } = req.body || {};
    const data = await decideRequest({
      requestId,
      company,
      action,
      decidedByUserId,
      decidedByName,
      reason: rejectionReason,
    });
    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (code === 409) {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error('[team-attendance-requests/decide] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = {
  submitAttendanceRequest,
  listAttendanceRequests,
  managerScope,
  listTeamAttendanceRequests,
  decideTeamAttendanceRequest,
};