const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');
const { getDb, LOGIN_DB_NAME } = require('../../../config/mongo');
const responseCache = require('../../../lib/responseCache');

/** `dateRange` may be Date, object, or string — .split only exists on strings */
function splitDateRangeParts(dateRange) {
  if (dateRange == null || dateRange === '') return null;
  const s = typeof dateRange === 'string' ? dateRange : String(dateRange);
  const parts = s.split(' - ');
  return parts.length === 2 ? parts : null;
}

/** Express can give string[] for duplicate query keys — use first value */
function firstQueryValue(val, fallback) {
  if (val == null || val === '') return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || fallback;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseCheckTime(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isValidDate(d) ? d : null;
}

function parseYyyyMmDd(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function getUtcDayRange(dateStr) {
  const d = parseYyyyMmDd(dateStr);
  if (!d) return null;
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function timeHmFromDate(d) {
  if (!isValidDate(d)) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeHmToDate(dateStr, hm) {
  if (!dateStr || !hm) return null;
  const [hh, mm] = String(hm).split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const base = parseYyyyMmDd(dateStr);
  if (!base) return null;
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return isValidDate(d) ? d : null;
}

function isLateByPunchIn(checkInTime) {
  if (!isValidDate(checkInTime)) return false;
  // Requirement: 09:00–09:35 is NOT late; after 09:35 is late.
  const mins = checkInTime.getHours() * 60 + checkInTime.getMinutes();
  return mins > 9 * 60 + 35;
}

function hmToMinutes(hm) {
  if (!hm) return null;
  const parts = String(hm).split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minTimeHm(a, b) {
  const am = hmToMinutes(a);
  const bm = hmToMinutes(b);
  if (am == null) return b || null;
  if (bm == null) return a || null;
  return am <= bm ? a : b;
}

function maxTimeHm(a, b) {
  const am = hmToMinutes(a);
  const bm = hmToMinutes(b);
  if (am == null) return b || null;
  if (bm == null) return a || null;
  return am >= bm ? a : b;
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

function yyyyMmDdLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractYyyyMmDdFromMachineDate(dateVal) {
  if (dateVal == null || dateVal === '') return null;
  if (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())) {
    const y = dateVal.getUTCFullYear();
    const m = String(dateVal.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(dateVal);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function enumerateUtcDatesInRange(range) {
  const dates = [];
  const cur = new Date(range.start);
  const end = new Date(range.end);
  while (cur <= end) {
    dates.push(
      `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Single HTTP call for weekly/monthly views — shared DB reads, same record shape as single-day. */
async function listAttendanceForRange(req, res, range) {
  try {
    const companyName = requireCompany(req, res);
    if (!companyName) return;
    await connectMongo();

    const dept = firstQueryValue(req.query.department, 'all');
    const cacheKey = `attendance:range:${companyName}:${range.startDate}:${range.endDate}:${dept}`;
    if (responseCache.cacheEnabled()) {
      const cached = await responseCache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const dates = enumerateUtcDatesInRange(range);
    if (dates.length > 62) {
      return res.status(400).json({ success: false, error: 'Date range too large (max 62 days)' });
    }

    const db = await getEmployeeDbForHrms(companyName);
    const col = db.collection('employee_checkins');
    const { getUsersCollection } = require('../../../config/mongo');
    const usersCol = await getUsersCollection(null, companyName);
    const allEmployees = await usersCol.find({ company: companyName }).toArray();

    const employeeByEmpCode = new Map();
    allEmployees.forEach((emp) => {
      const ec = normalizeEmpCode(emp.emp_code);
      if (ec) employeeByEmpCode.set(ec, true);
    });

    const allCheckIns = await col.find({ date: { $in: dates } }).sort({ checkInTime: -1 }).toArray();
    const checkInsByDate = new Map();
    for (const c of allCheckIns) {
      const d = c.date;
      if (!checkInsByDate.has(d)) checkInsByDate.set(d, []);
      checkInsByDate.get(d).push(c);
    }

    const machineAll = await getMachineAttendanceForRange(range);
    const machineByDate = new Map();
    for (const r of machineAll) {
      const empCode = normalizeEmpCode(r.emp_code);
      if (!empCode || !employeeByEmpCode.has(empCode)) continue;
      const dateKey = extractYyyyMmDdFromMachineDate(r.date);
      if (!dateKey || !dates.includes(dateKey)) continue;
      if (!machineByDate.has(dateKey)) machineByDate.set(dateKey, []);
      machineByDate.get(dateKey).push(r);
    }

    const requestsCol = db.collection('attendance_requests');
    const approvedLeaves = await requestsCol
      .find({
        type: 'time-off',
        status: 'approved',
        ...(companyName ? { company: companyName } : {}),
      })
      .toArray();
    const wfhRequests = await requestsCol
      .find({
        type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
        status: 'approved',
        ...(companyName ? { company: companyName } : {}),
      })
      .toArray();

    const allRecords = [];
    for (const dateStr of dates) {
      req.query.date = dateStr;
      req._attendanceRangeDay = true;
      req._attendancePrefetch = {
        checkIns: checkInsByDate.get(dateStr) || [],
        allEmployees,
        machineReports: machineByDate.get(dateStr) || [],
        approvedLeaves,
        wfhRequests,
      };
      const dayRecords = await listAttendance(req, res);
      if (!Array.isArray(dayRecords)) return;
      allRecords.push(...dayRecords);
    }

    const rangeBody = {
      success: true,
      data: {
        startDate: range.startDate,
        endDate: range.endDate,
        date: range.endDate,
        records: allRecords,
      },
    };

    if (responseCache.cacheEnabled()) {
      const dept = firstQueryValue(req.query.department, 'all');
      const cacheKey = `attendance:range:${companyName}:${range.startDate}:${range.endDate}:${dept}`;
      await responseCache.set(cacheKey, rangeBody, Number(process.env.ATTENDANCE_CACHE_TTL_MS || 120000));
    }

    return res.json(rangeBody);
  } catch (error) {
    console.error('HRMS attendance range error:', error);
    return res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function getMachineAttendanceForDay(dateStr) {
  const range = getUtcDayRange(dateStr);
  if (!range) return [];
  const dbNamesToTry = Array.from(
    new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== ''))
  );
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];
  const datePrefixRegex = new RegExp(`^${String(dateStr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  const all = [];
  for (const dbName of dbNamesToTry) {
    try {
      const db = await getDb(dbName);
      const existingCols = new Set((await db.listCollections().toArray()).map((c) => c.name));
      for (const colName of collectionNamesToTry) {
        if (!existingCols.has(colName)) continue;
        const col = db.collection(colName);

        // Your DB stores `date` as ISO string (e.g. "2026-04-01T00:00:00.000Z") in many docs.
        // Support both: Date range (Date type) and prefix match (string type).
        let docs = await col
          .find({
            $or: [
              { date: { $gte: range.start, $lte: range.end } },
              { date: datePrefixRegex },
              { date: dateStr },
              { date: `${dateStr}T00:00:00.000Z` },
            ],
          })
          .toArray();

        all.push(...docs);
      }
    } catch (e) {
      // Ignore missing DB/collection or connectivity issues for fallback DBs
      console.warn(`[machine_attendance_reports] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
}

function parseDateRangeFromQuery(req) {
  const startDate = firstQueryValue(req.query.startDate, null);
  const endDate = firstQueryValue(req.query.endDate, null);
  if (!startDate || !endDate) return null;
  const start = parseYyyyMmDd(startDate);
  const end = parseYyyyMmDd(endDate);
  if (!start || !end) return null;
  // normalize to day bounds in UTC
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) return null;
  return { startDate, endDate, start, end };
}

async function getMachineAttendanceForRange(range) {
  if (!range?.start || !range?.end) return [];
  const dbNamesToTry = Array.from(
    new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== ''))
  );
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];

  const all = [];
  for (const dbName of dbNamesToTry) {
    try {
      const db = await getDb(dbName);
      const existingCols = new Set((await db.listCollections().toArray()).map((c) => c.name));
      for (const colName of collectionNamesToTry) {
        if (!existingCols.has(colName)) continue;
        const col = db.collection(colName);
        const docs = await col
          .find({
            $or: [
              { date: { $gte: range.start, $lte: range.end } },
              // Support string dates like "2026-04-01T00:00:00.000Z" by bounding lexicographically
              { date: { $gte: range.startDate, $lte: `${range.endDate}T99:99:99.999Z` } },
            ],
          })
          .toArray();
        all.push(...docs);
      }
    } catch (e) {
      console.warn(`[machine_attendance_reports] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportMachineAttendanceReports(req, res) {
  try {
    const companyName = requireCompany(req, res);
    if (!companyName) return;
    await connectMongo();

    const range = parseDateRangeFromQuery(req);
    if (!range) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range. Provide startDate and endDate as YYYY-MM-DD.',
      });
    }

    const employeeCode = firstQueryValue(req.query.employeeCode, null);
    const empCodeFilter = normalizeEmpCode(employeeCode);

    // Scope to this company's known emp_codes so we don't leak other companies' machine data.
    const { getUsersCollection } = require('../../../config/mongo');
    const usersCol = await getUsersCollection(null, companyName);
    const companyEmployees = await usersCol.find({ company: companyName }).toArray();
    const empCodeToEmployee = new Map();
    for (const emp of companyEmployees) {
      const empCode = normalizeEmpCode(emp.emp_code);
      if (!empCode) continue;
      empCodeToEmployee.set(empCode, {
        employeeCode: empCode,
        employeeName: emp.name || emp.firstName || '',
        department: emp.department || '',
        employeeId: emp.employeeId || emp.email?.split('@')[0] || '',
        email: emp.email || '',
      });
    }

    let docs = await getMachineAttendanceForRange(range);
    docs = docs.filter((d) => {
      const code = normalizeEmpCode(d?.emp_code);
      if (!code) return false;
      if (!empCodeToEmployee.has(code)) return false;
      if (empCodeFilter && code !== empCodeFilter) return false;
      return true;
    });

    // Normalize + sort
    const rows = docs
      .map((d) => {
        const code = normalizeEmpCode(d.emp_code);
        const meta = empCodeToEmployee.get(code) || {};
        const dateRaw = d.date;
        const dateStr = typeof dateRaw === 'string' ? String(dateRaw) : new Date(dateRaw).toISOString();
        const yyyyMmDd = dateStr.slice(0, 10);
        const day = (() => {
          const dt = new Date(dateStr);
          if (!isValidDate(dt)) return '';
          return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        })();
        const shift = d.shift || d.shift_code || d.shiftCode || '';
        const hoursWorked = d.hours_worked ?? d.hoursWorked ?? '';
        return {
          name: meta.employeeName || d.name || '',
          emp_code: code || '',
          date: dateStr,
          day,
          shift,
          punch_in: d.punch_in || '',
          punch_out: d.punch_out || '',
          hours_worked: hoursWorked,
          status: d.status || '',
          rawDate: yyyyMmDd,
        };
      })
      .sort((a, b) => {
        if (a.rawDate !== b.rawDate) return a.rawDate < b.rawDate ? -1 : 1;
        if (a.emp_code !== b.emp_code) return a.emp_code < b.emp_code ? -1 : 1;
        return 0;
      });

    const header = [
      'name',
      'emp_code',
      'date',
      'day',
      'shift',
      'punch_in',
      'punch_out',
      'hours_worked',
      'status',
    ];

    const csvLines = [header.join(',')];
    for (const r of rows) {
      csvLines.push(
        [
          csvEscape(r.name),
          csvEscape(r.emp_code),
          csvEscape(r.date),
          csvEscape(r.day),
          csvEscape(r.shift),
          csvEscape(r.punch_in),
          csvEscape(r.punch_out),
          csvEscape(r.hours_worked),
          csvEscape(r.status),
        ].join(',')
      );
    }

    const filename = `biometric_attendance_${companyName.replace(/\s+/g, '_')}_${range.startDate}_to_${range.endDate}${
      empCodeFilter ? `_${empCodeFilter}` : ''
    }.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(`${csvLines.join('\r\n')}\r\n`);
  } catch (error) {
    console.error('HRMS machine attendance export error:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function listAttendance(req, res) {
  try {
    if (!req._attendanceRangeDay) {
      const range = parseDateRangeFromQuery(req);
      if (range) {
        return listAttendanceForRange(req, res, range);
      }
    }

    const companyName = requireCompany(req, res);
    if (!companyName) return;
    if (!req._attendanceRangeDay) {
      await connectMongo();
    }

    const prefetch = req._attendancePrefetch || null;
    const date = firstQueryValue(req.query.date, new Date().toISOString().split('T')[0]);
    const department = firstQueryValue(req.query.department, 'all');
    
    // Get employee database where check-ins are stored (use normalized company)
    const db = await getEmployeeDbForHrms(companyName);
    let col = db.collection('employee_checkins');

    // Get employees collection for employee details
    const { getUsersCollection } = require('../../../config/mongo');
    const usersCol = await getUsersCollection(null, companyName);

    // Build query - try date field first
    let query = { date };
    if (department !== 'all') {
      // Note: Department filtering would require employee data join
      // For now, we'll return all and filter on frontend if needed
    }

    let checkIns = prefetch?.checkIns
      ? prefetch.checkIns
      : await col.find(query).sort({ checkInTime: -1 }).toArray();

    console.log(`[attendance] Found ${checkIns.length} check-ins for date: ${date} (company DB: ${companyName})`);

    // If no results, try querying by checkInTime date range
    if (!prefetch?.checkIns && checkIns.length === 0) {
      try {
        const todayDate = new Date(date);
        if (!isValidDate(todayDate)) {
          console.warn('[attendance] Invalid date query, skipping checkInTime range fallback:', date);
        } else {
          const startOfDay = new Date(todayDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(todayDate);
          endOfDay.setHours(23, 59, 59, 999);
          const alternativeQuery = {
            checkInTime: {
              $gte: startOfDay,
              $lte: endOfDay,
            },
          };
          checkIns = await col.find(alternativeQuery).sort({ checkInTime: -1 }).toArray();
          console.log(`[attendance] Found ${checkIns.length} check-ins using checkInTime range query (company DB)`);
        }
      } catch (e) {
        console.error('[attendance] Alternative query by checkInTime failed:', e);
      }
    }
    
    // Get only this company's employees (employee_details lives in main_db)
    const allEmployees = prefetch?.allEmployees || (await usersCol.find({ company: companyName }).toArray());
    const employeeByEmployeeId = new Map(); // employeeId/emailPrefix -> employee info
    const employeeByEmpCode = new Map(); // emp_code -> employee info
    allEmployees.forEach((emp) => {
      const canonicalEmployeeId = emp.employeeId || emp.email?.split('@')[0] || '';
      const empCode = normalizeEmpCode(emp.emp_code);
      const info = {
        name: emp.name || emp.firstName || 'Unknown',
        department: emp.department || 'General',
        employeeId: canonicalEmployeeId || null,
        empCode: empCode || null,
      };
      if (canonicalEmployeeId) employeeByEmployeeId.set(canonicalEmployeeId, info);
      if (emp.email) employeeByEmployeeId.set(emp.email, info);
      if (emp.email?.includes('@')) employeeByEmployeeId.set(emp.email.split('@')[0], info);
      if (empCode) employeeByEmpCode.set(empCode, info);
    });

    // Machine attendance (main_db.machine_attendance_reports)
    const machineReports = prefetch?.machineReports || (await getMachineAttendanceForDay(date));
    const machineByEmpCode = new Map(); // emp_code -> best report
    for (const r of machineReports) {
      const empCode = normalizeEmpCode(r.emp_code);
      if (!empCode) continue;
      // Company scoping: only include machine records whose emp_code exists in this company's employee_details
      if (!employeeByEmpCode.has(empCode)) continue;
      // Prefer "Present" over anything else, and prefer record with punch_in.
      const existing = machineByEmpCode.get(empCode);
      if (!existing) {
        machineByEmpCode.set(empCode, r);
        continue;
      }
      const exStatus = String(existing.status || '').toLowerCase();
      const rStatus = String(r.status || '').toLowerCase();
      const exPresent = exStatus === 'present';
      const rPresent = rStatus === 'present';
      if (!exPresent && rPresent) {
        machineByEmpCode.set(empCode, r);
        continue;
      }
      if (exPresent === rPresent) {
        const exHasIn = existing.punch_in != null && String(existing.punch_in).trim() !== '';
        const rHasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
        if (!exHasIn && rHasIn) {
          machineByEmpCode.set(empCode, r);
        }
      }
    }

    // Transform data for frontend
    const manualRecords = checkIns
      .filter((record) => record && record._id != null)
      .map((record) => {
        const checkInTime = parseCheckTime(record.checkInTime);
        const checkOutTime = parseCheckTime(record.checkOutTime);

        const storedEmpCode = normalizeEmpCode(record.empCode || record.emp_code);
        const employeeInfo = employeeByEmployeeId.get(record.employeeId) || {
          name: record.employeeName || record.name || record.employeeId || 'Unknown',
          department: record.department || 'General',
          employeeId: record.employeeId || null,
          empCode: storedEmpCode || null,
        };
        if (storedEmpCode && !employeeInfo.empCode) employeeInfo.empCode = storedEmpCode;
        if (record.employeeName && (!employeeInfo.name || employeeInfo.name === 'Unknown')) {
          employeeInfo.name = record.employeeName;
        }
        if (record.department && employeeInfo.department === 'General') {
          employeeInfo.department = record.department;
        }

        const timeIn = timeHmFromDate(checkInTime);
        const timeOut = timeHmFromDate(checkOutTime);

        let status = 'absent';
        let isLate = false;
        if (timeIn) {
          const isWFH =
            record.status === 'wfh' ||
            record.status === 'WFH' ||
            record.location === 'remote' ||
            record.location === 'WFH' ||
            record.location === 'wfh' ||
            record.workMode === 'WFH' ||
            record.workMode === 'wfh';
          status = isWFH ? 'wfh' : 'present';
          isLate = isLateByPunchIn(checkInTime);
        }

        // IMPORTANT: In UI we display `biometricId` as Employee Code. Prefer emp_code if available.
        const biometricId = employeeInfo.empCode || employeeInfo.employeeId || record.employeeId;

        return {
          id: record._id.toString(),
          date: record.date,
          biometricId,
          employeeName: employeeInfo.name,
          department: employeeInfo.department,
          status,
          timeIn,
          timeOut,
          isLate,
          totalMinutes: record.totalMinutes || 0,
          source: 'manual',
        };
      });

    // Merge machine attendance onto manual records by emp_code (biometricId).
    const mergedByEmpCode = new Map(); // emp_code -> record
    for (const r of manualRecords) {
      const empCode = normalizeEmpCode(r.biometricId);
      if (empCode) mergedByEmpCode.set(empCode, r);
    }

    for (const [empCode, m] of machineByEmpCode.entries()) {
      const employeeInfo = employeeByEmpCode.get(empCode) || {
        name: m.name || 'Unknown',
        department: 'General',
        employeeId: null,
        empCode,
      };

      const mStatus = String(m.status || '').toLowerCase();
      // Treat MIS (missing punch-out, etc.) as present if punch_in exists.
      const hasPunchIn = m.punch_in != null && String(m.punch_in).trim() !== '';
      const isPresent = (mStatus === 'present' || mStatus === 'mis') && hasPunchIn;
      if (!isPresent) continue; // requirement: only auto-checkin when machine says Present

      const timeIn = m.punch_in ? String(m.punch_in).trim() : null;
      const timeOut = m.punch_out && String(m.punch_out).trim() !== '' ? String(m.punch_out).trim() : null;
      const checkInTime = timeHmToDate(date, timeIn);
      let isLate = false;
      if (checkInTime) isLate = isLateByPunchIn(checkInTime);

      const existing = mergedByEmpCode.get(empCode);
      if (existing) {
        const chosenTimeIn = minTimeHm(existing.timeIn, timeIn);
        const chosenTimeOut = maxTimeHm(existing.timeOut, timeOut);
        const chosenSource = chosenTimeIn === timeIn ? 'machine' : existing.source || 'manual';
        const chosenCheckInTime = timeHmToDate(date, chosenTimeIn);
        mergedByEmpCode.set(empCode, {
          ...existing,
          status:
            existing.status === 'wfh' || existing.status === 'work-from-home' ? existing.status : 'present',
          timeIn: chosenTimeIn,
          timeOut: chosenTimeOut,
          isLate: chosenCheckInTime ? isLateByPunchIn(chosenCheckInTime) : false,
          source: chosenSource,
        });
      } else {
        mergedByEmpCode.set(empCode, {
          id: `machine:${empCode}:${date}`,
          date,
          biometricId: empCode,
          employeeName: employeeInfo.name,
          department: employeeInfo.department,
          status: 'present',
          timeIn,
          timeOut,
          isLate,
          totalMinutes: 0,
          source: 'machine',
        });
      }
    }

    const normalizeDept = (v) => String(v || '').trim().toLowerCase();
    const requestedDept = normalizeDept(department);

    let attendanceRecords = Array.from(mergedByEmpCode.values())
      .filter((r) => {
        if (!requestedDept || requestedDept === 'all') return true;
        return normalizeDept(r.department || 'General') === requestedDept;
      })
      .sort((a, b) => {
      // show latest check-in first if available
      if (a.timeIn && b.timeIn) return a.timeIn < b.timeIn ? 1 : -1;
      if (a.timeIn) return -1;
      if (b.timeIn) return 1;
      return 0;
    });

    // Match attendance/stats: approved leave + WFH requests override "present" (same day scope).
    try {
      const requestsCol = db.collection('attendance_requests');
      const isEmployeeActive = (e) => e?.isActive !== false && e?.active !== false;
      const scopedEmployees =
        requestedDept && requestedDept !== 'all'
          ? allEmployees.filter((e) => normalizeDept(e.department || 'General') === requestedDept)
          : allEmployees;
      const employeesList = scopedEmployees.filter(isEmployeeActive);

      const employeeIdMap = new Map();
      const scopedCanonicalIds = new Set();
      const empCodeToCanonicalId = new Map();

      employeesList.forEach((emp) => {
        const canonicalId = emp.employeeId || emp.email?.split('@')[0] || '';
        if (!canonicalId) return;
        scopedCanonicalIds.add(canonicalId);
        employeeIdMap.set(canonicalId, canonicalId);
        if (emp.email) {
          const emailPrefix = emp.email.split('@')[0];
          if (emailPrefix !== canonicalId) employeeIdMap.set(emailPrefix, canonicalId);
          employeeIdMap.set(emp.email, canonicalId);
        }
        if (emp.employeeId && emp.employeeId !== canonicalId) {
          employeeIdMap.set(emp.employeeId, canonicalId);
        }
        const ec = normalizeEmpCode(emp.emp_code);
        if (ec) empCodeToCanonicalId.set(ec, canonicalId);
      });

      const todayDateStr = date;
      const onLeaveEmployees = new Set();
      const approvedLeaves =
        prefetch?.approvedLeaves ||
        (await requestsCol
          .find({
            type: 'time-off',
            status: 'approved',
            ...(companyName ? { company: companyName } : {}),
          })
          .toArray());

      approvedLeaves.forEach((leave) => {
        const parts = splitDateRangeParts(leave.dateRange);
        if (!parts) return;
        try {
          const fromDate = new Date(parts[0].trim());
          const toDate = new Date(parts[1].trim());
          const todayDate = new Date(todayDateStr);
          fromDate.setHours(0, 0, 0, 0);
          toDate.setHours(0, 0, 0, 0);
          todayDate.setHours(0, 0, 0, 0);
          if (todayDate < fromDate || todayDate > toDate) return;

          const leaveEmpId = leave.employeeId;
          let normalizedLeaveId = employeeIdMap.get(leaveEmpId);
          if (!normalizedLeaveId) {
            const matchingEmp = employeesList.find((emp) => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              const emailPrefix = emp.email?.split('@')[0] || '';
              return (
                empId === leaveEmpId ||
                emailPrefix === leaveEmpId ||
                emp.email === leaveEmpId ||
                emp.employeeId === leaveEmpId
              );
            });
            if (matchingEmp) {
              normalizedLeaveId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || leaveEmpId;
              employeeIdMap.set(leaveEmpId, normalizedLeaveId);
            } else {
              normalizedLeaveId = leaveEmpId;
            }
          }
          if (!scopedCanonicalIds.has(normalizedLeaveId)) return;
          onLeaveEmployees.add(normalizedLeaveId);
        } catch (e) {
          console.error('[attendance] Error parsing leave date range:', leave.dateRange, e);
        }
      });

      const wfhFromRequests = new Set();
      const wfhRequests =
        prefetch?.wfhRequests ||
        (await requestsCol
          .find({
            type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
            status: 'approved',
            ...(companyName ? { company: companyName } : {}),
          })
          .toArray());

      wfhRequests.forEach((wfhReq) => {
        const wfhParts = splitDateRangeParts(wfhReq.dateRange);
        if (!wfhParts) return;
        try {
          const fromDate = new Date(wfhParts[0].trim());
          const toDate = new Date(wfhParts[1].trim());
          const todayDate = new Date(todayDateStr);
          fromDate.setHours(0, 0, 0, 0);
          toDate.setHours(0, 0, 0, 0);
          todayDate.setHours(0, 0, 0, 0);
          if (todayDate < fromDate || todayDate > toDate) return;

          const reqEmpId = wfhReq.employeeId;
          let normalizedId = employeeIdMap.get(reqEmpId);
          if (!normalizedId) {
            const matchingEmp = employeesList.find((emp) => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              return empId === reqEmpId || emp.email === reqEmpId || emp.employeeId === reqEmpId;
            });
            if (matchingEmp) {
              normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || reqEmpId;
              employeeIdMap.set(reqEmpId, normalizedId);
            } else {
              normalizedId = reqEmpId;
            }
          }
          if (!scopedCanonicalIds.has(normalizedId)) return;
          wfhFromRequests.add(normalizedId);
        } catch (e) {
          console.error('[attendance] Error parsing WFH request date range:', wfhReq.dateRange, e);
        }
      });

      const resolveCanonicalForRecord = (r) => {
        const code = normalizeEmpCode(r.biometricId);
        if (code && empCodeToCanonicalId.has(code)) return empCodeToCanonicalId.get(code);
        let normalizedId = employeeIdMap.get(r.biometricId);
        if (normalizedId) return normalizedId;
        const matchingEmp = employeesList.find((emp) => {
          const empId = emp.employeeId || emp.email?.split('@')[0] || '';
          const emailPrefix = emp.email?.split('@')[0] || '';
          return (
            empId === r.biometricId ||
            emailPrefix === r.biometricId ||
            emp.email === r.biometricId ||
            emp.employeeId === r.biometricId
          );
        });
        if (matchingEmp) {
          normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || r.biometricId;
          employeeIdMap.set(r.biometricId, normalizedId);
          return normalizedId;
        }
        return r.biometricId;
      };

      // Align with attendance/stats scope: only ACTIVE employees are considered in counts/lists.
      attendanceRecords = attendanceRecords.filter((r) => {
        const cid = resolveCanonicalForRecord(r);
        return scopedCanonicalIds.has(cid);
      });

      for (let i = 0; i < attendanceRecords.length; i++) {
        const r = attendanceRecords[i];
        if (r.status !== 'present') continue;
        const cid = resolveCanonicalForRecord(r);
        if (onLeaveEmployees.has(cid)) {
          attendanceRecords[i] = { ...r, status: 'on-leave' };
        } else if (wfhFromRequests.has(cid)) {
          attendanceRecords[i] = { ...r, status: 'wfh' };
        }
      }
    } catch (e) {
      console.warn('[attendance] Leave/WFH alignment skipped:', e.message);
    }

    if (req._attendanceRangeDay) {
      return attendanceRecords;
    }

    res.json({
      success: true,
      data: {
        date,
        records: attendanceRecords,
      },
    });
  } catch (error) {
    console.error('HRMS attendance error:', error);
    if (req._attendanceRangeDay) throw error;
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function attendanceStats(req, res) {
  try {
    const crypto = require('crypto');
    const effectiveCompany = requireCompany(req, res);
    if (!effectiveCompany) return;
    await connectMongo();
    const date = firstQueryValue(req.query.date, new Date().toISOString().split('T')[0]);
    const department = firstQueryValue(req.query.department, 'all');
    const payrollCompany = firstQueryValue(req.query.payrollCompany, null);

    const statsCacheKey = `attendance:stats:${effectiveCompany}:${date}:${department}:${payrollCompany || 'all'}`;
    if (responseCache.cacheEnabled()) {
      const cached = await responseCache.get(statsCacheKey);
      if (cached?.etag && cached?.body) {
        res.setHeader('ETag', cached.etag);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vary', 'Origin, If-None-Match');
        if (req.headers && req.headers['if-none-match'] === cached.etag) {
          return res.status(304).end();
        }
        return res.json(cached.body);
      }
    }
    
    const db = await getEmployeeDbForHrms(effectiveCompany);
    let col = db.collection('employee_checkins');

    const { getUsersCollection } = require('../../../config/mongo');
    const companyName = effectiveCompany;
    let totalEmployees = 0;
    let activeEmployees = 0;
    let inactiveEmployees = 0;
    let employeesList = [];
    try {
      const usersCol = await getUsersCollection(null, companyName);
      // IMPORTANT: employee_details is in main_db, but must be filtered by company
      const query = { company: companyName };
      const pcClause = buildPayrollCompanyClause(payrollCompany);
      if (pcClause) query.payrollCompany = pcClause;
      const allEmployees = await usersCol.find(query).toArray();

      const normalizeDept = (v) => String(v || '').trim().toLowerCase();
      const requestedDept = normalizeDept(department);
      const scoped =
        requestedDept && requestedDept !== 'all'
          ? allEmployees.filter((e) => normalizeDept(e.department || 'General') === requestedDept)
          : allEmployees;

      // Determine active/inactive. Admin module uses `isActive`; some records may use `active`.
      const isEmployeeActive = (e) => e?.isActive !== false && e?.active !== false;
      const activeList = scoped.filter(isEmployeeActive);
      const inactiveList = scoped.filter((e) => !isEmployeeActive(e));

      // For dashboard headcount: show totals with proper active/inactive breakdown.
      employeesList = activeList;
      activeEmployees = activeList.length;
      inactiveEmployees = inactiveList.length;
      totalEmployees = scoped.length;
      console.log(
        `[attendance/stats] Employees (total=${totalEmployees}, active=${activeEmployees}, inactive=${inactiveEmployees}) for company: ${companyName}${department && department !== 'all' ? ` (department: ${department})` : ''}`
      );
    } catch (err) {
      console.error(`[attendance/stats] Error getting employees for ${companyName}:`, err);
      return res.status(500).json({ success: false, error: 'Failed to load attendance stats for this company.' });
    }

    // Debug: Check total records in collection and sample records
    const totalCheckIns = await col.countDocuments({});
    const sampleCheckIns = await col.find({}).limit(5).toArray();
    console.log(`[attendance/stats] Total check-ins in collection: ${totalCheckIns}`);
    if (sampleCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample check-in record:`, JSON.stringify(sampleCheckIns[0], null, 2));
    }
    
    // Build employeeId mapping - map all possible employeeId formats to a canonical form
    const employeeIdMap = new Map(); // Maps any employeeId format to canonical employeeId
    const empCodeToCanonicalId = new Map(); // emp_code -> canonical employeeId
    const scopedCanonicalIds = new Set(); // only employees in current scope (department filter)
    employeesList.forEach(emp => {
      const canonicalId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (canonicalId) {
        scopedCanonicalIds.add(canonicalId);
        // Map the canonical ID to itself
        employeeIdMap.set(canonicalId, canonicalId);
        // Also map email prefix if different
        if (emp.email) {
          const emailPrefix = emp.email.split('@')[0];
          if (emailPrefix !== canonicalId) {
            employeeIdMap.set(emailPrefix, canonicalId);
          }
        }
        // Map employeeId if it exists and is different
        if (emp.employeeId && emp.employeeId !== canonicalId) {
          employeeIdMap.set(emp.employeeId, canonicalId);
        }
        // Also map full email if it's used as employeeId
        if (emp.email) {
          employeeIdMap.set(emp.email, canonicalId);
        }
      }

      const empCode = normalizeEmpCode(emp.emp_code);
      if (empCode && canonicalId) {
        empCodeToCanonicalId.set(empCode, canonicalId);
      }
    });
    
    console.log(`[attendance/stats] Built employeeId map with ${employeeIdMap.size} entries`);
    
    // Get today's check-ins - filter by date
    // Date format should be YYYY-MM-DD (e.g., "2025-02-16")
    // First, let's check what check-ins exist in the database (recent ones for debugging)
    const recentCheckIns = await col.find({}).sort({ checkInTime: -1 }).limit(5).toArray();
    if (recentCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample recent check-ins structure:`, JSON.stringify(recentCheckIns.map(c => ({
        date: c.date,
        checkInTime: c.checkInTime,
        employeeId: c.employeeId,
        dateType: typeof c.date
      })), null, 2));
    } else {
      console.log(`[attendance/stats] No check-ins found in company DB collection at all`);
    }
    
    // Try querying by date field first
    let checkInQuery = { date };
    console.log(`[attendance/stats] Querying check-ins with date: ${date}, company: ${companyName}`);
    
    let todayCheckIns = await col.find(checkInQuery).toArray();
    console.log(`[attendance/stats] Found ${todayCheckIns.length} check-in records for date: ${date} (company DB)`);
    
    // If no results, try querying by checkInTime date range
    if (todayCheckIns.length === 0) {
      try {
        const todayDate = new Date(date);
        if (!isValidDate(todayDate)) {
          console.warn('[attendance/stats] Invalid date, skipping checkInTime range fallback:', date);
        } else {
          const startOfDay = new Date(todayDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(todayDate);
          endOfDay.setHours(23, 59, 59, 999);
          const alternativeQuery = {
            checkInTime: {
              $gte: startOfDay,
              $lte: endOfDay,
            },
          };
          todayCheckIns = await col.find(alternativeQuery).toArray();
          console.log(`[attendance/stats] Found ${todayCheckIns.length} check-in records using checkInTime range query (company DB)`);
        }
      } catch (e) {
        console.error('[attendance/stats] Alternative query by checkInTime failed:', e);
      }
    }
    
    if (todayCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample today's check-in:`, JSON.stringify(todayCheckIns[0], null, 2));
    } else {
      console.log(`[attendance/stats] WARNING: No check-ins found for date ${date} in any database`);
    }

    // Add machine attendance "Present" as synthetic check-ins (so stats auto-update without manual button)
    try {
      const machineReports = await getMachineAttendanceForDay(date);
      const machinePresent = machineReports.filter((r) => {
        const st = String(r.status || '').toLowerCase();
        const hasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
        return (st === 'present' || st === 'mis') && hasIn;
      });
      for (const r of machinePresent) {
        const empCode = normalizeEmpCode(r.emp_code);
        if (!empCode) continue;
        const canonicalId = empCodeToCanonicalId.get(empCode);
        if (!canonicalId) continue;
        if (!scopedCanonicalIds.has(canonicalId)) continue;

        const checkInTime = timeHmToDate(date, r.punch_in ? String(r.punch_in) : null);
        const checkOutTime = timeHmToDate(date, r.punch_out ? String(r.punch_out) : null);
        if (!checkInTime) continue;

        // Avoid duplicates if already checked-in manually
        const already = todayCheckIns.some((c) => {
          if (!c || !c.employeeId) return false;
          const normalized = employeeIdMap.get(c.employeeId) || c.employeeId;
          return normalized === canonicalId;
        });
        if (already) continue;

        todayCheckIns.push({
          employeeId: canonicalId,
          checkInTime,
          checkOutTime,
          date,
          source: 'machine',
        });
      }
    } catch (e) {
      console.warn('[attendance/stats] Machine attendance merge skipped:', e.message);
    }

    // Get approved leave requests for today
    const requestsCol = db.collection('attendance_requests');
    const todayDateStr = date; // Format: YYYY-MM-DD
    
    // Get approved time-off requests that overlap with today
    const approvedLeaveQuery = {
      type: 'time-off',
      status: 'approved',
      ...(companyName ? { company: companyName } : {})
    };
    const approvedLeaves = await requestsCol.find(approvedLeaveQuery).toArray();
    
    const onLeaveEmployees = new Set();
    approvedLeaves.forEach(leave => {
      const rangeParts = splitDateRangeParts(leave.dateRange);
      if (rangeParts) {
        const parts = rangeParts;
          try {
            // Parse dates - handle both "YYYY-MM-DD" and "DD MMM YYYY" formats
            let fromDateStr = parts[0].trim();
            let toDateStr = parts[1].trim();
            
            // Convert to Date objects and normalize to YYYY-MM-DD format
            const fromDate = new Date(fromDateStr);
            const toDate = new Date(toDateStr);
            const todayDate = new Date(todayDateStr);
            
            // Normalize all dates to start of day for comparison
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(0, 0, 0, 0);
            todayDate.setHours(0, 0, 0, 0);
            
            // Check if today falls within the leave date range
            if (todayDate >= fromDate && todayDate <= toDate) {
              // Normalize employeeId for leave
              const leaveEmpId = leave.employeeId;
              let normalizedLeaveId = employeeIdMap.get(leaveEmpId);
              if (!normalizedLeaveId) {
                const matchingEmp = employeesList.find(emp => {
                  const empId = emp.employeeId || emp.email?.split('@')[0] || '';
                  const emailPrefix = emp.email?.split('@')[0] || '';
                  return empId === leaveEmpId || 
                         emailPrefix === leaveEmpId ||
                         emp.email === leaveEmpId ||
                         emp.employeeId === leaveEmpId;
                });
                if (matchingEmp) {
                  normalizedLeaveId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || leaveEmpId;
                  employeeIdMap.set(leaveEmpId, normalizedLeaveId);
                } else {
                  normalizedLeaveId = leaveEmpId;
                }
              }
              if (!scopedCanonicalIds.has(normalizedLeaveId)) return;
              onLeaveEmployees.add(normalizedLeaveId);
            }
          } catch (e) {
            console.error('[attendance/stats] Error parsing leave date range:', leave.dateRange, e);
          }
      }
    });
    const onLeaveCount = onLeaveEmployees.size;

    // Count WFH - employees who checked in but marked as WFH or have WFH status
    // Also check for WFH requests in attendance_requests
    const wfhEmployees = new Set();
    
    // First, check check-ins for WFH status
    todayCheckIns.forEach(c => {
      if (c.checkInTime && c.employeeId) {
        // Check if marked as WFH in check-in record
        const isWFH = c.status === 'wfh' || 
                      c.status === 'WFH' ||
                      c.location === 'remote' || 
                      c.location === 'WFH' ||
                      c.location === 'wfh' ||
                      c.workMode === 'WFH' ||
                      c.workMode === 'wfh';
        
        if (isWFH) {
          // Try to normalize the employeeId using our map
          let normalizedId = employeeIdMap.get(c.employeeId);
          
          // If not found in map, try to find by matching with employee list
          if (!normalizedId) {
            const matchingEmp = employeesList.find(emp => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              const emailPrefix = emp.email?.split('@')[0] || '';
              return empId === c.employeeId || 
                     emailPrefix === c.employeeId ||
                     emp.email === c.employeeId ||
                     emp.employeeId === c.employeeId;
            });
            
            if (matchingEmp) {
              normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || c.employeeId;
              employeeIdMap.set(c.employeeId, normalizedId);
            } else {
              normalizedId = c.employeeId;
            }
          }
          if (!scopedCanonicalIds.has(normalizedId)) return;
          wfhEmployees.add(normalizedId);
          console.log(`[attendance/stats] Found WFH check-in for employee: ${c.employeeId} (normalized: ${normalizedId})`);
        }
      }
    });
    
    // Also check for approved WFH requests
    const wfhRequestsQuery = {
      type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
      status: 'approved',
      ...(companyName ? { company: companyName } : {})
    };
    const wfhRequests = await requestsCol.find(wfhRequestsQuery).toArray();
    wfhRequests.forEach((wfhReq) => {
      const wfhParts = splitDateRangeParts(wfhReq.dateRange);
      if (wfhParts) {
        const parts = wfhParts;
        try {
            const fromDate = new Date(parts[0].trim());
            const toDate = new Date(parts[1].trim());
            const todayDate = new Date(todayDateStr);
            
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(0, 0, 0, 0);
            todayDate.setHours(0, 0, 0, 0);
            
            if (todayDate >= fromDate && todayDate <= toDate) {
              const reqEmpId = wfhReq.employeeId;
              let normalizedId = employeeIdMap.get(reqEmpId);
              if (!normalizedId) {
                const matchingEmp = employeesList.find(emp => {
                  const empId = emp.employeeId || emp.email?.split('@')[0] || '';
                  return empId === reqEmpId || emp.email === reqEmpId || emp.employeeId === reqEmpId;
                });
                if (matchingEmp) {
                  normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || reqEmpId;
                  employeeIdMap.set(reqEmpId, normalizedId);
                } else {
                  normalizedId = reqEmpId;
                }
              }
              if (!scopedCanonicalIds.has(normalizedId)) return;
              wfhEmployees.add(normalizedId);
              console.log(`[attendance/stats] Found WFH request for employee: ${reqEmpId} (normalized: ${normalizedId})`);
            }
          } catch (e) {
            console.error('[attendance/stats] Error parsing WFH request date range:', wfhReq.dateRange, e);
          }
      }
    });
    
    const onWFHCount = wfhEmployees.size;
    console.log(`[attendance/stats] WFH employees: ${onWFHCount}`, Array.from(wfhEmployees));

    // Get unique employees who checked in today (have checkInTime) - EXCLUDING WFH
    // Present = employees who checked in AND are NOT WFH
    const presentEmployees = new Set();
    todayCheckIns.forEach(c => {
      if (c.checkInTime && c.employeeId) {
        // Skip if this employee is WFH
        const isWFH = c.status === 'wfh' || 
                      c.status === 'WFH' ||
                      c.location === 'remote' || 
                      c.location === 'WFH' ||
                      c.location === 'wfh' ||
                      c.workMode === 'WFH' ||
                      c.workMode === 'wfh';
        
        if (!isWFH) {
          // Try to normalize the employeeId using our map
          let normalizedId = employeeIdMap.get(c.employeeId);
          
          // If not found in map, try to find by matching with employee list
          if (!normalizedId) {
            const matchingEmp = employeesList.find(emp => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              const emailPrefix = emp.email?.split('@')[0] || '';
              return empId === c.employeeId || 
                     emailPrefix === c.employeeId ||
                     emp.email === c.employeeId ||
                     emp.employeeId === c.employeeId;
            });
            
            if (matchingEmp) {
              normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || c.employeeId;
              employeeIdMap.set(c.employeeId, normalizedId);
            } else {
              normalizedId = c.employeeId;
            }
          }
          
          // Only add if not WFH and not on leave
          if (scopedCanonicalIds.has(normalizedId) && !wfhEmployees.has(normalizedId) && !onLeaveEmployees.has(normalizedId)) {
            presentEmployees.add(normalizedId);
            console.log(`[attendance/stats] Found present check-in for employee: ${c.employeeId} (normalized: ${normalizedId}), checkInTime: ${c.checkInTime}`);
          }
        }
      }
    });
    const presentCount = presentEmployees.size;
    
    console.log(`[attendance/stats] Present employees (excluding WFH and Leave): ${presentCount}`, Array.from(presentEmployees));

    // Calculate absent count based on ACTIVE employees only.
    const absentCount = Math.max(0, activeEmployees - presentCount - onLeaveCount - onWFHCount);

    // Count late check-ins: unique ACTIVE employees, excluding WFH + leave, and using the same late rule everywhere.
    const isWFHCheckin = (c) =>
      c?.status === 'wfh' ||
      c?.status === 'WFH' ||
      c?.location === 'remote' ||
      c?.location === 'WFH' ||
      c?.location === 'wfh' ||
      c?.workMode === 'WFH' ||
      c?.workMode === 'wfh';

    const countedLate = new Set(); // canonicalId
    for (const c of todayCheckIns) {
      if (!c?.checkInTime || !c?.employeeId) continue;

      // Normalize employeeId to canonical and enforce current scope (active employees only).
      let normalizedId = employeeIdMap.get(c.employeeId);
      if (!normalizedId) {
        const matchingEmp = employeesList.find((emp) => {
          const empId = emp.employeeId || emp.email?.split('@')[0] || '';
          const emailPrefix = emp.email?.split('@')[0] || '';
          return (
            empId === c.employeeId ||
            emailPrefix === c.employeeId ||
            emp.email === c.employeeId ||
            emp.employeeId === c.employeeId
          );
        });
        if (matchingEmp) {
          normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || c.employeeId;
          employeeIdMap.set(c.employeeId, normalizedId);
        } else {
          normalizedId = c.employeeId;
        }
      }

      if (!scopedCanonicalIds.has(normalizedId)) continue;
      if (onLeaveEmployees.has(normalizedId)) continue;
      if (wfhEmployees.has(normalizedId)) continue;
      if (isWFHCheckin(c)) continue;
      if (countedLate.has(normalizedId)) continue;

      const t = parseCheckTime(c.checkInTime);
      if (t && isLateByPunchIn(t)) countedLate.add(normalizedId);
    }
    const lateCheckIns = countedLate.size;

    // Get pending attendance requests count
    const pendingRequests = await requestsCol.countDocuments({ 
      status: 'pending',
      ...(companyName ? { company: companyName } : {})
    });
    
    console.log(`[attendance/stats] Stats for ${date}:`, {
      totalEmployees,
      presentCount,
      absentCount,
      onLeaveCount,
      onWFHCount,
      lateCheckIns,
      pendingRequests
    });

    // Change detection (ETag): lets clients poll but only download/process JSON when data changes.
    // We include only the derived stats (plus request scope) so a change in any underlying records
    // naturally changes the tag.
    const etagSource = JSON.stringify({
      company: companyName || null,
      date,
      department: department || 'all',
      totalEmployees: totalEmployees || 0,
      activeEmployees: activeEmployees || 0,
      inactiveEmployees: inactiveEmployees || 0,
      presentToday: presentCount,
      absentToday: absentCount,
      onLeaveToday: onLeaveCount,
      onWFHToday: onWFHCount,
      lateCheckIns,
      leaveApprovals: pendingRequests,
    });
    const etag = `"${crypto.createHash('sha1').update(etagSource).digest('hex')}"`;

    // Encourage revalidation (not storage). If unchanged and client sends If-None-Match, return 304.
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Origin, If-None-Match');
    if (req.headers && req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const statsBody = {
      success: true,
      data: {
        totalEmployees: totalEmployees || 0,
        activeEmployees: activeEmployees || 0,
        inactiveEmployees: inactiveEmployees || 0,
        presentToday: presentCount,
        absentToday: absentCount,
        onLeaveToday: onLeaveCount,
        onWFHToday: onWFHCount,
        lateCheckIns,
        leaveApprovals: pendingRequests,
      },
    };

    if (responseCache.cacheEnabled()) {
      await responseCache.set(
        statsCacheKey,
        { etag, body: statsBody },
        Number(process.env.ATTENDANCE_STATS_CACHE_TTL_MS || 60000)
      );
    }

    return res.json(statsBody);
  } catch (error) {
    console.error('HRMS attendance stats error:', error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function attendanceStatsByDepartment(req, res) {
  try {
    const crypto = require('crypto');
    const effectiveCompany = requireCompany(req, res);
    if (!effectiveCompany) return;
    await connectMongo();

    const date = firstQueryValue(req.query.date, new Date().toISOString().split('T')[0]);
    const departmentFilter = firstQueryValue(req.query.department, 'all'); // optional
    const payrollCompany = firstQueryValue(req.query.payrollCompany, null);

    const db = await getEmployeeDbForHrms(effectiveCompany);
    const checkinsCol = db.collection('employee_checkins');
    const requestsCol = db.collection('attendance_requests');

    const { getUsersCollection } = require('../../../config/mongo');
    const companyName = effectiveCompany;

    // 1) Load employees once and group by department (active only for attendance math).
    const usersCol = await getUsersCollection(null, companyName);
    const query = { company: companyName };
    const pcClause = buildPayrollCompanyClause(payrollCompany);
    if (pcClause) query.payrollCompany = pcClause;
    const allEmployees = await usersCol.find(query).toArray();

    const normalizeDept = (v) => String(v || '').trim().toLowerCase();
    const requestedDept = normalizeDept(departmentFilter);

    const isEmployeeActive = (e) => e?.isActive !== false && e?.active !== false;

    const employeeMeta = new Map(); // canonicalId -> { deptKey, isActive }
    const employeeIdMap = new Map(); // anyId -> canonicalId
    const empCodeToCanonicalId = new Map(); // emp_code -> canonicalId

    for (const emp of allEmployees) {
      const deptKey = normalizeDept(emp.department || 'General') || 'general';
      if (requestedDept && requestedDept !== 'all' && deptKey !== requestedDept) {
        // still map ids for normalization (safe), but do not count in scoped sets unless matches
      }

      const canonicalId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (canonicalId) {
        employeeMeta.set(canonicalId, { deptKey, isActive: isEmployeeActive(emp) });
        employeeIdMap.set(canonicalId, canonicalId);
        if (emp.employeeId) employeeIdMap.set(emp.employeeId, canonicalId);
        if (emp.email) {
          employeeIdMap.set(emp.email, canonicalId);
          employeeIdMap.set(emp.email.split('@')[0], canonicalId);
        }
      }

      const empCode = normalizeEmpCode(emp.emp_code);
      if (empCode && canonicalId) {
        empCodeToCanonicalId.set(empCode, canonicalId);
      }
    }

    // Precompute active counts per dept
    const deptActive = new Map();
    const deptTotal = new Map();
    for (const [cid, meta] of employeeMeta.entries()) {
      if (!meta?.deptKey) continue;
      deptTotal.set(meta.deptKey, (deptTotal.get(meta.deptKey) || 0) + 1);
      if (meta.isActive) deptActive.set(meta.deptKey, (deptActive.get(meta.deptKey) || 0) + 1);
    }

    // 2) Load check-ins for the day (date or fallback range)
    let todayCheckIns = await checkinsCol.find({ date }).toArray();
    if (todayCheckIns.length === 0) {
      const todayDate = new Date(date);
      if (isValidDate(todayDate)) {
        const startOfDay = new Date(todayDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(todayDate);
        endOfDay.setHours(23, 59, 59, 999);
        todayCheckIns = await checkinsCol
          .find({ checkInTime: { $gte: startOfDay, $lte: endOfDay } })
          .toArray();
      }
    }

    // 3) Merge machine attendance as synthetic check-ins (same idea as attendanceStats)
    try {
      const machineReports = await getMachineAttendanceForDay(date);
      const machinePresent = machineReports.filter((r) => {
        const st = String(r.status || '').toLowerCase();
        const hasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
        return (st === 'present' || st === 'mis') && hasIn;
      });
      for (const r of machinePresent) {
        const empCode = normalizeEmpCode(r.emp_code);
        if (!empCode) continue;
        const canonicalId = empCodeToCanonicalId.get(empCode);
        if (!canonicalId) continue;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive) continue;
        if (requestedDept && requestedDept !== 'all' && meta.deptKey !== requestedDept) continue;

        const checkInTime = timeHmToDate(date, r.punch_in ? String(r.punch_in) : null);
        const checkOutTime = timeHmToDate(date, r.punch_out ? String(r.punch_out) : null);
        if (!checkInTime) continue;

        const already = todayCheckIns.some((c) => {
          if (!c || !c.employeeId) return false;
          const normalized = employeeIdMap.get(c.employeeId) || c.employeeId;
          return normalized === canonicalId;
        });
        if (already) continue;

        todayCheckIns.push({
          employeeId: canonicalId,
          checkInTime,
          checkOutTime,
          date,
          source: 'machine',
        });
      }
    } catch {
      // non-fatal
    }

    // 4) Leaves + WFH requests for that day
    const onLeaveByDept = new Map(); // deptKey -> Set(canonicalId)
    const wfhByDept = new Map(); // deptKey -> Set(canonicalId)

    const addToDeptSet = (map, deptKey, canonicalId) => {
      if (!deptKey || !canonicalId) return;
      if (!map.has(deptKey)) map.set(deptKey, new Set());
      map.get(deptKey).add(canonicalId);
    };

    const approvedLeaves = await requestsCol
      .find({ type: 'time-off', status: 'approved', ...(companyName ? { company: companyName } : {}) })
      .toArray();
    for (const leave of approvedLeaves) {
      const rangeParts = splitDateRangeParts(leave.dateRange);
      if (!rangeParts) continue;
      try {
        const fromDate = new Date(rangeParts[0].trim());
        const toDate = new Date(rangeParts[1].trim());
        const todayDate = new Date(date);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(0, 0, 0, 0);
        todayDate.setHours(0, 0, 0, 0);
        if (!(todayDate >= fromDate && todayDate <= toDate)) continue;

        const leaveEmpId = leave.employeeId;
        const canonicalId = employeeIdMap.get(leaveEmpId) || leaveEmpId;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive) continue;
        if (requestedDept && requestedDept !== 'all' && meta.deptKey !== requestedDept) continue;
        addToDeptSet(onLeaveByDept, meta.deptKey, canonicalId);
      } catch {
        // ignore bad date ranges
      }
    }

    const wfhRequests = await requestsCol
      .find({
        type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
        status: 'approved',
        ...(companyName ? { company: companyName } : {}),
      })
      .toArray();
    for (const req0 of wfhRequests) {
      const parts = splitDateRangeParts(req0.dateRange);
      if (!parts) continue;
      try {
        const fromDate = new Date(parts[0].trim());
        const toDate = new Date(parts[1].trim());
        const todayDate = new Date(date);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(0, 0, 0, 0);
        todayDate.setHours(0, 0, 0, 0);
        if (!(todayDate >= fromDate && todayDate <= toDate)) continue;

        const empId = req0.employeeId;
        const canonicalId = employeeIdMap.get(empId) || empId;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive) continue;
        if (requestedDept && requestedDept !== 'all' && meta.deptKey !== requestedDept) continue;
        addToDeptSet(wfhByDept, meta.deptKey, canonicalId);
      } catch {
        // ignore
      }
    }

    // 5) Present/WFH from check-ins
    const presentByDept = new Map(); // deptKey -> Set(canonicalId)
    const lateByDept = new Map(); // deptKey -> number
    const seenLateKey = new Set(); // deptKey|canonicalId to avoid dup counting

    const isWFHCheckin = (c) =>
      c?.status === 'wfh' ||
      c?.status === 'WFH' ||
      c?.location === 'remote' ||
      c?.location === 'WFH' ||
      c?.location === 'wfh' ||
      c?.workMode === 'WFH' ||
      c?.workMode === 'wfh';

    for (const c of todayCheckIns) {
      if (!c || !c.employeeId || !c.checkInTime) continue;
      const canonicalId = employeeIdMap.get(c.employeeId) || c.employeeId;
      const meta = employeeMeta.get(canonicalId);
      if (!meta?.isActive) continue;
      if (requestedDept && requestedDept !== 'all' && meta.deptKey !== requestedDept) continue;

      const deptKey = meta.deptKey;
      if (isWFHCheckin(c)) {
        addToDeptSet(wfhByDept, deptKey, canonicalId);
        continue;
      }

      // Present excludes WFH + leave
      const leaveSet = onLeaveByDept.get(deptKey);
      const wfhSet = wfhByDept.get(deptKey);
      if (leaveSet && leaveSet.has(canonicalId)) continue;
      if (wfhSet && wfhSet.has(canonicalId)) continue;
      addToDeptSet(presentByDept, deptKey, canonicalId);

      const checkInTime = parseCheckTime(c.checkInTime);
      if (checkInTime && isLateByPunchIn(checkInTime)) {
        const k = `${deptKey}::${canonicalId}`;
        if (!seenLateKey.has(k)) {
          seenLateKey.add(k);
          lateByDept.set(deptKey, (lateByDept.get(deptKey) || 0) + 1);
        }
      }
    }

    // 6) Build final stats map
    const allDeptKeys = Array.from(
      new Set([
        ...deptTotal.keys(),
        ...deptActive.keys(),
        ...presentByDept.keys(),
        ...onLeaveByDept.keys(),
        ...wfhByDept.keys(),
      ])
    );

    const byDepartment = {};
    for (const deptKey of allDeptKeys) {
      const totalEmployees = deptTotal.get(deptKey) || 0;
      const activeEmployees = deptActive.get(deptKey) || 0;
      const presentToday = presentByDept.get(deptKey)?.size || 0;
      const onLeaveToday = onLeaveByDept.get(deptKey)?.size || 0;
      const onWFHToday = wfhByDept.get(deptKey)?.size || 0;
      const absentToday = Math.max(0, activeEmployees - presentToday - onLeaveToday - onWFHToday);
      const lateCheckIns = lateByDept.get(deptKey) || 0;

      byDepartment[deptKey] = {
        department: deptKey,
        totalEmployees,
        activeEmployees,
        presentToday,
        absentToday,
        onLeaveToday,
        onWFHToday,
        lateCheckIns,
      };
    }

    const etagSource = JSON.stringify({
      company: companyName || null,
      date,
      department: departmentFilter || 'all',
      byDepartment,
    });
    const etag = `"${crypto.createHash('sha1').update(etagSource).digest('hex')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Origin, If-None-Match');
    if (req.headers && req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    // Return department keys as originally cased isn't available; frontend can display title-cased if needed.
    return res.json({
      success: true,
      data: {
        date,
        company: companyName,
        departmentFilter: departmentFilter || 'all',
        byDepartment,
      },
    });
  } catch (error) {
    console.error('HRMS attendance stats by-department error:', error);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function attendanceStatsTrends(req, res) {
  try {
    const crypto = require('crypto');
    const effectiveCompany = requireCompany(req, res);
    if (!effectiveCompany) return;
    await connectMongo();

    const endDateStr = firstQueryValue(req.query.endDate, new Date().toISOString().split('T')[0]);
    const daysRaw = firstQueryValue(req.query.days, '7');
    const days = Math.max(1, Math.min(31, parseInt(daysRaw, 10) || 7));
    const departmentFilter = firstQueryValue(req.query.department, 'all'); // optional
    const payrollCompany = firstQueryValue(req.query.payrollCompany, null);

    const endDate = new Date(endDateStr);
    if (!isValidDate(endDate)) {
      return res.status(400).json({ success: false, error: 'Invalid endDate (expected YYYY-MM-DD)' });
    }

    const db = await getEmployeeDbForHrms(effectiveCompany);
    const checkinsCol = db.collection('employee_checkins');
    const requestsCol = db.collection('attendance_requests');

    const { getUsersCollection } = require('../../../config/mongo');
    const companyName = effectiveCompany;

    const usersCol = await getUsersCollection(null, companyName);
    const query = { company: companyName };
    const pcClause = buildPayrollCompanyClause(payrollCompany);
    if (pcClause) query.payrollCompany = pcClause;
    const allEmployees = await usersCol.find(query).toArray();

    const normalizeDept = (v) => String(v || '').trim().toLowerCase();
    const requestedDept = normalizeDept(departmentFilter);
    const isEmployeeActive = (e) => e?.isActive !== false && e?.active !== false;

    // Build employee maps once (reuse across all days)
    const employeeMeta = new Map(); // canonicalId -> { deptKey, isActive }
    const employeeIdMap = new Map(); // anyId -> canonicalId
    const empCodeToCanonicalId = new Map(); // emp_code -> canonicalId

    for (const emp of allEmployees) {
      const deptKey = normalizeDept(emp.department || 'General') || 'general';
      const canonicalId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (canonicalId) {
        employeeMeta.set(canonicalId, { deptKey, isActive: isEmployeeActive(emp) });
        employeeIdMap.set(canonicalId, canonicalId);
        if (emp.employeeId) employeeIdMap.set(emp.employeeId, canonicalId);
        if (emp.email) {
          employeeIdMap.set(emp.email, canonicalId);
          employeeIdMap.set(emp.email.split('@')[0], canonicalId);
        }
      }
      const empCode = normalizeEmpCode(emp.emp_code);
      if (empCode && canonicalId) empCodeToCanonicalId.set(empCode, canonicalId);
    }

    const matchesDept = (meta) =>
      !requestedDept || requestedDept === 'all' ? true : meta?.deptKey === requestedDept;

    const activeEmployeesBase = Array.from(employeeMeta.values()).filter((m) => m?.isActive && matchesDept(m)).length;
    const totalEmployeesBase = Array.from(employeeMeta.values()).filter((m) => matchesDept(m)).length;

    // Preload approved leave + wfh requests once, filter per day.
    const approvedLeaves = await requestsCol
      .find({ type: 'time-off', status: 'approved', ...(companyName ? { company: companyName } : {}) })
      .toArray();
    const approvedWfh = await requestsCol
      .find({
        type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
        status: 'approved',
        ...(companyName ? { company: companyName } : {}),
      })
      .toArray();

    const parseRange = (req0) => {
      const parts = splitDateRangeParts(req0?.dateRange);
      if (!parts) return null;
      const from = new Date(parts[0].trim());
      const to = new Date(parts[1].trim());
      if (!isValidDate(from) || !isValidDate(to)) return null;
      from.setHours(0, 0, 0, 0);
      to.setHours(0, 0, 0, 0);
      return { from, to };
    };

    const isWFHCheckin = (c) =>
      c?.status === 'wfh' ||
      c?.status === 'WFH' ||
      c?.location === 'remote' ||
      c?.location === 'WFH' ||
      c?.location === 'wfh' ||
      c?.workMode === 'WFH' ||
      c?.workMode === 'wfh';

    const trends = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(endDate.getDate() - i);
      const dateStr = yyyyMmDdLocal(d);

      // Check-ins for the day
      let todayCheckIns = await checkinsCol.find({ date: dateStr }).toArray();
      if (todayCheckIns.length === 0) {
        const todayDate = new Date(dateStr);
        if (isValidDate(todayDate)) {
          const startOfDay = new Date(todayDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(todayDate);
          endOfDay.setHours(23, 59, 59, 999);
          todayCheckIns = await checkinsCol
            .find({ checkInTime: { $gte: startOfDay, $lte: endOfDay } })
            .toArray();
        }
      }

      // Merge machine attendance
      try {
        const machineReports = await getMachineAttendanceForDay(dateStr);
        const machinePresent = machineReports.filter((r) => {
          const st = String(r.status || '').toLowerCase();
          const hasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
          return (st === 'present' || st === 'mis') && hasIn;
        });
        for (const r of machinePresent) {
          const empCode = normalizeEmpCode(r.emp_code);
          if (!empCode) continue;
          const canonicalId = empCodeToCanonicalId.get(empCode);
          if (!canonicalId) continue;
          const meta = employeeMeta.get(canonicalId);
          if (!meta?.isActive || !matchesDept(meta)) continue;
          const checkInTime = timeHmToDate(dateStr, r.punch_in ? String(r.punch_in) : null);
          const checkOutTime = timeHmToDate(dateStr, r.punch_out ? String(r.punch_out) : null);
          if (!checkInTime) continue;
          const already = todayCheckIns.some((c) => (employeeIdMap.get(c?.employeeId) || c?.employeeId) === canonicalId);
          if (already) continue;
          todayCheckIns.push({ employeeId: canonicalId, checkInTime, checkOutTime, date: dateStr, source: 'machine' });
        }
      } catch {
        // ignore
      }

      // On leave + WFH sets
      const day0 = new Date(dateStr);
      day0.setHours(0, 0, 0, 0);
      const onLeave = new Set();
      for (const leave of approvedLeaves) {
        const range = parseRange(leave);
        if (!range) continue;
        if (!(day0 >= range.from && day0 <= range.to)) continue;
        const canonicalId = employeeIdMap.get(leave.employeeId) || leave.employeeId;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive || !matchesDept(meta)) continue;
        onLeave.add(canonicalId);
      }

      const wfh = new Set();
      for (const w of approvedWfh) {
        const range = parseRange(w);
        if (!range) continue;
        if (!(day0 >= range.from && day0 <= range.to)) continue;
        const canonicalId = employeeIdMap.get(w.employeeId) || w.employeeId;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive || !matchesDept(meta)) continue;
        wfh.add(canonicalId);
      }

      // Present excludes WFH + leave
      const present = new Set();
      let lateCheckIns = 0;
      const countedLate = new Set();
      for (const c of todayCheckIns) {
        if (!c?.employeeId || !c?.checkInTime) continue;
        const canonicalId = employeeIdMap.get(c.employeeId) || c.employeeId;
        const meta = employeeMeta.get(canonicalId);
        if (!meta?.isActive || !matchesDept(meta)) continue;
        if (isWFHCheckin(c)) {
          wfh.add(canonicalId);
          continue;
        }
        if (onLeave.has(canonicalId) || wfh.has(canonicalId)) continue;
        present.add(canonicalId);

        const t = parseCheckTime(c.checkInTime);
        if (t && isLateByPunchIn(t)) {
          if (!countedLate.has(canonicalId)) {
            countedLate.add(canonicalId);
            lateCheckIns += 1;
          }
        }
      }

      const onLeaveCount = onLeave.size;
      const onWFHCount = wfh.size;
      const presentCount = present.size;
      const absentCount = Math.max(0, activeEmployeesBase - presentCount - onLeaveCount - onWFHCount);

      trends.push({
        date: dateStr,
        totalEmployees: totalEmployeesBase,
        activeEmployees: activeEmployeesBase,
        presentToday: presentCount,
        absentToday: absentCount,
        onLeaveToday: onLeaveCount,
        onWFHToday: onWFHCount,
        lateCheckIns,
      });
    }

    const etagSource = JSON.stringify({
      company: companyName || null,
      endDate: endDateStr,
      days,
      department: departmentFilter || 'all',
      trends,
    });
    const etag = `"${crypto.createHash('sha1').update(etagSource).digest('hex')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Origin, If-None-Match');
    if (req.headers && req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({
      success: true,
      data: {
        company: companyName,
        endDate: endDateStr,
        days,
        departmentFilter: departmentFilter || 'all',
        trends,
      },
    });
  } catch (error) {
    console.error('HRMS attendance trends error:', error);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

module.exports = {
  listAttendance,
  attendanceStats,
  attendanceStatsByDepartment,
  attendanceStatsTrends,
  exportMachineAttendanceReports,
};
