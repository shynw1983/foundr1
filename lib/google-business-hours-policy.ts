export type GbpDate = { year: number; month: number; day: number };
export type GbpPeriod = { startDate: GbpDate; endDate?: GbpDate; openTime?: { hours?: number; minutes?: number; seconds?: number; nanos?: number }; closeTime?: { hours?: number; minutes?: number; seconds?: number; nanos?: number }; closed?: boolean };
export type PublishedShift = { workDate: string; scheduledStart: string | null; scheduledEnd: string | null };
export type HoursRules = { preparationMinutes: number; cleanupMinutes: number };
export class HoursConflict extends Error {}
export function dateKey(date: GbpDate) {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
export function parseDate(value: string): GbpDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日付を確認してください。');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('日付を確認してください。');
  return { year, month, day };
}
export function validateRules(value: HoursRules) {
  for (const minutes of [value.preparationMinutes, value.cleanupMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) throw new Error('準備・片付け時間は0〜720分で入力してください。');
  }
  return value;
}
function minute(value: string | null) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('確定シフトの時刻を確認してください。');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
const time = (value: number) => ({ hours: Math.floor(value / 60), minutes: value % 60 });
// Union staffing coverage first: offsets apply to each continuous staffed interval, never to each employee.
export function deriveSpecialHours(shifts: PublishedShift[], rules: HoursRules, month: string, closedDates: string[] = []): GbpPeriod[] {
  validateRules(rules);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('対象月を確認してください。');
  const grouped = new Map<string, Array<{ start: number; end: number }>>();
  for (const shift of shifts) {
    parseDate(shift.workDate);
    if (!shift.workDate.startsWith(`${month}-`)) throw new Error('対象月を確認してください。');
    const start = minute(shift.scheduledStart);
    let end = minute(shift.scheduledEnd);
    if (start === end) throw new Error('開始・終了が同じシフトは営業時間を確定できません。');
    if (end < start) end += 1440;
    const intervals = grouped.get(shift.workDate) ?? [];
    intervals.push({ start, end });
    grouped.set(shift.workDate, intervals);
  }
  const result: GbpPeriod[] = [];
  for (const [date, intervals] of grouped) {
    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
    }
    for (const interval of merged) {
      const start = interval.start + rules.preparationMinutes;
      const end = interval.end - rules.cleanupMinutes;
      if (start >= 1440 || end <= start || end - start >= 1440 || end >= 2160) throw new Error('準備・片付け後の営業時間を確認してください。翌日正午以降や24時間以上の営業は個別設定が必要です。');
      const nextDate = new Date(`${date}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + (end >= 1440 ? 1 : 0));
      result.push({ startDate: parseDate(date), endDate: parseDate(nextDate.toISOString().slice(0, 10)), openTime: time(start), closeTime: time(end % 1440) });
    }
  }
  const absolute = result.map(period => {
    const startDay = Date.parse(`${dateKey(period.startDate)}T00:00:00Z`) / 60000;
    const endDay = Date.parse(`${dateKey(period.endDate ?? period.startDate)}T00:00:00Z`) / 60000;
    return { start: startDay + (period.openTime?.hours ?? 0) * 60 + (period.openTime?.minutes ?? 0), end: endDay + (period.closeTime?.hours ?? 0) * 60 + (period.closeTime?.minutes ?? 0) };
  }).sort((a,b) => a.start-b.start);
  for (let index=1; index<absolute.length; index++) {
    if (absolute[index].start < absolute[index-1].end) throw new Error('前日からの営業時間が重なっています。シフトを確認してください。');
  }
  for (const date of new Set(closedDates)) {
    parseDate(date);
    if (!date.startsWith(`${month}-`) || grouped.has(date)) throw new Error('休業日は対象月のシフトがない日を指定してください。');
    // A previous night's staffed interval may run into an explicitly closed date.
    if (result.some(period => period.endDate && dateKey(period.endDate) === date && (period.closeTime?.hours || period.closeTime?.minutes))) throw new Error('前日からの営業と休業日が重なっています。');
    result.push({ startDate: parseDate(date), closed: true });
  }
  return result.sort((a, b) => dateKey(a.startDate).localeCompare(dateKey(b.startDate)) || (a.openTime?.hours ?? 0) - (b.openTime?.hours ?? 0) || (a.openTime?.minutes ?? 0) - (b.openTime?.minutes ?? 0));
}
export function canonicalPeriods(periods: GbpPeriod[]) {
  return JSON.stringify(periods.map(period => {
    const date = dateKey(period.startDate);
    if (period.closed) return `${date}:closed`;
    const start = (period.openTime?.hours ?? 0) * 60 + (period.openTime?.minutes ?? 0);
    let end = (period.closeTime?.hours ?? 0) * 60 + (period.closeTime?.minutes ?? 0);
    if (dateKey(period.endDate ?? period.startDate) > date) end += 1440;
    return `${date}:${start}-${end}:${period.openTime?.seconds ?? 0}:${period.closeTime?.seconds ?? 0}`;
  }).sort());
}
export function periodsByDate(periods: GbpPeriod[]) {
  const grouped: Record<string, GbpPeriod[]> = {};
  for (const period of periods) (grouped[dateKey(period.startDate)] ??= []).push(period);
  return grouped;
}
// Only dates present in this publication are managed; unstaffed/unconfirmed dates retain Google's settings.
export function mergeSpecialHours(current: GbpPeriod[], desired: GbpPeriod[], owned: Record<string, GbpPeriod[]>) {
  const targets = periodsByDate(desired);
  const actual = periodsByDate(current);
  for (const [date, periods] of Object.entries(targets)) {
    const live = actual[date] ?? [];
    if (canonicalPeriods(live) === canonicalPeriods(periods)) continue;
    if (live.length && (!owned[date] || canonicalPeriods(live) !== canonicalPeriods(owned[date]))) throw new HoursConflict(`Google の特別営業時間と競合しています: ${date}`);
    if (!live.length && owned[date]?.length) throw new HoursConflict(`Google の特別営業時間が削除されています: ${date}`);
  }
  return { periods: [...current.filter(period => !targets[dateKey(period.startDate)]), ...desired], owned: { ...owned, ...targets } };
}
