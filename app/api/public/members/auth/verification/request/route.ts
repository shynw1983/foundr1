import { NextResponse } from "next/server";
import {
  memberAuthErrorResponse,
  requestMemberVerification
} from "../../../../../../../lib/member-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const challenge = await requestMemberVerification({ email: body.email, request });
    return NextResponse.json(challenge);
  } catch (error) {
    return memberAuthErrorResponse(error);
  }
}
