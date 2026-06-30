import QRCode from "qrcode";
import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { roleHasPermission } from "../../../../../lib/role-permissions";
import { buildTableOrderUrl, createTableQrToken, normalizeCheckoutExitPolicy, normalizeTableLabel } from "../../../../../lib/table-ordering";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown, maxLength = 120) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeSeatCount(value: unknown) {
  const count = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(999, count));
}

async function canManageTableOrders(role: string) {
  return roleHasPermission(role, "pos.manageSettings");
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function qrDataUrl(value: string) {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320
  });
}

async function tableRows(storeId: string, request: Request, includeQrCodes: boolean) {
  const rows = await sql`
    select
      store_tables.id::text,
      store_tables.store_id::text as "storeId",
      coalesce(store_tables.brand_id::text, '') as "brandId",
      coalesce(brands.name, '') as "brandName",
      stores.name as "storeName",
      store_tables.label,
      store_tables.display_name as "displayName",
      store_tables.area_name as "areaName",
      store_tables.seat_count as "seatCount",
      store_tables.qr_token as "qrToken",
      store_tables.status,
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      store_tables.checkout_exit_policy as "checkoutExitPolicy",
      store_tables.sort_order as "sortOrder",
      store_tables.updated_at::text as "updatedAt"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    where store_tables.store_id::text = ${storeId}
    order by store_tables.sort_order, store_tables.area_name, store_tables.label
  `;

  return Promise.all(rows.map(async (row) => {
    const qrUrl = buildTableOrderUrl(String(row.qrToken), request);
    return {
      ...row,
      qrUrl,
      qrCodeDataUrl: includeQrCodes ? await qrDataUrl(qrUrl) : ""
    };
  }));
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canManageTableOrders(session.role))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden) return Response.json({ error: "店舗へのアクセス権限がありません。" }, { status: 403 });
  if (!selectedStoreId) return Response.json({ stores: access.stores, selectedStoreId: "", tables: [] });

  const includeQrCodes = new URL(request.url).searchParams.get("includeQrCodes") === "1";
  return Response.json({
    stores: access.stores,
    selectedStoreId,
    tables: await tableRows(selectedStoreId, request, includeQrCodes)
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canManageTableOrders(session.role))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const label = normalizeTableLabel(body.label);
  const storeId = normalizeText(body.storeId, 80);
  const brandId = normalizeText(body.brandId, 80);
  if (!storeId || !label) {
    return Response.json({ error: "店舗とテーブル番号を入力してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "店舗へのアクセス権限がありません。" }, { status: 403 });
  }

  if (brandId) {
    const brandRows = await sql`
      select 1
      from store_brands
      join brands on brands.id = store_brands.brand_id
      where store_brands.store_id::text = ${storeId}
        and store_brands.brand_id::text = ${brandId}
        and brands.status = 'active'
      limit 1
    `;
    if (!brandRows[0]) return Response.json({ error: "この店舗で利用できないブランドです。" }, { status: 400 });
  }

  const token = createTableQrToken();
  const rows = await sql`
    insert into store_tables (
      store_id,
      brand_id,
      label,
      display_name,
      area_name,
      seat_count,
      qr_token,
      status,
      table_ordering_enabled,
      checkout_exit_policy,
      sort_order,
      created_by,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${brandId || null},
      ${label},
      ${normalizeText(body.displayName, 120)},
      ${normalizeText(body.areaName, 80)},
      ${normalizeSeatCount(body.seatCount)},
      ${token},
      'active',
      ${body.tableOrderingEnabled !== false},
      ${normalizeCheckoutExitPolicy(body.checkoutExitPolicy)},
      ${Math.max(0, Math.min(9999, Math.round(Number(body.sortOrder) || 100)))},
      ${session.id},
      ${session.id},
      now()
    )
    returning id::text
  `;

  const tables = await tableRows(storeId, request, true);
  return Response.json({ tableId: rows[0]?.id ?? "", tables }, { status: 201 });
}
