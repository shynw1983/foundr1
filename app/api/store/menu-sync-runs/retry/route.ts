import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import {
  publishBridgeCommandAvailable,
  publishBridgeCommandUpdated
} from "../../../../../lib/local-bridge-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedStoreId = String(body.storeId ?? "").trim();
  const commandId = String(body.commandId ?? "").trim();
  const access = await getStoreOrderAccess(session);
  const storeId = requestedStoreId
    ? getScopedStoreFilter(access, requestedStoreId)
    : access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  if (!commandId) return Response.json({ error: "Command ID is required." }, { status: 400 });

  const progress = {
    progress: {
      phase: "queued",
      attempt: 1,
      maxAttempts: 3
    }
  };
  const rows = await sql`
    update local_bridge_commands as target
    set
      status = 'pending',
      attempts = 0,
      available_at = now(),
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = null,
      result = ${JSON.stringify(progress)}::jsonb,
      last_error = '',
      updated_at = now()
    where target.id::text = ${commandId}
      and target.store_id::text = ${storeId}
      and target.command_type = 'set_inventory_availability'
      and target.status = 'failed'
      and not exists (
        select 1
        from local_bridge_commands as newer
        where newer.store_id = target.store_id
          and newer.platform = target.platform
          and newer.command_type = target.command_type
          and newer.payload->>'inventoryKey' = target.payload->>'inventoryKey'
          and newer.created_at > target.created_at
      )
    returning target.id::text, target.platform
  `;
  if (!rows[0]) {
    return Response.json({ error: "This task cannot be retried because it is no longer failed or a newer task exists." }, { status: 409 });
  }

  const platform = String(rows[0].platform ?? "");
  await publishBridgeCommandUpdated(storeId, {
    id: commandId,
    platform,
    status: "pending",
    error: "",
    result: progress
  }).catch(() => undefined);
  await publishBridgeCommandAvailable(storeId).catch(() => undefined);
  return Response.json({
    ok: true,
    command: {
      id: commandId,
      platform,
      status: "queued",
      error: "",
      result: progress
    }
  });
}
