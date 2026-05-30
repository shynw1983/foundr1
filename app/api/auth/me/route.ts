import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function GET() {
  const session = await requireOsSession();
  if (!session) {
    return Response.json({ employee: null }, { status: 401 });
  }

  const rows = await sql`
    select coalesce(ui_preferences, '{}'::jsonb) as "uiPreferences"
    from employees
    where id = ${session.id}
  `;

  return Response.json({
    employee: {
      id: session.id,
      name: session.name,
      loginId: session.loginId,
      role: session.role,
      uiPreferences: rows[0]?.uiPreferences ?? {}
    }
  });
}
