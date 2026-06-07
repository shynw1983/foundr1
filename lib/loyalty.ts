import { sql } from "./db";
import { orderSourceToCustomerDisplayPlatform, resolveCustomerStoreDisplayName } from "./customer-display-names";
import { sendCouponEmail } from "./email";

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

export type LoyaltyRewardSettings = {
  basePointRateBasis: number;
  birthdayCouponEnabled: boolean;
  birthdayCouponName: string;
  birthdayCouponDiscountType: string;
  birthdayCouponDiscountValue: number;
  birthdayCouponMaxDiscountAmount: number | null;
  birthdayCouponExpiresInDays: number;
  dormantCouponEnabled: boolean;
  dormantDays: number;
  dormantCouponName: string;
  dormantCouponDiscountType: string;
  dormantCouponDiscountValue: number;
  dormantCouponMaxDiscountAmount: number | null;
  dormantCouponExpiresInDays: number;
};

export type EmailNotificationTemplate = {
  templateKey: string;
  category: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  isEnabled: boolean;
  requireOptIn: boolean;
  sendRule: Record<string, unknown>;
  variables: string[];
};

export type LoyaltyTierSetting = {
  id: string;
  tierKey: string;
  name: string;
  rank: number;
  evaluationWindowDays: number;
  requiredSpendAmount: number;
  requiredVisitCount: number;
  pointMultiplier: number;
  isActive: boolean;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const nextValue = Math.round(Number(value));
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.max(min, Math.min(max, nextValue));
}

function clampMultiplier(value: unknown, fallback = 1) {
  const nextValue = Math.round(Number(value) * 1000) / 1000;
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.max(0, Math.min(10, nextValue));
}

function normalizeDiscountType(value: unknown) {
  const text = normalizeText(value);
  return text === "percent" ? "percent" : "amount";
}

function currentTokyoYearMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function currentTokyoDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 0),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 0),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0)
  };
}

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

export async function getLoyaltyRewardSettings() {
  const rows = await sql`
    select
      base_point_rate_basis::int as "basePointRateBasis",
      birthday_coupon_enabled as "birthdayCouponEnabled",
      birthday_coupon_name as "birthdayCouponName",
      birthday_coupon_discount_type as "birthdayCouponDiscountType",
      birthday_coupon_discount_value::int as "birthdayCouponDiscountValue",
      birthday_coupon_max_discount_amount::int as "birthdayCouponMaxDiscountAmount",
      birthday_coupon_expires_in_days::int as "birthdayCouponExpiresInDays",
      dormant_coupon_enabled as "dormantCouponEnabled",
      dormant_days::int as "dormantDays",
      dormant_coupon_name as "dormantCouponName",
      dormant_coupon_discount_type as "dormantCouponDiscountType",
      dormant_coupon_discount_value::int as "dormantCouponDiscountValue",
      dormant_coupon_max_discount_amount::int as "dormantCouponMaxDiscountAmount",
      dormant_coupon_expires_in_days::int as "dormantCouponExpiresInDays"
    from loyalty_reward_settings
    where scope_key = 'global'
    limit 1
  `;
  const settings = rows[0] as LoyaltyRewardSettings | undefined;
  return settings ?? {
    basePointRateBasis: basePointRateBasis,
    birthdayCouponEnabled: true,
    birthdayCouponName: "誕生日特典 500円OFF",
    birthdayCouponDiscountType: "amount",
    birthdayCouponDiscountValue: 500,
    birthdayCouponMaxDiscountAmount: null,
    birthdayCouponExpiresInDays: 45,
    dormantCouponEnabled: true,
    dormantDays: 45,
    dormantCouponName: "お久しぶり 300円OFF",
    dormantCouponDiscountType: "amount",
    dormantCouponDiscountValue: 300,
    dormantCouponMaxDiscountAmount: null,
    dormantCouponExpiresInDays: 30
  };
}

