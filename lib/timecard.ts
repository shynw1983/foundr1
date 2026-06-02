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
  basePay: number;
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  commuteAllowance: number;
  totalPay: number;
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
  socialInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
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
      alerts
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
  } = {}
) {
  const payrollMonth = options.month ?? getJstMonthLabel();
  const withholdingTaxRows = options.withholdingTaxRows ?? [];
  const socialInsuranceRows = options.socialInsuranceRows ?? [];
  const employmentInsuranceRateRows = options.employmentInsuranceRateRows ?? [];
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const rowsByEmployee = new Map<string, TimecardPayrollRow>();
  const daysByEmployeeAndStore = new Map<string, TimecardDailySummary[]>();

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
      basePay: 0,
      socialInsurance: 0,
      employmentInsurance: 0,
      incomeTax: 0,
      commuteAllowance: 0,
      totalPay: 0,
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
    let socialInsurance = 0;
    let employmentInsurance = 0;
    let incomeTax = 0;
    let commuteAllowance = 0;
    for (const setting of employee?.storePayrollSettings ?? []) {
      if (!setting.payrollEnabled) continue;
      const storeDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectivePayrollSetting(employee, day.storeId, day.workDate) === setting);
      const commuteDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectiveCommuteSetting(employee, day.storeId, day.workDate) === setting);
      const workDays = storeDays.filter((day) => day.workMinutes > 0).length;
      const workMinutes = storeDays.reduce((sum, day) => sum + day.workMinutes, 0);
      const storeRegularMinutes = storeDays.reduce((sum, day) => sum + Math.min(day.workMinutes, dailyLegalWorkMinutes), 0);
      const storeOvertimeMinutes = storeDays.reduce((sum, day) => sum + Math.max(0, day.workMinutes - dailyLegalWorkMinutes), 0);
      const storeNightMinutes = storeDays.reduce((sum, day) => sum + day.nightMinutes, 0);
      const commuteWorkDays = commuteDays.filter((day) => day.workMinutes > 0).length;
      let storeTaxablePay = 0;
      let storeCommuteAllowance = 0;
      if (workDays > 0 || workMinutes > 0) {
        if (setting.employmentType === "monthly") {
          regularWorkMinutes += workMinutes;
          const storeMonthlyPay = Math.ceil(setting.monthlySalary ?? 0);
          regularPay += storeMonthlyPay;
          storeTaxablePay = storeMonthlyPay;
        } else {
          const storeRegularPay = (storeRegularMinutes / 60) * (setting.hourlyWage ?? 0);
          const storeOvertimePay = (storeOvertimeMinutes / 60) * (setting.hourlyWage ?? 0) * overtimePremiumRate;
          const storeNightPremiumPay = (storeNightMinutes / 60) * (setting.hourlyWage ?? 0) * nightPremiumRate;
          regularWorkMinutes += storeRegularMinutes;
          overtimeMinutes += storeOvertimeMinutes;
          regularPay += storeRegularPay;
          overtimePay += storeOvertimePay;
          nightPremiumPay += storeNightPremiumPay;
          storeTaxablePay = Math.ceil(storeRegularPay + storeOvertimePay + storeNightPremiumPay);
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
    }
    const basePay = Math.ceil(regularPay + overtimePay + nightPremiumPay);
    return {
      ...row,
      regularWorkMinutes,
      overtimeMinutes,
      regularPay,
      overtimePay,
      nightPremiumPay,
      basePay,
      socialInsurance,
      employmentInsurance,
      incomeTax,
      commuteAllowance,
      totalPay: basePay + commuteAllowance - socialInsurance - employmentInsurance - incomeTax
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
    socialInsurance: acc.socialInsurance + row.socialInsurance,
    employmentInsurance: acc.employmentInsurance + row.employmentInsurance,
    incomeTax: acc.incomeTax + row.incomeTax,
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
    socialInsurance: 0,
    employmentInsurance: 0,
    incomeTax: 0,
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
