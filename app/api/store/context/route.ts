import { requireOsSession } from "../../../../lib/api-auth";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access,
    selectedStoreId: storeFilter ?? access.stores[0]?.id ?? ""
  }, { headers: { "Cache-Control": "no-store" } });
}
