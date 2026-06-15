import { NextResponse } from "next/server";
import { authCookieName } from "../../../lib/auth";
import { revokeRequestEmployeeSession } from "../../../lib/employee-sessions";

export async function GET(request: Request) {
  await revokeRequestEmployeeSession(request);
  const response = NextResponse.redirect(new URL("/store/login", request.url));
  response.headers.append(
    "Set-Cookie",
    `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
