const express = require('express');
const router = express.Router();
const { connectMongo, getUsersCollection } = require('../../../config/mongo');
const { requireCompany } = require('../utils/hrmsContext');
const { SalaryCalculationService } = require('../services/payroll/SalaryCalculationService');
const {
  loadPayrollCompanySettings,
  savePayrollCompanySettings,
} = require('../services/payroll/payrollSettingsStore');
const {
  loadPayrollAttendanceAdjustment,
  savePayrollAttendanceAdjustment,
} = require('../services/payroll/payrollAttendanceAdjustmentStore');
const { decryptAnnualCtcStored } = require('../../../utils/ctcEncryption');
const { getUtcMonthRange, getMachineAttendanceForRange } = require('../utils/machineAttendanceQuery');
const responseCache = require('../../../lib/responseCache');

const USER_PROJECTION = {
  name: 1,
  email: 1,
  employeeId: 1,
  department: 1,
  jobTitle: 1,
  payrollCompany: 1,
  annualCtc: 1,
  emp_code: 1,
  pfRule: 1,
  pfSlabId: 1,
  joiningDate: 1,
  bankAccount: 1,
  uan: 1,
  pfNo: 1,
  pan: 1,
};

function buildPayrollUserQuery(company, payrollCompany) {
  const query = { company, isActive: { $ne: false } };
  const pc = String(payrollCompany || '').trim();
  if (pc && pc !== 'all') {
    if (pc === 'Beacon IQ') {
      query.payrollCompany = { $in: ['Beacon IQ', 'BeaconIQ'] };
    } else {
      query.payrollCompany = pc;
    }
  }
  return query;
}

function structureRulesFromQuery(req) {
  return {
    basicPercentOfCtc:
      req.query.basicPercentOfCtc != null ? Number(req.query.basicPercentOfCtc) : 50,
    hraPercentOfBasic:
      req.query.hraPercentOfBasic != null ? Number(req.query.hraPercentOfBasic) : 40,
    fixedEarnings: [],
  };
}

