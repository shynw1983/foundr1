export type KitchenDisplayItemGroup = {
  itemName: string;
  quantity: number;
  amount: number;
  options: Array<{
    label: string;
    count: number;
    amount: number;
  }>;
  productionLines: string[];
};

type OrderedKitchenItem = {
  itemName?: unknown;
  quantity?: unknown;
  itemAmount?: unknown;
  toppingLabels?: unknown;
  toppingAmounts?: unknown;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function countLabels(value: unknown, amountValue: unknown) {
  if (!Array.isArray(value)) return [];
  const amounts = Array.isArray(amountValue) ? amountValue : [];
  const counts = new Map<string, { label: string; count: number; amount: number }>();
  for (let index = 0; index < value.length; index += 1) {
    const rawLabel = value[index];
    const label = normalizeText(rawLabel);
    if (!label) continue;
    const current = counts.get(label) ?? { label, count: 0, amount: 0 };
    current.count += 1;
    const amount = Number(amounts[index] ?? 0);
    if (Number.isFinite(amount)) current.amount += amount;
    counts.set(label, current);
  }
  return Array.from(counts.values());
}

function splitProductionGroups(summary: string) {
  const groups: Array<{ itemName: string; productionLines: string[] }> = [];
  for (const rawLine of String(summary ?? "").split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("・") || line.startsWith("- ")) {
      const current = groups.at(-1);
      if (current) current.productionLines.push(line);
      continue;
    }
    groups.push({
      itemName: line.replace(/\s+x\d+(?:（.*）)?$/u, "").trim(),
      productionLines: []
    });
  }
  return groups;
}

export function buildKitchenDisplayItemGroups(
  value: unknown,
  localizedProductionSummary: string
): KitchenDisplayItemGroup[] {
  const orderedItems = Array.isArray(value)
    ? value.filter((item): item is OrderedKitchenItem => Boolean(item) && typeof item === "object")
    : [];
  const productionGroups = splitProductionGroups(localizedProductionSummary);

  if (!orderedItems.length) {
    return productionGroups.map((group) => ({
      itemName: group.itemName,
      quantity: 1,
      amount: 0,
      options: [],
      productionLines: group.productionLines
    }));
  }

  const groups = orderedItems.flatMap((item, index) => {
    const itemName = normalizeText(item.itemName);
    if (!itemName) return [];
    return [{
      itemName,
      quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1) || 1)),
      amount: Number.isFinite(Number(item.itemAmount)) ? Number(item.itemAmount) : 0,
      options: countLabels(item.toppingLabels, item.toppingAmounts),
      productionLines: productionGroups[index]?.productionLines ?? []
    }];
  });

  if (productionGroups.length > groups.length && groups.length) {
    for (const extraGroup of productionGroups.slice(groups.length)) {
      groups[groups.length - 1].productionLines.push(...extraGroup.productionLines);
    }
  }

  return groups;
}
