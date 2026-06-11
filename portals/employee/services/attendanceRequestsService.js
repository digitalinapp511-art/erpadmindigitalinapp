const { getDb, getEmployeePortalDb, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const { ATTENDANCE_REQUESTS } = require('../models');
const { emitAttendanceChanged } = require('../../../lib/attendanceEvents');
const { ObjectId } = require('mongodb');

const DEPARTMENT_MANAGERS_COLLECTION = 'department_managers';

async function getRequestsCollection(company) {
  const db = company ? await getEmployeePortalDb(company) : await getDb();
  return db.collection(ATTENDANCE_REQUESTS);
}

async function getDepartmentManagersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(DEPARTMENT_MANAGERS_COLLECTION);
}

function normalizeDept(v) {
  return String(v || '').trim();
}

async function fetchEmployeeProfileForRequest({ employeeId, company }) {
  try {
    const usersCol = await getUsersCollection(null, company);
    // Find by employeeId (most reliable). Fallback: email prefix match.
    const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const empId = String(employeeId || '').trim();
    if (!empId) return null;
    const doc = await usersCol.findOne(
      {
        company,
        $or: [
          { employeeId: empId },
          { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
          { email: new RegExp(`^${escapeRe(empId)}(@|$)`, 'i') },
        ],
      },
      { projection: { name: 1, email: 1, employeeId: 1, department: 1 } }
    );
    if (!doc) return null;
    return {
      employeeName: doc.name || '',
      employeeEmail: doc.email || '',
      employeeDepartment: doc.department || '',
    };
  } catch (e) {
    return null;
  }
}

async function getManagerScope({ userId, company }) {
  const normalizedCompany = String(company || '').trim();
  const uid = String(userId || '').trim();
  if (!normalizedCompany || !uid) return { isManager: false, departments: [] };

  const col = await getDepartmentManagersCollection();
  const rows = await col
    .find({ company: normalizedCompany, managerUserIds: uid }, { projection: { department: 1, _id: 0 } })
    .toArray();
  const departments = Array.from(new Set(rows.map((r) => normalizeDept(r.department)).filter(Boolean))).sort();
  return { isManager: departments.length > 0, departments };
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseYyyyMmDd(s) {
  if (!s) return null;
  const d = new Date(`${String(s).trim()}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function parseDateRangeString(dateRange) {
  if (!dateRange) return null;
  const raw = String(dateRange).trim();
  // Supported formats:
  // - "YYYY-MM-DD - YYYY-MM-DD"
  // - "YYYY-MM-DD to YYYY-MM-DD"
  const parts =
    raw.includes(' - ')
      ? raw.split(' - ')
      : raw.toLowerCase().includes(' to ')
        ? raw.split(/ to /i)
        : null;
  if (!parts || parts.length !== 2) return null;
  const start = parseYyyyMmDd(parts[0]);
  const end = parseYyyyMmDd(parts[1]);
  if (!start || !end) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) return null;
  return { start, end };
}

function rangesOverlap(a, b) {
  return Boolean(a && b && a.start <= b.end && b.start <= a.end);
}

async function ensureNoDuplicateRequest({ col, employeeId, type, date, dateRange, leaveType }) {
  const activeStatuses = ['pending', 'approved'];

  if (type === 'regularization') {
    const existing = await col.findOne({
      employeeId,
      type: 'regularization',
      date,
      status: { $in: activeStatuses },
    });
    if (existing) {
      const err = new Error('You already have a regularization request for this date. You cannot submit a duplicate request for the same date.');
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  if (type === 'time-off') {
    const lt = String(leaveType || 'Time Off').trim();
    const requested = parseDateRangeString(dateRange);
    if (!requested) return; // fall back to old behavior if format unknown

    const existing = await col
      .find({
        employeeId,
        type: 'time-off',
        leaveType: lt,
        status: { $in: activeStatuses },
      })
      .project({ dateRange: 1 })
      .toArray();

    const overlap = existing.some((r) => rangesOverlap(parseDateRangeString(r.dateRange), requested));
    if (overlap) {
      const err = new Error('You already have a leave request of this type for the same date(s). Please update the existing request instead of creating a duplicate.');
      err.statusCode = 400;
      throw err;
    }
  }
}

function validateType(type) {
  const validTypes = ['regularization', 'on-duty', 'time-off'];
  if (!validTypes.includes(type)) {
    const err = new Error('Invalid request type. Must be: regularization, on-duty, or time-off');
    err.statusCode = 400;
    throw err;
  }
}

function validateFields(type, body) {
  const { date, timeWindow, location, dateRange, reason } = body;
  if (type === 'regularization' && (!date || !timeWindow)) {
    const err = new Error('Date and time window are required for regularization');
    err.statusCode = 400;
    throw err;
  }
  if (type === 'on-duty' && (!date || !location)) {
    const err = new Error('Date and location are required for on-duty request');
    err.statusCode = 400;
    throw err;
  }
  if (type === 'time-off' && (!dateRange || !reason)) {
    const err = new Error('Date range and reason are required for time-off request');
    err.statusCode = 400;
    throw err;
  }
}

async function submitRequest({ employeeId, company, body }) {
  const { type } = body || {};

  if (!employeeId || !type) {
    const err = new Error('Employee ID and request type are required');
    err.statusCode = 400;
    throw err;
  }

  validateType(type);
  validateFields(type, body);

  const col = await getRequestsCollection(company);

  const { date, timeWindow, notes, location, details, dateRange, reason, leaveType } = body;

  await ensureNoDuplicateRequest({
    col,
    employeeId,
    type,
    date,
    dateRange,
    leaveType,
  });

  const employeeProfileRaw = await fetchEmployeeProfileForRequest({ employeeId, company });
  const employeeProfile = employeeProfileRaw
    ? {
        ...employeeProfileRaw,
        employeeDepartment: normalizeDept(employeeProfileRaw.employeeDepartment),
        employeeDepartmentNormalized: normalizeDept(employeeProfileRaw.employeeDepartment).toLowerCase(),
      }
    : null;

  const requestDoc = {
    employeeId,
    type,
    status: 'pending',
    submittedAt: new Date(),
    company: company || null,
    ...(employeeProfile || {}),
    ...(type === 'regularization' && { date, timeWindow, notes: notes || '' }),
    ...(type === 'on-duty' && { date, location, details: details || '' }),
    ...(type === 'time-off' && {
      dateRange,
      reason: reason || '',
      leaveType: leaveType || 'Time Off',
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await col.insertOne(requestDoc);
  // Attendance requests can affect dashboard stats once approved (and are visible in pending counts).
  emitAttendanceChanged({ company, type: 'attendance_request_submitted', date: (date || new Date().toISOString().slice(0, 10)) });
  return { requestId: result.insertedId, type, status: 'pending' };
}

async function listRequests({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getRequestsCollection(company);
  const requests = await col.find({ employeeId }).sort({ submittedAt: -1 }).toArray();

  return {
    requests: requests.map((req) => ({
      id: req._id,
      type: req.type,
      status: req.status,
      leaveType: req.leaveType,
      submittedAt: req.submittedAt,
      date: req.date,
      timeWindow: req.timeWindow,
      notes: req.notes,
      location: req.location,
      details: req.details,
      dateRange: req.dateRange,
      reason: req.reason,
      approvedAt: req.approvedAt,
      rejectedAt: req.rejectedAt,
      approvedBy: req.approvedBy,
      rejectionReason: req.rejectionReason,
      updatedAt: req.updatedAt,
      employeeName: req.employeeName,
      employeeEmail: req.employeeEmail,
      employeeDepartment: req.employeeDepartment,
    })),
  };
}

async function listTeamRequests({ managerUserId, company, status = 'pending', type = 'time-off' }) {
  if (!managerUserId) {
    const err = new Error('managerUserId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!company) {
    const err = new Error('company is required');
    err.statusCode = 400;
    throw err;
  }

  const scope = await getManagerScope({ userId: managerUserId, company });
  if (!scope.isManager) {
    return { departments: [], requests: [] };
  }

  // Build a robust employeeId allowlist from users collection (handles older requests that may not
  // have employeeDepartment fields populated).
  const usersCol = await getUsersCollection(null, company);
  const scopedEmployees = await usersCol
    .find(
      {
        company,
        department: { $in: scope.departments },
      },
      { projection: { employeeId: 1, email: 1 } }
    )
    .toArray();

  const employeeIdAllow = Array.from(
    new Set(
      scopedEmployees
        .flatMap((u) => {
          const ids = [];
          const empId = String(u?.employeeId || '').trim();
          if (empId) ids.push(empId);
          const email = String(u?.email || '').trim();
          if (email && email.includes('@')) ids.push(email.split('@')[0]);
          return ids;
        })
        .filter(Boolean)
    )
  );

  const col = await getRequestsCollection(company);
  const normalizedDepartments = scope.departments.map((d) => normalizeDept(d)).filter(Boolean);
  const normalizedDepartmentsLc = normalizedDepartments.map((d) => d.toLowerCase());
  const query = {
    company,
    $or: [
      { employeeDepartment: { $in: normalizedDepartments } },
      { employeeDepartmentNormalized: { $in: normalizedDepartmentsLc } },
      ...(employeeIdAllow.length > 0 ? [{ employeeId: { $in: employeeIdAllow } }] : []),
    ],
  };
  if (status && status !== 'all') query.status = status;
  if (type && type !== 'all') query.type = type;

  const requests = await col.find(query).sort({ submittedAt: -1 }).toArray();
  return {
    departments: scope.departments,
    requests: requests.map((req) => ({
      id: req._id?.toString?.() || String(req._id),
      employeeId: req.employeeId,
      employeeName: req.employeeName || '',
      employeeEmail: req.employeeEmail || '',
      employeeDepartment: req.employeeDepartment || '',
      type: req.type,
      status: req.status,
      leaveType: req.leaveType,
      submittedAt: req.submittedAt,
      dateRange: req.dateRange,
      reason: req.reason,
      date: req.date,
      timeWindow: req.timeWindow,
      location: req.location,
      details: req.details,
      notes: req.notes,
      approvedAt: req.approvedAt,
      rejectedAt: req.rejectedAt,
      approvedBy: req.approvedBy,
      rejectedBy: req.rejectedBy,
      rejectionReason: req.rejectionReason,
      updatedAt: req.updatedAt,
    })),
  };
}

async function decideRequest({ requestId, company, action, decidedByUserId, decidedByName, reason }) {
  if (!requestId || !ObjectId.isValid(String(requestId))) {
    const err = new Error('Invalid requestId');
    err.statusCode = 400;
    throw err;
  }
  if (!company) {
    const err = new Error('company is required');
    err.statusCode = 400;
    throw err;
  }
  if (!decidedByUserId) {
    const err = new Error('decidedByUserId is required');
    err.statusCode = 400;
    throw err;
  }
  const act = String(action || '').toLowerCase();
  if (!['approve', 'reject'].includes(act)) {
    const err = new Error('action must be approve or reject');
    err.statusCode = 400;
    throw err;
  }

  const col = await getRequestsCollection(company);
  const _id = new ObjectId(String(requestId));
  const now = new Date();

  // Authorization: ensure this user is a manager for this request's department
  const existing = await col.findOne({ _id }, { projection: { employeeDepartment: 1, employeeDepartmentNormalized: 1, status: 1 } });
  if (!existing) {
    const err = new Error('Request not found');
    err.statusCode = 404;
    throw err;
  }
  const scope = await getManagerScope({ userId: decidedByUserId, company });
  if (!scope.isManager) {
    const err = new Error('Not authorized to approve/reject team requests');
    err.statusCode = 403;
    throw err;
  }
  const dept = normalizeDept(existing.employeeDepartment) || '';
  const deptLc = (existing.employeeDepartmentNormalized || dept).toLowerCase();
  const allowed = scope.departments.some((d) => normalizeDept(d).toLowerCase() === deptLc);
  if (!allowed) {
    const err = new Error('Not authorized for this department');
    err.statusCode = 403;
    throw err;
  }

  const update =
    act === 'approve'
      ? {
          $set: {
            status: 'approved',
            approvedAt: now,
            approvedBy: decidedByName || decidedByUserId,
            approvedByUserId: String(decidedByUserId),
            approvedByRole: 'manager',
            updatedAt: now,
          },
        }
      : {
          $set: {
            status: 'rejected',
            rejectedAt: now,
            rejectedBy: decidedByName || decidedByUserId,
            rejectedByUserId: String(decidedByUserId),
            rejectedByRole: 'manager',
            rejectionReason: String(reason || '').trim(),
            updatedAt: now,
          },
        };

  // First-wins: only pending can be updated.
  const result = await col.updateOne({ _id, status: 'pending' }, update);
  if (result.matchedCount === 0) {
    const err = new Error('This request was already processed by someone else.');
    err.statusCode = 409;
    throw err;
  }

  emitAttendanceChanged({ company, type: `attendance_request_${act}d_by_manager`, date: new Date().toISOString().slice(0, 10) });
  return { requestId: String(requestId), status: act === 'approve' ? 'approved' : 'rejected' };
}

module.exports = { submitRequest, listRequests, getManagerScope, listTeamRequests, decideRequest };