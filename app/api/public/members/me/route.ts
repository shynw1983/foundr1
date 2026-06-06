import { auth, currentUser } from "@clerk/nextjs/server";
import { getMemberAvailableCoupons, getMemberPointHistory, upsertMember } from "../../../../../lib/loyalty";

export const dynamic = "force-dynamic";

function clerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

function firstEmail(user: Awaited<ReturnType<typeof currentUser>>) {
  const primaryId = user?.primaryEmailAddressId;
  const primary = user?.emailAddresses?.find((email) => email.id === primaryId);
  return primary?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";
}

function displayName(user: Awaited<ReturnType<typeof currentUser>>) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || "";
}

export async function GET() {
  if (!clerkConfigured()) {
    return Response.json({
      configured: false,
      error: "Clerk is not configured."
    }, { status: 503 });
  }

  const session = await auth();
  if (!session.isAuthenticated || !session.userId) {
    return Response.json({ configured: true, authenticated: false, member: null }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) return Response.json({ configured: true, authenticated: false, member: null }, { status: 401 });

  const member = await upsertMember({
    email: firstEmail(user),
    displayName: displayName(user),
    identityProvider: "clerk",
    identitySubject: user.id,
    identityLabel: firstEmail(user),
    metadata: {
      clerkUserId: user.id,
      imageUrl: user.imageUrl ?? "",
      source: "clerk_member_portal"
    }
  });
  if (!member) return Response.json({ error: "会員を保存できませんでした。" }, { status: 500 });

  const [coupons, pointHistory] = await Promise.all([
    getMemberAvailableCoupons(member.id),
    getMemberPointHistory(member.id)
  ]);

  return Response.json({
    configured: true,
    authenticated: true,
    member,
    coupons,
    pointHistory
  }, { headers: { "Cache-Control": "no-store" } });
}
