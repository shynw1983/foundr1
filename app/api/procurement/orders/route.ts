import { requireWritableOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function PATCH(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    orderId?: string;
    expectedArrivalDate?: string;
    onlineOrderStatus?: "not_started" | "online_ordered";
  };
  const orderId = String(body.orderId ?? "").trim();
  const expectedArrivalDate = String(body.expectedArrivalDate ?? "").trim();
  const onlineOrderStatus = body.onlineOrderStatus === "online_ordered" ? "online_ordered" : "not_started";

  if (!orderId) {
    return Response.json({ error: "orderId is required" }, { status: 400 });
  }

  if (expectedArrivalDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedArrivalDate)) {
    return Response.json({ error: "到着予定日の形式が不正です。" }, { status: 400 });
  }

  const rows = await sql`
    update purchase_orders
    set
      expected_arrival_date = ${expectedArrivalDate || null},
      online_order_status = ${onlineOrderStatus},
      updated_at = now()
    where order_no = ${orderId}
    returning id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "仕入れ依頼が見つかりません。" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
