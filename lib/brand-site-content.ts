import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";
import { menuTranslationLanguages } from "./menu-auto-translation";

export type BrandSiteLanguage = typeof menuTranslationLanguages[number];
type BrandSiteTranslationField = "title" | "subtitle" | "body" | "actionLabel" | "tag";

export type BrandSiteTranslationDraftEntry = {
  key: string;
  sectionId: string;
  sectionLabel: string;
  pageKey: string;
  field: BrandSiteTranslationField;
  tagIndex: number | null;
  language: BrandSiteLanguage;
  sourceText: string;
  currentText: string;
  suggestedText: string;
};

type BrandSiteSectionPayload = {
  id?: string;
  brandId: string;
  pageKey: string;
  sectionKey: string;
  sectionType: string;
  title: string;
  subtitle: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  actionLabel: string;
  actionUrl: string;
  tags: string[];
  fields: Record<string, unknown>;
  titleDisplayNames: Record<string, unknown>;
  subtitleDisplayNames: Record<string, unknown>;
  bodyDisplayNames: Record<string, unknown>;
  actionLabelDisplayNames: Record<string, unknown>;
  tagDisplayNames: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
};

type BrandSiteSectionSeed = {
  pageKey: string;
  sectionKey: string;
  sectionType?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string;
  imageAlt?: string;
  actionLabel?: string;
  actionUrl?: string;
  tags?: string[];
  fields?: Record<string, unknown>;
  sortOrder?: number;
};

type OpenAiTranslationResult = {
  key?: unknown;
  text?: unknown;
};

export const brandSiteLanguageLabels: Record<BrandSiteLanguage, string> = {
  en: "English",
  zh: "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ko: "Korean",
  vi: "Vietnamese",
  ne: "Nepali"
};

