export type ProcurementFeedbackKind = "price" | "quantity" | "note" | "unavailable";

export type ProcurementConfirmationSnapshot = {
  productId: string;
  unit: string;
  actualPrice?: number;
  referencePrice?: number;
  actualQuantity?: number;
  requestedQuantity?: number;
};

type ConfirmationDecision = { kind: ProcurementFeedbackKind; expectedSnapshot?: ProcurementConfirmationSnapshot } | { error: string; status?: 400 | 409 } | null;

const deliveredStatuses = new Set(["in_delivery", "delivered", "received"]);
const feedbackKinds = new Set<ProcurementFeedbackKind>(["price", "quantity", "note", "unavailable"]);

export function createProcurementConfirmationSnapshot(
  kind: ProcurementFeedbackKind,
  item: { productId?: string; unit: string; actualPrice?: number | string; referencePrice?: number; actualQuantity?: number | null; requestedQuantity: number }
): ProcurementConfirmationSnapshot | undefined {
  const identity = { productId: item.productId ?? "", unit: item.unit };
  if (kind === "price") {
    const actualPrice = normalizeRecordedProcurementQuantity(item.actualPrice);
    const referencePrice = normalizeRecordedProcurementQuantity(item.referencePrice);
    if (actualPrice === null || referencePrice === null) return undefined;
    return { ...identity, actualPrice, referencePrice };
  }
  if (kind === "quantity") {
    const actualQuantity = normalizeRecordedProcurementQuantity(item.actualQuantity);
    if (actualQuantity === null) return undefined;
    return { ...identity, actualQuantity, requestedQuantity: item.requestedQuantity };
  }
  return undefined;
}

export function procurementConfirmationSnapshotMatches(
  expected: ProcurementConfirmationSnapshot,
  current: ProcurementConfirmationSnapshot | undefined
) {
  return current !== undefined && Object.keys(expected).length === Object.keys(current).length &&
    Object.entries(expected).every(([key, value]) => current[key as keyof ProcurementConfirmationSnapshot] === value);
}

export function resolveProcurementFeedbackConfirmation(
  body: Record<string, unknown>,
  item: { currentStatus: string; requestedQuantity: number }
): ConfirmationDecision {
  let kind: ProcurementFeedbackKind | undefined;
  const explicitKind = body.confirmFeedbackKind;
  if (explicitKind !== undefined) {
    if (typeof explicitKind !== "string" || !feedbackKinds.has(explicitKind as ProcurementFeedbackKind)) {
      return { error: "確認する連絡種別が不正です。" };
    }
    kind = explicitKind as ProcurementFeedbackKind;
  } else if (body.clearActualPrice === true) {
    // Older clients used this flag to acknowledge a price warning.
    kind = "price";
  } else if (body.confirmStoreFeedback === true) {
    kind = item.currentStatus === "unavailable" ? "unavailable" : "note";
  } else if (
    Object.keys(body).every((key) => key === "itemId" || key === "actualQuantity") &&
    Object.hasOwn(body, "actualQuantity") &&
    deliveredStatuses.has(item.currentStatus)
  ) {
    // The previous store confirmation button sent exactly this request.
    if (body.actualQuantity !== item.requestedQuantity) {
      return { error: "確認対象の状態が変わりました。最新の内容を確認してください。", status: 409 };
    }
    kind = "quantity";
  }

  if (!kind) return null;
  const allowedKeys = new Set(["itemId", "confirmFeedbackKind"]);
  if (explicitKind !== undefined && (kind === "price" || kind === "quantity")) allowedKeys.add("expectedConfirmation");
  if (explicitKind === undefined && body.clearActualPrice === true) allowedKeys.add("clearActualPrice");
  if (explicitKind === undefined && body.confirmStoreFeedback === true) allowedKeys.add("confirmStoreFeedback");
  if (explicitKind === undefined && kind === "quantity") allowedKeys.add("actualQuantity");
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return { error: "店舗確認と購入内容の変更は別々に保存してください。" };
  }
  if (explicitKind !== undefined && (kind === "price" || kind === "quantity")) {
    const expected = body.expectedConfirmation;
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
      return { error: "確認対象の数量・価格を読み直してください。" };
    }
    const snapshot = expected as Record<string, unknown>;
    const valueKeys = kind === "price" ? ["actualPrice", "referencePrice"] : ["actualQuantity", "requestedQuantity"];
    const expectedKeys = new Set(["productId", "unit", ...valueKeys]);
    if (
      Object.keys(snapshot).length !== expectedKeys.size ||
      Object.keys(snapshot).some((key) => !expectedKeys.has(key)) ||
      typeof snapshot.productId !== "string" || typeof snapshot.unit !== "string" ||
      valueKeys.some((key) => typeof snapshot[key] !== "number" || !Number.isFinite(snapshot[key]) || Number(snapshot[key]) < 0)
    ) {
      return { error: "確認対象の数量・価格が不正です。" };
    }
    return { kind, expectedSnapshot: snapshot as ProcurementConfirmationSnapshot };
  }
  return { kind };
}

export function applyProcurementFeedbackConfirmation<T extends {
  priceFeedbackConfirmed?: boolean;
  quantityFeedbackConfirmed?: boolean;
  storeFeedbackConfirmed?: boolean;
}>(item: T, kind: ProcurementFeedbackKind): T {
  if (kind === "price") return { ...item, priceFeedbackConfirmed: true };
  if (kind === "quantity") return { ...item, quantityFeedbackConfirmed: true };
  return { ...item, storeFeedbackConfirmed: true };
}

export function normalizeRecordedProcurementQuantity(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null;
  const quantity = typeof value === "number" ? value : Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function isPurchasedProcurementStatus(status: string) {
  return ["購入済み", "配送中", "納品済み", "店舗確認済み"].includes(status);
}

export function getProcurementQuantityMetrics(item: {
  status: string;
  requestedQuantity: number;
  actualQuantity: unknown;
}) {
  const purchased = isPurchasedProcurementStatus(item.status);
  const recordedQuantity = normalizeRecordedProcurementQuantity(item.actualQuantity);
  return {
    requestedQuantity: item.requestedQuantity,
    purchasedQuantity: purchased ? recordedQuantity : null,
    missingPurchasedQuantity: purchased && recordedQuantity === null
  };
}
