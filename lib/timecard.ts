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
  validFrom: string;
  wageValidFrom: string;
  commuteValidFrom: string;
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
  basePay: number;
  commuteAllowance: number;
  totalPay: number;
  alerts: string[];
};

export type TimecardPayrollTotals = {
  workDays: number;
  punchCount: number;
  workMinutes: number;
  nightMinutes: number;
  laborCost: number;
  commuteAllowance: number;
  totalPay: number;
};

const jstTimeZone = "Asia/Tokyo";
const minuteMs = 60_000;
const overnightWindowMs = 36 * 60 * minuteMs;

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
    for (const punch of sortedPunches) {
      if (punch.punchType === "break_start") activeBreakStart = punch.punchedAt;
      if (punch.punchType === "break_end" && activeBreakStart) {
        breakMinutes += minutesBetween(activeBreakStart, punch.punchedAt);
        activeBreakStart = null;
      }
    }

    if (!firstClockIn) alerts.push("出勤なし");
    if (firstClockIn && !lastClockOut) alerts.push("退勤なし");
    if (activeBreakStart) alerts.push("休憩終了なし");

    const grossWorkMinutes = firstClockIn && lastClockOut ? minutesBetween(firstClockIn, lastClockOut) : 0;
    const workMinutes = Math.max(0, grossWorkMinutes - breakMinutes);
    const nightMinutes = firstClockIn && lastClockOut ? getNightMinutes(firstClockIn, lastClockOut) : 0;
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

export function summarizePayroll(employees: TimecardEmployee[], dailySummaries: TimecardDailySummary[]) {
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
      basePay: 0,
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
    let basePay = 0;
    let commuteAllowance = 0;
    for (const setting of employee?.storePayrollSettings ?? []) {
      if (!setting.payrollEnabled) continue;
      const storeDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectivePayrollSetting(employee, day.storeId, day.workDate) === setting);
      const commuteDays = (daysByEmployeeAndStore.get(`${row.employeeId}:${setting.storeId}`) ?? [])
        .filter((day) => getEffectiveCommuteSetting(employee, day.storeId, day.workDate) === setting);
      const workDays = storeDays.filter((day) => day.workMinutes > 0).length;
      const workMinutes = storeDays.reduce((sum, day) => sum + day.workMinutes, 0);
      const commuteWorkDays = commuteDays.filter((day) => day.workMinutes > 0).length;
      if (workDays > 0 || workMinutes > 0) {
        basePay += setting.employmentType === "monthly"
          ? Math.ceil(setting.monthlySalary ?? 0)
          : Math.ceil((workMinutes / 60) * (setting.hourlyWage ?? 0));
      }
      if (commuteWorkDays === 0) continue;
      const uncappedCommuteAllowance = Math.ceil(commuteWorkDays * setting.commuteAllowancePerWorkday);
      commuteAllowance += setting.commuteAllowanceMonthlyCap === null
        ? uncappedCommuteAllowance
        : Math.min(uncappedCommuteAllowance, Math.ceil(setting.commuteAllowanceMonthlyCap));
    }
    return {
      ...row,
      basePay,
      commuteAllowance,
      totalPay: basePay + commuteAllowance
    };
  }).sort((a, b) => a.employeeName.localeCompare(b.employeeName, "ja"));

  const totals = rows.reduce<TimecardPayrollTotals>((acc, row) => ({
    workDays: acc.workDays + row.workDays,
    punchCount: acc.punchCount + row.punchCount,
    workMinutes: acc.workMinutes + row.workMinutes,
    nightMinutes: acc.nightMinutes + row.nightMinutes,
    laborCost: acc.laborCost + row.basePay,
    commuteAllowance: acc.commuteAllowance + row.commuteAllowance,
    totalPay: acc.totalPay + row.totalPay
  }), {
    workDays: 0,
    punchCount: 0,
    workMinutes: 0,
    nightMinutes: 0,
    laborCost: 0,
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
