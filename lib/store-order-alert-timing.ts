export type StoreOrderAlertTimingInput = {
  orderSource?: string;
  pickupTiming?: string;
  pickupDate?: string;
  pickupTime?: string;
  paidAt?: string;
  alertPhase?: string;
  initialAlertAcknowledgedAt?: string;
  reminderAlertAcknowledgedAt?: string;
};

export type StoreOrderAlertPhase = "immediate" | "scheduled_initial" | "scheduled_waiting" | "scheduled_reminder";

export const scheduledOrderReminderLeadMinutes = 20;
const scheduledInitialAlertWindowMinutes = 2;

function parsePickupAt(order: StoreOrderAlertTimingInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.pickupDate ?? "") || !/^\d{2}:\d{2}$/.test(order.pickupTime ?? "")) return null;
  const pickupAt = new Date(`${order.pickupDate}T${order.pickupTime}:00+09:00`);
  return Number.isFinite(pickupAt.getTime()) ? pickupAt.getTime() : null;
}

export function isScheduledMaamaaOrder(order: StoreOrderAlertTimingInput) {
  return order.orderSource === "maamaa_web" && order.pickupTiming === "scheduled";
}

export function getStoreOrderAlertPhase(order: StoreOrderAlertTimingInput, now = Date.now()): StoreOrderAlertPhase {
  if (["immediate", "scheduled_initial", "scheduled_waiting", "scheduled_reminder"].includes(order.alertPhase ?? "")) {
    return order.alertPhase as StoreOrderAlertPhase;
  }
  if (!isScheduledMaamaaOrder(order)) return "immediate";

  const paidAt = new Date(order.paidAt ?? "").getTime();
  if (Number.isFinite(paidAt) && now - paidAt < scheduledInitialAlertWindowMinutes * 60 * 1000) {
    return "scheduled_initial";
  }

  const pickupAt = parsePickupAt(order);
  if (pickupAt !== null && pickupAt - now <= scheduledOrderReminderLeadMinutes * 60 * 1000) {
    return "scheduled_reminder";
  }
  return "scheduled_waiting";
}

export function shouldRepeatStoreOrderAlert(phase: StoreOrderAlertPhase) {
  return phase === "immediate" || phase === "scheduled_reminder";
}

export function isStoreOrderAlertAcknowledged(order: StoreOrderAlertTimingInput, phase = getStoreOrderAlertPhase(order)) {
  if (phase === "scheduled_reminder") return Boolean(order.reminderAlertAcknowledgedAt);
  if (phase === "immediate" || phase === "scheduled_initial") return Boolean(order.initialAlertAcknowledgedAt);
  return false;
}
