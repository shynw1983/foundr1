import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import { writeAuditLog } from "../../../lib/audit-log";
import { getBusinessCalendarEvents, getBusinessCalendarMaintenanceStatus } from "../../../lib/business-calendar";
import { sql } from "../../../lib/db";
import { getStoreWeatherForecast } from "../../../lib/weather-forecast";
import type { EmployeeSession } from "../../../lib/auth";
import { normalizeBusinessHours, type StoreBusinessHours, type WeekdayKey } from "../../../lib/store-business-hours";
import {
  getJstDateLabel,
  getJstMonthLabel,
  isTimecardPunchType,
  summarizePayroll,
  summarizeTimecardDays,
  type EmploymentInsuranceRateRow,
  type SocialInsuranceRow,
  type TimecardEmployee,
  type TimecardPayrollAllowanceRule,
  type TimecardPunch,
  type WithholdingTaxRow
} from "../../../lib/timecard";

type TimecardPostBody = {
  action?: string;
  storeId?: string;
  month?: string;
  csvFileName?: string;
  csvBase64?: string;
  punchType?: string;
  note?: string;
  employeeId?: string;
  shiftId?: string | null;
  source?: string;
  mobileLatitude?: number | string;
  mobileLongitude?: number | string;
  mobileAccuracyMeters?: number | string;
  workDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  clockIn?: string;
  clockOut?: string;
  breakIntervals?: Array<{ start?: string; end?: string }>;
  breakMinutes?: number | string;
  shifts?: Array<{
    employeeId?: string;
    workDate?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    breakMinutes?: number | string;
    note?: string;
  }>;
};

type PayrollConfirmationRow = {
  id: string;
  storeId: string;
  payrollMonth: string;
  periodStart: string;
  periodEnd: string;
  confirmedAt: string;
  confirmedByName: string | null;
  payrollRows: unknown;
  payrollTotals: unknown;
};

const timecardActualEditRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const timecardPayrollViewRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const mobilePunchRoles = new Set(["staff"]);
const storeTerminalRole = "store_terminal";

const emptyPayrollTotals = {
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
};

function toMoneyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select
        stores.id::text,
        stores.name,
        coalesce(stores.address, '') as address,
        coalesce(stores.weather_location_name, '') as "weatherLocationName",
        coalesce(companies.legal_name, companies.name, '') as "companyLegalName",
        business_hours as "businessHours",
        coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
        coalesce(payroll_closing_day, 31)::int as "payrollClosingDay",
        coalesce(social_insurance_prefecture, '福岡県') as "socialInsurancePrefecture",
        coalesce(social_insurance_deduction_timing, 'next_month') as "socialInsuranceDeductionTiming",
        coalesce(attendance_location_enabled, false) as "attendanceLocationEnabled",
        attendance_latitude::float as "attendanceLatitude",
        attendance_longitude::float as "attendanceLongitude",
        weather_latitude::float as "weatherLatitude",
        weather_longitude::float as "weatherLongitude",
        coalesce(attendance_radius_meters, 100)::int as "attendanceRadiusMeters",
        coalesce(attendance_accuracy_threshold_meters, 100)::int as "attendanceAccuracyThresholdMeters"
      from stores
      left join companies on companies.id = stores.company_id
      where stores.status = 'active'
      order by stores.name
    `;
  }

  if (storeIds.length === 0) return [];

  return sql`
    select
      stores.id::text,
      stores.name,
      coalesce(stores.address, '') as address,
      coalesce(stores.weather_location_name, '') as "weatherLocationName",
      coalesce(companies.legal_name, companies.name, '') as "companyLegalName",
      business_hours as "businessHours",
      coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
      coalesce(payroll_closing_day, 31)::int as "payrollClosingDay",
      coalesce(social_insurance_prefecture, '福岡県') as "socialInsurancePrefecture",
      coalesce(social_insurance_deduction_timing, 'next_month') as "socialInsuranceDeductionTiming",
      coalesce(attendance_location_enabled, false) as "attendanceLocationEnabled",
      attendance_latitude::float as "attendanceLatitude",
      attendance_longitude::float as "attendanceLongitude",
      weather_latitude::float as "weatherLatitude",
      weather_longitude::float as "weatherLongitude",
      coalesce(attendance_radius_meters, 100)::int as "attendanceRadiusMeters",
      coalesce(attendance_accuracy_threshold_meters, 100)::int as "attendanceAccuracyThresholdMeters"
    from stores
    left join companies on companies.id = stores.company_id
    where stores.status = 'active'
      and stores.id::text = any(${storeIds})
    order by stores.name
  `;
}

async function getEmployeeWorkStoreIds(employeeId: string) {
  const rows = await sql`
    select employee_work_stores.store_id::text as "storeId"
    from employee_work_stores
    join stores on stores.id = employee_work_stores.store_id
    where employee_work_stores.employee_id = ${employeeId}
      and stores.status = 'active'
    order by stores.name
  `;
  return rows.map((row) => String(row.storeId));
}

async function getTimecardStoreScope(session: EmployeeSession) {
  if (session.role === "staff") {
    return { allStores: false, storeIds: await getEmployeeWorkStoreIds(session.id) };
  }

  return getSessionStoreScope(session);
}

async function getVisibleEmployees(allStores: boolean, storeIds: string[]) {
  const scopedStoreIds = allStores ? ["__all__"] : storeIds;
  if (!allStores && scopedStoreIds.length === 0) return [];

  const rows = await sql`
    select
      employees.id::text,
      employees.name,
      employees.role,
      employees.status,
      employees.birth_date as "birthDate",
      coalesce(
        array_agg(stores.id::text order by stores.name) filter (where stores.id is not null),
        '{}'::text[]
      ) as "storeIds",
      coalesce(
        json_agg(
          json_build_object(
            'storeId', payroll_settings.store_id::text,
            'payrollEnabled', payroll_settings.payroll_enabled,
            'employmentType', payroll_settings.employment_type,
            'hourlyWage', payroll_settings.hourly_wage,
            'monthlySalary', payroll_settings.monthly_salary,
            'prescribedMonthlyWorkMinutes', payroll_settings.prescribed_monthly_work_minutes,
            'commuteAllowancePerWorkday', payroll_settings.commute_allowance_per_workday,
            'commuteAllowanceMonthlyCap', payroll_settings.commute_allowance_monthly_cap,
            'socialInsurancePrefecture', stores.social_insurance_prefecture,
            'socialInsuranceDeductionTiming', coalesce(stores.social_insurance_deduction_timing, 'next_month'),
            'applySocialInsurance', payroll_settings.apply_social_insurance,
            'socialInsuranceStandardMonthlyAmount', payroll_settings.social_insurance_standard_monthly_amount,
            'socialInsuranceDeductionFrom', payroll_settings.social_insurance_deduction_from,
            'applyEmploymentInsurance', payroll_settings.apply_employment_insurance,
            'employmentInsuranceDeductionFrom', payroll_settings.employment_insurance_deduction_from,
            'applyIncomeTax', payroll_settings.apply_income_tax,
            'incomeTaxCategory', payroll_settings.income_tax_category,
            'dependentCount', payroll_settings.dependent_count,
            'applyResidentTax', payroll_settings.apply_resident_tax,
            'residentTaxYear', payroll_settings.resident_tax_year,
            'residentTaxJuneAmount', payroll_settings.resident_tax_june_amount,
            'residentTaxMonthlyAmount', payroll_settings.resident_tax_monthly_amount,
            'validFrom', payroll_settings.valid_from,
            'wageValidFrom', payroll_settings.wage_valid_from,
            'commuteValidFrom', payroll_settings.commute_valid_from
          )
          order by stores.name, payroll_settings.valid_from desc
        ) filter (where stores.id is not null and payroll_settings.store_id is not null),
        '[]'::json
      ) as "storePayrollSettings"
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    join stores on stores.id = employee_work_stores.store_id
    left join lateral (
      select
        employee_work_stores.store_id,
        employee_work_stores.payroll_enabled,
        employee_work_stores.employment_type,
        employee_work_stores.hourly_wage,
        employee_work_stores.monthly_salary,
        coalesce(employee_work_stores.prescribed_monthly_work_minutes, stores.prescribed_monthly_work_minutes) as prescribed_monthly_work_minutes,
        employee_work_stores.commute_allowance_per_workday,
        employee_work_stores.commute_allowance_monthly_cap,
        employee_work_stores.apply_social_insurance,
        employee_work_stores.social_insurance_standard_monthly_amount,
        employee_work_stores.social_insurance_deduction_from,
        employee_work_stores.apply_employment_insurance,
        employee_work_stores.employment_insurance_deduction_from,
        employee_work_stores.apply_income_tax,
        employee_work_stores.income_tax_category,
        employee_work_stores.dependent_count,
        employee_work_stores.apply_resident_tax,
        employee_work_stores.resident_tax_year,
        employee_work_stores.resident_tax_june_amount,
        employee_work_stores.resident_tax_monthly_amount,
        '1970-01-01'::date as valid_from,
        '1970-01-01'::date as wage_valid_from,
        '1970-01-01'::date as commute_valid_from
      union all
      select
        employee_work_store_payroll_history.store_id,
        employee_work_store_payroll_history.payroll_enabled,
        employee_work_store_payroll_history.employment_type,
        employee_work_store_payroll_history.hourly_wage,
        employee_work_store_payroll_history.monthly_salary,
        coalesce(employee_work_store_payroll_history.prescribed_monthly_work_minutes, stores.prescribed_monthly_work_minutes) as prescribed_monthly_work_minutes,
        employee_work_store_payroll_history.commute_allowance_per_workday,
        employee_work_store_payroll_history.commute_allowance_monthly_cap,
        employee_work_store_payroll_history.apply_social_insurance,
        employee_work_store_payroll_history.social_insurance_standard_monthly_amount,
        employee_work_store_payroll_history.social_insurance_deduction_from,
        employee_work_store_payroll_history.apply_employment_insurance,
        employee_work_store_payroll_history.employment_insurance_deduction_from,
        employee_work_store_payroll_history.apply_income_tax,
        employee_work_store_payroll_history.income_tax_category,
        employee_work_store_payroll_history.dependent_count,
        employee_work_store_payroll_history.apply_resident_tax,
        employee_work_store_payroll_history.resident_tax_year,
        employee_work_store_payroll_history.resident_tax_june_amount,
        employee_work_store_payroll_history.resident_tax_monthly_amount,
        employee_work_store_payroll_history.valid_from,
        employee_work_store_payroll_history.wage_valid_from,
        employee_work_store_payroll_history.commute_valid_from
      from employee_work_store_payroll_history
      where employee_work_store_payroll_history.employee_id = employee_work_stores.employee_id
        and employee_work_store_payroll_history.store_id = employee_work_stores.store_id
    ) payroll_settings on true
    where employees.status = 'active'
      and employees.staff_category <> 'device'
      and (
        ${allStores}
        or employee_work_stores.store_id::text = any(${scopedStoreIds})
      )
    group by employees.id
    order by employees.name
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    status: String(row.status),
    birthDate: row.birthDate ? String(row.birthDate).slice(0, 10) : null,
    storeIds: Array.isArray(row.storeIds) ? row.storeIds.map(String) : [],
    storePayrollSettings: (Array.isArray(row.storePayrollSettings) ? row.storePayrollSettings : []).map((setting) => ({
      storeId: String(setting.storeId),
      payrollEnabled: setting.payrollEnabled !== false,
      employmentType: setting.employmentType === "monthly" ? "monthly" : "hourly",
      hourlyWage: toMoneyNumber(setting.hourlyWage),
      monthlySalary: toMoneyNumber(setting.monthlySalary),
      prescribedMonthlyWorkMinutes: Number.isFinite(Number(setting.prescribedMonthlyWorkMinutes)) ? Math.round(Number(setting.prescribedMonthlyWorkMinutes)) : null,
      commuteAllowancePerWorkday: toMoneyNumber(setting.commuteAllowancePerWorkday) ?? 0,
      commuteAllowanceMonthlyCap: toMoneyNumber(setting.commuteAllowanceMonthlyCap),
      socialInsurancePrefecture: String(setting.socialInsurancePrefecture ?? "福岡県"),
      socialInsuranceDeductionTiming: setting.socialInsuranceDeductionTiming === "current_month" ? "current_month" : "next_month",
      applySocialInsurance: setting.applySocialInsurance === true,
      socialInsuranceStandardMonthlyAmount: toMoneyNumber(setting.socialInsuranceStandardMonthlyAmount),
      socialInsuranceDeductionFrom: setting.socialInsuranceDeductionFrom ? String(setting.socialInsuranceDeductionFrom).slice(0, 10) : null,
      applyEmploymentInsurance: setting.applyEmploymentInsurance === true,
      employmentInsuranceDeductionFrom: setting.employmentInsuranceDeductionFrom ? String(setting.employmentInsuranceDeductionFrom).slice(0, 10) : null,
      applyIncomeTax: setting.applyIncomeTax === true,
      incomeTaxCategory: setting.incomeTaxCategory === "kou" || setting.incomeTaxCategory === "otsu" ? setting.incomeTaxCategory : "none",
      dependentCount: Math.max(0, Math.min(7, Math.round(Number(setting.dependentCount ?? 0) || 0))),
      applyResidentTax: setting.applyResidentTax === true,
      residentTaxYear: Number.isFinite(Number(setting.residentTaxYear)) ? Math.round(Number(setting.residentTaxYear)) : null,
      residentTaxJuneAmount: toMoneyNumber(setting.residentTaxJuneAmount),
      residentTaxMonthlyAmount: toMoneyNumber(setting.residentTaxMonthlyAmount),
      validFrom: String(setting.validFrom ?? "1970-01-01").slice(0, 10),
      wageValidFrom: String(setting.wageValidFrom ?? setting.validFrom ?? "1970-01-01").slice(0, 10),
      commuteValidFrom: String(setting.commuteValidFrom ?? setting.validFrom ?? "1970-01-01").slice(0, 10)
    }))
  })) satisfies TimecardEmployee[];
}

