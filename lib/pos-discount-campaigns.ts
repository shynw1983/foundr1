/** POS-only promotion rules. Dates are inclusive calendar dates in Japan. */
export type PosCampaignFields = {
  applicationMode?: "manual" | "campaign";
  startsOn?: string;
  endsOn?: string;
  minimumSubtotal?: number;
  campaignBasis?: "order" | "bowl_choice";
  bowlDefaultChoice?: "none" | "discount";
  bowlBenefitMode?: "choice" | "discount_only" | "gift_only";
  giftButtonLabel?: string;
  giftCategories?: Array<{ brandId: string; category: string }>;
  giftItemIds?: string[];
  giftOptionIds?: string[];
  giftOptionGroupIds?: string[];
};
export type PosDiscountRule = PosCampaignFields & {
  key: string; name: string; enabled: boolean;
  stampEligible?: boolean; allowCouponCombination?: boolean;
  discountType: "percent" | "amount"; discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand"; targetValue: string;
};
export type PosDiscountLine = { amount: number; brandId: string; category: string; itemKind: string };
const text = (value: unknown) => String(value ?? "").trim();
export function isPosCampaignDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isFinite(date.valueOf()) && new Date(date.valueOf() + 9 * 3600000).toISOString().slice(0, 10) === value;
}
export function posCampaignDate(now: number | Date = Date.now()) {
  const timestamp = Number(now);
  const date = new Date(timestamp + 9 * 3600000);
  return Number.isFinite(timestamp) && Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : "";
}
export function normalizePosCampaignFields(value: unknown): Required<PosCampaignFields> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    applicationMode: source.applicationMode === "campaign" ? "campaign" : "manual",
    startsOn: text(source.startsOn).slice(0, 40), endsOn: text(source.endsOn).slice(0, 40),
    campaignBasis: source.campaignBasis === "bowl_choice" ? "bowl_choice" : "order",
    bowlDefaultChoice: source.bowlDefaultChoice === "discount" ? "discount" : "none",
    bowlBenefitMode: source.bowlBenefitMode === "gift_only" || source.bowlBenefitMode === "discount_only" ? source.bowlBenefitMode : "choice",
    giftButtonLabel: text(source.giftButtonLabel).slice(0, 40),
    giftCategories: Array.isArray(source.giftCategories) ? source.giftCategories.filter((r): r is {brandId:string;category:string} => !!r && typeof r === "object" && typeof r.brandId === "string" && typeof r.category === "string").slice(0, 100).map(r => ({brandId:r.brandId,category:r.category})) : [],
    giftOptionIds: Array.isArray(source.giftOptionIds) ? [...new Set(source.giftOptionIds.filter((id):id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0,500) : [],
    giftOptionGroupIds: Array.isArray(source.giftOptionGroupIds) ? [...new Set(source.giftOptionGroupIds.filter((id):id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0,100) : [],
    giftItemIds: Array.isArray(source.giftItemIds) ? [...new Set(source.giftItemIds.filter((id):id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0, 500) : [],
    minimumSubtotal: source.minimumSubtotal === undefined && source.applicationMode !== "campaign" ? 0 : Number.isSafeInteger(Number(source.minimumSubtotal)) && Number(source.minimumSubtotal) >= 0 && Number(source.minimumSubtotal) <= 9999999 ? Number(source.minimumSubtotal) : -1
  };
}
/** Validate before persisting; malformed saved rules also fail closed during evaluation. */
export function validatePosCampaignPresets(value: unknown): string | null {
  if (!Array.isArray(value)) return "割引・キャンペーンの設定を確認してください。";
  if (value.length > 20) return "割引・キャンペーンは合計20件まで設定できます。";
  const keys = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return "割引・キャンペーンの設定を確認してください。";
    const row = entry as Record<string, unknown>;
    if (row.applicationMode !== undefined && row.applicationMode !== "manual" && row.applicationMode !== "campaign") return "割引の適用方法が正しくありません。";
    if (row.applicationMode !== "campaign") continue;
    const key = text(row.key);
    if (!key || keys.has(key)) return "キャンペーンの識別子が重複しています。";
    keys.add(key);
    if (!text(row.name)) return "キャンペーン名を入力してください。";
    if ((row.startsOn || row.endsOn) && (!isPosCampaignDate(row.startsOn) || !isPosCampaignDate(row.endsOn))) return "キャンペーンの開始日と終了日を入力してください。";
    if (String(row.startsOn || "") > String(row.endsOn || "")) return "キャンペーンの終了日は開始日以降にしてください。";
    if (row.campaignBasis !== undefined && !["order", "bowl_choice"].includes(String(row.campaignBasis))) return "キャンペーンの計算単位を確認してください。";
    if (row.bowlDefaultChoice !== undefined && !["none", "discount"].includes(String(row.bowlDefaultChoice))) return "特典の初期選択を確認してください。";
    if (row.bowlBenefitMode !== undefined && !["choice", "discount_only", "gift_only"].includes(String(row.bowlBenefitMode))) return "特典の種類を確認してください。";
    if (row.campaignBasis === "bowl_choice" && row.bowlBenefitMode !== "discount_only") {
      if ([row.giftItemIds,row.giftCategories,row.giftOptionIds,row.giftOptionGroupIds].every(v => !Array.isArray(v) || v.length === 0)) return "プレゼントの商品・カテゴリ・選択肢を選択してください。";
      for (const [value,limit] of [[row.giftOptionIds,500],[row.giftOptionGroupIds,100]] as const) if (value !== undefined && (!Array.isArray(value) || value.length > limit || value.some(id => typeof id !== "string" || !id || id.length > 200))) return "プレゼントの選択肢設定を確認してください。";
      if (!Array.isArray(row.giftItemIds) || row.giftItemIds.length > 500 || row.giftItemIds.some(id => typeof id !== "string" || !id || id.length > 200) || !Array.isArray(row.giftCategories) || row.giftCategories.length > 100 || row.giftCategories.some(r => !r || typeof r.brandId !== "string" || !r.brandId || typeof r.category !== "string" || !r.category)) return "プレゼントの対象設定を確認してください。";
      if (typeof row.giftButtonLabel !== "string" || row.giftButtonLabel.length > 40) return "プレゼントボタン名は40文字以内です。";
    }
    const minimum = Number(row.minimumSubtotal);
    if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 9999999) return "最低購入金額は0〜9,999,999円の整数で入力してください。";
    const discount = Number(row.discountValue);
    if (!(row.campaignBasis === "bowl_choice" && row.bowlBenefitMode === "gift_only") && ((row.discountType !== "percent" && row.discountType !== "amount") || !Number.isSafeInteger(discount) || discount <= 0 || discount > (row.discountType === "percent" ? 100 : 999999))) return "キャンペーンの割引率・割引額を確認してください。";
    if (!["all", "category", "item_kind", "brand"].includes(text(row.targetScope)) || (row.targetScope !== "all" && !text(row.targetValue))) return "キャンペーンの対象を設定してください。";
  }
  return null;
}
export function posDiscountEligibleAmount(rule: PosDiscountRule, lines: PosDiscountLine[], subtotal: number) {
  if (rule.targetScope === "all") return Math.max(0, Math.round(subtotal));
  return Math.max(0, Math.round(lines.reduce((sum, item) => {
    if (rule.targetScope === "category" && item.category !== rule.targetValue) return sum;
    if (rule.targetScope === "item_kind" && item.itemKind !== rule.targetValue) return sum;
    if (rule.targetScope === "brand" && item.brandId !== rule.targetValue) return sum;
    return sum + item.amount;
  }, 0)));
}
export function posDiscountAmount(rule: PosDiscountRule | null | undefined, lines: PosDiscountLine[], subtotal: number) {
  if (!rule) return 0;
  const base = posDiscountEligibleAmount(rule, lines, subtotal);
  const raw = rule.discountType === "percent" ? Math.floor(base * rule.discountValue / 100) : rule.discountValue;
  return Math.min(base, Math.max(0, Math.round(raw)));
}
export function isPosCampaignActive(rule: PosDiscountRule, now: number | Date = Date.now()) {
  const today = posCampaignDate(now);
  return rule.enabled && rule.applicationMode === "campaign" && Boolean(today) && (
    (!rule.startsOn && !rule.endsOn) || (isPosCampaignDate(rule.startsOn) && isPosCampaignDate(rule.endsOn) && rule.startsOn <= rule.endsOn && rule.startsOn <= today && today <= rule.endsOn));
}
export function evaluatePosDiscounts<T extends PosDiscountRule>(rules: T[], manualKey: string, lines: PosDiscountLine[], subtotal: number, now: number | Date = Date.now()) {
  const manual = rules.find(rule => rule.enabled && rule.applicationMode !== "campaign" && rule.key === manualKey);
  let preset = manual;
  let amount = posDiscountAmount(manual, lines, subtotal);
  const campaigns = rules.filter(rule => rule.campaignBasis !== "bowl_choice" && isPosCampaignActive(rule, now) && Number.isSafeInteger(rule.minimumSubtotal ?? 0) && (rule.minimumSubtotal ?? 0) >= 0 && subtotal >= (rule.minimumSubtotal ?? 0))
    .map(rule => ({ preset: rule, amount: posDiscountAmount(rule, lines, subtotal) }))
    .filter(candidate => candidate.amount > 0).sort((a, b) => b.amount - a.amount || a.preset.key.localeCompare(b.preset.key, "en"));
  // Manual wins ties; otherwise use one greatest discount, never sum promotions.
  if (campaigns[0] && campaigns[0].amount > amount) { preset = campaigns[0].preset; amount = campaigns[0].amount; }
  return { preset, amount, campaigns, appliedKey: preset?.key ?? "", applicationMode: preset?.applicationMode === "campaign" ? "campaign" as const : "manual" as const };
}
export type PosDiscountQuote = { version: 1; appliedKey: string; amount: number };
export function matchesPosDiscountQuote(value: unknown, expected: { appliedKey: string; amount: number }) {
  if (!value || typeof value !== "object") return false;
  const quote = value as Record<string, unknown>;
  return quote.version === 1 && typeof quote.appliedKey === "string" && Number.isSafeInteger(quote.amount) && quote.amount === expected.amount && quote.appliedKey === expected.appliedKey;
}
