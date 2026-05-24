import { cookies } from "next/headers";
import { touchEmployeeLastSeen } from "../../../../lib/api-auth";
import { authCookieName, readSessionToken } from "../../../../lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(authCookieName)?.value);

  if (!session) {
    return Response.json({ employee: null }, { status: 401 });
  }
  await touchEmployeeLastSeen(session.id);

  return Response.json({
    employee: {
      id: session.id,
      name: session.name,
      loginId: session.loginId,
      role: session.role
    }
  });
}
