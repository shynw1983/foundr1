"use client";

import { BriefcaseBusiness, CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock3, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Download, FileText, FileUp, Lightbulb, LogOut, MessageSquare, MessageSquareWarning, PackageCheck, RefreshCw, Search, Settings, Snowflake, Store, Sun, Trash2, Truck, UserCog, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, FormEvent, MouseEvent } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";
import { formatDuration, formatJstTime, getJstMonthLabel } from "../../../lib/timecard";
import { normalizeBusinessHours, type StoreBusinessHours, type WeekdayKey } from "../../../lib/store-business-hours";

type StoreOption = {
  id: string;
  name: string;
  address?: string;
  weatherLocationName?: string;
  companyLegalName?: string;
  businessHours?: unknown;
  payrollCycleType?: "month_end" | "specified_day";
  payrollClosingDay?: number;
  socialInsurancePrefecture?: string;
};

type BusinessCalendarEvent = {
  id: string;
  storeId: string | null;
  sourceType: "holiday" | "sports" | "festival" | "concert" | "convention" | "cruise" | "manual";
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  category: string;
  impactLevel: "reference" | "busy" | "major";
  flowDirection: "inbound" | "outbound" | "mixed";
  impactStartTime: string | null;
  impactEndTime: string | null;
  venue: string;
  sourceUrl: string;
  note: string;
};

type WeatherForecastDay = {
  date: string;
  weatherCode: number | null;
  label: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationProbabilityMax: number | null;
  precipitationSum: number | null;
  windSpeedMax: number | null;
  windLabel: string;
  reliability: "A" | "B" | "C" | null;
  sourceName: string;
  sourceUrl: string;
  updatedAt: string;
  isFallback: boolean;
};

type TimecardEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
  storeIds: string[];
  storePayrollSettings?: TimecardStorePayrollSetting[];
};

type TimecardStorePayrollSetting = {
  storeId: string;
  payrollEnabled: boolean;
  employmentType: "hourly" | "monthly";
  hourlyWage: number | null;
  monthlySalary: number | null;
  prescribedMonthlyWorkMinutes?: number | null;
  commuteAllowancePerWorkday: number;
  commuteAllowanceMonthlyCap: number | null;
  validFrom: string;
  wageValidFrom: string;
  commuteValidFrom: string;
};

type ShiftEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  breakMinutes: number;
  note: string | null;
};

type DailySummary = {
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
  isManualCorrection: boolean;
  alerts: string[];
  breakIntervals?: Array<{ start: string; end: string }>;
  punches?: TimecardPunchDetail[];
};

type TimecardPunchDetail = {
  id: string;
  punchType: "clock_in" | "clock_out" | "break_start" | "break_end";
  punchedAt: string;
  source: string | null;
  note: string | null;
};

type PayrollRow = {
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
  regularWorkMinutes?: number;
  overtimeMinutes?: number;
  regularPay?: number;
  overtimePay?: number;
  nightPremiumPay?: number;
  allowancePay?: number;
  allowancePremiumPay?: number;
  basePay: number;
  socialInsurance?: number;
  employmentInsurance?: number;
  incomeTax?: number;
  residentTax?: number;
  commuteAllowance: number;
  totalPay: number;
  allowanceItems?: Array<{
    ruleId: string;
    name: string;
    ruleType: "fixed_monthly" | "one_person_busy_hourly";
    storeId: string | null;
    workDate: string | null;
    minutes: number;
    amount: number;
    premiumAmount: number;
    note: string;
  }>;
  alerts: string[];
};

type PayrollTotals = {
  workDays: number;
  punchCount: number;
  workMinutes: number;
  nightMinutes: number;
  overtimeMinutes?: number;
  laborCost: number;
  overtimePay?: number;
  nightPremiumPay?: number;
  allowancePay?: number;
  allowancePremiumPay?: number;
  socialInsurance?: number;
  employmentInsurance?: number;
  incomeTax?: number;
  residentTax?: number;
  commuteAllowance: number;
  totalPay: number;
};

type PayrollConfirmation = {
  id: string;
  storeId: string;
  payrollMonth: string;
  periodStart: string;
  periodEnd: string;
  confirmedAt: string;
  confirmedByName: string | null;
  payrollRows: PayrollRow[];
  payrollTotals: PayrollTotals;
};

type PayrollPaymentBatch = {
  id: string;
  payrollMonth: string;
  paymentDate: string;
  bankProvider: string;
  fileFormat: string;
  fileName: string;
  totalAmount: number;
  transferCount: number;
  status: string;
  createdAt: string;
  createdByName: string | null;
};

type TimecardPayload = {
  month: string;
  currentEmployeeRole?: string;
  canViewPayroll: boolean;
  canEditActualTime: boolean;
  stores: StoreOption[];
  selectedStoreId: string;
  payrollPeriod?: {
    startDate: string;
    endDate: string;
  };
  employees: TimecardEmployee[];
  shifts: ShiftEntry[];
  calendarEvents: BusinessCalendarEvent[];
  weatherForecast: WeatherForecastDay[];
  dailySummaries: DailySummary[];
  payrollConfirmation: PayrollConfirmation | null;
  payrollRows: PayrollRow[];
  payrollTotals: PayrollTotals;
};

type CalendarEventDraft = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  category: string;
  impactLevel: "reference" | "busy" | "major";
  flowDirection: "inbound" | "outbound" | "mixed";
  impactStartTime: string;
  impactEndTime: string;
  venue: string;
  note: string;
};

function getCalendarEventShortLabel(event: BusinessCalendarEvent) {
  if (event.category === "foreign_long_break") return "外";
  if (event.category === "long_break") return "連";
  if (event.sourceType === "holiday") return "祝";
  if (event.sourceType === "sports") return "鷹";
  if (event.sourceType === "festival") return "祭";
  if (event.sourceType === "concert") return "演";
  if (event.sourceType === "convention") return "展";
  if (event.sourceType === "cruise") return "船";
  return "予";
}

function getCalendarEventCategoryLabel(event: BusinessCalendarEvent) {
  if (event.category === "foreign_long_break") return "海外大型連休";
  if (event.category === "long_break") return "大型連休";
  if (event.sourceType === "holiday") return "祝日";
  if (event.sourceType === "concert" || event.category === "concert") return "コンサート";
  if (event.sourceType === "convention" || event.category === "convention") return "大型MICE";
  if (event.sourceType === "cruise" || event.category === "cruise") return "大型客船";
  if (event.category === "fireworks") return "花火大会";
  if (event.category === "sports") return "試合";
  if (event.category === "festival") return "祭事";
  if (event.category === "traffic") return "交通";
  return "店舗予定";
}

function getCalendarFlowLabel(direction: BusinessCalendarEvent["flowDirection"]) {
  if (direction === "inbound") return "地域流入";
  if (direction === "outbound") return "地域流出";
  return "方向不明";
}

function getCalendarImpactLabel(impact: BusinessCalendarEvent["impactLevel"]) {
  if (impact === "major") return "重大影響";
  if (impact === "busy") return "混雑見込";
  return "参考";
}

function WeatherCodeIcon({ code, size = 13 }: { code: number | null; size?: number }) {
  if (code === 0) return <Sun className="weather-code-icon is-clear" size={size} aria-hidden="true" />;
  if (code === 1 || code === 2) return <CloudSun className="weather-code-icon is-partly-cloudy" size={size} aria-hidden="true" />;
  if (code === 3) return <Cloud className="weather-code-icon is-cloudy" size={size} aria-hidden="true" />;
  if (code === 45 || code === 48) return <CloudFog className="weather-code-icon is-cloudy" size={size} aria-hidden="true" />;
  if ((code !== null && code >= 71 && code <= 77) || code === 85 || code === 86) return <Snowflake className="weather-code-icon is-snowy" size={size} aria-hidden="true" />;
  if (code !== null && code >= 95) return <CloudLightning className="weather-code-icon is-stormy" size={size} aria-hidden="true" />;
  if (code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) return <CloudRain className="weather-code-icon is-rainy" size={size} aria-hidden="true" />;
  return <Cloud className="weather-code-icon is-cloudy" size={size} aria-hidden="true" />;
}

function formatForecastNumber(value: number | null) {
  return value === null ? "–" : String(Math.round(value));
}

function formatForecastUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

type ShiftDraft = {
  id?: string | null;
  employeeId: string;
  workDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  breakMinutes: string;
  note: string;
};

type ShiftSelection = {
  employeeId: string;
  workDate: string;
};

type ActualSelection = ShiftSelection & {
  shiftId?: string | null;
};

type ShiftEditorPosition = {
  top: number;
  left: number;
};

type ShiftPatch = ShiftSelection & {
  scheduledStart: string;
  scheduledEnd: string;
  breakMinutes: string;
  note: string;
};

type ActualDraft = {
  shiftId?: string | null;
  employeeId: string;
  workDate: string;
  clockIn: string;
  clockOut: string;
  breakStart1: string;
  breakEnd1: string;
  breakStart2: string;
  breakEnd2: string;
  note: string;
};

type ActualBulkDraft = {
  clockIn: string;
  clockOut: string;
  breakStart1: string;
  breakEnd1: string;
  breakStart2: string;
  breakEnd2: string;
  note: string;
};

type ShiftPattern = {
  label: string;
  start: string;
  end: string;
  breakMinutes: string;
};

type DayCoverage = {
  status: "closed" | "covered" | "uncovered";
  missingLabel: string;
};

type ActualStatus = {
  className: string;
  label: string;
};

type PayrollRefreshIssue = {
  employeeName: string;
  reasons: string[];
  totalPayDelta: number;
};

