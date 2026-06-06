import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { getMemberAvailableCoupons, upsertMember } from "../../../../../lib/loyalty";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handoffMaxAgeMs = 10 * 60 * 1000;

function clerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

function getSecret() {
  return process.env.AUTH_SECRET || process.env.DATABASE_URL || "foundr1-local-dev-secret";
}

function firstEmail(user: Awaited<ReturnType<typeof currentUser>>) {
  const primaryId = user?.primaryEmailAddressId;
  const primary = user?.emailAddresses?.find((email) => email.id === primaryId);
  return primary?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";
}

function firstPhone(user: Awaited<ReturnType<typeof currentUser>>) {
  const primaryId = user?.primaryPhoneNumberId;
  const primary = user?.phoneNumbers?.find((phone) => phone.id === primaryId);
  return primary?.phoneNumber ?? user?.phoneNumbers?.[0]?.phoneNumber ?? "";
}

function displayName(user: Awaited<ReturnType<typeof currentUser>>) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "";
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function createHandoffToken(memberId: string) {
  const payload = base64Url(JSON.stringify({
    memberId,
    exp: Date.now() + handoffMaxAgeMs,
    nonce: randomUUID()
  }));
  return `${payload}.${signPayload(payload)}`;
}

function readHandoffToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { memberId?: string; exp?: number };
    if (!parsed.memberId || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function configuredAllowedOrigins() {
  return String(process.env.MEMBER_HANDOFF_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname === "foundr1.jp" || hostname.endsWith(".foundr1.jp")) return true;
  if (hostname.includes("nanacha") || hostname.includes("maamaa")) return true;
  if (hostname.endsWith(".vercel.app")) return true;
  return configuredAllowedOrigins().includes(url.origin);
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600"
  };
}

function isAllowedReturnTo(returnTo: string) {
  try {
    const url = new URL(returnTo);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? isAllowedOrigin(url.origin)
      : false;
  } catch {
    return false;
  }
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  if (!clerkConfigured()) {
    return Response.json({ error: "Clerk is not configured." }, { status: 503 });
  }

  const session = await auth();
  if (!session.isAuthenticated || !session.userId) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { returnTo?: string };
  const returnTo = String(body.returnTo || "").trim();
  if (!isAllowedReturnTo(returnTo)) {
    return Response.json({ error: "戻り先 URL が許可されていません。" }, { status: 400 });
  }

  const user = await currentUser();
  if (!user) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const email = firstEmail(user);
  const member = await upsertMember({
    email,
    phone: firstPhone(user),
    displayName: displayName(user),
    identityProvider: "clerk",
    identitySubject: user.id,
    identityLabel: email,
    metadata: {
      clerkUserId: user.id,
      imageUrl: user.imageUrl ?? "",
      source: "clerk_member_handoff"
    }
  });
  if (!member) return Response.json({ error: "会員を保存できませんでした。" }, { status: 500 });

  const redirectUrl = new URL(returnTo);
  redirectUrl.searchParams.set("memberHandoff", createHandoffToken(member.id));
  return Response.json({ redirectUrl: redirectUrl.toString() });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const payload = readHandoffToken(token);
  if (!payload) {
    return Response.json({ error: "会員ログイン情報の有効期限が切れました。" }, { status: 401, headers: corsHeaders(request) });
  }

  const member = await upsertMember({ memberId: payload.memberId });
  if (!member) {
    return Response.json({ error: "会員情報を読み込めませんでした。" }, { status: 404, headers: corsHeaders(request) });
  }
  const coupons = await getMemberAvailableCoupons(member.id);

  return Response.json({
    authenticated: true,
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      publicToken: member.publicToken,
      displayName: member.displayName,
      lastName: member.lastName,
      firstName: member.firstName,
      fullName: member.fullName,
      phone: member.phone,
      email: member.email,
      pointBalance: member.pointBalance
    },
    coupons
  }, { headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
}
