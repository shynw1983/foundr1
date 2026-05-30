import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const scope = await getSessionStoreScope(session);
  const storeIds = scope.allStores
    ? (await sql`select id::text from stores where status = 'active'`).map((row) => String(row.id))
    : scope.storeIds;

  return Response.json({
    key: process.env.PUSHER_KEY || "",
    cluster: process.env.PUSHER_CLUSTER || "",
    channels: storeIds.map((storeId) => `private-store-orders-${storeId}`)
  }, { headers: { "Cache-Control": "no-store" } });
}
