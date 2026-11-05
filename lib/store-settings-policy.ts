import { weekdayKeys, type StoreBusinessHours } from "./store-business-hours";

export const payrollPrefectures = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

export type StorePayrollSettings = {
  payrollCycleType: "month_end" | "specified_day";
  payrollClosingDay: number;
  prescribedMonthlyWorkMinutes: number | null;
  socialInsurancePrefecture: string;
  socialInsuranceDeductionTiming: "current_month" | "next_month";
  shiftFirstHalfSubmissionDeadlineDay: number;
  shiftSecondHalfSubmissionDeadlineDay: number;
  shiftSubmissionDeadlineTime: string;
};

function parsePayroll(value: unknown): StorePayrollSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("給与・シフト設定を確認してください。");
  const p = value as StorePayrollSettings;
  const keys = ["payrollCycleType", "payrollClosingDay", "prescribedMonthlyWorkMinutes", "socialInsurancePrefecture", "socialInsuranceDeductionTiming", "shiftFirstHalfSubmissionDeadlineDay", "shiftSecondHalfSubmissionDeadlineDay", "shiftSubmissionDeadlineTime"];
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (Object.keys(p).some(key => !keys.includes(key))
    || !["month_end", "specified_day"].includes(p.payrollCycleType)
    || !integer(p.payrollClosingDay, 1, p.payrollCycleType === "month_end" ? 31 : 30)
    || (p.prescribedMonthlyWorkMinutes !== null && !integer(p.prescribedMonthlyWorkMinutes, 1, 2147483647))
    || !payrollPrefectures.includes(p.socialInsurancePrefecture)
    || !["current_month", "next_month"].includes(p.socialInsuranceDeductionTiming)
    || !integer(p.shiftFirstHalfSubmissionDeadlineDay, 1, 28)
    || !integer(p.shiftSecondHalfSubmissionDeadlineDay, 1, 28)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.shiftSubmissionDeadlineTime)) throw new Error("給与・シフト設定を確認してください。");
  return { ...p, payrollClosingDay: p.payrollCycleType === "month_end" ? 31 : p.payrollClosingDay };
}

export type ScopedStoreSettingsInput = {
  storeId: string;
  revision: string;
  businessHours: StoreBusinessHours;
  reservationNote: string;
  attendanceAddress: string;
  attendanceLocationEnabled: boolean;
  attendanceLatitude: number | null;
  attendanceLongitude: number | null;
  attendanceRadiusMeters: number;
  attendanceAccuracyThresholdMeters: number;
  payroll?: StorePayrollSettings;
};

const allowedFields = new Set([
  "storeId", "revision", "businessHours", "reservationNote", "attendanceAddress", "attendanceLocationEnabled",
  "attendanceLatitude", "attendanceLongitude", "attendanceRadiusMeters", "attendanceAccuracyThresholdMeters", "payroll"
]);
export const storeSettingsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseScopedStoreSettings(value: unknown): ScopedStoreSettingsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("入力内容を確認してください。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowedFields.has(key))) throw new Error("変更できない設定が含まれています。");
  if (typeof input.storeId !== "string" || !storeSettingsUuid.test(input.storeId)) throw new Error("店舗を選択してください。");
  if (typeof input.revision !== "string" || !input.revision || input.revision.length > 100) throw new Error("設定を再読み込みしてください。");
  if (typeof input.reservationNote !== "string" || input.reservationNote.length > 2000) throw new Error("予約メモは2000文字以内で入力してください。");
  if (typeof input.attendanceAddress !== "string" || input.attendanceAddress.length > 300) throw new Error("住所は300文字以内で入力してください。");
  if (typeof input.attendanceLocationEnabled !== "boolean") throw new Error("打刻地点の設定を確認してください。");
  const coordinate = (key: string, limit: number) => {
    const n = input[key];
    if (n === null) return null;
    if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > limit) throw new Error("緯度・経度を確認してください。");
    return n;
  };
  const latitude = coordinate("attendanceLatitude", 90);
  const longitude = coordinate("attendanceLongitude", 180);
  if (input.attendanceLocationEnabled && (latitude === null || longitude === null)) throw new Error("位置制限を有効にするには緯度・経度を入力してください。");
  for (const key of ["attendanceRadiusMeters", "attendanceAccuracyThresholdMeters"]) {
    if (!Number.isInteger(input[key]) || Number(input[key]) < 10 || Number(input[key]) > 2000) throw new Error("距離は10〜2000mの整数で入力してください。");
  }
  const hours = input.businessHours;
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) throw new Error("営業時間を確認してください。");
  const weekly = hours as Record<string, unknown>;
  if (Object.keys(weekly).some(key => !weekdayKeys.includes(key as typeof weekdayKeys[number]))) throw new Error("営業時間を確認してください。");
  const businessHours = {} as StoreBusinessHours;
  for (const key of weekdayKeys) {
    const day = weekly[key] as Record<string, unknown> | undefined;
    if (!day || typeof day !== "object" || Array.isArray(day)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(day.open))
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(day.close))
      || typeof day.closed !== "boolean" || (day.open24Hours !== undefined && typeof day.open24Hours !== "boolean")) throw new Error("営業時間を確認してください。");
    businessHours[key] = { open: String(day.open), close: String(day.close), closed: day.closed, open24Hours: !day.closed && day.open24Hours === true };
  }
  return {
    storeId: input.storeId, revision: input.revision, businessHours,
    reservationNote: input.reservationNote.trim(), attendanceAddress: input.attendanceAddress.trim(),
    attendanceLocationEnabled: input.attendanceLocationEnabled, attendanceLatitude: latitude, attendanceLongitude: longitude,
    attendanceRadiusMeters: Number(input.attendanceRadiusMeters), attendanceAccuracyThresholdMeters: Number(input.attendanceAccuracyThresholdMeters),
    ...(input.payroll === undefined ? {} : { payroll: parsePayroll(input.payroll) })
  };
}
