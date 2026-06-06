import { requireOsSession } from "../../../../../lib/api-auth";
import { findMember, getMemberAvailableCoupons, issueAutomaticLoyaltyRewardsForMember } from "../../../../../lib/loyalty";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeMemberCode(value: unknown) {
  const text = normalizeText(value);
  const foundr1Match = text.match(/^foundr1:member:([^:]+)(?::coupon:([^:]+))?$/i);
  if (foundr1Match?.[1]) return { code: foundr1Match[1].trim(), couponId: foundr1Match[2]?.trim() ?? "" };

  try {
    const url = new URL(text);
    return {
      code: url.searchParams.get("member")?.trim() || url.searchParams.get("memberToken")?.trim() || text,
      couponId: url.searchParams.get("coupon")?.trim() || url.searchParams.get("couponId")?.trim() || ""
    };
  } catch {
    return { code: text, couponId: "" };
  }
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const storeId = normalizeText(url.searchParams.get("storeId"));
  const { code, couponId } = normalizeMemberCode(url.searchParams.get("code"));
  if (!storeId || !code) {
    return Response.json({ error: "店舗と会員コードを入力してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const member = await findMember({ memberToken: code, email: code, phone: code });
  if (!member || member.status !== "active") {
    return Response.json({ error: "会員が見つかりません。" }, { status: 404 });
  }

  await issueAutomaticLoyaltyRewardsForMember(member.id);
  const coupons = await getMemberAvailableCoupons(member.id);
  return Response.json({ member, coupons, selectedCouponId: couponId });
}