const nanachaSections: BrandSiteSectionSeed[] = [
  {
    pageKey: "home",
    sectionKey: "hero",
    sectionType: "hero",
    title: "nanacha",
    subtitle: "tapioca & more...",
    body: "2019年12月に福岡で誕生した nanacha は、黒糖タピオカミルク、フルーツティー、八女抹茶ラテ、スムージーまで、素材の香りと選ぶ楽しさを大切にした、気軽に立ち寄れるティースタンドです。",
    imageUrl: "/assets/nanacha-hero.png",
    imageAlt: "nanacha の人気ドリンク",
    actionLabel: "メニューを見る",
    actionUrl: "/menu",
    tags: ["受け取り予約", "黒糖タピオカ", "福岡清川店"],
    sortOrder: 10
  },
  {
    pageKey: "home",
    sectionKey: "hero-slide-signature",
    sectionType: "slide",
    title: "signature drinks",
    body: "香りまで楽しむ、nanacha の定番。",
    imageUrl: "/assets/nanacha-hero.png",
    imageAlt: "nanacha の人気ドリンク",
    sortOrder: 20
  },
  {
    pageKey: "home",
    sectionKey: "hero-slide-tapioca",
    sectionType: "slide",
    title: "fresh tapioca",
    body: "もちもち食感の黒糖タピオカ。",
    imageUrl: "/assets/menu/drink-01.png",
    imageAlt: "黒糖タピオカミルク",
    sortOrder: 30
  },
  {
    pageKey: "home",
    sectionKey: "order-guide",
    sectionType: "card_group",
    title: "はじめての方へ",
    subtitle: "how to order",
    body: "ドリンクを選び、サイズ・甘さ・氷を調整し、トッピングを追加して自分好みの一杯にできます。",
    tags: ["ドリンクを選ぶ", "サイズを選ぶ", "甘さ・氷を調整", "トッピングを追加"],
    fields: {
      cards: [
        { label: "01", title: "ドリンクを選ぶ", body: "黒糖タピオカミルク、フラッペ、タピオカティー、スムージーなど、気分に合わせて選べます。" },
        { label: "02", title: "サイズを選ぶ", body: "S 360ml、R 500ml、L 700ml から選択。しっかり楽しみたい日はラージがおすすめです。" },
        { label: "03", title: "甘さ・氷を調整", body: "甘さはふつう、多め、少なめ、ゼロ。氷の量も好みに合わせて調整できます。" },
        { label: "04", title: "トッピングを追加", body: "タピオカ追加、チーズフォーム、オレオ、ホイップなどで、自分好みの一杯にできます。" }
      ]
    },
    sortOrder: 40
  },
  {
    pageKey: "home",
    sectionKey: "recommend-guide",
    sectionType: "card_group",
    title: "おすすめの選び方",
    subtitle: "drink guide",
    body: "初めての方、甘さ控えめが好きな方、濃厚な味が好きな方、暑い日や食後など、気分に合わせた選び方を案内します。",
    actionLabel: "メニューで探す",
    actionUrl: "/menu",
    tags: ["初めての方", "甘さ控えめ", "濃厚な味", "暑い日や食後に"],
    sortOrder: 50
  },
  {
    pageKey: "home",
    sectionKey: "story",
    sectionType: "card_group",
    title: "nanachaのこだわり",
    subtitle: "our tea stand",
    body: "店内抽出のお茶、もちもちの黒糖タピオカ、福岡らしい素材を大切にしています。",
    tags: ["店内抽出のお茶", "もちもちの黒糖タピオカ", "福岡らしい素材"],
    sortOrder: 60
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    sectionType: "store_group",
    title: "店舗紹介",
    subtitle: "our shops",
    body: "福岡市中央区清川の路面店。テイクアウト・受け取り予約に対応。",
    imageUrl: "/assets/stores/kiyokawa-storefront.webp",
    imageAlt: "福岡清川店の外観",
    actionLabel: "店舗情報を見る",
    actionUrl: "/shops/kiyokawa",
    tags: ["open now", "福岡清川店", "テイクアウト", "受け取り予約"],
    sortOrder: 70
  },
  {
    pageKey: "home",
    sectionKey: "faq",
    sectionType: "faq",
    title: "よくある質問",
    subtitle: "faq",
    body: "タピオカ抜き、甘さゼロや氷抜き、テイクアウト、カフェイン、アレルギー、店舗場所などをご案内します。",
    tags: ["タピオカ抜き", "甘さ・氷", "テイクアウト", "カフェイン", "アレルギー", "場所"],
    sortOrder: 80
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    sectionType: "hero",
    title: "nanacha menu",
    subtitle: "nanacha full menu",
    body: "nanacha のタピオカミルク、フラッペ、チーズティー、スムージー、ティー、コーヒーまで。 サイズ・甘さ・氷の量・トッピングを選んで、自分好みの一杯に。",
    tags: ["タピオカミルク", "フラッペ", "チーズティー", "スムージー"],
    sortOrder: 10
  },
  {
    pageKey: "menu",
    sectionKey: "allergy-caffeine",
    sectionType: "info_group",
    title: "アレルギー・カフェインについて",
    subtitle: "menu information",
    body: "牛乳、豆乳、ナッツ、ごま、チョコレート、オレオ、ホイップ、チーズフォームなどを使用する商品があります。紅茶、緑茶、ほうじ茶、ジャスミン茶、コーヒーを使う商品にはカフェインが含まれる場合があります。",
    tags: ["アレルギー", "カフェイン", "甘さ・氷"],
    sortOrder: 20
  },
  {
    pageKey: "footer",
    sectionKey: "footer",
    sectionType: "footer",
    title: "nanacha · tapioca & more...",
    body: "福岡発のティースタンド",
    actionLabel: "店舗一覧を見る",
    actionUrl: "/shops",
    imageUrl: "/assets/nanacha-logo.png",
    imageAlt: "nanacha",
    tags: ["Instagram"],
    sortOrder: 10
  }
];