export async function updateLoyaltyRewardSettings(input: Partial<LoyaltyRewardSettings>, updatedBy?: string) {
  const settings = {
    basePointRateBasis: clampInteger(input.basePointRateBasis, basePointRateBasis, 1, 100000),
    birthdayCouponEnabled: input.birthdayCouponEnabled !== false,
    birthdayCouponName: normalizeText(input.birthdayCouponName) || "誕生日特典",
    birthdayCouponDiscountType: normalizeDiscountType(input.birthdayCouponDiscountType),
    birthdayCouponDiscountValue: clampInteger(input.birthdayCouponDiscountValue, 500, 0, 999999),
    birthdayCouponMaxDiscountAmount: input.birthdayCouponMaxDiscountAmount == null ? null : clampInteger(input.birthdayCouponMaxDiscountAmount, 0, 0, 999999),
    birthdayCouponExpiresInDays: clampInteger(input.birthdayCouponExpiresInDays, 45, 1, 365),
    dormantCouponEnabled: input.dormantCouponEnabled !== false,
    dormantDays: clampInteger(input.dormantDays, 45, 1, 730),
    dormantCouponName: normalizeText(input.dormantCouponName) || "お久しぶり特典",
    dormantCouponDiscountType: normalizeDiscountType(input.dormantCouponDiscountType),
    dormantCouponDiscountValue: clampInteger(input.dormantCouponDiscountValue, 300, 0, 999999),
    dormantCouponMaxDiscountAmount: input.dormantCouponMaxDiscountAmount == null ? null : clampInteger(input.dormantCouponMaxDiscountAmount, 0, 0, 999999),
    dormantCouponExpiresInDays: clampInteger(input.dormantCouponExpiresInDays, 30, 1, 365)
  };

  await sql`
    insert into loyalty_reward_settings (
      scope_key,
      base_point_rate_basis,
      birthday_coupon_enabled,
      birthday_coupon_name,
      birthday_coupon_discount_type,
      birthday_coupon_discount_value,
      birthday_coupon_max_discount_amount,
      birthday_coupon_expires_in_days,
      dormant_coupon_enabled,
      dormant_days,
      dormant_coupon_name,
      dormant_coupon_discount_type,
      dormant_coupon_discount_value,
      dormant_coupon_max_discount_amount,
      dormant_coupon_expires_in_days,
      updated_by,
      updated_at
    )
    values (
      'global',
      ${settings.basePointRateBasis},
      ${settings.birthdayCouponEnabled},
      ${settings.birthdayCouponName},
      ${settings.birthdayCouponDiscountType},
      ${settings.birthdayCouponDiscountValue},
      ${settings.birthdayCouponMaxDiscountAmount},
      ${settings.birthdayCouponExpiresInDays},
      ${settings.dormantCouponEnabled},
      ${settings.dormantDays},
      ${settings.dormantCouponName},
      ${settings.dormantCouponDiscountType},
      ${settings.dormantCouponDiscountValue},
      ${settings.dormantCouponMaxDiscountAmount},
      ${settings.dormantCouponExpiresInDays},
      nullif(${normalizeText(updatedBy)}, '')::uuid,
      now()
    )
    on conflict (scope_key)
    do update set
      base_point_rate_basis = excluded.base_point_rate_basis,
      birthday_coupon_enabled = excluded.birthday_coupon_enabled,
      birthday_coupon_name = excluded.birthday_coupon_name,
      birthday_coupon_discount_type = excluded.birthday_coupon_discount_type,
      birthday_coupon_discount_value = excluded.birthday_coupon_discount_value,
      birthday_coupon_max_discount_amount = excluded.birthday_coupon_max_discount_amount,
      birthday_coupon_expires_in_days = excluded.birthday_coupon_expires_in_days,
      dormant_coupon_enabled = excluded.dormant_coupon_enabled,
      dormant_days = excluded.dormant_days,
      dormant_coupon_name = excluded.dormant_coupon_name,
      dormant_coupon_discount_type = excluded.dormant_coupon_discount_type,
      dormant_coupon_discount_value = excluded.dormant_coupon_discount_value,
      dormant_coupon_max_discount_amount = excluded.dormant_coupon_max_discount_amount,
      dormant_coupon_expires_in_days = excluded.dormant_coupon_expires_in_days,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;
  return getLoyaltyRewardSettings();
}

function normalizeTemplateKey(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9_:-]/gi, "").slice(0, 80);
}

function normalizeTemplateVariables(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 30);
}

function normalizeSendRule(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function applyEmailTemplate(value: string, variables: Record<string, unknown>) {
  return normalizeText(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => normalizeText(variables[key]));
}

function getDefaultEmailTemplate(templateKey: string): EmailNotificationTemplate {
  if (templateKey === "coupon_birthday") {
    return {
      templateKey: "coupon_birthday",
      category: "member",
      name: "生日优惠券通知",
      description: "每月生日会员统一发券后发送。",
      subject: "お誕生日特典クーポンをお届けしました",
      body: "{{memberName}} 様\n\nお誕生日月おめでとうございます。Foundr1 Members に誕生日特典クーポンをお届けしました。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}",
      isEnabled: true,
      requireOptIn: true,
      sendRule: { trigger: "monthly_birthday_coupon", dayOfMonth: 1, hour: 10, timezone: "Asia/Tokyo" },
      variables: ["memberName", "couponName", "couponCode", "expiresAt", "memberUrl"]
    };
  }
  return {
    templateKey: "coupon_general",
    category: "member",
    name: "优惠券通知",
    description: "手动发券、补发优惠券通知时使用。",
    subject: "クーポンをお届けしました",
    body: "{{memberName}} 様\n\nFoundr1 Members にクーポンをお届けしました。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}",
    isEnabled: true,
    requireOptIn: true,
    sendRule: { trigger: "coupon_issued" },
    variables: ["memberName", "couponName", "couponCode", "expiresAt", "memberUrl"]
  };
}

export async function getEmailNotificationTemplates() {
  const rows = await sql`
    select
      template_key as "templateKey",
      category,
      name,
      description,
      subject,
      body,
      is_enabled as "isEnabled",
      require_opt_in as "requireOptIn",
      send_rule as "sendRule",
      variables
    from email_notification_templates
    order by
      case category
        when 'order' then 10
        when 'reservation' then 20
        when 'member' then 30
        else 90
      end,
      template_key
  `;
  return (rows as Array<EmailNotificationTemplate>).map((row) => ({
    ...row,
    sendRule: normalizeSendRule(row.sendRule),
    variables: normalizeTemplateVariables(row.variables)
  }));
}

async function getEmailNotificationTemplate(templateKey: string) {
  const key = normalizeTemplateKey(templateKey);
  const rows = await sql`
    select
      template_key as "templateKey",
      category,
      name,
      description,
      subject,
      body,
      is_enabled as "isEnabled",
      require_opt_in as "requireOptIn",
      send_rule as "sendRule",
      variables
    from email_notification_templates
    where template_key = ${key}
    limit 1
  `;
  const template = rows[0] as EmailNotificationTemplate | undefined;
  if (!template) return getDefaultEmailTemplate(key);
  return {
    ...template,
    sendRule: normalizeSendRule(template.sendRule),
    variables: normalizeTemplateVariables(template.variables)
  };
}

export async function updateEmailNotificationTemplates(input: unknown, updatedBy?: string) {
  const items = Array.isArray(input) ? input : [];
  for (const item of items) {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const templateKey = normalizeTemplateKey(raw.templateKey);
    if (!templateKey) continue;
    const sendRule = normalizeSendRule(raw.sendRule);
    const variables = normalizeTemplateVariables(raw.variables);
    await sql`
      update email_notification_templates
      set
        name = ${normalizeText(raw.name).slice(0, 120) || templateKey},
        description = ${normalizeText(raw.description).slice(0, 240)},
        subject = ${normalizeText(raw.subject).slice(0, 200) || "お知らせ"},
        body = ${normalizeText(raw.body).slice(0, 5000)},
        is_enabled = ${raw.isEnabled !== false},
        require_opt_in = ${raw.requireOptIn !== false},
        send_rule = ${JSON.stringify(sendRule)}::jsonb,
        variables = ${JSON.stringify(variables)}::jsonb,
        updated_by = nullif(${normalizeText(updatedBy)}, '')::uuid,
        updated_at = now()
      where template_key = ${templateKey}
    `;
  }
  return getEmailNotificationTemplates();
}

export async function getLoyaltyTierSettings() {
  const rows = await sql`
    select
      id::text,
      tier_key as "tierKey",
      name,
      rank::int,
      evaluation_window_days::int as "evaluationWindowDays",
      required_spend_amount::int as "requiredSpendAmount",
      required_visit_count::int as "requiredVisitCount",
      point_multiplier::float as "pointMultiplier",
      is_active as "isActive"
    from loyalty_tiers
    order by rank, required_spend_amount, required_visit_count, tier_key
  `;
  return rows as LoyaltyTierSetting[];
}

export async function updateLoyaltyTierSettings(input: unknown) {
  const rows = Array.isArray(input) ? input : [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const tierKey = normalizeText(record.tierKey);
    const name = normalizeText(record.name) || tierKey;
    if (!tierKey || !name) continue;
    await sql`
      insert into loyalty_tiers (
        tier_key,
        name,
        rank,
        evaluation_window_days,
        required_spend_amount,
        required_visit_count,
        point_multiplier,
        benefits,
        is_active,
        updated_at
      )
      values (
        ${tierKey},
        ${name},
        ${clampInteger(record.rank, 10, 0, 1000)},
        ${clampInteger(record.evaluationWindowDays, 180, 1, 1095)},
        ${clampInteger(record.requiredSpendAmount, 0, 0, 99999999)},
        ${clampInteger(record.requiredVisitCount, 0, 0, 9999)},
        ${clampMultiplier(record.pointMultiplier, 1)},
        ${JSON.stringify({ description: normalizeText(record.description) })}::jsonb,
        ${record.isActive !== false},
        now()
      )
      on conflict (tier_key)
      do update set
        name = excluded.name,
        rank = excluded.rank,
        evaluation_window_days = excluded.evaluation_window_days,
        required_spend_amount = excluded.required_spend_amount,
        required_visit_count = excluded.required_visit_count,
        point_multiplier = excluded.point_multiplier,
        benefits = loyalty_tiers.benefits || excluded.benefits,
        is_active = excluded.is_active,
        updated_at = now()
    `;
  }
  return getLoyaltyTierSettings();
}

export async function resolveMemberForOrder(input: LoyaltyMemberInput) {
  if (!input.memberId && !input.memberToken && !input.phone && !input.email && !input.identitySubject) return null;
  return upsertMember(input);
}

export async function resolveBrandId(value: unknown) {
  const brand = normalizeText(value);
  if (!brand) return "";
  const normalizedBrand = brand.toLowerCase();
  const aliases = Array.from(new Set([
    brand,
    normalizedBrand === "maamaa" ? "まぁ麻" : "",
    normalizedBrand === "maamaa" ? "maaamaa" : "",
    normalizedBrand === "nanacha" ? "nanacha" : "",
    normalizedBrand === "nanacha" ? "奈奈茶" : ""
  ].filter(Boolean)));
  const rows = await sql`
    select id::text
    from brands
    where id::text = ${brand}
      or lower(name) = any(${aliases.map((alias) => alias.toLowerCase())})
      or lower(brand_type) = any(${aliases.map((alias) => alias.toLowerCase())})
    order by
      case
        when id::text = ${brand} then 0
        when lower(name) = lower(${brand}) then 1
        else 2
      end
    limit 1
  `;
  return normalizeText(rows[0]?.id);
}

export async function getMemberAvailableCoupons(memberId: string, input: { brandId?: string | null; brand?: string | null } = {}) {
  const brandId = normalizeText(input.brandId) || await resolveBrandId(input.brand);
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
      and (${brandId} = '' or member_coupons.brand_id is null or member_coupons.brand_id::text = ${brandId})
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
        and created_at >= now() - interval '3 months'
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

export function calculateCouponDiscount(
  coupon: { discountType?: string; discountValue?: number; maxDiscountAmount?: number | null; issuedSource?: string; name?: string },
  subtotal: number,
  exchangeEligibleAmounts: number[] = []
) {
  const baseAmount = Math.max(0, Math.round(Number(subtotal) || 0));
  const eligibleAmounts = exchangeEligibleAmounts.map((amount) => Math.max(0, Math.round(Number(amount) || 0))).filter((amount) => amount > 0);
  if (isMemberExchangeCoupon(coupon)) {
    return eligibleAmounts.length ? Math.min(baseAmount, Math.max(...eligibleAmounts)) : 0;
  }
  const value = Math.max(0, Math.round(Number(coupon.discountValue) || 0));
  const maxAmount = coupon.maxDiscountAmount == null ? null : Math.max(0, Math.round(Number(coupon.maxDiscountAmount) || 0));
  const rawDiscount = coupon.discountType === "percent" ? Math.floor(baseAmount * value / 100) : value;
  return Math.min(baseAmount, maxAmount == null ? rawDiscount : Math.min(rawDiscount, maxAmount));
}

export function isMemberExchangeCoupon(coupon: { issuedSource?: string; name?: string }) {
  return coupon.issuedSource === "stamp_campaign" || Boolean(coupon.name?.includes("無料券"));
}

export async function getUsableMemberCoupon(memberId: string, couponId: string, input: { brandId?: string | null; brand?: string | null } = {}) {
  const brandId = normalizeText(input.brandId) || await resolveBrandId(input.brand);
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
      coalesce(member_coupons.expires_at::text, '') as "expiresAt",
      member_coupons.issued_source as "issuedSource"
    from member_coupons
    left join brands on brands.id = member_coupons.brand_id
    where member_coupons.id::text = ${couponId}
      and member_coupons.member_id::text = ${memberId}
      and member_coupons.status = 'available'
      and (member_coupons.expires_at is null or member_coupons.expires_at > now())
      and (${brandId} = '' or member_coupons.brand_id is null or member_coupons.brand_id::text = ${brandId})
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

async function issueAutomaticCoupon(input: {
  memberId: string;
  name: string;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  expiresInDays: number;
  source: string;
  metadata: Record<string, unknown>;
}) {
  const memberId = normalizeText(input.memberId);
  const source = normalizeText(input.source);
  const rewardKey = normalizeText(input.metadata.rewardKey);
  if (!memberId || !source || !rewardKey || input.discountValue <= 0) return null;

  const existingRows = await sql`
    select id::text
    from member_coupons
    where member_id::text = ${memberId}
      and issued_source = ${source}
      and metadata ->> 'rewardKey' = ${rewardKey}
    limit 1
  `;
  if (existingRows[0]?.id) return null;

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
      ${input.name},
      ${input.discountType},
      ${input.discountValue},
      ${input.maxDiscountAmount},
      now() + (${input.expiresInDays} || ' days')::interval,
      ${source},
      ${JSON.stringify(input.metadata)}::jsonb
    )
    returning
      id::text,
      coupon_code as "couponCode",
      name,
      coalesce(expires_at::text, '') as "expiresAt"
  `;
  return rows[0] ?? null;
}

