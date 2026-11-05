import { createHash } from "node:crypto";
import { sql } from "./db";
import { OrderPushTransportError, sendOrderPush, type OrderPushDevice } from "./store-order-push-transport";
import { createOsNotification } from "./web-push";

type MenuCommand = { id: string; platform: string; status: string; verified: boolean };
type Alert = { key: string; title: string; body: string };

const platformNames: Record<string, string> = {
  uber_eats: "Uber Eats", rocket_now: "Rocket Now", demae_can: "出前館"
};

export function bridgeMenuSyncAlerts(commands: MenuCommand[], startedBy?: "Mac" | "VPS"): Alert[] {
  const alerts: Alert[] = startedBy
    ? [{ key: "started", title: "菜单同步已开始", body: `${startedBy} Bridge 已领取菜单同步任务。` }]
    : [];
  const demae = commands.find(command => command.platform === "demae_can");
  const other = commands.filter(command => command.platform !== "demae_can");
  const needsDemae = demae && !demae.verified && demae.status !== "processing" &&
    other.length > 0 && other.every(command => command.verified);
  for (const command of commands) {
    if (command.status !== "failed" || (needsDemae && command === demae)) continue;
    alerts.push({
      key: `failed:${command.id}`, title: "菜单同步失败",
      body: `${platformNames[command.platform] ?? command.platform} 同步失败。${command === demae ? "可打开 Android Bridge 检查并手动补同步。" : "请查看任务详情。"}`
    });
  }
  if (needsDemae) alerts.push({
    key: demae.status === "failed" ? `failed:${demae.id}` : "demae-pending", title: "出前館需要跟进",
    body: demae.status === "failed"
      ? "其他平台已同步，出前館同步失败。可打开 Android Bridge 检查并手动补同步。"
      : "其他平台已同步，出前館尚未确认。请先检查差分，再手动补同步。"
  });
  return alerts;
}

export async function notifyBridgeMenuSync(storeId: string, commandId: string, startedBy?: "Mac" | "VPS") {
  const rows = await sql`
    select c.id::text, c.platform, c.status,
      (c.status = 'succeeded' and (c.payload->>'authoritativePublication' = 'true' or exists (
        select 1 from menu_change_sync_tasks t where t.command_id = c.id and t.status = 'succeeded'
      ))) is true as verified,
      s.name as "storeName",
      coalesce(nullif(seed.payload->>'batchId', ''),
        case when seed.payload->>'sourceId' <> '' and seed.payload->>'revision' <> ''
          then concat(seed.payload->>'sourceId', ':', seed.payload->>'revision') end,
        seed.id::text) as "groupId"
    from local_bridge_commands seed
    join stores s on s.id = seed.store_id and s.status = 'active'
    join local_bridge_commands c on c.store_id = seed.store_id and c.command_type = seed.command_type
      and (c.id = seed.id
        or (seed.payload->>'batchId' <> '' and c.payload->>'batchId' = seed.payload->>'batchId')
        or (seed.payload->>'sourceId' <> '' and seed.payload->>'revision' <> ''
          and c.payload->>'sourceId' = seed.payload->>'sourceId' and c.payload->>'revision' = seed.payload->>'revision'))
    where seed.store_id::text = ${storeId} and seed.id::text = ${commandId}
      and seed.command_type = 'publish_menu_changes'
      and c.last_error is distinct from 'uber_authority_superseded_publication'
  ` as (MenuCommand & { storeName: string; groupId: string })[];
  if (!rows.length) return;
  const alerts = bridgeMenuSyncAlerts(rows, startedBy);
  if (!alerts.length) return;

  const recipients = await sql`
    select e.id::text as "employeeId"
    from employees e
    where e.status = 'active' and e.role in ('owner', 'manager', 'store_owner', 'store_manager')
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id::text = ${storeId}
      ))
  `;
  const href = `/store/menu?storeId=${encodeURIComponent(storeId)}`;
  for (const alert of alerts) {
    const body = `${rows[0].storeName} · ${alert.body}`;
    const eventId = createHash("sha256").update(JSON.stringify([storeId, rows[0].groupId, alert.key])).digest("hex").slice(0, 32);
    const deliveryKey = `bridge-menu-sync:${eventId}`;
    await Promise.all(recipients.map(async recipient => {
      const employeeId = String(recipient.employeeId);
      const created = await createOsNotification({ employeeId, type: "bridge_menu_sync", title: alert.title, message: body, href, sourceKey: deliveryKey, sendPush: false });
      if (!created.created) return;
      const devices = await sql`
        select d.id::text, d.employee_id::text as "employeeId", d.session_id::text as "sessionId", d.provider, d.registration
        from store_order_push_devices d join employee_sessions es on es.id = d.session_id and es.employee_id = d.employee_id
        join employees e on e.id = d.employee_id
        where d.employee_id::text = ${employeeId} and d.provider = 'fcm' and d.revoked_at is null and coalesce(d.registration->>'token', '') <> ''
          and es.revoked_at is null and es.expires_at > now() and es.session_version = e.session_version
      ` as OrderPushDevice[];
      await Promise.all(devices.map(async device => {
        try {
          await sendOrderPush(device, { type: "bridge_menu_sync", title: alert.title, body, href, storeId, eventId, deliveryKey, expiresAt: String(Date.now() + 600_000) }, { ttlSeconds: 600 });
        } catch (error) {
          console.error("bridge_menu_sync_push_failed", device.id);
          if (error instanceof OrderPushTransportError && error.expired) {
            await sql`update store_order_push_devices set revoked_at = now() where id::text = ${device.id} and revoked_at is null`;
          }
        }
      }));
    }));
  }
}