const maamaaSections: BrandSiteSectionSeed[] = [
  {
    pageKey: "home",
    sectionKey: "hero",
    sectionType: "hero",
    title: "まぁ麻",
    subtitle: "出来立て麻辣湯",
    body: "その日の気分に合わせて、具材も、辛さも、しびれも自由に。まぁ麻は、選ぶ楽しさと出来立ての香りを大切にする麻辣湯専門店です。一杯ずつ鍋を分けて仕上げる、熱々の一杯をお楽しみください。",
    imageUrl: "/images/maamaa-hero-bowl.jpg",
    imageAlt: "まぁ麻の麻辣湯",
    actionLabel: "メニューを見る",
    actionUrl: "/stores/shimizu/menu",
    tags: ["出来立て", "麻辣湯", "清水店"],
    sortOrder: 10
  },
  {
    pageKey: "home",
    sectionKey: "concept",
    sectionType: "content",
    title: "選ぶたのしさを、出来立てで。",
    subtitle: "Brand concept",
    body: "野菜、きのこ、肉、海鮮、麺。好きな具材を選んだら、辛さとしびれを好みに合わせて。一杯ずつ鍋を分け、スープの香りと具材の食感が立つ麻辣湯に仕上げます。",
    tags: ["注文ごと", "出来立て", "香り"],
    sortOrder: 20
  },
  {
    pageKey: "home",
    sectionKey: "build-a-bowl",
    sectionType: "card_group",
    title: "一杯の中に、好きなものを少しずつ。",
    subtitle: "Build a bowl",
    body: "具材を選び、辛さとしびれを整え、気分に合う一杯へ。まぁ麻の麻辣湯は、選ぶ時間からおいしさが始まります。",
    tags: ["Cook", "Select", "Balance"],
    fields: {
      cards: [
        { title: "Cook", body: "一杯ずつ鍋を分けて、スープの香りと具材の食感を引き出します。" },
        { title: "Select", body: "野菜、きのこ、肉、海鮮、麺まで。その日の気分で自由に選べます。" },
        { title: "Balance", body: "辛さ、しびれ、香りを重ねて、自分にちょうどいい一杯へ。" }
      ]
    },
    sortOrder: 30
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    sectionType: "store_group",
    title: "今日の一杯を、好きな場所で。",
    subtitle: "Shop information",
    body: "店頭受け取り、デリバリー、テイクアウト、店内飲食。店舗ごとの受付状況に合わせて、出来立ての麻辣湯をお届けします。",
    actionLabel: "清水店の受け取り予約",
    actionUrl: "/stores/shimizu/menu",
    tags: ["清水店", "Web予約", "デリバリー", "テイクアウト"],
    sortOrder: 40
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    sectionType: "hero",
    title: "好きな具材で、今日の麻辣湯を。",
    subtitle: "Web予約",
    body: "具材、麺、辛さ、痺れを選んで、自分好みの一杯をWeb予約できます。一杯ずつ鍋を分けて仕上げる、出来立ての麻辣湯をお楽しみください。",
    actionLabel: "予約リストに追加",
    actionUrl: "/stores/shimizu/menu",
    tags: ["店頭受け取り", "カスタムメニュー", "辛さ", "痺れ", "トッピング"],
    sortOrder: 10
  },
  {
    pageKey: "menu",
    sectionKey: "reservation-summary",
    sectionType: "form_panel",
    title: "予約リスト",
    subtitle: "Pickup reservation",
    body: "カスタムした一杯をリストに追加して、複数の商品をまとめて受け取り予約できます。",
    actionLabel: "支払いへ進む",
    tags: ["お名前", "電話番号", "受け取り日", "受け取り時間", "会員ポイント"],
    sortOrder: 20
  },
  {
    pageKey: "menu",
    sectionKey: "builder-labels",
    sectionType: "label_group",
    title: "注文ビルダー表示ラベル",
    subtitle: "Menu builder labels",
    body: "現在の一杯、ベーススープ、必須選択、個数制限、予約リスト追加など、注文画面内で使うラベルを管理します。",
    tags: ["Base soup", "Required", "現在の一杯", "次の一杯", "6個まで", "1個選択"],
    sortOrder: 30
  },
  {
    pageKey: "footer",
    sectionKey: "footer",
    sectionType: "footer",
    title: "まぁ麻",
    body: "選ぶ楽しさと出来立ての香りを届ける、麻辣湯専門店。",
    actionLabel: "Contact",
    actionUrl: "mailto:hello@maamaa.example",
    tags: ["特定商取引法に基づく表記", "利用規約", "プライバシーポリシー"],
    sortOrder: 10
  }
];

export async function canEditBrandSiteContent(session: EmployeeSession) {
  return roleHasPermission(session.role, "menus.edit");
}

export async function canApproveBrandSiteContent(session: EmployeeSession) {
  return roleHasPermission(session.role, "brandSites.publish");
}

function defaultSectionsForBrand(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("nanacha") || name.includes("奶茶")) return nanachaSections;
  if (normalized.includes("maamaa") || name.includes("まぁ麻") || name.includes("麻辣")) return maamaaSections;
  return [];
}

function normalizeDisplayRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean).slice(0, 20);
}

