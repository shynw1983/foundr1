import QRCode from "qrcode";
import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";
import { roleHasPermission } from "../../../../../../lib/role-permissions";
import { buildTableOrderUrl, createTableQrToken, normalizeCheckoutExitPolicy, normalizeTableLabel } from "../../../../../../lib/table-ordering";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../../lib/store-order-access";

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

async function getAccessibleTable(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, tableId: string) {
  const rows = await sql`
    select
      store_tables.id::text,
      store_tables.store_id::text as "storeId",
      store_tables.qr_token as "qrToken"
    from store_tables
    where store_tables.id::text = ${tableId}
    limit 1
  `;
  const table = rows[0];
  if (!table) return null;

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, String(table.storeId));
  if (storeFilter === "__forbidden__" || !storeFilter) return null;
  return table;
}

async function serializeTable(tableId: string, request: Request) {
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
    where store_tables.id::text = ${tableId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const qrUrl = buildTableOrderUrl(String(row.qrToken), request);
  return {
    ...row,
    qrUrl,
    qrCodeDataUrl: await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 320 })
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ tableId: string }> }) {
  const session = await requireOsSession();
  if (!session || !(await canManageTableOrders(session.role))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { tableId } = await context.params;
  const table = await getAccessibleTable(session, tableId);
  if (!table) return Response.json({ error: "テーブルが見つかりません。" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = normalizeText(body.action, 40);
  const shouldRegenerate = action === "regenerate_qr";
  const label = normalizeTableLabel(body.label);

  await sql`
    update store_tables
    set
      label = case when ${label} <> '' then ${label} else label end,
      display_name = case when ${Object.prototype.hasOwnProperty.call(body, "displayName")} then ${normalizeText(body.displayName, 120)} else display_name end,
      area_name = case when ${Object.prototype.hasOwnProperty.call(body, "areaName")} then ${normalizeText(body.areaName, 80)} else area_name end,
      seat_count = case when ${Object.prototype.hasOwnProperty.call(body, "seatCount")} then ${normalizeSeatCount(body.seatCount)} else seat_count end,
      status = case when ${["active", "disabled"].includes(normalizeText(body.status, 20))} then ${normalizeText(body.status, 20)} else status end,
      table_ordering_enabled = case when ${Object.prototype.hasOwnProperty.call(body, "tableOrderingEnabled")} then ${body.tableOrderingEnabled !== false} else table_ordering_enabled end,
      checkout_exit_policy = case when ${Object.prototype.hasOwnProperty.call(body, "checkoutExitPolicy")} then ${normalizeCheckoutExitPolicy(body.checkoutExitPolicy)} else checkout_exit_policy end,
      sort_order = case when ${Object.prototype.hasOwnProperty.call(body, "sortOrder")} then ${Math.max(0, Math.min(9999, Math.round(Number(body.sortOrder) || 100)))} else sort_order end,
      qr_token = case when ${shouldRegenerate} then ${createTableQrToken()} else qr_token end,
      updated_by = ${session.id},
      updated_at = now()
    where id::text = ${tableId}
  `;

  return Response.json({ table: await serializeTable(tableId, request) });
}
