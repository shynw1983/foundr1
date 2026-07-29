type CustomizationOption = {
  id: string;
  externalId?: string;
  optionKey?: string;
};

type CustomizationGroup<TOption extends CustomizationOption> = {
  id: string;
  externalId?: string;
  groupKey?: string;
  name?: string;
  label?: string;
  displayNames?: Record<string, string>;
  selectionType?: string;
  minSelections?: number;
  maxSelections?: number;
  allowRepeat?: boolean;
  perOptionMax?: number;
  ruleJson?: Record<string, unknown>;
  options: TOption[];
};

function groupName(group: CustomizationGroup<CustomizationOption>) {
  return String(group.name || group.label || "").trim();
}

function numericRule(
  group: CustomizationGroup<CustomizationOption>,
  key: "minSelections" | "maxSelections" | "perOptionMax"
) {
  return Math.max(0, Number(group[key] ?? group.ruleJson?.[key]) || 0);
}

function repeatRule(group: CustomizationGroup<CustomizationOption>) {
  return (group.allowRepeat ?? group.ruleJson?.allowRepeat) === true;
}

function effectiveMaximum(group: CustomizationGroup<CustomizationOption>) {
  const configured = numericRule(group, "maxSelections");
  if (configured > 0) return configured;
  return group.selectionType === "multiple" ? group.options.length : 1;
}

function optionIdentity(option: CustomizationOption) {
  return String(option.optionKey || option.externalId || option.id);
}

export function mergeDuplicateToppingGroups<
  TOption extends CustomizationOption,
  TGroup extends CustomizationGroup<TOption>
>(groups: TGroup[]): TGroup[] {
  const toppingGroups = groups.filter((group) => groupName(group) === "トッピング");
  if (toppingGroups.length < 2) return groups;

  const options: TOption[] = [];
  const optionKeys = new Set<string>();
  for (const group of toppingGroups) {
    for (const option of group.options) {
      const key = optionIdentity(option);
      if (optionKeys.has(key)) continue;
      optionKeys.add(key);
      options.push(option);
    }
  }

  const first = toppingGroups[0];
  const minSelections = toppingGroups.reduce((sum, group) => sum + numericRule(group, "minSelections"), 0);
  const requestedMaximum = toppingGroups.reduce((sum, group) => sum + effectiveMaximum(group), 0);
  const allowRepeat = toppingGroups.some(repeatRule);
  const maxSelections = allowRepeat ? requestedMaximum : Math.min(requestedMaximum, options.length);
  const perOptionMax = Math.max(...toppingGroups.map((group) => numericRule(group, "perOptionMax")));
  const sourceIds = toppingGroups.map((group) => group.id);
  const mergedId = `merged-topping:${sourceIds.join(":")}`;
  const mergedGroupKey = `merged-topping:${toppingGroups
    .map((group) => group.groupKey || group.externalId || group.id)
    .join(":")}`;
  const merged = {
    ...first,
    id: mergedId,
    externalId: mergedId,
    groupKey: mergedGroupKey,
    selectionType: maxSelections > 1 ? "multiple" : "single",
    minSelections,
    maxSelections,
    allowRepeat,
    perOptionMax,
    ruleJson: {
      ...(first.ruleJson || {}),
      rawName: "トッピング",
      minSelections,
      maxSelections,
      allowRepeat,
      perOptionMax,
      mergedGroupIds: sourceIds
    },
    options
  } as TGroup;

  let inserted = false;
  return groups.flatMap((group) => {
    if (groupName(group) !== "トッピング") return [group];
    if (inserted) return [];
    inserted = true;
    return [merged];
  });
}
