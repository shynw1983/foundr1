import { requireOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

export async function GET() {
  const session = await requireOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const notifications = await sql`
    select
      id::text,
      notification_type as "type",
      title,
      message,
      coalesce(href, '') as href,
      read_at as "readAt",
      created_at as "createdAt"
    from ops_notifications
    where recipient_employee_id = ${session.id}
      and read_at is null
    order by created_at desc
    limit 20
  `;
  const unreadCountRows = await sql`
    select count(*)::int as count
    from ops_notifications
    where recipient_employee_id = ${session.id}
      and read_at is null
  `;

  return Response.json({
    notifications,
    unreadCount: Number(unreadCountRows[0]?.count ?? 0)
  });
}

export async function PATCH() {
  const session = await requireOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  await sql`
    update ops_notifications
    set read_at = now()
    where recipient_employee_id = ${session.id}
      and read_at is null
  `;

  return Response.json({ ok: true });
}
