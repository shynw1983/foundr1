export const timecardPunchTypes = ["clock_in", "clock_out", "break_start", "break_end"] as const;

export type TimecardPunchType = typeof timecardPunchTypes[number];

export type TimecardPunch = {
  id: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  punchType: TimecardPunchType;
  punchedAt: string;
  source?: string | null;
  note?: string | null;
};

export type TimecardEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
  birthDate?: string | null;
  storeIds: string[];
  storePayrollSettings: TimecardStorePayrollSetting[];
};

export type TimecardStorePayrollSetting = {
  storeId: string;
  payrollEnabled: boolean;
  employmentType: "hourly" | "monthly";
  hourlyWage: number | null;
  monthlySalary: number | null;
  prescribedMonthlyWorkMinutes?: number | null;
  commuteAllowancePerWorkday: number;
  commuteAllowanceMonthlyCap: number | null;
  socialInsurancePrefecture?: string | null;
  applySocialInsurance?: boolean;
  socialInsuranceStandardMonthlyAmount?: number | null;
  socialInsuranceDeductionFrom?: string | null;
  applyEmploymentInsurance?: boolean;
  employmentInsuranceDeductionFrom?: string | null;
  applyIncomeTax?: boolean;
  incomeTaxCategory?: "none" | "kou" | "otsu";
  dependentCount?: number;
  applyResidentTax?: boolean;
  residentTaxYear?: number | null;
  residentTaxJuneAmount?: number | null;
  residentTaxMonthlyAmount?: number | null;
  validFrom: string;
  wageValidFrom: string;
  commuteValidFrom: string;
};

export type WithholdingTaxRow = {
  salaryMin: number;
  salaryMax: number | null;
  kouTaxes: number[];
  otsuTax: number | null;
  otsuRate: number | null;
};

export type SocialInsuranceRow = {
  prefecture: string;
  standardMonthlyAmount: number;
  healthHalfWithoutCare: number | null;
  healthHalfWithCare: number | null;
  childSupportHalf: number | null;
  pensionHalf: number | null;
};

export type EmploymentInsuranceRateRow = {
  businessType: string;
  employeeRate: number;
};

export type TimecardDailySummary = {
  key: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  workMinutes: number;
  nightMinutes: number;
  isOpen: boolean;
  isManualCorrection: boolean;
  alerts: string[];
  breakIntervals?: Array<{ start: string; end: string }>;
  punches?: Array<{
    id: string;
    punchType: TimecardPunchType;
    punchedAt: string;
    source: string | null;
    note: string | null;
  }>;
};

export type TimecardPayrollAllowanceItem = {
  ruleId: string;
  name: string;
  ruleType: "fixed_monthly" | "one_person_busy_hourly";
  storeId: string | null;
  workDate: string | null;
  minutes: number;
  amount: number;
  premiumAmount: number;
  note: string;
};

export type TimecardPayrollAllowanceRule = {
  id: string;
  name: string;
  ruleType: "fixed_monthly" | "one_person_busy_hourly";
  storeId: string | null;
  employeeId: string | null;
  amount: number;
  includeInPremiumBase: boolean;
  validFrom: string;
  validTo: string | null;
  isEnabled: boolean;
  windows: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
  }>;
};

export type TimecardPayrollRow = {
  employeeId: string;
  employeeName: string;
  storeNames: string[];
  employmentType: "hourly" | "monthly" | "mixed";
  hourlyWage: number | null;
  monthlySalary: number | null;
  workDays: number;
  punchCount: number;
  workMinutes: number;
  breakMinutes: number;
  nightMinutes: number;
  regularWorkMinutes: number;
  overtimeMinutes: number;
  regularPay: number;
  overtimePay: number;
  nightPremiumPay: number;
  allowancePay: number;
  allowancePremiumPay: number;
  basePay: number;
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  commuteAllowance: number;
  totalPay: number;
  allowanceItems: TimecardPayrollAllowanceItem[];
  alerts: string[];
};

export type TimecardPayrollTotals = {
  workDays: number;
  punchCount: number;
  workMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  laborCost: number;
  overtimePay: number;
  nightPremiumPay: number;
  allowancePay: number;
  allowancePremiumPay: number;
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  commuteAllowance: number;
  totalPay: number;
};

