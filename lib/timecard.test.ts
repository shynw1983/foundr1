import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeTimecardDays,
  summarizePayroll,
  type SocialInsuranceRow,
  type TimecardDailySummary,
  type TimecardEmployee,
  type TimecardPayrollAllowanceRule,
  type TimecardPunch,
  type TimecardStorePayrollSetting
} from "./timecard.ts";

const socialInsuranceRows: SocialInsuranceRow[] = [{
  prefecture: "福岡県",
  standardMonthlyAmount: 200000,
  healthHalfWithoutCare: 10110,
  healthHalfWithCare: 11730,
  childSupportHalf: 230,
  pensionHalf: 18300
}];

function setting(overrides: Partial<TimecardStorePayrollSetting> = {}): TimecardStorePayrollSetting {
  return {
    storeId: "store-1",
    payrollEnabled: true,
    employmentType: "hourly",
    hourlyWage: 1000,
    monthlySalary: null,
    commuteAllowancePerWorkday: 0,
    commuteAllowanceMonthlyCap: null,
    socialInsurancePrefecture: "福岡県",
    applySocialInsurance: true,
    socialInsuranceStandardMonthlyAmount: 200000,
    socialInsuranceDeductionFrom: "2025-11-01",
    socialInsuranceDeductionTiming: "next_month",
    applyResidentTax: true,
    residentTaxYear: 2026,
    residentTaxJuneAmount: 5000,
    residentTaxMonthlyAmount: 4500,
    validFrom: "1970-01-01",
    wageValidFrom: "1970-01-01",
    commuteValidFrom: "1970-01-01",
    ...overrides
  };
}

const workday: TimecardDailySummary = {
  key: "employee-1:store-1:2026-06-10",
  employeeId: "employee-1",
  employeeName: "テスト従業員",
  storeId: "store-1",
  storeName: "テスト店",
  workDate: "2026-06-10",
  clockIn: "2026-06-10T09:00:00+09:00",
  clockOut: "2026-06-10T17:00:00+09:00",
  breakMinutes: 0,
  workMinutes: 480,
  nightMinutes: 0,
  isOpen: false,
  isManualCorrection: false,
  alerts: []
};

function payrollFor(settings: TimecardStorePayrollSetting[], periodEndExclusive = "2026-07-01") {
  const employee: TimecardEmployee = {
    id: "employee-1",
    name: "テスト従業員",
    role: "staff",
    status: "active",
    birthDate: "1986-12-04",
    storeIds: ["store-1"],
    storePayrollSettings: settings
  };
  return summarizePayroll([employee], [workday], {
    month: "2026-06",
    periodEndExclusive,
    socialInsuranceRows
  }).rows[0];
}

test("manager corrections take priority over later staff app punches in the same work segment", () => {
  const punches: TimecardPunch[] = [
    {
      id: "manager-in",
      employeeId: "employee-1",
      employeeName: "テスト従業員",
      storeId: "store-1",
      storeName: "テスト店",
      punchType: "clock_in",
      punchedAt: "2026-07-09T02:30:00.000Z",
      source: "manager_correction"
    },
    {
      id: "manager-out",
      employeeId: "employee-1",
      employeeName: "テスト従業員",
      storeId: "store-1",
      storeName: "テスト店",
      punchType: "clock_out",
      punchedAt: "2026-07-09T09:00:00.000Z",
      source: "manager_correction"
    },
    {
      id: "staff-out-next-day",
      employeeId: "employee-1",
      employeeName: "テスト従業員",
      storeId: "store-1",
      storeName: "テスト店",
      punchType: "clock_out",
      punchedAt: "2026-07-10T02:31:00.000Z",
      source: "mobile"
    }
  ];

  const summary = summarizeTimecardDays(punches)[0];

  assert.equal(summary.clockIn, "2026-07-09T02:30:00.000Z");
  assert.equal(summary.clockOut, "2026-07-09T09:00:00.000Z");
  assert.equal(summary.workMinutes, 390);
  assert.equal(summary.isManualCorrection, true);
  assert.equal(summary.punches?.length, 3);
});