async function getWithholdingTaxRowsForMonth(month: string) {
  const year = Number(month.slice(0, 4));
  if (!Number.isFinite(year)) return [] satisfies WithholdingTaxRow[];
  const rows = await sql`
    select
      withholding_tax_table_rows.salary_min as "salaryMin",
      withholding_tax_table_rows.salary_max as "salaryMax",
      withholding_tax_table_rows.kou_tax_0 as "kouTax0",
      withholding_tax_table_rows.kou_tax_1 as "kouTax1",
      withholding_tax_table_rows.kou_tax_2 as "kouTax2",
      withholding_tax_table_rows.kou_tax_3 as "kouTax3",
      withholding_tax_table_rows.kou_tax_4 as "kouTax4",
      withholding_tax_table_rows.kou_tax_5 as "kouTax5",
      withholding_tax_table_rows.kou_tax_6 as "kouTax6",
      withholding_tax_table_rows.kou_tax_7 as "kouTax7",
      withholding_tax_table_rows.otsu_tax as "otsuTax",
      withholding_tax_table_rows.otsu_rate as "otsuRate"
    from withholding_tax_tables
    join withholding_tax_table_rows
      on withholding_tax_table_rows.table_id = withholding_tax_tables.id
    where withholding_tax_tables.tax_year = ${year}
      and withholding_tax_tables.table_type = 'monthly'
      and withholding_tax_tables.is_active = true
    order by withholding_tax_table_rows.salary_min asc, withholding_tax_table_rows.sort_order asc
  `;
  return rows.map((row) => ({
    salaryMin: Number(row.salaryMin ?? 0),
    salaryMax: row.salaryMax === null ? null : Number(row.salaryMax),
    kouTaxes: [
      row.kouTax0, row.kouTax1, row.kouTax2, row.kouTax3,
      row.kouTax4, row.kouTax5, row.kouTax6, row.kouTax7
    ].map((value) => Number(value ?? 0)),
    otsuTax: row.otsuTax === null ? null : Number(row.otsuTax),
    otsuRate: row.otsuRate === null ? null : Number(row.otsuRate)
  })) satisfies WithholdingTaxRow[];
}

async function getSocialInsuranceRowsForMonth(month: string) {
  const rows = await sql`
    select
      social_insurance_table_rows.prefecture,
      social_insurance_table_rows.standard_monthly_amount as "standardMonthlyAmount",
      social_insurance_table_rows.health_half_without_care as "healthHalfWithoutCare",
      social_insurance_table_rows.health_half_with_care as "healthHalfWithCare",
      case
        when social_insurance_tables.child_support_effective_from <= ${`${month}-01`}::date
        then social_insurance_table_rows.child_support_half
        else null
      end as "childSupportHalf",
      social_insurance_table_rows.pension_half as "pensionHalf"
    from social_insurance_tables
    join social_insurance_table_rows
      on social_insurance_table_rows.table_id = social_insurance_tables.id
    where social_insurance_tables.effective_from <= ${`${month}-01`}::date
      and social_insurance_tables.is_active = true
    order by social_insurance_tables.effective_from desc, social_insurance_table_rows.sort_order asc
  `;
  return rows.map((row) => ({
    prefecture: String(row.prefecture),
    standardMonthlyAmount: Number(row.standardMonthlyAmount ?? 0),
    healthHalfWithoutCare: row.healthHalfWithoutCare === null ? null : Number(row.healthHalfWithoutCare),
    healthHalfWithCare: row.healthHalfWithCare === null ? null : Number(row.healthHalfWithCare),
    childSupportHalf: row.childSupportHalf === null ? null : Number(row.childSupportHalf),
    pensionHalf: row.pensionHalf === null ? null : Number(row.pensionHalf)
  })) satisfies SocialInsuranceRow[];
}

async function getEmploymentInsuranceRateRowsForMonth(month: string) {
  const rows = await sql`
    select
      employment_insurance_rate_rows.business_type as "businessType",
      employment_insurance_rate_rows.employee_rate as "employeeRate"
    from employment_insurance_rate_tables
    join employment_insurance_rate_rows
      on employment_insurance_rate_rows.table_id = employment_insurance_rate_tables.id
    where employment_insurance_rate_tables.effective_from <= ${`${month}-01`}::date
      and employment_insurance_rate_tables.effective_to >= ${`${month}-01`}::date
      and employment_insurance_rate_tables.is_active = true
    order by employment_insurance_rate_tables.effective_from desc, employment_insurance_rate_rows.sort_order asc
  `;
  return rows.map((row) => ({
    businessType: String(row.businessType),
    employeeRate: Number(row.employeeRate ?? 0)
  })) satisfies EmploymentInsuranceRateRow[];
}