export async function issueAutomaticLoyaltyRewardsForMember(memberId: string) {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) return { birthdayIssued: false, dormantIssued: false };
  const [settings, memberRows] = await Promise.all([
    getLoyaltyRewardSettings(),
    sql`
      select
        members.id::text,
        coalesce(members.birthday::text, '') as birthday,
        coalesce(member_accounts.last_purchase_at::text, '') as "lastPurchaseAt",
        coalesce(member_accounts.lifetime_visit_count, 0)::int as "lifetimeVisitCount"
      from members
      left join member_accounts on member_accounts.member_id = members.id
      where members.id::text = ${normalizedMemberId}
        and members.status = 'active'
      limit 1
    `
  ]);
  const member = memberRows[0] as { id: string; birthday: string; lastPurchaseAt: string; lifetimeVisitCount: number } | undefined;
  if (!member?.id) return { birthdayIssued: false, dormantIssued: false };

  let birthdayIssued = false;
  if (settings.birthdayCouponEnabled && /^\d{4}-\d{2}-\d{2}$/.test(member.birthday)) {
    const [, birthMonth] = member.birthday.split("-");
    const current = currentTokyoDateParts();
    if (Number(birthMonth) === current.month) {
      const rewardKey = `birthday:${current.year}-${String(current.month).padStart(2, "0")}`;
      const coupon = await issueAutomaticCoupon({
        memberId: member.id,
        name: settings.birthdayCouponName,
        discountType: settings.birthdayCouponDiscountType,
        discountValue: settings.birthdayCouponDiscountValue,
        maxDiscountAmount: settings.birthdayCouponMaxDiscountAmount ?? settings.birthdayCouponDiscountValue,
        expiresInDays: settings.birthdayCouponExpiresInDays,
        source: "birthday",
        metadata: { rewardKey, birthday: member.birthday }
      });
      birthdayIssued = Boolean(coupon);
    }
  }

  let dormantIssued = false;
  if (settings.dormantCouponEnabled && member.lifetimeVisitCount > 0 && member.lastPurchaseAt) {
    const lastPurchaseAt = new Date(member.lastPurchaseAt).getTime();
    const dormantMs = settings.dormantDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(lastPurchaseAt) && Date.now() - lastPurchaseAt >= dormantMs) {
      const rewardKey = `dormant:${settings.dormantDays}:${currentTokyoYearMonth()}`;
      const coupon = await issueAutomaticCoupon({
        memberId: member.id,
        name: settings.dormantCouponName,
        discountType: settings.dormantCouponDiscountType,
        discountValue: settings.dormantCouponDiscountValue,
        maxDiscountAmount: settings.dormantCouponMaxDiscountAmount ?? settings.dormantCouponDiscountValue,
        expiresInDays: settings.dormantCouponExpiresInDays,
        source: "dormant_reactivation",
        metadata: { rewardKey, dormantDays: settings.dormantDays, lastPurchaseAt: member.lastPurchaseAt }
      });
      dormantIssued = Boolean(coupon);
    }
  }

  return { birthdayIssued, dormantIssued };
}

