export const POS_DEBUG_DISPLAY_EVENT = "pos.debug-display";
export const POS_DEBUG_DISPLAY_TTL_MS = 15000;
export const isPosDebugId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const posDebugChannel = (storeId: string, sessionId: string) => `private-pos-debug-${storeId}-${sessionId}`;
export type PosDebugDisplayMessage = {
  storeId: string;
  sessionId: string;
  kind: "state" | "hello" | "ack" | "end";
  sequence: number;
  state?: Record<string, unknown>;
};

/** Display projection only. Never accepts member tokens or print/order identities. */
export function normalizePosDebugDisplayState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const text = (value: unknown, max = 160) => typeof value === "string" ? value.slice(0, max) : "";
  const amount = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(-1e9, Math.min(1e9, Number(value))) : 0;
  const nullable = (value: unknown) => value === null || value === undefined || value === "" ? null : amount(value);
  if (!Array.isArray(input.items) || input.items.length > 50) return null;
  const weighing = input.weighing && typeof input.weighing === "object" ? input.weighing as Record<string, unknown> : null;
  return {
    status: ["idle", "editing", "advertising", "cash_change", "external_wait", "complete"].includes(String(input.status)) ? input.status : "idle",
    storeName: text(input.storeName), orderType: text(input.orderType, 20),
    paymentMethod: text(input.paymentMethod, 30), paymentLabel: text(input.paymentLabel),
    externalPaymentTerminalBrand: text(input.externalPaymentTerminalBrand),
    pickupCode: String(input.pickupCode || "").startsWith("TEST-") ? text(input.pickupCode, 40) : "",
    preferredLanguage: ["ja", "zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(String(input.preferredLanguage)) ? input.preferredLanguage : "ja",
    memberDisplayName: "", memberMessage: "", memberScanCommand: null,
    discountName: text(input.discountName), discountAmount: amount(input.discountAmount),
    couponName: "", couponDiscountAmount: 0, subtotal: amount(input.subtotal),
    taxLabel: text(input.taxLabel, 60), taxAmount: amount(input.taxAmount),
    cashTenderedAmount: nullable(input.cashTenderedAmount), cashChangeAmount: nullable(input.cashChangeAmount),
    items: input.items.map(value => {
      const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return { name: text(item.name), optionLabel: text(item.optionLabel, 500), weightLabel: text(item.weightLabel),
        quantity: Math.max(1, Math.min(99, amount(item.quantity))), unitPrice: amount(item.unitPrice), amount: amount(item.amount) };
    }),
    weighing: weighing ? { itemName: text(weighing.itemName), optionLabel: text(weighing.optionLabel, 500), quantity: amount(weighing.quantity),
      unit: text(weighing.unit, 10), unitPrice: amount(weighing.unitPrice), amount: amount(weighing.amount) } : null
  };
}
