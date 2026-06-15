import { authCookieName } from "../../../../lib/auth";
import { revokeRequestEmployeeSession } from "../../../../lib/employee-sessions";

export async function POST(request: Request) {
  await revokeRequestEmployeeSession(request);
  const response = Response.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
