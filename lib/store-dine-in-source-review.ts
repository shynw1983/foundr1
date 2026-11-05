import { getPosOptionSelectionRules } from './dine-in-option-selection';
import { applyDineInChange, isDineInSingleChoiceGroup, getDineInEffectiveItemGroupIds, getDineInGroupItemIds, dineInOptionAppliesToItem, assertDineInLinkedProductChange, isLocalDineInOption, getDineInOptionIdentity, type StoreDineInCatalog, type StoreDineInChange, type StoreDineInGroup, type StoreDineInItem, type StoreDineInOption } from './store-dine-in-menu-policy';

export type SourceReviewField = 'name' | 'price' | 'category' | 'specification' | 'rules' | 'memberships' | 'availability';
export type SourceReviewDecision = { field: SourceReviewField; decision: 'adopt' | 'keep' };
export type SourceReviewBaseline = { sourceId: string; fields: Partial<Record<SourceReviewField, unknown>> };
/** Stored only in the independent catalog; source values never become a publication instruction. */
export type StoreDineInSourceReviewState = {
  version: 1;
  baseline: Record<string, SourceReviewBaseline>;
  decisions: Array<{ key: string; field: SourceReviewField; decision: 'adopt' | 'keep'; sourceRevision: string; employeeId: string; at: string }>;
};
export type SourceReviewFieldChange = {
  field: SourceReviewField; localValue: unknown; previousValue: unknown; sourceValue: unknown;
  baselineKnown: boolean; changed: boolean; canAdopt: boolean; reason?: string;
};
export type SourceReviewEntry = {
  key: string; kind: 'item' | 'group' | 'option'; targetId: string; sourceId: string;
  localName: string; localGroupName?: string; sourceName: string; sourceGroupName?: string;
  status: 'linked' | 'localOnly' | 'missing' | 'new'; initial: boolean; pending: boolean;
  fields: SourceReviewFieldChange[]; importPrice?: number | null; importPriceBasis?: 'fixed' | 'weight' | 'option'; importPriceUnit?: string; networkPrice?: number | null;
};
export type StoreDineInSourceReview = {
  version: 1; sourceRevision: string; initial: boolean; pendingCount: number; entries: SourceReviewEntry[];
};
export type SourceReviewContext = {
  canonical: StoreDineInCatalog; effective: StoreDineInCatalog; sourceRevision: string;
  networkPrices?: Record<string, number | null>;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stable = (value: unknown): string => JSON.stringify(value === undefined ? null : Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(stable(v))])) : value);
