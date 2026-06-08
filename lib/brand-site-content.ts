import type { EmployeeSession } from "./auth";
import { sql } from "./db";
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

const editorRoles = new Set(["owner", "manager"]);

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
    body: "ご注文を受けてから、一杯ずつ仕上げる麻辣湯。まぁ麻は、熱さ、香り、具材の食感まで、出来立てのおいしさを届けます。",
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
    title: "作り置きではなく、注文ごとに仕上げる。",
    subtitle: "Brand concept",
    body: "まぁ麻の麻辣湯は、大きな鍋でまとめて煮込むスタイルではありません。注文を受けてから具材とスープを合わせ、一杯ずつ出来立てでお渡しします。",
    tags: ["注文ごと", "出来立て", "香り"],
    sortOrder: 20
  },
  {
    pageKey: "home",
    sectionKey: "build-a-bowl",
    sectionType: "card_group",
    title: "選べる楽しさと、出来立ての安心感。",
    subtitle: "Build a bowl",
    body: "野菜、きのこ、豆腐、ミートボール、春雨、麺を気分に合わせて選び、辛さ、しびれ、香酢、トッピングを自分らしく調整できます。",
    tags: ["Made fresh", "Select", "Balance"],
    fields: {
      cards: [
        { title: "Made fresh", body: "注文を受けてから一杯ずつ調理。作り置きではない、出来立ての温度感。" },
        { title: "Select", body: "野菜、きのこ、豆腐、ミートボール、春雨、麺を気分に合わせて。" },
        { title: "Balance", body: "辛さ、しびれ、香酢、トッピングを自分らしく調整。" }
      ]
    },
    sortOrder: 30
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    sectionType: "store_group",
    title: "出来立てを受け取る店から、店内で味わう店へ。",
    subtitle: "Shop information",
    body: "現在営業中の清水店と、店内でも出来立ての麻辣湯を楽しめるイートイン対応店舗の準備状況を案内します。",
    actionLabel: "清水店の受け取り予約",
    actionUrl: "/stores/shimizu/menu",
    tags: ["1st store", "まぁ麻 清水店", "2nd store", "イートイン店"],
    sortOrder: 40
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    sectionType: "hero",
    title: "清水店の出来立て麻辣湯を、自由にカスタム。",
    subtitle: "Shimizu shop / pickup reservation",
    body: "まぁ麻 清水店の店頭受け取り用カスタムメニューを作成できます。辛さ、痺れ、麺、トッピングを選んで、受け取り時間を指定してください。",
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
    body: "出来立て麻辣湯 for delivery, pickup, and dine-in.",
    actionLabel: "Contact",
    actionUrl: "mailto:hello@maamaa.example",
    tags: ["特定商取引法に基づく表記", "利用規約", "プライバシーポリシー"],
    sortOrder: 10
  }
];

export function canEditBrandSiteContent(session: EmployeeSession) {
  return editorRoles.has(session.role);
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

  const [brands, sections] = await Promise.all([
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
    `
  ]);

  return { brands, sections };
}

export async function upsertBrandSiteSection(body: Record<string, unknown>) {
  const id = cleanId(body.id);
  const brandId = cleanId(body.brandId);
  const pageKey = cleanText(body.pageKey, 80);
  const sectionKey = cleanText(body.sectionKey, 120);
  if (!brandId || !pageKey || !sectionKey) throw new Error("ブランド、ページ、板块キーを入力してください。");

  const tags = normalizeTags(body.tags);
  const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
    ? body.fields as Record<string, unknown>
    : {};

  const rows = id
    ? await sql`
        update brand_site_sections
        set
          brand_id = ${brandId},
          page_key = ${pageKey},
          section_key = ${sectionKey},
          section_type = ${cleanText(body.sectionType, 80) || "content"},
          title = ${cleanText(body.title, 500)},
          subtitle = ${cleanText(body.subtitle, 500)},
          body = ${cleanText(body.body)},
          image_url = ${cleanText(body.imageUrl, 1000)},
          image_alt = ${cleanText(body.imageAlt, 500)},
          action_label = ${cleanText(body.actionLabel, 300)},
          action_url = ${cleanText(body.actionUrl, 1000)},
          tags = ${JSON.stringify(tags)}::jsonb,
          fields = ${JSON.stringify(fields)}::jsonb,
          title_display_names = ${JSON.stringify(normalizeDisplayRecord(body.titleDisplayNames))}::jsonb,
          subtitle_display_names = ${JSON.stringify(normalizeDisplayRecord(body.subtitleDisplayNames))}::jsonb,
          body_display_names = ${JSON.stringify(normalizeDisplayRecord(body.bodyDisplayNames))}::jsonb,
          action_label_display_names = ${JSON.stringify(normalizeDisplayRecord(body.actionLabelDisplayNames))}::jsonb,
          tag_display_names = ${JSON.stringify(normalizeDisplayRecord(body.tagDisplayNames))}::jsonb,
          sort_order = ${Math.max(0, Math.round(Number(body.sortOrder) || 100))},
          is_active = ${body.isActive !== false},
          updated_at = now()
        where id = ${id}
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
          ${brandId},
          ${pageKey},
          ${sectionKey},
          ${cleanText(body.sectionType, 80) || "content"},
          ${cleanText(body.title, 500)},
          ${cleanText(body.subtitle, 500)},
          ${cleanText(body.body)},
          ${cleanText(body.imageUrl, 1000)},
          ${cleanText(body.imageAlt, 500)},
          ${cleanText(body.actionLabel, 300)},
          ${cleanText(body.actionUrl, 1000)},
          ${JSON.stringify(tags)}::jsonb,
          ${JSON.stringify(fields)}::jsonb,
          ${JSON.stringify(normalizeDisplayRecord(body.titleDisplayNames))}::jsonb,
          ${JSON.stringify(normalizeDisplayRecord(body.subtitleDisplayNames))}::jsonb,
          ${JSON.stringify(normalizeDisplayRecord(body.bodyDisplayNames))}::jsonb,
          ${JSON.stringify(normalizeDisplayRecord(body.actionLabelDisplayNames))}::jsonb,
          ${JSON.stringify(normalizeDisplayRecord(body.tagDisplayNames))}::jsonb,
          ${Math.max(0, Math.round(Number(body.sortOrder) || 100))},
          ${body.isActive !== false},
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