const jstTimeZone = "Asia/Tokyo";
const minuteMs = 60_000;
const overnightWindowMs = 36 * 60 * minuteMs;
const dailyLegalWorkMinutes = 8 * 60;
const overtimePremiumRate = 1.25;
const nightPremiumRate = 0.25;
const defaultEmploymentInsuranceBusinessType = "general";

export function isTimecardPunchType(value: string): value is TimecardPunchType {
  return (timecardPunchTypes as readonly string[]).includes(value);
}

export function getJstMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: jstTimeZone,
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

export function getJstDateLabel(date: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: jstTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date));
}

export function formatJstTime(date: Date | string | null | undefined) {
  if (!date) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: jstTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(date));
}

export function formatJstDateTime(date: Date | string | null | undefined) {
  if (!date) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: jstTimeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(date));
}

export function getJstMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const nowMonth = getJstMonthLabel();
  const [, yearText, monthText] = match ?? /^(\d{4})-(\d{2})$/.exec(nowMonth) ?? [];
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const startUtc = new Date(Date.UTC(year, monthIndex, 1, -9, 0, 0));
  const endUtc = new Date(Date.UTC(year, monthIndex + 1, 1, -9, 0, 0));
  return { month: `${yearText}-${monthText}`, startUtc, endUtc };
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / minuteMs));
}

function getNightMinutes(start: string, end: string) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 0;

  let total = 0;
  for (let time = startTime; time < endTime; time += minuteMs) {
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: jstTimeZone,
      hour: "2-digit",
      hour12: false
    }).format(new Date(time)));
    if (hour >= 22 || hour < 5) total += 1;
  }
  return total;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getEffectivePayrollSetting(employee: TimecardEmployee | undefined, storeId: string, workDate: string) {
  const settings = (employee?.storePayrollSettings ?? [])
    .filter((setting) => setting.storeId === storeId && setting.wageValidFrom <= workDate)
    .sort((a, b) => b.wageValidFrom.localeCompare(a.wageValidFrom));
  return settings[0] ?? employee?.storePayrollSettings.find((setting) => setting.storeId === storeId);
}

function getEffectiveCommuteSetting(employee: TimecardEmployee | undefined, storeId: string, workDate: string) {
  const settings = (employee?.storePayrollSettings ?? [])
    .filter((setting) => setting.storeId === storeId && setting.commuteValidFrom <= workDate)
    .sort((a, b) => b.commuteValidFrom.localeCompare(a.commuteValidFrom));
  return settings[0] ?? employee?.storePayrollSettings.find((setting) => setting.storeId === storeId);
}

function getWithholdingTax(amount: number, setting: TimecardStorePayrollSetting, taxRows: WithholdingTaxRow[]) {
  if (!setting.applyIncomeTax || setting.incomeTaxCategory === "none") return 0;
  const row = taxRows.find((taxRow) => amount >= taxRow.salaryMin && (taxRow.salaryMax === null || amount < taxRow.salaryMax));
  if (!row) return 0;
  if (setting.incomeTaxCategory === "otsu") {
    if (row.otsuTax !== null) return Math.max(0, Math.round(row.otsuTax));
    if (row.otsuRate !== null) return Math.max(0, Math.floor(amount * row.otsuRate));
    return 0;
  }
  const dependentCount = Math.max(0, Math.min(7, Math.round(Number(setting.dependentCount ?? 0) || 0)));
  return Math.max(0, Math.round(row.kouTaxes[dependentCount] ?? 0));
}

function isSameOrAfterMonth(month: string, date: string | null | undefined) {
  if (!date) return true;
  return month >= date.slice(0, 7);
}

function addYearsMinusOneDay(date: string, years: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year + years, month - 1, day));
  target.setUTCDate(target.getUTCDate() - 1);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
}

function timeTextToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function minutesSinceWorkDateStart(workDate: string, value: string) {
  const base = new Date(`${workDate}T00:00:00+09:00`).getTime();
  const target = new Date(value).getTime();
  if (!Number.isFinite(base) || !Number.isFinite(target)) return 0;
  return Math.round((target - base) / minuteMs);
}

