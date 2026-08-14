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
  const key = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    "replace-corn-noodle": "corn-noodle",
    "cold-corn-noodles": "corn-noodle",
    "replace-harusame": "harusame",
    "cold-glass-noodles": "harusame",
    "replace-sweet-potato-noodle": "sweet-potato-noodle",
    "cold-sweet-potato-noodles": "sweet-potato-noodle",
    "replace-rice-noodle": "rice-noodle",
    "cold-rice-noodles": "rice-noodle",
    "replace-beef-noodle": "beef-noodle",
    "cold-niujin-noodles": "beef-noodle",
    "replace-yam-noodle": "yam-noodle",
    "cold-yam-noodles": "yam-noodle",
    "replace-wide-sweet-potato-noodle": "wide-sweet-potato-noodle",
    "cold-wide-sweet-potato-noodles": "wide-sweet-potato-noodle",
    "replace-kishimen": "kishimen",
    "cold-kishimen": "kishimen",
    "option-dcafe1ea": "kishimen",
    "replace-knife-shaved-noodle": "knife-shaved-noodle",
    "cold-knife-shaved-noodles": "knife-shaved-noodle",
    "replace-extra-wide-harusame": "wide-harusame",
    "extra-wide-harusame": "wide-harusame",
    "wide-harusame-extra": "wide-harusame",
    "cold-wide-glass-noodles": "wide-harusame",
    "replace-round-yam-sheet": "round-yam-sheet",
    "replace-soybean-sprouts-noodle": "soybean-sprouts-noodle",
    "replace-tteokbokki": "tteokbokki"
  };
  return aliases[key] ?? key;
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
  const normalizedInput = normalize(cleanedLabel);
  const preparedRows = rows.map((row) => {
    const aliases = optionAliases(row);
    return {
      row,
      aliases,
      normalizedAliases: aliases.map(normalize).filter((value) => value.length >= 2),
      canonicalKey: canonicalInventoryKey(row.externalId || row.optionKey)
    };
  });
  const exactRows = preparedRows.filter(({ normalizedAliases }) =>
    normalizedAliases.some((alias) => alias === normalizedInput)
  );
  if (exactRows.length) {
    const exactKeys = new Set(exactRows.map(({ canonicalKey }) => canonicalKey).filter(Boolean));
    const inventoryKey = exactKeys.size === 1 ? [...exactKeys][0] : normalizedInput;
    const selectedRows = exactKeys.size === 1
      ? preparedRows.filter(({ canonicalKey }) => exactKeys.has(canonicalKey))
      : exactRows;
    return {
      inventoryKey,
      ingredientLabel: cleanedLabel,
      targets: selectedRows.map(({ row, aliases }) => ({
        kind: "option" as const,
        targetId: row.id,
        menuOptionId: row.id,
        brandId: row.brandId,
        groupKey: row.groupKey,
        optionKey: row.optionKey,
        inventoryKey,
        label: row.name,
        aliases,
        isAvailable: row.isAvailable
      }))
    };
  }
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

  const targets = preparedRows.flatMap(({ row, aliases, normalizedAliases, canonicalKey: rowKey }) => {
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
