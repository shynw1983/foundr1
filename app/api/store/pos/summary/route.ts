import { requireOsSession } from "../../../../../lib/api-auth";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";
import { getTodaySummary } from "../../../../../lib/pos-daily-summary-data";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() || "";
  const access = await getStoreOrderAccess(session), scoped = getScopedStoreFilter(access, storeId);
  if (!storeId || !scoped || scoped === "__forbidden__" || !access.stores.some(s => s.id === scoped)) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  try { return Response.json({ selectedStoreId: scoped, todaySummary: await getTodaySummary(scoped), serverNow: new Date().toISOString() }, { headers }); }
  catch { return Response.json({ error: "売上集計を更新できませんでした。" }, { status: 503, headers }); }
}