test("performance time window upgrades the guaranteed wage multiplier when Uber sales reach the threshold", () => {
  const employee: TimecardEmployee = {
    id: "employee-1",
    name: "テスト従業員",
    role: "staff",
    status: "active",
    storeIds: ["store-1"],
    storePayrollSettings: [setting({ applySocialInsurance: false, applyResidentTax: false })]
  };
  const eveningDay: TimecardDailySummary = {
    ...workday,
    key: "employee-1:store-1:2026-06-10-evening",
    clockIn: "2026-06-10T20:00:00+09:00",
    clockOut: "2026-06-10T22:00:00+09:00",
    workMinutes: 120
  };
  const rule: TimecardPayrollAllowanceRule = {
    id: "evening-rule",
    name: "20〜22時 高負荷枠",
    ruleType: "time_performance_multiplier",
    storeId: "store-1",
    employeeId: null,
    amount: 0,
    baseMultiplier: 1.25,
    triggerMultiplier: 1.5,
    salesThreshold: 50000,
    orderThreshold: 15,
    sourcePlatform: "uber_eats",
    tiers: [],
    includeInPremiumBase: true,
    validFrom: "2026-06-01",
    validTo: "2026-06-30",
    isEnabled: true,
    windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "20:00", endTime: "22:00" }))
  };
  const row = summarizePayroll([employee], [eveningDay], {
    month: "2026-06",
    allowanceRules: [rule],
    performanceOrders: [
      { storeId: "store-1", orderedAt: "2026-06-10T20:20:00+09:00", total: 28000, sourcePlatform: "uber_eats" },
      { storeId: "store-1", orderedAt: "2026-06-10T21:10:00+09:00", total: 22000, sourcePlatform: "uber_eats" }
    ]
  }).rows[0];

  assert.equal(row.regularPay, 2000);
  assert.equal(row.allowancePay, 1000);
  assert.equal(row.basePay, 3000);
  assert.match(row.allowanceItems[0].note, /1\.50倍/);

  const guaranteedRow = summarizePayroll([employee], [eveningDay], {
    month: "2026-06",
    allowanceRules: [rule],
    performanceOrders: [
      { storeId: "store-1", orderedAt: "2026-06-10T20:20:00+09:00", total: 10000, sourcePlatform: "uber_eats" }
    ]
  }).rows[0];
  assert.equal(guaranteedRow.allowancePay, 500);
  assert.match(guaranteedRow.allowanceItems[0].note, /1\.25倍/);
});

test("overnight performance tier pays the highest matching fixed allowance once per shift", () => {
  const employee: TimecardEmployee = {
    id: "employee-1",
    name: "テスト従業員",
    role: "staff",
    status: "active",
    storeIds: ["store-1"],
    storePayrollSettings: [setting({ applySocialInsurance: false, applyResidentTax: false })]
  };
  const overnightDay: TimecardDailySummary = {
    ...workday,
    key: "employee-1:store-1:2026-06-10-overnight",
    clockIn: "2026-06-11T00:00:00+09:00",
    clockOut: "2026-06-11T05:00:00+09:00",
    workMinutes: 300,
    nightMinutes: 300
  };
  const rule: TimecardPayrollAllowanceRule = {
    id: "night-rule",
    name: "深夜担当者手当",
    ruleType: "performance_tier_per_shift",
    storeId: "store-1",
    employeeId: null,
    amount: 0,
    baseMultiplier: null,
    triggerMultiplier: null,
    salesThreshold: null,
    orderThreshold: null,
    sourcePlatform: "uber_eats",
    tiers: [
      { salesThreshold: 25000, amount: 1000 },
      { salesThreshold: 30000, amount: 1500 },
      { salesThreshold: 40000, amount: 2000 }
    ],
    includeInPremiumBase: true,
    validFrom: "2026-06-01",
    validTo: "2026-06-30",
    isEnabled: true,
    windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "00:00", endTime: "05:00" }))
  };
  const row = summarizePayroll([employee], [overnightDay], {
    month: "2026-06",
    allowanceRules: [rule],
    performanceOrders: [
      { storeId: "store-1", orderedAt: "2026-06-11T01:00:00+09:00", total: 41000, sourcePlatform: "uber_eats" }
    ]
  }).rows[0];

  assert.equal(row.allowancePay, 2000);
  assert.equal(row.allowanceItems.length, 1);
  assert.match(row.allowanceItems[0].note, /Uber売上 ¥41,000/);
});

test("current and historical payroll settings deduct monthly charges only once", () => {
  const row = payrollFor([
    setting(),
    setting({
      validFrom: "2025-11-01",
      wageValidFrom: "2025-11-01",
      commuteValidFrom: "2025-11-01"
    })
  ]);

  assert.equal(row.socialInsurance, 28640);
  assert.equal(row.residentTax, 5000);
});

test("a future payroll setting does not replace the setting effective for the closing period", () => {
  const row = payrollFor([
    setting({
      validFrom: "2025-11-01",
      wageValidFrom: "2025-11-01",
      commuteValidFrom: "2025-11-01"
    }),
    setting({
      applySocialInsurance: false,
      applyResidentTax: false,
      validFrom: "2026-06-26",
      wageValidFrom: "2026-06-26",
      commuteValidFrom: "2026-06-26"
    })
  ], "2026-06-26");

  assert.equal(row.socialInsurance, 28640);
  assert.equal(row.residentTax, 5000);
});