const same = (left: unknown, right: unknown) => stable(left) === stable(right);
const fieldNames: SourceReviewField[] = ['name', 'price', 'category', 'specification', 'rules', 'memberships', 'availability'];
const sourceKey = (kind: string, id: string) => `${kind}:${id}`;
const portion = (option: StoreDineInOption, group?: StoreDineInGroup) => {
  const rule = option.sourceGroupRuleJson || group?.ruleJson || {};
  const grams = Number(rule.portionGrams);
  return Number.isFinite(grams) && grams > 0 ? `${grams}g` : (option.sourceName || option.name).match(/\d+(?:\.\d+)?\s*(?:kg|mg|g|ml|mL|L|ℓ)(?![a-z])/i)?.[0]?.replace(/\s/g, '') || '';
};
const nameValue = (value: { name: string; displayNames: Record<string, string> }) => ({ name: value.name, displayNames: value.displayNames });
const itemPrice = (item: StoreDineInItem) => ({ amount: item.posPricingMode === 'weight' ? item.posWeightUnitPrice : item.price, basis: item.posPricingMode === 'weight' ? 'weight' : 'fixed', unit: item.posPricingMode === 'weight' ? item.posWeightUnit : 'portion' });
const optionPrice = (option: StoreDineInOption, group?: StoreDineInGroup) => ({ amount: option.priceDelta, basis: 'option', unit: 'portion', portion: portion(option, group) });
const groupMembership = (group: StoreDineInGroup) => group.options.map(option => ({ id: getDineInOptionIdentity(option), name: option.name })).sort((a, b) => a.id.localeCompare(b.id));
const itemMembership = (item: StoreDineInItem, catalog: StoreDineInCatalog) => getDineInEffectiveItemGroupIds(catalog, item.id).map(id => catalog.optionGroups.find(group => group.id === id)).filter((group): group is StoreDineInGroup => Boolean(group)).map(group => ({ id: group.sourceGroupId || group.id, name: group.name })).sort((a, b) => a.id.localeCompare(b.id));
const unsafeReason = '構成・規格・選択条件は自動反映できません。内容を確認し、店内メニューで個別に編集してください。';
const priceReason = '販売単位・規格が異なるため、この価格は直接反映できません。店内価格を個別に設定してください。';
const nonSellingItemKeys = new Set(['posWeightPricing', 'posPricingMode', 'posPricingOverride', 'storeDineInOnly', 'source', 'sourceStoreId', 'sourceProductId', 'sourceCapturedAt', 'importedAt', 'lastSyncAt', 'uberPrice', 'websitePrice', 'customizationGroupKeys', 'optionGroupKeys', 'categoryKey', 'websitePresentation', 'websiteEnabled', 'websiteOnly', 'deliveryOnly', 'preserveOutsideUber']);
const itemSellingSpecification = (item: StoreDineInItem) => ({ itemKind: item.itemKind,
  variableSchema: Object.fromEntries(Object.entries(item.variableSchema).filter(([key]) => !nonSellingItemKeys.has(key))) });
