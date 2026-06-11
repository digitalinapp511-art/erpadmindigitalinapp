const { connectMongo, getDb, LOGIN_DB_NAME, getUsersCollection } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');

function firstQueryValue(val, fallback) {
  if (val == null || val === '') return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || fallback;
}

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s ? s : null;
}

/** Values to match Mongo fields that may store emp_code as number or string. */
function empCodeVariantsForQuery(codeStr) {
  if (!codeStr) return [];
  const out = [codeStr];
  const n = Number(codeStr);
  if (Number.isFinite(n) && String(n) === codeStr) out.push(n);
  return out;
}

function machineDocMatchesEmpCode(doc, targetEmpCodeStr) {
  const raw = doc?.emp_code ?? doc?.empCode ?? doc?.employeeCode ?? doc?.employee_code;
  const a = normalizeEmpCode(raw);
  const b = normalizeEmpCode(targetEmpCodeStr);
  if (a == null || b == null) return false;
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseYyyyMmDd(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function parseDateRange(req) {
  const startDate = firstQueryValue(req.query.startDate, null);
  const endDate = firstQueryValue(req.query.endDate, null);
  if (!startDate || !endDate) return null;
  const start = parseYyyyMmDd(startDate);
  const end = parseYyyyMmDd(endDate);
  if (!start || !end) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) return null;
  return { startDate, endDate, start, end };
}

async function getMachineAttendanceForRange(range) {
  const dbNamesToTry = Array.from(new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== '')));
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
              { date: { $gte: range.startDate, $lte: `${range.endDate}T99:99:99.999Z` } },
            ],
          })
          .toArray();
        all.push(...docs);
      }
    } catch (e) {
      console.warn(`[employee/machine-attendance] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
}

async function getMachineAttendance(req, res) {
  try {
    // company is preferred for scoping, but must be optional because some logins/tokens
    // don't include it. When missing, we resolve employee first and then derive company
    // from the employee profile (if available).
    let company = getCompanyFromRequest(req) || null;

    const range = parseDateRange(req);
    if (!range) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range. Provide startDate and endDate as YYYY-MM-DD.',
      });
    }

    const empCodeRaw = firstQueryValue(req.query.empCode, null) || firstQueryValue(req.query.employeeCode, null);
    const employeeIdRaw = firstQueryValue(req.query.employeeId, null);
    const employeeId = employeeIdRaw && String(employeeIdRaw).trim() ? String(employeeIdRaw).trim() : null;
    const empCodeFromQuery = normalizeEmpCode(empCodeRaw);
    let empCode = empCodeFromQuery;

    if (!empCode && !employeeId) {
      return res.status(400).json({ success: false, error: 'empCode or employeeId is required' });
    }

    await connectMongo();

    // Company scoping: prefer employeeId (portal login) so machine rows match the logged-in user even if empCode in the client is missing or wrong.
    const usersCol = await getUsersCollection(null, company);
    let employee = null;

    if (employeeId) {
      const q = { $or: [{ employeeId: employeeId }, { employee_id: employeeId }] };
      if (company) q.company = company;
      employee = await usersCol.findOne(
        q,
        { projection: { company: 1, emp_code: 1, empCode: 1, employeeCode: 1, employee_code: 1, name: 1, employeeId: 1, email: 1, department: 1 } }
      );
      if (employee) {
        if (!company && employee.company) company = String(employee.company).trim() || null;
        const fromProfile =
          employee.emp_code ??
          employee.empCode ??
          employee.employeeCode ??
          employee.employee_code ??
          null;
        empCode = normalizeEmpCode(fromProfile) || empCode;
      }
    }

    if (!employee && empCodeFromQuery) {
      const variants = empCodeVariantsForQuery(empCodeFromQuery);
      const q = {
        $or: [
          { emp_code: { $in: variants } },
          { empCode: { $in: variants } },
          { employeeCode: { $in: variants } },
          { employee_code: { $in: variants } },
        ],
      };
      if (company) q.company = company;
      employee = await usersCol.findOne(
        q,
        { projection: { company: 1, emp_code: 1, empCode: 1, employeeCode: 1, employee_code: 1, name: 1, employeeId: 1, email: 1, department: 1 } }
      );
      empCode = normalizeEmpCode(empCodeFromQuery);
    }

    if (!employee) {
      return res.json({ success: true, data: { empCode: empCode || '', records: [] } });
    }

    if (employeeId) {
      const docEid = String(employee.employeeId || '').trim();
      if (docEid && docEid !== employeeId) {
        return res.status(403).json({ success: false, error: 'employeeId does not match resolved employee' });
      }
    }

    if (!empCode) {
      return res.json({
        success: true,
        data: {
          empCode: '',
          employee: {
            name: employee.name || '',
            employeeId: employee.employeeId || employee.email?.split('@')[0] || '',
            department: employee.department || '',
          },
          records: [],
        },
      });
    }

    let docs = await getMachineAttendanceForRange(range);
    docs = docs.filter((d) => machineDocMatchesEmpCode(d, empCode));

    const records = docs
      .map((d) => {
        const dateRaw = d.date;
        const dateObj = dateRaw instanceof Date ? dateRaw : new Date(dateRaw);
        const dateIso = !Number.isNaN(dateObj.getTime()) ? dateObj.toISOString() : null;
        const date = dateIso ? dateIso.slice(0, 10) : '';
        return {
          empCode,
          date,
          dateIso,
          punchIn: d.punch_in != null && String(d.punch_in).trim() !== '' ? String(d.punch_in).trim() : null,
          punchOut: d.punch_out != null && String(d.punch_out).trim() !== '' ? String(d.punch_out).trim() : null,
          status: d.status != null ? String(d.status) : '',
          shift: d.shift || d.shift_code || d.shiftCode || '',
          hoursWorked: d.hours_worked ?? d.hoursWorked ?? null,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return res.json({
      success: true,
      data: {
        empCode,
        employee: {
          name: employee.name || '',
          employeeId: employee.employeeId || employee.email?.split('@')[0] || '',
          department: employee.department || '',
        },
        records,
      },
    });
  } catch (err) {
    console.error('[employee/machine-attendance] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getMachineAttendance };

