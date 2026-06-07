import { auth, currentUser } from "@clerk/nextjs/server";
import { cancelPublicMaamaaCustomerOrder, toPublicCustomerOrder } from "../../../../../../lib/customer-orders";
import { sql } from "../../../../../../lib/db";
import { upsertMember } from "../../../../../../lib/loyalty";
import { publishCustomerOrderEvent } from "../../../../../../lib/order-realtime";

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

export async function PATCH(request: Request) {
  if (!clerkConfigured()) {
    return Response.json({ error: "Clerk is not configured." }, { status: 503 });
  }

  const session = await auth();
  if (!session.isAuthenticated || !session.userId) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) return Response.json({ error: "ログインしてください。" }, { status: 401 });

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
  if (!member) return Response.json({ error: "会員を確認できませんでした。" }, { status: 500 });

  const body = await request.json().catch(() => ({})) as {
    orderId?: string | null;
    pickupCode?: string | null;
  };
  const orderId = String(body.orderId || "").trim();
  const pickupCode = String(body.pickupCode || "").trim();
  if (!orderId || !pickupCode) {
    return Response.json({ error: "注文情報が不足しています。" }, { status: 400 });
  }

  const ownerRows = await sql`
    select id::text
    from store_customer_orders
    where id::text = ${orderId}
      and pickup_code = ${pickupCode}
      and member_id::text = ${member.id}
    limit 1
  `;
  if (!ownerRows[0]?.id) {
    return Response.json({ error: "この注文を操作できません。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const result = await cancelPublicMaamaaCustomerOrder({ orderId, pickupCode });
  if (!result.order) {
    return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }
  if (result.error) {
    return Response.json(
      { error: result.error, order: toPublicCustomerOrder(result.order, url.origin) },
      { status: result.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  await publishCustomerOrderEvent("order.updated", result.order);
  return Response.json({ order: toPublicCustomerOrder(result.order, url.origin) }, { headers: { "Cache-Control": "no-store" } });
}