async function getPayrollAllowanceRules(visibleStoreIds: string[]) {
  if (!visibleStoreIds.length) return [] satisfies TimecardPayrollAllowanceRule[];
  const rows = await sql`
    select
      payroll_allowance_rules.id::text,
      payroll_allowance_rules.name,
      payroll_allowance_rules.rule_type as "ruleType",
      payroll_allowance_rules.store_id::text as "storeId",
      payroll_allowance_rules.employee_id::text as "employeeId",
      payroll_allowance_rules.amount,
      payroll_allowance_rules.include_in_premium_base as "includeInPremiumBase",
      to_char(payroll_allowance_rules.valid_from, 'YYYY-MM-DD') as "validFrom",
      to_char(payroll_allowance_rules.valid_to, 'YYYY-MM-DD') as "validTo",
      payroll_allowance_rules.is_enabled as "isEnabled",
      coalesce(
        json_agg(
          json_build_object(
            'weekday', payroll_allowance_rule_windows.weekday,
            'startTime', to_char(payroll_allowance_rule_windows.start_time, 'HH24:MI'),
            'endTime', to_char(payroll_allowance_rule_windows.end_time, 'HH24:MI')
          )
          order by payroll_allowance_rule_windows.weekday, payroll_allowance_rule_windows.start_time
        ) filter (where payroll_allowance_rule_windows.id is not null),
        '[]'::json
      ) as windows
    from payroll_allowance_rules
    left join payroll_allowance_rule_windows on payroll_allowance_rule_windows.rule_id = payroll_allowance_rules.id
    where payroll_allowance_rules.is_enabled = true
      and (payroll_allowance_rules.store_id is null or payroll_allowance_rules.store_id::text = any(${visibleStoreIds}))
    group by payroll_allowance_rules.id
    order by payroll_allowance_rules.created_at desc
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    ruleType: row.ruleType === "fixed_monthly" ? "fixed_monthly" : "one_person_busy_hourly",
    storeId: row.storeId ? String(row.storeId) : null,
    employeeId: row.employeeId ? String(row.employeeId) : null,
    amount: Number(row.amount ?? 0),
    includeInPremiumBase: row.includeInPremiumBase !== false,
    validFrom: String(row.validFrom),
    validTo: row.validTo ? String(row.validTo) : null,
    isEnabled: row.isEnabled !== false,
    windows: Array.isArray(row.windows)
      ? row.windows.map((window) => ({
        weekday: Number(window.weekday ?? 0),
        startTime: String(window.startTime ?? "00:00"),
        endTime: String(window.endTime ?? "00:00")
      }))
      : []
  })) satisfies TimecardPayrollAllowanceRule[];
}

async function canPunchForEmployee(storeId: string, employeeId: string) {
  const rows = await sql`
    select
      employees.id::text
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    where employees.id = ${employeeId}
      and employees.status = 'active'
      and employees.staff_category <> 'device'
      and employee_work_stores.store_id::text = ${storeId}
    limit 1
  `;
  return Boolean(rows[0]);
}

async function getFinalWorkdayFarewell(storeId: string, employeeId: string) {
  const rows = await sql`
    select
      employees.name as "employeeName",
      stores.name as "storeName"
    from employee_work_stores
    join employees on employees.id = employee_work_stores.employee_id
    join stores on stores.id = employee_work_stores.store_id
    left join timecard_store_settings on timecard_store_settings.store_id = stores.id
    where employee_work_stores.employee_id = ${employeeId}
      and employee_work_stores.store_id = ${storeId}
      and employee_work_stores.resignation_date = (
        case
          when (now() at time zone 'Asia/Tokyo')::time < coalesce(timecard_store_settings.workday_change_time, '05:00'::time)
            then ((now() at time zone 'Asia/Tokyo') - interval '1 day')::date
          else (now() at time zone 'Asia/Tokyo')::date
        end
      )
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    employeeName: String(row.employeeName),
    storeName: String(row.storeName)
  };
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getPayrollDateRange(month: string, store?: { payrollCycleType?: unknown; payrollClosingDay?: unknown } | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const fallback = /^(\d{4})-(\d{2})$/.exec(getJstMonthLabel())!;
  const [, yearText, monthText] = match ?? fallback;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const cycleType = store?.payrollCycleType === "specified_day" ? "specified_day" : "month_end";
  const closingDay = Math.max(1, Math.min(30, Math.round(Number(store?.payrollClosingDay ?? 31) || 31)));

  if (cycleType === "specified_day") {
    const startValue = new Date(Date.UTC(year, monthIndex - 1, closingDay + 1));
    const endValue = new Date(Date.UTC(year, monthIndex, closingDay + 1));
    const startDate = formatDateKey(startValue);
    const endDate = formatDateKey(endValue);
    return {
      startDate,
      endDate,
      startUtc: new Date(`${startDate}T00:00:00+09:00`),
      endUtc: new Date(`${endDate}T00:00:00+09:00`)
    };
  }

  const startDate = `${yearText}-${monthText}-01`;
  const endValue = new Date(Date.UTC(year, monthIndex + 1, 1));
  const endDate = formatDateKey(endValue);
  return {
    startDate,
    endDate,
    startUtc: new Date(`${startDate}T00:00:00+09:00`),
    endUtc: new Date(`${endDate}T00:00:00+09:00`)
  };
}

async function getPayrollConfirmation(storeId: string, month: string) {
  const rows = await sql`
    select
      timecard_payroll_confirmations.id::text,
      timecard_payroll_confirmations.store_id::text as "storeId",
      timecard_payroll_confirmations.payroll_month as "payrollMonth",
      to_char(timecard_payroll_confirmations.period_start, 'YYYY-MM-DD') as "periodStart",
      to_char(timecard_payroll_confirmations.period_end, 'YYYY-MM-DD') as "periodEnd",
      timecard_payroll_confirmations.confirmed_at as "confirmedAt",
      employees.name as "confirmedByName",
      timecard_payroll_confirmations.payroll_rows as "payrollRows",
      timecard_payroll_confirmations.payroll_totals as "payrollTotals"
    from timecard_payroll_confirmations
    left join employees on employees.id = timecard_payroll_confirmations.confirmed_by
    where timecard_payroll_confirmations.store_id::text = ${storeId}
      and timecard_payroll_confirmations.payroll_month = ${month}
    limit 1
  `;
  const row = rows[0] as PayrollConfirmationRow | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    storeId: String(row.storeId),
    payrollMonth: String(row.payrollMonth),
    periodStart: String(row.periodStart),
    periodEnd: String(row.periodEnd),
    confirmedAt: new Date(String(row.confirmedAt)).toISOString(),
    confirmedByName: row.confirmedByName ? String(row.confirmedByName) : null,
    payrollRows: Array.isArray(row.payrollRows) ? row.payrollRows : [],
    payrollTotals: row.payrollTotals && typeof row.payrollTotals === "object" ? row.payrollTotals : emptyPayrollTotals
  };
}

function isValidWorkDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTimeValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function normalizeBreakIntervals(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((interval) => {
    if (!interval || typeof interval !== "object") return { start: null, end: null };
    const record = interval as { start?: unknown; end?: unknown };
    return {
      start: normalizeTimeValue(record.start),
      end: normalizeTimeValue(record.end)
    };
  });
}

