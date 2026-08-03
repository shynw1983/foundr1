import {
  findMaamaaProductionRule,
  maamaaProductionRules
} from "./maamaa-production-rules.ts";

export type UberInventoryOptionRow = {
  id: string;
  brandId: string;
  groupKey: string;
  optionKey: string;
  externalId: string;
  name: string;
  displayNames: Record<string, unknown> | null;
  isAvailable: boolean;
};

export type UberInventoryTarget = {
  kind: "option";
  targetId: string;
  menuOptionId: string;
  brandId: string;
  groupKey: string;
  optionKey: string;
  inventoryKey: string;
  label: string;
  aliases: string[];
  isAvailable: boolean;
};

export type UberInventoryItemRow = {
  id: string;
  brandId: string;
  externalId: string;
  name: string;
  displayNames: Record<string, unknown> | null;
  isAvailable: boolean;
};

export type UberInventoryItemTarget = {
  kind: "item";
  targetId: string;
  menuCatalogItemId: string;
  brandId: string;
  inventoryKey: string;
  label: string;
  aliases: string[];
  isAvailable: boolean;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, "")
    .replace(/に?(?:変更|変更)|追加|冷凍|乾燥/g, "")
    .replace(/(?:約)?\d+(?:\.\d+)?\s*(?:g|kg|個|枚|本|袋|パック|杯|人前|ヶ|个|张|根|包|份)/g, "")
    .replace(/[\s\u3000・·|｜()[\]（）「」『』【】"'’“”.,。、:：;；!！?？\-_/\\🔥⚡️🏮🤲❗✨👈🤫🥜]/g, "")
    .trim();
}

function cleanKitchenLabel(value: unknown) {
  return String(value ?? "")
    .replace(/^\s*[・-]\s*/, "")
    .replace(/^(?:麺|面|具材|食材)\s*[:：]\s*/u, "")
    .trim();
}

function canonicalInventoryKey(value: unknown) {
  let key = String(value ?? "").trim().toLowerCase();
  key = key.replace(/^replace-/, "");
  if (key === "extra-wide-harusame" || key === "wide-harusame-extra") return "wide-harusame";
  return key;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function optionAliases(row: Pick<UberInventoryOptionRow, "name" | "displayNames">) {
  const displayNames = row.displayNames && typeof row.displayNames === "object"
    ? Object.values(row.displayNames).map(String)
    : [];
  return unique([row.name, ...displayNames]);
}

export function resolveUberInventoryTargets(
  ingredientLabel: string,
  rows: UberInventoryOptionRow[]
) {
  const cleanedLabel = cleanKitchenLabel(ingredientLabel);
  const rule = findMaamaaProductionRule(cleanedLabel, maamaaProductionRules);
  const rawRuleKey = rule?.id ?? "";
  const inventoryKey = canonicalInventoryKey(rawRuleKey || normalize(cleanedLabel));
  const ruleAliases = unique([
    cleanedLabel,
    rule?.customerName ?? "",
    rule?.kitchenName ?? "",
    ...(rule?.aliases ?? [])
  ]);
  const normalizedRuleAliases = ruleAliases.map(normalize).filter((value) => value.length >= 2);
  const noodleRule = rule?.section === "noodles";

  const targets = rows.flatMap((row) => {
    const rowKey = canonicalInventoryKey(row.externalId || row.optionKey);
    const aliases = optionAliases(row);
    const normalizedAliases = aliases.map(normalize).filter((value) => value.length >= 2);
    const keyMatches = Boolean(rawRuleKey) && rowKey === inventoryKey;
    const nameMatches = normalizedRuleAliases.some((ruleAlias) =>
      normalizedAliases.some((alias) => alias === ruleAlias || alias.includes(ruleAlias))
    );
    const isNoodleGroup = /noodle|麺|面/i.test(row.groupKey);
    const hasStableDifferentKey = Boolean(rawRuleKey)
      && Boolean(rowKey)
      && !rowKey.startsWith("option-")
      && rowKey !== inventoryKey;
    if (!(keyMatches || (!hasStableDifferentKey && nameMatches)) || (noodleRule && !isNoodleGroup)) return [];
    return [{
      kind: "option",
      targetId: row.id,
      menuOptionId: row.id,
      brandId: row.brandId,
      groupKey: row.groupKey,
      optionKey: row.optionKey,
      inventoryKey,
      label: row.name,
      aliases,
      isAvailable: row.isAvailable
    } satisfies UberInventoryTarget];
  });

  return {
    inventoryKey,
    ingredientLabel: rule?.kitchenName || cleanedLabel,
    targets
  };
}

export function resolveUberInventoryItemTarget(
  itemLabel: string,
  rows: UberInventoryItemRow[]
) {
  const cleanedLabel = cleanKitchenLabel(itemLabel);
  const normalizedLabel = normalize(cleanedLabel);
  const matches = rows.flatMap((row) => {
    const aliases = optionAliases(row);
    const normalizedAliases = aliases.map(normalize).filter((value) => value.length >= 2);
    const exactMatch = normalizedAliases.some((alias) => alias === normalizedLabel);
    const containedMatches = normalizedAliases.filter((alias) =>
      normalizedLabel.includes(alias) || alias.includes(normalizedLabel)
    );
    const matchLength = exactMatch
      ? 10000 + normalizedLabel.length
      : Math.max(0, ...containedMatches.map((alias) => Math.min(alias.length, normalizedLabel.length)));
    return matchLength ? [{ row, aliases, matchLength }] : [];
  });
  const strongestLength = Math.max(0, ...matches.map((match) => match.matchLength));
  const strongest = matches.filter((match) => match.matchLength === strongestLength);
  const target = strongest.length === 1 ? strongest[0] : null;
  const inventoryKey = target
    ? `item:${target.row.externalId || target.row.id}`
    : `item:${normalizedLabel}`;

  return {
    inventoryKey,
    ingredientLabel: cleanedLabel,
    targets: target ? [{
      kind: "item",
      targetId: target.row.id,
      menuCatalogItemId: target.row.id,
      brandId: target.row.brandId,
      inventoryKey,
      label: target.row.name,
      aliases: target.aliases,
      isAvailable: target.row.isAvailable
    } satisfies UberInventoryItemTarget] : []
  };
}
