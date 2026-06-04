import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function GET() {
  const session = await requireOsSession();
  if (!session) {
    return Response.json({ employee: null }, { status: 401 });
  }

  const rows = await sql`
    select
      coalesce(ui_preferences, '{}'::jsonb) as "uiPreferences",
      exists (
        select 1
        from employee_work_stores
        where employee_work_stores.employee_id = employees.id
      )
      and (employees.staff_category = 'working' or employees.payroll_subject = 'paid') as "isTimecardEmployee"
    from employees
    where id = ${session.id}
  `;

  return Response.json({
    employee: {
      id: session.id,
      name: session.name,
      loginId: session.loginId,
      role: session.role,
      isTimecardEmployee: rows[0]?.isTimecardEmployee === true,
      uiPreferences: rows[0]?.uiPreferences ?? {}
    }
  });
}
