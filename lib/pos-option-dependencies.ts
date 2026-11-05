import { getPosOptionSelectionRules } from './dine-in-option-selection';

type Selection = Record<string, string[]>;
type Group = { id: string; groupKey: string; selectionType: string; ruleJson?: Record<string, unknown>; sourceGroupId?: string; localKind?: string;
  options: { id: string; optionKey?: string; name?: string }[] };

/** Dependencies reference store-owned IDs, never translated names or a store name. */
export function isPosOptionAllowed(group: { ruleJson?: Record<string, unknown> }, optionId: string, selection: Selection): boolean {
  const requirements = group.ruleJson?.optionRequirements;
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return requirements === undefined;
  if (!Object.hasOwn(requirements, optionId)) return true;
  const rule = (requirements as Record<string, unknown>)[optionId];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const { groupId, optionIds } = rule as { groupId?: unknown; optionIds?: unknown };
  return typeof groupId === 'string' && Array.isArray(optionIds) && optionIds.length > 0
    && optionIds.every(id => typeof id === 'string')
    && (selection[groupId] || []).some(id => optionIds.includes(id));
}

/** Changing the controlling choice removes invalid choices in the same React update. */
export function reconcilePosOptionDependencies(groups: Group[], selection: Selection, previous?: Selection): Selection {
  let next = selection;
  for (const group of groups) {
    // Apply a conditional default only on entry into its condition. Subsequent
    // manual heat/numb changes must remain intact while the soup stays the same.
    if (getPosOptionSelectionRules(group).type === 'single') {
      const requirements = group.ruleJson?.optionRequirements;
      const automatic = group.options.find(option => {
        if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return false;
        const rule = (requirements as Record<string, unknown>)[option.id];
        return Boolean(rule && typeof rule === 'object' && !Array.isArray(rule)
          && (rule as Record<string, unknown>).selectOnMatch === true
          && isPosOptionAllowed(group, option.id, next)
          && (!previous || !isPosOptionAllowed(group, option.id, previous)));
      });
      if (automatic && (next[group.id]?.length !== 1 || next[group.id][0] !== automatic.id)) {
        next = { ...next, [group.id]: [automatic.id] };
      }
    }
    const current = next[group.id] || [];
    const available = group.options.filter(option => isPosOptionAllowed(group, option.id, next));
    const valid = current.filter(id => available.some(option => option.id === id));
    if (valid.length === current.length) continue;
    if (getPosOptionSelectionRules(group).type === 'single' && getPosOptionSelectionRules(group).min > 0 && !valid.length) {
      const configured = group.ruleJson?.defaultOptionKey;
      const fallback = available.find(option => [option.id, option.optionKey, option.name].includes(String(configured || ''))) || available[0];
      if (fallback) valid.push(fallback.id);
    }
    next = { ...next, [group.id]: valid };
  }
  return next;
}
