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
  const date = new Date(`${pickupDate}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return false;
  const key = weekdayKeys[(date.getUTCDay() + 6) % 7];
  const day = hours[key];
  if (day.closed) return false;
  return pickupTime >= day.open && pickupTime <= day.close;
}
