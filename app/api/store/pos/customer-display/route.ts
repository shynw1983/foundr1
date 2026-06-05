import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, bodyStoreId = "") {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = bodyStoreId || new URL(request.url).searchParams.get("storeId") || "";
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

function normalizeDisplayState(value: unknown, fallbackStoreName = "") {
  const state = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
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
    status: normalizeText(state.status) || "idle",
    storeName: normalizeText(state.storeName) || fallbackStoreName,
    orderType: normalizeText(state.orderType),
    paymentMethod: normalizeText(state.paymentMethod) || "cash",
    paymentLabel: normalizeText(state.paymentLabel),
    externalPaymentTerminalBrand: normalizeText(state.externalPaymentTerminalBrand) || "PayCAS",
    pickupCode: normalizeText(state.pickupCode),
    subtotal: Math.max(0, toAmount(state.subtotal)),
    cashTenderedAmount: cashTenderedAmount === null ? null : Math.max(0, cashTenderedAmount),
    cashChangeAmount: toNullableAmount(state.cashChangeAmount),
    updatedLabel: normalizeText(state.updatedLabel),
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

async function getStoreName(storeId: string) {
  if (!storeId) return "";
  const rows = await sql`
    select name
    from stores
    where id::text = ${storeId}
    limit 1
  `;
  return normalizeText(rows[0]?.name);
}

async function getDisplayState(storeId: string) {
  const [storeName, rows] = await Promise.all([
    getStoreName(storeId),
    sql`
      select display_state as "displayState", updated_at as "updatedAt"
      from pos_customer_display_states
      where store_id::text = ${storeId}
      limit 1
    `
  ]);
  const state = normalizeDisplayState(rows[0]?.displayState, storeName);
  return {
    ...state,
    storeName: state.storeName || storeName,
    updatedAt: rows[0]?.updatedAt ? String(rows[0].updatedAt) : ""
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access,
    selectedStoreId,
    state: await getDisplayState(selectedStoreId)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { storeId?: string; state?: unknown };
  const { selectedStoreId, forbidden } = await resolveStoreId(request, session, normalizeText(body.storeId));
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const storeName = await getStoreName(selectedStoreId);
  const state = normalizeDisplayState(body.state, storeName);
  const updatedLabel = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
  const displayState = { ...state, storeName: state.storeName || storeName, updatedLabel };

  await sql`
    insert into pos_customer_display_states (
      store_id,
      display_state,
      updated_by,
      updated_at
    )
    values (
      ${selectedStoreId},
      ${JSON.stringify(displayState)}::jsonb,
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      display_state = excluded.display_state,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({ ok: true, selectedStoreId, state: await getDisplayState(selectedStoreId) });
}
