export type DeliveryImportHalf = "first" | "second";

export type DeliveryImportPeriod = {
  key: string;
  importMonth: string;
  half: DeliveryImportHalf;
  label: string;
  targetStartDate: string;
  targetEndDate: string;
  downloadStartDate: string;
  downloadEndDate: string;
  dueDate: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: string, days: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function toMonth(year: number, month: number) {
  return `${year}-${pad2(month)}`;
}

function previousMonth(importMonth: string) {
  const parsed = parseMonth(importMonth);
  if (!parsed) return importMonth;
  const date = new Date(parsed.year, parsed.month - 2, 1);
  return toMonth(date.getFullYear(), date.getMonth() + 1);
}

export function getDeliveryImportPeriodsForMonth(importMonth: string): DeliveryImportPeriod[] {
  const parsed = parseMonth(importMonth);
  if (!parsed) return [];

  const { year, month } = parsed;
  const lastDay = getLastDayOfMonth(year, month);
  const monthPrefix = toMonth(year, month);
  const firstStart = `${monthPrefix}-01`;
  const firstEnd = `${monthPrefix}-15`;
  const secondStart = `${monthPrefix}-16`;
  const secondEnd = `${monthPrefix}-${pad2(lastDay)}`;

  return [
    {
      key: `${importMonth}-first`,
      importMonth,
      half: "first",
      label: "1〜15日",
      targetStartDate: firstStart,
      targetEndDate: firstEnd,
      downloadStartDate: addDays(firstStart, -1),
      downloadEndDate: addDays(firstEnd, 1),
      dueDate: `${monthPrefix}-16`
    },
    {
      key: `${importMonth}-second`,
      importMonth,
      half: "second",
      label: `16〜${lastDay}日`,
      targetStartDate: secondStart,
      targetEndDate: secondEnd,
      downloadStartDate: addDays(secondStart, -1),
      downloadEndDate: addDays(secondEnd, 1),
      dueDate: addDays(secondEnd, 1)
    }
  ];
}

export function getCurrentDueDeliveryImportPeriod(now = new Date()): DeliveryImportPeriod {
  const today = formatDate(now);
  const currentMonth = toMonth(now.getFullYear(), now.getMonth() + 1);

  if (now.getDate() >= 16) {
    return getDeliveryImportPeriodsForMonth(currentMonth)[0];
  }

  return getDeliveryImportPeriodsForMonth(previousMonth(currentMonth))[1] ?? getDeliveryImportPeriodsForMonth(currentMonth)[0];
}

export function isDeliveryImportPeriodDue(period: DeliveryImportPeriod, today = formatDate(new Date())) {
  return period.dueDate <= today;
}
