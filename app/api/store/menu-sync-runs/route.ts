import { requireOsSession } from "../../../../lib/api-auth";
import { buildInventorySyncRuns, getInventorySyncCommands } from "../../../../lib/inventory-sync-attention";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const requestedStoreId = String(new URL(request.url).searchParams.get("storeId") ?? "").trim();
  const access = await getStoreOrderAccess(session);
  const storeId = requestedStoreId
    ? getScopedStoreFilter(access, requestedStoreId)
    : access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  const commands = await getInventorySyncCommands(storeId);
  return Response.json({
    runs: buildInventorySyncRuns(commands),
    attention: {
      count: commands.filter(command => command.needsAttention).length,
      failed: commands.filter(command => command.needsAttention && command.status === "failed").length,
      overdue: commands.filter(command => command.overdue).length
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
