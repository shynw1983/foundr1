import { canAccessStore, requireWritableOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function PATCH(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    orderId?: string;
    supplier?: string;
    expectedArrivalDate?: string;
    onlineOrderStatus?: "not_started" | "online_ordered";
  };
  const orderId = String(body.orderId ?? "").trim();
  const supplierName = String(body.supplier ?? "").trim();
  const expectedArrivalDate = String(body.expectedArrivalDate ?? "").trim();
  const onlineOrderStatus = body.onlineOrderStatus === "online_ordered" ? "online_ordered" : "not_started";

  if (!orderId) {
    return Response.json({ error: "orderId is required" }, { status: 400 });
  }

  if (expectedArrivalDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedArrivalDate)) {
    return Response.json({ error: "到着予定日の形式が不正です。" }, { status: 400 });
  }

  const existingOrder = await sql`
    select id, store_id::text as "storeId"
    from purchase_orders
    where order_no = ${orderId}
    limit 1
  `;

  if (!existingOrder[0]) {
    return Response.json({ error: "発注依頼が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, existingOrder[0].storeId)) {
    return Response.json({ error: "この依頼を操作する権限がありません。" }, { status: 403 });
  }

  if (!supplierName) {
    return Response.json({ error: "supplier is required" }, { status: 400 });
  }

  const supplierRows = await sql`
    select id
    from suppliers
    where name = ${supplierName}
    limit 1
  `;

  await sql`
    insert into purchase_order_supplier_fulfillments (
      purchase_order_id,
      supplier_id,
      supplier_name,
      expected_arrival_date,
      online_order_status
    )
    values (
      ${existingOrder[0].id},
      ${supplierRows[0]?.id ?? null},
      ${supplierName},
      ${expectedArrivalDate || null},
      ${onlineOrderStatus}
    )
    on conflict (purchase_order_id, supplier_name)
    do update set
      supplier_id = excluded.supplier_id,
      expected_arrival_date = excluded.expected_arrival_date,
      online_order_status = excluded.online_order_status,
      updated_at = now()
    returning id
  `;

  return Response.json({ ok: true });
}
