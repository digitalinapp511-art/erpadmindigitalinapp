const { getCompanyFromRequest } = require('../utils/employeeContext');
const { getOrCreateDoc } = require('../services/getOrCreateDoc');
const { defaultDashboard, defaultAttendance, defaultRequests, defaultOrg, defaultReports } = require('../services/defaults');
const { connectMongo, getEmployeePortalDb } = require('../../../config/mongo');
const {
  PORTAL_DASHBOARD,
  PORTAL_ATTENDANCE,
  PORTAL_REQUESTS,
  PORTAL_ORG,
  PORTAL_REPORTS,
} = require('../models');

const LEAVE_BALANCES_COLLECTION = 'leave_balances';
const DEFAULT_LEAVE_BALANCES = {
  'Casual Leave': 4,
  'Sick Leave': 3,
  'Earned Leave': 5,
  'Work From Home': 2,
  'Compensatory Off': 1,
  'LOP': 0,
};

async function getLeaveBalancesForEmployee({ company, employeeId }) {
  if (!company || !employeeId) return { balances: { ...DEFAULT_LEAVE_BALANCES } };
  await connectMongo();
  const db = await getEmployeePortalDb(company);
  const col = db.collection(LEAVE_BALANCES_COLLECTION);
  const doc = await col.findOne({ company, employeeId }, { projection: { balances: 1 } });
  return { balances: { ...DEFAULT_LEAVE_BALANCES, ...(doc?.balances || {}) } };
}

function balancesToList(balances) {
  const b = balances || {};
  return Object.keys(DEFAULT_LEAVE_BALANCES).map((type) => ({
    type,
    balance: Number.isFinite(Number(b[type])) ? Number(b[type]) : 0,
  }));
}

function totalLeaveBalance(balances) {
  const b = balances || {};
  // Exclude LOP from "available balance"
  return ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Work From Home', 'Compensatory Off'].reduce((sum, k) => {
    const v = Number(b[k] || 0);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

async function getDashboard(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_DASHBOARD, { employeeId }, defaultDashboard(employeeId), company);
    // Best-effort: populate live leave balance in quickStats when available.
    try {
      const { balances } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.quickStats = doc.quickStats || {};
      doc.quickStats.leaveBalance = totalLeaveBalance(balances);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getAttendance(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_ATTENDANCE, { employeeId }, defaultAttendance(employeeId), company);
    // Provide leaveBalance for UI (Employee Attendance page reads this).
    try {
      const { balances } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.leaveBalance = totalLeaveBalance(balances);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getRequests(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_REQUESTS, { employeeId }, defaultRequests(employeeId), company);
    // Replace static balances with HR-managed balances when available.
    try {
      const { balances } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.leaveBalances = balancesToList(balances);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Requests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getOrg(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_ORG, { key: 'org' }, defaultOrg(), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Org error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getReports(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_REPORTS, { key: 'reports' }, defaultReports(), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getDashboard, getAttendance, getRequests, getOrg, getReports };