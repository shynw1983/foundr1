import { sql } from "./db";
import { resolveCustomerStoreDisplayName } from "./customer-display-names";
import { customerDisplayRecord, customerDisplayRevision, readCustomerDisplayWeighing } from "./pos-customer-display";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeDisplayLanguage(value: unknown) {
  const language = normalizeText(value);
  return ["ja", "zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(language) ? language : "";
}

export function isFreshIsoTime(value: string, ttlMs = 2 * 60 * 1000) {
  const ageMs = Date.now() - new Date(value).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs;
}

export function readMemberScanCommand(value: unknown) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const command = state.memberScanCommand && typeof state.memberScanCommand === "object" && !Array.isArray(state.memberScanCommand)
    ? state.memberScanCommand as Record<string, unknown>
    : {};
  const id = normalizeText(command.id);
  const action = normalizeText(command.action);
  const createdAt = normalizeText(command.createdAt);
  if (!id || action !== "open_scanner" || !createdAt || !isFreshIsoTime(createdAt)) return null;
  return { id, action, createdAt };
}

export function readMemberScanRequest(value: unknown) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const request = state.memberScanRequest && typeof state.memberScanRequest === "object" && !Array.isArray(state.memberScanRequest)
    ? state.memberScanRequest as Record<string, unknown>
    : {};
  const id = normalizeText(request.id);
  const code = normalizeText(request.code);
  const createdAt = normalizeText(request.createdAt);
  if (!id || !code || !createdAt || !isFreshIsoTime(createdAt)) return null;
  return { id, code, createdAt };
}

export function normalizeDisplayState(value: unknown, fallbackStoreName = "") {
  const state = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const memberScanCommand = readMemberScanCommand(state);
  const toAmount = (amount: unknown) => {
    const nextAmount = Number(amount ?? 0);
    return Number.isFinite(nextAmount) ? Math.round(nextAmount) : 0;
  };
  const toNullableAmount = (amount: unknown) => {
    if (amount === null || amount === undefined || amount === "") return null;
    const nextAmount = Number(amount);
    return Number.isFinite(nextAmount) ? Math.round(nextAmount) : null;
  };
  const cashTenderedAmount = toNullableAmount(state.cashTenderedAmount);
  return {
    revision: customerDisplayRevision(state.revision),
    serverNow: new Date().toISOString(),
    weighing: readCustomerDisplayWeighing(state.weighing),
    status: normalizeText(state.status) || "idle",
    storeName: normalizeText(state.storeName) || fallbackStoreName,
    orderType: normalizeText(state.orderType),
    paymentMethod: normalizeText(state.paymentMethod) || "cash",
    paymentLabel: normalizeText(state.paymentLabel),
    externalPaymentTerminalBrand: normalizeText(state.externalPaymentTerminalBrand) || "PayCAS",
    pickupCode: normalizeText(state.pickupCode),
    numberKind: state.numberKind === "accounting" ? "accounting" : "pickup",
    preferredLanguage: normalizeDisplayLanguage(state.preferredLanguage),
    memberDisplayName: normalizeText(state.memberDisplayName).slice(0, 80),
    memberMessage: normalizeText(state.memberMessage).slice(0, 120),
    discountName: normalizeText(state.discountName).slice(0, 80),
    discountAmount: Math.max(0, toAmount(state.discountAmount)),
    couponName: normalizeText(state.couponName).slice(0, 80),
    couponDiscountAmount: Math.max(0, toAmount(state.couponDiscountAmount)),
    subtotal: Math.max(0, toAmount(state.subtotal)),
    taxLabel: normalizeText(state.taxLabel).slice(0, 40),
    taxAmount: Math.max(0, toAmount(state.taxAmount)),
    cashTenderedAmount: cashTenderedAmount === null ? null : Math.max(0, cashTenderedAmount),
    cashChangeAmount: toNullableAmount(state.cashChangeAmount),
    updatedLabel: normalizeText(state.updatedLabel),
    memberScanCommand,
    memberScanRequest: readMemberScanRequest(state),
    items: Array.isArray(state.items)
      ? state.items.slice(0, 50).map((item) => {
          const row = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
          return {
            name: normalizeText(row.name),
            optionLabel: normalizeText(row.optionLabel),
            weightLabel: normalizeText(row.weightLabel),
            quantity: Math.max(1, Math.min(99, toAmount(row.quantity || 1))),
            unitPrice: Math.max(0, toAmount(row.unitPrice)),
            amount: Math.max(0, toAmount(row.amount))
          };
        }).filter((item) => item.name)
      : []
  };
}

export async function getStoreName(storeId: string) {
  if (!storeId) return "";
  const rows = await sql`
    select
      name,
      coalesce(customer_display_names, '{}'::jsonb) as "customerDisplayNames"
    from stores
    where id::text = ${storeId}
    limit 1
  `;
  const row = rows[0] as { name?: string; customerDisplayNames?: unknown } | undefined;
  if (!row) return "";
  return resolveCustomerStoreDisplayName({
    settings: row.customerDisplayNames,
    internalStoreName: normalizeText(row.name),
    platform: "foundr1_pos"
  });
}

export async function getDisplayState(storeId: string) {
  const [storeName, rows] = await Promise.all([
    getStoreName(storeId),
    sql`
      select display_state as "displayState", updated_at as "updatedAt"
      from pos_customer_display_states
      where store_id::text = ${storeId}
      limit 1
    `
  ]);
  const raw = customerDisplayRecord(rows[0]?.displayState);
  const state = normalizeDisplayState(raw, storeName);
  const writer = customerDisplayRecord(raw._displayWriter);
  if (state.weighing && writer.stationId) {
    const owners = await sql`select id from store_relay_stations where id::text=${String(writer.stationId)}
      and store_id::text=${storeId} and enabled and epoch=${Number(writer.epoch)}
      and owner_employee_id::text=${String(writer.employeeId)} and owner_session_id=${String(writer.sessionId)}
      and owner_until>clock_timestamp()`;
    if (!owners.length) state.weighing = null;
  }
  return {
    ...state,
    storeName,
    updatedAt: rows[0]?.updatedAt ? String(rows[0].updatedAt) : ""
  };
}
