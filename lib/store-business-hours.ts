export const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type WeekdayKey = typeof weekdayKeys[number];

export type StoreBusinessDay = {
  open: string;
  close: string;
  closed: boolean;
};

export type StoreBusinessHours = Record<WeekdayKey, StoreBusinessDay>;

export const weekdayLabels: Record<WeekdayKey, string> = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  sun: "日"
};

export const defaultBusinessHours: StoreBusinessHours = {
  mon: { open: "11:00", close: "20:00", closed: false },
  tue: { open: "11:00", close: "20:00", closed: false },
  wed: { open: "11:00", close: "20:00", closed: false },
  thu: { open: "11:00", close: "20:00", closed: false },
  fri: { open: "11:00", close: "20:00", closed: false },
  sat: { open: "11:00", close: "20:00", closed: false },
  sun: { open: "11:00", close: "20:00", closed: false }
};

function addDays(dateString: string, amount: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function compareDateTime(leftDate: string, leftTime: string, rightDate: string, rightTime: string) {
  return `${leftDate}T${leftTime}`.localeCompare(`${rightDate}T${rightTime}`);
}

function getWeekdayKey(dateString: string) {
  const date = new Date(`${dateString}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return weekdayKeys[(date.getUTCDay() + 6) % 7];
}

function getPreviousWeekdayKey(key: WeekdayKey) {
  const index = weekdayKeys.indexOf(key);
  return weekdayKeys[(index + weekdayKeys.length - 1) % weekdayKeys.length];
}

function getTokyoDateTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function crossesMidnight(day: StoreBusinessDay) {
  return toMinutes(day.close) <= toMinutes(day.open);
}

function tokyoDateTimeToDate(dateString: string, timeString: string) {
  return new Date(`${dateString}T${timeString}:00+09:00`);
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

export function normalizeBusinessHours(value: unknown): StoreBusinessHours {
  let source: Record<string, unknown> = {};
  if (typeof value === "string") {
    try {
      source = JSON.parse(value || "{}") as Record<string, unknown>;
    } catch {
      source = {};
    }
  } else if (value && typeof value === "object") {
    source = value as Record<string, unknown>;
  }

  const weekly = source.weekly && typeof source.weekly === "object"
    ? source.weekly as Record<string, unknown>
    : source;

  return weekdayKeys.reduce((result, key) => {
    const fallback = defaultBusinessHours[key];
    const day = weekly[key] && typeof weekly[key] === "object" ? weekly[key] as Record<string, unknown> : {};
    result[key] = {
      open: normalizeTime(day.open, fallback.open),
      close: normalizeTime(day.close, fallback.close),
      closed: day.closed === true
    };
    return result;
  }, {} as StoreBusinessHours);
}

export function serializeBusinessHours(value: unknown) {
  return JSON.stringify({ weekly: normalizeBusinessHours(value) });
}

export function formatBusinessHoursSummary(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "未設定（予約制限なし）";
  const hours = normalizeBusinessHours(value);
  const openDays = weekdayKeys.filter((key) => !hours[key].closed);
  if (!openDays.length) return "全日休業";

  const grouped = new Map<string, WeekdayKey[]>();
  for (const key of openDays) {
    const day = hours[key];
    const label = `${day.open}-${day.close}`;
    grouped.set(label, [...(grouped.get(label) ?? []), key]);
  }

  return Array.from(grouped.entries())
    .map(([time, days]) => `${days.map((day) => weekdayLabels[day]).join("")} ${time}`)
    .join(" / ");
}

export function isPickupWithinBusinessHours(value: unknown, pickupDate: string, pickupTime: string) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return true;
  const hours = normalizeBusinessHours(value);
  const key = getWeekdayKey(pickupDate);
  if (!key) return false;
  const day = hours[key];
  if (!day.closed) {
    if (!crossesMidnight(day)) {
      return pickupTime >= day.open && pickupTime <= day.close;
    }
    if (pickupTime >= day.open) return true;
  }

  const previousDay = hours[getPreviousWeekdayKey(key)];
  return !previousDay.closed && crossesMidnight(previousDay) && pickupTime <= previousDay.close;
}

export type StoreReceptionState = {
  manualStatusLabel: string;
  statusLabel: string;
  detailLabel: string;
  nextOpenLabel: string;
  isManuallyAccepting: boolean;
  isWithinBusinessHours: boolean;
  isAcceptingNow: boolean;
  tone: "active" | "warning" | "off";
};

export function getNextBusinessOpening(value: unknown, now = new Date()) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  const hours = normalizeBusinessHours(value);
  const current = getTokyoDateTimeParts(now);

  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(current.date, offset);
    const key = getWeekdayKey(date);
    if (!key) continue;
    const day = hours[key];
    if (day.closed) continue;
    if (compareDateTime(date, day.open, current.date, current.time) > 0) {
      return `${date} ${day.open}`;
    }
  }

  return "";
}

export function getCurrentBusinessDayClosing(value: unknown, now = new Date()) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return null;
  const hours = normalizeBusinessHours(value);
  const current = getTokyoDateTimeParts(now);
  const currentKey = getWeekdayKey(current.date);
  if (!currentKey) return null;

  const candidates: Date[] = [];
  const currentTimeMinutes = toMinutes(current.time);
  const previousKey = getPreviousWeekdayKey(currentKey);
  const previousDay = hours[previousKey];
  if (!previousDay.closed && crossesMidnight(previousDay) && currentTimeMinutes <= toMinutes(previousDay.close)) {
    candidates.push(tokyoDateTimeToDate(current.date, previousDay.close));
  }

  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(current.date, offset);
    const key = getWeekdayKey(date);
    if (!key) continue;
    const day = hours[key];
    if (day.closed) continue;
    const closeDate = crossesMidnight(day) ? addDays(date, 1) : date;
    const closeAt = tokyoDateTimeToDate(closeDate, day.close);
    if (closeAt.getTime() > now.getTime()) candidates.push(closeAt);
  }

  return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

export function getStoreReceptionState(input: {
  businessHours: unknown;
  reservationsEnabled: boolean;
  statusNote?: string;
  temporaryStatusUntil?: string | Date | null;
  now?: Date;
}): StoreReceptionState {
  const statusNote = String(input.statusNote ?? "").trim();
  const now = input.now ?? new Date();
  const temporaryStatusUntil = input.temporaryStatusUntil ? new Date(input.temporaryStatusUntil) : null;
  const temporaryStatusExpired = Boolean(temporaryStatusUntil && temporaryStatusUntil.getTime() <= now.getTime());
  const isManuallyAccepting = temporaryStatusExpired ? true : input.reservationsEnabled;
  const current = getTokyoDateTimeParts(now);
  const isWithinBusinessHours = isPickupWithinBusinessHours(input.businessHours, current.date, current.time);
  const nextOpenLabel = isWithinBusinessHours ? "" : getNextBusinessOpening(input.businessHours, now);

  if (!isManuallyAccepting) {
    const manualStatusLabel = statusNote === "本日休業" ? "本日休業" : "一時休止";
    return {
      manualStatusLabel,
      statusLabel: manualStatusLabel,
      detailLabel: statusNote || "店舗側で予約受付を停止しています。",
      nextOpenLabel,
      isManuallyAccepting,
      isWithinBusinessHours,
      isAcceptingNow: false,
      tone: "off"
    };
  }

  if (!isWithinBusinessHours) {
    return {
      manualStatusLabel: "通常受付",
      statusLabel: "受付時間外",
      detailLabel: nextOpenLabel ? `現在は営業時間外です。次回受付は ${nextOpenLabel} です。` : "現在は営業時間外です。",
      nextOpenLabel,
      isManuallyAccepting,
      isWithinBusinessHours,
      isAcceptingNow: false,
      tone: "warning"
    };
  }

  return {
    manualStatusLabel: "通常受付",
    statusLabel: "受付中",
    detailLabel: "現在の時間は予約受付できます。",
    nextOpenLabel,
    isManuallyAccepting,
    isWithinBusinessHours,
    isAcceptingNow: true,
    tone: "active"
  };
}
