/** Store-owned groups use their saved selection rules. Shared brand groups keep
 * the identified legacy POS semantics until their own catalog is migrated. */
type Group = { groupKey: string; selectionType: string; ruleJson?: Record<string, unknown>; sourceGroupId?: string; localKind?: string };
export function isStoreDineInSelection(group: Group) {
  return Object.hasOwn(group, 'sourceGroupId') || Boolean(group.localKind);
}
export function getPosOptionSelectionType(group: Group) {
  if (isStoreDineInSelection(group)) return ['single', 'multiple', 'quantity'].includes(group.selectionType) ? group.selectionType : 'single';
  if (group.selectionType === 'quantity') return 'quantity';
  if (['size', 'temperature', 'sweetness', 'ice', 'option'].includes(group.groupKey)) return 'single';
  if (group.groupKey === 'topping') return 'multiple';
  return group.selectionType || 'single';
}
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function getPosOptionSelectionRules(group: Group) {
  const type = getPosOptionSelectionType(group), rules = group.ruleJson || {};
  if (!isStoreDineInSelection(group)) {
    const legacyLimit = Number(rules.limit);
    const max = Number.isFinite(legacyLimit) ? Math.max(0, Math.floor(legacyLimit)) : type === 'single' ? 1 : 99;
    return { type, min: Math.max(0, Number(rules.minSelections) || 0), max, perOptionMax: type === 'quantity' ? max : 1 };
  }
  // Both recognized bounds constrain an imported local group. This also preserves
  // an upstream maximum when a source used maxSelections rather than limit.
  const limits = [count(rules.limit), ...(isStoreDineInSelection(group) ? [count(rules.maxSelections)] : [])].filter((value): value is number => value !== null);
  const max = type === 'single' ? Math.min(1, ...limits) : limits.length ? Math.min(...limits) : 99;
  const min = count(rules.minSelections) ?? 0;
  const perOptionMax = type !== 'quantity' || rules.allowRepeat === false ? 1 : Math.min(count(rules.perOptionMax) ?? max, max);
  return { type, min, max, perOptionMax };
}