function getDailyActiveMinutes(day: TimecardDailySummary) {
  if (!day.clockIn || !day.clockOut) return [] as number[];
  const start = minutesSinceWorkDateStart(day.workDate, day.clockIn);
  const end = minutesSinceWorkDateStart(day.workDate, day.clockOut);
  if (end <= start) return [] as number[];
  const breakMinutes = new Set<number>();
  for (const interval of day.breakIntervals ?? []) {
    const breakStart = minutesSinceWorkDateStart(day.workDate, interval.start);
    const breakEnd = minutesSinceWorkDateStart(day.workDate, interval.end);
    for (let minute = breakStart; minute < breakEnd; minute += 1) {
      breakMinutes.add(minute);
    }
  }
  const activeMinutes: number[] = [];
  for (let minute = start; minute < end; minute += 1) {
    if (!breakMinutes.has(minute)) activeMinutes.push(minute);
  }
  return activeMinutes;
}

function isNightMinute(minute: number) {
  const hour = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
  return hour >= 22 || hour < 5;
}

function getWeekdayIndex(workDate: string) {
  return new Date(`${workDate}T12:00:00+09:00`).getDay();
}

function isMinuteInWindow(minute: number, startTime: string, endTime: string) {
  const start = timeTextToMinutes(startTime);
  const endBase = timeTextToMinutes(endTime);
  const end = endBase <= start ? endBase + 1440 : endBase;
  return minute >= start && minute < end;
}

