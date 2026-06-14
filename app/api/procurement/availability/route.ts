import { getSessionStoreScope, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const validSlots = new Set(["morning", "afternoon", "evening"]);

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function PUT(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    employeeId?: unknown;
    date?: unknown;
    slots?: unknown;
    note?: unknown;
  };
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const slots = Array.isArray(body.slots)
    ? Array.from(new Set(body.slots.map((slot) => String(slot)).filter((slot) => validSlots.has(slot))))
    : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

  if (!employeeId) {
    return Response.json({ error: "購入担当を選択してください。" }, { status: 400 });
  }

  if (!isDateKey(date)) {
    return Response.json({ error: "日付を選択してください。" }, { status: 400 });
  }

  const scope = await getSessionStoreScope(session);
  const staffRows = await sql`
    select id
    from employees
    left join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
    where employees.id = ${employeeId}
      and employees.status = 'active'
      and employees.role <> 'store_terminal'
      and (
        ${scope.allStores}
        or employees.id = ${session.id}
        or employee_scopes.store_id::text = any(${scope.storeIds})
      )
    limit 1
  `;

  if (!staffRows[0]?.id) {
    return Response.json({ error: "購入担当が見つかりません。" }, { status: 404 });
  }

  if (slots.length === 0) {
    await sql`
      delete from procurement_staff_unavailable_slots
      where employee_id = ${employeeId}
        and unavailable_date = ${date}::date
    `;
  } else {
    await sql`
      delete from procurement_staff_unavailable_slots
      where employee_id = ${employeeId}
        and unavailable_date = ${date}::date
        and not (slot = any(${slots}))
    `;
  }

  for (const slot of slots) {
    await sql`
      insert into procurement_staff_unavailable_slots (
        employee_id,
        unavailable_date,
        slot,
        note,
        created_by,
        updated_at
      )
      values (
        ${employeeId},
        ${date}::date,
        ${slot},
        ${note},
        ${session.id},
        now()
      )
      on conflict (employee_id, unavailable_date, slot)
      do update set
        note = excluded.note,
        updated_at = now()
    `;
  }

  return Response.json({ ok: true });
}
