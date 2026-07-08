import { requireOsSession } from "../../../../../lib/api-auth";
import { resolveCustomerStoreDisplayName } from "../../../../../lib/customer-display-names";
import { sql } from "../../../../../lib/db";
import { publishPosCustomerDisplayEvent } from "../../../../../lib/order-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDisplayLanguage(value: unknown) {
  const language = normalizeText(value);
  return ["ja", "zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(language) ? language : "";
}

function normalizeCustomerDisplayMediaSettings(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const modeValue = normalizeText(record.mode);
  const transitionValue = normalizeText(record.transition);
  const backgroundColor = normalizeText(record.backgroundColor);
  const assets = Array.isArray(record.assets) ? record.assets : [];
  return {
    mode: modeValue === "slideshow" || modeValue === "video" ? modeValue : "default",
    transition: transitionValue === "slide" || transitionValue === "none" ? transitionValue : "fade",
    slideDurationSeconds: Math.max(3, Math.min(60, Math.round(Number(record.slideDurationSeconds) || 8))),
    videoMuted: record.videoMuted !== false,
    videoLoop: record.videoLoop !== false,
    backgroundColor: /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : "#fbfbf8",
    assets: assets.flatMap((item, index) => {
      const asset = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const url = normalizeText(asset.url);
      if (!url) return [];
      const type = normalizeText(asset.type) === "video" ? "video" : "image";
      return [{
        id: normalizeText(asset.id) || `asset_${index + 1}`,
        type,
        url: url.slice(0, 500),
        name: normalizeText(asset.name).slice(0, 120) || type,
        durationSeconds: Math.max(3, Math.min(60, Math.round(Number(asset.durationSeconds) || Number(record.slideDurationSeconds) || 8))),
        fit: normalizeText(asset.fit) === "contain" ? "contain" : "cover"
      }];
    }).slice(0, 12)
  };
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
  const memberScanCommand = state.memberScanCommand && typeof state.memberScanCommand === "object" && !Array.isArray(state.memberScanCommand)
    ? state.memberScanCommand as Record<string, unknown>
    : null;
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
    memberScanCommand: memberScanCommand
      ? {
          id: normalizeText(memberScanCommand.id),
          action: normalizeText(memberScanCommand.action),
          createdAt: normalizeText(memberScanCommand.createdAt)
        }
      : null,
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

async function getCustomerDisplayStoreOptions(stores: Array<{ id: string; name: string }>) {
  if (!stores.length) return [];
  const rows = await sql`
    select
      id::text,
      name,
      coalesce(customer_display_names, '{}'::jsonb) as "customerDisplayNames"
    from stores
    where id::text = any(${stores.map((store) => store.id)})
  `;
  const displayNamesById = new Map((rows as Array<{ id: string; name: string; customerDisplayNames?: unknown }>).map((store) => [
    store.id,
    resolveCustomerStoreDisplayName({
      settings: store.customerDisplayNames,
      internalStoreName: normalizeText(store.name),
      platform: "foundr1_pos"
    })
  ]));
  return stores.map((store) => ({
    ...store,
    name: displayNamesById.get(store.id) || store.name
  }));
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
    storeName,
    updatedAt: rows[0]?.updatedAt ? String(rows[0].updatedAt) : ""
  };
}

async function getCustomerDisplayMediaSettings(storeId: string) {
  const rows = await sql`
    select coalesce(customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings"
    from pos_store_settings
    where store_id::text = ${storeId}
    limit 1
  `;
  return normalizeCustomerDisplayMediaSettings(rows[0]?.customerDisplayMediaSettings);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access: { ...access, stores: await getCustomerDisplayStoreOptions(access.stores) },
    selectedStoreId,
    state: await getDisplayState(selectedStoreId),
    customerDisplayMediaSettings: await getCustomerDisplayMediaSettings(selectedStoreId)
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
  const displayState = { ...state, storeName, updatedLabel };

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

  const nextState = await getDisplayState(selectedStoreId);
  await publishPosCustomerDisplayEvent(selectedStoreId, nextState).catch(() => undefined);

  return Response.json({ ok: true, selectedStoreId, state: nextState });
}
