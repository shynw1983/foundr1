import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { withInventoryOperationLock } from "../../../../../lib/inventory-operation-lock";
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

  // Read retries cannot change availability or revive an applied/stale preview.
  if (body.action === 'retry_read') {
    try {
      const rows = await withInventoryOperationLock(storeId, () => sql`
        update local_bridge_commands c set status='pending', attempts=0, available_at=now(),
          claimed_by_device_id=null, claimed_at=null, claim_expires_at=null, completed_at=null,
          result='{}'::jsonb, last_error='', updated_at=now()
        from menu_inventory_sync_runs r
        where c.id::text=${commandId} and c.store_id::text=${storeId}
          and c.command_type='audit_inventory' and c.status='failed'
          and c.payload->>'availabilityAuthority'='uber_eats'
          and r.id::text=c.payload->>'fullSyncRunId' and r.store_id=c.store_id
          and r.details->>'comparisonVersion'='1' and coalesce(r.details->>'osApplied','false')<>'true'
          and (r.details->>'previewAt' is null or (r.details->>'previewAt')::timestamptz > now()-interval '10 minutes')
          and not exists (select 1 from menu_inventory_sync_runs newer where newer.store_id=r.store_id and newer.created_at>r.created_at)
          and not exists (select 1 from local_bridge_commands busy where busy.store_id=c.store_id
            and busy.status in ('pending','processing') and busy.command_type in ('audit_inventory','set_inventory_availability','publish_menu_changes','capture_menu_snapshot'))
        returning c.id::text
      `);
      if (!rows.length) return Response.json({error:'再読み取りできません。他の処理の完了後、全プラットフォームを読み直してください。'},{status:409});
      await publishBridgeCommandAvailable(storeId).catch(()=>undefined);
      return Response.json({ok:true});
    } catch {
      return Response.json({error:'処理中です。完了後に再読み取りしてください。'},{status:409});
    }
  }

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
      payload = target.payload || jsonb_build_object('manualRetryAt', now()),
      result = ${JSON.stringify(progress)}::jsonb,
      last_error = '',
      updated_at = now()
    where target.id::text = ${commandId}
      and target.store_id::text = ${storeId}
      and target.command_type = 'set_inventory_availability'
      and target.status = 'failed'
      and coalesce(target.payload->>'mappingBlocked','false') <> 'true'
      and not exists (
        select 1 from local_bridge_commands reading
        where reading.store_id=target.store_id and reading.command_type='audit_inventory'
          and reading.payload->>'availabilityAuthority'='uber_eats' and reading.status in ('pending','processing')
      )
      and not exists (
        select 1
        from local_bridge_commands as newer
        where newer.store_id = target.store_id
          and newer.platform = target.platform
          and newer.command_type = target.command_type
          and newer.created_at > target.created_at
          and (
            newer.payload->>'inventoryKey' = target.payload->>'inventoryKey'
            or exists (
              select 1
              from jsonb_array_elements(coalesce(newer.payload->'targets', '[]'::jsonb)) newer_target
              join jsonb_array_elements(coalesce(target.payload->'targets', '[]'::jsonb)) old_target
                on newer_target->>'kind' = old_target->>'kind'
                and newer_target->>'targetId' = old_target->>'targetId'
            )
          )
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