async function updateCouponEmailStatus(input: { couponId: string; status: string; messageId?: string; error?: string }) {
  await sql`
    update member_coupons
    set metadata = metadata || ${JSON.stringify({
      emailStatus: input.status,
      emailMessageId: input.messageId ?? "",
      emailError: input.error ?? "",
      emailSentAt: input.status === "sent" ? new Date().toISOString() : "",
      emailCheckedAt: new Date().toISOString()
    })}::jsonb
    where id::text = ${input.couponId}
  `;
}

function getConfiguredMemberUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return baseUrl ? `${baseUrl}/member` : "";
}

function formatEmailDate(value: string) {
  if (!value) return "期限なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限なし";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function renderTemplateForCoupon(template: EmailNotificationTemplate, variables: Record<string, unknown>) {
  return {
    subject: applyEmailTemplate(template.subject, variables),
    bodyText: applyEmailTemplate(template.body, variables)
  };
}

export async function resendMemberCouponEmail(input: { couponId: string; requestedBy?: string }) {
  const couponId = normalizeText(input.couponId);
  if (!couponId) throw new Error("クーポンを選択してください。");

  const rows = await sql`
    select
      member_coupons.id::text,
      member_coupons.coupon_code as "couponCode",
      member_coupons.name,
      coalesce(member_coupons.expires_at::text, '') as "expiresAt",
      member_coupons.status,
      members.id::text as "memberId",
      coalesce(nullif(members.display_name, ''), nullif(members.metadata->>'fullName', ''), nullif(members.email, ''), members.member_number) as "memberName",
      coalesce(members.email, '') as email,
      coalesce((members.metadata->>'marketingOptIn')::boolean, false) as "marketingOptIn"
    from member_coupons
    join members on members.id = member_coupons.member_id
    where member_coupons.id::text = ${couponId}
      and members.status = 'active'
    limit 1
  `;
  const coupon = rows[0] as {
    id: string;
    couponCode: string;
    name: string;
    expiresAt: string;
    status: string;
    memberName: string;
    email: string;
    marketingOptIn: boolean;
  } | undefined;
  if (!coupon?.id) throw new Error("クーポンが見つかりません。");
  const template = await getEmailNotificationTemplate("coupon_general");
  if (!template.isEnabled) {
    await updateCouponEmailStatus({ couponId, status: "disabled", error: "Email template is disabled." });
    return { status: "skipped", error: "メールテンプレートが無効です。" };
  }
  if (!coupon.email) {
    await updateCouponEmailStatus({ couponId, status: "skipped", error: "Member email is missing." });
    return { status: "skipped", error: "会員メールが登録されていません。" };
  }
  if (template.requireOptIn && !coupon.marketingOptIn) {
    await updateCouponEmailStatus({ couponId, status: "skipped", error: "marketingOptIn is false." });
    return { status: "skipped", error: "会員がメール通知を許可していません。" };
  }
  const rendered = renderTemplateForCoupon(template, {
    memberName: coupon.memberName,
    couponName: coupon.name,
    couponCode: coupon.couponCode,
    expiresAt: formatEmailDate(coupon.expiresAt),
    memberUrl: getConfiguredMemberUrl()
  });

  const emailResult = await sendCouponEmail({
    to: coupon.email,
    memberName: coupon.memberName,
    couponName: coupon.name,
    couponCode: coupon.couponCode,
    expiresAt: coupon.expiresAt,
    subject: rendered.subject,
    bodyText: rendered.bodyText
  });
  await updateCouponEmailStatus({
    couponId,
    status: emailResult.status,
    messageId: emailResult.id,
    error: emailResult.error
  });
  return emailResult;
}

export async function issueMonthlyBirthdayCoupons(input: { batchLimit?: number; sendEmails?: boolean; respectSchedule?: boolean } = {}) {
  const [settings, birthdayTemplate] = await Promise.all([
    getLoyaltyRewardSettings(),
    getEmailNotificationTemplate("coupon_birthday")
  ]);
  if (!settings.birthdayCouponEnabled || settings.birthdayCouponDiscountValue <= 0) {
    return { ok: true, enabled: false, skippedBySchedule: false, targetMonth: currentTokyoYearMonth(), issuedCount: 0, checkedCount: 0, emailSentCount: 0, emailSkippedCount: 0, emailFailedCount: 0 };
  }

  const current = currentTokyoDateParts();
  const rule = birthdayTemplate.sendRule;
  const scheduledDay = clampInteger(rule.dayOfMonth, 1, 1, 28);
  const scheduledHour = clampInteger(rule.hour, 10, 0, 23);
  if (input.respectSchedule && (current.day !== scheduledDay || current.hour !== scheduledHour)) {
    return { ok: true, enabled: true, skippedBySchedule: true, targetMonth: currentTokyoYearMonth(), scheduledDay, scheduledHour, issuedCount: 0, checkedCount: 0, emailSentCount: 0, emailSkippedCount: 0, emailFailedCount: 0 };
  }
  const targetMonth = `${current.year}-${String(current.month).padStart(2, "0")}`;
  const rewardKey = `birthday:${targetMonth}`;
  const batchLimit = clampInteger(input.batchLimit, 2000, 1, 10000);
  const shouldSendEmails = input.sendEmails !== false && birthdayTemplate.isEnabled;
  const memberRows = await sql`
    select
      id::text,
      birthday::text,
      coalesce(nullif(display_name, ''), nullif(metadata->>'fullName', ''), nullif(email, ''), member_number) as "memberName",
      coalesce(email, '') as email,
      coalesce((metadata->>'marketingOptIn')::boolean, false) as "marketingOptIn"
    from members
    where status = 'active'
      and birthday is not null
      and extract(month from birthday)::int = ${current.month}
    order by created_at
    limit ${batchLimit}
  `;

  let issuedCount = 0;
  let emailSentCount = 0;
  let emailSkippedCount = 0;
  let emailFailedCount = 0;
  for (const member of memberRows as Array<{ id: string; birthday: string; memberName: string; email: string; marketingOptIn: boolean }>) {
    const coupon = await issueAutomaticCoupon({
      memberId: member.id,
      name: settings.birthdayCouponName,
      discountType: settings.birthdayCouponDiscountType,
      discountValue: settings.birthdayCouponDiscountValue,
      maxDiscountAmount: settings.birthdayCouponMaxDiscountAmount ?? settings.birthdayCouponDiscountValue,
      expiresInDays: settings.birthdayCouponExpiresInDays,
      source: "birthday",
      metadata: {
        rewardKey,
        birthday: member.birthday,
        issuedBy: "monthly_birthday_cron"
      }
    });
    if (!coupon) continue;
    issuedCount += 1;

    if (!shouldSendEmails || (birthdayTemplate.requireOptIn && !member.marketingOptIn) || !member.email) {
      emailSkippedCount += 1;
      await updateCouponEmailStatus({
        couponId: String(coupon.id),
        status: shouldSendEmails ? "skipped" : "disabled",
        error: !shouldSendEmails ? "Email sending disabled." : birthdayTemplate.requireOptIn && !member.marketingOptIn ? "marketingOptIn is false." : "Member email is missing."
      });
      continue;
    }
    const rendered = renderTemplateForCoupon(birthdayTemplate, {
      memberName: member.memberName,
      couponName: String(coupon.name),
      couponCode: String(coupon.couponCode),
      expiresAt: formatEmailDate(String(coupon.expiresAt)),
      memberUrl: getConfiguredMemberUrl()
    });

    const emailResult = await sendCouponEmail({
      to: member.email,
      memberName: member.memberName,
      couponName: String(coupon.name),
      couponCode: String(coupon.couponCode),
      expiresAt: String(coupon.expiresAt),
      subject: rendered.subject,
      bodyText: rendered.bodyText
    });
    if (emailResult.status === "sent") emailSentCount += 1;
    else if (emailResult.status === "failed") emailFailedCount += 1;
    else emailSkippedCount += 1;
    await updateCouponEmailStatus({
      couponId: String(coupon.id),
      status: emailResult.status,
      messageId: emailResult.id,
      error: emailResult.error
    });
  }

  return {
    ok: true,
    enabled: true,
    skippedBySchedule: false,
    targetMonth,
    scheduledDay,
    scheduledHour,
    issuedCount,
    checkedCount: memberRows.length,
    emailSentCount,
    emailSkippedCount,
    emailFailedCount
  };
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
      and created_at >= now() - interval '3 months'
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

async function removeSurplusAvailableStampRewards(input: { memberId: string; campaignId: string }) {
  const totalRows = await sql`
    select
      coalesce(sum(loyalty_stamp_ledger.stamps), 0)::int as total,
      greatest(1, loyalty_stamp_campaigns.stamps_required)::int as "stampsRequired"
    from loyalty_stamp_campaigns
    left join loyalty_stamp_ledger
      on loyalty_stamp_ledger.campaign_id = loyalty_stamp_campaigns.id
      and loyalty_stamp_ledger.member_id::text = ${input.memberId}
      and loyalty_stamp_ledger.created_at >= now() - interval '3 months'
    where loyalty_stamp_campaigns.id::text = ${input.campaignId}
    group by loyalty_stamp_campaigns.id
    limit 1
  `;
  const total = Number(totalRows[0]?.total ?? 0);
  const stampsRequired = Math.max(1, Number(totalRows[0]?.stampsRequired ?? 1));
  const entitledRewards = Math.floor(total / stampsRequired);
  const couponRows = await sql`
    select id::text, status
    from member_coupons
    where member_id::text = ${input.memberId}
      and metadata ->> 'stampCampaignId' = ${input.campaignId}
    order by issued_at asc
  `;
  const coupons = couponRows as Array<{ id: string; status: string }>;
  const surplusCount = coupons.length - entitledRewards;
  if (surplusCount <= 0) return 0;
  const removableIds = coupons
    .filter((coupon) => coupon.status === "available")
    .slice(-surplusCount)
    .map((coupon) => coupon.id);
  if (!removableIds.length) return 0;
  const removedRows = await sql`
    delete from member_coupons
    where id::text = any(${removableIds})
      and status = 'available'
      and member_id::text = ${input.memberId}
      and metadata ->> 'stampCampaignId' = ${input.campaignId}
    returning id::text
  `;
  return removedRows.length;
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
  const rows = await sql`
    select
      loyalty_point_ledger.id::text,
      coalesce(brands.name, '') as "brandName",
      coalesce(stores.name, '') as "storeName",
      coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames",
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

  return (rows as Array<{
    id: string;
    brandName: string;
    storeName: string;
    customerDisplayNames?: unknown;
    movementType: string;
    points: number;
    eligibleAmount: number;
    note: string;
    createdAt: string;
  }>).map((entry) => ({
    ...entry,
    storeName: resolveCustomerStoreDisplayName({
      settings: entry.customerDisplayNames,
      internalStoreName: entry.storeName,
      brandName: entry.brandName,
      platform: ""
    })
  }));
}

export async function getMemberOnlineOrderHistory(memberId: string) {
  const rows = await sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.payment_refund_status, '') as "paymentRefundStatus",
      store_customer_orders.amount::int,
      coalesce(sum(store_customer_order_items.refunded_amount), 0)::int as "refundAmount",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.created_at::text as "createdAt",
      coalesce(brands.name, '') as "brandName",
      coalesce(stores.name, '') as "storeName",
      coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames",
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', store_customer_order_items.item_name,
            'quantity', store_customer_order_items.quantity
          )
          order by store_customer_order_items.sort_order, store_customer_order_items.created_at
        ) filter (where store_customer_order_items.id is not null),
        '[]'::jsonb
      ) as items,
      store_customer_orders.drink,
      store_customer_orders.size
    from store_customer_orders
    left join brands on brands.id = store_customer_orders.brand_id
    left join stores on stores.id = store_customer_orders.store_id
    left join store_customer_order_items on store_customer_order_items.order_id = store_customer_orders.id
    where store_customer_orders.member_id::text = ${memberId}
      and store_customer_orders.order_source <> 'store_pos'
    group by store_customer_orders.id, brands.name, stores.name, stores.customer_display_names
    order by store_customer_orders.created_at desc
    limit 30
  `;

  return (rows as Array<{
    id: string;
    pickupCode: string;
    orderSource: string;
    status: string;
    paymentStatus: string;
    paymentRefundStatus: string;
    amount: number;
    refundAmount: number;
    pickupDate: string;
    pickupTime: string;
    createdAt: string;
    brandName: string;
    storeName: string;
    customerDisplayNames?: unknown;
    items: Array<{ name?: string; quantity?: number }> | null;
    drink: string;
    size: string;
  }>).map((order) => {
    const receiptEligible = ["paid", "refunded", "partial_refunded"].includes(order.paymentStatus);
    const receiptParams = new URLSearchParams({
      orderId: order.id,
      pickupCode: order.pickupCode
    });
    const itemLabels = Array.isArray(order.items)
      ? order.items
          .map((item) => {
            const name = normalizeText(item?.name);
            if (!name) return "";
            const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
            return `${name} x ${quantity}`;
          })
          .filter(Boolean)
      : [];
    const fallbackLabel = [normalizeText(order.drink), normalizeText(order.size)].filter(Boolean).join(" / ");
    return {
      ...order,
      storeName: resolveCustomerStoreDisplayName({
        settings: order.customerDisplayNames,
        internalStoreName: order.storeName,
        brandName: order.brandName,
        platform: orderSourceToCustomerDisplayPlatform(order.orderSource)
      }),
      items: itemLabels.length ? itemLabels : fallbackLabel ? [fallbackLabel] : [],
      receiptPreviewUrl: receiptEligible ? `/public/orders/receipt/preview?${receiptParams.toString()}` : "",
      receiptPdfUrl: receiptEligible ? `/api/public/orders/receipt?${receiptParams.toString()}` : ""
    };
  });
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
      store_customer_orders.customer_summary as "customerSummary",
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
    customerSummary?: Record<string, unknown>;
    paymentStatus: string;
    status: string;
  } | undefined;
  if (!order?.memberId || order.amount <= 0 || order.paymentStatus !== "paid" || order.status === "cancelled") return null;
  const settings = await getLoyaltyRewardSettings();

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

  await refreshMemberTier(order.memberId);
  const multiplierRows = await sql`
    select coalesce(loyalty_tiers.point_multiplier, 1)::float as multiplier
    from member_accounts
    left join loyalty_tiers on loyalty_tiers.tier_key = member_accounts.current_tier_key
      and loyalty_tiers.is_active = true
    where member_accounts.member_id::text = ${order.memberId}
    limit 1
  `;
  const pointMultiplier = clampMultiplier(multiplierRows[0]?.multiplier, 1);
  const pointRateBasis = Math.max(1, settings.basePointRateBasis);
  const earnedPoints = Math.floor((order.amount / pointRateBasis) * pointMultiplier);
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
        ${pointRateBasis},
        'order',
        ${pointMultiplier === 1 ? "会計によるポイント付与" : `会計によるポイント付与 x${pointMultiplier}`},
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
  await issueAutomaticLoyaltyRewardsForMember(order.memberId);
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

async function awardStampForOrder(order: { id: string; memberId: string; brandId: string; storeId: string; customerSummary?: Record<string, unknown> }) {
  if (!order.brandId) return;
  if (order.customerSummary?.stampEligible === false) return;
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
        and coalesce(nullif(lower(size_key), ''), lower(size_label), '') not in ('s', 'small')
        and lower(coalesce(size_label, '')) not like 's%'
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
  const orderRows = await sql`
    select
      coalesce(member_id::text, '') as "memberId"
    from store_customer_orders
    where id::text = ${orderId}
    limit 1
  `;
  const order = orderRows[0] as { memberId: string } | undefined;
  const stampRows = await sql`
    delete from loyalty_stamp_ledger
    where order_id::text = ${orderId}
    returning
      member_id::text as "memberId",
      campaign_id::text as "campaignId"
  `;
  const affectedStampCampaigns = new Map<string, { memberId: string; campaignId: string }>();
  for (const row of stampRows as Array<{ memberId: string; campaignId: string }>) {
    affectedStampCampaigns.set(`${row.memberId}:${row.campaignId}`, row);
  }
  for (const campaign of affectedStampCampaigns.values()) {
    await removeSurplusAvailableStampRewards(campaign);
  }

  await sql`
    update member_coupons
    set
      status = 'available',
      used_order_id = null,
      used_store_id = null,
      used_at = null,
      metadata = metadata || ${JSON.stringify({ restoredByRefundOrderId: orderId, restoredAt: new Date().toISOString() })}::jsonb
    where used_order_id::text = ${orderId}
      and status = 'used'
  `;

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
  if (!earn?.memberId || earn.points <= 0) {
    return order?.memberId ? getMemberProfile(order.memberId) : null;
  }

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
        lifetime_points_earned = greatest(0, lifetime_points_earned - ${earn.points}),
        lifetime_spend_amount = greatest(0, lifetime_spend_amount - ${earn.eligibleAmount}),
        lifetime_visit_count = greatest(0, lifetime_visit_count - 1),
        updated_at = now()
      where member_id::text = ${earn.memberId}
    `;
    await refreshMemberTier(earn.memberId);
  }
  return getMemberProfile(earn.memberId);
}

export async function reverseLoyaltyForRefundedOrderItem(input: {
  orderId: string;
  itemId: string;
  paidAmount: number;
  couponId?: string;
  note?: string;
}) {
  const paidAmount = Math.max(0, Math.round(Number(input.paidAmount) || 0));
  const itemRows = await sql`
    select
      store_customer_order_items.id::text,
      store_customer_order_items.order_id::text as "orderId",
      coalesce(store_customer_order_items.coupon_id::text, '') as "couponId",
      coalesce(store_customer_order_items.quantity, 1)::int as quantity,
      coalesce(store_customer_order_items.size_key, '') as "sizeKey",
      coalesce(store_customer_order_items.size_label, '') as "sizeLabel",
      store_customer_orders.member_id::text as "memberId",
      coalesce(store_customer_orders.brand_id::text, '') as "brandId",
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.company_id::text, '') as "companyId",
      store_customer_orders.amount::int as "orderAmount"
    from store_customer_order_items
    join store_customer_orders on store_customer_orders.id = store_customer_order_items.order_id
    left join stores on stores.id = store_customer_orders.store_id
    where store_customer_order_items.id::text = ${input.itemId}
      and store_customer_order_items.order_id::text = ${input.orderId}
    limit 1
  `;
  const item = itemRows[0] as {
    id: string;
    orderId: string;
    couponId: string;
    quantity: number;
    sizeKey: string;
    sizeLabel: string;
    memberId: string;
    brandId: string;
    storeId: string;
    companyId: string;
    orderAmount: number;
  } | undefined;
  if (!item?.memberId) return null;

  const couponId = normalizeText(input.couponId) || item.couponId;
  if (couponId) {
    await sql`
      update member_coupons
      set
        status = 'available',
        used_order_id = null,
        used_store_id = null,
        used_at = null,
        metadata = metadata || ${JSON.stringify({ restoredByRefundItemId: input.itemId, restoredAt: new Date().toISOString() })}::jsonb
      where id::text = ${couponId}
        and used_order_id::text = ${input.orderId}
        and status = 'used'
    `;
  }

  const earnRows = await sql`
    select points::int
    from loyalty_point_ledger
    where order_id::text = ${input.orderId}
      and movement_type = 'earn'
      and member_id::text = ${item.memberId}
    limit 1
  `;
  const earnedPoints = Number(earnRows[0]?.points ?? 0);
  const reversePoints = paidAmount > 0 && earnedPoints > 0 && item.orderAmount > 0
    ? Math.min(earnedPoints, Math.max(1, Math.round(earnedPoints * paidAmount / item.orderAmount)))
    : 0;
  if (reversePoints > 0) {
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
        ${item.memberId},
        ${input.orderId},
        nullif(${item.brandId}, '')::uuid,
        nullif(${item.storeId}, '')::uuid,
        nullif(${item.companyId}, '')::uuid,
        'item_refund_reversal',
        ${-reversePoints},
        ${paidAmount},
        ${basePointRateBasis},
        'refund',
        ${input.note || "商品別返金によるポイント取消"}
      )
      returning id::text
    `;
    if (reverseRows[0]?.id) {
      await sql`
        update member_accounts
        set
          point_balance = greatest(0, point_balance - ${reversePoints}),
          lifetime_points_earned = greatest(0, lifetime_points_earned - ${reversePoints}),
          lifetime_spend_amount = greatest(0, lifetime_spend_amount - ${paidAmount}),
          updated_at = now()
        where member_id::text = ${item.memberId}
      `;
    }
  }

  const stampEligible = coalesceSizeKey(item.sizeKey, item.sizeLabel) !== "s";
  if (stampEligible && item.quantity > 0) {
    const stampRows = await sql`
      update loyalty_stamp_ledger
      set stamps = greatest(0, stamps - ${item.quantity})
      where order_id::text = ${input.orderId}
        and member_id::text = ${item.memberId}
      returning campaign_id::text as "campaignId", stamps::int
    `;
    for (const stamp of stampRows as Array<{ campaignId: string; stamps: number }>) {
      if (stamp.stamps <= 0) {
        await sql`
          delete from loyalty_stamp_ledger
          where order_id::text = ${input.orderId}
            and member_id::text = ${item.memberId}
            and campaign_id::text = ${stamp.campaignId}
            and stamps <= 0
        `;
      }
      await removeSurplusAvailableStampRewards({ memberId: item.memberId, campaignId: stamp.campaignId });
    }
  }

  await refreshMemberTier(item.memberId);
  return getMemberProfile(item.memberId);
}

