import { requireOsSession, requireWritableOsSession } from "../../../lib/api-auth";
import { readReplenishmentSnapshot } from "../../../lib/replenishment-data";
import { roleHasPermission } from "../../../lib/role-permissions";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return Response.json({ error: "店舗を指定してください。" }, { status: 400 });
  }
  const access = await getStoreOrderAccess(session);
  const scopedStoreId = getScopedStoreFilter(access, storeId);
  if (!scopedStoreId || scopedStoreId === "__forbidden__") {
    return Response.json({ error: "この店舗の補充状況を確認する権限がありません。" }, { status: 403 });
  }
  const canUseOrders = await roleHasPermission(session.role, "module.orders");
  const writable = canUseOrders ? await requireWritableOsSession() : null;
  const canCreateOrder = Boolean(writable && writable.id === session.id && writable.role === session.role);
  const canManageMenuLinks = (session.role === "owner" || session.role === "manager")
    && await roleHasPermission(session.role, "menus.edit");
  try {
    const snapshot = await readReplenishmentSnapshot(session, storeId, canCreateOrder, canManageMenuLinks);
    if (!snapshot) return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // A failed read must never be presented as an empty, healthy risk list.
    return Response.json({ error: "補充状況を取得できませんでした。しばらくしてから再試行してください。" }, {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }
}
