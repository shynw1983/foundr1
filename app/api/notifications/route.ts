import { requireOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { inventorySyncCurrentBusinessDaySql } from "../../../lib/inventory-sync-business-day";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Existing inventory notices follow the original operation's store business day.
// Other notification types and historical records keep their existing behavior.
const visibleNotificationSql = `(n.notification_type is distinct from 'inventory_sync_attention' or exists (
  select 1 from local_bridge_commands c join stores s on s.id = c.store_id
  where n.source_key = 'inventory-sync:' || c.id::text
    and c.command_type = 'set_inventory_availability'
    and ${inventorySyncCurrentBusinessDaySql('c', 's')}
))`;

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const notifications = await sql.query(`
    select
      n.id::text,
      n.notification_type as "type",
      n.title,
      n.message,
      coalesce(n.href, '') as href,
      n.read_at as "readAt",
      n.created_at as "createdAt"
    from os_notifications n
    where n.recipient_employee_id = $1::uuid
      and n.read_at is null
      and ${visibleNotificationSql}
    order by n.created_at desc
    limit 20
  `, [session.id]);
  const unreadCountRows = await sql.query(`
    select count(*)::int as count
    from os_notifications n
    where n.recipient_employee_id = $1::uuid
      and n.read_at is null
      and ${visibleNotificationSql}
  `, [session.id]);

  return Response.json({
    notifications,
    unreadCount: Number(unreadCountRows[0]?.count ?? 0)
  });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { id?: unknown };
  const notificationId = typeof body.id === "string" ? body.id.trim() : "";

  if (notificationId) {
    if (!UUID_PATTERN.test(notificationId)) {
      return Response.json({ error: "通知IDが不正です。" }, { status: 400 });
    }

    await sql`
      update os_notifications
      set read_at = now()
      where recipient_employee_id = ${session.id}
        and id = ${notificationId}::uuid
        and read_at is null
    `;

    return Response.json({ ok: true });
  }

  await sql`
    update os_notifications
    set read_at = now()
    where recipient_employee_id = ${session.id}
      and read_at is null
  `;

  return Response.json({ ok: true });
}
