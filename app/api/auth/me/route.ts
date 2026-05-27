import { cookies } from "next/headers";
import { touchEmployeeLastSeen } from "../../../../lib/api-auth";
import { authCookieName, readSessionToken } from "../../../../lib/auth";
import { sql } from "../../../../lib/db";

export async function GET() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(authCookieName)?.value);

  if (!session) {
    return Response.json({ employee: null }, { status: 401 });
  }
  await touchEmployeeLastSeen(session.id);
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