function lastNMonthYears(count) {
  const n = Math.min(Math.max(Number(count) || 6, 1), 12);
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

async function buildEmployeesMonthRows({
  company,
  monthYear,
  users,
  structureRules,
  machineReportsPreloaded,
  payrollSettingsPreloaded,
}) {
  const svc = new SalaryCalculationService();
  const rows = [];
  for (const emp of users) {
    const employeeId = String(emp.employeeId || '').trim();
    if (!employeeId) {
      rows.push({
        mongoId: emp._id?.toString(),
        employeeId: null,
        name: emp.name || '',
        email: emp.email || '',
        ok: false,
        error: 'MISSING_EMPLOYEE_ID',
      });
      continue;
    }

    const annualCtc = decryptAnnualCtcStored(emp.annualCtc);
    if (annualCtc == null || !Number.isFinite(annualCtc) || annualCtc <= 0) {
      rows.push({
        mongoId: emp._id?.toString(),
        employeeId,
        name: emp.name || '',
        email: emp.email || '',
        department: emp.department || '',
        jobTitle: emp.jobTitle || '',
        annualCtc: null,
        ok: false,
        error: 'NO_CTC',
      });
      continue;
    }

    try {
      const profile = await svc.loadPayrollProfile({ company, employeeId });
      const payrollProfile = {
        ...profile,
        emp_code: emp.emp_code ?? profile.emp_code,
        pfRule: emp.pfRule ?? profile.pfRule,
        pfSlabId: emp.pfSlabId ?? profile.pfSlabId,
        annualCtc,
      };

      const result = await svc.calculateEmployeePayroll({
        company,
        employeeId,
        monthYear,
        annualCtc,
        structureRules,
        payrollProfile,
        machineReportsPreloaded,
        payrollSettingsPreloaded,
      });

      const pf = result.statutory?.pf || {};
      const esi = result.statutory?.esi || {};
      const earn = (code) => {
        const row = (result.earnings || []).find((e) => e.code === code);
        return row != null ? Number(row.amount || 0) : 0;
      };
      rows.push({
        mongoId: emp._id?.toString(),
        employeeId,
        name: emp.name || '',
        email: emp.email || '',
        department: emp.department || '',
        jobTitle: emp.jobTitle || '',
        payrollCompany: emp.payrollCompany || '',
        annualCtc,
        joiningDate: emp.joiningDate || null,
        bankAccount: emp.bankAccount || '',
        uan: emp.uan || '',
        pfNo: emp.pfNo || '',
        pan: emp.pan || '',
        ok: true,
        paidDays: result.attendance?.paidDays ?? null,
        paidDaysFromMachine: result.attendance?.paidDaysFromMachine ?? null,
        paidDaysAdjustment: result.attendance?.paidDaysAdjustment ?? 0,
        lopDays: result.attendance?.lopDays ?? null,
        workingDaysInMonth: result.attendance?.workingDaysInMonth ?? null,
        weekendDaysInMonth: result.attendance?.weekendDaysInMonth ?? null,
        daysInMonth: result.attendance?.daysInMonth ?? null,
        grossMonthly: result.totals?.gross ?? 0,
        totalEarning: result.totals?.gross ?? 0,
        totalDeduction: result.totals?.deductionsTotal ?? 0,
        netMonthly: result.totals?.netPay ?? 0,
        basicMonthly: earn('BASIC'),
        hraMonthly: earn('HRA'),
        foodMonthly: earn('FOOD'),
        specialMonthly: earn('SPECIAL'),
        esiEmployee: esi.employee ?? 0,
        pfEmployee: pf.employee ?? 0,
        pfEmployer: pf.employer ?? 0,
        pfSlab: result.pfSlab || null,
      });
    } catch (err) {
      rows.push({
        mongoId: emp._id?.toString(),
        employeeId,
        name: emp.name || '',
        ok: false,
        error: err?.message || 'CALC_ERROR',
      });
    }
  }
  return rows;
}

/**
 * Payroll APIs (mounted at /api/hrms).
 *
 * Wizard-style:
 * - Step 1: Sync Attendance (here: compute LOP snapshot)
 * - Step 2: Preview Adjustments (returns computed preview)
 * - Step 3: Finalize (maker) + Approve (checker)
 */

function parseMonthYear(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  return s;
}

router.get('/payroll/settings', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const data = await loadPayrollCompanySettings(company);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/settings GET] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/payroll/settings', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const data = await savePayrollCompanySettings(company, req.body || {});
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/settings PUT] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Preview payroll for one employee (calculation engine)
router.get('/payroll/preview', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = String(req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }

    const svc = new SalaryCalculationService();
    const profile = await svc.loadPayrollProfile({ company, employeeId });

    const annualCtc = Number(req.query.annualCtc || profile.annualCtc || 0);
    if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
      return res.status(400).json({ success: false, error: 'annualCtc is required (or store annualCtc on employee).' });
    }

    const structureRules = {
      basicPercentOfCtc: req.query.basicPercentOfCtc != null ? Number(req.query.basicPercentOfCtc) : 50,
      hraPercentOfBasic: req.query.hraPercentOfBasic != null ? Number(req.query.hraPercentOfBasic) : 40,
      fixedEarnings: [],
    };

    const result = await svc.calculateEmployeePayroll({
      company,
      employeeId,
      monthYear,
      annualCtc,
      structureRules,
      payrollProfile: profile,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[payroll/preview] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * All employees × one month: attendance from machine_attendance_reports + salary (LOP proration).
 */
router.get('/payroll/employees-month-overview', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const monthYear = parseMonthYear(req.query.monthYear);
    if (!monthYear) {
      return res.status(400).json({ success: false, error: 'monthYear (YYYY-MM) is required.' });
    }

    const payrollCompany = String(req.query.payrollCompany || '').trim();
    const cacheKey = `payroll:month:${company}:${monthYear}:${payrollCompany || 'all'}`;
    const ttlMs = Number(process.env.PAYROLL_CACHE_TTL_MS || 300000);

    const payload = responseCache.cacheEnabled()
      ? await responseCache.wrap(cacheKey, ttlMs, async () => {
          const usersCol = await getUsersCollection(null, company);
          const users = await usersCol.find(buildPayrollUserQuery(company, payrollCompany)).project(USER_PROJECTION).toArray();
          const structureRules = structureRulesFromQuery(req);
          const monthRange = getUtcMonthRange(monthYear);
          const machineReportsPreloaded = monthRange ? await getMachineAttendanceForRange(monthRange) : [];
          const payrollSettingsPreloaded = await loadPayrollCompanySettings(company).catch(() => ({
            pfWageCeilingMonthly: 15000,
            pfSlabsOld: [],
            pfSlabsNew: [],
          }));
          const rows = await buildEmployeesMonthRows({
            company,
            monthYear,
            users,
            structureRules,
            machineReportsPreloaded,
            payrollSettingsPreloaded,
          });
          return { monthYear, company, employees: rows };
        })
      : null;

    if (payload) {
      return res.json({ success: true, data: payload });
    }

    const usersCol = await getUsersCollection(null, company);
    const users = await usersCol.find(buildPayrollUserQuery(company, payrollCompany)).project(USER_PROJECTION).toArray();
    const structureRules = structureRulesFromQuery(req);
    const monthRange = getUtcMonthRange(monthYear);
    const machineReportsPreloaded = monthRange ? await getMachineAttendanceForRange(monthRange) : [];
    const payrollSettingsPreloaded = await loadPayrollCompanySettings(company).catch(() => ({
      pfWageCeilingMonthly: 15000,
      pfSlabsOld: [],
      pfSlabsNew: [],
    }));
    const rows = await buildEmployeesMonthRows({
      company,
      monthYear,
      users,
      structureRules,
      machineReportsPreloaded,
      payrollSettingsPreloaded,
    });
    return res.json({ success: true, data: { monthYear, company, employees: rows } });
  } catch (e) {
    console.error('[payroll/employees-month-overview] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Last N months in one request (charts tab) — cached, one HTTP call from frontend.
 */
router.get('/payroll/employees-multi-month-overview', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const payrollCompany = String(req.query.payrollCompany || '').trim();
    const monthCount = Math.min(Math.max(Number(req.query.monthCount) || 6, 1), 12);
    const months = lastNMonthYears(monthCount);
    const cacheKey = `payroll:multi:${company}:${months.join(',')}:${payrollCompany || 'all'}`;
    const ttlMs = Number(process.env.PAYROLL_CACHE_TTL_MS || 300000);

    const data = responseCache.cacheEnabled()
      ? await responseCache.wrap(cacheKey, ttlMs, async () => {
          const usersCol = await getUsersCollection(null, company);
          const users = await usersCol.find(buildPayrollUserQuery(company, payrollCompany)).project(USER_PROJECTION).toArray();
          const structureRules = structureRulesFromQuery(req);
          const payrollSettingsPreloaded = await loadPayrollCompanySettings(company).catch(() => ({
            pfWageCeilingMonthly: 15000,
            pfSlabsOld: [],
            pfSlabsNew: [],
          }));

          const monthPayloads = [];
          for (const monthYear of months) {
            const monthRange = getUtcMonthRange(monthYear);
            const machineReportsPreloaded = monthRange ? await getMachineAttendanceForRange(monthRange) : [];
            const employees = await buildEmployeesMonthRows({
              company,
              monthYear,
              users,
              structureRules,
              machineReportsPreloaded,
              payrollSettingsPreloaded,
            });
            monthPayloads.push({ monthYear, employees });
          }
          return { company, months: monthPayloads };
        })
      : null;

    if (data) {
      return res.json({ success: true, data });
    }

    const usersCol = await getUsersCollection(null, company);
    const users = await usersCol.find(buildPayrollUserQuery(company, payrollCompany)).project(USER_PROJECTION).toArray();
    const structureRules = structureRulesFromQuery(req);
    const payrollSettingsPreloaded = await loadPayrollCompanySettings(company).catch(() => ({
      pfWageCeilingMonthly: 15000,
      pfSlabsOld: [],
      pfSlabsNew: [],
    }));
    const monthPayloads = [];
    for (const monthYear of months) {
      const monthRange = getUtcMonthRange(monthYear);
      const machineReportsPreloaded = monthRange ? await getMachineAttendanceForRange(monthRange) : [];
      const employees = await buildEmployeesMonthRows({
        company,
        monthYear,
        users,
        structureRules,
        machineReportsPreloaded,
        payrollSettingsPreloaded,
      });
      monthPayloads.push({ monthYear, employees });
    }
    return res.json({ success: true, data: { company, months: monthPayloads } });
  } catch (e) {
    console.error('[payroll/employees-multi-month-overview] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET/PUT saved manual paid-day delta for a month (forgot punch / HR correction).
 */
router.get('/payroll/attendance-adjustment', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const employeeId = String(req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }
    const data = await loadPayrollAttendanceAdjustment(company, employeeId, monthYear);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/attendance-adjustment GET] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/payroll/attendance-adjustment', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const employeeId = String(req.body?.employeeId || req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.body?.monthYear || req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }
    const data = await savePayrollAttendanceAdjustment(company, employeeId, monthYear, req.body?.deltaPaidDays);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/attendance-adjustment PUT] error', e);
    return res
      .status(400)
      .json({ success: false, error: e?.message || 'Invalid request' });
  }
});

module.exports = router;