function normalizePayload(body: Record<string, unknown>): BrandSiteSectionPayload {
  const brandId = cleanId(body.brandId);
  const pageKey = cleanText(body.pageKey, 80);
  const sectionKey = cleanText(body.sectionKey, 120);
  if (!brandId || !pageKey || !sectionKey) throw new Error("ブランド、ページ、板块キーを入力してください。");
  const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};
  return {
    id: cleanId(body.id) ?? undefined,
    brandId,
    pageKey,
    sectionKey,
    sectionType: cleanText(body.sectionType, 80) || "content",
    title: cleanText(body.title, 500),
    subtitle: cleanText(body.subtitle, 500),
    body: cleanText(body.body),
    imageUrl: cleanText(body.imageUrl, 1000),
    imageAlt: cleanText(body.imageAlt, 500),
    actionLabel: cleanText(body.actionLabel, 300),
    actionUrl: cleanText(body.actionUrl, 1000),
    tags: normalizeTags(body.tags),
    fields,
    titleDisplayNames: normalizeDisplayRecord(body.titleDisplayNames),
    subtitleDisplayNames: normalizeDisplayRecord(body.subtitleDisplayNames),
    bodyDisplayNames: normalizeDisplayRecord(body.bodyDisplayNames),
    actionLabelDisplayNames: normalizeDisplayRecord(body.actionLabelDisplayNames),
    tagDisplayNames: normalizeDisplayRecord(body.tagDisplayNames),
    sortOrder: Math.max(0, Math.round(Number(body.sortOrder) || 100)),
    isActive: body.isActive !== false
  };
}

function cleanText(value: unknown, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  return id || null;
}

function normalizeLanguages(value: unknown): BrandSiteLanguage[] {
  const requested = Array.isArray(value) ? value.map((entry) => String(entry).trim()) : [];
  const allowed = requested.filter((entry): entry is BrandSiteLanguage => menuTranslationLanguages.includes(entry as BrandSiteLanguage));
  return allowed.length ? allowed : [...menuTranslationLanguages];
}

function needsTranslation(currentText: unknown, overwriteExisting: boolean) {
  if (overwriteExisting) return true;
  return !String(currentText ?? "").trim();
}

function extractJsonArray(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const match = trimmed.match(/\[[\s\S]*\]/);
  return match?.[0] ?? "[]";
}

function chunkEntries<T>(entries: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) chunks.push(entries.slice(index, index + size));
  return chunks;
}

async function ensureDefaultBrandSiteSections() {
  const brands = await sql`
    select id::text, name
    from brands
    where status = 'active'
  `;

  for (const brand of brands) {
    const seeds = defaultSectionsForBrand(String(brand.name ?? ""));
    if (!seeds.length) continue;

    const existing = await sql`
      select count(*)::int as count
      from brand_site_sections
      where brand_id = ${brand.id}
    `;
    if (Number(existing[0]?.count ?? 0) > 0) continue;

    for (const seed of seeds) {
      await sql`
        insert into brand_site_sections (
          brand_id,
          page_key,
          section_key,
          section_type,
          title,
          subtitle,
          body,
          image_url,
          image_alt,
          action_label,
          action_url,
          tags,
          fields,
          sort_order,
          updated_at
        )
        values (
          ${brand.id},
          ${seed.pageKey},
          ${seed.sectionKey},
          ${seed.sectionType ?? "content"},
          ${seed.title ?? ""},
          ${seed.subtitle ?? ""},
          ${seed.body ?? ""},
          ${seed.imageUrl ?? ""},
          ${seed.imageAlt ?? ""},
          ${seed.actionLabel ?? ""},
          ${seed.actionUrl ?? ""},
          ${JSON.stringify(seed.tags ?? [])}::jsonb,
          ${JSON.stringify(seed.fields ?? {})}::jsonb,
          ${seed.sortOrder ?? 100},
          now()
        )
        on conflict (brand_id, page_key, section_key) do nothing
      `;
    }
  }
}

