import type { EmployeeSession } from "./auth";
import { sql } from "./db";

export const menuTranslationLanguages = ["en", "zh", "zh-Hant", "ko", "vi", "ne"] as const;

type MenuTranslationLanguage = typeof menuTranslationLanguages[number];
type MenuTranslationTargetType = "item" | "item_description" | "group" | "option";

export type MenuTranslationDraftEntry = {
  key: string;
  targetType: MenuTranslationTargetType;
  targetId: string;
  field: "displayNames" | "descriptionDisplayNames";
  language: MenuTranslationLanguage;
  sourceText: string;
  currentText: string;
  suggestedText: string;
  targetLabel: string;
};

type TranslationRequestEntry = {
  key: string;
  language: MenuTranslationLanguage;
  sourceText: string;
  targetLabel: string;
  targetType: MenuTranslationTargetType;
};

type OpenAiTranslationResult = {
  key?: unknown;
  text?: unknown;
};

const menuEditorRoles = new Set(["owner", "manager"]);
const targetLanguageLabels: Record<MenuTranslationLanguage, string> = {
  en: "English",
  zh: "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ko: "Korean",
  vi: "Vietnamese",
  ne: "Nepali"
};

export function canEditMenuTranslations(session: EmployeeSession) {
  return menuEditorRoles.has(session.role);
}

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  return id || null;
}

function normalizeLanguages(value: unknown): MenuTranslationLanguage[] {
  const requested = Array.isArray(value) ? value.map((entry) => String(entry).trim()) : [];
  const allowed = requested.filter((entry): entry is MenuTranslationLanguage => menuTranslationLanguages.includes(entry as MenuTranslationLanguage));
  return allowed.length ? allowed : [...menuTranslationLanguages];
}

function normalizeDisplayRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function needsTranslation(currentText: unknown, overwriteExisting: boolean) {
  if (overwriteExisting) return true;
  return !String(currentText ?? "").trim();
}

function buildEntry(input: {
  targetType: MenuTranslationTargetType;
  targetId: string;
  field: "displayNames" | "descriptionDisplayNames";
  language: MenuTranslationLanguage;
  sourceText: string;
  currentText: string;
  targetLabel: string;
}): MenuTranslationDraftEntry {
  return {
    ...input,
    key: `${input.targetType}:${input.targetId}:${input.field}:${input.language}`,
    suggestedText: ""
  };
}

