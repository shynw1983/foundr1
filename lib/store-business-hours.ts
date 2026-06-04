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

export function getTokyoDateTimeParts(date = new Date()) {
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

export type StoreCashBusinessDayState = {
  businessDate: string;
  openAt: string;
  closeAt: string;
  openLabel: string;
  closeLabel: string;
  status: "before_open" | "business_open" | "after_close" | "closed_day";
  statusLabel: string;
  detailLabel: string;
  tone: "active" | "warning" | "off";
};

function formatBusinessDateTimeLabel(dateString: string, timeString: string) {
  return `${dateString} ${timeString}`;
}

export function getStoreCashBusinessDayState(value: unknown, now = new Date()): StoreCashBusinessDayState {
  const hours = normalizeBusinessHours(value);
  const current = getTokyoDateTimeParts(now);
  const currentKey = getWeekdayKey(current.date);
  const currentTimeMinutes = toMinutes(current.time);
  const fallback = {
    businessDate: current.date,
    openAt: `${current.date}T00:00`,
    closeAt: `${current.date}T23:59`,
    openLabel: formatBusinessDateTimeLabel(current.date, "00:00"),
    closeLabel: formatBusinessDateTimeLabel(current.date, "23:59"),
    status: "business_open" as const,
    statusLabel: "営業時間内",
    detailLabel: "営業時間設定を確認できませんでした。",
    tone: "active" as const
  };
  if (!currentKey) return fallback;

  const previousDate = addDays(current.date, -1);
  const previousKey = getPreviousWeekdayKey(currentKey);
  const previousDay = hours[previousKey];
  if (!previousDay.closed && crossesMidnight(previousDay) && currentTimeMinutes <= toMinutes(previousDay.close)) {
    return {
      businessDate: previousDate,
      openAt: `${previousDate}T${previousDay.open}`,
      closeAt: `${current.date}T${previousDay.close}`,
      openLabel: formatBusinessDateTimeLabel(previousDate, previousDay.open),
      closeLabel: formatBusinessDateTimeLabel(current.date, previousDay.close),
      status: "business_open",
      statusLabel: "営業時間内",
      detailLabel: "前営業日の深夜営業時間です。",
      tone: "active"
    };
  }

  const currentDay = hours[currentKey];
  if (currentDay.closed) {
    return {
      businessDate: current.date,
      openAt: "",
      closeAt: "",
      openLabel: "休業",
      closeLabel: "休業",
      status: "closed_day",
      statusLabel: "休業日",
      detailLabel: "本日は営業時間が設定されていません。責任者のみ例外対応してください。",
      tone: "off"
    };
  }

  const closeDate = crossesMidnight(currentDay) ? addDays(current.date, 1) : current.date;
  const openCompare = compareDateTime(current.date, current.time, current.date, currentDay.open);
  const closeCompare = compareDateTime(current.date, current.time, closeDate, currentDay.close);
  const base = {
    businessDate: current.date,
    openAt: `${current.date}T${currentDay.open}`,
    closeAt: `${closeDate}T${currentDay.close}`,
    openLabel: formatBusinessDateTimeLabel(current.date, currentDay.open),
    closeLabel: formatBusinessDateTimeLabel(closeDate, currentDay.close)
  };

  if (openCompare < 0) {
    return {
      ...base,
      status: "before_open",
      statusLabel: "開店前",
      detailLabel: "開店準備時間です。開始金額を確認してから POS 会計を開始してください。",
      tone: "warning"
    };
  }

  if (closeCompare <= 0) {
    return {
      ...base,
      status: "business_open",
      statusLabel: "営業時間内",
      detailLabel: "営業中です。閉店後にレジ締めを行ってください。",
      tone: "active"
    };
  }

  return {
    ...base,
    status: "after_close",
    statusLabel: "閉店後",
    detailLabel: "営業終了後です。未締めの場合はレジ締めを行ってください。",
    tone: "warning"
  };
}

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