export async function readBrandSiteContent() {
  await ensureDefaultBrandSiteSections();

  const [brands, sections, revisions] = await Promise.all([
    sql`
      select id::text, name
      from brands
      where status = 'active'
      order by name
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        page_key as "pageKey",
        section_key as "sectionKey",
        section_type as "sectionType",
        title,
        subtitle,
        body,
        image_url as "imageUrl",
        image_alt as "imageAlt",
        action_label as "actionLabel",
        action_url as "actionUrl",
        coalesce(tags, '[]'::jsonb) as tags,
        coalesce(fields, '{}'::jsonb) as fields,
        coalesce(title_display_names, '{}'::jsonb) as "titleDisplayNames",
        coalesce(subtitle_display_names, '{}'::jsonb) as "subtitleDisplayNames",
        coalesce(body_display_names, '{}'::jsonb) as "bodyDisplayNames",
        coalesce(action_label_display_names, '{}'::jsonb) as "actionLabelDisplayNames",
        coalesce(tag_display_names, '{}'::jsonb) as "tagDisplayNames",
        sort_order as "sortOrder",
        is_active as "isActive",
        updated_at as "updatedAt"
      from brand_site_sections
      order by page_key, sort_order, section_key
    `,
    sql`
      select
        brand_site_section_revisions.id::text,
        coalesce(brand_site_section_revisions.section_id::text, '') as "sectionId",
        brand_site_section_revisions.brand_id::text as "brandId",
        brand_site_section_revisions.page_key as "pageKey",
        brand_site_section_revisions.section_key as "sectionKey",
        coalesce(brand_site_section_revisions.payload, '{}'::jsonb) as payload,
        brand_site_section_revisions.status,
        coalesce(submitted_employee.name, '') as "submittedByName",
        coalesce(reviewed_employee.name, '') as "reviewedByName",
        brand_site_section_revisions.review_note as "reviewNote",
        brand_site_section_revisions.submitted_at as "submittedAt",
        brand_site_section_revisions.reviewed_at as "reviewedAt",
        brand_site_section_revisions.updated_at as "updatedAt"
      from brand_site_section_revisions
      left join employees submitted_employee on submitted_employee.id = brand_site_section_revisions.submitted_by
      left join employees reviewed_employee on reviewed_employee.id = brand_site_section_revisions.reviewed_by
      where brand_site_section_revisions.status = 'pending'
         or brand_site_section_revisions.submitted_at > now() - interval '30 days'
      order by
        case when brand_site_section_revisions.status = 'pending' then 0 else 1 end,
        brand_site_section_revisions.submitted_at desc
    `
  ]);

  return { brands, sections, revisions };
}

