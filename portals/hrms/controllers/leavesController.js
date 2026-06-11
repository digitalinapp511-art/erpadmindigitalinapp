/**
 * Leave listing, leave overview stats, and attendance-requests (HR approval workflow).
 */
const { connectMongo, getDb, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');
const { emitAttendanceChanged } = require('../../../lib/attendanceEvents');
const { invalidateAttendanceCaches, invalidatePayrollCaches } = require('../../../lib/cacheInvalidation');

const LEAVE_BALANCES_COLLECTION = 'leave_balances';
const LEAVE_BALANCE_HISTORY_COLLECTION = 'leave_balance_history';
const DEFAULT_LEAVE_BALANCES = {
  'Casual Leave': 0,
  'Sick Leave': 0,
  'Earned Leave': 0,
  'Work From Home': 0,
  'Compensatory Off': 0,
  'LOP': 0,
};

function normalizeLeaveTypeKey(leaveType) {
  const raw = String(leaveType || '').trim();
  if (!raw) return null;
  // accept common variants
  const map = new Map(
    Object.keys(DEFAULT_LEAVE_BALANCES).map((k) => [k.toLowerCase(), k])
  );
  const cleaned = raw.toLowerCase();
  if (map.has(cleaned)) return map.get(cleaned);
  if (cleaned === 'loss of pay') return 'LOP';
  if (cleaned === 'comp off' || cleaned === 'compoff') return 'Compensatory Off';
  if (cleaned === 'wfh') return 'Work From Home';
  return raw; // allow custom types without blocking
}

function safeInt(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

async function getLeaveBalancesCol(company) {
  const db = await getEmployeeDbForHrms(company);
  return db.collection(LEAVE_BALANCES_COLLECTION);
}

async function getLeaveBalanceHistoryCol(company) {
  const db = await getEmployeeDbForHrms(company);
  return db.collection(LEAVE_BALANCE_HISTORY_COLLECTION);
}

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s ? s : null;
}

function buildPayrollCompanyClause(payrollCompany) {
  const pc = String(payrollCompany || '').trim();
  if (!pc || pc === 'all') return null;
  // Back-compat: older values may be stored as 'BeaconIQ' (no space)
  if (pc === 'Beacon IQ') {
    return { $in: ['Beacon IQ', 'BeaconIQ'] };
  }
  return pc;
}

async function getEmployeeIdsForPayrollCompany({ company, payrollCompany }) {
  const pcClause = buildPayrollCompanyClause(payrollCompany);
  if (!pcClause) return null;

  const usersCol = await getUsersCollection(null, company);
  const employees = await usersCol
    .find({ company, payrollCompany: pcClause })
    .project({ employeeId: 1, email: 1 })
    .toArray();

  const ids = new Set();
  for (const e of employees) {
    if (e?.employeeId) ids.add(String(e.employeeId).trim());
    if (e?.email) {
      const em = String(e.email).trim();
      ids.add(em);
      const prefix = em.split('@')[0];
      if (prefix) ids.add(prefix);
    }
  }
  return Array.from(ids).filter((x) => x && x !== 'undefined' && x !== 'null');
}

function parseTimeWindowHm(timeWindow) {
  if (!timeWindow) return null;
  const m = String(timeWindow).trim().match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const pad = (hm) => {
    const [hRaw, mRaw] = String(hm).split(':');
    const h = String(Number(hRaw)).padStart(2, '0');
    const mm = String(Number(mRaw)).padStart(2, '0');
    return `${h}:${mm}`;
  };
  return { start: pad(m[1]), end: pad(m[2]) };
}

async function upsertMachineAttendanceRegularization({ company, employeeId, dateYmd, timeWindow, approvedBy }) {
  const empId = String(employeeId || '').trim();
  if (!company || !empId || !dateYmd) return { applied: false, reason: 'missing company/employeeId/date' };

  const times = parseTimeWindowHm(timeWindow);
  if (!times) return { applied: false, reason: 'invalid timeWindow' };

  // employee_details lives in login DB but is filtered by company
  const usersCol = await getUsersCollection(null, company);
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const emp = await usersCol.findOne(
    {
      company,
      $or: [
        { employeeId: empId },
        { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
        { email: new RegExp(`^${escapeRe(empId)}(@|$)`, 'i') },
      ],
    },
    { projection: { emp_code: 1, employeeId: 1, email: 1, name: 1 } }
  );

  const empCode = normalizeEmpCode(emp?.emp_code);
  if (!empCode) return { applied: false, reason: 'emp_code not found for employee' };

  const empCodeStr = String(empCode).trim();
  const empCodeNum = Number(empCodeStr);
  const empCodeNoLeadingZeros = empCodeStr.replace(/^0+/, '') || '0';
  const empCodeCandidates = Array.from(
    new Set(
      [empCodeStr, empCodeNoLeadingZeros, Number.isFinite(empCodeNum) ? empCodeNum : null, Number.isFinite(empCodeNum) ? String(empCodeNum) : null].filter(
        (v) => v !== null && v !== undefined && String(v).trim() !== ''
      )
    )
  );

  const dbNamesToTry = Array.from(new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== '')));
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];

  const dateRegex = new RegExp(`^${String(dateYmd).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const dateIsoString = `${dateYmd}T00:00:00.000Z`;
  const start = new Date(`${dateYmd}T00:00:00.000Z`);
  const end = new Date(`${dateYmd}T23:59:59.999Z`);

  let applied = false;
  let target = null;

  for (const dbName of dbNamesToTry) {
    try {
      const db0 = await getDb(dbName);
      const existingCols = new Set((await db0.listCollections().toArray()).map((c) => c.name));
      for (const colName of collectionNamesToTry) {
        if (!existingCols.has(colName)) continue;
        const col = db0.collection(colName);
        target = { dbName, colName };

        const update = {
          $set: {
            punch_in: times.start,
            punch_out: times.end,
            status: 'Present',
            updatedAt: new Date(),
            updatedBy: approvedBy || 'Admin',
            source: 'regularization',
          },
        };

        // 1) Prefer updating an existing doc (avoid unique-index dup inserts).
        const broadFilter = {
          emp_code: { $in: empCodeCandidates },
          $or: [{ date: { $gte: start, $lte: end } }, { date: dateRegex }, { date: dateYmd }, { date: dateIsoString }],
        };
        const upd0 = await col.updateOne(broadFilter, update, { upsert: false });
        if (upd0.matchedCount > 0) {
          applied = true;
          break;
        }

        // 2) If no match (date stored in an unexpected way), try exact unique-key shapes.
        const exactFilters = [];
        for (const code of empCodeCandidates) {
          exactFilters.push({ emp_code: code, date: start });
          exactFilters.push({ emp_code: code, date: dateIsoString });
          exactFilters.push({ emp_code: code, date: dateYmd });
        }
        let matched = false;
        for (const f of exactFilters) {
          const upd = await col.updateOne(f, update, { upsert: false });
          if (upd.matchedCount > 0) {
            matched = true;
            applied = true;
            break;
          }
        }
        if (matched) break;

        // 3) Nothing exists — insert a new machine row (upsert), but guard against duplicates.
        const insertUpdate = {
          $set: {
            emp_code: empCodeStr,
            date: dateIsoString,
            punch_in: times.start,
            punch_out: times.end,
            status: 'Present',
            updatedAt: new Date(),
            updatedBy: approvedBy || 'Admin',
            source: 'regularization',
          },
          $setOnInsert: { createdAt: new Date() },
        };
        try {
          await col.updateOne({ emp_code: empCodeStr, date: dateIsoString }, insertUpdate, { upsert: true });
          applied = true;
          break;
        } catch (e) {
          // If unique index blocks insert, fall back to exact date(Date) update.
          if (String(e?.message || '').toLowerCase().includes('duplicate key')) {
            const upd = await col.updateOne({ emp_code: empCodeStr, date: start }, update, { upsert: false });
            if (upd.matchedCount > 0) {
              applied = true;
              break;
            }
          }
          throw e;
        }
      }
    } catch (e) {
      console.warn('[hrms-portal] machine_attendance_reports update skipped for db', dbName, e.message);
    }
    if (applied) break;
  }

  return { applied, empCode: empCodeStr, target };
}

async function listLeaves(req, res) {
  try {
    // TODO: Implement leaves listing
    res.json({
      success: true,
      message: 'HRMS leaves endpoint - to be implemented',
      data: []
    });
  } catch (error) {
    console.error('HRMS leaves error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function listLeaveBalances(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = (req.query.employeeId || '').toString().trim();
    const col = await getLeaveBalancesCol(company);

    const query = { company };
    if (employeeId) query.employeeId = employeeId;

    const rows = await col.find(query).sort({ employeeId: 1 }).toArray();
    const data = rows.map((r) => ({
      id: r._id?.toString?.() || String(r._id),
      employeeId: r.employeeId,
      balances: { ...DEFAULT_LEAVE_BALANCES, ...(r.balances || {}) },
      updatedAt: r.updatedAt || r.createdAt || null,
      company: r.company,
    }));

    return res.json({ success: true, data: { balances: data } });
  } catch (error) {
    console.error('[hrms-portal] listLeaveBalances error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getLeaveBalance(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = String(req.params.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId is required' });

    const col = await getLeaveBalancesCol(company);
    const doc = await col.findOne({ company, employeeId });
    return res.json({
      success: true,
      data: {
        employeeId,
        balances: { ...DEFAULT_LEAVE_BALANCES, ...(doc?.balances || {}) },
        updatedAt: doc?.updatedAt || doc?.createdAt || null,
      },
    });
  } catch (error) {
    console.error('[hrms-portal] getLeaveBalance error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function adjustLeaveBalance(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = String(req.params.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId is required' });

    const { leaveType, delta, reason, performedBy } = req.body || {};
    const leaveKey = normalizeLeaveTypeKey(leaveType);
    if (!leaveKey) return res.status(400).json({ success: false, error: 'leaveType is required' });

    const inc = safeInt(delta, 0);
    if (!inc) return res.status(400).json({ success: false, error: 'delta must be a non-zero number' });

    const col = await getLeaveBalancesCol(company);
    const historyCol = await getLeaveBalanceHistoryCol(company);

    // Read current to clamp at 0 (no negative balances).
    const existing = await col.findOne({ company, employeeId }, { projection: { balances: 1 } });
    const prevBalances = { ...DEFAULT_LEAVE_BALANCES, ...(existing?.balances || {}) };
    const prevValue = safeInt(prevBalances[leaveKey], 0);
    const nextValue = Math.max(0, prevValue + inc);
    const appliedDelta = nextValue - prevValue;
    if (appliedDelta === 0) {
      return res.json({
        success: true,
        message: 'No change (balance already at minimum)',
        data: { employeeId, leaveType: leaveKey, previous: prevValue, next: nextValue },
      });
    }

    const now = new Date();
    await col.updateOne(
      { company, employeeId },
      {
        $set: { updatedAt: now },
        $setOnInsert: { company, employeeId, createdAt: now },
        $inc: { [`balances.${leaveKey}`]: appliedDelta },
      },
      { upsert: true }
    );

    const historyDoc = {
      company,
      employeeId,
      leaveType: leaveKey,
      delta: appliedDelta,
      previous: prevValue,
      next: nextValue,
      reason: typeof reason === 'string' ? reason.trim() : '',
      performedBy: typeof performedBy === 'string' ? performedBy.trim() : 'HR',
      createdAt: now,
    };
    await historyCol.insertOne(historyDoc);

    emitAttendanceChanged({ company, type: 'leave_balance_adjusted', date: now.toISOString().slice(0, 10) });

    return res.json({
      success: true,
      message: 'Leave balance updated',
      data: { employeeId, leaveType: leaveKey, previous: prevValue, next: nextValue, delta: appliedDelta },
    });
  } catch (error) {
    console.error('[hrms-portal] adjustLeaveBalance error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
}

async function getLeaveBalanceHistory(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = String(req.params.employeeId || '').trim();
    if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId is required' });

    const historyCol = await getLeaveBalanceHistoryCol(company);
    const rows = await historyCol
      .find({ company, employeeId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();

    return res.json({
      success: true,
      data: {
        employeeId,
        history: rows.map((r) => ({
          id: r._id?.toString?.() || String(r._id),
          leaveType: r.leaveType,
          delta: r.delta,
          previous: r.previous,
          next: r.next,
          reason: r.reason || '',
          performedBy: r.performedBy || '',
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('[hrms-portal] getLeaveBalanceHistory error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listAttendanceRequests(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const status = req.query.status || 'all'; // 'all', 'pending', 'approved', 'rejected'
    const type = req.query.type || 'all'; // 'all', 'regularization', 'on-duty', 'time-off'
    const payrollCompany = req.query.payrollCompany || null;
    
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    // Build query
    const query = {};
    if (status !== 'all') {
      query.status = status;
    }
    if (type !== 'all') {
      query.type = type;
    }
    if (company) {
      query.company = company;
    }

    const allowedEmployeeIds = await getEmployeeIdsForPayrollCompany({ company, payrollCompany });
    if (Array.isArray(allowedEmployeeIds)) {
      if (allowedEmployeeIds.length === 0) {
        return res.json({ success: true, data: { requests: [] } });
      }
      query.employeeId = { $in: allowedEmployeeIds };
    }

    const requests = await col
      .find(query)
      .sort({ submittedAt: -1 })
      .toArray();

    res.json({
      success: true,
      data: {
        requests: requests.map(req => ({
          id: req._id.toString(),
          employeeId: req.employeeId,
          type: req.type,
          status: req.status,
          submittedAt: req.submittedAt,
          date: req.date,
          timeWindow: req.timeWindow,
          notes: req.notes,
          location: req.location,
          details: req.details,
          dateRange: req.dateRange,
          reason: req.reason,
          leaveType: req.leaveType || null, // Include leave type if available
          approvedAt: req.approvedAt,
          rejectedAt: req.rejectedAt,
          approvedBy: req.approvedBy,
          rejectionReason: req.rejectionReason,
          company: req.company
        }))
      }
    });
  } catch (error) {
    console.error('HRMS attendance-requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function leaveOverviewStats(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const payrollCompany = req.query.payrollCompany || null;
    const db = await getEmployeeDbForHrms(company);
    const requestsCol = db.collection('attendance_requests');

    const query = { type: 'time-off' };
    if (company) {
      query.company = company;
    }

    const allowedEmployeeIds = await getEmployeeIdsForPayrollCompany({ company, payrollCompany });
    if (Array.isArray(allowedEmployeeIds)) {
      if (allowedEmployeeIds.length === 0) {
        return res.json({
          success: true,
          data: { totalOnLeave: 0, leaveForApproval: 0, approvedThisMonth: 0, rejectedThisMonth: 0 },
        });
      }
      query.employeeId = { $in: allowedEmployeeIds };
    }
    
    const allRequests = await requestsCol.find(query).toArray();
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Calculate stats
    const totalOnLeave = allRequests.filter(r => {
      if (r.status !== 'approved' || !r.dateRange) return false;
      // Parse date range to check if currently on leave
      const parts = r.dateRange.split(' - ');
      if (parts.length === 2) {
        try {
          const fromDate = new Date(parts[0].trim());
          const toDate = new Date(parts[1].trim());
          return fromDate <= now && toDate >= now;
        } catch (e) {
          return false;
        }
      }
      return false;
    }).length;

    const leaveForApproval = allRequests.filter(r => r.status === 'pending').length;
    
    const approvedThisMonth = allRequests.filter(r => {
      if (r.status !== 'approved' || !r.approvedAt) return false;
      const approvedDate = new Date(r.approvedAt);
      return approvedDate.getMonth() === currentMonth && 
             approvedDate.getFullYear() === currentYear;
    }).length;

    const rejectedThisMonth = allRequests.filter(r => {
      if (r.status !== 'rejected' || !r.rejectedAt) return false;
      const rejectedDate = new Date(r.rejectedAt);
      return rejectedDate.getMonth() === currentMonth && 
             rejectedDate.getFullYear() === currentYear;
    }).length;

    res.json({
      success: true,
      data: {
        totalOnLeave,
        leaveForApproval,
        approvedThisMonth,
        rejectedThisMonth
      }
    });
  } catch (error) {
    console.error('HRMS leaves/overview/stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function leaveUtilization(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const year = req.query.year || new Date().getFullYear();
    const payrollCompany = req.query.payrollCompany || null;
    const db = await getEmployeeDbForHrms(company);
    const requestsCol = db.collection('attendance_requests');

    const query = { 
      type: 'time-off',
      status: 'approved'
    };
    if (company) {
      query.company = company;
    }

    const allowedEmployeeIds = await getEmployeeIdsForPayrollCompany({ company, payrollCompany });
    if (Array.isArray(allowedEmployeeIds)) {
      if (allowedEmployeeIds.length === 0) {
        return res.json({ success: true, data: { utilization: [], year } });
      }
      query.employeeId = { $in: allowedEmployeeIds };
    }
    
    const approvedRequests = await requestsCol.find(query).toArray();
    
    // Get employees list for employee names
    const { getUsersCollection } = require('../../../config/mongo');
    let companyName = company || 'Ecosoul Home';
    const usersCol = await getUsersCollection(null, companyName);
    const empQuery = { company: companyName };
    const pcClause = buildPayrollCompanyClause(payrollCompany);
    if (pcClause) empQuery.payrollCompany = pcClause;
    const employees = await usersCol.find(empQuery).toArray();
    const employeeMap = new Map();
    employees.forEach(emp => {
      const empId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (empId) {
        employeeMap.set(empId, {
          name: emp.name || emp.firstName || 'Unknown',
          employeeId: empId
        });
      }
    });
    
    // Calculate leave utilization per employee
    const utilizationMap = new Map();
    
    approvedRequests.forEach(req => {
      if (!req.dateRange || !req.employeeId) return;
      
      const parts = req.dateRange.split(' - ');
      if (parts.length !== 2) return;
      
      try {
        const fromDate = new Date(parts[0].trim());
        const toDate = new Date(parts[1].trim());
        
        // Check if request is in the current year
        if (fromDate.getFullYear() === year || toDate.getFullYear() === year) {
          // Count only Mon–Fri; do not count Saturday/Sunday as leave days
          const countWeekdaysInclusive = (from, to) => {
            let c = 0;
            const d = new Date(from);
            d.setHours(0, 0, 0, 0);
            const end = new Date(to);
            end.setHours(0, 0, 0, 0);
            const t = d.getTime();
            const te = end.getTime();
            if (t > te) return 0;
            for (let x = new Date(d); x.getTime() <= te; x.setDate(x.getDate() + 1)) {
              const wd = x.getDay();
              if (wd !== 0 && wd !== 6) c += 1;
            }
            return c;
          };
          const days = countWeekdaysInclusive(fromDate, toDate);
          
          if (!utilizationMap.has(req.employeeId)) {
            utilizationMap.set(req.employeeId, {
              employeeId: req.employeeId,
              utilized: 0,
              remaining: 12 // Default leave balance, can be configured
            });
          }
          
          const util = utilizationMap.get(req.employeeId);
          util.utilized += days;
        }
      } catch (e) {
        // Skip invalid dates
      }
    });
    
    // Convert to array format for chart
    const utilizationData = Array.from(utilizationMap.values())
      .map(util => {
        const empInfo = employeeMap.get(util.employeeId) || { name: util.employeeId };
        return {
          employee: empInfo.name,
          utilized: util.utilized,
          remaining: Math.max(0, util.remaining - util.utilized)
        };
      })
      .sort((a, b) => b.utilized - a.utilized)
      .slice(0, 15); // Top 15 employees
    
    res.json({
      success: true,
      data: {
        utilization: utilizationData,
        year
      }
    });
  } catch (error) {
    console.error('HRMS leaves/overview/utilization error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function attendanceRequestStats(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const payrollCompany = req.query.payrollCompany || null;
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const query = company ? { company } : {};
    const allowedEmployeeIds = await getEmployeeIdsForPayrollCompany({ company, payrollCompany });
    if (Array.isArray(allowedEmployeeIds)) {
      if (allowedEmployeeIds.length === 0) {
        return res.json({
          success: true,
          data: { total: 0, pending: 0, approved: 0, rejected: 0, approvedToday: 0, rejectedToday: 0 },
        });
      }
      query.employeeId = { $in: allowedEmployeeIds };
    }
    
    const total = await col.countDocuments(query);
    const pending = await col.countDocuments({ ...query, status: 'pending' });
    const approved = await col.countDocuments({ ...query, status: 'approved' });
    const rejected = await col.countDocuments({ ...query, status: 'rejected' });

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const approvedToday = await col.countDocuments({
      ...query,
      status: 'approved',
      approvedAt: { $gte: today }
    });
    const rejectedToday = await col.countDocuments({
      ...query,
      status: 'rejected',
      rejectedAt: { $gte: today }
    });

    res.json({
      success: true,
      data: {
        total,
        pending,
        approved,
        rejected,
        approvedToday,
        rejectedToday
      }
    });
  } catch (error) {
    console.error('HRMS attendance-requests/stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function approveAttendanceRequest(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;
    const { approvedBy } = req.body;
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    console.log(`[hrms-portal] Approving request ${requestId} for company: ${company || 'default'}`);

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    
    // Try multiple query formats to find the request
    let request = null;
    let updateQuery = null;
    
    // Try 1: ObjectId format (most common)
    try {
      if (ObjectId.isValid(requestId)) {
        const objectIdQuery = { _id: new ObjectId(requestId) };
        request = await col.findOne(objectIdQuery);
        if (request) {
          updateQuery = { _id: new ObjectId(requestId) };
          console.log(`[hrms-portal] Found request using ObjectId format`);
        }
      }
    } catch (e) {
      console.log(`[hrms-portal] ObjectId conversion failed for ${requestId}:`, e.message);
    }
    
    // Try 2: String _id format
    if (!request) {
      const stringIdQuery = { _id: requestId };
      request = await col.findOne(stringIdQuery);
      if (request) {
        updateQuery = { _id: requestId };
        console.log(`[hrms-portal] Found request using string _id format`);
      }
    }
    
    // Try 3: id field format (if requests have an id field separate from _id)
    if (!request) {
      const idFieldQuery = { id: requestId };
      request = await col.findOne(idFieldQuery);
      if (request) {
        updateQuery = { id: requestId };
        console.log(`[hrms-portal] Found request using id field format`);
      }
    }

    // Try 4: Check all documents and find by matching string representation of _id
    if (!request) {
      console.log(`[hrms-portal] Trying to find request by scanning collection...`);
      const allRequests = await col.find({}).toArray();
      console.log(`[hrms-portal] Found ${allRequests.length} total requests in collection`);
      
      for (const req of allRequests) {
        const reqIdStr = req._id ? req._id.toString() : '';
        if (reqIdStr === requestId || req.id === requestId) {
          request = req;
          updateQuery = { _id: req._id };
          console.log(`[hrms-portal] Found request by scanning: ${reqIdStr}`);
          break;
        }
      }
    }

    if (!request) {
      console.error(`[hrms-portal] Request not found with ID: ${requestId} in company: ${company || 'default'}`);
      console.error(`[hrms-portal] Available request IDs in collection (first 5):`);
      try {
        const sampleRequests = await col.find({}).limit(5).toArray();
        sampleRequests.forEach((req, idx) => {
          console.error(`  ${idx + 1}. _id: ${req._id}, id: ${req.id || 'N/A'}, employeeId: ${req.employeeId || 'N/A'}`);
        });
      } catch (e) {
        console.error(`[hrms-portal] Could not fetch sample requests:`, e.message);
      }
      
      return res.status(404).json({ 
        success: false, 
        error: `Request not found with ID: ${requestId}. Please refresh the page and try again.` 
      });
    }

    // Check if request is already processed
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Request is already ${request.status}. Cannot approve again.` 
      });
    }

    // Perform the update (first-wins: only pending can be approved)
    const updateResult = await col.updateOne(
      { ...(updateQuery || {}), status: 'pending' },
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: approvedBy || 'Admin',
          approvedByRole: 'hr',
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(409).json({
        success: false,
        error: 'This request was already processed by someone else.'
      });
    }

    if (updateResult.modifiedCount === 0) {
      console.warn(`[hrms-portal] Update matched but did not modify - request may already be approved`);
    }

    console.log(`[hrms-portal] ✅ Attendance request ${requestId} approved by ${approvedBy || 'Admin'}`);

    // If this is an attendance regularization request, apply it to machine attendance reports.
    if (request.type === 'regularization' && request.date && request.timeWindow) {
      try {
        const patch = await upsertMachineAttendanceRegularization({
          company,
          employeeId: request.employeeId,
          dateYmd: request.date,
          timeWindow: request.timeWindow,
          approvedBy: approvedBy || 'Admin',
        });
        if (!patch.applied) {
          console.warn('[hrms-portal] Regularization approved but machine attendance not updated:', patch.reason);
        } else {
          console.log('[hrms-portal] ✅ Machine attendance updated for regularization', {
            empCode: patch.empCode,
            date: request.date,
            target: patch.target,
          });
        }
      } catch (e) {
        console.error('[hrms-portal] Failed to apply regularization to machine attendance:', e);
      }
    }

    emitAttendanceChanged({ company, type: 'attendance_request_approved', date: new Date().toISOString().slice(0, 10) });
    invalidateAttendanceCaches(company).catch(() => {});
    if (request.type === 'regularization') {
      invalidatePayrollCaches(company).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Request approved successfully',
      data: {
        requestId,
        status: 'approved'
      }
    });
  } catch (error) {
    console.error('[hrms-portal] ❌ Approve attendance-request error:', error);
    console.error('[hrms-portal] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error. Please try again or contact support.'
    });
  }
}

