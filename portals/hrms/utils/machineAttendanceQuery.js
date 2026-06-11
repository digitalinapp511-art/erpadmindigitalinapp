const { getDb, LOGIN_DB_NAME } = require('../../../config/mongo');

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Month range for machine_attendance_reports queries (aligned with attendanceController).
 */
function getUtcMonthRange(monthYear) {
  const [yyyy, mm] = String(monthYear).split('-').map((x) => Number(x));
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null;
  const startDate = `${yyyy}-${String(mm).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const endDate = `${yyyy}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  return { startDate, endDate, start, end };
}

async function getMachineAttendanceForRange(range) {
  if (!range?.start || !range?.end) return [];
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
      console.warn(`[machine_attendance_reports] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
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

function isMachinePresentRecord(r) {
  const st = String(r.status || '').toLowerCase();
  const hasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
  return (st === 'present' || st === 'mis') && hasIn;
}

/**
 * Pick best report for same emp+day (Present wins; prefer punch_in).
 */
function pickBetterMachineReport(existing, next) {
  if (!existing) return next;
  const exStatus = String(existing.status || '').toLowerCase();
  const rStatus = String(next.status || '').toLowerCase();
  const exPresent = exStatus === 'present';
  const rPresent = rStatus === 'present';
  if (!exPresent && rPresent) return next;
  if (exPresent === rPresent) {
    const exHasIn = existing.punch_in != null && String(existing.punch_in).trim() !== '';
    const rHasIn = next.punch_in != null && String(next.punch_in).trim() !== '';
    if (!exHasIn && rHasIn) return next;
  }
  return existing;
}

module.exports = {
  normalizeEmpCode,
  getUtcMonthRange,
  getMachineAttendanceForRange,
  extractYyyyMmDdFromMachineDate,
  isMachinePresentRecord,
  pickBetterMachineReport,
};
