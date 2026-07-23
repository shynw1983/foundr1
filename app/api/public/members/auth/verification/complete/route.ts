import { NextResponse } from "next/server";
import {
  completeMemberVerification,
  createMemberSession,
  memberAuthErrorResponse,
  setMemberSessionCookie
} from "../../../../../../../lib/member-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const member = await completeMemberVerification({
      challengeId: body.challengeId,
      email: body.email,
      code: body.code,
      password: body.password,
      request
    });
    const session = await createMemberSession(member.id, request);
    const response = NextResponse.json({
      authenticated: true,
      needsProfile: !member.displayName || !member.lastName || !member.firstName || !member.phone,
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
