import { sql } from "./db";

const basePointRateBasis = 100;
const pointExpiryMonths = 12;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  return normalizeText(value).replace(/[^\d+]/g, "");
}

function formatJapanesePhone(value: unknown) {
  const phone = normalizePhone(value);
  if (/^0[789]0\d{8}$/.test(phone)) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  if (/^0120\d{6}$/.test(phone) || /^0800\d{7}$/.test(phone)) return `${phone.slice(0, 4)}-${phone.slice(4, 7)}-${phone.slice(7)}`;
  if (/^0\d{9}$/.test(phone)) return `${phone.slice(0, 2)}-${phone.slice(2, 6)}-${phone.slice(6)}`;
  if (/^0\d{8}$/.test(phone)) return `${phone.slice(0, 2)}-${phone.slice(2, 5)}-${phone.slice(5)}`;
  return phone;
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export type LoyaltyMemberInput = {
  memberId?: string | null;
  memberToken?: string | null;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
  allowDisplayNameUpdate?: boolean;
  identityProvider?: string | null;
  identitySubject?: string | null;
  identityLabel?: string | null;
  metadata?: Record<string, unknown>;
};

export type LoyaltyMember = {
  id: string;
  memberNumber: string;
  publicToken: string;
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  phone: string;
  email: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
  status: string;
  pointBalance: number;
  lifetimeSpendAmount: number;
  lifetimeVisitCount: number;
  currentTierKey: string;
};

export async function findMember(input: LoyaltyMemberInput) {
  const memberId = normalizeText(input.memberId);
  const memberToken = normalizeText(input.memberToken);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const identityProvider = normalizeText(input.identityProvider);
  const identitySubject = normalizeText(input.identitySubject);

  if (memberId) {
    const rows = await sql`
      select id::text
      from members
      where id::text = ${memberId}
      limit 1
    `;
    if (rows[0]?.id) return getMemberProfile(rows[0].id as string);
  }

  if (memberToken) {
    const rows = await sql`
      select id::text
      from members
      where public_token = ${memberToken}
        or member_number = ${memberToken}
      limit 1
    `;
    if (rows[0]?.id) return getMemberProfile(rows[0].id as string);
  }

  if (phone) {
    const rows = await sql`
      select id::text
      from members
      where phone = ${phone}
      limit 1
    `;
    if (rows[0]?.id) return getMemberProfile(rows[0].id as string);
  }

  if (email) {
    const rows = await sql`
      select id::text
      from members
      where lower(email) = ${email}
      limit 1
    `;
    if (rows[0]?.id) return getMemberProfile(rows[0].id as string);
  }

  if (identityProvider && identitySubject) {
    const rows = await sql`
      select member_id::text as id
      from member_identity_links
      where identity_provider = ${identityProvider}
        and identity_subject = ${identitySubject}
      limit 1
    `;
    if (rows[0]?.id) return getMemberProfile(rows[0].id as string);
  }

  return null;
}

export async function upsertMember(input: LoyaltyMemberInput) {
  const existing = await findMember(input);
  if (existing) {
    await updateMember(existing.id, input);
    return getMemberProfile(existing.id);
  }

  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const rows = await sql`
    insert into members (
      display_name,
      phone,
      email,
      metadata,
      updated_at
    )
    values (
      ${normalizeText(input.displayName)},
      ${phone},
      ${email},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      now()
    )
    returning id::text
  `;
  const memberId = rows[0]?.id as string | undefined;
  if (!memberId) return null;

  await sql`
    insert into member_accounts (member_id)
    values (${memberId})
    on conflict (member_id) do nothing
  `;
  await upsertIdentityLink(memberId, input);
  await issueSignupCoupon(memberId);
  return getMemberProfile(memberId);
}

export async function updateMember(memberId: string, input: LoyaltyMemberInput) {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const displayName = normalizeText(input.displayName);
  const allowDisplayNameUpdate = Boolean(input.allowDisplayNameUpdate);
  await sql`
    update members
    set
      display_name = case
        when ${displayName} = '' then display_name
        when ${allowDisplayNameUpdate} then ${displayName}
        when coalesce(display_name, '') = '' then ${displayName}
        else display_name
      end,
      phone = case when ${phone} <> '' then ${phone} else phone end,
      email = case when ${email} <> '' then ${email} else email end,
      metadata = metadata || ${JSON.stringify(input.metadata ?? {})}::jsonb,
      updated_at = now()
    where id::text = ${memberId}
  `;
  await sql`
    insert into member_accounts (member_id)
    values (${memberId})
    on conflict (member_id) do nothing
  `;
  await upsertIdentityLink(memberId, input);
}

async function upsertIdentityLink(memberId: string, input: LoyaltyMemberInput) {
  const identityProvider = normalizeText(input.identityProvider);
  const identitySubject = normalizeText(input.identitySubject);
  if (!identityProvider || !identitySubject) return;

  await sql`
    insert into member_identity_links (
      member_id,
      identity_provider,
      identity_subject,
      identity_label,
      metadata,
      updated_at
    )
    values (
      ${memberId},
      ${identityProvider},
      ${identitySubject},
      ${normalizeText(input.identityLabel)},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      now()
    )
    on conflict (identity_provider, identity_subject)
    do update set
      member_id = excluded.member_id,
      identity_label = excluded.identity_label,
      metadata = member_identity_links.metadata || excluded.metadata,
      updated_at = now()
  `;
}

async function issueSignupCoupon(memberId: string) {
  const existingRows = await sql`
    select id::text
    from member_coupons
    where member_id::text = ${memberId}
      and issued_source = 'signup_bonus'
      and metadata ->> 'rewardType' = 'signup_500_yen'
    limit 1
  `;
  if (existingRows[0]?.id) return;

  await sql`
    insert into member_coupons (
      member_id,
      name,
      discount_type,
      discount_value,
      max_discount_amount,
      expires_at,
      issued_source,
      metadata
    )
    values (
      ${memberId},
      '会員登録特典 500円OFF',
      'amount',
      500,
      500,
      now() + interval '60 days',
      'signup_bonus',
      '{"rewardType":"signup_500_yen"}'::jsonb
    )
  `;
}

export async function getMemberProfile(memberId: string) {
  const rows = await sql`
    select
      members.id::text,
      members.member_number as "memberNumber",
      members.public_token as "publicToken",
      members.display_name as "displayName",
      coalesce(members.metadata->>'lastName', '') as "lastName",
      coalesce(members.metadata->>'firstName', '') as "firstName",
      coalesce(members.metadata->>'fullName', '') as "fullName",
      members.name_kana as "nameKana",
      members.phone,
      members.email,
      coalesce(members.birthday::text, '') as "birthday",
      members.preferred_language as "preferredLanguage",
      coalesce(members.metadata->>'preferredStoreId', '') as "preferredStoreId",
      coalesce((members.metadata->>'marketingOptIn')::boolean, false) as "marketingOptIn",
      coalesce((members.metadata->>'lineLinked')::boolean, false) as "lineLinked",
      members.status,
      coalesce(member_accounts.point_balance, 0)::int as "pointBalance",
      coalesce(member_accounts.lifetime_spend_amount, 0)::int as "lifetimeSpendAmount",
      coalesce(member_accounts.lifetime_visit_count, 0)::int as "lifetimeVisitCount",
      coalesce(member_accounts.current_tier_key, 'regular') as "currentTierKey"
    from members
    left join member_accounts on member_accounts.member_id = members.id
    where members.id::text = ${memberId}
    limit 1
  `;
  const member = rows[0] as LoyaltyMember | undefined;
  if (!member) return null;
  return {
    ...member,
    phone: formatJapanesePhone(member.phone)
  };
}

export type LoyaltyMemberSettingsInput = {
  displayName?: string;
  lastName?: string;
  firstName?: string;
  fullName?: string;
  nameKana?: string;
  phone?: string;
  birthday?: string;
  preferredLanguage?: string;
  preferredStoreId?: string;
  marketingOptIn?: boolean;
  lineLinked?: boolean;
};

export async function updateMemberSettings(memberId: string, input: LoyaltyMemberSettingsInput) {
  const displayName = normalizeText(input.displayName).slice(0, 80);
  const lastName = normalizeText(input.lastName).slice(0, 40);
  const firstName = normalizeText(input.firstName).slice(0, 40);
  const fullName = normalizeText(input.fullName || [lastName, firstName].filter(Boolean).join(" ")).slice(0, 80);
  const nameKana = normalizeText(input.nameKana).slice(0, 80);
  const phone = normalizePhone(input.phone).slice(0, 30);
  const birthday = normalizeText(input.birthday);
  const normalizedBirthday = /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : "";
  const preferredLanguage = ["ja", "zh", "zh-Hant", "en", "ko"].includes(normalizeText(input.preferredLanguage))
    ? normalizeText(input.preferredLanguage)
    : "ja";
  const preferredStoreId = normalizeText(input.preferredStoreId).slice(0, 80);
  const marketingOptIn = Boolean(input.marketingOptIn);
  const lineLinked = Boolean(input.lineLinked);
  const metadata = {
    lastName,
    firstName,
    fullName,
    preferredStoreId,
    marketingOptIn,
    lineLinked
  };

  await sql`
    update members
    set
      display_name = ${displayName},
      name_kana = ${nameKana},
      phone = ${phone},
      birthday = nullif(${normalizedBirthday}, '')::date,
      preferred_language = ${preferredLanguage},
      metadata = metadata || ${JSON.stringify(metadata)}::jsonb,
      updated_at = now()
    where id::text = ${memberId}
  `;

  return getMemberProfile(memberId);
}

export async function resolveMemberForOrder(input: LoyaltyMemberInput) {
  if (!input.memberId && !input.memberToken && !input.phone && !input.email && !input.identitySubject) return null;
  return upsertMember(input);
}

export async function getMemberAvailableCoupons(memberId: string) {
  return sql`
    select
      member_coupons.id::text,
      coalesce(member_coupons.brand_id::text, '') as "brandId",
      coalesce(brands.name, '') as "brandName",
      member_coupons.coupon_code as "couponCode",
      member_coupons.name,
      member_coupons.discount_type as "discountType",
      member_coupons.discount_value::int as "discountValue",
      coalesce(member_coupons.max_discount_amount::int, null) as "maxDiscountAmount",
      member_coupons.status,
      coalesce(member_coupons.expires_at::text, '') as "expiresAt",
      member_coupons.issued_source as "issuedSource",
      member_coupons.issued_at::text as "issuedAt"
    from member_coupons
    left join brands on brands.id = member_coupons.brand_id
    where member_coupons.member_id::text = ${memberId}
      and member_coupons.status = 'available'
      and (member_coupons.expires_at is null or member_coupons.expires_at > now())
    order by member_coupons.expires_at nulls last, member_coupons.issued_at desc
    limit 50
  `;
}

export async function getMemberStampCards(memberId: string) {
  return sql`
    with stamp_totals as (
      select
        campaign_id,
        coalesce(sum(stamps), 0)::int as total_stamps,
        max(created_at)::text as last_stamped_at
      from loyalty_stamp_ledger
      where member_id::text = ${memberId}
      group by campaign_id
    ),
    reward_totals as (
      select
        metadata ->> 'stampCampaignId' as campaign_id,
        count(*) filter (where status = 'available' and (expires_at is null or expires_at > now()))::int as available_rewards,
        count(*)::int as issued_rewards
      from member_coupons
      where member_id::text = ${memberId}
        and metadata ? 'stampCampaignId'
      group by metadata ->> 'stampCampaignId'
    )
    select
      loyalty_stamp_campaigns.id::text,
      loyalty_stamp_campaigns.campaign_key as "campaignKey",
      loyalty_stamp_campaigns.name,
      coalesce(brands.name, '') as "brandName",
      coalesce(loyalty_stamp_campaigns.stamps_required, 5)::int as "stampsRequired",
      loyalty_stamp_campaigns.reward_coupon_name as "rewardCouponName",
      coalesce(loyalty_stamp_campaigns.reward_value_amount, 0)::int as "rewardValueAmount",
      coalesce(stamp_totals.total_stamps, 0)::int as "totalStamps",
      mod(coalesce(stamp_totals.total_stamps, 0), greatest(1, loyalty_stamp_campaigns.stamps_required))::int as "currentStamps",
      coalesce(reward_totals.available_rewards, 0)::int as "availableRewards",
      coalesce(reward_totals.issued_rewards, 0)::int as "issuedRewards",
      coalesce(stamp_totals.last_stamped_at, '') as "lastStampedAt",
      coalesce(loyalty_stamp_campaigns.valid_until::text, '') as "validUntil"
    from loyalty_stamp_campaigns
    left join brands on brands.id = loyalty_stamp_campaigns.brand_id
    left join stamp_totals on stamp_totals.campaign_id = loyalty_stamp_campaigns.id
    left join reward_totals on reward_totals.campaign_id = loyalty_stamp_campaigns.id::text
    where loyalty_stamp_campaigns.is_active = true
      and (loyalty_stamp_campaigns.valid_from is null or loyalty_stamp_campaigns.valid_from <= current_date)
      and (loyalty_stamp_campaigns.valid_until is null or loyalty_stamp_campaigns.valid_until >= current_date)
    order by
      case when coalesce(stamp_totals.total_stamps, 0) > 0 then 0 else 1 end,
      loyalty_stamp_campaigns.created_at desc
    limit 20
  `;
}

export function calculateCouponDiscount(coupon: { discountType?: string; discountValue?: number; maxDiscountAmount?: number | null }, subtotal: number) {
  const baseAmount = Math.max(0, Math.round(Number(subtotal) || 0));
  const value = Math.max(0, Math.round(Number(coupon.discountValue) || 0));
  const maxAmount = coupon.maxDiscountAmount == null ? null : Math.max(0, Math.round(Number(coupon.maxDiscountAmount) || 0));
  const rawDiscount = coupon.discountType === "percent" ? Math.floor(baseAmount * value / 100) : value;
  return Math.min(baseAmount, maxAmount == null ? rawDiscount : Math.min(rawDiscount, maxAmount));
}

export async function getUsableMemberCoupon(memberId: string, couponId: string) {
  const rows = await sql`
    select
      member_coupons.id::text,
      member_coupons.member_id::text as "memberId",
      coalesce(member_coupons.brand_id::text, '') as "brandId",
      coalesce(brands.name, '') as "brandName",
      member_coupons.coupon_code as "couponCode",
      member_coupons.name,
      member_coupons.discount_type as "discountType",
      member_coupons.discount_value::int as "discountValue",
      coalesce(member_coupons.max_discount_amount::int, null) as "maxDiscountAmount",
      member_coupons.status,
      coalesce(member_coupons.expires_at::text, '') as "expiresAt"
    from member_coupons
    left join brands on brands.id = member_coupons.brand_id
    where member_coupons.id::text = ${couponId}
      and member_coupons.member_id::text = ${memberId}
      and member_coupons.status = 'available'
      and (member_coupons.expires_at is null or member_coupons.expires_at > now())
    limit 1
  `;
  return rows[0] ?? null;
}

export async function redeemMemberCouponForOrder(input: { memberId: string; couponId: string; orderId: string; storeId: string }) {
  const rows = await sql`
    update member_coupons
    set
      status = 'used',
      used_order_id = ${input.orderId},
      used_store_id = ${input.storeId},
      used_at = now()
    where id::text = ${input.couponId}
      and member_id::text = ${input.memberId}
      and status = 'available'
      and (expires_at is null or expires_at > now())
    returning id::text
  `;
  return rows[0] ?? null;
}

export async function redeemPendingCouponForPaidOrder(orderId: string) {
  const rows = await sql`
    select
      coalesce(member_id::text, '') as "memberId",
      coalesce(store_id::text, '') as "storeId",
      coalesce(customer_summary ->> 'couponId', '') as "couponId"
    from store_customer_orders
    where id::text = ${orderId}
      and payment_status = 'paid'
    limit 1
  `;
  const order = rows[0] as { memberId?: string; storeId?: string; couponId?: string } | undefined;
  if (!order?.memberId || !order.storeId || !order.couponId) return null;
  return redeemMemberCouponForOrder({ memberId: order.memberId, storeId: order.storeId, couponId: order.couponId, orderId });
}

export async function issueMemberCoupon(input: {
  memberId: string;
  name: string;
  discountType?: string;
  discountValue: number;
  maxDiscountAmount?: number | null;
  expiresAt?: string | null;
  source?: string;
  note?: string;
  issuedBy?: string;
}) {
  const memberId = normalizeText(input.memberId);
  const name = normalizeText(input.name) || "クーポン";
  const discountType = normalizeText(input.discountType) || "amount";
  const discountValue = Math.max(0, Math.round(Number(input.discountValue) || 0));
  const maxDiscountAmount = input.maxDiscountAmount == null ? discountValue : Math.max(0, Math.round(Number(input.maxDiscountAmount) || 0));
  const expiresAt = normalizeText(input.expiresAt);
  const source = normalizeText(input.source) || "manual";
  if (!memberId || discountValue <= 0) throw new Error("会員と割引金額を指定してください。");

  const rows = await sql`
    insert into member_coupons (
      member_id,
      name,
      discount_type,
      discount_value,
      max_discount_amount,
      expires_at,
      issued_source,
      metadata
    )
    values (
      ${memberId},
      ${name},
      ${discountType},
      ${discountValue},
      ${maxDiscountAmount},
      nullif(${expiresAt}, '')::timestamptz,
      ${source},
      ${JSON.stringify({ note: normalizeText(input.note), issuedBy: normalizeText(input.issuedBy) })}::jsonb
    )
    returning id::text
  `;
  return rows[0] ?? null;
}

async function issueMissingStampRewards(input: {
  memberId: string;
  campaignId: string;
  brandId: string;
  stampsRequired: number;
  rewardCouponName: string;
  rewardValueAmount: number;
}) {
  const totalRows = await sql`
    select coalesce(sum(stamps), 0)::int as total
    from loyalty_stamp_ledger
    where campaign_id::text = ${input.campaignId}
      and member_id::text = ${input.memberId}
  `;
  const rewardCount = Math.floor(Number(totalRows[0]?.total ?? 0) / Math.max(1, input.stampsRequired));
  const existingRewards = await sql`
    select count(*)::int as count
    from member_coupons
    where member_id::text = ${input.memberId}
      and metadata ->> 'stampCampaignId' = ${input.campaignId}
  `;
  const missingRewards = rewardCount - Number(existingRewards[0]?.count ?? 0);
  for (let index = 0; index < missingRewards; index += 1) {
    await sql`
      insert into member_coupons (
        member_id,
        brand_id,
        name,
        discount_type,
        discount_value,
        max_discount_amount,
        expires_at,
        issued_source,
        metadata
      )
      values (
        ${input.memberId},
        nullif(${input.brandId}, '')::uuid,
        ${input.rewardCouponName || "ドリンク無料券"},
        'amount',
        ${input.rewardValueAmount || 600},
        ${input.rewardValueAmount || 600},
        now() + interval '60 days',
        'stamp_campaign',
        ${JSON.stringify({ stampCampaignId: input.campaignId })}::jsonb
      )
    `;
  }
  return Math.max(0, missingRewards);
}

export async function adjustMemberStamps(input: {
  memberId: string;
  campaignId: string;
  stamps: number;
  note?: string;
  adjustedBy?: string;
}) {
  const memberId = normalizeText(input.memberId);
  const campaignId = normalizeText(input.campaignId);
  const stamps = Math.max(0, Math.min(100, Math.round(Number(input.stamps) || 0)));
  const note = normalizeText(input.note).slice(0, 240);
  if (!memberId || !campaignId || stamps <= 0) throw new Error("会員、スタンプカード、杯数を指定してください。");

  const campaignRows = await sql`
    select
      id::text,
      coalesce(brand_id::text, '') as "brandId",
      stamps_required as "stampsRequired",
      reward_coupon_name as "rewardCouponName",
      reward_value_amount as "rewardValueAmount"
    from loyalty_stamp_campaigns
    where id::text = ${campaignId}
      and is_active = true
      and (valid_from is null or valid_from <= current_date)
      and (valid_until is null or valid_until >= current_date)
    limit 1
  `;
  const campaign = campaignRows[0] as {
    id: string;
    brandId: string;
    stampsRequired: number;
    rewardCouponName: string;
    rewardValueAmount: number;
  } | undefined;
  if (!campaign?.id) throw new Error("利用できるスタンプカードが見つかりません。");

  const memberRows = await sql`
    select id::text
    from members
    where id::text = ${memberId}
      and status = 'active'
    limit 1
  `;
  if (!memberRows[0]?.id) throw new Error("会員が見つかりません。");

  const ledgerRows = await sql`
    insert into loyalty_stamp_ledger (
      campaign_id,
      member_id,
      brand_id,
      stamps,
      note
    )
    values (
      ${campaign.id},
      ${memberId},
      nullif(${campaign.brandId}, '')::uuid,
      ${stamps},
      ${[
        "紙レシート確認による初期スタンプ補録",
        "レシート下部の5杯で1杯無料部分を切り取り確認済み",
        note,
        input.adjustedBy ? `担当:${input.adjustedBy}` : ""
      ].filter(Boolean).join(" / ")}
    )
    returning id::text
  `;

  const issuedRewards = await issueMissingStampRewards({
    memberId,
    campaignId: campaign.id,
    brandId: campaign.brandId,
    stampsRequired: campaign.stampsRequired,
    rewardCouponName: campaign.rewardCouponName,
    rewardValueAmount: campaign.rewardValueAmount
  });

  return { ledger: ledgerRows[0] ?? null, issuedRewards };
}

export async function getMemberPointHistory(memberId: string) {
  return sql`
    select
      loyalty_point_ledger.id::text,
      coalesce(brands.name, '') as "brandName",
      coalesce(stores.name, '') as "storeName",
      loyalty_point_ledger.movement_type as "movementType",
      loyalty_point_ledger.points::int,
      loyalty_point_ledger.eligible_amount::int as "eligibleAmount",
      loyalty_point_ledger.note,
      loyalty_point_ledger.created_at::text as "createdAt"
    from loyalty_point_ledger
    left join brands on brands.id = loyalty_point_ledger.brand_id
    left join stores on stores.id = loyalty_point_ledger.store_id
    where loyalty_point_ledger.member_id::text = ${memberId}
    order by loyalty_point_ledger.created_at desc
    limit 30
  `;
}

export async function awardLoyaltyForPaidOrder(orderId: string) {
  const orderRows = await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.member_id::text, '') as "memberId",
      coalesce(store_customer_orders.brand_id::text, '') as "brandId",
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.company_id::text, '') as "companyId",
      store_customer_orders.amount::int,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.status,
      store_customer_orders.created_at
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    where store_customer_orders.id::text = ${orderId}
    limit 1
  `;
  const order = orderRows[0] as {
    id: string;
    memberId: string;
    brandId: string;
    storeId: string;
    companyId: string;
    amount: number;
    paymentStatus: string;
    status: string;
  } | undefined;
  if (!order?.memberId || order.amount <= 0 || order.paymentStatus !== "paid" || order.status === "cancelled") return null;

  await sql`
    insert into member_accounts (member_id)
    values (${order.memberId})
    on conflict (member_id) do nothing
  `;
  if (order.brandId) {
    await sql`
      insert into member_brand_links (member_id, brand_id, first_store_id, last_seen_at)
      values (${order.memberId}, ${order.brandId}, nullif(${order.storeId}, '')::uuid, now())
      on conflict (member_id, brand_id)
      do update set
        last_seen_at = now(),
        status = 'active'
    `;
  }

  const earnedPoints = Math.floor(order.amount / basePointRateBasis);
  if (earnedPoints > 0) {
    const ledgerRows = await sql`
      insert into loyalty_point_ledger (
        member_id,
        order_id,
        brand_id,
        store_id,
        company_id,
        movement_type,
        points,
        eligible_amount,
        point_rate_basis,
        source,
        note,
        expires_at
      )
      values (
        ${order.memberId},
        ${order.id},
        nullif(${order.brandId}, '')::uuid,
        nullif(${order.storeId}, '')::uuid,
        nullif(${order.companyId}, '')::uuid,
        'earn',
        ${earnedPoints},
        ${order.amount},
        ${basePointRateBasis},
        'order',
        '会計によるポイント付与',
        now() + (${pointExpiryMonths} || ' months')::interval
      )
      on conflict do nothing
      returning id::text
    `;
    if (ledgerRows[0]?.id) {
      await sql`
        update member_accounts
        set
          point_balance = point_balance + ${earnedPoints},
          lifetime_points_earned = lifetime_points_earned + ${earnedPoints},
          lifetime_spend_amount = lifetime_spend_amount + ${order.amount},
          lifetime_visit_count = lifetime_visit_count + 1,
          last_purchase_at = now(),
          updated_at = now()
        where member_id::text = ${order.memberId}
      `;
      await createPointSettlementEntry(ledgerRows[0].id as string, order, earnedPoints);
    }
  }

  await awardStampForOrder(order);
  await refreshMemberTier(order.memberId);
  return getMemberProfile(order.memberId);
}

async function createPointSettlementEntry(
  ledgerId: string,
  order: { id: string; memberId: string; storeId: string; companyId: string },
  earnedPoints: number
) {
  await sql`
    insert into loyalty_settlement_entries (
      ledger_id,
      member_id,
      order_id,
      issuing_store_id,
      issuing_company_id,
      settlement_type,
      points,
      amount
    )
    values (
      ${ledgerId},
      ${order.memberId},
      ${order.id},
      nullif(${order.storeId}, '')::uuid,
      nullif(${order.companyId}, '')::uuid,
      'point_issued',
      ${earnedPoints},
      ${earnedPoints}
    )
  `;
}

async function awardStampForOrder(order: { id: string; memberId: string; brandId: string; storeId: string }) {
  if (!order.brandId) return;
  const campaignRows = await sql`
    select id::text, stamps_required as "stampsRequired", reward_coupon_name as "rewardCouponName", reward_value_amount as "rewardValueAmount"
    from loyalty_stamp_campaigns
    where brand_id::text = ${order.brandId}
      and is_active = true
      and (valid_from is null or valid_from <= current_date)
      and (valid_until is null or valid_until >= current_date)
    order by created_at
  `;
  for (const campaign of campaignRows as Array<{ id: string; stampsRequired: number; rewardCouponName: string; rewardValueAmount: number }>) {
    const itemRows = await sql`
      select coalesce(sum(quantity), 0)::int as quantity
      from store_customer_order_items
      where order_id::text = ${order.id}
    `;
    const stamps = Number(itemRows[0]?.quantity ?? 0);
    if (stamps <= 0) continue;
    const stampRows = await sql`
      insert into loyalty_stamp_ledger (
        campaign_id,
        member_id,
        order_id,
        brand_id,
        store_id,
        stamps,
        note
      )
      values (
        ${campaign.id},
        ${order.memberId},
        ${order.id},
        ${order.brandId},
        nullif(${order.storeId}, '')::uuid,
        ${stamps},
        '会計によるスタンプ付与'
      )
      on conflict do nothing
      returning id::text
    `;
    if (!stampRows[0]?.id) continue;

    await issueMissingStampRewards({
      memberId: order.memberId,
      campaignId: campaign.id,
      brandId: order.brandId,
      stampsRequired: campaign.stampsRequired,
      rewardCouponName: campaign.rewardCouponName,
      rewardValueAmount: campaign.rewardValueAmount
    });
  }
}

export async function reverseLoyaltyForRefundedOrder(orderId: string, note = "返金によるポイント取消") {
  const earnRows = await sql`
    select
      loyalty_point_ledger.member_id::text as "memberId",
      loyalty_point_ledger.order_id::text as "orderId",
      coalesce(loyalty_point_ledger.brand_id::text, '') as "brandId",
      coalesce(loyalty_point_ledger.store_id::text, '') as "storeId",
      coalesce(loyalty_point_ledger.company_id::text, '') as "companyId",
      loyalty_point_ledger.points::int,
      loyalty_point_ledger.eligible_amount::int as "eligibleAmount"
    from loyalty_point_ledger
    where order_id::text = ${orderId}
      and movement_type = 'earn'
    limit 1
  `;
  const earn = earnRows[0] as {
    memberId: string;
    orderId: string;
    brandId: string;
    storeId: string;
    companyId: string;
    points: number;
    eligibleAmount: number;
  } | undefined;
  if (!earn?.memberId || earn.points <= 0) return null;

  const reverseRows = await sql`
    insert into loyalty_point_ledger (
      member_id,
      order_id,
      brand_id,
      store_id,
      company_id,
      movement_type,
      points,
      eligible_amount,
      point_rate_basis,
      source,
      note
    )
    values (
      ${earn.memberId},
      ${earn.orderId},
      nullif(${earn.brandId}, '')::uuid,
      nullif(${earn.storeId}, '')::uuid,
      nullif(${earn.companyId}, '')::uuid,
      'refund_reversal',
      ${-earn.points},
      ${earn.eligibleAmount},
      ${basePointRateBasis},
      'refund',
      ${note}
    )
    on conflict do nothing
    returning id::text
  `;
  if (reverseRows[0]?.id) {
    await sql`
      update member_accounts
      set
        point_balance = greatest(0, point_balance - ${earn.points}),
        updated_at = now()
      where member_id::text = ${earn.memberId}
    `;
  }
  return getMemberProfile(earn.memberId);
}

export async function refreshMemberTier(memberId: string) {
  const rows = await sql`
    with member_recent as (
      select
        coalesce(sum(eligible_amount), 0)::int as spend,
        count(distinct order_id)::int as visits
      from loyalty_point_ledger
      where member_id::text = ${memberId}
        and movement_type = 'earn'
        and created_at >= now() - interval '180 days'
    )
    select tier_key
    from loyalty_tiers, member_recent
    where is_active = true
      and member_recent.spend >= required_spend_amount
      and member_recent.visits >= required_visit_count
    order by rank desc
    limit 1
  `;
  const tierKey = String(rows[0]?.tier_key ?? "regular");
  await sql`
    update member_accounts
    set current_tier_key = ${tierKey}, updated_at = now()
    where member_id::text = ${memberId}
  `;
  return tierKey;
}

export async function getLoyaltyDashboard() {
  const [summaryRows, recentMembers, recentLedger, coupons, recentCoupons, stampCampaigns] = await Promise.all([
    sql`
      select
        count(*)::int as "memberCount",
        coalesce(sum(member_accounts.point_balance), 0)::int as "pointLiability",
        coalesce(sum(member_accounts.lifetime_spend_amount), 0)::int as "lifetimeSpend",
        coalesce(sum(member_accounts.lifetime_visit_count), 0)::int as "lifetimeVisits"
      from members
      left join member_accounts on member_accounts.member_id = members.id
      where members.status = 'active'
    `,
    sql`
      select
        members.id::text,
        members.member_number as "memberNumber",
        members.display_name as "displayName",
        members.phone,
        members.email,
        coalesce(member_accounts.point_balance, 0)::int as "pointBalance",
        coalesce(member_accounts.lifetime_spend_amount, 0)::int as "lifetimeSpendAmount",
        coalesce(member_accounts.lifetime_visit_count, 0)::int as "lifetimeVisitCount",
        coalesce(member_accounts.current_tier_key, 'regular') as "currentTierKey",
        coalesce(member_accounts.last_purchase_at::text, '') as "lastPurchaseAt",
        members.created_at::text as "createdAt"
      from members
      left join member_accounts on member_accounts.member_id = members.id
      order by members.created_at desc
      limit 50
    `,
    sql`
      select
        loyalty_point_ledger.id::text,
        members.member_number as "memberNumber",
        coalesce(nullif(members.display_name, ''), members.phone, members.email, members.member_number) as "memberLabel",
        coalesce(brands.name, '') as "brandName",
        coalesce(stores.name, '') as "storeName",
        loyalty_point_ledger.movement_type as "movementType",
        loyalty_point_ledger.points::int,
        loyalty_point_ledger.eligible_amount::int as "eligibleAmount",
        loyalty_point_ledger.created_at::text as "createdAt"
      from loyalty_point_ledger
      join members on members.id = loyalty_point_ledger.member_id
      left join brands on brands.id = loyalty_point_ledger.brand_id
      left join stores on stores.id = loyalty_point_ledger.store_id
      order by loyalty_point_ledger.created_at desc
      limit 80
    `,
    sql`
      select
        count(*) filter (where status = 'available')::int as "availableCoupons",
        count(*) filter (where status = 'used')::int as "usedCoupons"
      from member_coupons
    `,
    sql`
      select
        member_coupons.id::text,
        member_coupons.coupon_code as "couponCode",
        member_coupons.name,
        member_coupons.discount_type as "discountType",
        member_coupons.discount_value::int as "discountValue",
        coalesce(brands.name, '') as "brandName",
        member_coupons.status,
        coalesce(member_coupons.expires_at::text, '') as "expiresAt",
        member_coupons.issued_source as "issuedSource",
        member_coupons.issued_at::text as "issuedAt",
        members.member_number as "memberNumber",
        coalesce(nullif(members.display_name, ''), members.phone, members.email, members.member_number) as "memberLabel"
      from member_coupons
      join members on members.id = member_coupons.member_id
      left join brands on brands.id = member_coupons.brand_id
      order by member_coupons.issued_at desc
      limit 50
    `,
    sql`
      select
        loyalty_stamp_campaigns.id::text,
        loyalty_stamp_campaigns.campaign_key as "campaignKey",
        loyalty_stamp_campaigns.name,
        coalesce(brands.name, '') as "brandName",
        loyalty_stamp_campaigns.stamps_required::int as "stampsRequired",
        loyalty_stamp_campaigns.reward_coupon_name as "rewardCouponName",
        loyalty_stamp_campaigns.reward_value_amount::int as "rewardValueAmount"
      from loyalty_stamp_campaigns
      left join brands on brands.id = loyalty_stamp_campaigns.brand_id
      where loyalty_stamp_campaigns.is_active = true
        and (loyalty_stamp_campaigns.valid_from is null or loyalty_stamp_campaigns.valid_from <= current_date)
        and (loyalty_stamp_campaigns.valid_until is null or loyalty_stamp_campaigns.valid_until >= current_date)
      order by brands.name nulls last, loyalty_stamp_campaigns.created_at desc
    `
  ]);

  return {
    summary: {
      ...(summaryRows[0] ?? { memberCount: 0, pointLiability: 0, lifetimeSpend: 0, lifetimeVisits: 0 }),
      ...(coupons[0] ?? { availableCoupons: 0, usedCoupons: 0 })
    },
    recentMembers,
    recentLedger,
    recentCoupons,
    stampCampaigns
  };
}
