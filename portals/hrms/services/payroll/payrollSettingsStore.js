const { getDb, LOGIN_DB_NAME } = require('../../../../config/mongo');

const COLLECTION = 'payroll_company_settings';

function makeId() {
  return `slab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSlab(s) {
  if (!s || typeof s !== 'object') return null;
  const minCtc = Number(s.minCtc);
  const maxCtc = s.maxCtc == null || s.maxCtc === '' ? Infinity : Number(s.maxCtc);
  if (!Number.isFinite(minCtc)) return null;
  const eeMode = String(s.eeMode || s.employeeMode || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
  const erMode = String(s.erMode || s.employerMode || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
  const eeFixedRs = s.eeFixedRs != null && s.eeFixedRs !== '' ? Number(s.eeFixedRs) : null;
  const erFixedRs = s.erFixedRs != null && s.erFixedRs !== '' ? Number(s.erFixedRs) : null;
  return {
    id: String(s.id || makeId()),
    label: s.label != null ? String(s.label) : '',
    minCtc,
    maxCtc: Number.isFinite(maxCtc) ? maxCtc : Infinity,
    employeePct: Number(s.employeePct ?? 12),
    employerPct: Number(s.employerPct ?? 12),
    eeMode,
    erMode,
    eeFixedRs: eeFixedRs != null && Number.isFinite(eeFixedRs) ? eeFixedRs : null,
    erFixedRs: erFixedRs != null && Number.isFinite(erFixedRs) ? erFixedRs : null,
  };
}

function normalizeSlabList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeSlab).filter(Boolean);
}

/**
 * @returns {Promise<{ company: string, pfWageCeilingMonthly: number, pfFixedProrateWithLop: boolean, pfSlabsOld: object[], pfSlabsNew: object[] }>}
 */
async function loadPayrollCompanySettings(company) {
  if (!company) throw new Error('company is required');
  const db = await getDb(LOGIN_DB_NAME);
  const col = db.collection(COLLECTION);
  const doc = await col.findOne({ company: String(company).trim() });
  const base = {
    company: String(company).trim(),
    pfWageCeilingMonthly: 15000,
    /** Default true: fixed ₹ PF scales with paid/working days when there is LOP. Set false for full slab PF every month. */
    pfFixedProrateWithLop: true,
    pfSlabsOld: [],
    pfSlabsNew: [],
  };
  if (!doc) return base;
  return {
    ...base,
    pfWageCeilingMonthly:
      doc.pfWageCeilingMonthly != null && Number.isFinite(Number(doc.pfWageCeilingMonthly))
        ? Number(doc.pfWageCeilingMonthly)
        : base.pfWageCeilingMonthly,
    pfFixedProrateWithLop: doc.pfFixedProrateWithLop !== false,
    pfSlabsOld: normalizeSlabList(doc.pfSlabsOld),
    pfSlabsNew: normalizeSlabList(doc.pfSlabsNew),
  };
}

async function savePayrollCompanySettings(company, payload) {
  if (!company) throw new Error('company is required');
  const db = await getDb(LOGIN_DB_NAME);
  const col = db.collection(COLLECTION);
  const pfWageCeilingMonthly =
    payload?.pfWageCeilingMonthly != null ? Number(payload.pfWageCeilingMonthly) : 15000;
  const pfFixedProrateWithLop = payload?.pfFixedProrateWithLop !== false;
  const doc = {
    company: String(company).trim(),
    pfWageCeilingMonthly: Number.isFinite(pfWageCeilingMonthly) ? pfWageCeilingMonthly : 15000,
    pfFixedProrateWithLop,
    pfSlabsOld: normalizeSlabList(payload?.pfSlabsOld),
    pfSlabsNew: normalizeSlabList(payload?.pfSlabsNew),
    updatedAt: new Date(),
  };
  await col.updateOne({ company: doc.company }, { $set: doc }, { upsert: true });
  return loadPayrollCompanySettings(company);
}

function pickPfSlabForCtc({ annualCtc, slabs, selectedSlabId }) {
  const list = Array.isArray(slabs) ? slabs : [];
  if (selectedSlabId) {
    const found = list.find((s) => String(s.id) === String(selectedSlabId));
    if (found) return { slab: found, resolvedBy: 'manual' };
  }
  const ctc = Number(annualCtc || 0);
  const sorted = [...list].sort((a, b) => Number(a.minCtc) - Number(b.minCtc));
  for (const s of sorted) {
    const min = Number(s.minCtc);
    const max = Number.isFinite(Number(s.maxCtc)) ? Number(s.maxCtc) : Infinity;
    if (ctc >= min && ctc <= max) return { slab: s, resolvedBy: 'ctc' };
  }
  return { slab: sorted.length ? sorted[sorted.length - 1] : null, resolvedBy: 'fallback' };
}

module.exports = {
  loadPayrollCompanySettings,
  savePayrollCompanySettings,
  pickPfSlabForCtc,
  normalizeSlabList,
  makeId,
};