function formatAllowanceMinuteRange(minutes: number[]) {
  if (!minutes.length) return "";
  const first = minutes[0];
  const last = minutes[minutes.length - 1] + 1;
  const toTime = (minute: number) => {
    const normalized = ((minute % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
  };
  return `${toTime(first)}-${toTime(last)}`;
}

function getPrescribedMonthlyWorkMinutes(setting: TimecardStorePayrollSetting) {
  const minutes = Number(setting.prescribedMonthlyWorkMinutes ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function getPayrollHourlyBase(setting: TimecardStorePayrollSetting) {
  if (setting.employmentType === "monthly") {
    const prescribedMinutes = getPrescribedMonthlyWorkMinutes(setting);
    if (!prescribedMinutes) return 0;
    return (setting.monthlySalary ?? 0) / (prescribedMinutes / 60);
  }
  return setting.hourlyWage ?? 0;
}

function isCareInsuranceAge(month: string, birthDate?: string | null) {
  if (!birthDate) return false;
  const careStartMonth = addYearsMinusOneDay(birthDate, 40).slice(0, 7);
  const careEndMonth = addYearsMinusOneDay(birthDate, 65).slice(0, 7);
  return month >= careStartMonth && month < careEndMonth;
}

function getSocialInsuranceDeduction(
  employee: TimecardEmployee | undefined,
  setting: TimecardStorePayrollSetting,
  month: string,
  socialInsuranceRows: SocialInsuranceRow[]
) {
  if (!setting.applySocialInsurance || !isSameOrAfterMonth(month, setting.socialInsuranceDeductionFrom)) return { amount: 0, alerts: [] as string[] };
  const alerts: string[] = [];
  const standardMonthlyAmount = Math.round(Number(setting.socialInsuranceStandardMonthlyAmount ?? 0) || 0);
  const prefecture = String(setting.socialInsurancePrefecture ?? "").trim();
  if (!prefecture) alerts.push("社会保険所在地未設定");
  if (!standardMonthlyAmount) alerts.push("標準報酬月額未設定");
  if (!employee?.birthDate) alerts.push("生年月日未設定");
  if (!prefecture || !standardMonthlyAmount) return { amount: 0, alerts };
  const row = socialInsuranceRows.find((item) => item.prefecture === prefecture && item.standardMonthlyAmount === standardMonthlyAmount);
  if (!row) {
    alerts.push("社会保険料表未設定");
    return { amount: 0, alerts };
  }
  const healthHalf = isCareInsuranceAge(month, employee?.birthDate) ? row.healthHalfWithCare : row.healthHalfWithoutCare;
  const amount = Math.ceil((healthHalf ?? 0) + (row.pensionHalf ?? 0) + (row.childSupportHalf ?? 0));
  return { amount, alerts };
}

function getEmploymentInsuranceDeduction(setting: TimecardStorePayrollSetting, month: string, wageAmount: number, rateRows: EmploymentInsuranceRateRow[]) {
  if (!setting.applyEmploymentInsurance || !isSameOrAfterMonth(month, setting.employmentInsuranceDeductionFrom)) return 0;
  const rate = rateRows.find((row) => row.businessType === defaultEmploymentInsuranceBusinessType)?.employeeRate ?? 0;
  return Math.floor(Math.max(0, wageAmount) * rate);
}

function getResidentTaxDeduction(setting: TimecardStorePayrollSetting, month: string) {
  if (!setting.applyResidentTax) return 0;
  const taxYear = Math.round(Number(setting.residentTaxYear ?? 0) || 0);
  if (!taxYear) return 0;
  const targetMonth = Number(month.slice(5, 7));
  const targetYear = Number(month.slice(0, 4));
  if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) return 0;
  if (month < `${taxYear}-06` || month > `${taxYear + 1}-05`) return 0;
  if (targetYear === taxYear && targetMonth === 6) {
    return Math.max(0, Math.round(Number(setting.residentTaxJuneAmount ?? 0) || 0));
  }
  return Math.max(0, Math.round(Number(setting.residentTaxMonthlyAmount ?? 0) || 0));
}

export function summarizeTimecardDays(
  punches: TimecardPunch[],
  options: { workDateStart?: string; workDateEndExclusive?: string } = {}
) {
  const groups = new Map<string, TimecardPunch[]>();
  const punchesByEmployeeStore = new Map<string, TimecardPunch[]>();

  for (const punch of punches) {
    const key = `${punch.employeeId}:${punch.storeId}`;
    punchesByEmployeeStore.set(key, [...(punchesByEmployeeStore.get(key) ?? []), punch]);
  }

  for (const employeeStorePunches of punchesByEmployeeStore.values()) {
    const sortedPunches = [...employeeStorePunches].sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
    let activeWorkDate: string | null = null;
    let activeClockInAt: string | null = null;

    for (const punch of sortedPunches) {
      const punchDate = getJstDateLabel(punch.punchedAt);
      const punchTime = new Date(punch.punchedAt).getTime();
      const activeTime = activeClockInAt ? new Date(activeClockInAt).getTime() : null;
      const isWithinActiveWorkday = activeTime !== null && punchTime - activeTime <= overnightWindowMs;

      if (punch.punchType === "clock_in" || !activeWorkDate || !isWithinActiveWorkday) {
        activeWorkDate = punchDate;
      }
      if (punch.punchType === "clock_in") {
        activeClockInAt = punch.punchedAt;
      }

      const key = `${punch.employeeId}:${punch.storeId}:${activeWorkDate}`;
      groups.set(key, [...(groups.get(key) ?? []), punch]);
    }
  }

  const summaries: TimecardDailySummary[] = [];
  for (const [key, dayPunches] of groups.entries()) {
    const sortedPunches = [...dayPunches].sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
    const clockIns = sortedPunches.filter((punch) => punch.punchType === "clock_in");
    const clockOuts = sortedPunches.filter((punch) => punch.punchType === "clock_out");
    const firstClockIn = clockIns[0]?.punchedAt ?? null;
    const lastClockOut = clockOuts.at(-1)?.punchedAt ?? null;
    const employeeName = sortedPunches[0]?.employeeName ?? "";
    const storeName = sortedPunches[0]?.storeName ?? "";
    const [employeeId, storeId, workDate] = key.split(":");
    const alerts: string[] = [];

    if (options.workDateStart && workDate < options.workDateStart) continue;
    if (options.workDateEndExclusive && workDate >= options.workDateEndExclusive) continue;

    let breakMinutes = 0;
    let activeBreakStart: string | null = null;
    const breakIntervals: Array<{ start: string; end: string }> = [];
    for (const punch of sortedPunches) {
      if (punch.punchType === "break_start") activeBreakStart = punch.punchedAt;
      if (punch.punchType === "break_end" && activeBreakStart) {
        breakMinutes += minutesBetween(activeBreakStart, punch.punchedAt);
        breakIntervals.push({ start: activeBreakStart, end: punch.punchedAt });
        activeBreakStart = null;
      }
    }

    if (!firstClockIn) alerts.push("出勤なし");
    if (firstClockIn && !lastClockOut) alerts.push("退勤なし");
    if (activeBreakStart) alerts.push("休憩終了なし");

    const grossWorkMinutes = firstClockIn && lastClockOut ? minutesBetween(firstClockIn, lastClockOut) : 0;
    const workMinutes = Math.max(0, grossWorkMinutes - breakMinutes);
    const grossNightMinutes = firstClockIn && lastClockOut ? getNightMinutes(firstClockIn, lastClockOut) : 0;
    const breakNightMinutes = breakIntervals.reduce((sum, interval) => sum + getNightMinutes(interval.start, interval.end), 0);
    const nightMinutes = Math.max(0, grossNightMinutes - breakNightMinutes);
    const isManualCorrection = sortedPunches.some((punch) => punch.source === "manager_correction");

    summaries.push({
      key,
      employeeId,
      employeeName,
      storeId,
      storeName,
      workDate,
      clockIn: firstClockIn,
      clockOut: lastClockOut,
      breakMinutes,
      workMinutes,
      nightMinutes,
      isOpen: Boolean(firstClockIn && !lastClockOut),
      isManualCorrection,
      alerts,
      breakIntervals,
      punches: sortedPunches.map((punch) => ({
        id: punch.id,
        punchType: punch.punchType,
        punchedAt: punch.punchedAt,
        source: punch.source ?? null,
        note: punch.note ?? null
      }))
    });
  }

  return summaries.sort((a, b) => `${b.workDate}${b.employeeName}`.localeCompare(`${a.workDate}${a.employeeName}`));
}

export function summarizePayroll(
  employees: TimecardEmployee[],
  dailySummaries: TimecardDailySummary[],
  options: {
    month?: string;
    withholdingTaxRows?: WithholdingTaxRow[];
    socialInsuranceRows?: SocialInsuranceRow[];
    employmentInsuranceRateRows?: EmploymentInsuranceRateRow[];
    allowanceRules?: TimecardPayrollAllowanceRule[];
  } = {}
) {
  const payrollMonth = options.month ?? getJstMonthLabel();
  const withholdingTaxRows = options.withholdingTaxRows ?? [];
  const socialInsuranceRows = options.socialInsuranceRows ?? [];
  const employmentInsuranceRateRows = options.employmentInsuranceRateRows ?? [];
  const allowanceRules = (options.allowanceRules ?? []).filter((rule) => rule.isEnabled !== false);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const rowsByEmployee = new Map<string, TimecardPayrollRow>();
  const daysByEmployeeAndStore = new Map<string, TimecardDailySummary[]>();
  const activeMinutesByDay = new Map<string, number[]>();
  const employeeMinuteWorkOrderByDay = new Map<string, Map<number, number>>();
  const storeMinuteCoverageByDate = new Map<string, Map<number, Set<string>>>();

  for (const day of dailySummaries) {
    const activeMinutes = getDailyActiveMinutes(day);
    activeMinutesByDay.set(day.key, activeMinutes);
    const workOrder = new Map<number, number>();
    activeMinutes.forEach((minute, index) => workOrder.set(minute, index + 1));
    const employeeWorkOrderKey = `${day.employeeId}:${day.storeId}:${day.workDate}`;
    const employeeWorkOrder = employeeMinuteWorkOrderByDay.get(employeeWorkOrderKey) ?? new Map<number, number>();
    for (const [minute, order] of workOrder.entries()) employeeWorkOrder.set(minute, order);
    employeeMinuteWorkOrderByDay.set(employeeWorkOrderKey, employeeWorkOrder);
    const storeCoverageKey = `${day.storeId}:${day.workDate}`;
    const storeCoverage = storeMinuteCoverageByDate.get(storeCoverageKey) ?? new Map<number, Set<string>>();
    for (const minute of activeMinutes) {
      const employeesAtMinute = storeCoverage.get(minute) ?? new Set<string>();
      employeesAtMinute.add(day.employeeId);
      storeCoverage.set(minute, employeesAtMinute);
    }
    storeMinuteCoverageByDate.set(storeCoverageKey, storeCoverage);
  }

  for (const day of dailySummaries) {
    const employee = employeeById.get(day.employeeId);
    const storeSetting = getEffectivePayrollSetting(employee, day.storeId, day.workDate);

    const current = rowsByEmployee.get(day.employeeId) ?? {
      employeeId: day.employeeId,
      employeeName: day.employeeName,
      storeNames: [],
      employmentType: storeSetting?.employmentType ?? "hourly",
      hourlyWage: storeSetting?.employmentType === "hourly" ? storeSetting.hourlyWage : null,
      monthlySalary: storeSetting?.employmentType === "monthly" ? storeSetting.monthlySalary : null,
      workDays: 0,
      punchCount: 0,
      workMinutes: 0,
      breakMinutes: 0,
      nightMinutes: 0,
      regularWorkMinutes: 0,
      overtimeMinutes: 0,
      regularPay: 0,
      overtimePay: 0,
      nightPremiumPay: 0,
      allowancePay: 0,
      allowancePremiumPay: 0,
      basePay: 0,
      socialInsurance: 0,
      employmentInsurance: 0,
      incomeTax: 0,
      residentTax: 0,
      commuteAllowance: 0,
      totalPay: 0,
      allowanceItems: [],
      alerts: []
    };

    current.storeNames = uniqueStrings([...current.storeNames, day.storeName]);
    if (storeSetting?.payrollEnabled) {
      current.employmentType = current.employmentType === storeSetting.employmentType ? current.employmentType : "mixed";
      current.hourlyWage = current.employmentType === "hourly" ? storeSetting.hourlyWage : null;
      current.monthlySalary = current.employmentType === "monthly" ? storeSetting.monthlySalary : null;
    }
    current.workDays += day.workMinutes > 0 ? 1 : 0;
    current.punchCount += 1;
    current.workMinutes += day.workMinutes;
    current.breakMinutes += day.breakMinutes;
    current.nightMinutes += day.nightMinutes;
    const payrollAlerts = !employee
      ? ["従業員設定なし"]
      : !storeSetting
        ? ["給与設定なし"]
        : !storeSetting.payrollEnabled
          ? ["給与計算対象外"]
          : [];
    current.alerts = uniqueStrings([...current.alerts, ...day.alerts, ...payrollAlerts]);
    rowsByEmployee.set(day.employeeId, current);
    if (employee && storeSetting?.payrollEnabled) {
      const storeKey = `${day.employeeId}:${day.storeId}`;
      daysByEmployeeAndStore.set(storeKey, [...(daysByEmployeeAndStore.get(storeKey) ?? []), day]);
    }
  }

  const rows = Array.from(rowsByEmployee.values()).map((row) => {
    const employee = employeeById.get(row.employeeId);
    let regularWorkMinutes = 0;
    let overtimeMinutes = 0;
    let regularPay = 0;
    let overtimePay = 0;
    let nightPremiumPay = 0;
    let allowancePay = 0;
    let allowancePremiumPay = 0;
    const allowanceItems: TimecardPayrollAllowanceItem[] = [];
    let socialInsurance = 0;
    let employmentInsurance = 0;
    let incomeTax = 0;
    let residentTax = 0;
    let commuteAllowance = 0;
    for (const setting of employee?.storePayrollSettings ?? []) {
      if (!setting.payrollEnabled) continue;
      const storeDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectivePayrollSetting(employee, day.storeId, day.workDate) === setting);
      const commuteDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectiveCommuteSetting(employee, day.storeId, day.workDate) === setting);
      const workDays = storeDays.filter((day) => day.workMinutes > 0).length;
      const workMinutes = storeDays.reduce((sum, day) => sum + day.workMinutes, 0);
      const prescribedMonthlyWorkMinutes = getPrescribedMonthlyWorkMinutes(setting);
      const storeNightMinutes = storeDays.reduce((sum, day) => sum + day.nightMinutes, 0);
      const hourlyBase = getPayrollHourlyBase(setting);
      const overtimeMinutesByDay = new Map<string, Set<number>>();
      let monthlyWorkOrder = 0;
      for (const day of storeDays.slice().sort((a, b) => `${a.workDate}:${a.clockIn ?? ""}`.localeCompare(`${b.workDate}:${b.clockIn ?? ""}`))) {
        const overtimeMinuteSet = overtimeMinutesByDay.get(day.key) ?? new Set<number>();
        const activeMinutes = activeMinutesByDay.get(day.key) ?? [];
        const workOrder = employeeMinuteWorkOrderByDay.get(`${day.employeeId}:${day.storeId}:${day.workDate}`) ?? new Map<number, number>();
        for (const minute of activeMinutes) {
          monthlyWorkOrder += 1;
          if ((workOrder.get(minute) ?? 0) > dailyLegalWorkMinutes) overtimeMinuteSet.add(minute);
          if (prescribedMonthlyWorkMinutes !== null && monthlyWorkOrder > prescribedMonthlyWorkMinutes) overtimeMinuteSet.add(minute);
        }
        overtimeMinutesByDay.set(day.key, overtimeMinuteSet);
      }
      const storeOvertimeMinutes = Array.from(overtimeMinutesByDay.values()).reduce((sum, minutes) => sum + minutes.size, 0);
      const storeRegularMinutes = Math.max(0, workMinutes - storeOvertimeMinutes);
      const commuteWorkDays = commuteDays.filter((day) => day.workMinutes > 0).length;
      let storeTaxablePay = 0;
      let storeCommuteAllowance = 0;
      if (workDays > 0 || workMinutes > 0) {
        if (setting.employmentType === "monthly") {
          const storeOvertimePay = (storeOvertimeMinutes / 60) * hourlyBase * overtimePremiumRate;
          const storeNightPremiumPay = (storeNightMinutes / 60) * hourlyBase * nightPremiumRate;
          regularWorkMinutes += storeRegularMinutes;
          overtimeMinutes += storeOvertimeMinutes;
          const storeMonthlyPay = Math.ceil(setting.monthlySalary ?? 0);
          regularPay += storeMonthlyPay;
          overtimePay += storeOvertimePay;
          nightPremiumPay += storeNightPremiumPay;
          storeTaxablePay = Math.ceil(storeMonthlyPay + storeOvertimePay + storeNightPremiumPay);
        } else {
          const storeRegularPay = (storeRegularMinutes / 60) * hourlyBase;
          const storeOvertimePay = (storeOvertimeMinutes / 60) * hourlyBase * overtimePremiumRate;
          const storeNightPremiumPay = (storeNightMinutes / 60) * hourlyBase * nightPremiumRate;
          regularWorkMinutes += storeRegularMinutes;
          overtimeMinutes += storeOvertimeMinutes;
          regularPay += storeRegularPay;
          overtimePay += storeOvertimePay;
          nightPremiumPay += storeNightPremiumPay;
          storeTaxablePay = Math.ceil(storeRegularPay + storeOvertimePay + storeNightPremiumPay);
        }
      }
      const effectiveAllowanceRules = allowanceRules.filter((rule) => {
        if (rule.storeId !== null && rule.storeId !== setting.storeId) return false;
        if (rule.employeeId !== null && rule.employeeId !== row.employeeId) return false;
        return storeDays.some((day) => day.workDate >= rule.validFrom && (!rule.validTo || day.workDate <= rule.validTo));
      });
      for (const rule of effectiveAllowanceRules) {
        if (rule.ruleType === "fixed_monthly") {
          const hasEligibleWork = storeDays.some((day) => day.workMinutes > 0 && day.workDate >= rule.validFrom && (!rule.validTo || day.workDate <= rule.validTo));
          if (!hasEligibleWork) continue;
          const amount = Math.ceil(rule.amount);
          allowancePay += amount;
          storeTaxablePay += amount;
          allowanceItems.push({
            ruleId: rule.id,
            name: rule.name,
            ruleType: rule.ruleType,
            storeId: rule.storeId,
            workDate: null,
            minutes: 0,
            amount,
            premiumAmount: 0,
            note: "月額"
          });
          continue;
        }

        for (const day of storeDays) {
          if (day.workDate < rule.validFrom || (rule.validTo && day.workDate > rule.validTo)) continue;
          const weekday = getWeekdayIndex(day.workDate);
          const windows = rule.windows.filter((window) => window.weekday === weekday);
          if (!windows.length) continue;
          const activeMinutes = activeMinutesByDay.get(day.key) ?? [];
          const storeCoverage = storeMinuteCoverageByDate.get(`${day.storeId}:${day.workDate}`) ?? new Map<number, Set<string>>();
          for (const window of windows) {
            const eligibleMinutes = activeMinutes.filter((minute) => {
              if (!isMinuteInWindow(minute, window.startTime, window.endTime)) return false;
              const employeesAtMinute = storeCoverage.get(minute);
              return employeesAtMinute?.size === 1 && employeesAtMinute.has(day.employeeId);
            });
            if (!eligibleMinutes.length) continue;
            const amount = (eligibleMinutes.length / 60) * rule.amount;
            const overtimeMinuteSet = overtimeMinutesByDay.get(day.key) ?? new Set<number>();
            const overtimeMinutesForAllowance = eligibleMinutes.filter((minute) => overtimeMinuteSet.has(minute)).length;
            const nightMinutesForAllowance = eligibleMinutes.filter(isNightMinute).length;
            const premiumAmount = rule.includeInPremiumBase
              ? (overtimeMinutesForAllowance / 60) * rule.amount * (overtimePremiumRate - 1)
                + (nightMinutesForAllowance / 60) * rule.amount * nightPremiumRate
              : 0;
            allowancePay += amount;
            allowancePremiumPay += premiumAmount;
            storeTaxablePay += Math.ceil(amount + premiumAmount);
            allowanceItems.push({
              ruleId: rule.id,
              name: rule.name,
              ruleType: rule.ruleType,
              storeId: rule.storeId,
              workDate: day.workDate,
              minutes: eligibleMinutes.length,
              amount: Math.ceil(amount),
              premiumAmount: Math.ceil(premiumAmount),
              note: formatAllowanceMinuteRange(eligibleMinutes)
            });
          }
        }
      }
      if (commuteWorkDays > 0) {
        const uncappedCommuteAllowance = Math.ceil(commuteWorkDays * setting.commuteAllowancePerWorkday);
        storeCommuteAllowance = setting.commuteAllowanceMonthlyCap === null
          ? uncappedCommuteAllowance
          : Math.min(uncappedCommuteAllowance, Math.ceil(setting.commuteAllowanceMonthlyCap));
        commuteAllowance += storeCommuteAllowance;
      }
      const socialResult = getSocialInsuranceDeduction(employee, setting, payrollMonth, socialInsuranceRows);
      socialInsurance += socialResult.amount;
      row.alerts = uniqueStrings([...row.alerts, ...socialResult.alerts]);
      const employmentDeduction = getEmploymentInsuranceDeduction(setting, payrollMonth, storeTaxablePay + storeCommuteAllowance, employmentInsuranceRateRows);
      employmentInsurance += employmentDeduction;
      incomeTax += getWithholdingTax(Math.max(0, storeTaxablePay - socialResult.amount - employmentDeduction), setting, withholdingTaxRows);
      residentTax += getResidentTaxDeduction(setting, payrollMonth);
    }
    const basePay = Math.ceil(regularPay + overtimePay + nightPremiumPay);
    const roundedAllowancePay = Math.ceil(allowancePay);
    const roundedAllowancePremiumPay = Math.ceil(allowancePremiumPay);
    return {
      ...row,
      regularWorkMinutes,
      overtimeMinutes,
      regularPay,
      overtimePay,
      nightPremiumPay,
      allowancePay: roundedAllowancePay,
      allowancePremiumPay: roundedAllowancePremiumPay,
      basePay: basePay + roundedAllowancePay + roundedAllowancePremiumPay,
      socialInsurance,
      employmentInsurance,
      incomeTax,
      residentTax,
      commuteAllowance,
      allowanceItems,
      totalPay: basePay + roundedAllowancePay + roundedAllowancePremiumPay + commuteAllowance - socialInsurance - employmentInsurance - incomeTax - residentTax
    };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ja"));

  const totals = rows.reduce<TimecardPayrollTotals>((acc, row) => ({
    workDays: acc.workDays + row.workDays,
    punchCount: acc.punchCount + row.punchCount,
    workMinutes: acc.workMinutes + row.workMinutes,
    nightMinutes: acc.nightMinutes + row.nightMinutes,
    overtimeMinutes: acc.overtimeMinutes + row.overtimeMinutes,
    laborCost: acc.laborCost + row.basePay,
    overtimePay: acc.overtimePay + row.overtimePay,
    nightPremiumPay: acc.nightPremiumPay + row.nightPremiumPay,
    allowancePay: acc.allowancePay + row.allowancePay,
    allowancePremiumPay: acc.allowancePremiumPay + row.allowancePremiumPay,
    socialInsurance: acc.socialInsurance + row.socialInsurance,
    employmentInsurance: acc.employmentInsurance + row.employmentInsurance,
    incomeTax: acc.incomeTax + row.incomeTax,
    residentTax: acc.residentTax + row.residentTax,
    commuteAllowance: acc.commuteAllowance + row.commuteAllowance,
    totalPay: acc.totalPay + row.totalPay
  }), {
    workDays: 0,
    punchCount: 0,
    workMinutes: 0,
    nightMinutes: 0,
    overtimeMinutes: 0,
    laborCost: 0,
    overtimePay: 0,
    nightPremiumPay: 0,
    allowancePay: 0,
    allowancePremiumPay: 0,
    socialInsurance: 0,
    employmentInsurance: 0,
    incomeTax: 0,
    residentTax: 0,
    commuteAllowance: 0,
    totalPay: 0
  });

  return { rows, totals };
}

export function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const restMinutes = safeMinutes % 60;
  return `${hours}時間${String(restMinutes).padStart(2, "0")}分`;
}
