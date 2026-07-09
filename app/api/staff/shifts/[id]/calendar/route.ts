import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function addDateDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function isEarlyMorningShiftStart(value: string | null | undefined) {
  return Boolean(value && value < "06:00");
}

function toCalendarDateTime(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function getShiftCalendarParts(shift: { workDate: string; scheduledStart: string; scheduledEnd: string }) {
  const actualStartDate = isEarlyMorningShiftStart(shift.scheduledStart)
    ? addDateDays(shift.workDate, 1)
    : shift.workDate;
  const actualEndDate = shift.scheduledEnd <= shift.scheduledStart
    ? addDateDays(actualStartDate, 1)
    : actualStartDate;
  return {
    actualStartDate,
    actualEndDate,
    start: toCalendarDateTime(actualStartDate, shift.scheduledStart),
    end: toCalendarDateTime(actualEndDate, shift.scheduledEnd)
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (session.role === "store_terminal") {
    return Response.json({ error: "スタッフ個人アプリを利用できません。" }, { status: 403 });
  }

  const { id } = await context.params;
  const rows = await sql`
    select
      timecard_shifts.id::text,
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      stores.name as "storeName"
    from timecard_shifts
    join stores on stores.id = timecard_shifts.store_id
    where timecard_shifts.id::text = ${id}
      and timecard_shifts.employee_id::text = ${session.id}
      and timecard_shifts.scheduled_start is not null
      and timecard_shifts.scheduled_end is not null
    limit 1
  `;

  const shift = rows[0];
  if (!shift?.scheduledStart || !shift.scheduledEnd) {
    return Response.json({ error: "シフトが見つかりません。" }, { status: 404 });
  }

  const workDate = String(shift.workDate);
  const scheduledStart = String(shift.scheduledStart);
  const scheduledEnd = String(shift.scheduledEnd);
  const calendar = getShiftCalendarParts({ workDate, scheduledStart, scheduledEnd });
  const summary = "Foundr1 シフト";
  const description = calendar.actualStartDate !== workDate
    ? `営業日 ${workDate} / ${scheduledStart}-${scheduledEnd}`
    : `${workDate} ${scheduledStart}-${scheduledEnd}`;
  const fileName = `foundr1-shift-${calendar.actualStartDate}.ics`;
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Foundr1//Staff Shift//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:foundr1-staff-shift-${shift.id}@foundr1.jp`,
    `DTSTART;TZID=Asia/Tokyo:${calendar.start}`,
    `DTEND;TZID=Asia/Tokyo:${calendar.end}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(String(shift.storeName ?? ""))}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store"
    }
  });
}