function fieldsForItem(item: StoreDineInItem, catalog: StoreDineInCatalog, canonical = false) {
  return { name: nameValue(item), price: { ...itemPrice(item), ...(canonical ? { amount: item.basePrice } : {}) }, category: item.category,
    specification: itemSellingSpecification(item), memberships: itemMembership(item, catalog), availability: true };
}
const selectionRuleKeys = new Set(['minSelections', 'maxSelections', 'allowRepeat', 'perOptionMax', 'limit']);
function fieldsForGroup(group: StoreDineInGroup) {
  return { name: nameValue(group), rules: { selectionType: group.selectionType, ruleJson: Object.fromEntries(Object.entries(group.ruleJson).filter(([key]) => selectionRuleKeys.has(key))) },
    specification: { ...Object.fromEntries(Object.entries(group.ruleJson).filter(([key]) => !selectionRuleKeys.has(key))), groupKey: group.groupKey, applicableCategories: group.applicableCategories, menuCatalogItemId: group.menuCatalogItemId }, memberships: groupMembership(group), availability: true };
}
function fieldsForOption(option: StoreDineInOption, group: StoreDineInGroup) {
  return { name: nameValue(option), price: optionPrice(option, group), specification: { optionKey: option.optionKey, portion: portion(option, group), portionGrams: Number((option.sourceGroupRuleJson || group.ruleJson).portionGrams) || null }, rules: { applicableCategories: option.applicableCategories },
    memberships: { groupId: option.sourceGroupId || group.sourceGroupId || group.id, groupName: option.sourceGroupName || group.sourceName || group.name }, availability: true };
}
/** Validate existing local choices before accepting stricter source selection rules. */
function safeGroupRules(group: StoreDineInGroup | undefined, value: unknown, catalog: StoreDineInCatalog): boolean {
  const rules = object(value), json = object(rules.ruleJson), minimum = Number(json.minSelections || 0);
  if (!group || group.localKind || !['single', 'multiple', 'quantity'].includes(String(rules.selectionType))) return false;
  if (isDineInSingleChoiceGroup(group) && rules.selectionType !== 'single') return false;
  const selection = getPosOptionSelectionRules({ ...group, selectionType: String(rules.selectionType), ruleJson: json }).type;
  const maximum = Object.hasOwn(json, 'maxSelections') ? Number(json.maxSelections) : selection === 'single' ? 1 : 99;
  const limit = Object.hasOwn(json, 'limit') ? Number(json.limit) : maximum;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 500
    || !Number.isSafeInteger(maximum) || maximum < minimum || maximum > 9999
    || !Number.isSafeInteger(limit) || limit < minimum || limit > 9999 || limit < 0
    || selection === 'single' && (minimum > 1 || maximum > 1 || limit > 1)
    || Object.hasOwn(json, 'allowRepeat') && typeof json.allowRepeat !== 'boolean'
    || Object.hasOwn(json, 'perOptionMax') && (!Number.isSafeInteger(json.perOptionMax) || Number(json.perOptionMax) < 1 || Number(json.perOptionMax) > 9999)) return false;
  const consumers = catalog.items.filter(item => getDineInGroupItemIds(catalog, group.id).includes(item.id));
  if (!consumers.length) return minimum === 0;
  return consumers.every(item => {
    const count = group.options.filter(option => option.visible && dineInOptionAppliesToItem(option, group, item)).length;
    const capacity = selection !== 'quantity' || json.allowRepeat === false ? count : count * Number(json.perOptionMax || limit || 1);
    return minimum === 0 || count > 0 && capacity >= minimum;
  });
}
function normalizeState(catalog: StoreDineInCatalog): StoreDineInSourceReviewState {
  const state = catalog.sourceReview;
  return state?.version === 1 ? structuredClone(state) : { version: 1, baseline: {}, decisions: [] };
}
/** Read-only projection. Existing catalogs explicitly establish their first baseline through review. */
export function buildDineInSourceReview(catalog: StoreDineInCatalog, context: SourceReviewContext): StoreDineInSourceReview {
  const baseline = normalizeState(catalog).baseline, entries: SourceReviewEntry[] = [];
  const canonical = context.canonical, effective = context.effective;
  const linkedItems = new Set<string>(), linkedGroups = new Set<string>(), linkedOptions = new Set<string>();
  const append = (entry: Omit<SourceReviewEntry, 'fields' | 'initial' | 'pending'>, localFields: Record<string, unknown>, sourceFields?: Record<string, unknown>) => {
    if (sourceFields?.price && entry.networkPrice !== undefined) sourceFields = { ...sourceFields, price: { ...object(sourceFields.price), networkAmount: entry.networkPrice, importAmount: entry.importPrice ?? null, importBasis: entry.importPriceBasis || (entry.kind === 'option' ? 'option' : 'fixed'), importUnit: entry.importPriceUnit || 'portion' } };
    const previous = baseline[entry.key], initial = entry.status !== 'localOnly' && !previous;
    const keys = sourceFields ? Object.keys(sourceFields) as SourceReviewField[] : entry.status === 'missing' ? ['availability'] as SourceReviewField[] : entry.status === 'localOnly' ? Object.keys(localFields) as SourceReviewField[] : [];
    const fields: SourceReviewFieldChange[] = keys.map(field => {
      const sourceValue = entry.status === 'localOnly' ? null : sourceFields?.[field] ?? false, known = entry.status === 'localOnly' || Boolean(previous && Object.hasOwn(previous.fields, field));
      let canAdopt = entry.status === 'linked' && ['name', 'price', 'category'].includes(field);
      let reason: string | undefined;
      if (field === 'price') {
        const local = object(localFields.price), source = object(sourceValue);
        canAdopt = canAdopt && local.basis !== 'weight' && local.basis === source.basis && local.unit === source.unit
          && (local.portion || '') === (source.portion || '') && Number.isSafeInteger(source.amount) && Number(source.amount) >= 0 && Number(source.amount) <= 9_999_999;
        if (entry.kind === 'item' && !same(localFields.specification, sourceFields?.specification)) canAdopt = false;
        if (!canAdopt) reason = priceReason;
      } else if (field === 'specification' && entry.kind === 'option' && entry.status === 'linked') {
        const source = object(sourceValue), local = object(localFields.specification);
        // Portion metadata can change only within grams; cross-unit conversions remain explicit manual work.
        canAdopt = Number.isFinite(source.portionGrams) && Number(source.portionGrams) > 0 && Number(source.portionGrams) <= 100000
          && (local.portionGrams !== null || /^\d+(?:\.\d+)?g$/.test(String(local.portion || ''))) && local.optionKey === source.optionKey;
        if (!canAdopt) reason = priceReason;
      } else if (field === 'rules' && entry.kind === 'group' && entry.status === 'linked') {
        canAdopt = safeGroupRules(catalog.optionGroups.find(group => group.id === entry.targetId), sourceValue, catalog);
        if (!canAdopt) reason = '現在の店内選択肢では参照元の必須条件を満たせません。選択肢を取り込んでから確認してください。';
      } else if (!canAdopt && entry.status === 'linked' && field !== 'availability') reason = unsafeReason;
      return { field, localValue: localFields[field] ?? null, previousValue: known && previous ? previous.fields[field] : null,
        sourceValue, baselineKnown: known, changed: entry.status !== 'localOnly' && (!known || !same(previous!.fields[field], sourceValue)), canAdopt, ...(reason ? { reason } : {}) };
    });
    entries.push({ ...entry, initial, pending: fields.some(field => field.changed), fields });
  };
  for (const item of catalog.items) {
    const imported = effective.items.find(row => row.sourceItemId === item.sourceItemId);
    const key = sourceKey('item', item.id), source = item.variableSchema.storeDineInOnly === true ? undefined : canonical.items.find(row => row.sourceItemId === item.sourceItemId);
    const localOnly = item.variableSchema.storeDineInOnly === true;
    if (!localOnly) linkedItems.add(item.sourceItemId);
    append({ key, kind: 'item', targetId: item.id, sourceId: localOnly ? '' : item.sourceItemId, localName: item.name, localGroupName: item.category, sourceGroupName: source?.category || String(baseline[key]?.fields.category || ''),
      sourceName: source?.name || (localOnly ? '' : item.sourceName), status: localOnly ? 'localOnly' : source ? 'linked' : 'missing',
      importPrice: imported ? itemPrice(imported).amount : null, importPriceBasis: imported?.posPricingMode === 'weight' ? 'weight' : 'fixed', importPriceUnit: imported?.posPricingMode === 'weight' ? imported.posWeightUnit : 'portion',
      networkPrice: context.networkPrices?.[sourceKey('item', item.sourceItemId)] ?? null }, fieldsForItem(item, catalog), source ? fieldsForItem(source, canonical, true) : undefined);
  }
  for (const group of catalog.optionGroups) {
    const source = group.sourceGroupId ? canonical.optionGroups.find(row => row.sourceGroupId === group.sourceGroupId) : undefined;
    if (group.sourceGroupId) linkedGroups.add(group.sourceGroupId);
    append({ key: sourceKey('group', group.id), kind: 'group', targetId: group.id, sourceId: group.sourceGroupId, localName: group.name,
      sourceName: source?.name || group.sourceName, status: !group.sourceGroupId ? 'localOnly' : source ? 'linked' : 'missing' }, fieldsForGroup(group), source ? fieldsForGroup(source) : undefined);
    for (const option of group.options) {
      if (isLocalDineInOption(option)) {
        append({ key: sourceKey('option', option.id), kind: 'option', targetId: option.id, sourceId: '',
          localName: option.name, localGroupName: group.name, sourceName: '', sourceGroupName: group.name,
          status: 'localOnly' }, fieldsForOption(option, group));
        continue;
      }
      if (option.linkedItemId) {
        const linked = catalog.items.find(item => item.id === option.linkedItemId);
        const projected = linked ? { ...option, name: linked.name, displayNames: linked.displayNames, priceDelta: linked.price } : option;
        append({ key: sourceKey('option', option.id), kind: 'option', targetId: option.id, sourceId: '',
          localName: projected.name, localGroupName: group.name, sourceName: linked?.name || option.name,
          sourceGroupName: group.name, status: 'localOnly' }, fieldsForOption(projected, group));
        continue;
      }
      const sourceGroup = canonical.optionGroups.find(row => row.options.some(candidate => candidate.sourceOptionId === option.sourceOptionId));
      const sourceOption = sourceGroup?.options.find(row => row.sourceOptionId === option.sourceOptionId);
      linkedOptions.add(option.sourceOptionId);
      append({ key: sourceKey('option', option.id), kind: 'option', targetId: option.id, sourceId: option.sourceOptionId,
        localName: option.name, localGroupName: group.name, sourceName: sourceOption?.name || option.sourceName,
        sourceGroupName: sourceGroup?.name || option.sourceGroupName || group.sourceName, status: sourceOption ? 'linked' : 'missing',
        importPrice: effective.optionGroups.flatMap(row => row.options).find(row => row.sourceOptionId === option.sourceOptionId)?.priceDelta ?? null,
        networkPrice: context.networkPrices?.[sourceKey('option', option.sourceOptionId)] ?? null }, fieldsForOption(option, group), sourceOption && sourceGroup ? fieldsForOption(sourceOption, sourceGroup) : undefined);
    }
  }
  for (const item of canonical.items.filter(item => !linkedItems.has(item.sourceItemId))) {
    const imported = effective.items.find(row => row.sourceItemId === item.sourceItemId);
    append({ key: `new:item:${item.sourceItemId}`, kind: 'item', targetId: '', sourceId: item.sourceItemId, localName: '', sourceName: item.name, sourceGroupName: item.category, status: 'new',
      importPrice: imported ? itemPrice(imported).amount : null, importPriceBasis: imported?.posPricingMode === 'weight' ? 'weight' : 'fixed', importPriceUnit: imported?.posPricingMode === 'weight' ? imported.posWeightUnit : 'portion',
      networkPrice: context.networkPrices?.[sourceKey('item', item.sourceItemId)] ?? null }, {}, fieldsForItem(item, canonical, true));
  }
  for (const group of canonical.optionGroups) {
    if (!linkedGroups.has(group.sourceGroupId)) append({ key: `new:group:${group.sourceGroupId}`, kind: 'group', targetId: '', sourceId: group.sourceGroupId, localName: '', sourceName: group.name, status: 'new' }, {}, fieldsForGroup(group));
    for (const option of group.options.filter(option => !linkedOptions.has(option.sourceOptionId))) append({ key: `new:option:${option.sourceOptionId}`, kind: 'option', targetId: '', sourceId: option.sourceOptionId,
      localName: '', sourceName: option.name, sourceGroupName: group.name, status: 'new',
      importPrice: effective.optionGroups.flatMap(row => row.options).find(row => row.sourceOptionId === option.sourceOptionId)?.priceDelta ?? null,
      networkPrice: context.networkPrices?.[sourceKey('option', option.sourceOptionId)] ?? null }, {}, fieldsForOption(option, group));
  }
  return { version: 1, sourceRevision: context.sourceRevision, initial: entries.some(entry => (entry.status === 'linked' || entry.status === 'missing') && entry.fields.some(field => !field.baselineKnown)), pendingCount: entries.filter(entry => entry.pending).length, entries };
}
function error(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
/** Resolve the rendered key against trusted current records; no editable values cross this boundary. */
export function applyDineInSourceReview(catalog: StoreDineInCatalog, change: StoreDineInChange, context: SourceReviewContext, uuid: () => string, employeeId: string, at = new Date().toISOString()): StoreDineInCatalog {
  if (change.sourceRevision !== context.sourceRevision) error('参照元メニューが更新されました。再読込して比較してください。', 409);
  const review = buildDineInSourceReview(catalog, context), entry = review.entries.find(row => row.key === change.entryKey);
  if (!entry || entry.status === 'localOnly') error('比較する対象が見つかりません。再読込してください。', 404);
  let next = structuredClone(catalog), state = normalizeState(catalog);
  const previous = state.baseline[entry.key];
  const fields = { ...(previous?.sourceId === entry.sourceId ? previous.fields : {}) };
  for (const decision of change.decisions || []) {
    const field = entry.fields.find(row => row.field === decision.field);
    if (!field) error('比較する項目を確認してください。');
    if (decision.decision === 'adopt') {
      if (!field.canAdopt) error(field.reason || 'この項目は直接反映できません。店内設定を確認してください。');
      const source = object(field.sourceValue);
      if (decision.field === 'name') {
        next = applyDineInChange(next, { ...change, action: 'rename', kind: entry.kind, targetId: entry.targetId, name: String(source.name) }, uuid);
        const target = entry.kind === 'item' ? next.items.find(item => item.id === entry.targetId) : entry.kind === 'group' ? next.optionGroups.find(group => group.id === entry.targetId) : next.optionGroups.flatMap(group => group.options).find(option => option.id === entry.targetId);
        if (!target) error('対象の店内メニューが見つかりません。', 404);
        target.displayNames = structuredClone(object(source.displayNames)) as Record<string, string>;
      } else if (decision.field === 'specification' && entry.kind === 'option') {
        const group = next.optionGroups.find(group => group.options.some(option => option.id === entry.targetId))!;
        const option = group.options.find(option => option.id === entry.targetId)!;
        option.sourceGroupRuleJson = { ...(option.sourceGroupRuleJson || group.ruleJson), portionGrams: Number(source.portionGrams) };
      } else if (decision.field === 'rules' && entry.kind === 'group') {
        const group = next.optionGroups.find(group => group.id === entry.targetId)!;
        group.selectionType = String(source.selectionType);
        const selectedRules = structuredClone(object(source.ruleJson));
        if (!Object.hasOwn(selectedRules, 'limit') && Object.hasOwn(selectedRules, 'maxSelections')) selectedRules.limit = selectedRules.maxSelections;
        group.ruleJson = { ...Object.fromEntries(Object.entries(group.ruleJson).filter(([key]) => !selectionRuleKeys.has(key))), ...selectedRules };
      } else if (decision.field === 'price') next = applyDineInChange(next, { ...change, action: entry.kind === 'option' ? 'setOptionPrice' : 'setItemPrice', targetId: entry.targetId, price: Number(source.amount) }, uuid);
      else if (decision.field === 'category') {
        const name = String(field.sourceValue), existing = next.categories.find(category => category.name === name);
        if (!existing) next = applyDineInChange(next, { ...change, action: 'createCategory', name }, uuid, { brandId: context.canonical.items.find(item => item.sourceItemId === entry.sourceId)!.brandId, brandName: '' });
        const category = next.categories.find(row => row.name === name)!;
        next = applyDineInChange(next, { ...change, action: 'setItemCategory', targetId: entry.targetId, categoryId: category.id }, uuid);
      }
    }
    fields[decision.field] = structuredClone(field.sourceValue);
    state.decisions.push({ key: entry.key, field: decision.field, decision: decision.decision, sourceRevision: context.sourceRevision, employeeId, at });
  }
  state.baseline = { ...(next.sourceReview?.baseline || {}), ...state.baseline };
  state.baseline[entry.key] = { sourceId: entry.sourceId, fields };
  state.decisions = state.decisions.slice(-100);
  next.sourceReview = state;
  assertDineInLinkedProductChange(catalog, next);
  return pruneDineInSourceReview(next, context);
}
/** One-time initial comparison: retain all store content and acknowledge only unknown source fields.
 * Existing acknowledged fields are deliberately untouched, including newly pending source changes. */
export function acknowledgeDineInSourceBaseline(catalog: StoreDineInCatalog, change: StoreDineInChange, context: SourceReviewContext, employeeId: string, at = new Date().toISOString()): StoreDineInCatalog {
  if (change.sourceRevision !== context.sourceRevision) error('参照元メニューが更新されました。再読込して比較してください。', 409);
  const review = buildDineInSourceReview(catalog, context), next = structuredClone(catalog), state = normalizeState(catalog);
  for (const entry of review.entries) {
    if (entry.status === 'localOnly') continue;
    const unknown = entry.fields.filter(field => !field.baselineKnown);
    if (!unknown.length) continue;
    const previous = state.baseline[entry.key];
    const fields = { ...(previous?.sourceId === entry.sourceId ? previous.fields : {}) };
    for (const field of unknown) {
      fields[field.field] = structuredClone(field.sourceValue);
      state.decisions.push({ key: entry.key, field: field.field, decision: 'keep', sourceRevision: context.sourceRevision, employeeId, at });
    }
    state.baseline[entry.key] = { sourceId: entry.sourceId, fields };
  }
  state.decisions = state.decisions.slice(-100);
  next.sourceReview = state;
  return next;
}
/** Import captures a baseline for newly created local identities only; pre-existing reviews stay pending. */
export function captureDineInSourceBaseline(catalog: StoreDineInCatalog, before: StoreDineInCatalog | null, context: SourceReviewContext, preserveLocalCopies = false): StoreDineInCatalog {
  const next = structuredClone(catalog), state = normalizeState(catalog), previousEntries = before ? buildDineInSourceReview(before, context).entries.filter(entry => entry.status !== 'new') : [], previousKeys = new Set(previousEntries.map(entry => entry.key));
  for (const entry of buildDineInSourceReview(catalog, context).entries) {
    if (entry.status !== 'linked' || previousKeys.has(entry.key) || Object.hasOwn(state.baseline, entry.key)) continue;
    // Moving existing local choices must not acknowledge a source update the user never reviewed.
    if (preserveLocalCopies && previousEntries.some(row => row.kind === entry.kind && row.sourceId === entry.sourceId)) {
      // Exact selected-identity baselines are transferred at the policy clone site.
      // Missing provenance stays unknown; never borrow an arbitrary sibling's acknowledged values.
      state.baseline[entry.key] = { sourceId: entry.sourceId, fields: {} };
      continue;
    }
    state.baseline[entry.key] = { sourceId: entry.sourceId, fields: Object.fromEntries(entry.fields.map(field => [field.field, structuredClone(field.sourceValue)])) };
  }
  next.sourceReview = state;
  assertDineInLinkedProductChange(catalog, next);
  return pruneDineInSourceReview(next, context);
}
/** Remove abandoned local baselines; retain ignored candidates while their source still exists. */
export function pruneDineInSourceReview(catalog: StoreDineInCatalog, context?: SourceReviewContext): StoreDineInCatalog {
  if (!catalog.sourceReview) return catalog;
  const valid = new Set([...catalog.items.map(row => sourceKey('item', row.id)), ...catalog.optionGroups.flatMap(group => [sourceKey('group', group.id), ...group.options.map(option => sourceKey('option', option.id))])]);
  if (context) for (const entry of buildDineInSourceReview(catalog, context).entries.filter(entry => entry.status === 'new')) valid.add(entry.key);
  else for (const key of Object.keys(catalog.sourceReview.baseline)) if (key.startsWith('new:')) valid.add(key);
  catalog.sourceReview.baseline = Object.fromEntries(Object.entries(catalog.sourceReview.baseline).filter(([key]) => valid.has(key)));
  return catalog;
}
export const sourceReviewFields: readonly SourceReviewField[] = fieldNames;
