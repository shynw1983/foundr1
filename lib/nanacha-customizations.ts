import type { NanachaCustomizationGroup } from "./nanacha-compatible-menu";

export type ValidatedCustomization = {
  groupId: string;
  groupKey: string;
  groupName: string;
  selectionType: string;
  optionIds: string[];
  optionKeys: string[];
  optionLabels: string[];
  optionPrices: number[];
  price: number;
};

export function validateStructuredCustomizations(rawValue: unknown, groups: NanachaCustomizationGroup[]) {
  const requested = Array.isArray(rawValue) ? rawValue : [];
  const requestedByGroupId = new Map<string, string[]>();
  for (const entry of requested) {
    if (!entry || typeof entry !== "object") return null;
    const raw = entry as Record<string, unknown>;
    const groupId = String(raw.groupId || "");
    if (!groupId || requestedByGroupId.has(groupId)) return null;
    requestedByGroupId.set(groupId, Array.isArray(raw.optionIds) ? raw.optionIds.map(String) : []);
  }
  if (Array.from(requestedByGroupId.keys()).some((groupId) => !groups.some((group) => group.id === groupId))) {
    return null;
  }

  const validated: ValidatedCustomization[] = [];
  for (const group of groups) {
    const optionIds = requestedByGroupId.get(group.id) ?? [];
    const maximum = group.maxSelections > 0
      ? group.maxSelections
      : group.selectionType === "single"
        ? 1
        : Number.POSITIVE_INFINITY;
    if (optionIds.length < group.minSelections || optionIds.length > maximum) return null;
    if (group.selectionType === "single" && optionIds.length > 1) return null;
    if (!group.allowRepeat && new Set(optionIds).size !== optionIds.length) return null;

    const counts = new Map<string, number>();
    for (const optionId of optionIds) {
      counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    }
    if (
      group.perOptionMax > 0 &&
      Array.from(counts.values()).some((count) => count > group.perOptionMax)
    ) {
      return null;
    }

    const selectedOptions = optionIds.map((optionId) => group.options.find((option) => option.id === optionId));
    if (selectedOptions.some((option) => !option)) return null;
    if (!selectedOptions.length) continue;
    validated.push({
      groupId: group.id,
      groupKey: group.groupKey || group.externalId || group.id,
      groupName: group.label,
      selectionType: group.selectionType,
      optionIds,
      optionKeys: selectedOptions.map((option) => option?.optionKey || option?.externalId || option?.id || ""),
      optionLabels: selectedOptions.map((option) => option?.label || ""),
      optionPrices: selectedOptions.map((option) => option?.price ?? 0),
      price: selectedOptions.reduce((sum, option) => sum + (option?.price ?? 0), 0)
    });
  }
  return validated;
}