export async function collectMenuTranslationTargets(input: {
  brandId: unknown;
  languages: unknown;
  overwriteExisting?: boolean;
}) {
  const brandId = cleanId(input.brandId);
  if (!brandId) throw new Error("ブランドを選択してください。");

  const languages = normalizeLanguages(input.languages);
  const overwriteExisting = input.overwriteExisting === true;
  const [items, groups, options] = await Promise.all([
    sql`
      select
        id::text,
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        coalesce(description, '') as description,
        coalesce(description_display_names, '{}'::jsonb) as "descriptionDisplayNames"
      from menu_catalog_items
      where brand_id = ${brandId}
        and store_id is null
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames"
      from menu_option_groups
      where brand_id = ${brandId}
      order by sort_order, name
    `,
    sql`
      select
        menu_options.id::text,
        menu_options.name,
        coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
        menu_option_groups.name as "groupName"
      from menu_options
      join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
      where menu_option_groups.brand_id = ${brandId}
      order by menu_option_groups.sort_order, menu_options.sort_order, menu_options.name
    `
  ]);

  const entries: MenuTranslationDraftEntry[] = [];
  for (const item of items) {
    const displayNames = normalizeDisplayRecord(item.displayNames);
    const descriptionDisplayNames = normalizeDisplayRecord(item.descriptionDisplayNames);
    const itemName = String(item.name ?? "").trim();
    const description = String(item.description ?? "").trim();
    if (itemName) {
      for (const language of languages) {
        const currentText = String(displayNames[language] ?? "").trim();
        if (needsTranslation(currentText, overwriteExisting)) {
          entries.push(buildEntry({
            targetType: "item",
            targetId: String(item.id),
            field: "displayNames",
            language,
            sourceText: itemName,
            currentText,
            targetLabel: itemName
          }));
        }
      }
    }
    if (description) {
      for (const language of languages) {
        const currentText = String(descriptionDisplayNames[language] ?? "").trim();
        if (needsTranslation(currentText, overwriteExisting)) {
          entries.push(buildEntry({
            targetType: "item_description",
            targetId: String(item.id),
            field: "descriptionDisplayNames",
            language,
            sourceText: description,
            currentText,
            targetLabel: itemName || "商品説明"
          }));
        }
      }
    }
  }

  for (const group of groups) {
    const displayNames = normalizeDisplayRecord(group.displayNames);
    const groupName = String(group.name ?? "").trim();
    if (!groupName) continue;
    for (const language of languages) {
      const currentText = String(displayNames[language] ?? "").trim();
      if (needsTranslation(currentText, overwriteExisting)) {
        entries.push(buildEntry({
          targetType: "group",
          targetId: String(group.id),
          field: "displayNames",
          language,
          sourceText: groupName,
          currentText,
          targetLabel: groupName
        }));
      }
    }
  }

  for (const option of options) {
    const displayNames = normalizeDisplayRecord(option.displayNames);
    const optionName = String(option.name ?? "").trim();
    if (!optionName) continue;
    for (const language of languages) {
      const currentText = String(displayNames[language] ?? "").trim();
      if (needsTranslation(currentText, overwriteExisting)) {
        entries.push(buildEntry({
          targetType: "option",
          targetId: String(option.id),
          field: "displayNames",
          language,
          sourceText: optionName,
          currentText,
          targetLabel: `${String(option.groupName ?? "").trim() || "選択肢"} / ${optionName}`
        }));
      }
    }
  }

  return entries;
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

export async function generateMenuTranslationPreview(entries: MenuTranslationDraftEntry[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません。");
  if (!entries.length) return { entries, model: process.env.OPENAI_MENU_TRANSLATION_MODEL || "gpt-5.4-mini" };

  const model = process.env.OPENAI_MENU_TRANSLATION_MODEL || "gpt-5.4-mini";
  const suggestedByKey = new Map<string, string>();

  for (const chunk of chunkEntries(entries, 40)) {
    const requestEntries: TranslationRequestEntry[] = chunk.map((entry) => ({
      key: entry.key,
      language: entry.language,
      sourceText: entry.sourceText,
      targetLabel: entry.targetLabel,
      targetType: entry.targetType
    }));
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
                  "You translate restaurant menu data from Japanese into customer-facing menu text.",
                  "Return only a JSON array. Do not include markdown.",
                  "Each output item must be {\"key\":\"...\",\"text\":\"...\"}.",
                  "Use natural, concise wording for menus, option names, and descriptions.",
                  "Keep product identity stable. Translate ingredients and option meanings clearly.",
                  "Treat zh as Simplified Chinese and zh-Hant as Traditional Chinese. Never copy Simplified Chinese into Traditional Chinese.",
                  "For Korean, Vietnamese, and Nepali, use the target language script naturally."
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
                  targetLanguageLabels,
                  entries: requestEntries
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
      output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
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

  return {
    entries: entries.map((entry) => ({ ...entry, suggestedText: suggestedByKey.get(entry.key) ?? "" })),
    model
  };
}

function normalizeAppliedEntries(value: unknown): MenuTranslationDraftEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const targetType = String(source.targetType ?? "") as MenuTranslationTargetType;
    const field = String(source.field ?? "") as "displayNames" | "descriptionDisplayNames";
    const language = String(source.language ?? "") as MenuTranslationLanguage;
    return {
      key: String(source.key ?? ""),
      targetType,
      targetId: String(source.targetId ?? ""),
      field,
      language,
      sourceText: String(source.sourceText ?? ""),
      currentText: String(source.currentText ?? ""),
      suggestedText: String(source.suggestedText ?? "").trim().slice(0, 600),
      targetLabel: String(source.targetLabel ?? "")
    };
  }).filter((entry) => (
    entry.key
    && entry.targetId
    && entry.suggestedText
    && ["item", "item_description", "group", "option"].includes(entry.targetType)
    && ["displayNames", "descriptionDisplayNames"].includes(entry.field)
    && menuTranslationLanguages.includes(entry.language)
  ));
}

