const { getUsersCollection } = require('../../../../config/mongo');
const {
  normalizeEmpCode,
  getUtcMonthRange,
  getMachineAttendanceForRange,
  extractYyyyMmDdFromMachineDate,
  isMachinePresentRecord,
  pickBetterMachineReport,
} = require('../../utils/machineAttendanceQuery');
const { loadPayrollCompanySettings, pickPfSlabForCtc } = require('./payrollSettingsStore');
const { loadPayrollAttendanceAdjustment } = require('./payrollAttendanceAdjustmentStore');
const { decryptAnnualCtcStored } = require('../../../../utils/ctcEncryption');

/**
 * Enterprise payroll calculation engine (India) for the existing Mongo-first HRMS backend.
 * - Attendance bridge → LOP from absences + late/early minutes
 * - PF EE & PF ER on LOP-prorated gross (wage cap); both reduce net pay; ESIC / TDS as before
 * - TDS monthly deduction: currently disabled (not cut from net)
 * - Monthly gross = annual CTC ÷ 12; splits: Basic 50% of gross, HRA 20%, Food 10%, Special 20% (rounded; special absorbs remainder)
 *
 * Money is represented in INR rupees as Number for now (existing codebase style).
 * If you need paise-precision later, switch to integer paise everywhere.
 */
class SalaryCalculationService {
  constructor(opts = {}) {
    this.opts = {
      workdayMinutes: 8 * 60,
      lateGraceMinutes: 35, // after 09:35 late (aligns with attendanceController.js)
      shiftStartHm: '09:00',
      shiftEndHm: '18:00',
      pfRateEmployee: 0.12,
      pfRateEmployer: 0.12,
      pfWageCeilingEnabled: true,
      pfWageCeilingMonthly: 15000,
      esiRateEmployee: 0.0075,
      esiRateEmployer: 0.0325,
      esiEligibilityGrossMonthly: 21000,
      standardDeductionOld: 50000,
      standardDeductionNew: 50000,
      rounding: 'rupee', // rupee | none
      ...opts,
    };
  }

