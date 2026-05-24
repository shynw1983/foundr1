import { cookies } from "next/headers";
import { authCookieName, readSessionToken, type EmployeeSession } from "./auth";

const writableRoles = new Set(["owner", "manager", "buyer", "staff"]);

export async function requireOpsSession(): Promise<EmployeeSession | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(authCookieName)?.value);
}

export async function requireWritableOpsSession() {
  const session = await requireOpsSession();
  if (!session || !writableRoles.has(session.role)) return null;

  return session;
}