export async function applyMenuTranslationEntries(input: {
  brandId: unknown;
  entries: unknown;
}) {
  const brandId = cleanId(input.brandId);
  if (!brandId) throw new Error("ブランドを選択してください。");
  const entries = normalizeAppliedEntries(input.entries);
  if (!entries.length) throw new Error("書き込む翻訳がありません。");

  let updated = 0;
  const itemIds = Array.from(new Set(entries.filter((entry) => entry.targetType === "item" || entry.targetType === "item_description").map((entry) => entry.targetId)));
  for (const id of itemIds) {
    const rows = await sql`
      select
        id::text,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        coalesce(description_display_names, '{}'::jsonb) as "descriptionDisplayNames"
      from menu_catalog_items
      where id = ${id}
        and brand_id = ${brandId}
        and store_id is null
      limit 1
    `;
    const row = rows[0];
    if (!row) continue;
    const displayNames = normalizeDisplayRecord(row.displayNames);
    const descriptionDisplayNames = normalizeDisplayRecord(row.descriptionDisplayNames);
    for (const entry of entries.filter((candidate) => candidate.targetId === id && (candidate.targetType === "item" || candidate.targetType === "item_description"))) {
      if (entry.field === "displayNames") displayNames[entry.language] = entry.suggestedText;
      if (entry.field === "descriptionDisplayNames") descriptionDisplayNames[entry.language] = entry.suggestedText;
      updated += 1;
    }
    await sql`
      update menu_catalog_items
      set
        display_names = ${JSON.stringify(displayNames)}::jsonb,
        description_display_names = ${JSON.stringify(descriptionDisplayNames)}::jsonb,
        updated_at = now()
      where id = ${id}
    `;
  }

  const groupIds = Array.from(new Set(entries.filter((entry) => entry.targetType === "group").map((entry) => entry.targetId)));
  for (const id of groupIds) {
    const rows = await sql`
      select id::text, coalesce(display_names, '{}'::jsonb) as "displayNames"
      from menu_option_groups
      where id = ${id}
        and brand_id = ${brandId}
      limit 1
    `;
    const row = rows[0];
    if (!row) continue;
    const displayNames = normalizeDisplayRecord(row.displayNames);
    for (const entry of entries.filter((candidate) => candidate.targetId === id && candidate.targetType === "group")) {
      displayNames[entry.language] = entry.suggestedText;
      updated += 1;
    }
    await sql`
      update menu_option_groups
      set display_names = ${JSON.stringify(displayNames)}::jsonb,
          updated_at = now()
      where id = ${id}
    `;
  }

  const optionIds = Array.from(new Set(entries.filter((entry) => entry.targetType === "option").map((entry) => entry.targetId)));
  for (const id of optionIds) {
    const rows = await sql`
      select
        menu_options.id::text,
        coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames"
      from menu_options
      join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
      where menu_options.id = ${id}
        and menu_option_groups.brand_id = ${brandId}
      limit 1
    `;
    const row = rows[0];
    if (!row) continue;
    const displayNames = normalizeDisplayRecord(row.displayNames);
    for (const entry of entries.filter((candidate) => candidate.targetId === id && candidate.targetType === "option")) {
      displayNames[entry.language] = entry.suggestedText;
      updated += 1;
    }
    await sql`
      update menu_options
      set display_names = ${JSON.stringify(displayNames)}::jsonb,
          updated_at = now()
      where id = ${id}
    `;
  }

  return { ok: true, updated };
}
