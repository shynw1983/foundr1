export const bridgeOrderAlertPhase = "bridge_order_received";
export const orderPushAttempts = 4; // Initial notification plus three reminders.
export const orderPushIntervalMs = 30_000;
export const orderPushLifetimeMs = 5 * 60_000;
export const orderPushSources = ["uber_eats", "rocket_now", "demae_can"];

export function isRecentBridgeObservation(capturedAt: Date, now = Date.now()) {
  const age = now - capturedAt.getTime();
  return Number.isFinite(age) && age >= -60_000 && age <= 120_000;
}

export function canSendOrderPush(input: {
  source: string; status: string; paymentStatus: string; acknowledgedAt?: unknown;
  initialAcknowledgedAt?: unknown; hasWaitingTask: boolean; hasStartedTask: boolean;
  dueAt: string | Date;
}, now = Date.now()) {
  const age = now - new Date(input.dueAt).getTime();
  return orderPushSources.includes(input.source)
    && ["new", "preparing"].includes(input.status)
    && ["paid", "partial_refunded"].includes(input.paymentStatus)
    && !input.acknowledgedAt && !input.initialAcknowledgedAt
    && input.hasWaitingTask && !input.hasStartedTask
    && Number.isFinite(age) && age >= 0 && age < orderPushLifetimeMs;
}

export function orderPushText(order: { storeName: string; source: string; pickupCode: string; amount: number }, attempt: number, language = "ja") {
  const source = ({ uber_eats: "Uber Eats", rocket_now: "Rocket Now", demae_can: "出前館" } as Record<string, string>)[order.source] || order.source;
  const zh = language.startsWith("zh");
  const traditional = language === "zh-Hant";
  const title = `${order.storeName}｜${attempt ? (zh ? (traditional ? "訂單尚未確認" : "订单尚未确认") : "未確認の注文") : (zh ? (traditional ? "新訂單" : "新订单") : "新しい注文")}`;
  return { title, body: `${source}｜${order.pickupCode}｜¥${Math.round(order.amount).toLocaleString("ja-JP")}` };
}
