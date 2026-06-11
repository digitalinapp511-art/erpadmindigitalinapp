const { getDb, getEmployeePortalDb, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const { EMPLOYEE_CHECKINS } = require('../models');

function todayYMD() {
  return new Date().toISOString().split('T')[0];
}

function localTodayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Machine punch_in is office wall-clock time; interpret in fixed offset (default IST) so duration math matches the portal. */
function timeHmToIso(dateYmd, hm) {
  if (!dateYmd || !hm) return null;
  const [h, m] = String(hm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const offset = process.env.OFFICE_TZ_OFFSET || '+05:30';
  const d = new Date(`${dateYmd}T${hh}:${mm}:00${offset}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** punch_out in DB is office wall-clock "HH:MM" (e.g. "17:58"). */
function isPunchHmAtOrAfter3pm(hm) {
  if (!hm) return false;
  const [h, m] = String(hm).split(':').map(Number);
  if (!Number.isFinite(h)) return false;
  return h > 15 || (h === 15 && (Number.isFinite(m) ? m >= 0 : true));
}

function minutesBetweenIso(inIso, outIso) {
  if (!inIso || !outIso) return 0;
  const a = new Date(inIso).getTime();
  const b = new Date(outIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 60000);
}

/** Portal auto-checkout when machine punch_out exists at/after 3 PM (no manual checkout). */
function buildMachineAutoCheckoutStatus({ employeeId, todayLocal, machineCheckInIso, machineCheckOutIso, machine }) {
  if (!machineCheckInIso || !machineCheckOutIso || !machine?.punchOut) return null;
  if (!isPunchHmAtOrAfter3pm(machine.punchOut)) return null;
  const totalMinutes = minutesBetweenIso(machineCheckInIso, machineCheckOutIso);
  return {
    status: 'checked-out',
    checkInTime: null,
    checkOutTime: machineCheckOutIso,
    lastSessionCheckInTime: machineCheckInIso,
    totalMinutes,
    employeeId,
    source: 'machine',
    earliestPunchInTime: null,
    machinePunchOutTime: machineCheckOutIso,
    autoCheckoutFromMachine: true,
  };
}

function employeeProfileFromDoc(emp) {
  if (!emp) {
    return { empCode: null, employeeName: 'Unknown', department: 'General' };
  }
  const empCode =
    emp.emp_code != null && String(emp.emp_code).trim() !== ''
      ? String(emp.emp_code).trim()
      : emp.empCode != null && String(emp.empCode).trim() !== ''
        ? String(emp.empCode).trim()
        : null;
  const employeeName =
    (emp.name && String(emp.name).trim()) ||
    (emp.firstName && String(emp.firstName).trim()) ||
    emp.email?.split('@')[0] ||
    'Unknown';
  const department = String(emp.department || '').trim() || 'General';
  return { empCode, employeeName, department };
}

async function findEmployeeByEmployeeId({ employeeId, company, projection }) {
  if (!employeeId || !company) return null;

  const usersCol = await getUsersCollection(null, company);
  const employeeKey = String(employeeId).trim();
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fields =
    projection ||
    { emp_code: 1, empCode: 1, name: 1, firstName: 1, employeeId: 1, email: 1, department: 1 };

  return usersCol.findOne(
    {
      company,
      $or: [
        { employeeId: employeeKey },
        { employeeId: new RegExp(`^${escapeRe(employeeKey)}$`, 'i') },
        { email: new RegExp(`^${escapeRe(employeeKey)}(@|$)`, 'i') },
      ],
    },
    { projection: fields }
  );
}

async function resolveEmployeeForCheckin({ employeeId, company }) {
  const emp = await findEmployeeByEmployeeId({ employeeId, company });
  return employeeProfileFromDoc(emp);
}

async function getMachinePunchForEmployee({ employeeId, company, dateYmd }) {
  if (!employeeId || !company || !dateYmd) return null;

  const emp = await findEmployeeByEmployeeId({
    employeeId,
    company,
    projection: { emp_code: 1, name: 1, employeeId: 1, email: 1 },
  });
  const empCode = emp?.emp_code != null && String(emp.emp_code).trim() !== '' ? String(emp.emp_code).trim() : null;
  if (!empCode) return null;

  if (process.env.DEBUG_CHECKIN_MACHINE === 'true') {
    console.log('[checkin/machine] employee match', {
      employeeId,
      company,
      empCode,
      dateYmd,
    });
  }

  const empCodeStr = String(empCode).trim();
  const empCodeNum = Number(empCodeStr);
  const empCodeNoLeadingZeros = empCodeStr.replace(/^0+/, '') || '0';
  const empCodeCandidates = Array.from(
    new Set([
      empCodeStr,
      empCodeNoLeadingZeros,
      Number.isFinite(empCodeNum) ? empCodeNum : null,
      Number.isFinite(empCodeNum) ? String(empCodeNum) : null,
    ].filter((v) => v !== null && v !== undefined && String(v).trim() !== ''))
  );

  // Machine attendance has historically existed under multiple DB + collection names.
  // Try common candidates so biometric punches reliably reflect in status API.
  const dbNamesToTry = Array.from(new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== '')));
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];

  // In this DB, `date` is sometimes stored as Date and sometimes as string.
  const start = new Date(`${dateYmd}T00:00:00.000Z`);
  const end = new Date(`${dateYmd}T23:59:59.999Z`);

  if (process.env.DEBUG_CHECKIN_MACHINE === 'true') {
    console.log('[checkin/machine] lookup targets', { dbNamesToTry, collectionNamesToTry });
  }

  let doc = null;
  for (const dbName of dbNamesToTry) {
    if (doc) break;
    try {
      const db = await getDb(dbName);
      for (const colName of collectionNamesToTry) {
        try {
          if (process.env.DEBUG_CHECKIN_MACHINE === 'true') {
            console.log('[checkin/machine] trying', { dbName, colName });
          }
          const col = db.collection(colName);
          doc = await col.findOne(
            {
              emp_code: { $in: empCodeCandidates },
              // Only consider records that actually have a punch-in time.
              punch_in: { $exists: true, $ne: '' },
              $or: [
                { date: { $gte: start, $lte: end } },
                { date: new RegExp(`^${dateYmd}`) },
                { date: dateYmd },
                { date: `${dateYmd}T00:00:00.000Z` },
              ],
            },
            { projection: { punch_in: 1, punch_out: 1, status: 1, date: 1 } }
          );
          if (!doc && process.env.DEBUG_CHECKIN_MACHINE === 'true') {
            console.log('[checkin/machine] no doc in', { dbName, colName, empCodeCandidates, dateYmd });
          }
        } catch (_e) {
          // ignore missing collections or access issues and continue
          if (process.env.DEBUG_CHECKIN_MACHINE === 'true') {
            console.log('[checkin/machine] query error in', { dbName, colName, message: _e?.message });
          }
        }
        if (doc) break;
      }
    } catch (e) {
      // Ignore missing DB/collection and keep trying fallbacks.
      if (process.env.DEBUG_CHECKIN_MACHINE === 'true') {
        console.log('[checkin/machine] db error', { dbName, message: e?.message });
      }
    }
  }
  if (!doc) return null;

  const hasPunchIn = doc.punch_in != null && String(doc.punch_in).trim() !== '';
  if (!hasPunchIn) return null;

  return {
    empCode,
    status: String(doc.status || ''),
    punchIn: String(doc.punch_in).trim(),
    punchOut: doc.punch_out != null && String(doc.punch_out).trim() !== '' ? String(doc.punch_out).trim() : null,
  };
}

async function getCheckinsCollection(company) {
  const db = company ? await getEmployeePortalDb(company) : await getDb();
  return db.collection(EMPLOYEE_CHECKINS);
}

async function ensureNotCheckedIn(col, employeeId, today) {
  const existing = await col.findOne({ employeeId, date: today, checkOutTime: null });
  if (existing) {
    const err = new Error('Already checked in today. Please check out first.');
    err.statusCode = 400;
    throw err;
  }
}

async function computeAccumulatedMinutes(col, employeeId, today) {
  const todayCheckIns = await col.find({ employeeId, date: today }).toArray();
  let accumulatedMinutes = 0;
  for (const record of todayCheckIns) {
    if (record.checkOutTime && record.totalMinutes && record.totalMinutes > accumulatedMinutes) {
      accumulatedMinutes = record.totalMinutes;
    }
  }
  return accumulatedMinutes;
}

async function checkinEmployee({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const today = todayYMD();

  await ensureNotCheckedIn(col, employeeId, today);

  const accumulatedMinutes = await computeAccumulatedMinutes(col, employeeId, today);
  const profile = await resolveEmployeeForCheckin({ employeeId, company });

  const checkInTime = new Date();
  const checkInDoc = {
    employeeId,
    date: today,
    checkInTime: checkInTime.toISOString(),
    checkOutTime: null,
    totalMinutes: accumulatedMinutes,
    status: 'checked-in',
    empCode: profile.empCode,
    employeeName: profile.employeeName,
    department: profile.department,
    createdAt: checkInTime,
    updatedAt: checkInTime,
  };

  await col.insertOne(checkInDoc);

  return {
    checkInTime: checkInDoc.checkInTime,
    status: 'checked-in',
    totalMinutes: accumulatedMinutes,
    employeeId,
    empCode: profile.empCode,
    employeeName: profile.employeeName,
    department: profile.department,
  };
}

async function checkoutEmployee({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const today = todayYMD();

  const checkIn = await col.findOne({ employeeId, date: today, checkOutTime: null });
  if (!checkIn) {
    const err = new Error('No active check-in found. Please check in first.');
    err.statusCode = 400;
    throw err;
  }

  const checkOutTime = new Date();
  const checkInTime = new Date(checkIn.checkInTime);
  const sessionMinutes = Math.max(0, (checkOutTime.getTime() - checkInTime.getTime()) / 60000);
  const totalMinutes = (checkIn.totalMinutes || 0) + sessionMinutes;

  const needsProfile =
    !checkIn.empCode || !checkIn.employeeName || !checkIn.department;
  const profile = needsProfile ? await resolveEmployeeForCheckin({ employeeId, company }) : null;

  const updateFields = {
    checkOutTime: checkOutTime.toISOString(),
    totalMinutes,
    status: 'checked-out',
    updatedAt: checkOutTime,
  };
  if (needsProfile && profile) {
    if (!checkIn.empCode && profile.empCode) updateFields.empCode = profile.empCode;
    if (!checkIn.employeeName && profile.employeeName) updateFields.employeeName = profile.employeeName;
    if (!checkIn.department && profile.department) updateFields.department = profile.department;
  }

  await col.updateOne({ _id: checkIn._id }, { $set: updateFields });

  return {
    checkOutTime: checkOutTime.toISOString(),
    totalMinutes,
    totalHours: (totalMinutes / 60).toFixed(2),
    status: 'checked-out',
    employeeId,
    empCode: checkIn.empCode || profile?.empCode || null,
    employeeName: checkIn.employeeName || profile?.employeeName || null,
    department: checkIn.department || profile?.department || null,
  };
}

async function getTodayStatus({ employeeId, company, cache }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = `${company || 'default'}:${employeeId}`;
  const nowTs = Date.now();

  if (cache) {
    const cached = cache.map.get(cacheKey);
    if (cached && nowTs - cached.ts < cache.ttlMs) {
      return cached.data;
    }
  }

  const col = await getCheckinsCollection(company);
  // Prefer local date for UI correctness, but also allow UTC date for existing records.
  const todayLocal = localTodayYMD();
  const todayUtc = todayYMD();
  const today = todayLocal;

  const mostRecentCheckIn = await col
    .find({ employeeId, date: { $in: [todayLocal, todayUtc] } })
    .sort({ checkInTime: -1 })
    .limit(1)
    .project({ checkInTime: 1, checkOutTime: 1, totalMinutes: 1, status: 1 })
    .next();

  const completedSessionsToday = await col.countDocuments({
    employeeId,
    date: { $in: [todayLocal, todayUtc] },
    checkOutTime: { $ne: null },
  });

  // Machine punch (biometric/card) can exist even if user hasn't clicked manual check-in.
  const machine = await getMachinePunchForEmployee({ employeeId, company, dateYmd: todayLocal });
  const machineCheckInIso = machine?.punchIn ? timeHmToIso(todayLocal, machine.punchIn) : null;
  const machineCheckOutIso = machine?.punchOut ? timeHmToIso(todayLocal, machine.punchOut) : null;

  const machineAutoOut = buildMachineAutoCheckoutStatus({
    employeeId,
    todayLocal,
    machineCheckInIso,
    machineCheckOutIso,
    machine,
  });
  if (machineAutoOut) {
    if (cache) cache.map.set(cacheKey, { ts: nowTs, data: machineAutoOut });
    return machineAutoOut;
  }

  if (!mostRecentCheckIn) {
    if (machineCheckInIso) {
      const checkInTime = new Date(machineCheckInIso);
      const now = new Date();
      const currentSessionMinutes = Math.max(0, (now.getTime() - checkInTime.getTime()) / 60000);
      const data = {
        status: 'checked-in',
        checkInTime: machineCheckInIso,
        checkOutTime: null,
        lastSessionCheckInTime: null,
        totalMinutes: currentSessionMinutes,
        employeeId,
        source: 'machine',
        earliestPunchInTime: null,
        machinePunchOutTime: machineCheckOutIso,
        autoCheckoutFromMachine: false,
      };
      if (cache) cache.map.set(cacheKey, { ts: nowTs, data });
      return data;
    }
    const data = {
      status: 'checked-out',
      checkInTime: null,
      checkOutTime: null,
      lastSessionCheckInTime: null,
      totalMinutes: 0,
      employeeId,
      earliestPunchInTime: null,
      machinePunchOutTime: machineCheckOutIso,
    };
    if (cache) cache.map.set(cacheKey, { ts: nowTs, data });
    return data;
  }

  let totalMinutes = mostRecentCheckIn.totalMinutes || 0;
  let status = mostRecentCheckIn.status || (mostRecentCheckIn.checkOutTime ? 'checked-out' : 'checked-in');

  const manualCheckInIso = mostRecentCheckIn.checkInTime || null;
  // Display: earliest punch when both machine and portal exist the same "segment".
  let earliestPunchInIso = null;
  if (machineCheckInIso && manualCheckInIso) {
    earliestPunchInIso =
      new Date(machineCheckInIso).getTime() <= new Date(manualCheckInIso).getTime() ? machineCheckInIso : manualCheckInIso;
  }

  let source = 'manual';
  if (machineCheckInIso && manualCheckInIso) {
    source = earliestPunchInIso === machineCheckInIso ? 'machine' : 'manual';
  } else if (machineCheckInIso && !manualCheckInIso) {
    source = 'machine';
  }

  /**
   * Session anchor for elapsed time: min(machine, manual) for the first open session of the day.
   * If the employee already completed a session today, machine punch is still "first arrival" for the day
   * but must not extend the *current* portal session — use manual check-in for that segment only.
   */
  let sessionAnchorIso = manualCheckInIso;
  if (mostRecentCheckIn.checkInTime && !mostRecentCheckIn.checkOutTime) {
    if (completedSessionsToday > 0) {
      sessionAnchorIso = manualCheckInIso;
    } else if (machineCheckInIso && manualCheckInIso) {
      sessionAnchorIso =
        new Date(machineCheckInIso).getTime() <= new Date(manualCheckInIso).getTime() ? machineCheckInIso : manualCheckInIso;
    } else if (machineCheckInIso) {
      sessionAnchorIso = machineCheckInIso;
    } else {
      sessionAnchorIso = manualCheckInIso;
    }
  }

  if (mostRecentCheckIn.checkInTime && !mostRecentCheckIn.checkOutTime) {
    const anchor = sessionAnchorIso ? new Date(sessionAnchorIso) : new Date(mostRecentCheckIn.checkInTime);
    const now = new Date();
    const currentSessionMinutes = Math.max(0, (now.getTime() - anchor.getTime()) / 60000);
    totalMinutes = (mostRecentCheckIn.totalMinutes || 0) + currentSessionMinutes;
    status = 'checked-in';
  } else {
    status = 'checked-out';
  }

  const displayCheckInIso =
    status === 'checked-out'
      ? machineCheckInIso || mostRecentCheckIn?.checkInTime || null
      : null;
  const displayCheckOutIso =
    status === 'checked-out'
      ? machineCheckOutIso || mostRecentCheckIn.checkOutTime || null
      : mostRecentCheckIn.checkOutTime || null;
  let displayTotalMinutes = totalMinutes;
  if (
    status === 'checked-out' &&
    displayCheckInIso &&
    displayCheckOutIso &&
    machineCheckInIso &&
    machineCheckOutIso
  ) {
    displayTotalMinutes = minutesBetweenIso(machineCheckInIso, machineCheckOutIso);
  }

  const data = {
    status,
    checkInTime: status === 'checked-in' ? sessionAnchorIso || null : null,
    checkOutTime: displayCheckOutIso,
    lastSessionCheckInTime:
      status === 'checked-out'
        ? displayCheckInIso || mostRecentCheckIn?.checkInTime || null
        : null,
    totalMinutes: displayTotalMinutes,
    employeeId,
    source,
    earliestPunchInTime:
      status === 'checked-in' && earliestPunchInIso && sessionAnchorIso && earliestPunchInIso !== sessionAnchorIso
        ? earliestPunchInIso
        : null,
    machinePunchOutTime: machineCheckOutIso,
    autoCheckoutFromMachine: Boolean(
      machine?.punchOut && isPunchHmAtOrAfter3pm(machine.punchOut) && machineCheckInIso && machineCheckOutIso
    ),
  };

  if (cache) cache.map.set(cacheKey, { ts: nowTs, data });
  return data;
}

async function getHistory({ employeeId, company, limit = 30 }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const history = await col
    .find({ employeeId })
    .sort({ date: -1, checkInTime: -1 })
    .limit(limit)
    .toArray();

  return {
    employeeId,
    history: history.map((record) => ({
      date: record.date,
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      totalMinutes: record.totalMinutes,
      totalHours: record.totalMinutes ? (record.totalMinutes / 60).toFixed(2) : 0,
      status: record.status,
      empCode: record.empCode || record.emp_code || null,
      employeeName: record.employeeName || record.name || null,
      department: record.department || null,
    })),
  };
}

module.exports = {
  checkinEmployee,
  checkoutEmployee,
  getTodayStatus,
  getHistory,
};