  hmToMinutes(hm) {
    if (!hm) return null;
    const [h, m] = String(hm).split(':').map((n) => Number(n));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  roundMoney(x) {
    if (this.opts.rounding === 'rupee') return Math.round(Number(x || 0));
    return Number(x || 0);
  }

  /**
   * Build monthly component plan from annual CTC (full month, before LOP factor).
   * Gross = CTC ÷ 12; Basic = gross ÷ 2; HRA = 20% gross; Food = 10% gross; Special = remainder to match gross.
   * Optional `rules.structurePreset === 'LEGACY_BALANCE_SPECIAL'` restores older CTC-% + HRA-on-basic behaviour.
   */
  buildMonthlyStructure({ annualCtc, rules }) {
    if (String(rules?.structurePreset || '').toUpperCase() === 'LEGACY_BALANCE_SPECIAL') {
      return this.buildMonthlyStructureLegacy({ annualCtc, rules });
    }

    const g = this.roundMoney(Number(annualCtc || 0) / 12);
    const basic = this.roundMoney(g / 2);
    const hra = this.roundMoney(g * 0.2);
    const food = this.roundMoney(g * 0.1);
    const special = this.roundMoney(g - basic - hra - food);

    const earnings = [
      { code: 'BASIC', name: 'Basic', amount: basic, taxable: true },
      { code: 'HRA', name: 'HRA', amount: hra, taxable: true },
      { code: 'FOOD', name: 'Food Allowance', amount: food, taxable: true },
      { code: 'SPECIAL', name: 'Special Allowance', amount: special, taxable: true },
    ];

    const grossMonthly = this.roundMoney(earnings.reduce((s, e) => s + Number(e.amount || 0), 0));
    return { ctcMonthly: g, earnings, grossMonthly };
  }

  /** @deprecated Use default gross-split; kept for `structurePreset: LEGACY_BALANCE_SPECIAL`. */
  buildMonthlyStructureLegacy({ annualCtc, rules }) {
    const ctcMonthly = annualCtc / 12;
    const basic = (ctcMonthly * (rules.basicPercentOfCtc ?? 50)) / 100;
    const hra = rules.hraPercentOfBasic != null ? (basic * rules.hraPercentOfBasic) / 100 : 0;

    const fixed = Array.isArray(rules.fixedEarnings) ? rules.fixedEarnings : [];
    const fixedTotal = fixed.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const special = ctcMonthly - (basic + hra + fixedTotal);

    const earnings = [
      { code: 'BASIC', name: 'Basic', amount: this.roundMoney(basic), taxable: true },
      ...(hra ? [{ code: 'HRA', name: 'HRA', amount: this.roundMoney(hra), taxable: true }] : []),
      ...fixed.map((c) => ({
        code: String(c.code || c.name || 'EARNING').toUpperCase().replace(/\s+/g, '_'),
        name: String(c.name || c.code || 'Earning'),
        amount: this.roundMoney(Number(c.amount || 0)),
        taxable: c.taxable !== false,
      })),
      {
        code: 'SPECIAL',
        name: 'Special Allowance',
        amount: this.roundMoney(special),
        taxable: true,
        isBalancing: true,
      },
    ];

    if (earnings.find((e) => e.code === 'SPECIAL').amount < 0) {
      const sp = earnings.find((e) => e.code === 'SPECIAL');
      const deficit = Math.abs(sp.amount);
      sp.amount = 0;
      for (let i = earnings.length - 2; i >= 0 && deficit > 0; i--) {
        if (earnings[i].code === 'BASIC' || earnings[i].code === 'HRA') continue;
        const reducible = Math.min(deficit, earnings[i].amount);
        earnings[i].amount -= reducible;
      }
    }

    const grossMonthly = earnings.reduce((s, e) => s + Number(e.amount || 0), 0);
    return { ctcMonthly: this.roundMoney(ctcMonthly), earnings, grossMonthly: this.roundMoney(grossMonthly) };
  }

  /**
   * Attendance from `machine_attendance_reports` (same DBs/collections as attendance overview).
   * Paid / LOP are based on scheduled working days excluding **Saturday and Sunday** (weekends not counted as leave/LOP).
   */
  async computeAttendanceLop({ company, employeeId, monthYear, empCodeFromProfile, machineReportsPreloaded }) {
    const [yyyy, mm] = String(monthYear).split('-').map((x) => Number(x));
    if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || mm < 1 || mm > 12) {
      throw new Error('Invalid monthYear. Expected "YYYY-MM".');
    }

    const daysInMonth = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();

    const yyyyMmDdUtc = (y, m, day) =>
      `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let empCode = normalizeEmpCode(empCodeFromProfile);
    if (!empCode) {
      const usersCol = await getUsersCollection(null, company);
      const emp = await usersCol.findOne(
        {
          company,
          $or: [{ employeeId }, { emp_code: employeeId }, { email: new RegExp(`^${String(employeeId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(@|$)`, 'i') }],
        },
        { projection: { emp_code: 1, employeeId: 1 } }
      );
      empCode = normalizeEmpCode(emp?.emp_code) || normalizeEmpCode(emp?.employeeId);
    }

    const range = getUtcMonthRange(monthYear);
    const machineByDate = new Map();

    if (empCode && range) {
      const machineReports = machineReportsPreloaded || (await getMachineAttendanceForRange(range));
      for (const r of machineReports) {
        if (normalizeEmpCode(r.emp_code) !== empCode) continue;
        const dateKey = extractYyyyMmDdFromMachineDate(r.date);
        if (!dateKey) continue;
        const existing = machineByDate.get(dateKey);
        machineByDate.set(dateKey, pickBetterMachineReport(existing, r));
      }
    }

    let workingDaysInMonth = 0;
    let weekendDaysInMonth = 0;
    let paidDaysOnWorkingDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(yyyy, mm - 1, day, 12, 0, 0, 0));
      const dow = d.getUTCDay(); // 0 Sun, 6 Sat
      if (dow === 0 || dow === 6) {
        weekendDaysInMonth += 1;
        continue;
      }
      workingDaysInMonth += 1;
      const dayStr = yyyyMmDdUtc(yyyy, mm, day);
      const r = machineByDate.get(dayStr);
      if (r && isMachinePresentRecord(r)) {
        paidDaysOnWorkingDays += 1;
      }
    }

    const lopDays = Math.max(0, workingDaysInMonth - paidDaysOnWorkingDays);

    return {
      monthYear,
      daysInMonth,
      weekendDaysInMonth,
      workingDaysInMonth,
      paidDays: paidDaysOnWorkingDays,
      lopDays: Number(lopDays.toFixed(3)),
      empCodeUsed: empCode || null,
      attendanceSource: 'machine_attendance_reports',
    };
  }

  computePf({
    /** PF wage base (monthly gross after LOP proration). Slab % / fixed apply on this (subject to PF wage ceiling). */
    pfWageMonthly,
    pfEnabled,
    pfWageCeilingOn,
    pfWageCeilingMonthly,
    employeeRate,
    employerRate,
    eeMode,
    erMode,
    eeFixedRs,
    erFixedRs,
    /** When true, fixed ₹ slab EE/ER are multiplied by LOP factor (paid/working days). Default false = full fixed amounts. */
    pfFixedProrateWithLop,
    /** Present/working-day factor (0–1), same as salary LOP factor */
    lopFactor,
  }) {
    if (!pfEnabled) return { employee: 0, employer: 0, wage: 0 };
    const ceilingOn = pfWageCeilingOn ?? this.opts.pfWageCeilingEnabled;
    const ceiling = Number(pfWageCeilingMonthly ?? this.opts.pfWageCeilingMonthly ?? 15000);
    const wage = ceilingOn ? Math.min(Number(pfWageMonthly || 0), ceiling) : Number(pfWageMonthly || 0);
    const er = employeeRate != null ? Number(employeeRate) : this.opts.pfRateEmployee;
    const or = employerRate != null ? Number(employerRate) : this.opts.pfRateEmployer;

    const useEeFixed =
      String(eeMode || 'percent').toLowerCase() === 'fixed' &&
      eeFixedRs != null &&
      Number.isFinite(Number(eeFixedRs)) &&
      Number(eeFixedRs) >= 0;
    const useErFixed =
      String(erMode || 'percent').toLowerCase() === 'fixed' &&
      erFixedRs != null &&
      Number.isFinite(Number(erFixedRs)) &&
      Number(erFixedRs) >= 0;

    const f = Math.max(0, Math.min(1, Number(lopFactor ?? 1)));
    const prorateFixed = pfFixedProrateWithLop !== false;
    const fixedMul = prorateFixed ? f : 1;

    // % PF: `wage` is from LOP-prorated gross. Fixed ₹: multiply by `fixedMul` only if company enabled pfFixedProrateWithLop.
    const employee = useEeFixed ? Number(eeFixedRs) * fixedMul : wage * er;
    const employer = useErFixed ? Number(erFixedRs) * fixedMul : wage * or;

    return {
      wage: this.roundMoney(wage),
      employee: this.roundMoney(employee),
      employer: this.roundMoney(employer),
    };
  }

  computeEsi({ grossMonthly, esiEnabled }) {
    if (!esiEnabled) return { eligible: false, employee: 0, employer: 0 };
    const gross = Number(grossMonthly || 0);
    const eligible = gross < Number(this.opts.esiEligibilityGrossMonthly || 21000);
    if (!eligible) return { eligible: false, employee: 0, employer: 0 };
    const employee = gross * this.opts.esiRateEmployee;
    const employer = gross * this.opts.esiRateEmployer;
    return { eligible: true, employee: this.roundMoney(employee), employer: this.roundMoney(employer) };
  }

  /**
   * FY slabs (India) – keep data-driven.
   * This is a baseline engine; add rebates/surcharge/cess as needed.
   */
  getTaxSlabs({ regime }) {
    const r = String(regime || 'NEW').toUpperCase();
    if (r === 'OLD') {
      return [
        { upTo: 250000, rate: 0.0 },
        { upTo: 500000, rate: 0.05 },
        { upTo: 1000000, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ];
    }
    // New regime (baseline). Update slabs per FY when needed.
    return [
      { upTo: 300000, rate: 0.0 },
      { upTo: 600000, rate: 0.05 },
      { upTo: 900000, rate: 0.1 },
      { upTo: 1200000, rate: 0.15 },
      { upTo: 1500000, rate: 0.2 },
      { upTo: Infinity, rate: 0.3 },
    ];
  }

  computeAnnualTax({ taxableAnnual, regime }) {
    const slabs = this.getTaxSlabs({ regime });
    let remaining = Math.max(0, Number(taxableAnnual || 0));
    let lower = 0;
    let tax = 0;
    for (const s of slabs) {
      const cap = s.upTo;
      const band = Math.max(0, Math.min(remaining, cap - lower));
      tax += band * s.rate;
      remaining -= band;
      lower = cap;
      if (remaining <= 0) break;
    }
    // Cess 4%
    tax = tax * 1.04;
    return this.roundMoney(tax);
  }

  computeTdsMonthly({ annualTax, monthsRemaining }) {
    const m = Math.max(1, Number(monthsRemaining || 12));
    return this.roundMoney(Number(annualTax || 0) / m);
  }

  async calculateEmployeePayroll({
    company,
    employeeId,
    monthYear,
    annualCtc,
    structureRules,
    payrollProfile,
    machineReportsPreloaded,
    payrollSettingsPreloaded,
  }) {
    const settings =
      payrollSettingsPreloaded ||
      (await loadPayrollCompanySettings(company).catch(() => ({
      pfWageCeilingMonthly: 15000,
        pfSlabsOld: [],
        pfSlabsNew: [],
      })));

    const pfRule = String(payrollProfile?.pfRule || 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW';
    const slabs = pfRule === 'OLD' ? settings.pfSlabsOld : settings.pfSlabsNew;
    const { slab: pfSlab, resolvedBy: pfSlabResolvedBy } = pickPfSlabForCtc({
      annualCtc,
      slabs,
      selectedSlabId: payrollProfile?.pfSlabId,
    });

    const employeePctDec = pfSlab ? Number(pfSlab.employeePct) / 100 : this.opts.pfRateEmployee;
    const employerPctDec = pfSlab ? Number(pfSlab.employerPct) / 100 : this.opts.pfRateEmployer;
    const eeMode = pfSlab && String(pfSlab.eeMode || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
    const erMode = pfSlab && String(pfSlab.erMode || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';

    const attendanceRaw = await this.computeAttendanceLop({
      company,
      employeeId,
      monthYear,
      empCodeFromProfile: payrollProfile?.emp_code,
      machineReportsPreloaded,
    });

    const adj = await loadPayrollAttendanceAdjustment(company, employeeId, monthYear);
    const delta = Number(adj?.deltaPaidDays || 0);
    const wdm = Math.max(0, Number(attendanceRaw.workingDaysInMonth || 0));
    const machinePaid = Math.max(0, Number(attendanceRaw.paidDays || 0));
    let paidDays = machinePaid + (Number.isFinite(delta) ? delta : 0);
    paidDays = Math.max(0, Math.min(wdm, paidDays));
    const lopAdj = Math.max(0, wdm - paidDays);
    const attendance = {
      ...attendanceRaw,
      paidDaysFromMachine: machinePaid,
      paidDaysAdjustment: Number.isFinite(delta) ? delta : 0,
      paidDays,
      lopDays: Number(lopAdj.toFixed(3)),
    };

    const structure = this.buildMonthlyStructure({
      annualCtc,
      rules: structureRules || { basicPercentOfCtc: 50, hraPercentOfBasic: 40, fixedEarnings: [] },
    });

    const { earnings } = structure;

    // LOP: prorate against scheduled working days in month (weekends excluded from denominator)
    const denom = Math.max(1, attendance.workingDaysInMonth || attendance.daysInMonth);
    const factor = Math.max(0, (denom - attendance.lopDays) / denom);
    const proratedEarnings = earnings.map((e) => ({ ...e, amount: this.roundMoney(Number(e.amount) * factor) }));
    const grossMonthly = proratedEarnings.reduce((s, e) => s + Number(e.amount || 0), 0);

    const pf = this.computePf({
      pfWageMonthly: grossMonthly,
      pfEnabled: payrollProfile?.pfEnabled !== false,
      pfWageCeilingOn: payrollProfile?.pfWageCeilingOn !== false,
      pfWageCeilingMonthly: settings.pfWageCeilingMonthly,
      employeeRate: employeePctDec,
      employerRate: employerPctDec,
      eeMode,
      erMode,
      eeFixedRs: pfSlab?.eeFixedRs,
      erFixedRs: pfSlab?.erFixedRs,
      pfFixedProrateWithLop: settings.pfFixedProrateWithLop !== false,
      lopFactor: factor,
    });

    const esi = this.computeEsi({
      grossMonthly,
      esiEnabled: payrollProfile?.esiEnabled !== false,
    });

    // Taxable income – baseline: gross * 12 - standard deduction - PF employee - investments (handled later)
    const regime = payrollProfile?.taxRegime || 'NEW';
    const standardDeduction =
      String(regime).toUpperCase() === 'OLD' ? this.opts.standardDeductionOld : this.opts.standardDeductionNew;
    const taxableAnnual = Math.max(0, grossMonthly * 12 - standardDeduction - pf.employee * 12);
    const annualTax = this.computeAnnualTax({ taxableAnnual, regime });
    // TDS not withheld for now (re-enable when payroll tax withholding is finalized).
    const tds = 0;

    const deductions = [
      ...(pf.employee ? [{ code: 'PF_EMP', name: 'PF (Employee)', amount: pf.employee }] : []),
      ...(pf.employer ? [{ code: 'PF_EMPR', name: 'PF (Employer)', amount: pf.employer }] : []),
      ...(esi.employee ? [{ code: 'ESI_EMP', name: 'ESIC (Employee)', amount: esi.employee }] : []),
    ];

    const deductionsTotal = deductions.reduce((s, d) => s + Number(d.amount || 0), 0);
    const netPay = this.roundMoney(grossMonthly - deductionsTotal);

    return {
      employeeId,
      monthYear,
      attendance,
      pfSlab: pfSlab
        ? {
            id: pfSlab.id,
            label: pfSlab.label || '',
            employeePct: pfSlab.employeePct,
            employerPct: pfSlab.employerPct,
            eeMode: pfSlab.eeMode,
            erMode: pfSlab.erMode,
            eeFixedRs: pfSlab.eeFixedRs,
            erFixedRs: pfSlab.erFixedRs,
            resolvedBy: pfSlabResolvedBy,
            rule: pfRule,
          }
        : null,
      earnings: proratedEarnings,
      deductions,
      employerContrib: [...(esi.employer ? [{ code: 'ESI_EMPR', name: 'ESI (Employer)', amount: esi.employer }] : [])],
      statutory: { pf, esi, tds, annualTax, taxableAnnual, regime },
      totals: {
        gross: this.roundMoney(grossMonthly),
        earningsTotal: this.roundMoney(grossMonthly),
        deductionsTotal: this.roundMoney(deductionsTotal),
        netPay,
      },
    };
  }

  async loadPayrollProfile({ company, employeeId }) {
    const usersCol = await getUsersCollection(null, company);
    const emp = await usersCol.findOne(
      { company, $or: [{ employeeId }, { email: new RegExp(`^${String(employeeId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(@|$)`, 'i') }] },
      {
        projection: {
          pan: 1,
          aadhar: 1,
          uan: 1,
          pfEnabled: 1,
          pfWageCeilingOn: 1,
          esiEnabled: 1,
          taxRegime: 1,
          annualCtc: 1,
          emp_code: 1,
          pfRule: 1,
          pfSlabId: 1,
        },
      }
    );
    if (!emp) return {};
    return {
      ...emp,
      annualCtc: decryptAnnualCtcStored(emp.annualCtc),
    };
  }
}

module.exports = { SalaryCalculationService };

