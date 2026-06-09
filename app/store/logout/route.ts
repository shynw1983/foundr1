import { NextResponse } from "next/server";
import { authCookieName } from "../../../lib/auth";

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/store/login", request.url));
  response.headers.append(
    "Set-Cookie",
    `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
