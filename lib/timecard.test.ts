import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeTimecardDays,
  summarizePayroll,
  type SocialInsuranceRow,
  type TimecardDailySummary,
  type TimecardEmployee,
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
