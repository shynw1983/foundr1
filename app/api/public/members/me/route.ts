import { auth, currentUser } from "@clerk/nextjs/server";
import { resolveCustomerStoreDisplayName } from "../../../../../lib/customer-display-names";
import { sql } from "../../../../../lib/db";
import { getMemberAvailableCoupons, getMemberOnlineOrderHistory, getMemberPointHistory, getMemberStampCards, issueAutomaticLoyaltyRewardsForMember, updateMemberSettings, upsertMember } from "../../../../../lib/loyalty";

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

async function getPreferredStoreOptions() {
  const rows = await sql`
    select
      id::text,
      coalesce(external_id, '') as "externalId",
      name,
      coalesce(customer_display_names, '{}'::jsonb) as "customerDisplayNames"
    from stores
    where status = 'active'
    order by name
  `;

  return rows.map((row) => ({
    value: String(row.externalId || row.id),
    label: resolveCustomerStoreDisplayName({
      settings: row.customerDisplayNames,
      internalStoreName: String(row.name ?? ""),
      platform: "web_reservation"
    })
  }));
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
  await issueAutomaticLoyaltyRewardsForMember(member.id);

  const [coupons, pointHistory, stampCards, orders, preferredStoreOptions] = await Promise.all([
    getMemberAvailableCoupons(member.id),
    getMemberPointHistory(member.id),
    getMemberStampCards(member.id),
    getMemberOnlineOrderHistory(member.id),
    getPreferredStoreOptions()
  ]);

  return Response.json({
    configured: true,
    authenticated: true,
    member,
    coupons,
    pointHistory,
    stampCards,
    orders,
    preferredStoreOptions
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
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

  const existing = await upsertMember({
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
  if (!existing) return Response.json({ error: "会員を保存できませんでした。" }, { status: 500 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const profileDisplayName = String(body.displayName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const firstName = String(body.firstName || "").trim();
  const fullName = [lastName, firstName].filter(Boolean).join(" ").trim();
  const phone = String(body.phone || "").trim();
  if (!profileDisplayName) {
    return Response.json({ error: "表示名・ニックネームを入力してください。" }, { status: 400 });
  }
  if (!lastName) {
    return Response.json({ error: "姓を入力してください。" }, { status: 400 });
  }
  if (!firstName) {
    return Response.json({ error: "名を入力してください。" }, { status: 400 });
  }
  if (!phone) {
    return Response.json({ error: "電話番号を入力してください。" }, { status: 400 });
  }
  const birthday = String(body.birthday || "").trim();
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return Response.json({ error: "生年月日を正しく入力してください。" }, { status: 400 });
  }

  try {
    const member = await updateMemberSettings(existing.id, {
      displayName: profileDisplayName,
      lastName,
      firstName,
      fullName,
      nameKana: String(body.nameKana || ""),
      phone,
      birthday,
      preferredLanguage: String(body.preferredLanguage || "ja"),
      preferredStoreId: String(body.preferredStoreId || ""),
      marketingOptIn: Boolean(body.marketingOptIn),
      lineLinked: Boolean(body.lineLinked)
    });
    if (member?.id) await issueAutomaticLoyaltyRewardsForMember(member.id);
    const preferredStoreOptions = await getPreferredStoreOptions();
    return Response.json({ configured: true, authenticated: true, member, preferredStoreOptions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("duplicate key")
      ? "この電話番号はすでに別の会員で使われています。"
      : "会員情報を保存できませんでした。";
    return Response.json({ error: message }, { status: 500 });
  }
}
