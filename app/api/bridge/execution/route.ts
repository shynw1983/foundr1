import { randomUUID } from "node:crypto";
import { canAccessStore, requireOwnerOsSession } from "../../../../lib/api-auth";
import { lockBridgeExecutionRoute } from "../../../../lib/bridge-execution-route";
import { sql } from "../../../../lib/db";
import { publishBridgeCommandAvailable } from "../../../../lib/local-bridge-realtime";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export async function GET(request: Request) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const storeId = new URL(request.url).searchParams.get("storeId")?.toLowerCase() ?? "";
  if (!uuid.test(storeId)) return Response.json({ error: "invalid_store" }, { status: 400 });
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const [devices, routes] = await Promise.all([
    sql`select id::text, platform, device_name, last_seen_at
      from local_bridge_devices where store_id = ${storeId}::uuid
      and platform in ('desktop', 'desktop_vps') and is_enabled`,
    sql`select route.device_id::text, command.id::text as probe_id, command.status,
        command.claimed_by_device_id::text as claimed_by, command.completed_at, command.result
      from local_bridge_execution_routes route
      left join local_bridge_commands command on command.id = route.probe_command_id
      where route.store_id = ${storeId}::uuid and route.platform = 'rocket_now'`
  ]);
  return Response.json({ devices, route: routes[0] ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const storeId = String(body?.storeId ?? "").toLowerCase();
  const deviceId = String(body?.deviceId ?? "").toLowerCase();
  if (!uuid.test(storeId) || !uuid.test(deviceId)) {
    return Response.json({ error: "invalid_target" }, { status: 400 });
  }
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const probeId = randomUUID();
  const [, rows] = await sql.transaction([
    lockBridgeExecutionRoute(storeId),
    sql`with eligible as (
      select id from local_bridge_devices
      where store_id = ${storeId}::uuid and id = ${deviceId}::uuid
        and platform in ('desktop', 'desktop_vps') and is_enabled
        and last_seen_at >= now() - interval '6 minutes'
        and not exists (
          select 1 from local_bridge_commands
          where store_id = ${storeId}::uuid and platform = 'rocket_now'
            and (status = 'processing' or (
              status = 'pending' and (
                (command_type = 'bridge_read_probe' and created_at >= now() - interval '5 minutes')
                or (attempts > 0 and command_type in ('set_inventory_availability', 'publish_menu_changes'))
              )
            ))
        )
    ), probe as (
      insert into local_bridge_commands (id, store_id, platform, command_type, idempotency_key, payload)
      select ${probeId}::uuid, ${storeId}::uuid, 'rocket_now', 'bridge_read_probe',
        ${"bridge-read-probe:" + probeId}, jsonb_build_object('deviceId', id::text)
      from eligible returning id
    )
    insert into local_bridge_execution_routes (store_id, platform, device_id, probe_command_id)
    select ${storeId}::uuid, 'rocket_now', ${deviceId}::uuid, id from probe
    on conflict (store_id, platform) do update
    set device_id = excluded.device_id, probe_command_id = excluded.probe_command_id
    returning device_id::text, probe_command_id::text`
  ]);
  if (!rows[0]) return Response.json({ error: "bridge_busy_or_unavailable" }, { status: 409 });
  await publishBridgeCommandAvailable(storeId).catch(() => undefined);
  return Response.json(rows[0]);
}
