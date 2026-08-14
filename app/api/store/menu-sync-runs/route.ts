import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommandRow = {
  id: string;
  platform: string;
  status: string;
  payload: Record<string, unknown> | null;
  lastError: string;
  createdAt: string;
};

function commandStatus(value: string) {
  if (value === "succeeded") return "succeeded" as const;
  if (value === "pending" || value === "processing") return "pending" as const;
  return "failed" as const;
}

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

  const rows = await sql`
    select
      id::text,
      platform,
      status,
      payload,
      last_error as "lastError",
      created_at::text as "createdAt"
    from local_bridge_commands
    where store_id::text = ${storeId}
      and command_type = 'set_inventory_availability'
      and created_at > now() - interval '30 minutes'
      and coalesce(payload->>'syncRunId', '') <> ''
    order by created_at desc
    limit 60
  ` as CommandRow[];

  const grouped = new Map<string, {
    id: string;
    itemLabel: string;
    isAvailable: boolean;
    source: "siri" | "store";
    createdAt: string;
    platforms: Array<{
      commandId: string;
      platform: string;
      status: "pending" | "succeeded" | "failed";
      error: string;
    }>;
  }>();

  for (const row of rows) {
    const payload = row.payload ?? {};
    const runId = String(payload.syncRunId ?? "");
    if (!runId) continue;
    const run = grouped.get(runId) ?? {
      id: runId,
      itemLabel: String(payload.feedbackLabel ?? payload.ingredientLabel ?? ""),
      isAvailable: payload.isAvailable === true,
      source: payload.syncSource === "siri" ? "siri" : "store",
      createdAt: row.createdAt,
      platforms: [{
        commandId: `${runId}-foundr1`,
        platform: "foundr1",
        status: "succeeded" as const,
        error: ""
      }]
    };
    run.platforms.push({
      commandId: row.id,
      platform: row.platform,
      status: commandStatus(row.status),
      error: row.lastError
    });
    grouped.set(runId, run);
  }

  const platformOrder = new Map([
    ["foundr1", 0],
    ["uber_eats", 1],
    ["rocket_now", 2],
    ["demae_can", 3]
  ]);
  const runs = [...grouped.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4)
    .map((run) => ({
      ...run,
      platforms: run.platforms.sort((a, b) => (
        (platformOrder.get(a.platform) ?? 99) - (platformOrder.get(b.platform) ?? 99)
      ))
    }));

  return Response.json({ runs }, { headers: { "Cache-Control": "no-store" } });
}
