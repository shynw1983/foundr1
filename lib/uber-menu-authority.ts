import { createHash } from 'node:crypto';

export type UberSourceEntity = {
  id: string; name: string; description: string; imageUrl: string; price: number;
  groupIds: string[];
  groupOverrides?: unknown[];
  contextPrices: { contextType: string; contextId: string; price: number }[];
  quantityInfo?: unknown; suspensionInfo?: unknown; visibility?: unknown; taxInfo?: unknown;
};
export type UberSourceCatalog = {
  version: 1; storeUuid: string; menuId: string; capturedAt: string; updatedAt?: string;
  sections: { id: string; name: string; categoryIds: string[]; hours: unknown; hidden: boolean }[];
  categories: { id: string; name: string; itemIds: string[]; hidden: boolean }[];
  groups: { id: string; name: string; optionIds: string[]; min: number; max: number | null; quantityInfo?: unknown }[];
  entities: UberSourceEntity[];
};

export function validateUberSourceCatalog(value: unknown, storeUuid: string): UberSourceCatalog {
  const catalog = value as UberSourceCatalog;
  if (!catalog || catalog.version !== 1 || catalog.storeUuid !== storeUuid || !catalog.menuId
    || !Number.isFinite(Date.parse(catalog.capturedAt))
    || !Array.isArray(catalog.sections) || !Array.isArray(catalog.categories)
    || !Array.isArray(catalog.groups) || !Array.isArray(catalog.entities)) throw new Error('uber_source_invalid');
  const unique = (rows: { id: string; name: string }[]) => {
    const ids = rows.map(row => row.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length
      || rows.some(row => typeof row.name !== 'string' || !row.name.trim())) throw new Error('uber_source_duplicate_or_missing_id');
    return new Set(ids);
  };
  const entities = unique(catalog.entities), groups = unique(catalog.groups), categories = unique(catalog.categories);
  unique(catalog.sections);
  const references = (ids: string[], known: Set<string>) => {
    if (!Array.isArray(ids) || ids.some(id => !known.has(id)) || new Set(ids).size !== ids.length) throw new Error('uber_source_invalid_reference');
  };
  for (const section of catalog.sections) references(section.categoryIds, categories);
  for (const category of catalog.categories) references(category.itemIds, entities);
  for (const group of catalog.groups) {
    references(group.optionIds, entities);
    if (!Number.isInteger(group.min) || group.min < 0 || (group.max !== null && (!Number.isInteger(group.max) || group.max < group.min))) throw new Error('uber_source_invalid_quantity');
  }
  for (const entity of catalog.entities) {
    references(entity.groupIds, groups);
    if(entity.groupOverrides?.length) throw new Error(`uber_source_context_groups_require_mapping:${entity.id}`);
    if (!Number.isSafeInteger(entity.price) || entity.price < 0 || !Array.isArray(entity.contextPrices)) throw new Error('uber_source_price_invalid');
    const contexts=new Set<string>();
    for (const price of entity.contextPrices) {
      if (!Number.isSafeInteger(price.price) || price.price < 0) throw new Error('uber_source_price_invalid');
      // Uber retains historical overrides for deleted groups. Preserve them in
      // the source snapshot; only the current group ID determines sell price.
      if(price.contextType!=='CUSTOMIZATION_UUID' || typeof price.contextId!=='string' || !price.contextId)throw new Error(`uber_source_price_context_unsupported:${entity.id}`);
      if(contexts.has(price.contextId))throw new Error(`uber_source_ambiguous_price:${entity.id}:${price.contextId}`);
      contexts.add(price.contextId);
    }
  }
  return catalog;
}

export function splitUberName(value: string) {
  const [name = '', zh = '', ko = '', en = ''] = value.split(/[｜|]/u).map(part => part.trim());
  return { name, displayNames: Object.fromEntries(Object.entries({zh, ko, en}).filter(([, text]) => text)) };
}

export function uberContextPrice(entity: UberSourceEntity, groupId = '') {
  const overrides = entity.contextPrices.filter(row => row.contextType === 'CUSTOMIZATION_UUID' && row.contextId === groupId);
  if (overrides.length > 1) throw new Error(`uber_source_ambiguous_price:${entity.id}:${groupId}`);
  return overrides[0]?.price ?? entity.price;
}

export function resolveUberBasePrice(input: { uberPrice: number; currentBasePrice?: number | null; previousUberPrice?: number | null; mode?: 'manual' | 'automatic' }) {
  if (!Number.isSafeInteger(input.uberPrice) || input.uberPrice < 0) throw new Error('uber_source_price_invalid');
  // Existing prices migrate as manual. New products follow the agreed 0.8 / ¥10 rule.
  const mode = input.mode ?? (input.currentBasePrice == null ? 'automatic' : 'manual');
  if (mode === 'manual' && input.currentBasePrice != null) {
    if(!Number.isSafeInteger(input.currentBasePrice)||input.currentBasePrice<0)throw new Error('os_base_price_invalid');
    return {mode, price: input.currentBasePrice};
  }
  return { mode, price: Math.round(input.uberPrice * 0.8 / 10) * 10 };
}

export function authoritativeDeliveryPrice(platform: 'rocket_now' | 'demae_can', uberPrice: number, osPrice: number) {
  const price = platform === 'rocket_now' ? uberPrice : osPrice;
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`authoritative_price_missing:${platform}`);
  return price;
}

export function uberSourceContentHash(catalog: UberSourceCatalog) {
  // Availability is owned by OS. Uber suspension and timestamps must not
  // create content revisions or accidentally restore a hidden item.
  const entities = catalog.entities.map(({ suspensionInfo: _suspension, ...entity }) => entity).sort((a,b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify({menuId: catalog.menuId, sections: catalog.sections,
    categories: [...catalog.categories].sort((a,b) => a.id.localeCompare(b.id)),
    groups: [...catalog.groups].sort((a,b) => a.id.localeCompare(b.id)), entities})).digest('hex');
}

export function confirmedUberRemovals(previous: UberSourceCatalog | null, current: UberSourceCatalog, priorMissing: string[]) {
  if (!previous) return { pending: [], confirmed: [] };
  if (previous.storeUuid !== current.storeUuid || previous.menuId !== current.menuId) throw new Error('uber_source_identity_changed');
  const keys = (catalog: UberSourceCatalog) => [
    ...catalog.entities.map(row => `entity:${row.id}`),
    ...catalog.groups.map(row => `group:${row.id}`),
    ...catalog.categories.map(row => `category:${row.id}`)
  ];
  const present = new Set(keys(current));
  const pending = [...new Set([...keys(previous).filter(key => !present.has(key)), ...priorMissing.filter(key => !present.has(key))])];
  // Two independent complete reads, at least one minute apart. Retrying the
  // same HTTP acknowledgement cannot count as a second observation.
  const independent = Date.parse(current.capturedAt) - Date.parse(previous.capturedAt) >= 60_000;
  return {pending, confirmed: independent ? pending.filter(key => priorMissing.includes(key)) : []};
}