export async function upsertBrandSiteSection(body: Record<string, unknown>) {
  const payload = normalizePayload(body);
  const rows = payload.id
    ? await sql`
        update brand_site_sections
        set
          brand_id = ${payload.brandId},
          page_key = ${payload.pageKey},
          section_key = ${payload.sectionKey},
          section_type = ${payload.sectionType},
          title = ${payload.title},
          subtitle = ${payload.subtitle},
          body = ${payload.body},
          image_url = ${payload.imageUrl},
          image_alt = ${payload.imageAlt},
          action_label = ${payload.actionLabel},
          action_url = ${payload.actionUrl},
          tags = ${JSON.stringify(payload.tags)}::jsonb,
          fields = ${JSON.stringify(payload.fields)}::jsonb,
          title_display_names = ${JSON.stringify(payload.titleDisplayNames)}::jsonb,
          subtitle_display_names = ${JSON.stringify(payload.subtitleDisplayNames)}::jsonb,
          body_display_names = ${JSON.stringify(payload.bodyDisplayNames)}::jsonb,
          action_label_display_names = ${JSON.stringify(payload.actionLabelDisplayNames)}::jsonb,
          tag_display_names = ${JSON.stringify(payload.tagDisplayNames)}::jsonb,
          sort_order = ${payload.sortOrder},
          is_active = ${payload.isActive},
          updated_at = now()
        where id = ${payload.id}
        returning id::text
      `
    : await sql`
        insert into brand_site_sections (
          brand_id,
          page_key,
          section_key,
          section_type,
          title,
          subtitle,
          body,
          image_url,
          image_alt,
          action_label,
          action_url,
          tags,
          fields,
          title_display_names,
          subtitle_display_names,
          body_display_names,
          action_label_display_names,
          tag_display_names,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${payload.brandId},
          ${payload.pageKey},
          ${payload.sectionKey},
          ${payload.sectionType},
          ${payload.title},
          ${payload.subtitle},
          ${payload.body},
          ${payload.imageUrl},
          ${payload.imageAlt},
          ${payload.actionLabel},
          ${payload.actionUrl},
          ${JSON.stringify(payload.tags)}::jsonb,
          ${JSON.stringify(payload.fields)}::jsonb,
          ${JSON.stringify(payload.titleDisplayNames)}::jsonb,
          ${JSON.stringify(payload.subtitleDisplayNames)}::jsonb,
          ${JSON.stringify(payload.bodyDisplayNames)}::jsonb,
          ${JSON.stringify(payload.actionLabelDisplayNames)}::jsonb,
          ${JSON.stringify(payload.tagDisplayNames)}::jsonb,
          ${payload.sortOrder},
          ${payload.isActive},
          now()
        )
        on conflict (brand_id, page_key, section_key)
        do update set
          section_type = excluded.section_type,
          title = excluded.title,
          subtitle = excluded.subtitle,
          body = excluded.body,
          image_url = excluded.image_url,
          image_alt = excluded.image_alt,
          action_label = excluded.action_label,
          action_url = excluded.action_url,
          tags = excluded.tags,
          fields = excluded.fields,
          title_display_names = excluded.title_display_names,
          subtitle_display_names = excluded.subtitle_display_names,
          body_display_names = excluded.body_display_names,
          action_label_display_names = excluded.action_label_display_names,
          tag_display_names = excluded.tag_display_names,
          sort_order = excluded.sort_order,
          is_active = excluded.is_active,
          updated_at = now()
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}

export async function submitBrandSiteSectionRevision(body: Record<string, unknown>, employeeId: string) {
  const payload = normalizePayload(body);
  const rows = await sql`
    insert into brand_site_section_revisions (
      section_id,
      brand_id,
      page_key,
      section_key,
      payload,
      status,
      submitted_by,
      submitted_at,
      updated_at
    )
    values (
      ${payload.id ?? null},
      ${payload.brandId},
      ${payload.pageKey},
      ${payload.sectionKey},
      ${JSON.stringify(payload)}::jsonb,
      'pending',
      ${employeeId},
      now(),
      now()
    )
    returning id::text
  `;

  return { ok: true, reviewRequired: true, id: rows[0]?.id };
}

export async function reviewBrandSiteSectionRevision(input: {
  id: unknown;
  action: unknown;
  reviewNote?: unknown;
  reviewerId: string;
}) {
  const id = cleanId(input.id);
  if (!id) throw new Error("审核対象を選択してください。");
  const action = String(input.action ?? "").trim();
  if (action !== "approve" && action !== "reject") throw new Error("審査アクションが不正です。");

  const rows = await sql`
    select id::text, payload, status
    from brand_site_section_revisions
    where id = ${id}
    limit 1
  `;
  const revision = rows[0];
  if (!revision || revision.status !== "pending") throw new Error("待审核の修訂が見つかりません。");

  if (action === "reject") {
    await sql`
      update brand_site_section_revisions
      set
        status = 'rejected',
        reviewed_by = ${input.reviewerId},
        reviewed_at = now(),
        review_note = ${cleanText(input.reviewNote, 1000)},
        updated_at = now()
      where id = ${id}
    `;
    return { ok: true, status: "rejected" };
  }

  const payload = normalizePayload(revision.payload as Record<string, unknown>);
  const applied = await upsertBrandSiteSection(payload as unknown as Record<string, unknown>);
  await sql`
    update brand_site_section_revisions
    set
      section_id = ${applied.id ?? payload.id ?? null},
      status = 'approved',
      reviewed_by = ${input.reviewerId},
      reviewed_at = now(),
      review_note = ${cleanText(input.reviewNote, 1000)},
      updated_at = now()
    where id = ${id}
  `;

  return { ok: true, status: "approved", sectionId: applied.id };
}

export async function deleteBrandSiteSection(id: unknown) {
  const sectionId = cleanId(id);
  if (!sectionId) throw new Error("削除対象を選択してください。");
  await sql`delete from brand_site_sections where id = ${sectionId}`;
  return { ok: true };
}

export async function collectBrandSiteTranslationTargets(input: {
  brandId: unknown;
  languages: unknown;
  overwriteExisting?: boolean;
}) {
  const brandId = cleanId(input.brandId);
  if (!brandId) throw new Error("ブランドを選択してください。");
  const languages = normalizeLanguages(input.languages);
  const overwriteExisting = input.overwriteExisting === true;
  const sections = await sql`
    select
      id::text,
      page_key as "pageKey",
      section_key as "sectionKey",
      title,
      subtitle,
      body,
      action_label as "actionLabel",
      coalesce(tags, '[]'::jsonb) as tags,
      coalesce(title_display_names, '{}'::jsonb) as "titleDisplayNames",
      coalesce(subtitle_display_names, '{}'::jsonb) as "subtitleDisplayNames",
      coalesce(body_display_names, '{}'::jsonb) as "bodyDisplayNames",
      coalesce(action_label_display_names, '{}'::jsonb) as "actionLabelDisplayNames",
      coalesce(tag_display_names, '{}'::jsonb) as "tagDisplayNames"
    from brand_site_sections
    where brand_id = ${brandId}
      and is_active = true
    order by page_key, sort_order, section_key
  `;

  const entries: BrandSiteTranslationDraftEntry[] = [];
  for (const section of sections) {
    const label = `${section.pageKey} / ${section.title || section.sectionKey}`;
    const fieldConfig: Array<{ field: Exclude<BrandSiteTranslationField, "tag">; source: string; names: Record<string, unknown> }> = [
      { field: "title", source: cleanText(section.title, 500), names: normalizeDisplayRecord(section.titleDisplayNames) },
      { field: "subtitle", source: cleanText(section.subtitle, 500), names: normalizeDisplayRecord(section.subtitleDisplayNames) },
      { field: "body", source: cleanText(section.body), names: normalizeDisplayRecord(section.bodyDisplayNames) },
      { field: "actionLabel", source: cleanText(section.actionLabel, 300), names: normalizeDisplayRecord(section.actionLabelDisplayNames) }
    ];

    for (const field of fieldConfig) {
      if (!field.source) continue;
      for (const language of languages) {
        const currentText = String(field.names[language] ?? "").trim();
        if (needsTranslation(currentText, overwriteExisting)) {
          entries.push({
            key: `${section.id}:${field.field}:${language}`,
            sectionId: String(section.id),
            sectionLabel: label,
            pageKey: String(section.pageKey),
            field: field.field,
            tagIndex: null,
            language,
            sourceText: field.source,
            currentText,
            suggestedText: ""
          });
        }
      }
    }

    const tagDisplayNames = normalizeDisplayRecord(section.tagDisplayNames);
    const tags = normalizeTags(section.tags);
    for (const [tagIndex, tag] of tags.entries()) {
      const languageRecord = normalizeDisplayRecord(tagDisplayNames[tagIndex]);
      for (const language of languages) {
        const currentText = String(languageRecord[language] ?? "").trim();
        if (needsTranslation(currentText, overwriteExisting)) {
          entries.push({
            key: `${section.id}:tag:${tagIndex}:${language}`,
            sectionId: String(section.id),
            sectionLabel: label,
            pageKey: String(section.pageKey),
            field: "tag",
            tagIndex,
            language,
            sourceText: tag,
            currentText,
            suggestedText: ""
          });
        }
      }
    }
  }

  return entries;
}

export async function generateBrandSiteTranslationPreview(entries: BrandSiteTranslationDraftEntry[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません。");
  const model = process.env.OPENAI_BRAND_SITE_TRANSLATION_MODEL || process.env.OPENAI_MENU_TRANSLATION_MODEL || "gpt-5.4-mini";
  if (!entries.length) return { entries, model };

  const suggestedByKey = new Map<string, string>();
  for (const chunk of chunkEntries(entries, 35)) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "You translate restaurant brand website content from Japanese into customer-facing website copy.",
                  "Return only a JSON array. Do not include markdown.",
                  "Each output item must be {\"key\":\"...\",\"text\":\"...\"}.",
                  "Keep copy concise and natural for public restaurant websites.",
                  "Translate labels and tags as UI labels when they are short.",
                  "Treat zh as Simplified Chinese and zh-Hant as Traditional Chinese. Never copy Simplified Chinese into Traditional Chinese."
                ].join("\n")
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  sourceLanguage: "Japanese",
                  targetLanguageLabels: brandSiteLanguageLabels,
                  entries: chunk.map((entry) => ({
                    key: entry.key,
                    language: entry.language,
                    sourceText: entry.sourceText,
                    sectionLabel: entry.sectionLabel,
                    field: entry.field
                  }))
                })
              }
            ]
          }
        ],
        max_output_tokens: 6000
      })
    });
    const body = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    if (!response.ok) throw new Error(body.error?.message || "OpenAI 翻訳に失敗しました。");
    const content = body.output_text
      ?? body.output?.flatMap((item) => item.content ?? []).map((contentItem) => contentItem.text ?? "").join("\n").trim()
      ?? "";
    const parsed = JSON.parse(extractJsonArray(content)) as OpenAiTranslationResult[];
    for (const result of parsed) {
      const key = String(result.key ?? "");
      const text = String(result.text ?? "").trim();
      if (key && text) suggestedByKey.set(key, text);
    }
  }

  return { entries: entries.map((entry) => ({ ...entry, suggestedText: suggestedByKey.get(entry.key) ?? "" })), model };
}

function normalizeAppliedEntries(value: unknown): BrandSiteTranslationDraftEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const language = String(source.language ?? "") as BrandSiteLanguage;
    const field = String(source.field ?? "") as BrandSiteTranslationField;
    const tagIndexValue = source.tagIndex === null || source.tagIndex === undefined ? null : Math.max(0, Math.round(Number(source.tagIndex)));
    return {
      key: String(source.key ?? ""),
      sectionId: String(source.sectionId ?? ""),
      sectionLabel: String(source.sectionLabel ?? ""),
      pageKey: String(source.pageKey ?? ""),
      field,
      tagIndex: tagIndexValue,
      language,
      sourceText: String(source.sourceText ?? ""),
      currentText: String(source.currentText ?? ""),
      suggestedText: cleanText(source.suggestedText, 4000),
    };
  }).filter((entry) => (
    entry.key
    && entry.sectionId
    && entry.suggestedText
    && ["title", "subtitle", "body", "actionLabel", "tag"].includes(entry.field)
    && menuTranslationLanguages.includes(entry.language)
  ));
}

export async function applyBrandSiteTranslationEntries(input: {
  brandId: unknown;
  entries: unknown;
}) {
  const brandId = cleanId(input.brandId);
  if (!brandId) throw new Error("ブランドを選択してください。");
  const entries = normalizeAppliedEntries(input.entries);
  if (!entries.length) throw new Error("書き込む翻訳がありません。");

  let updated = 0;
  const sectionIds = Array.from(new Set(entries.map((entry) => entry.sectionId)));
  for (const sectionId of sectionIds) {
    const rows = await sql`
      select
        id::text,
        coalesce(title_display_names, '{}'::jsonb) as "titleDisplayNames",
        coalesce(subtitle_display_names, '{}'::jsonb) as "subtitleDisplayNames",
        coalesce(body_display_names, '{}'::jsonb) as "bodyDisplayNames",
        coalesce(action_label_display_names, '{}'::jsonb) as "actionLabelDisplayNames",
        coalesce(tag_display_names, '{}'::jsonb) as "tagDisplayNames"
      from brand_site_sections
      where id = ${sectionId}
        and brand_id = ${brandId}
      limit 1
    `;
    const row = rows[0];
    if (!row) continue;
    const titleDisplayNames = normalizeDisplayRecord(row.titleDisplayNames);
    const subtitleDisplayNames = normalizeDisplayRecord(row.subtitleDisplayNames);
    const bodyDisplayNames = normalizeDisplayRecord(row.bodyDisplayNames);
    const actionLabelDisplayNames = normalizeDisplayRecord(row.actionLabelDisplayNames);
    const tagDisplayNames = normalizeDisplayRecord(row.tagDisplayNames);

    for (const entry of entries.filter((candidate) => candidate.sectionId === sectionId)) {
      if (entry.field === "title") titleDisplayNames[entry.language] = entry.suggestedText;
      if (entry.field === "subtitle") subtitleDisplayNames[entry.language] = entry.suggestedText;
      if (entry.field === "body") bodyDisplayNames[entry.language] = entry.suggestedText;
      if (entry.field === "actionLabel") actionLabelDisplayNames[entry.language] = entry.suggestedText;
      if (entry.field === "tag" && entry.tagIndex !== null) {
        const tagRecord = normalizeDisplayRecord(tagDisplayNames[entry.tagIndex]);
        tagRecord[entry.language] = entry.suggestedText;
        tagDisplayNames[entry.tagIndex] = tagRecord;
      }
      updated += 1;
    }

    await sql`
      update brand_site_sections
      set
        title_display_names = ${JSON.stringify(titleDisplayNames)}::jsonb,
        subtitle_display_names = ${JSON.stringify(subtitleDisplayNames)}::jsonb,
        body_display_names = ${JSON.stringify(bodyDisplayNames)}::jsonb,
        action_label_display_names = ${JSON.stringify(actionLabelDisplayNames)}::jsonb,
        tag_display_names = ${JSON.stringify(tagDisplayNames)}::jsonb,
        updated_at = now()
      where id = ${sectionId}
    `;
  }

  return { ok: true, updated };
}