function getJstWorkDateRange(workDate: string) {
  const start = new Date(`${workDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const overnightEnd = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return { start, end, overnightEnd };
}

function normalizeAttendanceName(value: string) {
  return value.trim().replaceAll("關", "関");
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function decodeAttendanceCsv(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  const encodings = ["utf-8", "shift_jis"] as const;
  for (const encoding of encodings) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      if (decoded.includes("勤務日") && decoded.includes("従業員名")) return decoded;
    } catch {
      // Try the next supported encoding.
    }
  }
  return new TextDecoder("shift_jis").decode(bytes).replace(/^\uFEFF/, "");
}

function normalizeCsvDate(value: string) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function parseCsvDateTime(value: string) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const time = `${match[4].padStart(2, "0")}:${match[5]}:${match[6] ?? "00"}`;
  const parsed = new Date(`${date}T${time}+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseAttendanceCsv(base64: string) {
  const text = decodeAttendanceCsv(base64);
  const [headerRow, ...dataRows] = parseCsvRows(text);
  if (!headerRow?.length) {
    throw new Error("CSVのヘッダーを読み取れませんでした。");
  }
  const headerIndex = new Map(headerRow.map((header, index) => [header.trim(), index]));
  const requiredHeaders = ["勤務日", "従業員名", "事業所名", "出勤時刻", "退勤時刻"];
  const missingHeaders = requiredHeaders.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length) {
    throw new Error(`CSVの列が不足しています: ${missingHeaders.join("、")}`);
  }

  const getValue = (row: string[], header: string) => row[headerIndex.get(header) ?? -1]?.trim() ?? "";
  const punchFields = [
    ["clock_in", "出勤時刻"],
    ["break_start", "休憩1開始時刻"],
    ["break_end", "休憩1復帰時刻"],
    ["break_start", "休憩2開始時刻"],
    ["break_end", "休憩2復帰時刻"],
    ["clock_out", "退勤時刻"]
  ] as const;

  const punches: Array<{
    employeeName: string;
    storeName: string;
    punchType: typeof punchFields[number][0];
    punchedAt: string;
    workDate: string;
    note: string;
  }> = [];
  const skippedRows: string[] = [];

  for (const [index, row] of dataRows.entries()) {
    const workDate = normalizeCsvDate(getValue(row, "勤務日"));
    const employeeName = normalizeAttendanceName(getValue(row, "従業員名"));
    const storeName = getValue(row, "事業所名");
    if (!workDate || !employeeName || !storeName) {
      skippedRows.push(`${index + 2}行目`);
      continue;
    }

    for (const [punchType, field] of punchFields) {
      const rawTime = getValue(row, field);
      if (!rawTime) continue;
      const punchedAt = parseCsvDateTime(rawTime);
      if (!punchedAt) {
        skippedRows.push(`${index + 2}行目 ${field}`);
        continue;
      }
      punches.push({
        employeeName,
        storeName,
        punchType,
        punchedAt,
        workDate,
        note: `CSV取込: ${workDate}`
      });
    }
  }

  return { punches, rowCount: dataRows.length, skippedRows };
}

function toPunchDateTime(workDate: string, time: string, baseTime?: string | null) {
  const date = new Date(`${workDate}T${time}:00+09:00`);
  if (baseTime && time <= baseTime) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

type ShiftWindowRow = {
  id: string;
  employeeId: string;
  employeeName?: string;
  storeId: string;
  storeName?: string;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  breakMinutes?: number;
  note?: string | null;
};

function getShiftWindowDateTime(workDate: string, time: string, baseTime?: string | null) {
  return new Date(toPunchDateTime(workDate, time, baseTime));
}

function moveDateTimeAtOrAfter(date: Date, earliest: Date) {
  const next = new Date(date);
  while (next.getTime() < earliest.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function timeValueToMinutes(value: string | null | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getWeekdayKeyForDate(dateString: string): WeekdayKey | null {
  const date = new Date(`${dateString}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[date.getDay()];
}

function getBusinessDayCloseMinutes(businessHours: StoreBusinessHours | null | undefined, workDate: string) {
  if (!businessHours) return null;
  const weekdayKey = getWeekdayKeyForDate(workDate);
  const day = weekdayKey ? businessHours[weekdayKey] : null;
  if (!day || day.closed) return null;
  const open = timeValueToMinutes(day.open);
  const close = timeValueToMinutes(day.close);
  if (open === null || close === null || close > open) return null;
  return close;
}

function isEarlyMorningBusinessDayShift(
  shift: { workDate: string; scheduledStart?: string | null; scheduledEnd?: string | null },
  businessHours?: StoreBusinessHours | null
) {
  const start = timeValueToMinutes(shift.scheduledStart);
  if (start === null) return false;
  const close = getBusinessDayCloseMinutes(businessHours, shift.workDate) ?? 6 * 60;
  return start < close;
}

function getScheduledShiftDateTime(
  shift: { workDate: string; scheduledStart?: string | null; scheduledEnd?: string | null },
  time: string,
  baseTime?: string | null,
  businessHours?: StoreBusinessHours | null
) {
  const date = getShiftWindowDateTime(shift.workDate, time, baseTime);
  if (isEarlyMorningBusinessDayShift(shift, businessHours)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function getActualInputDeleteWindow(
  workDate: string,
  input: {
    clockIn?: string | null;
    clockOut?: string | null;
    breakIntervals?: Array<{ start: string | null; end: string | null }>;
  }
) {
  const timestamps: number[] = [];
  if (input.clockIn) {
    timestamps.push(getShiftWindowDateTime(workDate, input.clockIn).getTime());
  }
  if (input.clockOut) {
    timestamps.push(getShiftWindowDateTime(workDate, input.clockOut, input.clockIn).getTime());
  }
  for (const interval of input.breakIntervals ?? []) {
    if (interval.start) {
      const breakStart = getShiftWindowDateTime(workDate, interval.start, input.clockIn);
      timestamps.push(breakStart.getTime());
      if (interval.end) {
        timestamps.push(
          moveDateTimeAtOrAfter(
            getShiftWindowDateTime(workDate, interval.end, input.clockIn),
            breakStart
          ).getTime()
        );
      }
      continue;
    }
    if (interval.end) {
      timestamps.push(getShiftWindowDateTime(workDate, interval.end, input.clockIn).getTime());
    }
  }
  const validTimestamps = timestamps.filter(Number.isFinite);
  if (!validTimestamps.length) return null;
  const marginMs = 3 * 60 * 60 * 1000;
  const singlePunchRangeMs = 18 * 60 * 60 * 1000;
  const minTime = Math.min(...validTimestamps);
  const maxTime = Math.max(...validTimestamps);
  const start = new Date(minTime - (validTimestamps.length === 1 && !input.clockIn ? singlePunchRangeMs : marginMs));
  const end = new Date(maxTime + (validTimestamps.length === 1 && input.clockIn ? singlePunchRangeMs : marginMs));
  return { start, end };
}

function buildClockInWorkDateMap(punches: TimecardPunch[], shifts: ShiftWindowRow[], storeBusinessHours?: StoreBusinessHours | null) {
  const map = new Map<string, string>();
  const candidateShifts = shifts.filter((shift) => shift.scheduledStart && shift.scheduledEnd);
  for (const punch of punches) {
    if (punch.punchType !== "clock_in") continue;
    const punchTime = new Date(punch.punchedAt).getTime();
    if (!Number.isFinite(punchTime)) continue;
    let best: { workDate: string; distance: number } | null = null;
    for (const shift of candidateShifts) {
      if (shift.employeeId !== punch.employeeId || shift.storeId !== punch.storeId || !shift.scheduledStart || !shift.scheduledEnd) continue;
      const scheduledStart = getScheduledShiftDateTime(shift, shift.scheduledStart, null, storeBusinessHours).getTime();
      const scheduledEnd = getScheduledShiftDateTime(shift, shift.scheduledEnd, shift.scheduledStart, storeBusinessHours).getTime();
      const earlyStart = scheduledStart - 6 * 60 * 60 * 1000;
      const lateEnd = scheduledEnd + 6 * 60 * 60 * 1000;
      if (punchTime < earlyStart || punchTime > lateEnd) continue;
      const distance = Math.abs(punchTime - scheduledStart);
      if (!best || distance < best.distance) best = { workDate: shift.workDate, distance };
    }
    if (best) map.set(punch.id, best.workDate);
  }
  return map;
}

async function getShiftById(shiftId: string, storeId: string, employeeId: string, workDate: string) {
  if (!shiftId) return null;
  const rows = await sql`
    select
      id::text,
      employee_id::text as "employeeId",
      store_id::text as "storeId",
      to_char(work_date, 'YYYY-MM-DD') as "workDate",
      to_char(scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(scheduled_end, 'HH24:MI') as "scheduledEnd"
    from timecard_shifts
    where id::text = ${shiftId}
      and store_id::text = ${storeId}
      and employee_id::text = ${employeeId}
      and work_date = ${workDate}::date
    limit 1
  `;
  const row = rows[0];
  if (!row?.scheduledStart || !row.scheduledEnd) return null;
  return {
    id: String(row.id),
    employeeId: String(row.employeeId),
    storeId: String(row.storeId),
    workDate: String(row.workDate),
    scheduledStart: String(row.scheduledStart),
    scheduledEnd: String(row.scheduledEnd)
  };
}

async function getShiftForActualEdit(storeId: string, employeeId: string, workDate: string, clockIn?: string | null, storeBusinessHours?: StoreBusinessHours | null) {
  const rows = await sql`
    select
      id::text,
      employee_id::text as "employeeId",
      store_id::text as "storeId",
      to_char(work_date, 'YYYY-MM-DD') as "workDate",
      to_char(scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(scheduled_end, 'HH24:MI') as "scheduledEnd"
    from timecard_shifts
    where store_id::text = ${storeId}
      and employee_id::text = ${employeeId}
      and work_date = ${workDate}::date
      and scheduled_start is not null
      and scheduled_end is not null
    order by scheduled_start asc, scheduled_end asc, id asc
  `;
  const shifts = rows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employeeId),
    storeId: String(row.storeId),
    workDate: String(row.workDate),
    scheduledStart: String(row.scheduledStart),
    scheduledEnd: String(row.scheduledEnd)
  }));
  if (!shifts.length) return null;
  if (!clockIn || shifts.length === 1) return shifts[0];
  return shifts
    .map((shift) => ({
      shift,
      distance: Math.abs(
        getScheduledShiftDateTime(shift, shift.scheduledStart, null, storeBusinessHours).getTime()
        - new Date(resolveActualPunchDateTime(workDate, clockIn, { shift, storeBusinessHours })).getTime()
      )
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.shift ?? shifts[0];
}

function resolveActualPunchDateTime(workDate: string, time: string, options: { baseTime?: string | null; shift?: Awaited<ReturnType<typeof getShiftById>>; storeBusinessHours?: StoreBusinessHours | null }) {
  const baseIso = toPunchDateTime(workDate, time, options.baseTime);
  if (!options.shift?.scheduledStart || !options.shift.scheduledEnd) return baseIso;
  const scheduledStart = getScheduledShiftDateTime(options.shift, options.shift.scheduledStart, null, options.storeBusinessHours).getTime();
  const scheduledEnd = getScheduledShiftDateTime(options.shift, options.shift.scheduledEnd, options.shift.scheduledStart, options.storeBusinessHours).getTime();
  const candidates = [-1, 0, 1].map((dayOffset) => {
    const date = new Date(baseIso);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    const value = date.getTime();
    const insidePenalty = value >= scheduledStart - 6 * 60 * 60 * 1000 && value <= scheduledEnd + 6 * 60 * 60 * 1000 ? 0 : 10_000_000_000;
    return { iso: date.toISOString(), score: Math.abs(value - scheduledStart) + insidePenalty };
  });
  return candidates.sort((a, b) => a.score - b.score)[0]?.iso ?? baseIso;
}

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getDistanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const halfChord = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
}

async function getAttendanceStoreLocation(storeId: string) {
  const rows = await sql`
    select
      id::text,
      coalesce(attendance_location_enabled, false) as "attendanceLocationEnabled",
      attendance_latitude::float as "attendanceLatitude",
      attendance_longitude::float as "attendanceLongitude",
      coalesce(attendance_radius_meters, 100)::int as "attendanceRadiusMeters",
      coalesce(attendance_accuracy_threshold_meters, 100)::int as "attendanceAccuracyThresholdMeters"
    from stores
    where id::text = ${storeId}
      and status = 'active'
    limit 1
  `;
  return rows[0] ?? null;
}

async function validateMobilePunchLocation(storeId: string, body: TimecardPostBody, options: { enforce: boolean }) {
  const store = await getAttendanceStoreLocation(storeId);
  if (!store) {
    return { ok: false, status: 404, error: "店舗が見つかりません。" };
  }

  const locationEnabled = store.attendanceLocationEnabled === true;
  const storeLatitude = normalizeNumber(store.attendanceLatitude);
  const storeLongitude = normalizeNumber(store.attendanceLongitude);
  const mobileLatitude = normalizeNumber(body.mobileLatitude);
  const mobileLongitude = normalizeNumber(body.mobileLongitude);
  const mobileAccuracyMeters = normalizeNumber(body.mobileAccuracyMeters);
  const radiusMeters = Math.max(10, Math.min(2000, Math.round(Number(store.attendanceRadiusMeters ?? 100) || 100)));
  const accuracyThresholdMeters = Math.max(10, Math.min(2000, Math.round(Number(store.attendanceAccuracyThresholdMeters ?? 100) || 100)));

  if (!locationEnabled) {
    return {
      ok: true,
      verdict: "not_required",
      mobileLatitude,
      mobileLongitude,
      mobileAccuracyMeters,
      storeLatitude,
      storeLongitude,
      distanceMeters: null
    };
  }

  if (storeLatitude === null || storeLongitude === null) {
    return { ok: false, status: 409, error: "この店舗の打刻地点が未設定です。管理画面で設定してください。" };
  }

  if (mobileLatitude === null || mobileLongitude === null) {
    if (!options.enforce) {
      return {
        ok: true,
        verdict: "not_available",
        mobileLatitude,
        mobileLongitude,
        mobileAccuracyMeters,
        storeLatitude,
        storeLongitude,
        distanceMeters: null
      };
    }
    return { ok: false, status: 400, error: "位置情報を取得してから打刻してください。" };
  }

  const distanceMeters = getDistanceMeters(
    { latitude: mobileLatitude, longitude: mobileLongitude },
    { latitude: storeLatitude, longitude: storeLongitude }
  );
  if (mobileAccuracyMeters !== null && mobileAccuracyMeters > accuracyThresholdMeters) {
    if (!options.enforce) {
      return {
        ok: true,
        verdict: "low_accuracy",
        mobileLatitude,
        mobileLongitude,
        mobileAccuracyMeters,
        storeLatitude,
        storeLongitude,
        distanceMeters
      };
    }
    return {
      ok: false,
      status: 409,
      error: `位置情報の精度が低いため打刻できません。精度 ${Math.round(mobileAccuracyMeters)}m / 上限 ${accuracyThresholdMeters}m`,
      verdict: "low_accuracy",
      mobileLatitude,
      mobileLongitude,
      mobileAccuracyMeters,
      storeLatitude,
      storeLongitude,
      distanceMeters
    };
  }

  if (distanceMeters > radiusMeters) {
    if (!options.enforce) {
      return {
        ok: true,
        verdict: "outside_radius",
        mobileLatitude,
        mobileLongitude,
        mobileAccuracyMeters,
        storeLatitude,
        storeLongitude,
        distanceMeters
      };
    }
    return {
      ok: false,
      status: 409,
      error: `店舗から離れているため打刻できません。現在約${Math.round(distanceMeters)}m / 許可範囲 ${radiusMeters}m`,
      verdict: "outside_radius",
      mobileLatitude,
      mobileLongitude,
      mobileAccuracyMeters,
      storeLatitude,
      storeLongitude,
      distanceMeters
    };
  }

  return {
    ok: true,
    verdict: "inside_radius",
    mobileLatitude,
    mobileLongitude,
    mobileAccuracyMeters,
    storeLatitude,
    storeLongitude,
    distanceMeters
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") || getJstMonthLabel();
  const month = /^(\d{4})-(\d{2})$/.test(monthParam) ? monthParam : getJstMonthLabel();
  const selfOnly = url.searchParams.get("selfOnly") === "1";
  const scope = selfOnly
    ? { allStores: false, storeIds: await getEmployeeWorkStoreIds(session.id) }
    : await getTimecardStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";
  const selectedStore = stores.find((store) => String(store.id) === selectedStoreId) ?? null;
  const selectedStoreBusinessHours = normalizeBusinessHours(selectedStore?.businessHours);
  const { startDate, endDate, startUtc, endUtc } = getPayrollDateRange(month, selectedStore);
  const punchWindowStartUtc = new Date(startUtc.getTime() - 36 * 60 * 60 * 1000);
  const punchWindowEndUtc = new Date(endUtc.getTime() + 36 * 60 * 60 * 1000);
  const canViewPayroll = timecardPayrollViewRoles.has(session.role) && !selfOnly;
  const allVisibleEmployees = await getVisibleEmployees(scope.allStores, scope.storeIds);
  const employees = selfOnly
    ? allVisibleEmployees.filter((employee) => String(employee.id) === session.id)
    : allVisibleEmployees;
  const withholdingTaxRows = canViewPayroll ? await getWithholdingTaxRowsForMonth(month) : [];
  const socialInsuranceRows = canViewPayroll ? await getSocialInsuranceRowsForMonth(month) : [];
  const employmentInsuranceRateRows = canViewPayroll ? await getEmploymentInsuranceRateRowsForMonth(month) : [];
  const allowanceRules = canViewPayroll ? await getPayrollAllowanceRules(visibleStoreIds) : [];

  const punches = selectedStoreId ? await sql`
    select
      timecard_punches.id::text,
      timecard_punches.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_punches.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_punches.punch_type as "punchType",
      timecard_punches.punched_at as "punchedAt",
      timecard_punches.source,
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    where timecard_punches.store_id::text = ${selectedStoreId}
      and timecard_punches.punched_at >= ${punchWindowStartUtc.toISOString()}
      and timecard_punches.punched_at < ${punchWindowEndUtc.toISOString()}
      and (${!selfOnly} or timecard_punches.employee_id::text = ${session.id})
    order by timecard_punches.punched_at desc
  ` : [];

  const typedPunches = punches.map((row) => {
    const punchType = String(row.punchType);
    return {
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: String(row.employeeName),
      storeId: String(row.storeId),
      storeName: String(row.storeName),
      punchType: isTimecardPunchType(punchType) ? punchType : "clock_in",
      punchedAt: new Date(String(row.punchedAt)).toISOString(),
      source: row.source ? String(row.source) : null,
      note: row.note ? String(row.note) : null
    };
  }) satisfies TimecardPunch[];

  const shifts = selectedStoreId ? await sql`
    select
      timecard_shifts.id::text,
      timecard_shifts.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_shifts.store_id::text as "storeId",
      stores.name as "storeName",
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      timecard_shifts.break_minutes as "breakMinutes",
      timecard_shifts.note
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    join stores on stores.id = timecard_shifts.store_id
    where timecard_shifts.store_id::text = ${selectedStoreId}
      and timecard_shifts.work_date >= ${startDate}::date
      and timecard_shifts.work_date < ${endDate}::date
      and (${!selfOnly} or timecard_shifts.employee_id::text = ${session.id})
    order by timecard_shifts.work_date asc, employees.name asc, timecard_shifts.scheduled_start asc nulls last, timecard_shifts.created_at asc
  ` : [];
  const responseShifts = shifts.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employeeId),
    employeeName: String(row.employeeName),
    storeId: String(row.storeId),
    storeName: String(row.storeName),
    workDate: String(row.workDate),
    scheduledStart: row.scheduledStart ? String(row.scheduledStart) : null,
    scheduledEnd: row.scheduledEnd ? String(row.scheduledEnd) : null,
    breakMinutes: Number(row.breakMinutes ?? 0),
    note: row.note ? String(row.note) : null
  })) satisfies ShiftWindowRow[];
  const dailySummaries = summarizeTimecardDays(typedPunches, {
    workDateStart: startDate,
    workDateEndExclusive: endDate,
    clockInWorkDateByPunchId: buildClockInWorkDateMap(typedPunches, responseShifts, selectedStoreBusinessHours)
  });
  const payroll = canViewPayroll ? summarizePayroll(employees, dailySummaries, {
    month,
    withholdingTaxRows,
    socialInsuranceRows,
    employmentInsuranceRateRows,
    allowanceRules
  }) : { rows: [], totals: emptyPayrollTotals };
  const payrollConfirmation = canViewPayroll && selectedStoreId
    ? await getPayrollConfirmation(selectedStoreId, month)
    : null;
  const [calendarEvents, weatherForecast, calendarMaintenance] = await Promise.all([
    selectedStoreId && selectedStore
      ? getBusinessCalendarEvents({
        storeId: selectedStoreId,
        startDate,
        endDate,
        storeLocationText: `${String(selectedStore.address ?? "")} ${String(selectedStore.weatherLocationName ?? "")}`.trim(),
        storePrefecture: String(selectedStore.socialInsurancePrefecture ?? "")
      })
      : Promise.resolve([]),
    selectedStore
      ? getStoreWeatherForecast({
        latitude: toMoneyNumber(selectedStore.weatherLatitude) ?? toMoneyNumber(selectedStore.attendanceLatitude),
        longitude: toMoneyNumber(selectedStore.weatherLongitude) ?? toMoneyNumber(selectedStore.attendanceLongitude),
        prefecture: String(selectedStore.socialInsurancePrefecture ?? "")
      })
      : Promise.resolve([]),
    session.role === storeTerminalRole
      ? Promise.resolve(null)
      : getBusinessCalendarMaintenanceStatus()
  ]);
  const responseEmployees = canViewPayroll
    ? employees
    : employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      status: employee.status,
      storeIds: employee.storeIds,
      storePayrollSettings: []
    }));

  const latestPunchRows = selectedStoreId ? await sql`
    select
      timecard_punches.id::text,
      timecard_punches.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_punches.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_punches.punch_type as "punchType",
      timecard_punches.punched_at as "punchedAt",
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    join (
      select
        employee_id,
        max(punched_at) as latest_punched_at
      from timecard_punches
      where store_id::text = ${selectedStoreId}
        and (${!selfOnly} or employee_id::text = ${session.id})
      group by employee_id
    ) latest
      on latest.employee_id = timecard_punches.employee_id
      and latest.latest_punched_at = timecard_punches.punched_at
    where timecard_punches.store_id::text = ${selectedStoreId}
      and (${!selfOnly} or timecard_punches.employee_id::text = ${session.id})
    order by timecard_punches.punched_at desc
  ` : [];
  const latestPunches = latestPunchRows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employeeId),
    employeeName: String(row.employeeName),
    storeId: String(row.storeId),
    storeName: String(row.storeName),
    punchType: String(row.punchType),
    punchedAt: new Date(String(row.punchedAt)).toISOString()
  }));
  const latestPunch = latestPunches.find((punch) => punch.employeeId === session.id) ?? null;
  const isStoreTerminalSession = session.role === storeTerminalRole;
  const responseLatestPunches = isStoreTerminalSession
    ? latestPunches.map((punch) => ({
      employeeId: punch.employeeId,
      punchType: punch.punchType,
      punchedAt: ""
    }))
    : latestPunches;

  return Response.json({
    month,
    currentEmployeeId: session.id,
    currentEmployeeRole: session.role,
    canEditActualTime: timecardActualEditRoles.has(session.role) && !selfOnly,
    canViewPayroll,
    stores,
    selectedStoreId,
    payrollPeriod: { startDate, endDate },
    employees: responseEmployees,
    punches: isStoreTerminalSession ? [] : typedPunches,
    shifts: isStoreTerminalSession ? [] : responseShifts,
    calendarEvents: isStoreTerminalSession ? [] : calendarEvents,
    calendarMaintenance,
    weatherForecast: isStoreTerminalSession ? [] : weatherForecast,
    latestPunch: isStoreTerminalSession ? null : latestPunch,
    latestPunches: responseLatestPunches,
    dailySummaries: isStoreTerminalSession ? [] : dailySummaries,
    payrollConfirmation: isStoreTerminalSession ? null : payrollConfirmation,
    payrollRows: isStoreTerminalSession ? [] : payroll.rows,
    payrollTotals: isStoreTerminalSession ? emptyPayrollTotals : payroll.totals
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as TimecardPostBody;
  const action = String(body.action ?? "punch");

  const storeId = String(body.storeId ?? "");
  if (!storeId) {
    return Response.json({ error: "店舗を選択してください。" }, { status: 400 });
  }

  const hasStoreAccess = session.role === "staff"
    ? await canPunchForEmployee(storeId, session.id)
    : await canAccessStore(session, storeId);
  if (!hasStoreAccess) {
    return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });
  }

  if (action === "import_attendance_csv") {
    if (!timecardActualEditRoles.has(session.role)) {
      return Response.json({ error: "勤怠CSVを取り込む権限がありません。" }, { status: 403 });
    }

    const monthParam = String(body.month ?? getJstMonthLabel());
    const month = /^(\d{4})-(\d{2})$/.test(monthParam) ? monthParam : getJstMonthLabel();
    const csvBase64 = String(body.csvBase64 ?? "");
    if (!csvBase64) {
      return Response.json({ error: "CSVファイルを選択してください。" }, { status: 400 });
    }

    const storeRows = await sql`
      select
        id::text,
        name,
        coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
        coalesce(payroll_closing_day, 31)::int as "payrollClosingDay"
      from stores
      where id::text = ${storeId}
      limit 1
    `;
    const store = storeRows[0] ?? null;
    if (!store) {
      return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
    }

    let parsedCsv: ReturnType<typeof parseAttendanceCsv>;
    try {
      parsedCsv = parseAttendanceCsv(csvBase64);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "CSVを読み取れませんでした。" }, { status: 400 });
    }

    const { startDate, endDate } = getPayrollDateRange(month, store);
    const punchesInPeriod = parsedCsv.punches.filter((punch) => punch.workDate >= startDate && punch.workDate < endDate);
    if (!punchesInPeriod.length) {
      return Response.json({ error: "選択した月度に該当する打刻がCSV内にありません。" }, { status: 400 });
    }

    const csvStoreNames = Array.from(new Set(punchesInPeriod.map((punch) => punch.storeName).filter(Boolean)));
    const selectedStoreName = String(store.name);
    const otherStoreNames = csvStoreNames.filter((name) => name !== selectedStoreName);
    if (otherStoreNames.length) {
      return Response.json({ error: `選択店舗とCSVの事業所名が一致しません: ${otherStoreNames.join("、")}` }, { status: 400 });
    }

    const employeeRows = await sql`
      select employees.id::text, employees.name
      from employees
      join employee_work_stores
        on employee_work_stores.employee_id = employees.id
      where employee_work_stores.store_id::text = ${storeId}
        and employees.status = 'active'
    `;
    const employeeByName = new Map(employeeRows.map((employee) => [normalizeAttendanceName(String(employee.name)), String(employee.id)]));
    const missingEmployeeNames = Array.from(new Set(
      punchesInPeriod.map((punch) => punch.employeeName).filter((name) => !employeeByName.has(normalizeAttendanceName(name)))
    ));
    if (missingEmployeeNames.length) {
      return Response.json({ error: `スタッフ設定に存在しない従業員があります: ${missingEmployeeNames.join("、")}` }, { status: 400 });
    }

    const deleteNoteStart = `CSV取込: ${startDate}`;
    const deleteNoteEnd = `CSV取込: ${endDate}`;
    const transactionResults = await sql.transaction([
      sql`
        delete from timecard_punches
        where store_id::text = ${storeId}
          and source = 'csv_import'
          and note >= ${deleteNoteStart}
          and note < ${deleteNoteEnd}
        returning id::text
      `,
      ...punchesInPeriod.map((punch) => sql`
          insert into timecard_punches (
            employee_id,
            store_id,
            punch_type,
            punched_at,
            source,
            note,
            created_by
          )
          values (
            ${employeeByName.get(normalizeAttendanceName(punch.employeeName))},
            ${storeId},
            ${punch.punchType},
            ${punch.punchedAt},
            'csv_import',
            ${punch.note},
            ${session.id}
          )
        `)
    ]);
    const deletedCount = Array.isArray(transactionResults[0]) ? transactionResults[0].length : 0;

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.attendance_csv.imported",
      targetType: "timecard_punch",
      targetId: storeId,
      metadata: {
        storeId,
        month,
        fileName: body.csvFileName ?? null,
        sourceRows: parsedCsv.rowCount,
        skippedRows: parsedCsv.skippedRows,
        deletedCount,
        insertedCount: punchesInPeriod.length
      },
      request
    });

    return Response.json({
      ok: true,
      sourceRows: parsedCsv.rowCount,
      skippedRows: parsedCsv.skippedRows,
      deletedCount,
      insertedCount: punchesInPeriod.length
    });
  }

  if (action === "confirm_payroll") {
    if (!timecardPayrollViewRoles.has(session.role)) {
      return Response.json({ error: "給与を確定する権限がありません。" }, { status: 403 });
    }

    const monthParam = String(body.month ?? getJstMonthLabel());
    const month = /^(\d{4})-(\d{2})$/.test(monthParam) ? monthParam : getJstMonthLabel();
    const storeRows = await sql`
      select
        id::text,
        business_hours as "businessHours",
        coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
        coalesce(payroll_closing_day, 31)::int as "payrollClosingDay"
      from stores
      where id::text = ${storeId}
      limit 1
    `;
    const store = storeRows[0] ?? null;
    if (!store) {
      return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
    }
    const storeBusinessHours = normalizeBusinessHours(store.businessHours);

    const { startDate, endDate, startUtc, endUtc } = getPayrollDateRange(month, store);
    if (getJstDateLabel(new Date()) < endDate) {
      return Response.json({ error: "この月度はまだ締め日前のため、給与を確定できません。" }, { status: 409 });
    }
    const punchWindowStartUtc = new Date(startUtc.getTime() - 36 * 60 * 60 * 1000);
    const punchWindowEndUtc = new Date(endUtc.getTime() + 36 * 60 * 60 * 1000);
    const scope = await getTimecardStoreScope(session);
    const employees = await getVisibleEmployees(scope.allStores, scope.storeIds);
    const visibleStoreIds = scope.allStores ? [storeId] : scope.storeIds;
    const withholdingTaxRows = await getWithholdingTaxRowsForMonth(month);
    const socialInsuranceRows = await getSocialInsuranceRowsForMonth(month);
    const employmentInsuranceRateRows = await getEmploymentInsuranceRateRowsForMonth(month);
    const allowanceRules = await getPayrollAllowanceRules(visibleStoreIds);
    const punches = await sql`
      select
        timecard_punches.id::text,
        timecard_punches.employee_id::text as "employeeId",
        employees.name as "employeeName",
        timecard_punches.store_id::text as "storeId",
        stores.name as "storeName",
        timecard_punches.punch_type as "punchType",
        timecard_punches.punched_at as "punchedAt",
        timecard_punches.source,
        timecard_punches.note
      from timecard_punches
      join employees on employees.id = timecard_punches.employee_id
      join stores on stores.id = timecard_punches.store_id
      where timecard_punches.store_id::text = ${storeId}
        and timecard_punches.punched_at >= ${punchWindowStartUtc.toISOString()}
        and timecard_punches.punched_at < ${punchWindowEndUtc.toISOString()}
      order by timecard_punches.punched_at desc
    `;
    const typedPunches = punches.map((row) => {
      const punchType = String(row.punchType);
      return {
        id: String(row.id),
        employeeId: String(row.employeeId),
        employeeName: String(row.employeeName),
        storeId: String(row.storeId),
        storeName: String(row.storeName),
        punchType: isTimecardPunchType(punchType) ? punchType : "clock_in",
        punchedAt: new Date(String(row.punchedAt)).toISOString(),
        source: row.source ? String(row.source) : null,
        note: row.note ? String(row.note) : null
      };
    }) satisfies TimecardPunch[];
    const payrollShifts = await sql`
      select
        timecard_shifts.id::text,
        timecard_shifts.employee_id::text as "employeeId",
        employees.name as "employeeName",
        timecard_shifts.store_id::text as "storeId",
        stores.name as "storeName",
        to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
        to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
        to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
        timecard_shifts.break_minutes as "breakMinutes",
        timecard_shifts.note
      from timecard_shifts
      join employees on employees.id = timecard_shifts.employee_id
      join stores on stores.id = timecard_shifts.store_id
      where timecard_shifts.store_id::text = ${storeId}
        and timecard_shifts.work_date >= ${startDate}::date
        and timecard_shifts.work_date < ${endDate}::date
      order by timecard_shifts.work_date asc, employees.name asc, timecard_shifts.scheduled_start asc nulls last, timecard_shifts.created_at asc
    `;
    const payrollShiftWindows = payrollShifts.map((row) => ({
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: String(row.employeeName),
      storeId: String(row.storeId),
      storeName: String(row.storeName),
      workDate: String(row.workDate),
      scheduledStart: row.scheduledStart ? String(row.scheduledStart) : null,
      scheduledEnd: row.scheduledEnd ? String(row.scheduledEnd) : null,
      breakMinutes: Number(row.breakMinutes ?? 0),
      note: row.note ? String(row.note) : null
    })) satisfies ShiftWindowRow[];
    const dailySummaries = summarizeTimecardDays(typedPunches, {
      workDateStart: startDate,
      workDateEndExclusive: endDate,
      clockInWorkDateByPunchId: buildClockInWorkDateMap(typedPunches, payrollShiftWindows, storeBusinessHours)
    });
    const payroll = summarizePayroll(employees, dailySummaries, {
      month,
      withholdingTaxRows,
      socialInsuranceRows,
      employmentInsuranceRateRows,
      allowanceRules
    });

    const upserted = await sql`
      insert into timecard_payroll_confirmations (
        store_id,
        payroll_month,
        period_start,
        period_end,
        payroll_rows,
        payroll_totals,
        confirmed_by,
        confirmed_at,
        updated_at
      )
      values (
        ${storeId},
        ${month},
        ${startDate}::date,
        ${endDate}::date,
        ${JSON.stringify(payroll.rows)}::jsonb,
        ${JSON.stringify(payroll.totals)}::jsonb,
        ${session.id},
        now(),
        now()
      )
      on conflict (store_id, payroll_month)
      do update set
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        payroll_rows = excluded.payroll_rows,
        payroll_totals = excluded.payroll_totals,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = now(),
        updated_at = now()
      returning id::text
    `;

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.payroll.confirmed",
      targetType: "timecard_payroll_confirmation",
      targetId: String(upserted[0]?.id ?? ""),
      metadata: { storeId, month, rowCount: payroll.rows.length, totals: payroll.totals },
      request
    });

    return Response.json({ ok: true, id: upserted[0]?.id ?? null });
  }

  if (action === "save_shift" || action === "delete_shift" || action === "save_shifts_bulk" || action === "delete_shifts_bulk") {
    if (action === "save_shifts_bulk" || action === "delete_shifts_bulk") {
      const shifts = Array.isArray(body.shifts) ? body.shifts : [];
      if (!shifts.length) {
        return Response.json({ error: "対象のシフトを選択してください。" }, { status: 400 });
      }
      if (shifts.length > 120) {
        return Response.json({ error: "一度に編集できるシフトは120件までです。" }, { status: 400 });
      }

      const normalizedShifts = [];
      for (const shift of shifts) {
        const employeeId = String(shift.employeeId ?? "");
        const workDate = String(shift.workDate ?? "");
        if (!employeeId || !isValidWorkDate(workDate)) {
          return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
        }
        if (!await canPunchForEmployee(storeId, employeeId)) {
          return Response.json({ error: "この従業員は選択した店舗のシフト対象ではありません。" }, { status: 403 });
        }
        normalizedShifts.push({ ...shift, employeeId, workDate });
      }

      if (action === "delete_shifts_bulk") {
        for (const shift of normalizedShifts) {
          await sql`
            delete from timecard_shifts
            where employee_id = ${shift.employeeId}
              and store_id = ${storeId}
              and work_date = ${shift.workDate}::date
          `;
        }

        await writeAuditLog({
          actorEmployeeId: session.id,
          action: "timecard.shift.bulk_deleted",
          targetType: "timecard_shift",
          targetId: storeId,
          metadata: { storeId, count: normalizedShifts.length, shifts: normalizedShifts.map((shift) => ({ employeeId: shift.employeeId, workDate: shift.workDate })) },
          request
        });

        return Response.json({ ok: true, count: normalizedShifts.length });
      }

      const upsertedIds: string[] = [];
      for (const shift of normalizedShifts) {
        const scheduledStart = normalizeTimeValue(shift.scheduledStart);
        const scheduledEnd = normalizeTimeValue(shift.scheduledEnd);
        const breakMinutes = Math.max(0, Math.min(720, Math.round(Number(shift.breakMinutes ?? 0) || 0)));
        if (!scheduledStart || !scheduledEnd) {
          return Response.json({ error: "開始時刻と終了時刻を入力してください。" }, { status: 400 });
        }

        await sql`
          delete from timecard_shifts
          where employee_id = ${shift.employeeId}
            and store_id = ${storeId}
            and work_date = ${shift.workDate}::date
        `;

        const inserted = await sql`
          insert into timecard_shifts (
            employee_id,
            store_id,
            work_date,
            scheduled_start,
            scheduled_end,
            break_minutes,
            note,
            created_by,
            updated_at
          )
          values (
            ${shift.employeeId},
            ${storeId},
            ${shift.workDate}::date,
            ${scheduledStart}::time,
            ${scheduledEnd}::time,
            ${breakMinutes},
            ${String(shift.note ?? "").trim() || null},
            ${session.id},
            now()
          )
          returning id::text
        `;
        upsertedIds.push(String(inserted[0]?.id ?? ""));
      }

      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.shift.bulk_saved",
        targetType: "timecard_shift",
        targetId: storeId,
        metadata: { storeId, count: normalizedShifts.length, ids: upsertedIds.filter(Boolean) },
        request
      });

      return Response.json({ ok: true, count: normalizedShifts.length, ids: upsertedIds.filter(Boolean) });
    }

    const shiftId = String(body.shiftId ?? "");
    const employeeId = String(body.employeeId ?? "");
    const workDate = String(body.workDate ?? "");
    if (!employeeId || !isValidWorkDate(workDate)) {
      return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
    }

    if (!await canPunchForEmployee(storeId, employeeId)) {
      return Response.json({ error: "この従業員は選択した店舗のシフト対象ではありません。" }, { status: 403 });
    }

    if (action === "delete_shift") {
      if (shiftId) {
        await sql`
          delete from timecard_shifts
          where id::text = ${shiftId}
            and employee_id = ${employeeId}
            and store_id = ${storeId}
            and work_date = ${workDate}::date
        `;
      } else {
        await sql`
          delete from timecard_shifts
          where employee_id = ${employeeId}
            and store_id = ${storeId}
            and work_date = ${workDate}::date
        `;
      }

      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.shift.deleted",
        targetType: "timecard_shift",
        targetId: `${employeeId}:${storeId}:${workDate}`,
        metadata: { storeId, employeeId, workDate },
        request
      });

      return Response.json({ ok: true });
    }

    const scheduledStart = normalizeTimeValue(body.scheduledStart);
    const scheduledEnd = normalizeTimeValue(body.scheduledEnd);
    const breakMinutes = Math.max(0, Math.min(720, Math.round(Number(body.breakMinutes ?? 0) || 0)));
    if (!scheduledStart || !scheduledEnd) {
      return Response.json({ error: "開始時刻と終了時刻を入力してください。" }, { status: 400 });
    }

    const saved = shiftId ? await sql`
      update timecard_shifts
      set scheduled_start = ${scheduledStart}::time,
          scheduled_end = ${scheduledEnd}::time,
          break_minutes = ${breakMinutes},
          note = ${String(body.note ?? "").trim() || null},
          updated_at = now()
      where id::text = ${shiftId}
        and employee_id = ${employeeId}
        and store_id = ${storeId}
        and work_date = ${workDate}::date
      returning id::text
    ` : await sql`
      insert into timecard_shifts (
        employee_id,
        store_id,
        work_date,
        scheduled_start,
        scheduled_end,
        break_minutes,
        note,
        created_by,
        updated_at
      )
      values (
        ${employeeId},
        ${storeId},
        ${workDate}::date,
        ${scheduledStart}::time,
        ${scheduledEnd}::time,
        ${breakMinutes},
        ${String(body.note ?? "").trim() || null},
        ${session.id},
        now()
      )
      returning id::text
    `;
    if (shiftId && !saved.length) {
      return Response.json({ error: "対象シフトが見つかりません。" }, { status: 404 });
    }

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift.saved",
      targetType: "timecard_shift",
      targetId: String(saved[0]?.id ?? ""),
      metadata: { storeId, employeeId, workDate, shiftId: saved[0]?.id ?? shiftId, scheduledStart, scheduledEnd, breakMinutes },
      request
    });

    return Response.json({ ok: true, id: saved[0]?.id ?? null });
  }

  if (action === "save_actual_time" || action === "delete_actual_time") {
    if (!timecardActualEditRoles.has(session.role)) {
      return Response.json({ error: "実勤務時間を修正する権限がありません。" }, { status: 403 });
    }

    const employeeId = String(body.employeeId ?? "");
    const workDate = String(body.workDate ?? "");
    if (!employeeId || !isValidWorkDate(workDate)) {
      return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
    }

    if (!await canPunchForEmployee(storeId, employeeId)) {
      return Response.json({ error: "この従業員は選択した店舗の実勤務対象ではありません。" }, { status: 403 });
    }

    const storeRows = await sql`
      select business_hours as "businessHours"
      from stores
      where id::text = ${storeId}
      limit 1
    `;
    const storeBusinessHours = normalizeBusinessHours(storeRows[0]?.businessHours);
    const clockIn = normalizeTimeValue(body.clockIn);
    const clockOut = normalizeTimeValue(body.clockOut);
    const breakIntervals = normalizeBreakIntervals(body.breakIntervals);
    const targetShift = await getShiftById(String(body.shiftId ?? ""), storeId, employeeId, workDate)
      ?? await getShiftForActualEdit(storeId, employeeId, workDate, clockIn, storeBusinessHours);
    const { start, end, overnightEnd } = getJstWorkDateRange(workDate);
    const inputDeleteWindow = getActualInputDeleteWindow(workDate, { clockIn, clockOut, breakIntervals });
    const deleteStart = targetShift?.scheduledStart
      ? new Date(getScheduledShiftDateTime(targetShift, targetShift.scheduledStart, null, storeBusinessHours).getTime() - 3 * 60 * 60 * 1000)
      : inputDeleteWindow?.start ?? start;
    const deleteEnd = targetShift?.scheduledEnd
      ? new Date(getScheduledShiftDateTime(targetShift, targetShift.scheduledEnd, targetShift.scheduledStart, storeBusinessHours).getTime() + 3 * 60 * 60 * 1000)
      : inputDeleteWindow?.end ?? overnightEnd;
    const hasNarrowDeleteWindow = Boolean(targetShift || inputDeleteWindow);
    const deleteTargetPunches = async () => {
      await sql`
        delete from timecard_punches
        where employee_id = ${employeeId}
          and store_id = ${storeId}
          and (
            ${hasNarrowDeleteWindow}
            and punched_at >= ${deleteStart.toISOString()}
            and punched_at < ${deleteEnd.toISOString()}
            or (
              ${!hasNarrowDeleteWindow}
              and (
                (
                  punch_type = 'clock_in'
                  and punched_at >= ${start.toISOString()}
                  and punched_at < ${end.toISOString()}
                )
                or (
                  punch_type in ('clock_out', 'break_start', 'break_end')
                  and punched_at >= ${new Date(start.getTime() + 12 * 60 * 60 * 1000).toISOString()}
                  and punched_at < ${overnightEnd.toISOString()}
                )
              )
            )
          )
      `;
    };

    if (action === "delete_actual_time") {
      await deleteTargetPunches();

      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.actual_time.deleted",
        targetType: "timecard_punch",
        targetId: `${employeeId}:${storeId}:${workDate}`,
        metadata: { storeId, employeeId, workDate },
        request
      });

      return Response.json({ ok: true });
    }

    const completeBreakIntervals = breakIntervals.filter((interval) => interval.start || interval.end);
    if (completeBreakIntervals.some((interval) => !interval.start || !interval.end)) {
      return Response.json({ error: "休憩は開始時刻と終了時刻をセットで入力してください。" }, { status: 400 });
    }
    if (!clockIn && !clockOut && !completeBreakIntervals.length) {
      return Response.json({ error: "出勤または退勤時刻を入力してください。" }, { status: 400 });
    }

    const nextClockInAt = clockIn ? resolveActualPunchDateTime(workDate, clockIn, { shift: targetShift, storeBusinessHours }) : null;
    const nextClockOutAt = clockOut ? resolveActualPunchDateTime(workDate, clockOut, { baseTime: clockIn, shift: targetShift, storeBusinessHours }) : null;
    const nextBreakIntervals = completeBreakIntervals.map((interval) => {
      const startTime = interval.start as string;
      const endTime = interval.end as string;
      const startAt = resolveActualPunchDateTime(workDate, startTime, { baseTime: clockIn, shift: targetShift, storeBusinessHours });
      const endAt = moveDateTimeAtOrAfter(
        new Date(resolveActualPunchDateTime(workDate, endTime, { baseTime: clockIn, shift: targetShift, storeBusinessHours })),
        new Date(startAt)
      ).toISOString();
      return { start: startTime, end: endTime, startAt, endAt };
    });
    const now = Date.now();
    const futurePunch = [
      nextClockInAt,
      nextClockOutAt,
      ...nextBreakIntervals.flatMap((interval) => [interval.startAt, interval.endAt])
    ].find((value) => value && new Date(value).getTime() > now);
    if (futurePunch) {
      return Response.json({ error: "未来の実勤務時刻は保存できません。実際に打刻時刻を過ぎてから修正してください。" }, { status: 400 });
    }

    await deleteTargetPunches();

    const insertedIds: string[] = [];
    if (clockIn && nextClockInAt) {
      const rows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'clock_in',
          ${nextClockInAt},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(rows[0]?.id ?? ""));
    }

    for (const interval of nextBreakIntervals) {
      const breakStartRows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'break_start',
          ${interval.startAt},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(breakStartRows[0]?.id ?? ""));

      const breakEndRows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'break_end',
          ${interval.endAt},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(breakEndRows[0]?.id ?? ""));
    }

    if (clockOut && nextClockOutAt) {
      const rows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'clock_out',
          ${nextClockOutAt},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(rows[0]?.id ?? ""));
    }

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.actual_time.saved",
      targetType: "timecard_punch",
      targetId: insertedIds.filter(Boolean).join(","),
      metadata: { storeId, employeeId, workDate, shiftId: targetShift?.id ?? null, clockIn, clockOut, breakIntervals: nextBreakIntervals.map((interval) => ({ start: interval.start, end: interval.end })) },
      request
    });

    return Response.json({ ok: true, ids: insertedIds.filter(Boolean) });
  }

  const punchType = String(body.punchType ?? "");
  if (!isTimecardPunchType(punchType)) {
    return Response.json({ error: "打刻種別と店舗を確認してください。" }, { status: 400 });
  }

  const source = String(body.source ?? "").trim();
  const isMobilePunch = source === "mobile";
  const employeeId = session.role === "staff"
    ? session.id
    : String(body.employeeId ?? "");
  const punchSource = session.role === storeTerminalRole
    ? "store_terminal"
    : isMobilePunch
      ? "mobile"
      : "store_tablet";
  if (!employeeId) {
    return Response.json({ error: "打刻する従業員を選択してください。" }, { status: 400 });
  }

  if (isMobilePunch && !mobilePunchRoles.has(session.role)) {
    return Response.json({ error: "モバイル打刻は店舗スタッフ本人のみ利用できます。" }, { status: 403 });
  }

  if (!await canPunchForEmployee(storeId, employeeId)) {
    return Response.json({ error: "この従業員は選択した店舗で打刻できません。" }, { status: 403 });
  }

  const requiresLocation = punchType === "clock_in" || punchType === "clock_out";
  const locationCheck = isMobilePunch ? await validateMobilePunchLocation(storeId, body, { enforce: requiresLocation }) : null;
  if (locationCheck && !locationCheck.ok) {
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.mobile_punch.rejected",
      targetType: "timecard_punch",
      targetId: storeId,
      metadata: {
        storeId,
        punchType,
        employeeId,
        verdict: locationCheck.verdict ?? "invalid",
        mobileLatitude: locationCheck.mobileLatitude ?? null,
        mobileLongitude: locationCheck.mobileLongitude ?? null,
        mobileAccuracyMeters: locationCheck.mobileAccuracyMeters ?? null,
        storeLatitude: locationCheck.storeLatitude ?? null,
        storeLongitude: locationCheck.storeLongitude ?? null,
        distanceMeters: locationCheck.distanceMeters ?? null
      },
      request
    });
    return Response.json({ error: locationCheck.error }, { status: locationCheck.status });
  }

  const inserted = await sql`
    insert into timecard_punches (
      employee_id,
      store_id,
      punch_type,
      source,
      note,
      mobile_latitude,
      mobile_longitude,
      mobile_accuracy_meters,
      store_latitude,
      store_longitude,
      distance_from_store_meters,
      location_verdict,
      user_agent,
      ip_address,
      created_by
    )
    values (
      ${employeeId},
      ${storeId},
      ${punchType},
      ${punchSource},
      ${String(body.note ?? "").trim() || null},
      ${locationCheck?.mobileLatitude ?? null},
      ${locationCheck?.mobileLongitude ?? null},
      ${locationCheck?.mobileAccuracyMeters ?? null},
      ${locationCheck?.storeLatitude ?? null},
      ${locationCheck?.storeLongitude ?? null},
      ${locationCheck?.distanceMeters ?? null},
      ${locationCheck?.verdict ?? (isMobilePunch ? "not_checked" : null)},
      ${request.headers.get("user-agent")},
      ${getClientIp(request)},
      ${session.id}
    )
    returning id::text
  `;

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "timecard.punched",
    targetType: "timecard_punch",
    targetId: String(inserted[0]?.id ?? ""),
    metadata: {
      storeId,
      punchType,
      employeeId,
      createdBy: session.id,
      source: punchSource,
      locationVerdict: locationCheck?.verdict ?? null,
      distanceMeters: locationCheck?.distanceMeters ?? null,
      mobileAccuracyMeters: locationCheck?.mobileAccuracyMeters ?? null
    },
    request
  });

  const farewell = punchType === "clock_out"
    ? await getFinalWorkdayFarewell(storeId, employeeId)
    : null;

  return Response.json({ ok: true, id: inserted[0]?.id ?? null, farewell });
}
