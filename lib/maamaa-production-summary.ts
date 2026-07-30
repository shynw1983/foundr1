import {
  findMaamaaCommonSetRule,
  findMaamaaProductionRule,
  findMaamaaSetRule,
  formatMaamaaProductionRule,
  formatMaamaaSeasoningSelection,
  type MaamaaProductionReferenceSettings
} from "./maamaa-production-rules.ts";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function uniqueTextParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function countRawLabels(labels: string[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const label of labels) {
    const normalized = normalizeText(label);
    if (!normalized) continue;
    const current = counts.get(normalized) ?? { label: normalized, count: 0 };
    current.count += 1;
    counts.set(normalized, current);
  }
  return Array.from(counts.values());
}

export function buildMaamaaProductionItemLines(row: {
  itemName: string;
  quantity: number;
  toppingLabels: string[] | null;
}, settings: MaamaaProductionReferenceSettings) {
  const toppingLabels = Array.isArray(row.toppingLabels) ? row.toppingLabels : [];
  const seasoningLines: string[] = [];
  const ingredientEntries = new Map<string, {
    label: string;
    count: number;
    rule?: ReturnType<typeof findMaamaaProductionRule>;
    kind: "麺" | "具材";
  }>();
  const isSetMenu = Boolean(findMaamaaSetRule(row.itemName, settings.setRules));
  const commonSetRule = isSetMenu ? findMaamaaCommonSetRule(settings.setRules) : undefined;
  const toppingCounts = countRawLabels(toppingLabels);
  const hasReplacementNoodle = toppingCounts.some(({ label }) => {
    const rule = findMaamaaProductionRule(label, settings.productionRules);
    return rule?.section === "noodles"
      && rule.id !== "wide-harusame"
      && rule.id !== "wide-harusame-extra";
  });

  function addIngredient(entry: {
    key: string;
    label: string;
    count: number;
    rule?: ReturnType<typeof findMaamaaProductionRule>;
    kind?: "麺" | "具材";
  }) {
    if (!entry.count) return;
    const current = ingredientEntries.get(entry.key);
    ingredientEntries.set(entry.key, {
      label: entry.label,
      count: (current?.count ?? 0) + entry.count,
      rule: entry.rule ?? current?.rule,
      kind: entry.kind ?? current?.kind ?? "具材"
    });
  }

  for (const defaultItem of commonSetRule?.defaultItems ?? []) {
    const normalized = normalizeText(defaultItem).replace(/\s+/g, "");
    if (!normalized) continue;
    if (/板春雨|宽粉/.test(normalized)) {
      if (hasReplacementNoodle) continue;
      const rule = settings.productionRules.find((candidate) => candidate.id === "wide-harusame")
        ?? findMaamaaProductionRule("もちもち板春雨", settings.productionRules);
      addIngredient({
        key: "wide-harusame",
        label: rule?.kitchenName ?? "板春雨",
        count: row.quantity,
        rule,
        kind: "麺"
      });
      continue;
    }
    if (/黒キクラゲ|黑木耳/.test(normalized)) {
      const rule = settings.productionRules.find((candidate) => candidate.id === "wood-ear")
        ?? findMaamaaProductionRule("黒キクラゲ", settings.productionRules);
      addIngredient({
        key: "wood-ear",
        label: rule?.kitchenName ?? "黒キクラゲ",
        count: row.quantity,
        rule
      });
      continue;
    }
    if (/根菜/.test(normalized)) {
      addIngredient({ key: "set-root-vegetables", label: "セット根菜", count: row.quantity });
      continue;
    }
    if (/キノコ|きのこ|菌菇/.test(normalized)) {
      addIngredient({ key: "set-mushrooms", label: "セットきのこ", count: row.quantity });
      continue;
    }
    if (/チンゲン菜|青梗菜|青菜/.test(normalized)) {
      addIngredient({ key: "set-greens", label: "セット青菜", count: row.quantity });
      continue;
    }
    addIngredient({
      key: `set:${normalized}`,
      label: defaultItem,
      count: row.quantity
    });
  }

  for (const { label, count: rawCount } of toppingCounts) {
    const count = rawCount * Math.max(1, row.quantity);
    const seasoningLine = formatMaamaaSeasoningSelection(label, settings.seasoningRules);
    if (seasoningLine) {
      seasoningLines.push(seasoningLine);
      continue;
    }
    const rule = findMaamaaProductionRule(label, settings.productionRules);
    if (rule) {
      if (rule.id === "wide-harusame" && ingredientEntries.has("wide-harusame")) continue;
      if (rule.id === "wide-harusame-extra") {
        const baseRule = settings.productionRules.find((candidate) => candidate.id === "wide-harusame") ?? rule;
        addIngredient({
          key: "wide-harusame",
          label: baseRule.kitchenName,
          count,
          rule: baseRule,
          kind: "麺"
        });
        continue;
      }
      addIngredient({
        key: rule.id || `${rule.section}:${rule.kitchenName}`,
        label: rule.kitchenName,
        count,
        rule,
        kind: rule.section === "noodles" ? "麺" : "具材"
      });
    } else {
      addIngredient({
        key: `fallback:${label}`,
        label,
        count
      });
    }
  }

  const kitchenLines = Array.from(ingredientEntries.values()).map((entry) => (
    `${entry.kind}：${entry.rule
      ? formatMaamaaProductionRule(entry.rule, entry.count)
      : `${entry.label}${entry.count > 1 ? ` x${entry.count}` : ""}`}`
  ));

  return [
    `${row.itemName} x${row.quantity}`,
    ...uniqueTextParts([...seasoningLines, ...kitchenLines]).map((detail) => `・${detail}`)
  ];
}
