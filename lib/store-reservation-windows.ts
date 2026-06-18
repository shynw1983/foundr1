import { sql } from "./db";

export type ReservationWindow = {
  date: string;
  start: string;
  end: string;
};

const defaultShiftStartBufferMinutes = 15;
const defaultShiftEndBufferMinutes = 30;

function addDays(dateString: string, amount: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.min(24 * 60, Math.round(value)));
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function mergeWindows(windows: Array<{ start: number; end: number }>) {
  const sorted = windows
    .filter((window) => window.end > window.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

export async function getStoreReservationWindowsForDate(input: {
  storeId: string;
  pickupDate: string;
  startBufferMinutes?: number;
  endBufferMinutes?: number;
}): Promise<ReservationWindow[]> {
  const startBuffer = input.startBufferMinutes ?? defaultShiftStartBufferMinutes;
  const endBuffer = input.endBufferMinutes ?? defaultShiftEndBufferMinutes;
  const previousDate = addDays(input.pickupDate, -1);
  const rows = await sql`
    select
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd"
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    where timecard_shifts.store_id::text = ${input.storeId}
      and timecard_shifts.work_date in (${input.pickupDate}::date, ${previousDate}::date)
      and timecard_shifts.scheduled_start is not null
      and timecard_shifts.scheduled_end is not null
      and employees.status = 'active'
    order by timecard_shifts.work_date, timecard_shifts.scheduled_start
  ` as Array<{ workDate: string; scheduledStart: string; scheduledEnd: string }>;

  const staffedWindows = rows.flatMap((row) => {
    const workDateOffset = row.workDate === input.pickupDate ? 0 : -24 * 60;
    const start = workDateOffset + toMinutes(row.scheduledStart);
    let end = workDateOffset + toMinutes(row.scheduledEnd);
    if (end <= start) end += 24 * 60;
    return end > start ? [{ start, end }] : [];
  });

  return mergeWindows(staffedWindows)
    .flatMap((window) => {
      const bufferedStart = window.start + startBuffer;
      const bufferedEnd = window.end - endBuffer;
      const clippedStart = Math.max(0, bufferedStart);
      const clippedEnd = Math.min(24 * 60, bufferedEnd);
      return clippedEnd > clippedStart ? [{ start: clippedStart, end: clippedEnd }] : [];
    })
    .map((window) => ({
      date: input.pickupDate,
      start: formatMinutes(window.start),
      end: formatMinutes(window.end)
    }));
}

export async function isPickupWithinReservationWindows(input: {
  storeId: string;
  pickupDate: string;
  pickupTime: string;
}) {
  const windows = await getStoreReservationWindowsForDate({
    storeId: input.storeId,
    pickupDate: input.pickupDate
  });
  return windows.some((window) => input.pickupTime >= window.start && input.pickupTime <= window.end);
}
