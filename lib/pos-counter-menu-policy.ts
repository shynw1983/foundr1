export type PosCounterMenuPolicy = {
  sharedMenuForTakeout: boolean;
  standardTaxCategoryIds: string[];
  takeoutRestrictedCategoryIds: string[];
};

export const defaultPosCounterMenuPolicy: PosCounterMenuPolicy = {
  sharedMenuForTakeout: false, standardTaxCategoryIds: [], takeoutRestrictedCategoryIds: []
};

function uuidList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)))].sort()
    : [];
}

export function normalizePosCounterMenuPolicy(value: unknown): PosCounterMenuPolicy {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const standardTaxCategoryIds = uuidList(input.standardTaxCategoryIds);
  const standard = new Set(standardTaxCategoryIds);
  return {
    sharedMenuForTakeout: input.sharedMenuForTakeout === true,
    standardTaxCategoryIds,
    takeoutRestrictedCategoryIds: uuidList(input.takeoutRestrictedCategoryIds).filter(id => standard.has(id))
  };
}

export function usesLocalPosMenu(orderType: string, policy: PosCounterMenuPolicy) {
  return orderType === 'eat_in' || orderType === 'takeout' && policy.sharedMenuForTakeout;
}

type CounterItemFlags = { counterStandardTax?: boolean; counterTakeoutRestricted?: boolean };

export function getPosCounterItemFlags(policy: PosCounterMenuPolicy, categories: readonly {id: string; brandId: string; name: string}[]) {
  const standard = new Set(policy.standardTaxCategoryIds);
  const restricted = new Set(policy.takeoutRestrictedCategoryIds);
  const key = (brandId: string, category: string) => `${brandId}\0${category}`;
  const byCategory = new Map(categories.map(category => [key(category.brandId, category.name), category.id]));
  return (item: { brandId: string; category: string }): CounterItemFlags => {
    if (!policy.sharedMenuForTakeout) return {};
    const id = byCategory.get(key(item.brandId, item.category)) || '';
    return { counterStandardTax: standard.has(id), counterTakeoutRestricted: restricted.has(id) };
  };
}