type PayrollRefreshSummary = {
  issues: PayrollRefreshIssue[];
  detail: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "シフト", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "シフト連絡", href: "/os/timecard/requests", icon: MessageSquare },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "商品マスタ", href: "/os/products", icon: BriefcaseBusiness },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "システム設定", href: "/os/settings", icon: Settings },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function formatCompactDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (hours === 0) return remainingMinutes === 0 ? "0h" : `${remainingMinutes}m`;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}`;
}

function formatSignedMoney(amount: number) {
  const rounded = Math.round(amount);
  if (rounded === 0) return formatMoney(0);
  return `${rounded > 0 ? "+" : "-"}${formatMoney(Math.abs(rounded))}`;
}

function formatPayrollDetailMoney(amount: number) {
  const hasFraction = Math.abs(amount - Math.round(amount)) > 0.001;
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  }).format(amount);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPunchTypeLabel(punchType: TimecardPunchDetail["punchType"]) {
  switch (punchType) {
    case "clock_in":
      return "出勤";
    case "clock_out":
      return "退勤";
    case "break_start":
      return "休憩開始";
    case "break_end":
      return "休憩終了";
    default:
      return "打刻";
  }
}

function getPunchSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "mobile":
      return "staff App";
    case "store_terminal":
    case "store_tablet":
      return "店舗端末";
    case "manager_correction":
      return "OS修正";
    case "csv_import":
      return "CSV取込";
    default:
      return "不明";
  }
}

function getPunchSourceClassName(source: string | null | undefined) {
  switch (source) {
    case "mobile":
      return "is-staff-app";
    case "store_terminal":
    case "store_tablet":
      return "is-store-device";
    case "manager_correction":
      return "is-os-edit";
    case "csv_import":
      return "is-csv-import";
    default:
      return "is-unknown";
  }
}

function addUniqueReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function roundedPayrollValue(row: PayrollRow, key: keyof PayrollRow) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function summarizePayrollRefresh(confirmation: PayrollConfirmation | null, currentRows: PayrollRow[] | undefined): PayrollRefreshSummary | null {
  if (!confirmation || !currentRows) return null;

  const confirmedRows = confirmation.payrollRows ?? [];
  const currentByEmployee = new Map(currentRows.map((row) => [row.employeeId, row]));
  const confirmedByEmployee = new Map(confirmedRows.map((row) => [row.employeeId, row]));
  const issues: PayrollRefreshIssue[] = [];

  for (const confirmedRow of confirmedRows) {
    const currentRow = currentByEmployee.get(confirmedRow.employeeId);
    if (!currentRow) {
      issues.push({
        employeeName: confirmedRow.employeeName,
        reasons: ["対象者または勤怠行がなくなりました"],
        totalPayDelta: -roundedPayrollValue(confirmedRow, "totalPay")
      });
      continue;
    }

    const reasons: string[] = [];
    if (
      roundedPayrollValue(currentRow, "workDays") !== roundedPayrollValue(confirmedRow, "workDays")
      || roundedPayrollValue(currentRow, "workMinutes") !== roundedPayrollValue(confirmedRow, "workMinutes")
      || roundedPayrollValue(currentRow, "nightMinutes") !== roundedPayrollValue(confirmedRow, "nightMinutes")
      || roundedPayrollValue(currentRow, "overtimeMinutes") !== roundedPayrollValue(confirmedRow, "overtimeMinutes")
    ) {
      addUniqueReason(reasons, "勤怠時間");
    }
    if (roundedPayrollValue(currentRow, "basePay") !== roundedPayrollValue(confirmedRow, "basePay")) {
      addUniqueReason(reasons, "給与");
    }
    if (roundedPayrollValue(currentRow, "commuteAllowance") !== roundedPayrollValue(confirmedRow, "commuteAllowance")) {
      addUniqueReason(reasons, "交通費");
    }
    if (
      roundedPayrollValue(currentRow, "socialInsurance") !== roundedPayrollValue(confirmedRow, "socialInsurance")
      || roundedPayrollValue(currentRow, "employmentInsurance") !== roundedPayrollValue(confirmedRow, "employmentInsurance")
      || roundedPayrollValue(currentRow, "incomeTax") !== roundedPayrollValue(confirmedRow, "incomeTax")
      || roundedPayrollValue(currentRow, "residentTax") !== roundedPayrollValue(confirmedRow, "residentTax")
    ) {
      addUniqueReason(reasons, "控除");
    }
    if ((currentRow.alerts ?? []).join("|") !== (confirmedRow.alerts ?? []).join("|")) {
      addUniqueReason(reasons, "確認アラート");
    }
    const totalPayDelta = roundedPayrollValue(currentRow, "totalPay") - roundedPayrollValue(confirmedRow, "totalPay");
    if (reasons.length || totalPayDelta !== 0) {
      if (!reasons.length) addUniqueReason(reasons, "差引支給額");
      issues.push({
        employeeName: currentRow.employeeName || confirmedRow.employeeName,
        reasons,
        totalPayDelta
      });
    }
  }

  for (const currentRow of currentRows) {
    if (confirmedByEmployee.has(currentRow.employeeId)) continue;
    issues.push({
      employeeName: currentRow.employeeName,
      reasons: ["対象者または勤怠行が追加されました"],
      totalPayDelta: roundedPayrollValue(currentRow, "totalPay")
    });
  }

  if (!issues.length) return null;

  const sortedIssues = [...issues].sort((a, b) => Math.abs(b.totalPayDelta) - Math.abs(a.totalPayDelta));
  const visibleIssues = sortedIssues.slice(0, 3);
  const hiddenCount = sortedIssues.length - visibleIssues.length;
  const detail = [
    `${issues.length}名に差分があります。`,
    visibleIssues.map((issue) => `${issue.employeeName}: ${issue.reasons.join("・")}（差引 ${formatSignedMoney(issue.totalPayDelta)}）`).join(" / "),
    hiddenCount > 0 ? `ほか${hiddenCount}名` : ""
  ].filter(Boolean).join(" ");

  return { issues: sortedIssues, detail };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPayrollStatementFilename(row: PayrollRow, month: string) {
  const safeName = row.employeeName.replace(/[\\/:*?"<>|]+/g, "_").trim() || "employee";
  return `給与明細${month.replace("-", "年")}月_${safeName}.pdf`;
}

function buildPayrollStatementPrintHtml(row: PayrollRow, days: DailySummary[], month: string, periodLabel: string) {
  const dailyRows = days.length
    ? days.map((day) => `
      <tr>
        <td>${escapeHtml(day.workDate)}</td>
        <td>${escapeHtml(day.storeName)}</td>
        <td>${escapeHtml(formatJstTime(day.clockIn) ?? "--:--")} - ${escapeHtml(formatJstTime(day.clockOut) ?? "--:--")}</td>
        <td>${escapeHtml(formatDuration(day.workMinutes))}</td>
        <td>${escapeHtml(formatDuration(day.breakMinutes))}</td>
        <td>${escapeHtml(formatDuration(day.nightMinutes))}</td>
        <td>${escapeHtml(day.alerts.length ? day.alerts.join("、") : "OK")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">この従業員の打刻実績はまだありません。</td></tr>`;

  const detailRows = [
    ["勤務日数", `${row.workDays}日 / ${row.punchCount}回`],
    ["勤務時間", formatDuration(row.workMinutes)],
    ["時間外", `${formatPayrollDetailMoney(row.overtimePay ?? 0)} / ${formatDuration(row.overtimeMinutes ?? 0)}`],
    ["深夜割増", `${formatPayrollDetailMoney(row.nightPremiumPay ?? 0)} / ${formatDuration(row.nightMinutes)}`],
    ["基本給", formatMoney(row.regularPay ?? row.basePay)],
    ["交通費", formatMoney(row.commuteAllowance)],
    ["社会保険", formatMoney(row.socialInsurance ?? 0)],
    ["雇用保険", formatMoney(row.employmentInsurance ?? 0)],
    ["源泉所得税", formatMoney(row.incomeTax ?? 0)],
    ["住民税", formatMoney(row.residentTax ?? 0)],
    ["差引支給額", formatMoney(row.totalPay)]
  ];

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(getPayrollStatementFilename(row, month))}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eef2f5;
      color: #16211f;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
      font-size: 12px;
      line-height: 1.5;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 16px auto;
      padding: 18mm;
      background: white;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.15);
    }
    .print-actions {
      position: sticky;
      top: 0;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px;
      background: rgba(238, 242, 245, 0.92);
      backdrop-filter: blur(8px);
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 9px 14px;
      background: #137a5f;
      color: white;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 650;
      letter-spacing: 0;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 2px solid #16211f;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .meta {
      color: #64736f;
      text-align: right;
    }
    .employee {
      margin-bottom: 18px;
      padding: 12px 14px;
      border: 1px solid #d8e2df;
      border-radius: 8px;
      background: #f7faf9;
    }
    .employee strong {
      display: block;
      font-size: 18px;
      font-weight: 650;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border: 1px solid #d8e2df;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 18px;
    }
    .summary div {
      padding: 10px 12px;
      border-right: 1px solid #d8e2df;
      background: #fbfdfc;
    }
    .summary div:last-child { border-right: 0; }
    .summary span {
      display: block;
      color: #64736f;
      font-size: 11px;
      font-weight: 600;
    }
    .summary strong {
      display: block;
      margin-top: 4px;
      font-size: 18px;
      font-weight: 650;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      page-break-inside: auto;
    }
    th, td {
      border: 1px solid #d8e2df;
      padding: 8px 9px;
      text-align: left;
      vertical-align: top;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th {
      background: #eff5f3;
      color: #41504c;
      font-weight: 650;
    }
    td:last-child,
    .amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .total-row th,
    .total-row td {
      background: #e9f6f1;
      font-size: 15px;
      font-weight: 650;
    }
    .head,
    .employee,
    .summary {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    @page { size: A4; margin: 14mm 12mm; }
    @media print {
      body { background: white; }
      .print-actions { display: none; }
      .sheet {
        width: auto;
        min-height: 0;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button type="button" onclick="window.print()">PDFとして保存 / 印刷</button>
  </div>
  <main class="sheet">
    <header class="head">
      <div>
        <h1>給与明細</h1>
        <p>${escapeHtml(periodLabel)}</p>
      </div>
      <div class="meta">
        <p>Foundr1 OS</p>
        <p>${escapeHtml(new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}</p>
      </div>
    </header>
    <section class="employee">
      <span>従業員</span>
      <strong>${escapeHtml(row.employeeName)}</strong>
      <span>${escapeHtml(row.storeNames.join("、") || "店舗未設定")}</span>
    </section>
    <section class="summary">
      <div><span>勤務日数</span><strong>${escapeHtml(`${row.workDays}日`)}</strong></div>
      <div><span>勤務時間</span><strong>${escapeHtml(formatDuration(row.workMinutes))}</strong></div>
      <div><span>総支給額</span><strong>${escapeHtml(formatMoney(row.basePay + row.commuteAllowance))}</strong></div>
      <div><span>差引支給額</span><strong>${escapeHtml(formatMoney(row.totalPay))}</strong></div>
    </section>
    <table>
      <tbody>
        ${detailRows.map(([label, value]) => `
          <tr class="${label === "差引支給額" ? "total-row" : ""}">
            <th>${escapeHtml(label)}</th>
            <td class="amount">${escapeHtml(value)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <table>
      <thead>
        <tr>
          <th>日付</th>
          <th>店舗</th>
          <th>出退勤</th>
          <th>勤務時間</th>
          <th>休憩</th>
          <th>深夜</th>
          <th>確認</th>
        </tr>
      </thead>
      <tbody>${dailyRows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="metric-card timecard-metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getTodayJstDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getJstDateKey(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function getPayrollPeriod(month: string, store: StoreOption | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const cycleType = store?.payrollCycleType === "specified_day" ? "specified_day" : "month_end";
  const closingDay = Math.max(1, Math.min(30, Math.round(Number(store?.payrollClosingDay ?? 31) || 31)));

  if (cycleType === "specified_day") {
    const startValue = new Date(Date.UTC(year, monthIndex - 1, closingDay + 1));
    const endValue = new Date(Date.UTC(year, monthIndex, closingDay + 1));
    const displayEndValue = new Date(endValue.getTime() - 86_400_000);
    return {
      startDate: formatDateKey(startValue),
      endDate: formatDateKey(endValue),
      displayEndDate: formatDateKey(displayEndValue),
      label: `前月${closingDay + 1}日〜当月${closingDay}日`
    };
  }

  const startDate = `${match[1]}-${match[2]}-01`;
  const endValue = new Date(Date.UTC(year, monthIndex + 1, 1));
  const displayEndValue = new Date(endValue.getTime() - 86_400_000);
  return {
    startDate,
    endDate: formatDateKey(endValue),
    displayEndDate: formatDateKey(displayEndValue),
    label: "1日〜月末"
  };
}

function getPeriodDays(month: string, store: StoreOption | null) {
  const period = getPayrollPeriod(month, store);
  if (!period) return [];
  const [startYear, startMonth, startDay] = period.startDate.split("-").map(Number);
  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const [endYear, endMonth, endDay] = period.endDate.split("-").map(Number);
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  const dayCount = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return Array.from({ length: dayCount }, (_, index) => {
    const value = new Date(Date.UTC(startYear, startMonth - 1, startDay + index));
    const key = formatDateKey(value);
    const monthNumber = value.getUTCMonth() + 1;
    const day = value.getUTCDate();
    const weekday = new Date(`${key}T00:00:00+09:00`).getDay();
    return {
      key,
      label: `${monthNumber}/${day}`,
      day,
      weekdayLabel: weekdays[weekday],
      isWeekend: weekday === 0 || weekday === 6
    };
  });
}

function getWeekdayKeyForDate(dateString: string): WeekdayKey {
  const index = new Date(`${dateString}T12:00:00+09:00`).getDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[index];
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getBusinessDayForDate(businessHours: StoreBusinessHours, workDate: string) {
  return businessHours[getWeekdayKeyForDate(workDate)];
}

function getBusinessDayCloseMinutes(businessHours: StoreBusinessHours | undefined, workDate: string) {
  if (!businessHours) return null;
  const day = getBusinessDayForDate(businessHours, workDate);
  if (!day || day.closed) return null;
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  return close <= open ? close : null;
}

function isEarlyMorningBusinessDayShift(shift: ShiftEntry, businessHours: StoreBusinessHours | undefined) {
  if (!shift.scheduledStart) return false;
  const close = getBusinessDayCloseMinutes(businessHours, shift.workDate) ?? 6 * 60;
  return timeToMinutes(shift.scheduledStart) < close;
}

function getScheduledMinutesForWorkDate(shift: ShiftEntry, time: string, baseTime: string | null, businessHours: StoreBusinessHours | undefined) {
  let minutes = timeToMinutes(time);
  if (baseTime && minutes <= timeToMinutes(baseTime)) minutes += 1440;
  if (isEarlyMorningBusinessDayShift(shift, businessHours)) minutes += 1440;
  return minutes;
}

function getActualMinutesForWorkDate(value: string | null | undefined, workDate: string, shift: ShiftEntry | undefined, businessHours: StoreBusinessHours | undefined) {
  const timeText = getJstTimeText(value);
  if (!value || !timeText) return null;
  let minutes = timeToMinutes(timeText);
  const actualDate = getJstDateKey(value);
  if (actualDate) {
    const [workYear, workMonth, workDay] = workDate.split("-").map(Number);
    const [actualYear, actualMonth, actualDay] = actualDate.split("-").map(Number);
    const workUtc = Date.UTC(workYear, workMonth - 1, workDay);
    const actualUtc = Date.UTC(actualYear, actualMonth - 1, actualDay);
    minutes += Math.round((actualUtc - workUtc) / 86_400_000) * 1440;
  }
  if (shift && isEarlyMorningBusinessDayShift(shift, businessHours) && minutes < (getBusinessDayCloseMinutes(businessHours, shift.workDate) ?? 6 * 60)) {
    minutes += 1440;
  }
  return minutes;
}

function getShiftSelectionKey(selection: ShiftSelection) {
  return `${selection.employeeId}:${selection.workDate}`;
}

function getActualSelectionKey(selection: ActualSelection) {
  return `${selection.employeeId}:${selection.workDate}:${selection.shiftId ?? ""}`;
}

function compareShiftEntries(a: Pick<ShiftEntry, "scheduledStart" | "scheduledEnd" | "id">, b: Pick<ShiftEntry, "scheduledStart" | "scheduledEnd" | "id">) {
  return String(a.scheduledStart ?? "").localeCompare(String(b.scheduledStart ?? ""))
    || String(a.scheduledEnd ?? "").localeCompare(String(b.scheduledEnd ?? ""))
    || String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function getShiftDefaults(businessHours: StoreBusinessHours, workDate: string) {
  const day = getBusinessDayForDate(businessHours, workDate);
  if (day.closed) {
    return {
      scheduledStart: "",
      scheduledEnd: "",
      breakMinutes: "0",
      note: "休業日"
    };
  }
  const openMinutes = timeToMinutes(day.open);
  const closeMinutes = timeToMinutes(day.close);
  const crossesMidnight = closeMinutes <= openMinutes;
  const workMinutes = (crossesMidnight ? closeMinutes + 1440 : closeMinutes) - openMinutes;
  return {
    scheduledStart: day.open,
    scheduledEnd: day.close,
    breakMinutes: workMinutes >= 360 ? "60" : "0",
    note: ""
  };
}

function getShiftPatterns(businessHours: StoreBusinessHours, workDate: string) {
  const day = getBusinessDayForDate(businessHours, workDate);
  if (day.closed) return [];

  const openMinutes = timeToMinutes(day.open);
  const closeMinutes = timeToMinutes(day.close);
  const adjustedClose = closeMinutes <= openMinutes ? closeMinutes + 1440 : closeMinutes;
  const duration = adjustedClose - openMinutes;
  const middle = openMinutes + Math.floor(duration / 2);
  const shortEnd = Math.min(adjustedClose, openMinutes + 360);

  return [
    { label: "営業通し", start: day.open, end: day.close, breakMinutes: duration >= 360 ? "60" : "0" },
    { label: "開店", start: day.open, end: minutesToTime(middle), breakMinutes: duration >= 480 ? "45" : "0" },
    { label: "後半", start: minutesToTime(middle), end: day.close, breakMinutes: duration >= 480 ? "45" : "0" },
    { label: "短時間", start: day.open, end: minutesToTime(shortEnd), breakMinutes: "0" }
  ] satisfies ShiftPattern[];
}

function formatMinuteRange(start: number, end: number) {
  return `${minutesToTime(start)}-${minutesToTime(end)}`;
}

function renderMissingShiftRanges(missingLabel: string) {
  return missingLabel.split("、").map((range) => {
    const [start, end] = range.split("-");
    if (!start || !end) return <span className="shift-support-range" key={range}>{range}</span>;
    return (
      <span className="shift-support-range" key={range}>
        <span>{start}</span>
        <span className="shift-support-dash">-</span>
        <span>{end}</span>
      </span>
    );
  });
}

function getJstTimeText(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function getActualStatus(actual: DailySummary | undefined, shift: ShiftEntry | undefined, isFutureDate = false, businessHours?: StoreBusinessHours) {
  if (!actual) {
    return shift && !isFutureDate ? { className: " is-missing", label: "未打刻" } satisfies ActualStatus : { className: "", label: "" } satisfies ActualStatus;
  }

  const labels = [...actual.alerts];
  if (shift?.scheduledStart && shift.scheduledEnd && actual.clockIn && actual.clockOut) {
    const scheduledStart = getScheduledMinutesForWorkDate(shift, shift.scheduledStart, null, businessHours);
    const scheduledEnd = getScheduledMinutesForWorkDate(shift, shift.scheduledEnd, shift.scheduledStart, businessHours);
    const actualStart = getActualMinutesForWorkDate(actual.clockIn, shift.workDate, shift, businessHours);
    const actualEndBase = getActualMinutesForWorkDate(actual.clockOut, shift.workDate, shift, businessHours);
    const actualEnd = actualStart !== null && actualEndBase !== null && actualEndBase <= actualStart ? actualEndBase + 1440 : actualEndBase;

    if (actualStart !== null && actualStart > scheduledStart) labels.push("遅刻");
    if (actualEnd !== null && actualEnd < scheduledEnd) labels.push("早退");
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.includes("遅刻")) {
    return { className: " is-late", label: uniqueLabels.join("、") } satisfies ActualStatus;
  }
  if (uniqueLabels.includes("早退")) {
    return { className: " is-early", label: uniqueLabels.join("、") } satisfies ActualStatus;
  }
  if (uniqueLabels.length) {
    return { className: " is-missing", label: uniqueLabels.join("、") } satisfies ActualStatus;
  }
  return { className: " is-complete", label: "OK" } satisfies ActualStatus;
}

function getActualSummaryForShift(actuals: DailySummary[], shift: ShiftEntry | undefined) {
  if (!actuals.length) return undefined;
  if (!shift?.scheduledStart) return actuals[0];
  const scheduledStart = timeToMinutes(shift.scheduledStart);
  const circularDistance = (left: number, right: number) => {
    const distance = Math.abs(left - right);
    return Math.min(distance, 1440 - distance);
  };
  return [...actuals].sort((a, b) => {
    const aTime = timeToMinutes(getJstTimeText(a.clockIn) ?? "00:00");
    const bTime = timeToMinutes(getJstTimeText(b.clockIn) ?? "00:00");
    return circularDistance(aTime, scheduledStart) - circularDistance(bTime, scheduledStart);
  })[0];
}

const scheduleOwnerRoles = new Set(["owner", "store_owner"]);

function compareScheduleEmployees(a: TimecardEmployee, b: TimecardEmployee) {
  const ownerRankA = scheduleOwnerRoles.has(a.role) ? 1 : 0;
  const ownerRankB = scheduleOwnerRoles.has(b.role) ? 1 : 0;
  return ownerRankA - ownerRankB || a.name.localeCompare(b.name, "ja", { numeric: true, sensitivity: "base" });
}

function getShiftEditorPosition(anchor: HTMLElement): ShiftEditorPosition {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const panelWidth = Math.min(900, Math.max(320, viewportWidth - margin * 2));
  const estimatedPanelHeight = 340;
  const minLeft = viewportLeft + margin;
  const maxLeft = viewportLeft + viewportWidth - panelWidth - margin;
  const left = Math.max(minLeft, Math.min(rect.left, maxLeft));
  const belowTop = rect.bottom + gap;
  const viewportBottom = viewportTop + viewportHeight;
  const top = belowTop + estimatedPanelHeight <= viewportBottom - margin
    ? belowTop
    : Math.max(viewportTop + margin, rect.top - estimatedPanelHeight - gap);

  return {
    top: Math.round(top),
    left: Math.round(left)
  };
}

function getEffectivePayrollSetting(employee: TimecardEmployee | undefined, storeId: string, workDate: string) {
  const settings = (employee?.storePayrollSettings ?? [])
    .filter((setting) => setting.storeId === storeId && setting.wageValidFrom <= workDate)
    .sort((a, b) => b.wageValidFrom.localeCompare(a.wageValidFrom));
  return settings[0] ?? employee?.storePayrollSettings?.find((setting) => setting.storeId === storeId);
}

function getEffectiveCommuteSetting(employee: TimecardEmployee | undefined, storeId: string, workDate: string) {
  const settings = (employee?.storePayrollSettings ?? [])
    .filter((setting) => setting.storeId === storeId && setting.commuteValidFrom <= workDate)
    .sort((a, b) => b.commuteValidFrom.localeCompare(a.commuteValidFrom));
  return settings[0] ?? employee?.storePayrollSettings?.find((setting) => setting.storeId === storeId);
}

function getShiftWorkMinutes(shift: ShiftEntry | undefined) {
  if (!shift?.scheduledStart || !shift.scheduledEnd) return 0;
  const start = timeToMinutes(shift.scheduledStart);
  const endBase = timeToMinutes(shift.scheduledEnd);
  const end = endBase <= start ? endBase + 1440 : endBase;
  return Math.max(0, end - start - shift.breakMinutes);
}

function getShiftNightMinutes(shift: ShiftEntry | undefined) {
  if (!shift?.scheduledStart || !shift.scheduledEnd) return 0;
  const start = timeToMinutes(shift.scheduledStart);
  const endBase = timeToMinutes(shift.scheduledEnd);
  const end = endBase <= start ? endBase + 1440 : endBase;
  let grossNightMinutes = 0;
  for (let minute = start; minute < end; minute += 1) {
    const hour = Math.floor((minute % 1440) / 60);
    if (hour >= 22 || hour < 5) grossNightMinutes += 1;
  }
  return Math.min(grossNightMinutes, getShiftWorkMinutes(shift));
}

type ScheduledCostEstimate = {
  payrollCost: number;
  commuteAllowance: number;
  workMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
};

const scheduledDailyLegalWorkMinutes = 8 * 60;
const scheduledOvertimePremiumRate = 1.25;
const scheduledNightPremiumRate = 0.25;

function getScheduledPayrollHourlyBase(setting: TimecardStorePayrollSetting) {
  if (setting.employmentType === "monthly") {
    const prescribedMinutes = Number(setting.prescribedMonthlyWorkMinutes ?? 0);
    if (!Number.isFinite(prescribedMinutes) || prescribedMinutes <= 0) return 0;
    return (setting.monthlySalary ?? 0) / (prescribedMinutes / 60);
  }
  return setting.hourlyWage ?? 0;
}

function estimateScheduledLaborCost(employee: TimecardEmployee, storeId: string, shifts: ShiftEntry[]) {
  let payrollCost = 0;
  let monthlyCost = 0;
  for (const shift of shifts) {
    const setting = getEffectivePayrollSetting(employee, storeId, shift.workDate);
    if (!setting?.payrollEnabled) continue;
    const workMinutes = getShiftWorkMinutes(shift);
    const overtimeMinutes = Math.max(0, workMinutes - scheduledDailyLegalWorkMinutes);
    const regularMinutes = workMinutes - overtimeMinutes;
    const nightMinutes = getShiftNightMinutes(shift);
    const hourlyBase = getScheduledPayrollHourlyBase(setting);
    if (setting.employmentType === "monthly") {
      monthlyCost = Math.max(monthlyCost, Math.ceil(setting.monthlySalary ?? 0));
      payrollCost += Math.ceil(
        (overtimeMinutes / 60) * hourlyBase * scheduledOvertimePremiumRate
        + (nightMinutes / 60) * hourlyBase * scheduledNightPremiumRate
      );
    } else {
      payrollCost += Math.ceil(
        (regularMinutes / 60) * hourlyBase
        + (overtimeMinutes / 60) * hourlyBase * scheduledOvertimePremiumRate
        + (nightMinutes / 60) * hourlyBase * scheduledNightPremiumRate
      );
    }
  }
  return payrollCost + monthlyCost;
}

function estimateScheduledCost(employee: TimecardEmployee, storeId: string, shifts: ShiftEntry[]): ScheduledCostEstimate {
  const payrollCost = estimateScheduledLaborCost(employee, storeId, shifts);
  let commuteAllowance = 0;
  let workMinutes = 0;
  let nightMinutes = 0;
  let overtimeMinutes = 0;
  const commuteWorkDatesBySetting = new Map<TimecardStorePayrollSetting, Set<string>>();

  for (const shift of shifts) {
    const shiftWorkMinutes = getShiftWorkMinutes(shift);
    if (shiftWorkMinutes <= 0) continue;
    workMinutes += shiftWorkMinutes;
    nightMinutes += getShiftNightMinutes(shift);
    overtimeMinutes += Math.max(0, shiftWorkMinutes - scheduledDailyLegalWorkMinutes);
    const setting = getEffectiveCommuteSetting(employee, storeId, shift.workDate);
    if (!setting?.payrollEnabled || setting.commuteAllowancePerWorkday <= 0) continue;
    const workDates = commuteWorkDatesBySetting.get(setting) ?? new Set<string>();
    workDates.add(shift.workDate);
    commuteWorkDatesBySetting.set(setting, workDates);
  }

  for (const [setting, workDates] of commuteWorkDatesBySetting.entries()) {
    const uncappedAllowance = Math.ceil(workDates.size * setting.commuteAllowancePerWorkday);
    commuteAllowance += setting.commuteAllowanceMonthlyCap === null
      ? uncappedAllowance
      : Math.min(uncappedAllowance, Math.ceil(setting.commuteAllowanceMonthlyCap));
  }

  return { payrollCost, commuteAllowance, workMinutes, nightMinutes, overtimeMinutes };
}

function estimateScheduledDailyCost(employee: TimecardEmployee, storeId: string, shifts: ShiftEntry[]): ScheduledCostEstimate {
  let payrollCost = 0;
  let workMinutes = 0;
  let nightMinutes = 0;
  let overtimeMinutes = 0;

  for (const shift of shifts) {
    const setting = getEffectivePayrollSetting(employee, storeId, shift.workDate);
    const shiftWorkMinutes = getShiftWorkMinutes(shift);
    if (shiftWorkMinutes <= 0) continue;

    workMinutes += shiftWorkMinutes;
    const shiftNightMinutes = getShiftNightMinutes(shift);
    const shiftOvertimeMinutes = Math.max(0, shiftWorkMinutes - scheduledDailyLegalWorkMinutes);
    const regularMinutes = shiftWorkMinutes - shiftOvertimeMinutes;
    nightMinutes += shiftNightMinutes;
    overtimeMinutes += shiftOvertimeMinutes;

    if (!setting?.payrollEnabled) continue;
    const hourlyBase = getScheduledPayrollHourlyBase(setting);
    payrollCost += Math.ceil(
      (regularMinutes / 60) * hourlyBase
      + (shiftOvertimeMinutes / 60) * hourlyBase * scheduledOvertimePremiumRate
      + (shiftNightMinutes / 60) * hourlyBase * scheduledNightPremiumRate
    );
  }

  return { payrollCost, commuteAllowance: 0, workMinutes, nightMinutes, overtimeMinutes };
}

function getDayCoverage(businessHours: StoreBusinessHours, workDate: string, shifts: ShiftEntry[]) {
  const day = getBusinessDayForDate(businessHours, workDate);
  if (day.closed) {
    return { status: "closed", missingLabel: "" } satisfies DayCoverage;
  }

  const businessStart = timeToMinutes(day.open);
  const businessEndBase = timeToMinutes(day.close);
  const businessEnd = businessEndBase <= businessStart ? businessEndBase + 1440 : businessEndBase;
  const intervals = shifts
    .filter((shift) => shift.workDate === workDate && shift.scheduledStart && shift.scheduledEnd)
    .map((shift) => {
      const start = getScheduledMinutesForWorkDate(shift, shift.scheduledStart as string, null, businessHours);
      const end = getScheduledMinutesForWorkDate(shift, shift.scheduledEnd as string, shift.scheduledStart as string, businessHours);
      return {
        start: Math.max(start, businessStart),
        end: Math.min(end, businessEnd)
      };
    })
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  const missing: Array<{ start: number; end: number }> = [];
  let coveredUntil = businessStart;

  for (const interval of intervals) {
    if (interval.start > coveredUntil) {
      missing.push({ start: coveredUntil, end: interval.start });
    }
    coveredUntil = Math.max(coveredUntil, interval.end);
  }

  if (coveredUntil < businessEnd) {
    missing.push({ start: coveredUntil, end: businessEnd });
  }

  if (!missing.length) {
    return { status: "covered", missingLabel: "" } satisfies DayCoverage;
  }

  return {
    status: "uncovered",
    missingLabel: missing.map((range) => formatMinuteRange(range.start, range.end)).join("、")
  } satisfies DayCoverage;
}

type TimecardMainView = "overview" | "schedule" | "payroll";
type TimecardScheduleView = "planned" | "actual";
type TimecardPayrollView = "summary" | "employee";

function getTimecardPageTitle(mainView: TimecardMainView) {
  if (mainView === "schedule") return "シフト";
  if (mainView === "payroll") return "給与";
  return "タイムカード";
}

const timecardMonthStorageKey = "foundr1:timecard:selected-month";
const timecardStoreStorageKey = "foundr1:timecard:selected-store-id";

function getStoredTimecardMonth() {
  if (typeof window === "undefined") return getJstMonthLabel();
  const stored = window.localStorage.getItem(timecardMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getJstMonthLabel();
}

function getStoredTimecardStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(timecardStoreStorageKey) ?? "";
}

function storeTimecardSelection(nextMonth: string, nextStoreId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(timecardMonthStorageKey, nextMonth);
  if (nextStoreId) window.localStorage.setItem(timecardStoreStorageKey, nextStoreId);
}

function addTimecardMonths(month: string, offset: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return getJstMonthLabel();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatTimecardMonthHeading(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}年 ${match[2]}月度`;
}

function MonthNavigator({
  month,
  isLoading,
  onChange
}: {
  month: string;
  isLoading: boolean;
  onChange: (nextMonth: string) => void;
}) {
  const currentMonth = getJstMonthLabel();
  return (
    <div className="timecard-month-navigator" aria-label="月度選択">
      <strong className="timecard-month-heading">{formatTimecardMonthHeading(month)}</strong>
      <div className="timecard-month-controls">
        <button className="timecard-month-step" type="button" disabled={isLoading} aria-label="前月" onClick={() => onChange(addTimecardMonths(month, -1))}>
          <ChevronLeft size={16} />
        </button>
        <label className="timecard-month-picker" aria-label="月度を選択">
          <CalendarDays size={15} />
          <input type="month" value={month} disabled={isLoading} onChange={(event) => onChange(event.target.value)} />
        </label>
        <button className="timecard-month-today" type="button" disabled={isLoading || month === currentMonth} onClick={() => onChange(currentMonth)}>
          今月
        </button>
        <button className="timecard-month-step" type="button" disabled={isLoading} aria-label="翌月" onClick={() => onChange(addTimecardMonths(month, 1))}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function TimecardPage({
  initialMainView = "overview",
  initialScheduleView = "planned",
  initialPayrollView = "summary"
}: {
  initialMainView?: TimecardMainView;
  initialScheduleView?: TimecardScheduleView;
  initialPayrollView?: TimecardPayrollView;
}) {
  const [data, setData] = useState<TimecardPayload | null>(null);
  const [month, setMonth] = useState(getStoredTimecardMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mainView] = useState<TimecardMainView>(initialMainView);
  const [scheduleView, setScheduleView] = useState<TimecardScheduleView>(initialScheduleView);
  const [payrollView, setPayrollView] = useState<TimecardPayrollView>(initialPayrollView);
  const [selectedPayrollEmployeeId, setSelectedPayrollEmployeeId] = useState("");
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft | null>(null);
  const [shiftEditorPosition, setShiftEditorPosition] = useState<ShiftEditorPosition | null>(null);
  const [actualEditorPosition, setActualEditorPosition] = useState<ShiftEditorPosition | null>(null);
  const [isShiftMultiSelectMode, setIsShiftMultiSelectMode] = useState(false);
  const [selectedShiftCells, setSelectedShiftCells] = useState<ShiftSelection[]>([]);
  const [bulkShiftDraft, setBulkShiftDraft] = useState({
    scheduledStart: "",
    scheduledEnd: "",
    breakMinutes: "60",
    note: ""
  });
  const [actualDraft, setActualDraft] = useState<ActualDraft | null>(null);
  const [isActualMultiSelectMode, setIsActualMultiSelectMode] = useState(false);
  const [selectedActualCells, setSelectedActualCells] = useState<ActualSelection[]>([]);
  const [bulkActualDraft, setBulkActualDraft] = useState<ActualBulkDraft>({
    clockIn: "",
    clockOut: "",
    breakStart1: "",
    breakEnd1: "",
    breakStart2: "",
    breakEnd2: "",
    note: ""
  });
  const [shiftMessage, setShiftMessage] = useState("");
  const [isSavingShift, setIsSavingShift] = useState(false);
  const [isConfirmingPayroll, setIsConfirmingPayroll] = useState(false);
  const [isCreatingPayrollPayment, setIsCreatingPayrollPayment] = useState(false);
  const [isPayrollPaymentOpen, setIsPayrollPaymentOpen] = useState(false);
  const [payrollPaymentMessage, setPayrollPaymentMessage] = useState("");
  const [payrollPaymentBatches, setPayrollPaymentBatches] = useState<PayrollPaymentBatch[]>([]);
  const [attendanceCsvFile, setAttendanceCsvFile] = useState<File | null>(null);
  const [attendanceImportMessage, setAttendanceImportMessage] = useState("");
  const [isImportingAttendance, setIsImportingAttendance] = useState(false);
  const [isAttendanceImportOpen, setIsAttendanceImportOpen] = useState(false);
  const [isCalendarManagerOpen, setIsCalendarManagerOpen] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [calendarMessage, setCalendarMessage] = useState("");
  const [isSavingCalendar, setIsSavingCalendar] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventDraft>({
    title: "",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    category: "local_event",
    impactLevel: "busy",
    flowDirection: "mixed",
    impactStartTime: "",
    impactEndTime: "",
    venue: "",
    note: ""
  });
  const shiftMessageTimerRef = useRef<number | null>(null);

  async function loadTimecard(nextMonth = month, nextStoreId = selectedStoreId, options: { keepShiftDraft?: boolean; keepActualDraft?: boolean } = {}) {
    setIsLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ month: nextMonth });
      if (nextStoreId) params.set("storeId", nextStoreId);
      const response = await fetch(`/api/timecard?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setLoadError(String(body.error ?? "タイムカード情報を読み込めませんでした。"));
        return;
      }
      const body = await response.json() as TimecardPayload;
      setData(body);
      setMonth(body.month);
      setSelectedStoreId(body.selectedStoreId);
      storeTimecardSelection(body.month, body.selectedStoreId);
      if (body.canViewPayroll) {
        void loadPayrollPaymentBatches(body.month, body.selectedStoreId);
      } else {
        setPayrollPaymentBatches([]);
      }
      if (!options.keepShiftDraft) {
        setShiftDraft(null);
        setShiftEditorPosition(null);
      }
      if (!options.keepActualDraft) {
        setActualDraft(null);
        setActualEditorPosition(null);
      }
    } catch {
      setLoadError("タイムカード情報を読み込めませんでした。データベース接続を確認してください。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTimecard(getStoredTimecardMonth(), getStoredTimecardStoreId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeTimecardMonth(nextMonth: string) {
    setMonth(nextMonth);
    storeTimecardSelection(nextMonth, selectedStoreId);
    setIsShiftMultiSelectMode(false);
    setSelectedShiftCells([]);
    setIsActualMultiSelectMode(false);
    setSelectedActualCells([]);
    setSelectedCalendarDate("");
    void loadTimecard(nextMonth, selectedStoreId);
  }

  useEffect(() => () => {
    if (shiftMessageTimerRef.current) {
      window.clearTimeout(shiftMessageTimerRef.current);
    }
  }, []);

  const totals = data?.payrollTotals ?? {
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
  const attendanceTotals = useMemo(() => {
    const dailySummaries = data?.dailySummaries ?? [];
    return dailySummaries.reduce((acc, day) => ({
      workDays: acc.workDays + (day.workMinutes > 0 ? 1 : 0),
      punchCount: acc.punchCount + 1,
      workMinutes: acc.workMinutes + day.workMinutes,
      nightMinutes: acc.nightMinutes + day.nightMinutes
    }), {
      workDays: 0,
      punchCount: 0,
      workMinutes: 0,
      nightMinutes: 0
    });
  }, [data?.dailySummaries]);
  const canViewPayroll = Boolean(data?.canViewPayroll);
  const visibleNavItems = useMemo(
    () => canViewPayroll ? navItems : navItems.filter((item) => item.href !== "/os/timecard/payroll"),
    [canViewPayroll]
  );
  const payrollConfirmation = data?.payrollConfirmation ?? null;
  const payrollRefreshSummary = useMemo(
    () => summarizePayrollRefresh(payrollConfirmation, data?.payrollRows),
    [data?.payrollRows, payrollConfirmation]
  );
  const payrollConfirmationNeedsRefresh = Boolean(payrollRefreshSummary);
  const displayedPayrollRows = payrollConfirmation
    ? payrollConfirmation.payrollRows
    : data?.payrollRows ?? [];
  const displayedPayrollTotals = payrollConfirmation
    ? payrollConfirmation.payrollTotals
    : totals;
  const selectedPayrollRow = useMemo(
    () => canViewPayroll ? displayedPayrollRows.find((row) => row.employeeId === selectedPayrollEmployeeId) ?? displayedPayrollRows[0] ?? null : null,
    [canViewPayroll, displayedPayrollRows, selectedPayrollEmployeeId]
  );
  const selectedPayrollDays = useMemo(
    () => data?.dailySummaries.filter((day) => day.employeeId === selectedPayrollRow?.employeeId) ?? [],
    [data, selectedPayrollRow]
  );
  const selectedStore = data?.stores.find((store) => store.id === selectedStoreId) ?? null;
  const payrollPeriod = useMemo(
    () => getPayrollPeriod(month, selectedStore),
    [month, selectedStore]
  );
  const canConfirmPayrollPeriod = Boolean(payrollPeriod && getTodayJstDateKey() >= payrollPeriod.endDate);
  const canCreatePayrollPaymentFile = Boolean(payrollConfirmation && displayedPayrollRows.length);
  const displayedPayrollEmployeeCount = displayedPayrollRows.length;
  const monthDays = useMemo(() => getPeriodDays(month, selectedStore), [month, selectedStore]);
  const todayKey = getTodayJstDateKey();
  const selectedStoreBusinessHours = useMemo(
    () => normalizeBusinessHours(selectedStore?.businessHours),
    [selectedStore?.businessHours]
  );
  const selectedDraftBusinessDay = shiftDraft
    ? getBusinessDayForDate(selectedStoreBusinessHours, shiftDraft.workDate)
    : null;
  const selectedDraftPatterns = shiftDraft
    ? getShiftPatterns(selectedStoreBusinessHours, shiftDraft.workDate)
    : [];
  const shiftEditorStyle = shiftEditorPosition
    ? ({ top: shiftEditorPosition.top, left: shiftEditorPosition.left } satisfies CSSProperties)
    : undefined;
  const actualEditorStyle = actualEditorPosition
    ? ({ top: actualEditorPosition.top, left: actualEditorPosition.left } satisfies CSSProperties)
    : undefined;
  const scheduleEmployees = useMemo(
    () => (data?.employees.filter((employee) => employee.storeIds.includes(selectedStoreId)) ?? []).sort(compareScheduleEmployees),
    [data, selectedStoreId]
  );
  const shiftsByCell = useMemo(() => {
    const map = new Map<string, ShiftEntry[]>();
    for (const shift of data?.shifts ?? []) {
      const key = `${shift.employeeId}:${shift.workDate}`;
      map.set(key, [...(map.get(key) ?? []), shift].sort(compareShiftEntries));
    }
    return map;
  }, [data?.shifts]);
  const scheduledCostByEmployee = useMemo(() => {
    const map = new Map<string, ScheduledCostEstimate>();
    const employeesById = new Map((data?.employees ?? []).map((employee) => [employee.id, employee]));
    for (const employee of scheduleEmployees) {
      const employeeShifts = (data?.shifts ?? []).filter((shift) => shift.employeeId === employee.id && shift.storeId === selectedStoreId);
      map.set(employee.id, estimateScheduledCost(employeesById.get(employee.id) ?? employee, selectedStoreId, employeeShifts));
    }
    return map;
  }, [data?.employees, data?.shifts, scheduleEmployees, selectedStoreId]);
  const scheduledCostTotals = useMemo(() => {
    const totals: ScheduledCostEstimate = { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
    for (const cost of scheduledCostByEmployee.values()) {
      totals.payrollCost += cost.payrollCost;
      totals.commuteAllowance += cost.commuteAllowance;
      totals.workMinutes += cost.workMinutes;
      totals.nightMinutes += cost.nightMinutes;
      totals.overtimeMinutes += cost.overtimeMinutes;
    }
    return totals;
  }, [scheduledCostByEmployee]);
  const scheduledCostByDate = useMemo(() => {
    const map = new Map<string, ScheduledCostEstimate>();
    const employeesById = new Map((data?.employees ?? []).map((employee) => [employee.id, employee]));
    for (const day of monthDays) {
      const totals: ScheduledCostEstimate = { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
      for (const scheduleEmployee of scheduleEmployees) {
        const employee = employeesById.get(scheduleEmployee.id) ?? scheduleEmployee;
        const shifts = (data?.shifts ?? []).filter((shift) => shift.employeeId === employee.id && shift.storeId === selectedStoreId && shift.workDate === day.key);
        const cost = estimateScheduledDailyCost(employee, selectedStoreId, shifts);
        totals.payrollCost += cost.payrollCost;
        totals.workMinutes += cost.workMinutes;
        totals.nightMinutes += cost.nightMinutes;
        totals.overtimeMinutes += cost.overtimeMinutes;
      }
      map.set(day.key, totals);
    }
    return map;
  }, [data?.employees, data?.shifts, monthDays, scheduleEmployees, selectedStoreId]);
  const calendarEventsByDate = useMemo(() => {
    const map = new Map<string, BusinessCalendarEvent[]>();
    for (const day of monthDays) {
      const events = (data?.calendarEvents ?? []).filter((event) => event.startDate <= day.key && event.endDate >= day.key);
      if (events.length) map.set(day.key, events);
    }
    return map;
  }, [data?.calendarEvents, monthDays]);
  const weatherForecastByDate = useMemo(
    () => new Map((data?.weatherForecast ?? []).map((forecast) => [forecast.date, forecast])),
    [data?.weatherForecast]
  );
  const selectedCalendarEvents = selectedCalendarDate ? calendarEventsByDate.get(selectedCalendarDate) ?? [] : [];
  const selectedWeatherForecast = selectedCalendarDate ? weatherForecastByDate.get(selectedCalendarDate) ?? null : null;
  const manualCalendarEvents = useMemo(
    () => (data?.calendarEvents ?? []).filter((event) => event.sourceType === "manual" && event.storeId === selectedStoreId),
    [data?.calendarEvents, selectedStoreId]
  );
  const actualLaborCostByEmployee = useMemo(() => {
    return new Map((data?.payrollRows ?? []).map((row) => [row.employeeId, {
      payrollCost: row.basePay,
      commuteAllowance: row.commuteAllowance,
      workMinutes: row.workMinutes,
      nightMinutes: row.nightMinutes,
      overtimeMinutes: row.overtimeMinutes ?? 0
    } satisfies ScheduledCostEstimate]));
  }, [data?.payrollRows]);
  const actualLaborCostTotals = useMemo(() => {
    const totals: ScheduledCostEstimate = { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
    for (const cost of actualLaborCostByEmployee.values()) {
      totals.payrollCost += cost.payrollCost;
      totals.commuteAllowance += cost.commuteAllowance;
      totals.workMinutes += cost.workMinutes;
      totals.nightMinutes += cost.nightMinutes;
      totals.overtimeMinutes += cost.overtimeMinutes;
    }
    return totals;
  }, [actualLaborCostByEmployee]);
  const actualByCell = useMemo(() => {
    const map = new Map<string, DailySummary[]>();
    for (const day of data?.dailySummaries ?? []) {
      if (day.storeId === selectedStoreId) {
        const key = `${day.employeeId}:${day.workDate}`;
        map.set(key, [...(map.get(key) ?? []), day].sort((a, b) => String(a.clockIn ?? "").localeCompare(String(b.clockIn ?? ""))));
      }
    }
    return map;
  }, [data?.dailySummaries, selectedStoreId]);
  const actualWorkByDate = useMemo(() => {
    const map = new Map<string, ScheduledCostEstimate>();
    for (const day of monthDays) {
      map.set(day.key, { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 });
    }
    for (const summary of data?.dailySummaries ?? []) {
      if (summary.storeId !== selectedStoreId) continue;
      const current = map.get(summary.workDate) ?? { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
      current.workMinutes += summary.workMinutes;
      current.nightMinutes += summary.nightMinutes;
      map.set(summary.workDate, current);
    }
    return map;
  }, [data?.dailySummaries, monthDays, selectedStoreId]);
  const selectedShiftCellKeys = useMemo(
    () => new Set(selectedShiftCells.map(getShiftSelectionKey)),
    [selectedShiftCells]
  );
  const selectedActualCellKeys = useMemo(
    () => new Set(selectedActualCells.map(getActualSelectionKey)),
    [selectedActualCells]
  );
  const coverageByDate = useMemo(() => {
    const map = new Map<string, DayCoverage>();
    for (const day of monthDays) {
      map.set(day.key, getDayCoverage(selectedStoreBusinessHours, day.key, data?.shifts ?? []));
    }
    return map;
  }, [data?.shifts, monthDays, selectedStoreBusinessHours]);
  const uncoveredDays = useMemo(
    () => Array.from(coverageByDate.entries()).filter(([, coverage]) => coverage.status === "uncovered"),
    [coverageByDate]
  );
  const actualIssueCount = useMemo(() => {
    let count = 0;
    for (const employee of scheduleEmployees) {
      for (const day of monthDays) {
        const actuals = actualByCell.get(`${employee.id}:${day.key}`) ?? [];
        const shift = shiftsByCell.get(`${employee.id}:${day.key}`)?.[0];
        const actual = getActualSummaryForShift(actuals, shift);
        const status = getActualStatus(actual, shift, day.key > todayKey, selectedStoreBusinessHours);
        if ((status.className && status.className !== " is-complete") || actual?.isManualCorrection) count += 1;
      }
    }
    return count;
  }, [actualByCell, monthDays, scheduleEmployees, selectedStoreBusinessHours, shiftsByCell, todayKey]);
  const selectedShiftEmployee = shiftDraft
    ? scheduleEmployees.find((employee) => employee.id === shiftDraft.employeeId) ?? null
    : null;
  const selectedShiftSegments = shiftDraft
    ? shiftsByCell.get(`${shiftDraft.employeeId}:${shiftDraft.workDate}`) ?? []
    : [];
  const selectedActualEmployee = actualDraft
    ? scheduleEmployees.find((employee) => employee.id === actualDraft.employeeId) ?? null
    : null;
  const selectedActualShiftSegments = actualDraft
    ? shiftsByCell.get(`${actualDraft.employeeId}:${actualDraft.workDate}`) ?? []
    : [];
  const selectedActualShift = actualDraft
    ? shiftsByCell.get(`${actualDraft.employeeId}:${actualDraft.workDate}`)?.find((shift) => shift.id === actualDraft.shiftId) ?? shiftsByCell.get(`${actualDraft.employeeId}:${actualDraft.workDate}`)?.[0] ?? null
    : null;
  const selectedActualSummary = actualDraft
    ? getActualSummaryForShift(actualByCell.get(`${actualDraft.employeeId}:${actualDraft.workDate}`) ?? [], selectedActualShift ?? undefined) ?? null
    : null;

  useEffect(() => {
    if (selectedPayrollRow && selectedPayrollRow.employeeId !== selectedPayrollEmployeeId) {
      setSelectedPayrollEmployeeId(selectedPayrollRow.employeeId);
    }
  }, [selectedPayrollEmployeeId, selectedPayrollRow]);

  function openShiftEditor(employeeId: string, workDate: string, anchor?: HTMLElement, shiftId?: string | null) {
    const shifts = shiftsByCell.get(`${employeeId}:${workDate}`) ?? [];
    const shift = shiftId ? shifts.find((item) => item.id === shiftId) : shifts[0];
    const defaults = getShiftDefaults(selectedStoreBusinessHours, workDate);
    setIsShiftMultiSelectMode(false);
    setSelectedShiftCells([]);
    setShiftEditorPosition((current) => anchor ? getShiftEditorPosition(anchor) : current);
    clearShiftMessage();
    setShiftDraft({
      id: shift?.id ?? null,
      employeeId,
      workDate,
      scheduledStart: shift?.scheduledStart ?? defaults.scheduledStart,
      scheduledEnd: shift?.scheduledEnd ?? defaults.scheduledEnd,
      breakMinutes: String(shift?.breakMinutes ?? defaults.breakMinutes),
      note: shift?.note ?? ""
    });
  }

  function closeActualEditor() {
    setActualDraft(null);
    setActualEditorPosition(null);
  }

  function toggleShiftSelection(employeeId: string, workDate: string) {
    clearShiftMessage();
    setShiftDraft(null);
    setShiftEditorPosition(null);
    const shift = shiftsByCell.get(`${employeeId}:${workDate}`)?.[0];
    const defaults = getShiftDefaults(selectedStoreBusinessHours, workDate);
    if (!selectedShiftCells.length) {
      setBulkShiftDraft({
        scheduledStart: shift?.scheduledStart ?? defaults.scheduledStart,
        scheduledEnd: shift?.scheduledEnd ?? defaults.scheduledEnd,
        breakMinutes: String(shift?.breakMinutes ?? defaults.breakMinutes),
        note: shift?.note ?? ""
      });
    }
    setSelectedShiftCells((current) => {
      const nextSelection = { employeeId, workDate };
      const key = getShiftSelectionKey(nextSelection);
      const exists = current.some((selection) => getShiftSelectionKey(selection) === key);
      return exists
        ? current.filter((selection) => getShiftSelectionKey(selection) !== key)
        : [...current, nextSelection];
    });
  }

  function handleShiftCellClick(event: MouseEvent<HTMLButtonElement>, employeeId: string, workDate: string) {
    if (isShiftMultiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleShiftSelection(employeeId, workDate);
      return;
    }
    openShiftEditor(employeeId, workDate, event.currentTarget);
  }

  function openNewShiftSegment() {
    if (!shiftDraft) return;
    const defaults = getShiftDefaults(selectedStoreBusinessHours, shiftDraft.workDate);
    setShiftDraft({
      id: null,
      employeeId: shiftDraft.employeeId,
      workDate: shiftDraft.workDate,
      scheduledStart: defaults.scheduledStart,
      scheduledEnd: defaults.scheduledEnd,
      breakMinutes: defaults.breakMinutes,
      note: ""
    });
  }

  function clearShiftMessage() {
    if (shiftMessageTimerRef.current) {
      window.clearTimeout(shiftMessageTimerRef.current);
      shiftMessageTimerRef.current = null;
    }
    setShiftMessage("");
  }

  function showShiftMessage(message: string, timeoutMs = 2200) {
    if (shiftMessageTimerRef.current) {
      window.clearTimeout(shiftMessageTimerRef.current);
    }
    setShiftMessage(message);
    shiftMessageTimerRef.current = window.setTimeout(() => {
      setShiftMessage("");
      shiftMessageTimerRef.current = null;
    }, timeoutMs);
  }

  async function saveShift(nextDraft = shiftDraft) {
    if (!nextDraft || !selectedStoreId) return;
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_shift",
        shiftId: nextDraft.id ?? null,
        storeId: selectedStoreId,
        employeeId: nextDraft.employeeId,
        workDate: nextDraft.workDate,
        scheduledStart: nextDraft.scheduledStart,
        scheduledEnd: nextDraft.scheduledEnd,
        breakMinutes: nextDraft.breakMinutes,
        note: nextDraft.note
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId, { keepShiftDraft: true });
      showShiftMessage("シフトを保存しました。");
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "シフトを保存できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  async function deleteShift() {
    if (!shiftDraft || !selectedStoreId) return;
    if (!shiftDraft.id) {
      setShiftDraft(null);
      setShiftEditorPosition(null);
      return;
    }
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_shift",
        shiftId: shiftDraft.id,
        storeId: selectedStoreId,
        employeeId: shiftDraft.employeeId,
        workDate: shiftDraft.workDate
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId, { keepShiftDraft: true });
      showShiftMessage("シフトを削除しました。");
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "シフトを削除できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  function applyShiftPattern(scheduledStart: string, scheduledEnd: string, breakMinutes = "60") {
    if (!shiftDraft) return;
    const nextDraft = { ...shiftDraft, scheduledStart, scheduledEnd, breakMinutes };
    setShiftDraft(nextDraft);
    void saveShift(nextDraft);
  }

  async function saveBulkShifts(shifts: ShiftPatch[], successMessage = "選択したシフトを保存しました。") {
    if (!selectedStoreId || !shifts.length) return;
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_shifts_bulk",
        storeId: selectedStoreId,
        shifts
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId);
      showShiftMessage(successMessage);
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "選択したシフトを保存できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  async function saveSelectedShiftCells() {
    const shifts = selectedShiftCells.map((selection) => ({
      ...selection,
      scheduledStart: bulkShiftDraft.scheduledStart,
      scheduledEnd: bulkShiftDraft.scheduledEnd,
      breakMinutes: bulkShiftDraft.breakMinutes,
      note: bulkShiftDraft.note
    }));
    await saveBulkShifts(shifts);
  }

  async function applyBulkShiftPattern(patternLabel: string) {
    const shifts = selectedShiftCells.flatMap((selection) => {
      const pattern = getShiftPatterns(selectedStoreBusinessHours, selection.workDate).find((item) => item.label === patternLabel);
      if (!pattern) return [];
      return [{
        ...selection,
        scheduledStart: pattern.start,
        scheduledEnd: pattern.end,
        breakMinutes: pattern.breakMinutes,
        note: bulkShiftDraft.note
      }];
    });
    await saveBulkShifts(shifts, `${patternLabel}を選択した日付に反映しました。`);
  }

  async function deleteSelectedShiftCells() {
    if (!selectedStoreId || !selectedShiftCells.length) return;
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_shifts_bulk",
        storeId: selectedStoreId,
        shifts: selectedShiftCells
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId);
      showShiftMessage("選択したシフトを削除しました。");
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "選択したシフトを削除できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  function openActualEditor(employeeId: string, workDate: string, anchor?: HTMLElement, shiftId?: string | null) {
    const shifts = shiftsByCell.get(`${employeeId}:${workDate}`) ?? [];
    const shift = shiftId ? shifts.find((item) => item.id === shiftId) : shifts[0];
    const actual = getActualSummaryForShift(actualByCell.get(`${employeeId}:${workDate}`) ?? [], shift);
    const breakInterval1 = actual?.breakIntervals?.[0];
    const breakInterval2 = actual?.breakIntervals?.[1];
    clearShiftMessage();
    setIsActualMultiSelectMode(false);
    setSelectedActualCells([]);
    setActualEditorPosition((current) => anchor ? getShiftEditorPosition(anchor) : current);
    setActualDraft({
      shiftId: shift?.id ?? null,
      employeeId,
      workDate,
      clockIn: getJstTimeText(actual?.clockIn) ?? shift?.scheduledStart ?? "",
      clockOut: getJstTimeText(actual?.clockOut) ?? shift?.scheduledEnd ?? "",
      breakStart1: getJstTimeText(breakInterval1?.start) ?? "",
      breakEnd1: getJstTimeText(breakInterval1?.end) ?? "",
      breakStart2: getJstTimeText(breakInterval2?.start) ?? "",
      breakEnd2: getJstTimeText(breakInterval2?.end) ?? "",
      note: ""
    });
  }

  function getActualBulkDefaults(employeeId: string, workDate: string, shiftId?: string | null): ActualBulkDraft {
    const shifts = shiftsByCell.get(`${employeeId}:${workDate}`) ?? [];
    const shift = shiftId ? shifts.find((item) => item.id === shiftId) : shifts[0];
    const actual = getActualSummaryForShift(actualByCell.get(`${employeeId}:${workDate}`) ?? [], shift);
    const breakInterval1 = actual?.breakIntervals?.[0];
    const breakInterval2 = actual?.breakIntervals?.[1];
    return {
      clockIn: getJstTimeText(actual?.clockIn) ?? shift?.scheduledStart ?? "",
      clockOut: getJstTimeText(actual?.clockOut) ?? shift?.scheduledEnd ?? "",
      breakStart1: getJstTimeText(breakInterval1?.start) ?? "",
      breakEnd1: getJstTimeText(breakInterval1?.end) ?? "",
      breakStart2: getJstTimeText(breakInterval2?.start) ?? "",
      breakEnd2: getJstTimeText(breakInterval2?.end) ?? "",
      note: ""
    };
  }

  function toggleActualSelection(employeeId: string, workDate: string, shiftId?: string | null) {
    if (!data?.canEditActualTime) return;
    clearShiftMessage();
    setActualDraft(null);
    setActualEditorPosition(null);
    const selection = { employeeId, workDate, shiftId: shiftId ?? null } satisfies ActualSelection;
    if (!selectedActualCells.length) {
      setBulkActualDraft(getActualBulkDefaults(employeeId, workDate, shiftId));
    }
    setSelectedActualCells((current) => {
      const key = getActualSelectionKey(selection);
      const exists = current.some((item) => getActualSelectionKey(item) === key);
      return exists
        ? current.filter((item) => getActualSelectionKey(item) !== key)
        : [...current, selection];
    });
  }

  function handleActualCellClick(event: MouseEvent<HTMLButtonElement>, employeeId: string, workDate: string, shiftId?: string | null) {
    if (data?.canEditActualTime && (isActualMultiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      toggleActualSelection(employeeId, workDate, shiftId);
      return;
    }
    openActualEditor(employeeId, workDate, event.currentTarget, shiftId);
  }

  function openPayrollStatement(employeeId: string) {
    setSelectedPayrollEmployeeId(employeeId);
    setPayrollView("employee");
  }

  async function openPayrollStatementPdf(row: PayrollRow) {
    const statementDays = data?.dailySummaries.filter((day) => day.employeeId === row.employeeId) ?? [];
    const periodLabel = payrollPeriod
      ? `${payrollPeriod.startDate} - ${payrollPeriod.displayEndDate}`
      : month;
    try {
      const response = await fetch("/api/timecard/payroll-statement/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row,
          days: statementDays,
          month,
          periodLabel,
          companyName: selectedStore?.companyLegalName || "会社名未設定"
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "給与明細PDFを作成できませんでした。");
      }
      const blob = await response.blob();
      const nativeDownloads = (window as Window & {
        Foundr1Downloads?: {
          isAvailable?: () => boolean;
          saveBase64?: (fileName: string, mimeType: string, base64Data: string) => string;
        };
      }).Foundr1Downloads;
      if (nativeDownloads?.saveBase64 && (!nativeDownloads.isAvailable || nativeDownloads.isAvailable())) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("給与明細PDFを読み込めませんでした。"));
          reader.readAsDataURL(blob);
        });
        const result = JSON.parse(nativeDownloads.saveBase64(
          getPayrollStatementFilename(row, month),
          "application/pdf",
          dataUrl.slice(dataUrl.indexOf(",") + 1)
        )) as { ok?: boolean; error?: string };
        if (!result.ok) throw new Error(result.error || "給与明細PDFを保存できませんでした。");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getPayrollStatementFilename(row, month);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "給与明細PDFを作成できませんでした。");
    }
  }

  async function saveActualTime(nextDraft = actualDraft) {
    if (!nextDraft || !selectedStoreId) return;
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_actual_time",
        storeId: selectedStoreId,
        shiftId: nextDraft.shiftId ?? null,
        employeeId: nextDraft.employeeId,
        workDate: nextDraft.workDate,
        clockIn: nextDraft.clockIn,
        clockOut: nextDraft.clockOut,
        breakIntervals: [
          { start: nextDraft.breakStart1, end: nextDraft.breakEnd1 },
          { start: nextDraft.breakStart2, end: nextDraft.breakEnd2 }
        ],
        note: nextDraft.note
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId, { keepActualDraft: true });
      showShiftMessage("実勤務時間を保存しました。");
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "実勤務時間を保存できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  function applyScheduledShiftToActual() {
    if (!actualDraft || !selectedActualShift?.scheduledStart || !selectedActualShift.scheduledEnd) return;
    const nextDraft = {
      ...actualDraft,
      clockIn: selectedActualShift.scheduledStart,
      clockOut: selectedActualShift.scheduledEnd,
      breakStart1: "",
      breakEnd1: "",
      breakStart2: "",
      breakEnd2: "",
      note: actualDraft.note || "計画シフトから反映"
    };
    setActualDraft(nextDraft);
    void saveActualTime(nextDraft);
  }

  async function deleteActualTime() {
    if (!actualDraft || !selectedStoreId) return;
    setIsSavingShift(true);
    clearShiftMessage();
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_actual_time",
        storeId: selectedStoreId,
        shiftId: actualDraft.shiftId ?? null,
        employeeId: actualDraft.employeeId,
        workDate: actualDraft.workDate
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId, { keepActualDraft: true });
      showShiftMessage("実勤務時間を削除しました。");
    } else {
      const body = await response.json().catch(() => ({}));
      showShiftMessage(String(body.error ?? "実勤務時間を削除できませんでした。"), 4200);
    }
    setIsSavingShift(false);
  }

  async function saveSelectedActualCells() {
    if (!selectedStoreId || !selectedActualCells.length) return;
    setIsSavingShift(true);
    clearShiftMessage();
    try {
      for (const selection of selectedActualCells) {
        const response = await fetch("/api/timecard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_actual_time",
            storeId: selectedStoreId,
            shiftId: selection.shiftId ?? null,
            employeeId: selection.employeeId,
            workDate: selection.workDate,
            clockIn: bulkActualDraft.clockIn,
            clockOut: bulkActualDraft.clockOut,
            breakIntervals: [
              { start: bulkActualDraft.breakStart1, end: bulkActualDraft.breakEnd1 },
              { start: bulkActualDraft.breakStart2, end: bulkActualDraft.breakEnd2 }
            ],
            note: bulkActualDraft.note
          })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          showShiftMessage(String(body.error ?? "選択した実勤務時間を保存できませんでした。"), 4200);
          return;
        }
      }
      await loadTimecard(month, selectedStoreId);
      showShiftMessage("選択した実勤務時間を保存しました。");
    } finally {
      setIsSavingShift(false);
    }
  }

  async function applyScheduledShiftToSelectedActualCells() {
    if (!selectedStoreId || !selectedActualCells.length) return;
    setIsSavingShift(true);
    clearShiftMessage();
    try {
      for (const selection of selectedActualCells) {
        const shifts = shiftsByCell.get(`${selection.employeeId}:${selection.workDate}`) ?? [];
        const shift = selection.shiftId ? shifts.find((item) => item.id === selection.shiftId) : shifts[0];
        if (!shift?.scheduledStart || !shift.scheduledEnd) continue;
        const response = await fetch("/api/timecard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_actual_time",
            storeId: selectedStoreId,
            shiftId: shift.id,
            employeeId: selection.employeeId,
            workDate: selection.workDate,
            clockIn: shift.scheduledStart,
            clockOut: shift.scheduledEnd,
            breakIntervals: [],
            note: bulkActualDraft.note || "計画シフトから反映"
          })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          showShiftMessage(String(body.error ?? "計画シフトを実勤務時間に反映できませんでした。"), 4200);
          return;
        }
      }
      await loadTimecard(month, selectedStoreId);
      showShiftMessage("計画シフトを選択した実勤務時間に反映しました。");
    } finally {
      setIsSavingShift(false);
    }
  }

  async function deleteSelectedActualCells() {
    if (!selectedStoreId || !selectedActualCells.length) return;
    setIsSavingShift(true);
    clearShiftMessage();
    try {
      for (const selection of selectedActualCells) {
        const response = await fetch("/api/timecard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete_actual_time",
            storeId: selectedStoreId,
            shiftId: selection.shiftId ?? null,
            employeeId: selection.employeeId,
            workDate: selection.workDate
          })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          showShiftMessage(String(body.error ?? "選択した実勤務時間を削除できませんでした。"), 4200);
          return;
        }
      }
      await loadTimecard(month, selectedStoreId);
      showShiftMessage("選択した実勤務時間を削除しました。");
    } finally {
      setIsSavingShift(false);
    }
  }

  async function confirmPayroll() {
    if (!canConfirmPayrollPeriod) {
      window.alert("この月度はまだ締め日前のため、給与を確定できません。");
      return;
    }
    const confirmationMessage = payrollConfirmationNeedsRefresh
      ? [
          "保存済みの給与を最新の勤怠・給与設定で再計算して上書きします。",
          "実行前に、現在の給与明細PDF・振込ファイル・必要な控えをバックアップしてください。",
          payrollRefreshSummary?.detail ? `差分: ${payrollRefreshSummary.detail}` : "",
          "再計算して保存しますか？"
        ].filter(Boolean).join("\n\n")
      : payrollConfirmation
        ? "この月の給与を再確定しますか？保存済みの給与計算結果を上書きします。必要な控えをバックアップしてから実行してください。"
        : "この月の給与を確定しますか？確定時点の給与計算結果を保存します。";
    if (!selectedStoreId || !window.confirm(confirmationMessage)) return;

    setIsConfirmingPayroll(true);
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm_payroll",
        storeId: selectedStoreId,
        month
      })
    });
    if (response.ok) {
      await loadTimecard(month, selectedStoreId);
    } else {
      const body = await response.json().catch(() => ({}));
      window.alert(body.error ?? "給与を確定できませんでした。");
    }
    setIsConfirmingPayroll(false);
  }

  async function loadPayrollPaymentBatches(nextMonth = month, nextStoreId = selectedStoreId) {
    if (!nextStoreId) return;
    const params = new URLSearchParams({ month: nextMonth, storeId: nextStoreId });
    const response = await fetch(`/api/timecard/payroll-payments?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setPayrollPaymentBatches([]);
      return;
    }
    const body = await response.json().catch(() => ({})) as { batches?: PayrollPaymentBatch[] };
    setPayrollPaymentBatches(body.batches ?? []);
  }

  async function createPayrollPaymentFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreatePayrollPaymentFile || !selectedStoreId) {
      setPayrollPaymentMessage("給与確定後に振込ファイルを作成できます。");
      return;
    }

    const formData = new FormData(event.currentTarget);
    setIsCreatingPayrollPayment(true);
    setPayrollPaymentMessage("");
    const response = await fetch("/api/timecard/payroll-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        month,
        paymentDate: String(formData.get("paymentDate") ?? ""),
        bankProvider: String(formData.get("bankProvider") ?? "fukuoka"),
        fileFormat: String(formData.get("fileFormat") ?? "zengin"),
        transferType: String(formData.get("transferType") ?? "salary"),
        companyCode: String(formData.get("companyCode") ?? ""),
        companyName: String(formData.get("companyName") ?? ""),
        debitBankCode: String(formData.get("debitBankCode") ?? ""),
        debitBankName: String(formData.get("debitBankName") ?? ""),
        debitBranchCode: String(formData.get("debitBranchCode") ?? ""),
        debitBranchName: String(formData.get("debitBranchName") ?? ""),
        debitAccountType: String(formData.get("debitAccountType") ?? "ordinary"),
        debitAccountNumber: String(formData.get("debitAccountNumber") ?? ""),
        debitAccountHolderKana: String(formData.get("debitAccountHolderKana") ?? "")
      })
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      fileName?: string;
      fileContent?: string;
      totalAmount?: number;
      transferCount?: number;
      itemErrors?: Array<{ employeeName?: string; alerts?: string[] }>;
      originAlerts?: string[];
    };
    if (!response.ok || !body.fileName || typeof body.fileContent !== "string") {
      const detail = body.itemErrors?.length
        ? body.itemErrors.slice(0, 4).map((item) => `${item.employeeName ?? "スタッフ"}: ${(item.alerts ?? []).join("、")}`).join(" / ")
        : body.originAlerts?.length
          ? body.originAlerts.join("、")
          : "";
      setPayrollPaymentMessage(`${body.error ?? "振込ファイルを作成できませんでした。"}${detail ? ` ${detail}` : ""}`);
      setIsCreatingPayrollPayment(false);
      return;
    }

    const blob = new Blob([body.fileContent], { type: body.fileName.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = body.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    setPayrollPaymentMessage(`振込ファイルを作成しました。${body.transferCount ?? 0}件 / ${formatMoney(body.totalAmount ?? 0)}`);
    await loadPayrollPaymentBatches(month, selectedStoreId);
    setIsCreatingPayrollPayment(false);
  }

  async function fileToBase64(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    const chunkSize = 8192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return window.btoa(chunks.join(""));
  }

  async function importAttendanceCsv() {
    if (!selectedStoreId || !attendanceCsvFile) return;
    setIsImportingAttendance(true);
    setAttendanceImportMessage("");
    try {
      const csvBase64 = await fileToBase64(attendanceCsvFile);
      const response = await fetch("/api/timecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_attendance_csv",
          storeId: selectedStoreId,
          month,
          csvFileName: attendanceCsvFile.name,
          csvBase64
        })
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setAttendanceImportMessage(`CSVを取り込みました。${body.insertedCount ?? 0}件追加 / ${body.deletedCount ?? 0}件置換`);
        setAttendanceCsvFile(null);
        await loadTimecard(month, selectedStoreId);
      } else {
        setAttendanceImportMessage(String(body.error ?? "CSVを取り込めませんでした。"));
      }
    } catch {
      setAttendanceImportMessage("CSVを取り込めませんでした。");
    }
    setIsImportingAttendance(false);
  }

  function openCalendarManager() {
    const defaultDate = selectedCalendarDate || monthDays[0]?.key || `${month}-01`;
    setCalendarDraft((current) => ({ ...current, startDate: current.startDate || defaultDate, endDate: current.endDate || defaultDate }));
    setCalendarMessage("");
    setIsCalendarManagerOpen((current) => !current);
  }

  async function saveCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStoreId) return;
    setIsSavingCalendar(true);
    setCalendarMessage("");
    const response = await fetch("/api/timecard/calendar-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", storeId: selectedStoreId, ...calendarDraft })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setCalendarMessage("店舗予定を追加しました。");
      setCalendarDraft((current) => ({ ...current, title: "", startTime: "", endTime: "", impactStartTime: "", impactEndTime: "", venue: "", note: "" }));
      await loadTimecard(month, selectedStoreId, { keepShiftDraft: true, keepActualDraft: true });
    } else {
      setCalendarMessage(body.error ?? "店舗予定を追加できませんでした。");
    }
    setIsSavingCalendar(false);
  }

  async function deleteCalendarEvent(eventId: string) {
    if (!selectedStoreId) return;
    setIsSavingCalendar(true);
    setCalendarMessage("");
    const response = await fetch("/api/timecard/calendar-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", storeId: selectedStoreId, eventId })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setCalendarMessage(response.ok ? "店舗予定を削除しました。" : body.error ?? "店舗予定を削除できませんでした。");
    if (response.ok) await loadTimecard(month, selectedStoreId, { keepShiftDraft: true, keepActualDraft: true });
    setIsSavingCalendar(false);
  }

  async function syncCalendarSources() {
    setIsSavingCalendar(true);
    setCalendarMessage("公式情報を同期しています。");
    const response = await fetch("/api/timecard/calendar-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" })
    });
    const body = await response.json().catch(() => ({})) as { error?: string; result?: { holidays?: number; longBreaks?: number; foreignLongBreaks?: number; hawksGames?: number; localEvents?: number; mobilityEvents?: number; largeMiceEvents?: number; largeCruiseCalls?: number; payPayDomeConcerts?: number; marineMesseConcerts?: number; errors?: string[] } };
    if (response.ok) {
      const result = body.result;
      setCalendarMessage(`同期完了：祝日 ${result?.holidays ?? 0} / 国内連休 ${result?.longBreaks ?? 0} / 海外連休 ${result?.foreignLongBreaks ?? 0} / ホークス ${result?.hawksGames ?? 0} / 地域・移動 ${Number(result?.localEvents ?? 0) + Number(result?.mobilityEvents ?? 0)} / 大型MICE ${result?.largeMiceEvents ?? 0} / 大型客船 ${result?.largeCruiseCalls ?? 0} / コンサート ${Number(result?.payPayDomeConcerts ?? 0) + Number(result?.marineMesseConcerts ?? 0)}件${result?.errors?.length ? `（一部失敗 ${result.errors.length}件）` : ""}`);
      await loadTimecard(month, selectedStoreId, { keepShiftDraft: true, keepActualDraft: true });
    } else {
      setCalendarMessage(body.error ?? "公式情報を同期できませんでした。");
    }
    setIsSavingCalendar(false);
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={visibleNavItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={visibleNavItems} />
      </aside>

      <section className="workspace timecard-workspace">
        <header className="topbar">
          <div className="timecard-topbar-title">
            <p className="eyebrow">出退勤、実績、給与計算</p>
            <h2>{getTimecardPageTitle(mainView)}</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : `給与期間 ${payrollPeriod?.label ?? "月度"} 集計済み`}</span>
            {loadError ? <p className="timecard-import-message">{loadError}</p> : null}
          </div>
          {mainView !== "payroll" ? (
          <>
            <MonthNavigator month={month} isLoading={isLoading} onChange={changeTimecardMonth} />
            <div className="timecard-toolbar timecard-store-toolbar">
              <label className="store-context-selector is-os is-compact">
                <span>対象店舗</span>
                <select value={selectedStoreId} onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  setSelectedCalendarDate("");
                  setIsCalendarManagerOpen(false);
                  storeTimecardSelection(month, event.target.value);
                  setIsShiftMultiSelectMode(false);
                  setSelectedShiftCells([]);
                  void loadTimecard(month, event.target.value);
                }}>
                  {data?.stores.map((store) => (
                    <option value={store.id} key={store.id}>{store.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
          ) : null}
        </header>

        {mainView !== "payroll" ? (
        <section className="metric-grid">
              <MetricCard label="勤務日数" value={`${canViewPayroll ? totals.workDays : attendanceTotals.workDays}日`} note={`${canViewPayroll ? totals.punchCount : attendanceTotals.punchCount}件の実績`} />
              <MetricCard label="勤務時間" value={formatDuration(canViewPayroll ? totals.workMinutes : attendanceTotals.workMinutes)} note={`時間外 ${formatDuration(canViewPayroll ? totals.overtimeMinutes ?? 0 : 0)} / 深夜 ${formatDuration(canViewPayroll ? totals.nightMinutes : attendanceTotals.nightMinutes)}`} />
              {canViewPayroll ? (
                <>
              <MetricCard label="人件費" value={formatMoney(displayedPayrollTotals.laborCost + displayedPayrollTotals.commuteAllowance)} note={`給与 ${formatMoney(displayedPayrollTotals.laborCost)} / 交通費 ${formatMoney(displayedPayrollTotals.commuteAllowance)}`} />
              <MetricCard label="差引支給額" value={formatMoney(displayedPayrollTotals.totalPay)} note={`控除 ${formatMoney((displayedPayrollTotals.socialInsurance ?? 0) + (displayedPayrollTotals.employmentInsurance ?? 0) + (displayedPayrollTotals.incomeTax ?? 0) + (displayedPayrollTotals.residentTax ?? 0))}${payrollConfirmation ? " / 確定済み" : ""}`} />
            </>
          ) : null}
        </section>
        ) : null}

        {data?.canEditActualTime && mainView === "schedule" ? (
          <section className="timecard-import-panel">
            <button className="secondary-button timecard-import-toggle" type="button" onClick={() => setIsAttendanceImportOpen((current) => !current)}>
              <FileUp size={16} />
              勤怠CSV取り込み
            </button>
            {isAttendanceImportOpen ? (
              <div className="timecard-import-body">
                <p>選択中の店舗と月度に Smaregi 勤怠CSVを取り込みます。同じ月度のCSV取込データだけを置き換えます。</p>
                <div className="timecard-import-controls">
                  <label>
                    <span>CSVファイル</span>
                    <input
                      key={attendanceCsvFile ? "attendance-csv-selected" : "attendance-csv-empty"}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => {
                        setAttendanceCsvFile(event.target.files?.[0] ?? null);
                        setAttendanceImportMessage("");
                      }}
                    />
                  </label>
                  <button className="secondary-button" type="button" disabled={!attendanceCsvFile || isImportingAttendance} onClick={() => void importAttendanceCsv()}>
                    {isImportingAttendance ? "取り込み中" : "CSVを取り込む"}
                  </button>
                  <small>{attendanceCsvFile ? `${selectedStore?.name ?? "店舗"} / ${month} / ${attendanceCsvFile.name}` : `${selectedStore?.name ?? "店舗"} / ${month}`}</small>
                </div>
              </div>
            ) : null}
            {attendanceImportMessage ? <p className="timecard-import-message">{attendanceImportMessage}</p> : null}
          </section>
        ) : null}

        {mainView === "overview" ? (
          <section className="panel">
            <div className="panel-title">
              <Clock3 />
              <div>
                <h3>タイムカード概要</h3>
                <p>{selectedStore?.name ?? "店舗"} の勤務実績、概算人件費、確認が必要な項目をまとめて表示します。</p>
              </div>
            </div>
            <div className="timecard-feature-grid">
              <article>
                <strong>対象スタッフ</strong>
                <p>{scheduleEmployees.length}人</p>
              </article>
              <article>
                <strong>未シフトの営業時間</strong>
                <p>{uncoveredDays.length ? `${uncoveredDays.length}日 要確認` : "問題なし"}</p>
              </article>
              <article>
                <strong>打刻確認</strong>
                <p>{actualIssueCount ? `${actualIssueCount}件 要確認` : "問題なし"}</p>
              </article>
            </div>
            {canViewPayroll ? (
            <div className="timecard-table-wrap">
              <table className="timecard-table">
                <thead>
                  <tr>
                    <th>従業員</th>
                    <th>勤務日数</th>
                    <th>勤務時間</th>
                    <th>人件費</th>
                    <th>交通費</th>
                    <th>確認</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPayrollRows.length ? displayedPayrollRows.slice(0, 8).map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        <strong>{row.employeeName}</strong>
                        <span>{row.storeNames.join("、") || "店舗未設定"}</span>
                      </td>
                      <td>{row.workDays}日</td>
                      <td>{formatDuration(row.workMinutes)}</td>
                      <td>{formatMoney(row.basePay)}</td>
                      <td>{formatMoney(row.commuteAllowance)}</td>
                      <td>{row.alerts.length ? <span className="status-pill is-warning">{row.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6}>この月の勤務実績はまだありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            ) : null}
          </section>
        ) : mainView === "schedule" ? (
          <>
            <section className="timecard-subtabs" aria-label="シフトメニュー">
              <button className={scheduleView === "planned" ? "is-active" : ""} type="button" onClick={() => setScheduleView("planned")}>
                計画シフト
              </button>
              <button className={scheduleView === "actual" ? "is-active" : ""} type="button" onClick={() => setScheduleView("actual")}>
                実勤務時間
              </button>
            </section>

            {scheduleView === "planned" ? (
              <section className="panel">
                <div className="panel-title">
                  <CalendarDays />
                  <div>
                    <h3>計画シフト</h3>
                    <p>{selectedStore?.name ?? "店舗"} の月間シフトを日付 x 従業員で編集します。複数選択モード、または Shift / Command / Ctrl クリックでまとめて編集できます。</p>
                  </div>
                  <div className="shift-panel-actions">
                    {data?.canEditActualTime ? (
                      <button className={`secondary-button calendar-manager-toggle${isCalendarManagerOpen ? " is-active" : ""}`} type="button" onClick={openCalendarManager}>
                        <CalendarPlus size={15} />
                        営業カレンダー
                      </button>
                    ) : null}
                    <button
                      className={`secondary-button shift-multi-select-toggle${isShiftMultiSelectMode ? " is-active" : ""}`}
                      type="button"
                      onClick={() => {
                        clearShiftMessage();
                        setShiftDraft(null);
                        setShiftEditorPosition(null);
                        setIsShiftMultiSelectMode((current) => !current);
                      }}
                    >
                      {isShiftMultiSelectMode ? "複数選択中" : "複数選択"}
                    </button>
                  </div>
                </div>
                {isCalendarManagerOpen ? (
                  <section className="business-calendar-manager" aria-label="営業カレンダー管理">
                    <div className="business-calendar-manager-head">
                      <div>
                        <strong>店舗予定を追加</strong>
                        <span>祝日・公式イベントは自動同期されます。店舗独自の催事や周辺イベントを追加できます。</span>
                      </div>
                      {["owner", "manager"].includes(data?.currentEmployeeRole ?? "") ? (
                        <button className="secondary-button" type="button" disabled={isSavingCalendar} onClick={() => void syncCalendarSources()}>
                          <RefreshCw size={14} /> 公式情報を同期
                        </button>
                      ) : null}
                    </div>
                    <form className="business-calendar-form" onSubmit={(event) => void saveCalendarEvent(event)}>
                      <label className="is-wide">
                        <span>予定名</span>
                        <input required maxLength={120} value={calendarDraft.title} placeholder="例：近隣商業施設セール" onChange={(event) => setCalendarDraft({ ...calendarDraft, title: event.target.value })} />
                      </label>
                      <label>
                        <span>開始日</span>
                        <input required type="date" value={calendarDraft.startDate} onChange={(event) => setCalendarDraft({ ...calendarDraft, startDate: event.target.value, endDate: calendarDraft.endDate < event.target.value ? event.target.value : calendarDraft.endDate })} />
                      </label>
                      <label>
                        <span>終了日</span>
                        <input required type="date" min={calendarDraft.startDate} value={calendarDraft.endDate} onChange={(event) => setCalendarDraft({ ...calendarDraft, endDate: event.target.value })} />
                      </label>
                      <label>
                        <span>開始時刻</span>
                        <input type="time" value={calendarDraft.startTime} onChange={(event) => setCalendarDraft({ ...calendarDraft, startTime: event.target.value })} />
                      </label>
                      <label>
                        <span>終了時刻</span>
                        <input type="time" value={calendarDraft.endTime} onChange={(event) => setCalendarDraft({ ...calendarDraft, endTime: event.target.value })} />
                      </label>
                      <label>
                        <span>影響</span>
                        <select value={calendarDraft.impactLevel} onChange={(event) => setCalendarDraft({ ...calendarDraft, impactLevel: event.target.value as CalendarEventDraft["impactLevel"] })}>
                          <option value="reference">参考</option>
                          <option value="busy">混雑見込</option>
                          <option value="major">重大影響</option>
                        </select>
                      </label>
                      <label>
                        <span>地域人流の参考</span>
                        <select value={calendarDraft.flowDirection} onChange={(event) => setCalendarDraft({ ...calendarDraft, flowDirection: event.target.value as CalendarEventDraft["flowDirection"] })}>
                          <option value="inbound">地域流入</option>
                          <option value="outbound">地域流出</option>
                          <option value="mixed">方向不明</option>
                        </select>
                      </label>
                      <label>
                        <span>影響開始</span>
                        <input type="time" value={calendarDraft.impactStartTime} onChange={(event) => setCalendarDraft({ ...calendarDraft, impactStartTime: event.target.value })} />
                      </label>
                      <label>
                        <span>影響終了</span>
                        <input type="time" value={calendarDraft.impactEndTime} onChange={(event) => setCalendarDraft({ ...calendarDraft, impactEndTime: event.target.value })} />
                      </label>
                      <label>
                        <span>種類</span>
                        <select value={calendarDraft.category} onChange={(event) => setCalendarDraft({ ...calendarDraft, category: event.target.value })}>
                          <option value="local_event">地域イベント</option>
                          <option value="festival">祭事</option>
                          <option value="sports">スポーツ</option>
                          <option value="traffic">交通規制</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                      <label>
                        <span>会場</span>
                        <input maxLength={160} value={calendarDraft.venue} placeholder="任意" onChange={(event) => setCalendarDraft({ ...calendarDraft, venue: event.target.value })} />
                      </label>
                      <label className="is-wide">
                        <span>メモ</span>
                        <input maxLength={500} value={calendarDraft.note} placeholder="客流・交通への影響など" onChange={(event) => setCalendarDraft({ ...calendarDraft, note: event.target.value })} />
                      </label>
                      <button className="primary-button" type="submit" disabled={isSavingCalendar}>{isSavingCalendar ? "保存中" : "追加"}</button>
                    </form>
                    {calendarMessage ? <p className="business-calendar-message" aria-live="polite">{calendarMessage}</p> : null}
                    {manualCalendarEvents.length ? (
                      <div className="business-calendar-manual-list">
                        {manualCalendarEvents.map((event) => (
                          <div key={event.id}>
                            <span className={`calendar-impact-dot is-${event.impactLevel}`} aria-hidden="true" />
                            <strong>{event.title}</strong>
                            <span>{event.startDate}{event.endDate !== event.startDate ? `–${event.endDate}` : ""} / {getCalendarFlowLabel(event.flowDirection)} / {event.impactStartTime ?? "00:00"}–{event.impactEndTime ?? "23:59"}</span>
                            <button type="button" disabled={isSavingCalendar} aria-label={`${event.title}を削除`} onClick={() => void deleteCalendarEvent(event.id)}><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {selectedCalendarDate && (selectedCalendarEvents.length || selectedWeatherForecast) ? (
                  <section className="business-calendar-day-detail" aria-label={`${selectedCalendarDate}の営業情報`}>
                    <strong>{selectedCalendarDate}</strong>
                    <div>
                      {selectedWeatherForecast ? (
                        <article className="weather-day-detail-card">
                          <span><WeatherCodeIcon code={selectedWeatherForecast.weatherCode} size={14} /> 天気</span>
                          <div>
                            <strong>{selectedWeatherForecast.label}</strong>
                            <small>
                              {[
                                `最高 ${formatForecastNumber(selectedWeatherForecast.temperatureMax)}℃`,
                                `最低 ${formatForecastNumber(selectedWeatherForecast.temperatureMin)}℃`,
                                `降水 ${formatForecastNumber(selectedWeatherForecast.precipitationProbabilityMax)}%`,
                                selectedWeatherForecast.reliability ? `信頼度 ${selectedWeatherForecast.reliability}` : "",
                                selectedWeatherForecast.windLabel ? `風 ${selectedWeatherForecast.windLabel}` : "",
                                selectedWeatherForecast.precipitationSum !== null ? `雨量 ${selectedWeatherForecast.precipitationSum}mm` : "",
                                selectedWeatherForecast.windSpeedMax !== null ? `最大風速 ${selectedWeatherForecast.windSpeedMax}km/h` : "",
                                formatForecastUpdatedAt(selectedWeatherForecast.updatedAt) ? `更新 ${formatForecastUpdatedAt(selectedWeatherForecast.updatedAt)}` : ""
                              ].filter(Boolean).join(" / ")}
                            </small>
                          </div>
                          <a href={selectedWeatherForecast.sourceUrl} target="_blank" rel="noreferrer">{selectedWeatherForecast.sourceName}</a>
                        </article>
                      ) : null}
                      {selectedCalendarEvents.map((event) => (
                        <article className={`is-${event.impactLevel}`} key={event.id}>
                          <span>{getCalendarEventCategoryLabel(event)}</span>
                          <div>
                            <strong>{event.title}</strong>
                            <small>{[
                              `${getCalendarFlowLabel(event.flowDirection)} ${event.impactStartTime ?? "00:00"}–${event.impactEndTime ?? "23:59"}`,
                              event.venue,
                              getCalendarImpactLabel(event.impactLevel),
                              event.note
                            ].filter(Boolean).join(" / ")}</small>
                          </div>
                          {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">公式</a> : null}
                        </article>
                      ))}
                    </div>
                    <button type="button" aria-label="営業情報を閉じる" onClick={() => setSelectedCalendarDate("")}>×</button>
                  </section>
                ) : null}
                {isShiftMultiSelectMode || selectedShiftCells.length ? (
                  <div className="shift-editor shift-bulk-editor" aria-label="シフト一括編集">
                    <div className="shift-editor-title">
                      <strong>{selectedShiftCells.length}件を選択中</strong>
                      <span>{selectedShiftCells.length ? "複数の日付をまとめて編集" : "編集したいセルをクリックして選択"}</span>
                      <small className={`shift-editor-status${shiftMessage ? " is-visible" : ""}`} aria-live="polite">{shiftMessage || "\u00a0"}</small>
                    </div>
                    <label>
                      <span>開始</span>
                      <input type="time" value={bulkShiftDraft.scheduledStart} onChange={(event) => setBulkShiftDraft({ ...bulkShiftDraft, scheduledStart: event.target.value })} />
                    </label>
                    <label>
                      <span>終了</span>
                      <input type="time" value={bulkShiftDraft.scheduledEnd} onChange={(event) => setBulkShiftDraft({ ...bulkShiftDraft, scheduledEnd: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩(分)</span>
                      <input type="number" min="0" max="720" value={bulkShiftDraft.breakMinutes} onChange={(event) => setBulkShiftDraft({ ...bulkShiftDraft, breakMinutes: event.target.value })} />
                    </label>
                    <label>
                      <span>メモ</span>
                      <input value={bulkShiftDraft.note} onChange={(event) => setBulkShiftDraft({ ...bulkShiftDraft, note: event.target.value })} placeholder="任意" />
                    </label>
                    <div className="shift-patterns" aria-label="一括勤務パターン">
                      {["営業通し", "開店", "後半", "短時間"].map((label) => (
                        <button type="button" disabled={isSavingShift || !selectedShiftCells.length} onClick={() => void applyBulkShiftPattern(label)} key={label}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="shift-editor-actions">
                      <button className="secondary-button" type="button" onClick={() => setSelectedShiftCells([])}>選択解除</button>
                      <button className="secondary-button" type="button" onClick={() => {
                        setIsShiftMultiSelectMode(false);
                        setSelectedShiftCells([]);
                      }}>終了</button>
                      <button className="secondary-button is-danger" type="button" disabled={isSavingShift || !selectedShiftCells.length} onClick={() => void deleteSelectedShiftCells()}>一括削除</button>
                      <button className="primary-button" type="button" disabled={isSavingShift || !selectedShiftCells.length} onClick={() => void saveSelectedShiftCells()}>{isSavingShift ? "保存中" : "一括保存"}</button>
                    </div>
                  </div>
                ) : null}
                {shiftDraft ? (
                  <div className="shift-editor shift-editor-popover" style={shiftEditorStyle} aria-label="シフト編集">
                    <div className="shift-editor-title">
                      <strong>{selectedShiftEmployee?.name ?? "従業員"}</strong>
                      <span>{shiftDraft.workDate}{selectedDraftBusinessDay ? ` / 営業 ${selectedDraftBusinessDay.closed ? "休業日" : `${selectedDraftBusinessDay.open}-${selectedDraftBusinessDay.close}`}` : ""}</span>
                      <small className={`shift-editor-status${shiftMessage ? " is-visible" : ""}`} aria-live="polite">{shiftMessage || "\u00a0"}</small>
                    </div>
                    {selectedShiftSegments.length ? (
                      <div className="shift-segment-switcher" aria-label="時間帯">
                        {selectedShiftSegments.map((segment, index) => (
                          <button
                            className={shiftDraft.id === segment.id ? "is-active" : ""}
                            type="button"
                            onClick={() => openShiftEditor(shiftDraft.employeeId, shiftDraft.workDate, undefined, segment.id)}
                            key={segment.id}
                          >
                            {segment.scheduledStart ?? "--:--"}-{segment.scheduledEnd ?? "--:--"}
                            <small>{index + 1}</small>
                          </button>
                        ))}
                        <button className={!shiftDraft.id ? "is-active" : ""} type="button" onClick={openNewShiftSegment}>
                          時間帯を追加
                        </button>
                      </div>
                    ) : null}
                    <label>
                      <span>開始</span>
                      <input type="time" value={shiftDraft.scheduledStart} onChange={(event) => setShiftDraft({ ...shiftDraft, scheduledStart: event.target.value })} />
                    </label>
                    <label>
                      <span>終了</span>
                      <input type="time" value={shiftDraft.scheduledEnd} onChange={(event) => setShiftDraft({ ...shiftDraft, scheduledEnd: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩(分)</span>
                      <input type="number" min="0" max="720" value={shiftDraft.breakMinutes} onChange={(event) => setShiftDraft({ ...shiftDraft, breakMinutes: event.target.value })} />
                    </label>
                    <label>
                      <span>メモ</span>
                      <input value={shiftDraft.note} onChange={(event) => setShiftDraft({ ...shiftDraft, note: event.target.value })} placeholder="任意" />
                    </label>
                    {selectedDraftPatterns.length ? (
                      <div className="shift-patterns" aria-label="勤務パターン">
                        {selectedDraftPatterns.map((pattern) => (
                          <button type="button" onClick={() => applyShiftPattern(pattern.start, pattern.end, pattern.breakMinutes)} key={pattern.label}>
                            {pattern.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="shift-patterns">
                        <span>この日は休業日のため、必要な場合のみ手動で時間を入力してください。</span>
                      </div>
                    )}
                    <div className="shift-editor-actions">
                      <button className="secondary-button" type="button" onClick={() => {
                        setShiftDraft(null);
                        setShiftEditorPosition(null);
                      }}>閉じる</button>
                      <button className="secondary-button is-danger" type="button" disabled={isSavingShift} onClick={() => void deleteShift()}>削除</button>
                      <button className="primary-button" type="button" disabled={isSavingShift} onClick={() => void saveShift()}>{isSavingShift ? "保存中" : "保存"}</button>
                    </div>
                  </div>
                ) : null}
                <div className="shift-grid-wrap">
                  <table className="shift-grid">
                    <thead>
                      <tr className="shift-date-head-row">
                        <th className="shift-employee-head" rowSpan={3}>従業員</th>
                        {monthDays.map((day) => {
                          const coverage = coverageByDate.get(day.key);
                          const isUncovered = coverage?.status === "uncovered";
                          const isToday = day.key === todayKey;
                          return (
                            <th
                              className={`shift-date-head${day.isWeekend ? " is-weekend" : ""}${isUncovered ? " has-uncovered-shift" : ""}${isToday ? " is-today" : ""}`}
                              title={isUncovered ? `未シフト: ${coverage?.missingLabel}` : undefined}
                              key={day.key}
                            >
                              <span>{day.label}</span>
                              <small>{day.weekdayLabel}</small>
                              {isUncovered || isToday ? (
                                <span className="shift-day-badges">
                                  {isUncovered ? <span className="shift-day-badge is-uncovered">未</span> : null}
                                  {isToday ? <span className="shift-day-badge is-today">今日</span> : null}
                                </span>
                              ) : null}
                            </th>
                          );
                        })}
                        <th className="shift-cost-head" rowSpan={3}>月計</th>
                      </tr>
                      <tr className="shift-weather-head-row">
                        {monthDays.map((day) => {
                          const weatherForecast = weatherForecastByDate.get(day.key);
                          const precipitationProbability = Math.max(0, Math.min(100, weatherForecast?.precipitationProbabilityMax ?? 0));
                          return (
                            <th className={`shift-weather-head${day.isWeekend ? " is-weekend" : ""}${day.key === todayKey ? " is-today" : ""}`} key={day.key}>
                              {weatherForecast ? (
                                <button
                                  className={`shift-weather-marker${precipitationProbability >= 40 ? " is-rain-likely" : ""}`}
                                  type="button"
                                  title={`${weatherForecast.label} / 最高${formatForecastNumber(weatherForecast.temperatureMax)}℃ 最低${formatForecastNumber(weatherForecast.temperatureMin)}℃ / 降水${formatForecastNumber(weatherForecast.precipitationProbabilityMax)}%${weatherForecast.reliability ? ` / 信頼度${weatherForecast.reliability}` : ""} / ${weatherForecast.sourceName}`}
                                  aria-label={`${day.key}の天気予報を表示`}
                                  onClick={() => setSelectedCalendarDate((current) => current === day.key ? "" : day.key)}
                                >
                                  <span className="shift-weather-summary">
                                    <WeatherCodeIcon code={weatherForecast.weatherCode} size={16} />
                                    <span className="shift-weather-temperature">{formatForecastNumber(weatherForecast.temperatureMax)}/{formatForecastNumber(weatherForecast.temperatureMin)}°</span>
                                  </span>
                                  <span className="shift-weather-rain-chart" aria-hidden="true">
                                    <span className="shift-weather-rain-track">
                                      <span style={{ width: `${precipitationProbability}%` }} />
                                    </span>
                                    <small>{weatherForecast.reliability ? `${formatForecastNumber(weatherForecast.precipitationProbabilityMax)}% ${weatherForecast.reliability}` : `降水${formatForecastNumber(weatherForecast.precipitationProbabilityMax)}%`}</small>
                                  </span>
                                </button>
                              ) : <span className="shift-context-empty">–</span>}
                            </th>
                          );
                        })}
                      </tr>
                      <tr className="shift-event-head-row">
                        {monthDays.map((day) => {
                          const calendarEvents = calendarEventsByDate.get(day.key) ?? [];
                          return (
                            <th className={`shift-event-head${day.isWeekend ? " is-weekend" : ""}${day.key === todayKey ? " is-today" : ""}`} key={day.key}>
                              {calendarEvents.length ? (
                                <button
                                  className={`shift-calendar-marker is-${calendarEvents.some((event) => event.impactLevel === "major") ? "major" : calendarEvents.some((event) => event.impactLevel === "busy") ? "busy" : "reference"}`}
                                  type="button"
                                  title={calendarEvents.map((event) => `${event.title}${event.startTime ? ` ${event.startTime}` : ""}`).join(" / ")}
                                  aria-label={`${day.key}の営業情報を表示`}
                                  onClick={() => setSelectedCalendarDate((current) => current === day.key ? "" : day.key)}
                                >
                                  {calendarEvents.slice(0, 2).map((event) => getCalendarEventShortLabel(event)).join("·")}{calendarEvents.length > 2 ? `+${calendarEvents.length - 2}` : ""}
                                </button>
                              ) : <span className="shift-context-empty">–</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleEmployees.length ? scheduleEmployees.map((employee) => {
                        const scheduledCost = scheduledCostByEmployee.get(employee.id) ?? { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
                        return (
                        <tr key={employee.id}>
                          <th className="shift-employee-cell">{employee.name}</th>
                          {monthDays.map((day) => {
                            const shifts = shiftsByCell.get(`${employee.id}:${day.key}`) ?? [];
                            const cellKey = getShiftSelectionKey({ employeeId: employee.id, workDate: day.key });
                            const isSelected = shiftDraft?.employeeId === employee.id && shiftDraft.workDate === day.key;
                            const isBulkSelected = selectedShiftCellKeys.has(cellKey);
                            const coverage = coverageByDate.get(day.key);
                            const isUncovered = coverage?.status === "uncovered";
                            const isToday = day.key === todayKey;
                            return (
                              <td className={`${day.isWeekend ? "is-weekend" : ""}${isUncovered ? " has-uncovered-shift" : ""}${isToday ? " is-today" : ""}`.trim()} key={day.key}>
                                <button
                                  className={`shift-cell${shifts.length ? " has-shift" : ""}${shifts.length > 1 ? " has-multiple-shifts" : ""}${isSelected ? " is-selected" : ""}${isBulkSelected ? " is-bulk-selected" : ""}`}
                                  type="button"
                                  title={isUncovered ? `未シフト: ${coverage?.missingLabel}` : isShiftMultiSelectMode ? "クリックで複数選択" : "クリックで編集 / Shift・Command・Ctrl クリックで複数選択"}
                                  onClick={(event) => handleShiftCellClick(event, employee.id, day.key)}
                                >
                                  {shifts.length ? (
                                    shifts.map((shift) => (
                                      <span className="shift-segment-line" key={shift.id}>
                                        <strong>{shift.scheduledStart ?? "--:--"}</strong>
                                        <span>{shift.scheduledEnd ?? "--:--"}</span>
                                      </span>
                                    ))
                                  ) : (
                                    <span className="shift-empty">-</span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                          <td className="shift-cost-cell" title={`勤務時間 ${formatDuration(scheduledCost.workMinutes)}${scheduledCost.nightMinutes > 0 ? ` / 深夜 ${formatDuration(scheduledCost.nightMinutes)}` : ""}${scheduledCost.overtimeMinutes > 0 ? ` / 時間外 ${formatDuration(scheduledCost.overtimeMinutes)}` : ""}`}>
                            <strong>{formatMoney(scheduledCost.payrollCost)}</strong>
                            <small>
                              {formatCompactDuration(scheduledCost.workMinutes)}
                              {scheduledCost.nightMinutes > 0 ? ` / 深${formatCompactDuration(scheduledCost.nightMinutes)}` : null}
                              {scheduledCost.overtimeMinutes > 0 ? ` / 外${formatCompactDuration(scheduledCost.overtimeMinutes)}` : null}
                            </small>
                            {scheduledCost.commuteAllowance > 0 ? <small>交通費 {formatMoney(scheduledCost.commuteAllowance)}</small> : null}
                          </td>
                        </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={monthDays.length + 2}>この店舗で勤務する従業員がまだ設定されていません。</td>
                        </tr>
                      )}
                      {scheduleEmployees.length ? (
                        <tr className="shift-support-row">
                          <th className="shift-employee-cell">未シフト</th>
                          {monthDays.map((day) => {
                            const coverage = coverageByDate.get(day.key);
                            const isUncovered = coverage?.status === "uncovered";
                            return (
                              <td
                                className={`${day.isWeekend ? "is-weekend" : ""}${isUncovered ? " has-uncovered-shift" : ""}${day.key === todayKey ? " is-today" : ""}`.trim()}
                                title={isUncovered ? `未シフト: ${coverage?.missingLabel}` : undefined}
                                key={`support-${day.key}`}
                              >
                                {isUncovered && coverage?.missingLabel ? <span className="shift-support-gap">{renderMissingShiftRanges(coverage.missingLabel)}</span> : <span className="shift-support-empty">-</span>}
                              </td>
                            );
                          })}
                          <td className="shift-support-summary">
                            <strong>{uncoveredDays.length ? `${uncoveredDays.length}日` : "なし"}</strong>
                            <small>空き時間</small>
                          </td>
                        </tr>
                      ) : null}
                      {scheduleEmployees.length ? (
                        <tr className="shift-total-row">
                          <th className="shift-employee-cell">合計</th>
                          {monthDays.map((day) => {
                            const dailyCost = scheduledCostByDate.get(day.key) ?? { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
                            const hasDailyCost = dailyCost.workMinutes > 0 || dailyCost.payrollCost > 0;
                            return (
                              <td
                                className={`${day.isWeekend ? "is-weekend" : ""}${day.key === todayKey ? " is-today" : ""} shift-daily-total-cell`.trim()}
                                key={`total-${day.key}`}
                                title={`予定勤務時間 ${formatDuration(dailyCost.workMinutes)} / 予定給与 ${formatMoney(dailyCost.payrollCost)}${dailyCost.nightMinutes > 0 ? ` / 深夜 ${formatDuration(dailyCost.nightMinutes)}` : ""}${dailyCost.overtimeMinutes > 0 ? ` / 時間外 ${formatDuration(dailyCost.overtimeMinutes)}` : ""}`}
                              >
                                {hasDailyCost ? (
                                  <>
                                    <strong>{formatMoney(dailyCost.payrollCost)}</strong>
                                    <small>{formatCompactDuration(dailyCost.workMinutes)}</small>
                                  </>
                                ) : (
                                  <span className="shift-total-empty">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="shift-cost-cell" title={`勤務時間 ${formatDuration(scheduledCostTotals.workMinutes)}${scheduledCostTotals.nightMinutes > 0 ? ` / 深夜 ${formatDuration(scheduledCostTotals.nightMinutes)}` : ""}${scheduledCostTotals.overtimeMinutes > 0 ? ` / 時間外 ${formatDuration(scheduledCostTotals.overtimeMinutes)}` : ""}`}>
                            <strong>{formatMoney(scheduledCostTotals.payrollCost)}</strong>
                            <small>
                              {formatCompactDuration(scheduledCostTotals.workMinutes)}
                              {scheduledCostTotals.nightMinutes > 0 ? ` / 深${formatCompactDuration(scheduledCostTotals.nightMinutes)}` : null}
                              {scheduledCostTotals.overtimeMinutes > 0 ? ` / 外${formatCompactDuration(scheduledCostTotals.overtimeMinutes)}` : null}
                            </small>
                            {scheduledCostTotals.commuteAllowance > 0 ? <small>交通費 {formatMoney(scheduledCostTotals.commuteAllowance)}</small> : null}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-title">
                  <CalendarDays />
                  <div>
                    <h3>実勤務時間</h3>
                    <p>計画シフトと同じ月間表で、出勤・退勤の打刻と遅刻・早退を確認します。{data?.canEditActualTime ? "複数選択モード、または Shift / Command / Ctrl クリックでまとめて修正できます。" : ""}</p>
                  </div>
                  {data?.canEditActualTime ? (
                    <button
                      className={`secondary-button shift-multi-select-toggle${isActualMultiSelectMode ? " is-active" : ""}`}
                      type="button"
                      onClick={() => {
                        clearShiftMessage();
                        setActualDraft(null);
                        setActualEditorPosition(null);
                        setIsActualMultiSelectMode((current) => !current);
                      }}
                    >
                      {isActualMultiSelectMode ? "複数選択中" : "複数選択"}
                    </button>
                  ) : null}
                </div>
                {data?.canEditActualTime && (isActualMultiSelectMode || selectedActualCells.length) ? (
                  <div className="shift-editor shift-bulk-editor actual-bulk-editor" aria-label="実勤務時間一括編集">
                    <div className="shift-editor-title">
                      <strong>{selectedActualCells.length}件を選択中</strong>
                      <span>{selectedActualCells.length ? "複数の実績セルをまとめて修正" : "修正したいセルをクリックして選択"}</span>
                      <small className={`shift-editor-status${shiftMessage ? " is-visible" : ""}`} aria-live="polite">{shiftMessage || "\u00a0"}</small>
                    </div>
                    <label>
                      <span>出勤</span>
                      <input type="time" value={bulkActualDraft.clockIn} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, clockIn: event.target.value })} />
                    </label>
                    <label>
                      <span>退勤</span>
                      <input type="time" value={bulkActualDraft.clockOut} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, clockOut: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩1開始</span>
                      <input type="time" value={bulkActualDraft.breakStart1} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, breakStart1: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩1終了</span>
                      <input type="time" value={bulkActualDraft.breakEnd1} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, breakEnd1: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩2開始</span>
                      <input type="time" value={bulkActualDraft.breakStart2} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, breakStart2: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩2終了</span>
                      <input type="time" value={bulkActualDraft.breakEnd2} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, breakEnd2: event.target.value })} />
                    </label>
                    <label>
                      <span>メモ</span>
                      <input value={bulkActualDraft.note} onChange={(event) => setBulkActualDraft({ ...bulkActualDraft, note: event.target.value })} placeholder="修正理由など" />
                    </label>
                    <div className="shift-patterns actual-shift-shortcuts" aria-label="実勤務時間の一括操作">
                      <button type="button" disabled={isSavingShift || !selectedActualCells.length} onClick={() => void applyScheduledShiftToSelectedActualCells()}>
                        計画シフトを反映
                      </button>
                    </div>
                    <div className="shift-editor-actions">
                      <button className="secondary-button" type="button" onClick={() => setSelectedActualCells([])}>選択解除</button>
                      <button className="secondary-button" type="button" onClick={() => {
                        setIsActualMultiSelectMode(false);
                        setSelectedActualCells([]);
                      }}>終了</button>
                      <button className="secondary-button is-danger" type="button" disabled={isSavingShift || !selectedActualCells.length} onClick={() => void deleteSelectedActualCells()}>一括削除</button>
                      <button className="primary-button" type="button" disabled={isSavingShift || !selectedActualCells.length} onClick={() => void saveSelectedActualCells()}>{isSavingShift ? "保存中" : "一括保存"}</button>
                    </div>
                  </div>
                ) : null}
                {actualDraft ? (
                  <div className="shift-editor actual-editor shift-editor-popover" style={actualEditorStyle} aria-label={data?.canEditActualTime ? "実勤務時間編集" : "実勤務時間詳細"}>
                    <div className="shift-editor-title">
                      <strong>{selectedActualEmployee?.name ?? "従業員"}</strong>
                      <span>{actualDraft.workDate}</span>
                      <small className={`shift-editor-status${shiftMessage ? " is-visible" : ""}`} aria-live="polite">{shiftMessage || "\u00a0"}</small>
                    </div>
                    {selectedActualShiftSegments.length > 1 ? (
                      <div className="shift-segment-switcher" aria-label="実勤務時間帯">
                        {selectedActualShiftSegments.map((segment, index) => (
                          <button
                            className={actualDraft.shiftId === segment.id ? "is-active" : ""}
                            type="button"
                            onClick={() => openActualEditor(actualDraft.employeeId, actualDraft.workDate, undefined, segment.id)}
                            key={segment.id}
                          >
                            {segment.scheduledStart ?? "--:--"}-{segment.scheduledEnd ?? "--:--"}
                            <small>{index + 1}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="actual-punch-detail" aria-label="打刻詳細">
                      <div className="actual-punch-detail-head">
                        <strong>打刻詳細</strong>
                        <span>{selectedActualSummary?.punches?.length ? `${selectedActualSummary.punches.length}件` : "打刻なし"}</span>
                      </div>
                      {selectedActualSummary?.punches?.length ? (
                        <div className="actual-punch-list">
                          {selectedActualSummary.punches.map((punch) => (
                            <div className="actual-punch-row" key={punch.id}>
                              <span>{formatPunchTypeLabel(punch.punchType)}</span>
                              <strong>{formatDateTime(punch.punchedAt)}</strong>
                              <em className={`actual-source-pill ${getPunchSourceClassName(punch.source)}`}>{getPunchSourceLabel(punch.source)}</em>
                              {punch.note ? <small>{punch.note}</small> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>この日の打刻はまだありません。</p>
                      )}
                    </div>
                    <label>
                      <span>出勤</span>
                      <input type="time" value={actualDraft.clockIn} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, clockIn: event.target.value })} />
                    </label>
                    <label>
                      <span>退勤</span>
                      <input type="time" value={actualDraft.clockOut} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, clockOut: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩1開始</span>
                      <input type="time" value={actualDraft.breakStart1} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, breakStart1: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩1終了</span>
                      <input type="time" value={actualDraft.breakEnd1} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, breakEnd1: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩2開始</span>
                      <input type="time" value={actualDraft.breakStart2} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, breakStart2: event.target.value })} />
                    </label>
                    <label>
                      <span>休憩2終了</span>
                      <input type="time" value={actualDraft.breakEnd2} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, breakEnd2: event.target.value })} />
                    </label>
                    <label>
                      <span>メモ</span>
                      <input value={actualDraft.note} disabled={!data?.canEditActualTime} onChange={(event) => setActualDraft({ ...actualDraft, note: event.target.value })} placeholder="修正理由など" />
                    </label>
                    {data?.canEditActualTime && selectedActualShift?.scheduledStart && selectedActualShift.scheduledEnd ? (
                      <div className="shift-patterns actual-shift-shortcuts" aria-label="実勤務時間のクイック操作">
                        <button type="button" disabled={isSavingShift} onClick={applyScheduledShiftToActual}>
                          計画シフトを打刻に反映
                        </button>
                        <span>予定 {selectedActualShift.scheduledStart}-{selectedActualShift.scheduledEnd}</span>
                      </div>
                    ) : null}
                    <div className="shift-editor-actions">
                      <button className="secondary-button" type="button" onClick={closeActualEditor}>閉じる</button>
                      {data?.canEditActualTime ? (
                        <>
                          <button className="secondary-button is-danger" type="button" disabled={isSavingShift} onClick={() => void deleteActualTime()}>削除</button>
                          <button className="primary-button" type="button" disabled={isSavingShift} onClick={() => void saveActualTime()}>{isSavingShift ? "保存中" : "保存"}</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="shift-grid-wrap">
                  <table className="shift-grid actual-shift-grid">
                    <thead>
                      <tr>
                        <th className="shift-employee-head">従業員</th>
                        {monthDays.map((day) => (
                          <th className={`${day.isWeekend ? "is-weekend" : ""}${day.key === todayKey ? " is-today" : ""}`.trim()} key={day.key}>
                            <span>{day.label}</span>
                            <small>{day.weekdayLabel}</small>
                            {day.key === todayKey ? (
                              <span className="shift-day-badges">
                                <span className="shift-day-badge is-today">今日</span>
                              </span>
                            ) : null}
                          </th>
                        ))}
                        <th className="shift-cost-head">給与</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleEmployees.length ? scheduleEmployees.map((employee) => {
                        const actualCost = actualLaborCostByEmployee.get(employee.id) ?? { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
                        return (
                        <tr key={employee.id}>
                          <th className="shift-employee-cell">{employee.name}</th>
                          {monthDays.map((day) => {
                            const actuals = actualByCell.get(`${employee.id}:${day.key}`) ?? [];
                            const shifts = shiftsByCell.get(`${employee.id}:${day.key}`) ?? [];
                            const shift = shifts[0];
                            const actual = getActualSummaryForShift(actuals, shift);
                            const isFutureDate = day.key > todayKey;
                            const shouldShowMissing = Boolean(shifts.length && !actuals.length && !isFutureDate);
                            const status = getActualStatus(actual, shift, isFutureDate, selectedStoreBusinessHours);
                            const isSelected = actualDraft?.employeeId === employee.id && actualDraft.workDate === day.key;
                            const actualSelectionKey = getActualSelectionKey({ employeeId: employee.id, workDate: day.key, shiftId: shift?.id ?? null });
                            const isBulkSelected = selectedActualCellKeys.has(actualSelectionKey);
                            const isToday = day.key === todayKey;
                            const displayRows = shifts.length
                              ? shifts.map((segment) => ({
                                shift: segment,
                                actual: getActualSummaryForShift(actuals, segment)
                              }))
                              : actuals.map((segment) => ({ shift: null, actual: segment }));
                            return (
                              <td className={`${day.isWeekend ? "is-weekend" : ""}${isToday ? " is-today" : ""}`.trim()} key={day.key}>
                                <button
                                  className={`shift-cell actual-shift-cell${actuals.length ? " has-shift" : ""}${displayRows.length > 1 ? " has-multiple-shifts" : ""}${status.className}${isFutureDate && !actuals.length ? " is-future" : ""}${actuals.some((item) => item.isManualCorrection) ? " is-manual-correction" : ""}${isSelected ? " is-selected" : ""}${isBulkSelected ? " is-bulk-selected" : ""}${data?.canEditActualTime ? " is-editable" : ""}`}
                                  type="button"
                                  disabled={!data?.canEditActualTime && !actuals.length && !shouldShowMissing}
                                  title={[
                                    isActualMultiSelectMode ? "クリックで複数選択" : "",
                                    actuals.some((item) => item.isManualCorrection) ? "手動修正あり" : "",
                                    status.label,
                                    shouldShowMissing && shift ? `予定 ${shift.scheduledStart ?? "--:--"}-${shift.scheduledEnd ?? "--:--"}` : ""
                                  ].filter(Boolean).join("、") || (data?.canEditActualTime ? "実勤務時間を修正" : "実勤務時間の詳細")}
                                  onClick={(event) => handleActualCellClick(event, employee.id, day.key, shift?.id ?? null)}
                                >
                                  {displayRows.length ? (
                                    displayRows.map(({ shift: rowShift, actual: rowActual }, index) => (
                                      <span className="shift-segment-line actual-segment-line" key={rowShift?.id ?? rowActual?.key ?? index}>
                                      <span className="actual-time-range">
                                        <strong>{formatJstTime(rowActual?.clockIn) ?? rowShift?.scheduledStart ?? "--:--"}</strong>
                                        <span>{formatJstTime(rowActual?.clockOut) ?? rowShift?.scheduledEnd ?? "--:--"}</span>
                                      </span>
                                      {rowActual?.breakMinutes ? <span className="actual-break-time">休憩 {formatDuration(rowActual.breakMinutes)}</span> : null}
                                      {rowActual?.isManualCorrection ? <em className="actual-cell-badge">修正</em> : null}
                                      {!rowActual && rowShift && !isFutureDate ? <small>未打刻</small> : null}
                                    </span>
                                    ))
                                  ) : shouldShowMissing ? (
                                    <>
                                      <span className="shift-empty">未打刻</span>
                                    </>
                                  ) : (
                                    <span className="shift-empty">-</span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                          <td className="shift-cost-cell" title={`勤務時間 ${formatDuration(actualCost.workMinutes)}${actualCost.nightMinutes > 0 ? ` / 深夜 ${formatDuration(actualCost.nightMinutes)}` : ""}${actualCost.overtimeMinutes > 0 ? ` / 時間外 ${formatDuration(actualCost.overtimeMinutes)}` : ""}`}>
                            <strong>{formatMoney(actualCost.payrollCost)}</strong>
                            <small>
                              {formatCompactDuration(actualCost.workMinutes)}
                              {actualCost.nightMinutes > 0 ? ` / 深${formatCompactDuration(actualCost.nightMinutes)}` : null}
                              {actualCost.overtimeMinutes > 0 ? ` / 外${formatCompactDuration(actualCost.overtimeMinutes)}` : null}
                            </small>
                            {actualCost.commuteAllowance > 0 ? <small>交通費 {formatMoney(actualCost.commuteAllowance)}</small> : null}
                          </td>
                        </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={monthDays.length + 2}>この店舗で勤務する従業員がまだ設定されていません。</td>
                        </tr>
                      )}
                      {scheduleEmployees.length ? (
                        <tr className="shift-total-row">
                          <th className="shift-employee-cell">合計</th>
                          {monthDays.map((day) => {
                            const dailyActual = actualWorkByDate.get(day.key) ?? { payrollCost: 0, commuteAllowance: 0, workMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
                            const hasDailyActual = dailyActual.workMinutes > 0;
                            return (
                              <td
                                className={`${day.isWeekend ? "is-weekend" : ""}${day.key === todayKey ? " is-today" : ""} shift-daily-total-cell`.trim()}
                                key={`actual-total-${day.key}`}
                                title={`実勤務時間 ${formatDuration(dailyActual.workMinutes)}${dailyActual.nightMinutes > 0 ? ` / 深夜 ${formatDuration(dailyActual.nightMinutes)}` : ""}`}
                              >
                                {hasDailyActual ? (
                                  <>
                                    <strong>{formatCompactDuration(dailyActual.workMinutes)}</strong>
                                    {dailyActual.nightMinutes > 0 ? <small>深{formatCompactDuration(dailyActual.nightMinutes)}</small> : <small>実績</small>}
                                  </>
                                ) : (
                                  <span className="shift-total-empty">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="shift-cost-cell" title={`勤務時間 ${formatDuration(actualLaborCostTotals.workMinutes)}${actualLaborCostTotals.nightMinutes > 0 ? ` / 深夜 ${formatDuration(actualLaborCostTotals.nightMinutes)}` : ""}${actualLaborCostTotals.overtimeMinutes > 0 ? ` / 時間外 ${formatDuration(actualLaborCostTotals.overtimeMinutes)}` : ""}`}>
                            <strong>{formatMoney(actualLaborCostTotals.payrollCost)}</strong>
                            <small>
                              {formatCompactDuration(actualLaborCostTotals.workMinutes)}
                              {actualLaborCostTotals.nightMinutes > 0 ? ` / 深${formatCompactDuration(actualLaborCostTotals.nightMinutes)}` : null}
                              {actualLaborCostTotals.overtimeMinutes > 0 ? ` / 外${formatCompactDuration(actualLaborCostTotals.overtimeMinutes)}` : null}
                            </small>
                            {actualLaborCostTotals.commuteAllowance > 0 ? <small>交通費 {formatMoney(actualLaborCostTotals.commuteAllowance)}</small> : null}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        ) : canViewPayroll ? (
          <>
            <section className={`payroll-confirmation-banner${payrollConfirmationNeedsRefresh ? " is-stale" : payrollConfirmation ? " is-confirmed" : canConfirmPayrollPeriod ? "" : " is-pending"}`}>
              <div>
                <strong>{payrollConfirmationNeedsRefresh ? "確定後の給与計算に差分があります" : payrollConfirmation ? "この月の給与は確定済みです" : canConfirmPayrollPeriod ? "この月の給与はまだ確定していません" : `${displayedPayrollEmployeeCount}名の給与はまだ確定できません`}</strong>
                <span>
                  {payrollConfirmationNeedsRefresh
                    ? `画面の金額は保存済みの確定給与のまま保持しています。最新の勤怠・給与設定で再計算すると差分が出ます。${payrollRefreshSummary?.detail ?? ""} 再計算する前に必ず控えをバックアップしてください。`
                    : payrollConfirmation
                    ? `${formatDateTime(payrollConfirmation.confirmedAt)} に ${payrollConfirmation.confirmedByName ?? "管理者"} が確定しました。`
                    : canConfirmPayrollPeriod
                      ? "シフトと実勤務時間を確認・修正したあと、給与を確定してください。"
                      : `この画面の金額は現在の勤怠・給与設定で再計算した概算です。給与期間が終了する ${payrollPeriod?.displayEndDate ?? "締め日"} の翌日以降に給与を確定できます。確定するまで振込ファイルは作成できません。`}
                </span>
                {payrollConfirmationNeedsRefresh ? (
                  <ul className="payroll-refresh-issue-list" aria-label="給与再計算差分">
                    {payrollRefreshSummary?.issues.slice(0, 5).map((issue) => (
                      <li key={`${issue.employeeName}-${issue.reasons.join("-")}-${issue.totalPayDelta}`}>
                        <strong>{issue.employeeName}</strong>
                        <span>{issue.reasons.join("・")} / 差引 {formatSignedMoney(issue.totalPayDelta)}</span>
                      </li>
                    ))}
                    {(payrollRefreshSummary?.issues.length ?? 0) > 5 ? (
                      <li>
                        <strong>ほか{(payrollRefreshSummary?.issues.length ?? 0) - 5}名</strong>
                        <span>再計算確認前に差分対象を確認してください。</span>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              {canConfirmPayrollPeriod ? (
                <button className="primary-button" type="button" disabled={isConfirmingPayroll} onClick={() => void confirmPayroll()}>
                  {isConfirmingPayroll ? "確定中" : payrollConfirmationNeedsRefresh ? "バックアップ確認後に再計算" : payrollConfirmation ? "再確定" : "給与を確定"}
                </button>
              ) : null}
            </section>
            <section className="timecard-subtabs payroll-view-tabs" aria-label="給与メニュー">
              <button className={payrollView === "summary" ? "is-active" : ""} type="button" onClick={() => setPayrollView("summary")}>
                月別給与
              </button>
              <button className={payrollView === "employee" ? "is-active" : ""} type="button" onClick={() => {
                setPayrollView("employee");
              }}>
                従業員別明細
              </button>
            </section>

            {payrollView === "summary" ? (
              <section className="panel payroll-ledger-panel">
                <div className="panel-title">
                  <WalletCards />
                  <div>
                    <h3>月別給与</h3>
                    <p>選択した月度と事業所の全員分を集計し、給与確定と振込ファイル作成を行います。</p>
                  </div>
                </div>
                <div className="payroll-ledger-search">
                  <MonthNavigator month={month} isLoading={isLoading} onChange={changeTimecardMonth} />
                  <label className="store-context-selector is-os is-compact">
                    <span>事業所</span>
                    <select value={selectedStoreId} onChange={(event) => {
                      setSelectedStoreId(event.target.value);
                      storeTimecardSelection(month, event.target.value);
                      void loadTimecard(month, event.target.value);
                    }}>
                      {data?.stores.map((store) => (
                        <option value={store.id} key={store.id}>{store.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" type="button" onClick={() => void loadTimecard(month, selectedStoreId)}>
                    検索
                  </button>
                </div>
                <div className="payroll-ledger-actions">
                  {canConfirmPayrollPeriod ? (
                    <button className="secondary-button" type="button" disabled={isConfirmingPayroll} onClick={() => void confirmPayroll()}>
                      {isConfirmingPayroll ? "確定中" : payrollConfirmationNeedsRefresh ? "バックアップ確認後に再計算" : payrollConfirmation ? "再確定" : "給与を確定"}
                    </button>
                  ) : null}
                </div>
                <form className={`payroll-payment-panel${isPayrollPaymentOpen ? " is-open" : ""}`} onSubmit={createPayrollPaymentFile}>
                  <div className="payroll-payment-head">
                    <div>
                      <strong>給与振込ファイル</strong>
                      <span>{canCreatePayrollPaymentFile ? "確定済み給与から銀行アップロード用ファイルを作成します。" : "給与確定後に作成できます。"}</span>
                    </div>
                    <button className="secondary-button payroll-payment-toggle" type="button" aria-expanded={isPayrollPaymentOpen} onClick={() => setIsPayrollPaymentOpen((current) => !current)}>
                      <ChevronDown size={16} />
                      {isPayrollPaymentOpen ? "閉じる" : "詳細を開く"}
                    </button>
                  </div>
                  {isPayrollPaymentOpen ? (
                    <>
                      <div className="payroll-payment-grid">
                        <label>
                          <span>銀行</span>
                          <select name="bankProvider" defaultValue="fukuoka">
                            <option value="fukuoka">福岡銀行</option>
                            <option value="gmo_aozora">GMOあおぞら</option>
                          </select>
                        </label>
                        <label>
                          <span>形式</span>
                          <select name="fileFormat" defaultValue="zengin">
                            <option value="zengin">全銀テキスト</option>
                            <option value="gmo_csv">GMO CSV</option>
                          </select>
                        </label>
                        <label>
                          <span>種別</span>
                          <select name="transferType" defaultValue="salary">
                            <option value="salary">給与振込</option>
                            <option value="bonus">賞与振込</option>
                            <option value="general">総合振込</option>
                          </select>
                        </label>
                        <label>
                          <span>振込指定日</span>
                          <input name="paymentDate" type="date" defaultValue={getTodayJstDateKey()} />
                        </label>
                        <label>
                          <span>委託者コード</span>
                          <input name="companyCode" inputMode="numeric" maxLength={10} placeholder="銀行契約の10桁" />
                        </label>
                        <label>
                          <span>委託者名カナ</span>
                          <input name="companyName" placeholder="例: FOUNDR1" />
                        </label>
                        <label>
                          <span>出金銀行コード</span>
                          <input name="debitBankCode" inputMode="numeric" maxLength={4} placeholder="例: 0177" />
                        </label>
                        <label>
                          <span>出金銀行名</span>
                          <input name="debitBankName" placeholder="例: 福岡銀行" />
                        </label>
                        <label>
                          <span>出金支店コード</span>
                          <input name="debitBranchCode" inputMode="numeric" maxLength={3} placeholder="例: 200" />
                        </label>
                        <label>
                          <span>出金支店名</span>
                          <input name="debitBranchName" placeholder="例: 天神町支店" />
                        </label>
                        <label>
                          <span>出金口座種別</span>
                          <select name="debitAccountType" defaultValue="ordinary">
                            <option value="ordinary">普通</option>
                            <option value="current">当座</option>
                            <option value="savings">貯蓄</option>
                          </select>
                        </label>
                        <label>
                          <span>出金口座番号</span>
                          <input name="debitAccountNumber" inputMode="numeric" maxLength={7} placeholder="7桁" />
                        </label>
                        <label>
                          <span>出金口座名義カナ</span>
                          <input name="debitAccountHolderKana" placeholder="例: FOUNDR1" />
                        </label>
                      </div>
                      <div className="payroll-payment-actions">
                        <button className="secondary-button" type="submit" disabled={!canCreatePayrollPaymentFile || isCreatingPayrollPayment}>
                          <Download size={16} />
                          {isCreatingPayrollPayment ? "作成中" : "ファイル作成"}
                        </button>
                      </div>
                      {payrollPaymentMessage ? <p className="payroll-payment-message">{payrollPaymentMessage}</p> : null}
                      {payrollPaymentBatches.length ? (
                        <div className="payroll-payment-history">
                          {payrollPaymentBatches.slice(0, 3).map((batch) => (
                            <div key={batch.id}>
                              <strong>{batch.fileName}</strong>
                              <span>{batch.paymentDate} / {batch.transferCount}件 / {formatMoney(batch.totalAmount)} / {batch.createdByName ?? "作成者未記録"}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </form>
                <div className="payroll-ledger-summary" aria-label="月別給与合計">
                  <div>
                    <span>勤務回数</span>
                    <strong>{displayedPayrollTotals.punchCount}回</strong>
                  </div>
                  <div>
                    <span>勤務日数</span>
                    <strong>{displayedPayrollTotals.workDays}日</strong>
                  </div>
                  <div>
                    <span>勤務時間（内深夜）</span>
                    <strong>{formatDuration(displayedPayrollTotals.workMinutes)}</strong>
                    <small>{formatDuration(displayedPayrollTotals.nightMinutes)}</small>
                  </div>
                  <div>
                    <span>人件費</span>
                    <strong>{formatMoney(displayedPayrollTotals.laborCost)}</strong>
                  </div>
                  <div>
                    <span>手当・加給</span>
                    <strong>{formatMoney((displayedPayrollTotals.allowancePay ?? 0) + (displayedPayrollTotals.allowancePremiumPay ?? 0))}</strong>
                  </div>
                  <div>
                    <span>交通費</span>
                    <strong>{formatMoney(displayedPayrollTotals.commuteAllowance)}</strong>
                  </div>
                  <div>
                    <span>差引支給額</span>
                    <strong>{formatMoney(displayedPayrollTotals.totalPay)}</strong>
                  </div>
                </div>
                <div className="timecard-table-wrap payroll-summary-table-wrap">
                  <table className="timecard-table payroll-ledger-table">
                    <thead>
                      <tr>
                        <th>従業員</th>
                        <th>賃金設定</th>
                        <th>勤務回数<br />勤務日数</th>
                        <th>勤務時間<br />（内深夜）</th>
                        <th>基本給</th>
                        <th>時間外</th>
                        <th>深夜割増</th>
                        <th>手当・加給</th>
                        <th>交通費</th>
                        <th>社会保険</th>
                        <th>雇用保険</th>
                        <th>源泉所得税</th>
                        <th>住民税</th>
                        <th>差引支給額</th>
                        <th>確認</th>
                        <th>給与明細</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPayrollRows.length ? displayedPayrollRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td>
                            <strong>{row.employeeName}</strong>
                            <span>{row.storeNames.join("、") || "店舗未設定"}</span>
                          </td>
                          <td>{row.employmentType === "monthly" ? "月給" : row.employmentType === "hourly" ? "時給" : "店舗別"}<span>深夜・時間外</span></td>
                          <td>{row.punchCount}回<span>{row.workDays}日</span></td>
                          <td>{formatDuration(row.workMinutes)}<span>{formatDuration(row.nightMinutes)}</span></td>
                          <td>{formatMoney(row.regularPay ?? row.basePay)}</td>
                          <td>{formatPayrollDetailMoney(row.overtimePay ?? 0)}<span>{formatDuration(row.overtimeMinutes ?? 0)}</span></td>
                          <td>{formatPayrollDetailMoney(row.nightPremiumPay ?? 0)}<span>{formatDuration(row.nightMinutes)}</span></td>
                          <td>{formatMoney((row.allowancePay ?? 0) + (row.allowancePremiumPay ?? 0))}</td>
                          <td>{formatMoney(row.commuteAllowance)}</td>
                          <td>{formatMoney(row.socialInsurance ?? 0)}</td>
                          <td>{formatMoney(row.employmentInsurance ?? 0)}</td>
                          <td>{formatMoney(row.incomeTax ?? 0)}</td>
                          <td>{formatMoney(row.residentTax ?? 0)}</td>
                          <td><strong>{formatMoney(row.totalPay)}</strong></td>
                          <td>{row.alerts.length ? <span className="status-pill is-warning">{row.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                          <td>
                            <div className="payroll-statement-actions">
                              <button className="text-button" type="button" onClick={() => openPayrollStatement(row.employeeId)}>
                                明細
                              </button>
                              <button className="text-button" type="button" onClick={() => openPayrollStatementPdf(row)}>
                                PDFダウンロード
                              </button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={16}>この月の打刻実績はまだありません。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="payroll-card-list">
                  {displayedPayrollRows.length ? displayedPayrollRows.map((row) => (
                    <article className="payroll-row-card" key={`payroll-card-${row.employeeId}`}>
                      <div className="payroll-row-card-head">
                        <div>
                          <strong>{row.employeeName}</strong>
                          <span>{row.storeNames.join("、") || "店舗未設定"}</span>
                        </div>
                        {row.alerts.length ? <span className="status-pill is-warning">{row.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}
                      </div>
                      <div className="payroll-row-card-main">
                        <div>
                          <span>差引支給額</span>
                          <strong>{formatMoney(row.totalPay)}</strong>
                        </div>
                        <div>
                          <span>基本給</span>
                          <strong>{formatMoney(row.regularPay ?? row.basePay)}</strong>
                        </div>
                        <div>
                          <span>手当・加給</span>
                          <strong>{formatMoney((row.allowancePay ?? 0) + (row.allowancePremiumPay ?? 0))}</strong>
                        </div>
                        <div>
                          <span>勤務</span>
                          <strong>{row.workDays}日 / {row.punchCount}回</strong>
                        </div>
                        <div>
                          <span>勤務時間</span>
                          <strong>{formatDuration(row.workMinutes)}</strong>
                        </div>
                      </div>
                      <div className="payroll-row-card-details">
                        <div>
                          <span>時間外</span>
                          <strong>{formatPayrollDetailMoney(row.overtimePay ?? 0)}</strong>
                          <small>{formatDuration(row.overtimeMinutes ?? 0)}</small>
                        </div>
                        <div>
                          <span>深夜割増</span>
                          <strong>{formatPayrollDetailMoney(row.nightPremiumPay ?? 0)}</strong>
                          <small>{formatDuration(row.nightMinutes)}</small>
                        </div>
                        <div>
                          <span>交通費</span>
                          <strong>{formatMoney(row.commuteAllowance)}</strong>
                        </div>
                        {(row.allowanceItems ?? []).slice(0, 3).map((item) => (
                          <div key={`${row.employeeId}-${item.ruleId}-${item.workDate ?? "month"}-${item.note}`}>
                            <span>{item.name}</span>
                            <strong>{formatMoney(item.amount + item.premiumAmount)}</strong>
                            <small>{item.workDate ? `${item.workDate} ${item.note} / ${formatDuration(item.minutes)}` : item.note}</small>
                          </div>
                        ))}
                        <div>
                          <span>社会保険</span>
                          <strong>{formatMoney(row.socialInsurance ?? 0)}</strong>
                        </div>
                        <div>
                          <span>雇用保険</span>
                          <strong>{formatMoney(row.employmentInsurance ?? 0)}</strong>
                        </div>
                        <div>
                          <span>源泉所得税</span>
                          <strong>{formatMoney(row.incomeTax ?? 0)}</strong>
                        </div>
                        <div>
                          <span>住民税</span>
                          <strong>{formatMoney(row.residentTax ?? 0)}</strong>
                        </div>
                      </div>
                      <div className="payroll-row-card-actions">
                        <button className="secondary-button" type="button" onClick={() => openPayrollStatement(row.employeeId)}>
                          明細
                        </button>
                        <button className="text-button" type="button" onClick={() => openPayrollStatementPdf(row)}>
                          PDFダウンロード
                        </button>
                      </div>
                    </article>
                  )) : (
                    <div className="payroll-card-empty">この月の打刻実績はまだありません。</div>
                  )}
                </div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-title">
                  <WalletCards />
                  <div>
                    <h3>従業員別 給与明細</h3>
                    <p>給与明細 PDF に近い内訳を従業員ごとに確認します。</p>
                  </div>
                </div>
                <div className="timecard-toolbar is-left">
                  <select value={selectedPayrollRow?.employeeId ?? ""} onChange={(event) => setSelectedPayrollEmployeeId(event.target.value)}>
                    {displayedPayrollRows.map((row) => (
                      <option value={row.employeeId} key={row.employeeId}>{row.employeeName}</option>
                    ))}
                  </select>
                </div>
                {selectedPayrollRow ? (
                  <>
                    <div className="timecard-detail-grid">
                      <MetricCard label="勤務日数" value={`${selectedPayrollRow.workDays}日`} note={`${selectedPayrollRow.punchCount}回`} />
                      <MetricCard label="勤務時間" value={formatDuration(selectedPayrollRow.workMinutes)} note={`時間外 ${formatDuration(selectedPayrollRow.overtimeMinutes ?? 0)} / 深夜 ${formatDuration(selectedPayrollRow.nightMinutes)}`} />
                      <MetricCard label="基本給" value={formatMoney(selectedPayrollRow.regularPay ?? selectedPayrollRow.basePay)} note={selectedPayrollRow.employmentType === "mixed" ? "店舗別設定" : selectedPayrollRow.employmentType === "monthly" ? "月給" : `時給 ${formatMoney(selectedPayrollRow.hourlyWage ?? 0)}`} />
                      <MetricCard label="時間外労働賃金" value={formatPayrollDetailMoney(selectedPayrollRow.overtimePay ?? 0)} note="1日8時間超過を1.25倍で計算" />
                      <MetricCard label="深夜割増" value={formatPayrollDetailMoney(selectedPayrollRow.nightPremiumPay ?? 0)} note="22:00-05:00を0.25倍で計算" />
                      <MetricCard label="手当・加給" value={formatMoney((selectedPayrollRow.allowancePay ?? 0) + (selectedPayrollRow.allowancePremiumPay ?? 0))} note={`加給割増 ${formatMoney(selectedPayrollRow.allowancePremiumPay ?? 0)}`} />
                      <MetricCard label="社会保険" value={formatMoney(selectedPayrollRow.socialInsurance ?? 0)} note="店舗の社会保険所在地と標準報酬月額で計算" />
                      <MetricCard label="雇用保険" value={formatMoney(selectedPayrollRow.employmentInsurance ?? 0)} note="一般の事業の労働者負担率で計算" />
                      <MetricCard label="源泉所得税" value={formatMoney(selectedPayrollRow.incomeTax ?? 0)} note="税額表に基づく控除" />
                      <MetricCard label="住民税" value={formatMoney(selectedPayrollRow.residentTax ?? 0)} note="6月分と7月以降分を年度で控除" />
                      <MetricCard label="差引支給額" value={formatMoney(selectedPayrollRow.totalPay)} note={`交通費 ${formatMoney(selectedPayrollRow.commuteAllowance)}`} />
                    </div>
                    {(selectedPayrollRow.allowanceItems ?? []).length ? (
                      <div className="timecard-table-wrap">
                        <table className="timecard-table">
                          <thead>
                            <tr>
                              <th>手当・加給</th>
                              <th>日付</th>
                              <th>対象</th>
                              <th>金額</th>
                              <th>加給割増</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedPayrollRow.allowanceItems ?? []).map((item) => (
                              <tr key={`${item.ruleId}-${item.workDate ?? "month"}-${item.note}`}>
                                <td>{item.name}</td>
                                <td>{item.workDate ?? "月額"}</td>
                                <td>{item.workDate ? `${item.note} / ${formatDuration(item.minutes)}` : item.note}</td>
                                <td>{formatMoney(item.amount)}</td>
                                <td>{formatMoney(item.premiumAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <div className="timecard-table-wrap">
                      <table className="timecard-table">
                        <thead>
                          <tr>
                            <th>日付</th>
                            <th>店舗</th>
                            <th>勤務時間</th>
                            <th>休憩</th>
                            <th>深夜</th>
                            <th>確認</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPayrollDays.length ? selectedPayrollDays.map((day) => (
                            <tr key={day.key}>
                              <td>{day.workDate}</td>
                              <td>{day.storeName}</td>
                              <td>{formatJstTime(day.clockIn) ?? "--:--"} - {formatJstTime(day.clockOut) ?? "--:--"}<span>{formatDuration(day.workMinutes)}</span></td>
                              <td>{formatDuration(day.breakMinutes)}</td>
                              <td>{formatDuration(day.nightMinutes)}</td>
                              <td>{day.alerts.length ? <span className="status-pill is-warning">{day.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={6}>この従業員の打刻実績はまだありません。</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="empty-state-text">給与明細を表示できる従業員がいません。</p>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="panel">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>給与は表示できません</h3>
                <p>給与情報は本部オーナー、本部マネージャー、店舗責任者のみ確認できます。</p>
              </div>
            </div>
            <p className="empty-state-text">必要な場合は管理者アカウントでログインしてください。</p>
          </section>
        )}
      </section>
    </main>
  );
}

export default function TimecardRoutePage() {
  return <TimecardPage initialMainView="overview" />;
}