async function rejectAttendanceRequest(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;
    const { rejectedBy, rejectionReason } = req.body;
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }
    const request = await col.findOne({ _id: new ObjectId(requestId) });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request is not pending' });
    }

    const updateResult = await col.updateOne(
      { _id: new ObjectId(requestId), status: 'pending' },
      {
        $set: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectedBy: rejectedBy || 'Admin',
          rejectedByRole: 'hr',
          rejectionReason: rejectionReason || '',
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(409).json({
        success: false,
        error: 'This request was already processed by someone else.'
      });
    }

    console.log(`[hrms-portal] Attendance request ${requestId} rejected by ${rejectedBy || 'Admin'}`);
    emitAttendanceChanged({ company, type: 'attendance_request_rejected', date: new Date().toISOString().slice(0, 10) });

    res.json({
      success: true,
      message: 'Request rejected successfully',
      data: {
        requestId,
        status: 'rejected'
      }
    });
  } catch (error) {
    console.error('HRMS reject attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function updateAttendanceRequest(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    const existing = await col.findOne({ _id: new ObjectId(requestId) });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Safety: only allow editing pending requests (can be relaxed later if needed)
    if (existing.status && existing.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending requests can be edited' });
    }

    const { leaveType, reason, from, to, dateRange } = req.body || {};

    // Build update fields (only allow known fields)
    const update = { updatedAt: new Date() };

    if (typeof leaveType === 'string') update.leaveType = leaveType;
    if (typeof reason === 'string') update.reason = reason;

    let normalizedFrom = typeof from === 'string' ? from.trim() : '';
    let normalizedTo = typeof to === 'string' ? to.trim() : '';

    const parseDate = (s) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fromDate = normalizedFrom ? parseDate(normalizedFrom) : null;
    const toDate = normalizedTo ? parseDate(normalizedTo) : null;

    if ((normalizedFrom && !fromDate) || (normalizedTo && !toDate)) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date' });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, error: 'From date cannot be after To date' });
    }

    // Store from/to if provided
    if (fromDate) update.from = fromDate.toISOString().split('T')[0];
    if (toDate) update.to = toDate.toISOString().split('T')[0];

    // Prefer dateRange if explicitly provided; otherwise build it from from/to if both exist
    if (typeof dateRange === 'string' && dateRange.trim()) {
      update.dateRange = dateRange.trim();
    } else if (fromDate && toDate) {
      update.dateRange = `${update.from} - ${update.to}`;
    }

    await col.updateOne({ _id: new ObjectId(requestId) }, { $set: update });
    emitAttendanceChanged({ company, type: 'attendance_request_updated', date: new Date().toISOString().slice(0, 10) });

    res.json({
      success: true,
      message: 'Request updated successfully',
      data: { requestId },
    });
  } catch (error) {
    console.error('HRMS update attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

async function deleteAttendanceRequest(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    const existing = await col.findOne({ _id: new ObjectId(requestId) });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Safety: only allow deleting pending requests (can be relaxed later if needed)
    if (existing.status && existing.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending requests can be deleted' });
    }

    await col.deleteOne({ _id: new ObjectId(requestId) });
    emitAttendanceChanged({ company, type: 'attendance_request_deleted', date: new Date().toISOString().slice(0, 10) });

    res.json({
      success: true,
      message: 'Request deleted successfully',
      data: { requestId },
    });
  } catch (error) {
    console.error('HRMS delete attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

async function createAttendanceRequest(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const {
      employeeId,
      leaveType,
      from,
      to,
      reason,
      type,
      notes,
      details,
      location,
    } = req.body || {};

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, error: 'employeeId is required' });
    }
    if (!leaveType || typeof leaveType !== 'string') {
      return res.status(400).json({ success: false, error: 'leaveType is required' });
    }
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from and to are required' });
    }

    const parseDate = (s) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ success: false, error: 'From date cannot be after To date' });
    }

    const normalizedFrom = fromDate.toISOString().split('T')[0];
    const normalizedTo = toDate.toISOString().split('T')[0];

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const doc = {
      employeeId: employeeId.trim(),
      type: typeof type === 'string' && type.trim() ? type.trim() : 'time-off',
      status: 'pending',
      submittedAt: new Date(),
      updatedAt: new Date(),
      company: company || null,
      leaveType: leaveType.trim(),
      from: normalizedFrom,
      to: normalizedTo,
      dateRange: `${normalizedFrom} - ${normalizedTo}`,
      reason: typeof reason === 'string' ? reason : '',
      notes: typeof notes === 'string' ? notes : undefined,
      details: typeof details === 'string' ? details : undefined,
      location: typeof location === 'string' ? location : undefined,
    };

    // remove undefined fields
    Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

    const result = await col.insertOne(doc);
    emitAttendanceChanged({ company, type: 'attendance_request_created', date: normalizedFrom });

    res.json({
      success: true,
      message: 'Request created successfully',
      data: {
        requestId: result.insertedId?.toString?.() || result.insertedId,
      },
    });
  } catch (error) {
    console.error('HRMS create attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}

module.exports = {
  listLeaves,
  listLeaveBalances,
  getLeaveBalance,
  adjustLeaveBalance,
  getLeaveBalanceHistory,
  listAttendanceRequests,
  leaveOverviewStats,
  leaveUtilization,
  attendanceRequestStats,
  approveAttendanceRequest,
  rejectAttendanceRequest,
  updateAttendanceRequest,
  deleteAttendanceRequest,
  createAttendanceRequest,
};
