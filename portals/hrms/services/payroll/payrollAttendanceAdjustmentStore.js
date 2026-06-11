const { getDb, LOGIN_DB_NAME } = require('../../../../config/mongo');

const COLLECTION = 'payroll_attendance_adjustments';

/**
 * HR manual correction for monthly paid days (e.g. forgot punch): delta applied on top of machine attendance.
 * deltaPaidDays +1 → one extra paid day; −1 → one less.
 */
async function loadPayrollAttendanceAdjustment(company, employeeId, monthYear) {
  if (!company || !employeeId || !monthYear) return { deltaPaidDays: 0 };
  const db = await getDb(LOGIN_DB_NAME);
  const col = db.collection(COLLECTION);
  const doc = await col.findOne({
    company: String(company).trim(),
    employeeId: String(employeeId).trim(),
    monthYear: String(monthYear).trim(),
  });
  if (!doc) return { deltaPaidDays: 0 };
  const delta = Number(doc.deltaPaidDays || 0);
  return { deltaPaidDays: Number.isFinite(delta) ? delta : 0 };
}

async function savePayrollAttendanceAdjustment(company, employeeId, monthYear, deltaPaidDays) {
  if (!company || !employeeId || !monthYear) throw new Error('company, employeeId, monthYear are required');
  const d = Math.round(Number(deltaPaidDays));
  if (!Number.isFinite(d)) throw new Error('deltaPaidDays must be a number');
  const db = await getDb(LOGIN_DB_NAME);
  const col = db.collection(COLLECTION);
  const filter = {
    company: String(company).trim(),
    employeeId: String(employeeId).trim(),
    monthYear: String(monthYear).trim(),
  };
  if (d === 0) {
    await col.deleteOne(filter);
    return { deltaPaidDays: 0 };
  }
  await col.updateOne(
    filter,
    {
      $set: {
        ...filter,
        deltaPaidDays: d,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return { deltaPaidDays: d };
}

module.exports = {
  loadPayrollAttendanceAdjustment,
  savePayrollAttendanceAdjustment,
};
