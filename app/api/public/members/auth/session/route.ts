import { NextResponse } from "next/server";
import {
  clearMemberSessionCookie,
  getMemberSession,
  revokeCurrentMemberSession
} from "../../../../../../lib/member-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getMemberSession();
  return NextResponse.json({
    authenticated: Boolean(session),
    user: session ? {
      memberId: session.memberId,
      email: session.email,
      displayName: session.displayName,
      expiresAt: session.expiresAt
    } : null
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  await revokeCurrentMemberSession();
  const response = NextResponse.json({ ok: true });
  clearMemberSessionCookie(response);
  return response;
}
