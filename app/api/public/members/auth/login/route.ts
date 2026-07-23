import { NextResponse } from "next/server";
import {
  authenticateMemberPassword,
  createMemberSession,
  memberAuthErrorResponse,
  setMemberSessionCookie
} from "../../../../../../lib/member-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const member = await authenticateMemberPassword({
      email: body.email,
      password: body.password,
      request
    });
    if (!member) return NextResponse.json({ error: "会員情報を読み込めませんでした。" }, { status: 500 });

    const session = await createMemberSession(member.id, request);
    const response = NextResponse.json({
      authenticated: true,
      user: {
        memberId: member.id,
        email: member.email,
        displayName: member.displayName,
        expiresAt: session.expiresAt
      }
    });
    setMemberSessionCookie(response, session.token);
    return response;
  } catch (error) {
    return memberAuthErrorResponse(error);
  }
}
