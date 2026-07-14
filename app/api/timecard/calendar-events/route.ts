import { randomUUID } from "node:crypto";
import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { syncBusinessCalendarSources } from "../../../../lib/business-calendar";
import { sql } from "../../../../lib/db";

const calendarEditRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const allowedCategories = new Set(["local_event", "festival", "sports", "traffic", "other"]);
const allowedImpacts = new Set(["reference", "busy", "major"]);
const allowedFlowDirections = new Set(["inbound", "outbound", "mixed"]);

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!calendarEditRoles.has(session.role)) return Response.json({ error: "営業カレンダーを編集する権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "create");

  if (action === "sync") {
    if (session.role !== "owner" && session.role !== "manager") {
      return Response.json({ error: "外部情報を同期する権限がありません。" }, { status: 403 });
    }
    const result = await syncBusinessCalendarSources();
    await writeAuditLog({ actorEmployeeId: session.id, action: "business_calendar.synced", targetType: "business_calendar", metadata: result, request });
    return Response.json({ ok: true, result });
  }

  const storeId = String(body.storeId ?? "");
  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の営業カレンダーを編集できません。" }, { status: 403 });
  }

  if (action === "delete") {
    const eventId = String(body.eventId ?? "");
    const rows = await sql`
      delete from business_calendar_events
      where id::text = ${eventId}
        and store_id::text = ${storeId}
        and source_type = 'manual'
      returning id::text
    `;
    if (!rows.length) return Response.json({ error: "対象の予定が見つかりません。" }, { status: 404 });
    await writeAuditLog({ actorEmployeeId: session.id, action: "business_calendar.manual_deleted", targetType: "business_calendar_event", targetId: eventId, metadata: { storeId }, request });
    return Response.json({ ok: true });
  }

  const title = String(body.title ?? "").trim().slice(0, 120);
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? startDate);
  const startTime = String(body.startTime ?? "").trim();
  const endTime = String(body.endTime ?? "").trim();
  const category = allowedCategories.has(String(body.category)) ? String(body.category) : "local_event";
  const impactLevel = allowedImpacts.has(String(body.impactLevel)) ? String(body.impactLevel) : "reference";
  const flowDirection = allowedFlowDirections.has(String(body.flowDirection)) ? String(body.flowDirection) : "mixed";
  const impactStartTime = String(body.impactStartTime || startTime).trim();
  const impactEndTime = String(body.impactEndTime || endTime).trim();
  const venue = String(body.venue ?? "").trim().slice(0, 160);
  const note = String(body.note ?? "").trim().slice(0, 500);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    return Response.json({ error: "予定名と正しい期間を入力してください。" }, { status: 400 });
  }
  if ([startTime, endTime, impactStartTime, impactEndTime].some((value) => value && !/^\d{2}:\d{2}$/.test(value))) {
    return Response.json({ error: "時刻を確認してください。" }, { status: 400 });
  }

  const sourceKey = `manual:${randomUUID()}`;
  const rows = await sql`
    insert into business_calendar_events (
      store_id, source_type, source_key, title, start_date, end_date, start_time, end_time,
      category, impact_level, flow_direction, impact_start_time, impact_end_time, venue, note, created_by
    ) values (
      ${storeId}, 'manual', ${sourceKey}, ${title}, ${startDate}::date, ${endDate}::date,
      ${startTime || null}::time, ${endTime || null}::time, ${category}, ${impactLevel}, ${flowDirection},
      ${impactStartTime || null}::time, ${impactEndTime || null}::time, ${venue}, ${note}, ${session.id}
    )
    returning id::text
  `;
  const eventId = String(rows[0]?.id ?? "");
  await writeAuditLog({ actorEmployeeId: session.id, action: "business_calendar.manual_created", targetType: "business_calendar_event", targetId: eventId, metadata: { storeId, title, startDate, endDate, impactLevel }, request });
  return Response.json({ ok: true, eventId });
}
