import { requireOsSession } from "../../../../lib/api-auth";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const access = await getStoreOrderAccess(session);
  const selectedStoreId = getScopedStoreFilter(access, requestedStoreId) ?? access.stores[0]?.id ?? "";
  if (!selectedStoreId || selectedStoreId === "__forbidden__") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  return Response.json({
    key: process.env.PUSHER_KEY || "",
    cluster: process.env.PUSHER_CLUSTER || "",
    channels: [`private-store-orders-${selectedStoreId}`]
  }, { headers: { "Cache-Control": "no-store" } });
}