function coalesceSizeKey(sizeKey: string, sizeLabel: string) {
  const normalized = normalizeText(sizeKey || sizeLabel).toLowerCase();
  if (normalized === "small" || normalized.startsWith("s")) return "s";
  return normalized;
}

export async function refreshMemberTier(memberId: string) {
  const rows = await sql`
    with tier_candidates as (
      select
        loyalty_tiers.tier_key,
        loyalty_tiers.rank,
        coalesce(sum(loyalty_point_ledger.eligible_amount), 0)::int as spend,
        count(distinct loyalty_point_ledger.order_id)::int as visits,
        loyalty_tiers.required_spend_amount,
        loyalty_tiers.required_visit_count
      from loyalty_tiers
      left join loyalty_point_ledger on loyalty_point_ledger.member_id::text = ${memberId}
        and loyalty_point_ledger.movement_type = 'earn'
        and loyalty_point_ledger.created_at >= now() - (loyalty_tiers.evaluation_window_days || ' days')::interval
        and not exists (
          select 1
          from loyalty_point_ledger refund_entries
          where refund_entries.order_id = loyalty_point_ledger.order_id
            and refund_entries.member_id = loyalty_point_ledger.member_id
            and refund_entries.movement_type = 'refund_reversal'
        )
      where loyalty_tiers.is_active = true
      group by
        loyalty_tiers.tier_key,
        loyalty_tiers.rank,
        loyalty_tiers.required_spend_amount,
        loyalty_tiers.required_visit_count
    )
    select tier_key
    from tier_candidates
    where spend >= required_spend_amount
      and visits >= required_visit_count
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
        coalesce(member_coupons.metadata->>'emailStatus', '') as "emailStatus",
        coalesce(member_coupons.metadata->>'emailMessageId', '') as "emailMessageId",
        coalesce(member_coupons.metadata->>'emailError', '') as "emailError",
        coalesce(member_coupons.metadata->>'emailSentAt', '') as "emailSentAt",
        coalesce(member_coupons.metadata->>'emailCheckedAt', '') as "emailCheckedAt",
        coalesce(members.email, '') as "memberEmail",
        coalesce((members.metadata->>'marketingOptIn')::boolean, false) as "marketingOptIn",
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
