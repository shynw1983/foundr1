import { isDineInBowlOptionGroup, isPosBowl } from './pos-serving-policy';
import type { PosItemFulfillmentMode } from './pos-item-fulfillment';
import { getPosOptionSelectionRules } from './dine-in-option-selection';
import type { StoreDineInSourceReviewState, SourceReviewDecision } from './store-dine-in-source-review';
import { normalizePosItemPricing, type PosItemPricingMode } from './pos-item-pricing';

/** OS-owned, store-scoped sales definitions. Source IDs are lineage and stock identities,
 * never permission to publish or change the shared brand catalog. */
export type StoreDineInProductionType = 'bowl' | 'drink' | 'item';
export type StoreDineInCategory = { id: string; brandId: string; name: string; sortOrder: number; fulfillmentMode?: PosItemFulfillmentMode };
export type StoreDineInOption = {
  id: string; sourceOptionId: string; sourceName: string; optionKey: string;
  /** Native store choice: no canonical SKU. Origin survives local copies. */
  localOnly?: true; localOriginId?: string;
  /** Explicit local product choice. Never masquerades as a canonical menu option. */
  linkedItemId?: string;
  /** Per-option lineage is required when a local group combines multiple source groups. */
  sourceGroupId?: string; sourceGroupName?: string; sourceGroupRuleJson?: Record<string, unknown>;
  applicableCategories: string[]; name: string; displayNames: Record<string, string>;
  priceDelta: number; sortOrder: number; visible: boolean;
};
export type StoreDineInGroup = {
  id: string; sourceGroupId: string; sourceName: string; brandId: string;
  menuCatalogItemId: string; applicableCategories: string[]; groupKey: string;
  name: string; displayNames: Record<string, string>; selectionType: string;
  ruleJson: Record<string, unknown>; sortOrder: number; posEnabled: boolean;
  /** Set only by an explicit membership edit; item.optionGroupIds then owns the links. */
  explicitItemLinks?: true;
  /** Preserve exclusions on retained historical edges; newly attached pairs get the full group. */
  itemOptionExclusions?: Record<string, string[]>;
  visible: boolean; options: StoreDineInOption[]; localKind?: 'addon' | 'choice' | 'imported';
};
export type StoreDineInItem = {
  id: string; sourceItemId: string; sourceName: string; brandId: string; brandName: string;
  name: string; displayNames: Record<string, string>; itemKind: string; category: string;
  imageUrl: string; basePrice: number | null; priceOverride: number | null; price: number;
  variableSchema: Record<string, unknown>; posPricingMode: string; posPricingOverride?: PosItemPricingMode; posWeightUnit: string;
  posWeightUnitPrice: number | null; productionType: StoreDineInProductionType;
  sortOrder: number; visible: boolean; optionGroupIds: string[]; fulfillmentMode?: PosItemFulfillmentMode;
};
export type StoreDineInTrashEntry = {
  id: string; kind: StoreDineInKind; targetId: string; name: string; deletedAt: string;
  payload: { items?: StoreDineInItem[]; optionGroups?: StoreDineInGroup[]; categories?: StoreDineInCategory[];
    options?: Array<{ groupId: string; option: StoreDineInOption }>;
    attachments?: Array<{ itemId: string; groupIds: string[] }>; sourceReview?: StoreDineInSourceReviewState };
};
export type StoreDineInCatalog = {
  version: 1; items: StoreDineInItem[]; optionGroups: StoreDineInGroup[]; categories: StoreDineInCategory[]; sourceReview?: StoreDineInSourceReviewState; trash?: StoreDineInTrashEntry[];
};
export type StoreDineInAction = 'initialize' | 'rename' | 'duplicate' | 'setEnabled' | 'setVisibility' | 'setOptionsVisibility'
  | 'setFulfillmentMode' | 'createCategory' | 'createItem' | 'importItem' | 'createAddonGroup' | 'importAddonOptions' | 'reorderAddonOptions' | 'setItemPricing' | 'createOptionGroup' | 'createOption' | 'delete' | 'deleteOptions' | 'setOptionPrice' | 'setItemPrice' | 'setItemCategory' | 'reviewSource' | 'acknowledgeSourceBaseline' | 'reorder' | 'restore' | 'importOptionGroup' | 'setGroupSelection' | 'linkItemOptions' | 'setItemOptionGroups' | 'setGroupItems';
export type StoreDineInKind = 'item' | 'group' | 'option' | 'category';
export type StoreDineInChange = {
  action: StoreDineInAction; operationId: string; revision: string;
  kind?: StoreDineInKind; targetId?: string; name?: string; enabled?: boolean; visible?: boolean;
  mode?: 'empty' | 'source'; categoryId?: string; itemKind?: 'drink' | 'fixed_product' | 'buildable_product'; price?: number; pricingMode?: PosItemPricingMode;
  fulfillmentMode?: PosItemFulfillmentMode | 'inherit';
  sourceRevision?: string; entryKey?: string; decisions?: SourceReviewDecision[];
  sourceItemId?: string; itemId?: string; optionIds?: string[]; replacementCategoryId?: string; selectionType?: 'single' | 'multiple' | 'quantity';
  ids?: string[]; sourceGroupId?: string; origin?: 'brand' | 'store'; itemIds?: string[]; groupIds?: string[];
  minSelections?: number; maxSelections?: number; perOptionMax?: number; portionGrams?: number;
};
export const dineInUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type DineInOptionIdentity = { id: string; sourceOptionId?: string; linkedItemId?: string; localOnly?: boolean; localOriginId?: string };
export function isLocalDineInOption(option: DineInOptionIdentity): boolean {
  return option.localOnly === true && !option.sourceOptionId && !option.linkedItemId && dineInUuid.test(option.localOriginId || '');
}
/** Keep local origin distinct from both canonical menu options and products. */
export function getDineInOptionIdentity(option: DineInOptionIdentity): string {
  return option.linkedItemId ? `item:${option.linkedItemId}` : isLocalDineInOption(option) ? `local:${option.localOriginId}` : option.sourceOptionId || '';
}
/** Missing item values inherit the same-brand category, then preparation by default.
 * Bowl production is never disabled by category inheritance or a malformed old snapshot. */
export function resolveDineInItemFulfillmentMode(catalog: StoreDineInCatalog, item: StoreDineInItem): PosItemFulfillmentMode {
  if (isPosBowl(item)) return 'prepare';
  if (item.fulfillmentMode === 'prepare' || item.fulfillmentMode === 'immediate') return item.fulfillmentMode;
  const category = catalog.categories.find(category => category.brandId === item.brandId && category.name === item.category);
  return category?.fulfillmentMode === 'immediate' ? 'immediate' : 'prepare';
}
export function emptyDineInCatalog(): StoreDineInCatalog { return { version: 1, items: [], optionGroups: [], categories: [] }; }
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function missing(): never { throw Object.assign(new Error('対象の店内メニューが見つかりません。'), { status: 404 }); }
function validName(value: unknown): string {
  if (typeof value !== 'string') invalid('名称を入力してください。');
  const name = value.trim();
  if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f]/.test(name)) invalid('名称は1〜120文字で入力してください。');
  return name;
}
export function parseDineInChange(body: Record<string, unknown>): StoreDineInChange {
  const actionFields: Record<StoreDineInAction, string[]> = {
    setFulfillmentMode: ['kind', 'targetId', 'fulfillmentMode'],
    createOption: ['targetId', 'name', 'price', 'portionGrams'],
    setItemOptionGroups: ['targetId', 'groupIds'], setGroupItems: ['targetId', 'itemIds'], deleteOptions: ['optionIds'], setOptionsVisibility: ['optionIds', 'visible'],
    reorder: ['kind', 'targetId', 'ids'], restore: ['targetId'], importOptionGroup: ['itemId', 'sourceGroupId', 'origin', 'optionIds', 'name'],
    setGroupSelection: ['targetId', 'selectionType', 'minSelections', 'maxSelections', 'perOptionMax'], linkItemOptions: ['targetId', 'itemIds'],
    initialize: ['mode', 'enabled'], rename: ['kind', 'targetId', 'name'], duplicate: ['kind', 'targetId', 'name'],
    setEnabled: ['enabled'], setVisibility: ['kind', 'targetId', 'visible'], createCategory: ['name'],
    createItem: ['name', 'categoryId', 'itemKind', 'price', 'pricingMode'], importItem: ['sourceItemId', 'name', 'categoryId'],
    createAddonGroup: ['name', 'itemId', 'optionIds'], importAddonOptions: ['targetId', 'optionIds'], reorderAddonOptions: ['targetId', 'optionIds'], setItemPricing: ['targetId', 'pricingMode'], createOptionGroup: ['itemId', 'name', 'selectionType'], delete: ['kind', 'targetId', 'replacementCategoryId'], setOptionPrice: ['targetId', 'price'], setItemPrice: ['targetId', 'price'], setItemCategory: ['targetId', 'categoryId'], reviewSource: ['sourceRevision', 'entryKey', 'decisions'], acknowledgeSourceBaseline: ['sourceRevision']
  };
  if (typeof body.action !== 'string' || !Object.hasOwn(actionFields, body.action)) invalid('操作を確認してください。');
  if (!dineInUuid.test(String(body.operationId || ''))) invalid('操作番号を確認してください。');
  if (typeof body.revision !== 'string' || !/^(?:|[1-9][0-9]{0,18})$/.test(body.revision)) invalid('再読込して設定を確認してください。');
  const action = body.action as StoreDineInAction;
  const allowed = new Set(['storeId', 'brandId', 'action', 'operationId', 'revision', ...actionFields[action]]);
  if (Object.keys(body).some(key => !allowed.has(key))) invalid('この操作では指定された内容のみ変更できます。');
  const change: StoreDineInChange = { action, operationId: String(body.operationId), revision: body.revision };
  const id = (field: 'targetId' | 'categoryId' | 'sourceItemId' | 'itemId' | 'replacementCategoryId' | 'sourceGroupId') => {
    if (!dineInUuid.test(String(body[field] || ''))) invalid('対象を選択してください。');
    change[field] = String(body[field]);
  };
  const idList = (field: 'ids' | 'optionIds' | 'itemIds' | 'groupIds', maximum = 1000) => {
    const value = body[field];
    if (!Array.isArray(value) || value.length > maximum || value.some(id => typeof id !== 'string' || !dineInUuid.test(id)) || new Set(value).size !== value.length) invalid('対象を重複なく選択してください。');
    change[field] = [...value] as string[];
  };
  if (action === 'setFulfillmentMode') {
    if (body.kind !== 'item' && body.kind !== 'category') invalid('商品または商品分類を選択してください。');
    if (body.fulfillmentMode !== 'inherit' && body.fulfillmentMode !== 'prepare' && body.fulfillmentMode !== 'immediate') invalid('提供方法を選択してください。');
    change.kind = body.kind; id('targetId'); change.fulfillmentMode = body.fulfillmentMode;
  } else if (action === 'setItemOptionGroups' || action === 'setGroupItems') { id('targetId'); idList(action === 'setItemOptionGroups' ? 'groupIds' : 'itemIds', action === 'setItemOptionGroups' ? 1000 : 500); }
  else if (action === 'setOptionsVisibility') {
    idList('optionIds', 500);
    if (!change.optionIds!.length) invalid('表示設定を変更する選択肢を選択してください。');
    if (typeof body.visible !== 'boolean') invalid('公開設定を確認してください。');
    change.visible = body.visible;
  } else if (action === 'deleteOptions') {
    idList('optionIds', 500);
    if (!change.optionIds!.length) invalid('削除する選択肢を選択してください。');
  } else if (action === 'reorder') {
    if (!['item', 'group', 'option', 'category'].includes(String(body.kind))) invalid('対象の種類を確認してください。');
    change.kind = body.kind as StoreDineInKind; idList('ids');
    if (change.kind === 'group' || change.kind === 'option') id('targetId');
    else if (body.targetId !== undefined) invalid('この並べ替えでは親の指定はできません。');
  } else if (action === 'restore') id('targetId');
  else if (action === 'linkItemOptions') { id('targetId'); idList('itemIds', 500); if (!change.itemIds!.length) invalid('商品を選択してください。'); }
  else if (action === 'importOptionGroup') {
    id('itemId'); id('sourceGroupId');
    if (body.origin !== 'brand' && body.origin !== 'store') invalid('取込元を選択してください。');
    change.origin = body.origin;
    if (body.optionIds !== undefined) { idList('optionIds', 500); if (!change.optionIds!.length) invalid('取り込む選択肢を選択してください。'); }
    if (body.name !== undefined) change.name = validName(body.name);
  } else if (action === 'setGroupSelection') {
    id('targetId');
    if (!['single', 'multiple', 'quantity'].includes(String(body.selectionType))) invalid('選択方法を確認してください。');
    change.selectionType = body.selectionType as StoreDineInChange['selectionType'];
    for (const field of ['minSelections', 'maxSelections', 'perOptionMax'] as const) {
      if (typeof body[field] !== 'number' || !Number.isSafeInteger(body[field]) || Number(body[field]) < (field === 'minSelections' ? 0 : 1) || Number(body[field]) > 9999) invalid('選択数は0〜9,999の整数で入力してください。');
      change[field] = body[field] as number;
    }
    if (change.minSelections! > change.maxSelections! || change.perOptionMax! > change.maxSelections!) invalid('選択数の最小・最大を確認してください。');
    if (change.selectionType === 'single' && (change.maxSelections !== 1 || change.perOptionMax !== 1 || change.minSelections! > 1) || change.selectionType === 'multiple' && change.perOptionMax !== 1) invalid('選択方法と同じ選択肢の最大数を確認してください。');
  } else if (action === 'acknowledgeSourceBaseline') {
    if (typeof body.sourceRevision !== 'string' || !/^[0-9a-f]{32}$/.test(body.sourceRevision)) invalid('参照元の版を確認してください。再読込してください。');
    change.sourceRevision = body.sourceRevision;
  } else if (action === 'reviewSource') {
    if (typeof body.sourceRevision !== 'string' || !/^[0-9a-f]{32}$/.test(body.sourceRevision)) invalid('参照元の版を確認してください。再読込してください。');
    if (typeof body.entryKey !== 'string' || !/^(?:new:)?(?:item|group|option):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.entryKey)) invalid('比較する対象を確認してください。');
    if (!Array.isArray(body.decisions) || !body.decisions.length || body.decisions.length > 7) invalid('比較する項目を選択してください。');
    const fields = ['name', 'price', 'category', 'specification', 'rules', 'memberships', 'availability'];
    const decisions: SourceReviewDecision[] = [];
    for (const raw of body.decisions) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('比較する項目を確認してください。');
      const value = raw as Record<string, unknown>;
      if (Object.keys(value).some(key => !['field', 'decision'].includes(key)) || !fields.includes(String(value.field)) || !['adopt', 'keep'].includes(String(value.decision))) invalid('比較する項目を確認してください。');
      decisions.push({ field: value.field as SourceReviewDecision['field'], decision: value.decision as SourceReviewDecision['decision'] });
    }
    if (new Set(decisions.map(row => row.field)).size !== decisions.length) invalid('同じ比較項目を重複して選択できません。');
    change.sourceRevision = body.sourceRevision; change.entryKey = body.entryKey; change.decisions = decisions;
  } else if (action === 'delete') {
    if (!['item', 'group', 'option', 'category'].includes(String(body.kind))) invalid('対象の種類を確認してください。');
    change.kind = body.kind as StoreDineInKind; id('targetId');
    if (body.replacementCategoryId !== undefined) {
      if (change.kind !== 'category') invalid('移動先は商品分類の削除時のみ指定できます。');
      id('replacementCategoryId');
    }
  } else if (action === 'setItemCategory') {
    id('targetId'); id('categoryId');
  } else if (action === 'createOption' || action === 'setOptionPrice' || action === 'setItemPrice') {
    id('targetId');
    if (typeof body.price !== 'number' || !Number.isSafeInteger(body.price) || body.price < 0 || body.price > 9_999_999) invalid('価格は0〜9,999,999円の整数で入力してください。');
    change.price = body.price;
    if (action === 'createOption') {
      change.name = validName(body.name);
      if (body.portionGrams !== undefined) {
        if (typeof body.portionGrams !== 'number' || !Number.isSafeInteger(body.portionGrams) || body.portionGrams < 1 || body.portionGrams > 99_999) invalid('1点の重量は1〜99,999gの整数で入力してください。');
        change.portionGrams = body.portionGrams;
      }
    }
  } else if (action === 'createOptionGroup') {
    change.name = validName(body.name); id('itemId');
    if (body.selectionType !== 'single' && body.selectionType !== 'quantity') invalid('選択方法を確認してください。');
    change.selectionType = body.selectionType;
  } else if (['rename', 'duplicate', 'setVisibility'].includes(action)) {
    const kinds = action === 'rename' ? ['item', 'group', 'option', 'category'] : action === 'duplicate' ? ['item', 'option'] : ['item', 'group', 'option'];
    if (!kinds.includes(String(body.kind))) invalid('対象の種類を確認してください。');
    change.kind = body.kind as StoreDineInKind; id('targetId');
    if (action === 'setVisibility') {
      if (typeof body.visible !== 'boolean') invalid('公開設定を確認してください。');
      change.visible = body.visible;
    } else change.name = validName(body.name);
  } else if (action === 'initialize') {
    if (body.mode !== undefined && !['empty', 'source'].includes(String(body.mode))) invalid('作成方法を選択してください。');
    if (body.mode !== undefined) change.mode = body.mode as 'empty' | 'source';
    if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') invalid('有効設定を確認してください。'); change.enabled = body.enabled; }
  } else if (action === 'setEnabled') {
    if (typeof body.enabled !== 'boolean') invalid('有効設定を確認してください。');
    change.enabled = body.enabled;
  } else if (action === 'createCategory') change.name = validName(body.name);
  else if (action === 'createItem') {
    change.name = validName(body.name); id('categoryId');
    if (typeof body.itemKind !== 'string' || !['drink', 'fixed_product', 'buildable_product'].includes(body.itemKind)) invalid('商品の種類を選択してください。');
    if (typeof body.price !== 'number' || !Number.isSafeInteger(body.price) || body.price < 0 || body.price > 9_999_999) invalid('価格は0〜9,999,999円の整数で入力してください。');
    change.itemKind = body.itemKind as 'drink' | 'fixed_product' | 'buildable_product'; change.price = body.price;
    if (body.pricingMode !== undefined) {
      if (body.pricingMode !== 'fixed' && body.pricingMode !== 'weight') invalid('販売方式を選択してください。');
      if (change.itemKind === 'drink' && body.pricingMode === 'weight') invalid('ドリンクは固定価格で販売してください。');
      change.pricingMode = body.pricingMode;
    }
  } else if (action === 'setItemPricing') {
    id('targetId');
    if (body.pricingMode !== 'fixed' && body.pricingMode !== 'weight') invalid('販売方式を選択してください。');
    change.pricingMode = body.pricingMode;
  } else if (action === 'importItem') {
    id('sourceItemId');
    if (body.name !== undefined) change.name = validName(body.name);
    if (body.categoryId !== undefined) id('categoryId');
  } else {
    if (action === 'createAddonGroup') { change.name = validName(body.name); id('itemId'); } else id('targetId');
    if (!Array.isArray(body.optionIds) || body.optionIds.length > 500 || (action === 'importAddonOptions' && !body.optionIds.length)
      || body.optionIds.some(value => typeof value !== 'string' || !dineInUuid.test(value)) || new Set(body.optionIds).size !== body.optionIds.length) invalid('取り込む食材を選択してください。');
    change.optionIds = [...body.optionIds] as string[];
  }
  return change;
}

/** Group names are user editable: check both the retained source identity and the local key.
 * Only optional ingredient groups can move; flavor/heat/noodle and required choices stay independent. */
export function isDineInAddonSourceGroup(group: StoreDineInGroup): boolean {
  if (Number(group.ruleJson.minSelections || 0) > 0) return false;
  if (group.localKind === 'addon' || group.localKind === 'choice') return true;
  const identity = `${group.groupKey} ${group.sourceName || group.name}`.toLowerCase();
  if (/(?:heat|numb|spic|chili|soup|broth|flavo[u]?r|noodle|medicinal|sweet|temperature|size|\bice\b|drink|beverage|note|comment|cutlery|utensil|pack|辣度|麻度|辛さ|しびれ|痺れ|麺|面条|麵|湯底|汤底|スープ|味付|口味|薬膳|药膳|唐辛子|調味|调味|甘さ|氷|温度|飲料|饮料|ドリンク|カトラリー|お箸|容器|醤|ソース)/i.test(identity)) return false;
  // Untyped marketing groups are allowed only through this explicit, scoped staff
  // selection. No group is combined automatically and protected choices stay separate.
  return true;
}
/** Runtime menu readers intentionally carry less than the persisted editing model. */
export type DineInScopeItem = Pick<StoreDineInItem, 'id' | 'brandId' | 'category' | 'posPricingMode' | 'variableSchema'>;
export type DineInScopeGroup = Pick<StoreDineInGroup, 'id' | 'brandId' | 'menuCatalogItemId' | 'applicableCategories' | 'groupKey'>
  & Partial<Pick<StoreDineInGroup, 'name' | 'sourceName' | 'posEnabled' | 'explicitItemLinks' | 'itemOptionExclusions'>> & { localKind?: string };
export type DineInScopeOption = Pick<StoreDineInOption, 'id' | 'optionKey' | 'applicableCategories' | 'name'>
  & Partial<Pick<StoreDineInOption, 'sourceName'>>;
export function dineInGroupAppliesToItem(group: DineInScopeGroup, item: DineInScopeItem): boolean {
  if (group.brandId !== item.brandId) return false;
  if (group.explicitItemLinks) return true;
  if (item.posPricingMode === 'weight' && !isDineInBowlOptionGroup(group)) return false;
  if (group.menuCatalogItemId && group.menuCatalogItemId !== item.id) return false;
  return Boolean(group.menuCatalogItemId || !group.applicableCategories.length || group.applicableCategories.includes(item.category || '未分類'));
}
export function getDineInEffectiveItemGroupIds(catalog: StoreDineInCatalog, itemId: string): string[] {
  const item = catalog.items.find(item => item.id === itemId); if (!item) return [];
  const groups = new Map(catalog.optionGroups.map(group => [group.id, group]));
  return [...new Set(item.optionGroupIds)].filter(id => { const group = groups.get(id); return Boolean(group && dineInGroupAppliesToItem(group, item)); });
}
export function getDineInGroupItemIds(catalog: StoreDineInCatalog, groupId: string): string[] {
  return catalog.items.filter(item => getDineInEffectiveItemGroupIds(catalog, item.id).includes(groupId)).map(item => item.id);
}
export function dineInOptionAppliesToItem(option: DineInScopeOption, group: DineInScopeGroup, item: DineInScopeItem): boolean {
  if (!dineInGroupAppliesToItem(group, item)) return false;
  if (group.explicitItemLinks) return !(group.itemOptionExclusions?.[item.id] || []).includes(option.id);
  const category = item.category || '未分類';
  if (option.applicableCategories.length && !option.applicableCategories.includes(category)) return false;
  const ruleKeys: Record<string, string> = { size: 'allowedSizes', temperature: 'temperatures', sweetness: 'allowedSweetness', ice: 'allowedIce', option: 'allowedOptions', topping: 'allowedToppings' };
  if (group.localKind === 'imported' && group.menuCatalogItemId === item.id) return true;
  const key = ruleKeys[group.groupKey] ?? `allowed_${group.groupKey}`;
  const raw = item.variableSchema[key], allowed = Array.isArray(raw) ? raw.map(String) : [];
  return !allowed.length || allowed.includes(option.optionKey) || allowed.includes(option.name) || Boolean(option.sourceName && allowed.includes(option.sourceName));
}
const optionAppliesToItem = dineInOptionAppliesToItem;
export function canDineInGroupImportAddons(group: StoreDineInGroup): boolean {
  return group.localKind === 'addon' || group.localKind === 'choice' || group.localKind === 'imported' && isDineInAddonSourceGroup(group);
}
export type DineInAddonCandidate = { groupId: string; groupName: string; option: StoreDineInOption; origin: 'store' | 'brand'; attached: boolean };
/** Explicit imports can select another local product's ingredients or a trusted brand
 * snapshot. Prefer this product's choices so a move never leaves duplicate portions. */
export function getDineInAddonCandidates(catalog: StoreDineInCatalog, itemId: string, excludeGroupId?: string, source?: StoreDineInCatalog): DineInAddonCandidate[] {
  const item = catalog.items.find(item => item.id === itemId); if (!item) return [];
  const existing = new Set(catalog.optionGroups.find(group => group.id === excludeGroupId)?.options.map(getDineInOptionIdentity) || []);
  const candidates: DineInAddonCandidate[] = [];
  const append = (groups: StoreDineInGroup[], origin: 'store' | 'brand', attached: boolean) => {
    for (const group of groups) {
      if (group.id === excludeGroupId || group.brandId !== item.brandId || !isDineInAddonSourceGroup(group)) continue;
      for (const option of group.options) {
        if (option.linkedItemId) continue;
        if (attached && !optionAppliesToItem(option, group, item)) continue;
        const identity = getDineInOptionIdentity(option);
        if (existing.has(identity)) continue;
        existing.add(identity);
        candidates.push({ groupId: group.id, groupName: group.name, option, origin, attached });
      }
    }
  };
  append(catalog.optionGroups.filter(group => item.optionGroupIds.includes(group.id)), 'store', true);
  append(catalog.optionGroups.filter(group => !item.optionGroupIds.includes(group.id)), 'store', false);
  if (source) append(source.optionGroups, 'brand', false);
  return candidates;
}
/** Existing shared/orphan targets need no invented owner. Copying into them never moves another product's choices. */
export function getDineInAddonImportCandidates(catalog: StoreDineInCatalog, targetGroupId: string, source?: StoreDineInCatalog): DineInAddonCandidate[] {
  const target = catalog.optionGroups.find(group => group.id === targetGroupId); if (!target || !canDineInGroupImportAddons(target)) return [];
  const members = getDineInGroupItemIds(catalog, target.id);
  if (members.length === 1) return getDineInAddonCandidates(catalog, members[0], target.id, source);
  const seen = new Set(target.options.filter(option => !option.linkedItemId).map(getDineInOptionIdentity)), result: DineInAddonCandidate[] = [];
  for (const [origin, groups] of [['store', catalog.optionGroups], ['brand', source?.optionGroups || []]] as const) {
    for (const group of groups) {
      if (group.id === target.id || group.brandId !== target.brandId || !isDineInAddonSourceGroup(group)) continue;
      for (const option of group.options) {
        const identity = getDineInOptionIdentity(option);
        if (option.linkedItemId || seen.has(identity)) continue;
        seen.add(identity); result.push({ groupId: group.id, groupName: group.name, option, origin, attached: false });
      }
    }
  }
  return result;
}
/** Local copies inherit the exact selected identity's review, including unknown fields. */
function copyDineInReviewBaseline(catalog: StoreDineInCatalog, kind: 'item' | 'group' | 'option', fromId: string, toId: string, sourceId: string) {
  const state = catalog.sourceReview ||= { version: 1, baseline: {}, decisions: [] };
  const previous = state.baseline[`${kind}:${fromId}`];
  state.baseline[`${kind}:${toId}`] = previous ? structuredClone(previous) : { sourceId, fields: {} };
}
function copyDineInOption(catalog: StoreDineInCatalog, option: StoreDineInOption, uuid: () => string): StoreDineInOption {
  const copy = { ...structuredClone(option), id: uuid() };
  copyDineInReviewBaseline(catalog, 'option', option.id, copy.id, option.sourceOptionId);
  return copy;
}
function cloneDineInGroupForItem(catalog: StoreDineInCatalog, group: StoreDineInGroup, item: StoreDineInItem, uuid: () => string): StoreDineInGroup {
  const options = group.options.map(option => copyDineInOption(catalog, option, uuid));
  const optionIds = new Map(group.options.map((option, index) => [option.id, options[index].id]));
  const copy: StoreDineInGroup = { ...structuredClone(group), id: uuid(), menuCatalogItemId: group.explicitItemLinks ? '' : item.id, options };
  if (group.explicitItemLinks) {
    const exclusions = (group.itemOptionExclusions?.[item.id] || []).flatMap(id => optionIds.has(id) ? [optionIds.get(id)!] : []);
    copy.itemOptionExclusions = exclusions.length ? { [item.id]: exclusions } : {};
  }
  copyDineInReviewBaseline(catalog, 'group', group.id, copy.id, group.sourceGroupId);
  return copy;
}
function moveAddonOptions(catalog: StoreDineInCatalog, item: StoreDineInItem | undefined, target: StoreDineInGroup, optionIds: string[], uuid: () => string, source?: StoreDineInCatalog) {
  const members = getDineInGroupItemIds(catalog, target.id);
  const candidates = getDineInAddonImportCandidates(catalog, target.id, source), selectedIds = new Set(optionIds);
  if (optionIds.some(id => !candidates.some(candidate => candidate.option.id === id))) invalid('任意の追加食材のみ取り込めます。辛さ・しびれ・麺・スープや必須の選択肢は元のグループで管理してください。');
  const selected = candidates.filter(candidate => selectedIds.has(candidate.option.id));
  const selectedSources = new Set(selected.map(candidate => getDineInOptionIdentity(candidate.option)));
  for (const { groupId, option, origin } of selected) {
    const sourceGroup = (origin === 'brand' ? source! : catalog).optionGroups.find(group => group.id === groupId)!;
    target.options.push({ ...(origin === 'store' ? copyDineInOption(catalog, option, uuid) : { ...structuredClone(option), id: uuid() }), sourceGroupId: isLocalDineInOption(option) ? '' : option.sourceGroupId || sourceGroup.sourceGroupId,
      sourceGroupName: option.sourceGroupName || sourceGroup.sourceName || sourceGroup.name,
      sourceGroupRuleJson: structuredClone(option.sourceGroupRuleJson || sourceGroup.ruleJson),
      // Placement in this new local group is explicit; old category restrictions
      // must not hide a deliberately imported ingredient on a new local product.
      applicableCategories: target.explicitItemLinks || members.length !== 1 ? [] : option.applicableCategories.length ? [...new Set([...option.applicableCategories, item?.category || '未分類'])] : [],
      sortOrder: target.options.length, visible: true });
  }
  if (target.options.length > 500) invalid('選択肢は1グループ500件までです。');
  if (!item || members.length !== 1) return;
  for (const group of [...catalog.optionGroups]) {
    if (group.id === target.id || !item.optionGroupIds.includes(group.id) || !isDineInAddonSourceGroup(group)) continue;
    const remaining = group.options.filter(option => !selectedSources.has(getDineInOptionIdentity(option)));
    if (remaining.length === group.options.length) continue;
    const shared = catalog.items.some(other => other.id !== item.id && other.optionGroupIds.includes(group.id));
    if (shared || !group.menuCatalogItemId) {
      // Only this product moves its portions. Other products and the trusted brand
      // source are copied, never edited or detached by an import.
      const remainder = remaining.length ? cloneDineInGroupForItem(catalog, { ...group, options: remaining }, item, uuid) : null;
      if (remainder) catalog.optionGroups.push(remainder);
      item.optionGroupIds = item.optionGroupIds.flatMap(id => id === group.id ? remainder ? [remainder.id] : [] : [id]);
    } else {
      group.options = remaining;
      if (!remaining.length) { item.optionGroupIds = item.optionGroupIds.filter(id => id !== group.id); catalog.optionGroups = catalog.optionGroups.filter(other => other.id !== group.id); }
    }
  }
}
/** Deleting a whole group is an explicit removal of its requirement; deleting one
 * choice must not silently leave a visible mandatory group impossible to satisfy. */
export function getDineInDeleteDisabledReason(catalog: StoreDineInCatalog, kind: StoreDineInKind, targetId: string): string | null {
  if (kind !== 'option') return null;
  const group = catalog.optionGroups.find(group => group.options.some(option => option.id === targetId));
  if (!group || !group.visible) return null;
  const minimum = getPosOptionSelectionRules(group).min;
  const remaining = { ...group, options: group.options.filter(option => option.id !== targetId) };
  const consumers = catalog.items.filter(item => getDineInEffectiveItemGroupIds(catalog, item.id).includes(group.id));
  const possible = consumers.length ? consumers.every(item => selectedGroupCapacity(remaining, item)) : selectedGroupCapacity(remaining);
  return minimum > 0 && !possible
    ? '必須の選択数を満たす選択肢を残してください。不要な場合はグループ全体を削除してください。' : null;
}
/** Validate the final selection once, before archiving anything. Individual
 * checks cannot detect a batch that collectively removes a required choice. */
export function getDineInBulkOptionDeleteDisabledReason(catalog: StoreDineInCatalog, optionIds: string[]): string | null {
  if (!optionIds.length) return '削除する選択肢を選択してください。';
  if (optionIds.length > 500 || new Set(optionIds).size !== optionIds.length) return '一度に削除できる選択肢は重複なく500件までです。';
  const selected = new Set(optionIds);
  const existing = new Set(catalog.optionGroups.flatMap(group => group.options.map(option => option.id)));
  if (optionIds.some(id => !existing.has(id))) return '選択肢が変更されています。再読込して選び直してください。';
  if ((catalog.trash?.length || 0) + optionIds.length > 500) return '削除済みの項目が500件を超えます。管理者に確認してください。';
  for (const group of catalog.optionGroups) {
    if (!group.visible || !group.options.some(option => selected.has(option.id))) continue;
    const remaining = { ...group, options: group.options.filter(option => !selected.has(option.id)) };
    const consumers = catalog.items.filter(item => getDineInEffectiveItemGroupIds(catalog, item.id).includes(group.id));
    if (!(consumers.length ? consumers.every(item => selectedGroupCapacity(remaining, item)) : selectedGroupCapacity(remaining))) {
      return '必須の選択数を満たす選択肢を残してください。不要な場合はグループ全体を削除してください。';
    }
  }
  return null;
}
/** Option visibility is independent of its parent, linked products and trash.
 * Showing choices only improves capacity; hiding must check the final subset
 * for every consumer before any selected flag is changed. */
export function getDineInBulkOptionVisibilityDisabledReason(catalog: StoreDineInCatalog, optionIds: string[], visible: boolean): string | null {
  if (!optionIds.length) return '表示設定を変更する選択肢を選択してください。';
  if (optionIds.length > 500 || new Set(optionIds).size !== optionIds.length) return '一度に変更できる選択肢は重複なく500件までです。';
  const selected = new Set(optionIds);
  const existing = new Set(catalog.optionGroups.flatMap(group => group.options.map(option => option.id)));
  if (optionIds.some(id => !existing.has(id))) return '選択肢が変更されています。再読込して選び直してください。';
  if (visible) return null;
  for (const group of catalog.optionGroups) {
    if (!group.visible || !group.options.some(option => selected.has(option.id) && option.visible)) continue;
    const remaining = { ...group, options: group.options.map(option => selected.has(option.id) ? { ...option, visible: false } : option) };
    const consumers = catalog.items.filter(item => getDineInEffectiveItemGroupIds(catalog, item.id).includes(group.id));
    if (!(consumers.length ? consumers.every(item => selectedGroupCapacity(remaining, item)) : selectedGroupCapacity(remaining))) {
      return '必須の選択数を満たす選択肢を残してください。グループ全体を非公開にすることもできます。';
    }
  }
  return null;
}
/** Category placement must not inherit the destination category's choices or
 * rewrite a shared group used by another product. Preserve the old effective
 * scope in item-owned copies while retaining source identities and requirements. */
function moveDineInItemCategory(catalog: StoreDineInCatalog, item: StoreDineInItem, category: string, uuid: () => string) {
  const previousCategory = item.category || '未分類';
  if (previousCategory === category) return;
  const groups = new Map(catalog.optionGroups.map(group => [group.id, group]));
  const replaced = new Set<string>();
  item.optionGroupIds = item.optionGroupIds.flatMap(id => {
    const group = groups.get(id); if (!group) return [id];
    if (group.explicitItemLinks) return [id];
    const applies = (!group.menuCatalogItemId || group.menuCatalogItemId === item.id)
      && (Boolean(group.menuCatalogItemId) || !group.applicableCategories.length || group.applicableCategories.includes(previousCategory));
    // A previously inactive linked group must not become active solely because
    // this item is moved into a category for which it was never configured.
    if (!applies) return [];
    if (!group.applicableCategories.length && group.options.every(option => !option.applicableCategories.length)) return [id];
    const copy: StoreDineInGroup = { ...structuredClone(group), id: uuid(), menuCatalogItemId: item.id,
      applicableCategories: [category],
      options: group.options.map(option => ({ ...copyDineInOption(catalog, option, uuid),
        // Keep both applicable and inapplicable options in the snapshot, so an
        // unsatisfied required group cannot turn into a historical empty group.
        applicableCategories: !option.applicableCategories.length ? []
          : [option.applicableCategories.includes(previousCategory) ? category : previousCategory] })) };
    copyDineInReviewBaseline(catalog, 'group', group.id, copy.id, group.sourceGroupId);
    replaced.add(id); catalog.optionGroups.push(copy); return [copy.id];
  });
  item.category = category;
  const referenced = new Set(catalog.items.flatMap(item => item.optionGroupIds));
  catalog.optionGroups = catalog.optionGroups.filter(group => !replaced.has(group.id) || referenced.has(group.id));
}
function removeLocalDineInTarget(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string) {
  const { kind, targetId } = change;
  if (kind === 'item') {
    if (!catalog.items.some(item => item.id === targetId)) return missing();
    const ownedGroups = new Set(catalog.optionGroups.filter(group => !group.explicitItemLinks && group.menuCatalogItemId === targetId).map(group => group.id));
    catalog.items = catalog.items.filter(item => item.id !== targetId);
    const removedGroups = catalog.optionGroups.filter(group => ownedGroups.has(group.id));
    catalog.optionGroups = catalog.optionGroups.filter(group => !ownedGroups.has(group.id));
    for (const item of catalog.items) {
      // Older/shared local graphs can still reference an item-owned group. Give
      // each surviving product an isolated copy before removing its old owner.
      const copies = new Map<string, string>();
      for (const group of removedGroups.filter(group => item.optionGroupIds.includes(group.id))) {
        const copy = cloneDineInGroupForItem(catalog, group, item, uuid);
        copies.set(group.id, copy.id); catalog.optionGroups.push(copy);
      }
      item.optionGroupIds = item.optionGroupIds.map(id => copies.get(id) || id);
    }
  } else if (kind === 'group') {
    if (!catalog.optionGroups.some(group => group.id === targetId)) return missing();
    catalog.optionGroups = catalog.optionGroups.filter(group => group.id !== targetId);
    for (const item of catalog.items) item.optionGroupIds = item.optionGroupIds.filter(id => id !== targetId);
  } else if (kind === 'option') {
    const group = catalog.optionGroups.find(group => group.options.some(option => option.id === targetId)); if (!group) return missing();
    const reason = getDineInDeleteDisabledReason(catalog, 'option', targetId!); if (reason) invalid(reason);
    group.options = group.options.filter(option => option.id !== targetId);
  } else if (kind === 'category') {
    const category = catalog.categories.find(category => category.id === targetId); if (!category) return missing();
    const replacement = change.replacementCategoryId ? catalog.categories.find(other => other.id === change.replacementCategoryId && other.id !== category.id) : undefined;
    if (change.replacementCategoryId && !replacement) invalid('別の商品分類を移動先に選択してください。');
    if (catalog.items.some(item => item.category === category.name) && !replacement) invalid('商品がある分類は移動先の商品分類を選択してください。商品は削除されません。');
    if (replacement) for (const item of catalog.items.filter(item => item.category === category.name)) moveDineInItemCategory(catalog, item, replacement.name, uuid);
    // With no products to move, retain inert source applicability names. Clearing
    // an only-category scope to [] would incorrectly make it a global choice.
    catalog.categories = catalog.categories.filter(other => other.id !== category.id);
  } else return missing();
}
/** Convert only a touched group, preserving every retained effective pair's old option subset. */
function makeDineInGroupExplicit(catalog: StoreDineInCatalog, group: StoreDineInGroup) {
  if (group.explicitItemLinks) return;
  const members = new Set(getDineInGroupItemIds(catalog, group.id)), exclusions: Record<string, string[]> = {};
  for (const item of catalog.items) {
    if (!members.has(item.id)) { item.optionGroupIds = item.optionGroupIds.filter(id => id !== group.id); continue; }
    const excluded = group.options.filter(option => !optionAppliesToItem(option, group, item)).map(option => option.id);
    if (excluded.length) exclusions[item.id] = excluded;
  }
  group.explicitItemLinks = true; group.menuCatalogItemId = ''; group.applicableCategories = [];
  group.itemOptionExclusions = exclusions;
}
function checkNewDineInAssociation(catalog: StoreDineInCatalog, item: StoreDineInItem, group: StoreDineInGroup) {
  if (item.brandId !== group.brandId) invalid('同じ店舗・ブランドの項目を選択してください。');
  if (!selectedGroupCapacity(group, item)) invalid('この商品の選択肢では必須の選択数を満たせません。');
}
function setDineInItemOptionGroups(catalog: StoreDineInCatalog, change: StoreDineInChange) {
  const item = catalog.items.find(item => item.id === change.targetId); if (!item) return missing();
  const requested = change.groupIds!, previous = getDineInEffectiveItemGroupIds(catalog, item.id), previousSet = new Set(previous);
  const groups = new Map(catalog.optionGroups.map(group => [group.id, group]));
  if (requested.some(id => !groups.has(id) || groups.get(id)!.brandId !== item.brandId)) invalid('同じ店舗・ブランドの選択グループを選択してください。');
  const touched = [...new Set([...item.optionGroupIds, ...requested])];
  // A retained set is not permission to expand any historical scope.
  if (requested.length === previous.length && requested.every(id => previousSet.has(id))) return;
  for (const id of touched) { const group = groups.get(id); if (group) makeDineInGroupExplicit(catalog, group); }
  const keep = item.optionGroupIds.filter(id => requested.includes(id));
  item.optionGroupIds = [...keep, ...requested.filter(id => !keep.includes(id))];
  for (const id of touched) {
    const group = groups.get(id); if (!group) continue;
    if (!requested.includes(id)) { if (group.itemOptionExclusions) delete group.itemOptionExclusions[item.id]; continue; }
    if (!previousSet.has(id)) { if (group.itemOptionExclusions) delete group.itemOptionExclusions[item.id]; checkNewDineInAssociation(catalog, item, group); }
  }
}
function setDineInGroupItems(catalog: StoreDineInCatalog, change: StoreDineInChange) {
  const group = catalog.optionGroups.find(group => group.id === change.targetId); if (!group) return missing();
  const requested = change.itemIds!, previous = new Set(getDineInGroupItemIds(catalog, group.id));
  const items = new Map(catalog.items.map(item => [item.id, item]));
  if (requested.some(id => !items.has(id) || items.get(id)!.brandId !== group.brandId)) invalid('同じ店舗・ブランドの商品を選択してください。');
  if (requested.length === previous.size && requested.every(id => previous.has(id))) return;
  makeDineInGroupExplicit(catalog, group);
  for (const item of catalog.items) {
    if (!requested.includes(item.id)) {
      item.optionGroupIds = item.optionGroupIds.filter(id => id !== group.id);
      if (group.itemOptionExclusions) delete group.itemOptionExclusions[item.id];
    } else if (!previous.has(item.id)) {
      if (!item.optionGroupIds.includes(group.id)) item.optionGroupIds.push(group.id);
      if (group.itemOptionExclusions) delete group.itemOptionExclusions[item.id];
      checkNewDineInAssociation(catalog, item, group);
    }
  }
}
/** Existing malformed historical graphs stay unchanged until an action introduces a new problem. */
function dineInLinkedProductProblems(catalog: StoreDineInCatalog): Map<string, string> {
  const problems = new Map<string, string>(), items = new Map(catalog.items.map(item => [item.id, item])), edges = new Map<string, Set<string>>();
  for (const item of catalog.items) {
    const linked = new Set<string>(); edges.set(item.id, linked);
    for (const id of getDineInEffectiveItemGroupIds(catalog, item.id)) {
      const group = catalog.optionGroups.find(group => group.id === id)!;
      for (const option of group.options) {
        if (!option.linkedItemId || !optionAppliesToItem(option, group, item)) continue;
        const target = items.get(option.linkedItemId); if (!target) continue; // Archived product choices are unavailable, not repointed.
        linked.add(target.id);
        if (target.brandId !== item.brandId || getDineInLinkedItemDisabledReason(catalog, target)) problems.set(`configuration:${item.id}:${option.id}`, '関連する商品に必須の選択や計量販売を設定できません。商品と選択グループの関連を確認してください。');
      }
    }
  }
  const visiting = new Set<string>(), done = new Set<string>(), trail: string[] = [];
  function visit(id: string) {
    if (visiting.has(id)) { const cycle = trail.slice(trail.indexOf(id)).sort().join(':'); problems.set(`cycle:${cycle}`, '商品を自分自身の選択肢にしたり、相互に関連付けたりすることはできません。'); return; }
    if (done.has(id)) return;
    visiting.add(id); trail.push(id); for (const next of edges.get(id) || []) visit(next); trail.pop(); visiting.delete(id); done.add(id);
  }
  for (const id of edges.keys()) visit(id);
  return problems;
}

function completeOrder<T extends { id: string; sortOrder: number }>(entries: T[], ids: string[]): T[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  if (ids.length !== entries.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) invalid('現在の項目をすべて重複なく指定してください。再読込してください。');
  return ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }));
}
function reorderLocalDineInTargets(catalog: StoreDineInCatalog, change: StoreDineInChange) {
  if (change.kind === 'category') catalog.categories = completeOrder(catalog.categories, change.ids!);
  else if (change.kind === 'item') catalog.items = completeOrder(catalog.items, change.ids!);
  else if (change.kind === 'option') {
    const group = catalog.optionGroups.find(group => group.id === change.targetId); if (!group) return missing();
    group.options = completeOrder(group.options, change.ids!);
  } else {
    const item = catalog.items.find(item => item.id === change.targetId); if (!item) return missing();
    const effectiveIds = getDineInEffectiveItemGroupIds(catalog, item.id);
    const groups = effectiveIds.map(id => catalog.optionGroups.find(group => group.id === id)!);
    // Retain inactive historical placeholders without activating or requiring them in an ordinary order edit.
    item.optionGroupIds = [...completeOrder(groups, change.ids!).map(group => group.id), ...item.optionGroupIds.filter(id => !effectiveIds.includes(id))];
  }
}
function archiveLocalDineInTarget(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string) {
  if ((catalog.trash?.length || 0) >= 500) invalid('削除済みの項目が500件に達しました。管理者に確認してください。');
  const entry: StoreDineInTrashEntry = { id: uuid(), kind: change.kind!, targetId: change.targetId!, name: '', deletedAt: new Date().toISOString(), payload: {} };
  if (change.kind === 'item') {
    const item = catalog.items.find(item => item.id === change.targetId); if (!item) return missing();
    entry.name = item.name; entry.payload.items = [structuredClone(item)];
    entry.payload.categories = structuredClone(catalog.categories.filter(category => category.name === item.category));
    entry.payload.optionGroups = structuredClone(catalog.optionGroups.filter(group => item.optionGroupIds.includes(group.id) || group.menuCatalogItemId === item.id));
  } else if (change.kind === 'group') {
    const group = catalog.optionGroups.find(group => group.id === change.targetId); if (!group) return missing();
    entry.name = group.name; entry.payload.optionGroups = [structuredClone(group)];
    entry.payload.attachments = catalog.items.filter(item => item.optionGroupIds.includes(group.id)).map(item => ({ itemId: item.id, groupIds: [...item.optionGroupIds] }));
  } else if (change.kind === 'option') {
    const group = catalog.optionGroups.find(group => group.options.some(option => option.id === change.targetId)); if (!group) return missing();
    const option = group.options.find(option => option.id === change.targetId)!;
    entry.name = option.name; entry.payload.options = [{ groupId: group.id, option: structuredClone(option) }];
  } else {
    const category = catalog.categories.find(category => category.id === change.targetId); if (!category) return missing();
    entry.name = category.name; entry.payload.categories = [structuredClone(category)];
  }
  const retainedIds = new Set([
    ...(entry.payload.items || []).map(row => `item:${row.id}`),
    ...(entry.payload.optionGroups || []).flatMap(group => [`group:${group.id}`, ...group.options.map(option => `option:${option.id}`)]),
    ...(entry.payload.options || []).map(row => `option:${row.option.id}`)
  ]);
  if (catalog.sourceReview) entry.payload.sourceReview = { version: 1,
    baseline: Object.fromEntries(Object.entries(catalog.sourceReview.baseline).filter(([key]) => retainedIds.has(key))),
    decisions: catalog.sourceReview.decisions.filter(row => retainedIds.has(row.key)) };
  removeLocalDineInTarget(catalog, change, uuid);
  (catalog.trash ||= []).push(entry);
}
function restoreLocalDineInTarget(catalog: StoreDineInCatalog, entryId: string) {
  const entry = catalog.trash?.find(row => row.id === entryId); if (!entry) return missing();
  const allIds = () => new Set([...catalog.items, ...catalog.optionGroups, ...catalog.categories, ...catalog.optionGroups.flatMap(group => group.options)].map(row => row.id));
  if (allIds().has(entry.targetId)) invalid('同じ項目が既に存在するため復元できません。再読込してください。');
  const payload = entry.payload;
  if (catalog.items.length + (payload.items?.length || 0) > 500
    || catalog.optionGroups.length + (payload.optionGroups || []).filter(group => !catalog.optionGroups.some(row => row.id === group.id)).length > 1000
    || catalog.categories.length + (payload.categories || []).filter(category => !catalog.categories.some(row => row.name === category.name)).length > 100) invalid('復元後の項目数が上限を超えます。内容を整理してください。');
  for (const group of payload.optionGroups || []) {
    if (catalog.optionGroups.some(row => row.id === group.id)) continue; // Preserve surviving shared edits.
    if (group.menuCatalogItemId && !catalog.items.some(item => item.id === group.menuCatalogItemId) && !payload.items?.some(item => item.id === group.menuCatalogItemId)) invalid('所属する商品を先に復元してください。');
    if ([group.id, ...group.options.map(option => option.id)].some(id => allIds().has(id))) invalid('項目の構成が変わったため復元できません。');
  }
  for (const category of payload.categories || []) {
    if (entry.kind === 'category' && catalog.categories.some(row => row.name === category.name)) invalid('同じ名前の商品分類があるため復元できません。');
    if (catalog.categories.some(row => row.id === category.id && row.name !== category.name)) invalid('商品分類の構成が変わったため復元できません。');
  }
  for (const { groupId, option } of payload.options || []) {
    if (!catalog.optionGroups.some(group => group.id === groupId)) invalid('所属する選択グループを先に復元してください。');
    if (allIds().has(option.id)) invalid('同じ選択肢が既に存在します。');
    if (catalog.optionGroups.find(group => group.id === groupId)!.options.length >= 500) invalid('選択肢は1グループ500件までです。');
  }
  catalog.items.push(...structuredClone(payload.items || []));
  for (const category of payload.categories || []) if (!catalog.categories.some(row => row.name === category.name)) catalog.categories.push(structuredClone(category));
  for (const group of payload.optionGroups || []) if (!catalog.optionGroups.some(row => row.id === group.id)) catalog.optionGroups.push(structuredClone(group));
  for (const { groupId, option } of payload.options || []) catalog.optionGroups.find(group => group.id === groupId)!.options.push(structuredClone(option));
  if (entry.kind === 'group') for (const attachment of payload.attachments || []) {
    const item = catalog.items.find(item => item.id === attachment.itemId); if (!item || item.optionGroupIds.includes(entry.targetId)) continue;
    const position = attachment.groupIds.indexOf(entry.targetId), later = attachment.groupIds.slice(position + 1).find(id => item.optionGroupIds.includes(id));
    item.optionGroupIds.splice(later ? item.optionGroupIds.indexOf(later) : item.optionGroupIds.length, 0, entry.targetId);
  }
  for (const entries of [catalog.items, catalog.categories, catalog.optionGroups, ...catalog.optionGroups.map(group => group.options)]) entries.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  if (payload.sourceReview) {
    const state = catalog.sourceReview ||= { version: 1, baseline: {}, decisions: [] };
    state.baseline = { ...structuredClone(payload.sourceReview.baseline), ...state.baseline };
    state.decisions = [...structuredClone(payload.sourceReview.decisions), ...state.decisions].slice(-100);
  }
  catalog.trash = catalog.trash!.filter(row => row.id !== entryId);
}
function selectedGroupCapacity(group: StoreDineInGroup, item?: StoreDineInItem): boolean {
  const { min, max, type, perOptionMax } = getPosOptionSelectionRules(group);
  const available = group.options.filter(option => option.visible && (!item || optionAppliesToItem(option, group, item))).length;
  return min === 0 || max >= min && available > 0 && available * (type === 'quantity' ? perOptionMax : 1) >= min;
}
function importLocalDineInGroup(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string, context?: DineInChangeContext) {
  const item = catalog.items.find(item => item.id === change.itemId); if (!item) return missing();
  const sourceCatalog = change.origin === 'brand' ? context?.source : catalog;
  const source = sourceCatalog?.optionGroups.find(group => group.id === change.sourceGroupId && group.brandId === item.brandId); if (!source) return missing();
  if (catalog.optionGroups.length >= 1000) invalid('選択グループは1000件までです。');
  const ids = change.optionIds || source.options.map(option => option.id);
  if (ids.some(id => !source.options.some(option => option.id === id))) invalid('取込元の選択肢を確認してください。');
  const copy: StoreDineInGroup = { ...structuredClone(source), id: uuid(), menuCatalogItemId: item.id, localKind: 'imported',
    applicableCategories: [], name: change.name || source.name, posEnabled: true, visible: true,
    sortOrder: Math.max(0, ...catalog.optionGroups.map(group => group.sortOrder)) + 1,
    options: source.options.filter(option => ids.includes(option.id)).map((option, sortOrder) => ({
      ...structuredClone(option), id: uuid(), sourceGroupId: option.sourceGroupId || source.sourceGroupId,
      sourceGroupName: option.sourceGroupName || source.sourceName || source.name,
      sourceGroupRuleJson: structuredClone(option.sourceGroupRuleJson || source.ruleJson),
      // This deliberate per-product import replaces the old product/category placement only.
      applicableCategories: [], visible: true, sortOrder
    })) };
  delete copy.explicitItemLinks; delete copy.itemOptionExclusions;
  if (change.name && change.name !== source.name) copy.displayNames = {};
  if (copy.options.some(option => option.linkedItemId && !catalog.items.some(row => row.id === option.linkedItemId))) invalid('関連する商品がない選択肢は取り込めません。');
  if (!selectedGroupCapacity(copy, item)) invalid('必須の選択数を満たす選択肢を取り込んでください。');
  // A standalone group copy is never an ingredient merge. Retain its source selection key and rules.
  if (change.origin === 'store') {
    copyDineInReviewBaseline(catalog, 'group', source.id, copy.id, source.sourceGroupId);
    for (let index = 0; index < copy.options.length; index++) {
      const original = source.options.filter(option => ids.includes(option.id))[index];
      copyDineInReviewBaseline(catalog, 'option', original.id, copy.options[index].id, original.sourceOptionId);
    }
  }
  catalog.optionGroups.push(copy); item.optionGroupIds.push(copy.id);
}
function setLocalDineInGroupSelection(catalog: StoreDineInCatalog, change: StoreDineInChange) {
  const group = catalog.optionGroups.find(group => group.id === change.targetId); if (!group) return missing();
  if (isDineInSingleChoiceGroup(group) && change.selectionType !== 'single') invalid('辛さ・しびれは1つ選択のまま管理してください。');
  const minimum = change.minSelections!, maximum = change.maxSelections!, perOptionMaximum = change.perOptionMax!;
  const consumers = catalog.items.filter(item => getDineInEffectiveItemGroupIds(catalog, item.id).includes(group.id));
  const proposed = { ...group, selectionType: change.selectionType!, ruleJson: { ...group.ruleJson,
    minSelections: minimum, maxSelections: maximum, limit: maximum, allowRepeat: change.selectionType === 'quantity', perOptionMax: perOptionMaximum } };
  if (!selectedGroupCapacity(proposed) || consumers.some(item => !selectedGroupCapacity(proposed, item))) invalid('現在の選択肢で最小選択数を満たせません。');
  group.selectionType = proposed.selectionType; group.ruleJson = proposed.ruleJson;
}
function linkLocalDineInItems(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string) {
  const group = catalog.optionGroups.find(group => group.id === change.targetId && (group.localKind === 'choice' || group.localKind === 'addon'));
  if (!group) return missing();
  const members = new Set(getDineInGroupItemIds(catalog, group.id));
  const selected = change.itemIds!.map(id => catalog.items.find(item => item.id === id));
  if (selected.some(item => !item || item.brandId !== group.brandId || members.has(item.id))) invalid('この店舗の別の商品を選択してください。');
  for (const item of selected as StoreDineInItem[]) {
    const reason = getDineInLinkedItemDisabledReason(catalog, item); if (reason) invalid(reason);
    if (group.options.some(option => option.linkedItemId === item.id)) invalid('この商品は既に関連付けされています。');
  }
  if (group.options.length + selected.length > 500) invalid('選択肢は1グループ500件までです。');
  for (const item of selected as StoreDineInItem[]) group.options.push({ id: uuid(), sourceOptionId: '', sourceName: '', linkedItemId: item.id,
    optionKey: `linked-item:${item.id}`, applicableCategories: [], name: item.name, displayNames: structuredClone(item.displayNames), priceDelta: item.price,
    sortOrder: group.options.length, visible: true });
}

export type DineInChangeContext = { brandId: string; brandName: string; source?: StoreDineInCatalog; weightPricing?: { unit: string; unitPrice: number | null } };
export function normalizeDineInCatalogPricing(catalog: StoreDineInCatalog): StoreDineInCatalog {
  const items = catalog.items.map(normalizePosItemPricing), byId = new Map(items.map(item => [item.id, item]));
  return { ...catalog, items, optionGroups: catalog.optionGroups.map(group => ({ ...group, options: group.options.map(option => {
    const item = option.linkedItemId ? byId.get(option.linkedItemId) : undefined;
    return item ? { ...option, name: item.name, displayNames: structuredClone(item.displayNames), priceDelta: item.price } : option;
  }) })) };
}
/** Retained source identity prevents renaming a heat/numb group to bypass its single choice. */
export function isDineInSingleChoiceGroup(group: StoreDineInGroup): boolean {
  return /(?:^|[\s_-])(?:heat|numb)(?:$|[\s_-])|辣度|麻度|辛さ|しびれ|痺れ/i.test(`${group.groupKey} ${group.sourceName || group.name}`);
}
export function getDineInLinkedItemDisabledReason(catalog: StoreDineInCatalog, item: StoreDineInItem): string | null {
  if (item.posPricingMode !== 'fixed' || item.productionType === 'bowl') return '個数販売のドリンク・単品を選択してください。';
  if (getDineInEffectiveItemGroupIds(catalog, item.id).some(id => { const group = catalog.optionGroups.find(group => group.id === id)!; return group.visible && Number(group.ruleJson.minSelections || 0) > 0 && group.options.length > 0; })) return '必須の選択がある商品はそのまま関連付けできません。選択のない単品を使用してください。';
  return null;
}
function applyItemPricing(item: StoreDineInItem, mode: PosItemPricingMode, context?: DineInChangeContext) {
  if (mode === 'weight' && item.itemKind === 'drink') invalid('ドリンクは固定価格で販売してください。');
  if (mode === 'weight') {
    const rate = context?.weightPricing;
    if (!rate || !rate.unit || rate.unitPrice === null || !Number.isFinite(rate.unitPrice) || rate.unitPrice <= 0) invalid('店舗の POS 設定で重量単価を設定してください。');
    item.posWeightUnit = rate.unit; item.posWeightUnitPrice = rate.unitPrice;
  }
  item.posPricingOverride = mode; item.posPricingMode = mode;
}
function applyDineInChangeUnsafe(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string, context?: DineInChangeContext): StoreDineInCatalog {
  const next = structuredClone(normalizeDineInCatalogPricing(catalog));
  if (change.action === 'setEnabled' || change.action === 'initialize') return next;
  if (change.action === 'setFulfillmentMode') {
    const target = change.kind === 'item' ? next.items.find(item => item.id === change.targetId) : next.categories.find(category => category.id === change.targetId);
    if (!target) return missing();
    if (context?.brandId && target.brandId !== context.brandId) invalid('同じ店舗・ブランドの項目を選択してください。');
    if (change.fulfillmentMode === 'immediate') {
      if (change.kind === 'item' && isPosBowl(target as StoreDineInItem)) invalid('1杯ごとに調理する商品は、調理・呼出しで提供してください。');
      if (change.kind === 'category' && next.items.some(item => item.brandId === target.brandId && item.category === target.name && isPosBowl(item))) invalid('1杯ごとに調理する商品を含む分類は、会計時のお渡しに変更できません。');
    }
    if (change.fulfillmentMode === 'inherit') delete target.fulfillmentMode;
    else target.fulfillmentMode = change.fulfillmentMode!;
    return next;
  }
  if (change.action === 'setItemOptionGroups') { setDineInItemOptionGroups(next, change); return next; }
  if (change.action === 'setGroupItems') { setDineInGroupItems(next, change); return next; }
  if (change.action === 'createOption') {
    const group = next.optionGroups.find(group => group.id === change.targetId); if (!group) return missing();
    if (context?.brandId && group.brandId !== context.brandId) invalid('同じ店舗・ブランドの項目を選択してください。');
    if (group.options.length >= 500) invalid('選択肢は1グループ500件までです。');
    // Explicit creation adds a choice to current consumers without expanding
    // retained choices that their old per-product allowlists excluded.
    makeDineInGroupExplicit(next, group);
    const id = uuid(), defaultGrams = Number(group.ruleJson.portionGrams);
    const grams = change.portionGrams ?? (Number.isSafeInteger(defaultGrams) && defaultGrams > 0 && defaultGrams <= 99_999 ? defaultGrams : undefined);
    group.options.push({ id, localOnly: true, localOriginId: id, sourceOptionId: '', sourceName: '',
      optionKey: `store-option-${id}`, applicableCategories: [], name: change.name!, displayNames: {}, priceDelta: change.price!,
      sourceGroupRuleJson: grams === undefined ? {} : { portionGrams: grams },
      sortOrder: Math.max(0, ...group.options.map(option => option.sortOrder)) + 1, visible: true });
    return next;
  }
  if (change.action === 'setOptionsVisibility') {
    const reason = getDineInBulkOptionVisibilityDisabledReason(next, change.optionIds!, change.visible!);
    if (reason) invalid(reason);
    const selected = new Set(change.optionIds);
    for (const group of next.optionGroups) for (const option of group.options) if (selected.has(option.id)) option.visible = change.visible!;
    return next;
  }
  if (change.action === 'delete') { archiveLocalDineInTarget(next, change, uuid); return next; }
  if (change.action === 'deleteOptions') {
    const reason = getDineInBulkOptionDeleteDisabledReason(next, change.optionIds!);
    if (reason) invalid(reason);
    for (const targetId of change.optionIds!) archiveLocalDineInTarget(next, { ...change, action: 'delete', kind: 'option', targetId }, uuid);
    return next;
  }
  if (change.action === 'restore') { restoreLocalDineInTarget(next, change.targetId!); return next; }
  if (change.action === 'reorder') { reorderLocalDineInTargets(next, change); return next; }
  if (change.action === 'importOptionGroup') { importLocalDineInGroup(next, change, uuid, context); return next; }
  if (change.action === 'setGroupSelection') { setLocalDineInGroupSelection(next, change); return next; }
  if (change.action === 'linkItemOptions') { linkLocalDineInItems(next, change, uuid); return next; }
  if (change.action === 'setItemPrice') {
    const item = next.items.find(item => item.id === change.targetId); if (!item) return missing();
    if (item.posPricingMode !== 'fixed') invalid('計量販売の商品は重量単価で計算します。個数販売の商品を選択してください。');
    item.price = change.price!; item.priceOverride = change.price!; return normalizeDineInCatalogPricing(next);
  }
  if (change.action === 'setItemCategory') {
    const item = next.items.find(item => item.id === change.targetId); if (!item) return missing();
    const category = next.categories.find(category => category.id === change.categoryId); if (!category) return missing();
    moveDineInItemCategory(next, item, category.name, uuid); return next;
  }
  if (change.action === 'setOptionPrice') {
    const option = next.optionGroups.flatMap(group => group.options).find(option => option.id === change.targetId); if (!option) return missing();
    if (option.linkedItemId) invalid('関連商品の名前・価格は商品側で変更してください。');
    option.priceDelta = change.price!; return next;
  }
  if (change.action === 'createCategory') {
    if (!context) return missing();
    if (next.categories.length >= 100) invalid('商品分類は100件までです。');
    if (next.categories.some(category => category.name === change.name)) invalid('同じ名前の商品分類があります。');
    next.categories.push({ id: uuid(), brandId: context.brandId, name: change.name!, sortOrder: Math.max(0, ...next.categories.map(category => category.sortOrder)) + 100 });
    return next;
  }
  if (change.kind === 'category') {
    const category = next.categories.find(category => category.id === change.targetId); if (!category) return missing();
    if (next.categories.some(other => other.id !== category.id && other.name === change.name)) invalid('同じ名前の商品分類があります。');
    for (const item of next.items.filter(item => item.category === category.name)) item.category = change.name!;
    for (const group of next.optionGroups) {
      group.applicableCategories = group.applicableCategories.map(name => name === category.name ? change.name! : name);
      for (const option of group.options) option.applicableCategories = option.applicableCategories.map(name => name === category.name ? change.name! : name);
    }
    category.name = change.name!; return next;
  }
  if (change.action === 'createItem' || change.action === 'importItem') {
    if (!context) return missing();
    if (next.items.length >= 500) invalid('店内商品は500件までです。');
    let category = change.categoryId ? next.categories.find(category => category.id === change.categoryId) : undefined;
    if (change.categoryId && !category) return missing();
    if (change.action === 'createItem') {
      if (!category) return missing();
      const itemKind = change.itemKind!;
      next.items.push({ id: uuid(), sourceItemId: uuid(), sourceName: change.name!, brandId: context.brandId, brandName: context.brandName,
        name: change.name!, displayNames: {}, itemKind, category: category.name, imageUrl: '', basePrice: change.price!, priceOverride: null, price: change.price!,
        variableSchema: { storeDineInOnly: true }, posPricingMode: 'fixed', posPricingOverride: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null,
        productionType: itemKind === 'drink' ? 'drink' : itemKind === 'buildable_product' ? 'bowl' : 'item', sortOrder: Math.max(0, ...next.items.map(item => item.sortOrder)) + 100, visible: true, optionGroupIds: [] });
      applyItemPricing(next.items.at(-1)!, change.pricingMode || 'fixed', context);
      return next;
    }
    const sourceItem = context.source?.items.find(item => item.id === change.sourceItemId); if (!sourceItem) return missing();
    const imported = localizeDineInCatalog({ version: 1, items: [sourceItem], optionGroups: context.source!.optionGroups.filter(group => sourceItem.optionGroupIds.includes(group.id)), categories: [] }, uuid);
    const item = imported.items[0];
    if (change.name && change.name !== item.name) { item.name = change.name; item.displayNames = {}; }
    item.visible = true; item.sortOrder = Math.max(0, ...next.items.map(item => item.sortOrder)) + 100;
    if (!category) {
      category = next.categories.find(category => category.name === item.category);
      if (!category) {
        if (next.categories.length >= 100) invalid('商品分類は100件までです。');
        category = { id: uuid(), brandId: context.brandId, name: item.category, sortOrder: Math.max(0, ...next.categories.map(category => category.sortOrder)) + 100 };
        next.categories.push(category);
      }
    }
    const originalCategory = item.category; item.category = category.name;
    // Explicit category placement must not silently remove the imported product's copied options.
    if (item.category !== originalCategory) for (const group of imported.optionGroups) {
      group.menuCatalogItemId = item.id;
      for (const option of group.options) option.applicableCategories = option.applicableCategories.map(name => name === originalCategory ? item.category : name);
    }
    next.items.push(item); next.optionGroups.push(...imported.optionGroups); return next;
  }
  if (change.action === 'setItemPricing') {
    const item = next.items.find(item => item.id === change.targetId); if (!item) return missing();
    applyItemPricing(item, change.pricingMode!, context); return next;
  }
  if (change.action === 'createOptionGroup') {
    const item = next.items.find(item => item.id === change.itemId); if (!item) return missing();
    if (next.optionGroups.length >= 1000) invalid('選択グループは1000件までです。');
    const single = change.selectionType === 'single';
    const group: StoreDineInGroup = { id: uuid(), sourceGroupId: '', sourceName: '', brandId: item.brandId, menuCatalogItemId: item.id, applicableCategories: [],
      groupKey: 'dine-in-choice', name: change.name!, displayNames: {}, selectionType: change.selectionType!,
      ruleJson: { minSelections: 0, maxSelections: single ? 1 : 99, allowRepeat: !single, perOptionMax: single ? 1 : 99 },
      sortOrder: Math.max(0, ...next.optionGroups.map(group => group.sortOrder)) + 1, posEnabled: true, visible: true, options: [], localKind: 'choice' };
    next.optionGroups.push(group); item.optionGroupIds.push(group.id); return next;
  }
  if (change.action === 'reorderAddonOptions') {
    const group = next.optionGroups.find(group => group.id === change.targetId && canDineInGroupImportAddons(group));
    if (!group) return missing();
    const ids = change.optionIds!;
    const byId = new Map(group.options.map(option => [option.id, option]));
    if (ids.length !== group.options.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) invalid('グループ内のすべての食材を重複なく指定してください。');
    group.options = ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }));
    return next;
  }
  if (change.action === 'createAddonGroup' || change.action === 'importAddonOptions') {
    let target = change.action === 'importAddonOptions' ? next.optionGroups.find(group => group.id === change.targetId && canDineInGroupImportAddons(group)) : undefined;
    const item = next.items.find(item => item.id === (change.itemId || (target ? getDineInGroupItemIds(next, target.id)[0] : '')));
    if (!item && change.action === 'createAddonGroup') return missing();
    if (change.action === 'importAddonOptions' && !target) return missing();
    if (!target) {
      if (next.optionGroups.length >= 1000) invalid('選択グループは1000件までです。');
      target = { id: uuid(), sourceGroupId: '', sourceName: '', brandId: item!.brandId, menuCatalogItemId: item!.id, applicableCategories: [], groupKey: 'dine-in-addon',
        // Every increment is one unchanged source portion (for example, 2 × 50g).
        name: change.name!, displayNames: {}, selectionType: 'quantity', ruleJson: { minSelections: 0, maxSelections: 99, allowRepeat: true, perOptionMax: 99 }, sortOrder: Math.max(0, ...next.optionGroups.map(group => group.sortOrder)) + 1,
        posEnabled: true, visible: true, options: [], localKind: 'addon' };
      next.optionGroups.push(target); item!.optionGroupIds.push(target.id);
    }
    moveAddonOptions(next, item, target, change.optionIds!, uuid, context?.source); return next;
  }
  if (change.kind === 'item') {
    const item = next.items.find(item => item.id === change.targetId); if (!item) return missing();
    if (change.action === 'setVisibility') { item.visible = change.visible!; return next; }
    if (change.action === 'rename') { item.name = change.name!; item.displayNames = {}; return normalizeDineInCatalogPricing(next); }
    if (next.items.length >= 500) invalid('店内商品は500件までです。');
    const copy = structuredClone(item); copy.id = uuid();
    copyDineInReviewBaseline(next, 'item', item.id, copy.id, item.sourceItemId); copy.name = change.name!; copy.displayNames = {}; copy.visible = true;
    const groupIds = new Map<string, string>();
    for (const group of next.optionGroups.filter(group => !group.explicitItemLinks && group.menuCatalogItemId === item.id)) {
      const groupCopy = structuredClone(group); groupCopy.id = uuid(); groupCopy.menuCatalogItemId = copy.id;
      groupCopy.options = groupCopy.options.map(option => copyDineInOption(next, option, uuid));
      copyDineInReviewBaseline(next, 'group', group.id, groupCopy.id, group.sourceGroupId);
      groupIds.set(group.id, groupCopy.id); next.optionGroups.push(groupCopy);
    }
    copy.optionGroupIds = copy.optionGroupIds.map(id => groupIds.get(id) ?? id);
    for (const group of next.optionGroups.filter(group => group.explicitItemLinks && copy.optionGroupIds.includes(group.id))) {
      const excluded = group.itemOptionExclusions?.[item.id];
      if (excluded?.length) (group.itemOptionExclusions ||= {})[copy.id] = [...excluded];
    }
    next.items.push(copy); return next;
  }
  const group = next.optionGroups.find(group => change.kind === 'group' ? group.id === change.targetId : group.options.some(option => option.id === change.targetId));
  if (!group) return missing();
  if (change.action === 'setVisibility') {
    if (change.kind === 'group') { group.visible = change.visible!; group.posEnabled = change.visible!; }
    else group.options.find(option => option.id === change.targetId)!.visible = change.visible!;
    const consumers = next.items.filter(item => getDineInEffectiveItemGroupIds(next, item.id).includes(group.id));
    if (group.visible && (!selectedGroupCapacity(group) || consumers.some(item => !selectedGroupCapacity(group, item)))) invalid('必須の選択数を満たす選択肢を残してください。グループ全体を非公開にすることもできます。');
    return next;
  }
  if (change.kind === 'group') { group.name = change.name!; group.displayNames = {}; return next; }
  const option = group.options.find(option => option.id === change.targetId); if (!option) return missing();
  if (change.action === 'rename') { if (option.linkedItemId) invalid('関連商品の名前・価格は商品側で変更してください。'); option.name = change.name!; option.displayNames = {}; return next; }
  if (option.linkedItemId) invalid('関連する商品は商品を選んで関連付けしてください。');
  if (group.options.length >= 500) invalid('選択肢は1グループ500件までです。');
  if (!isLocalDineInOption(option) && (group.localKind === 'addon' || group.localKind === 'choice')) invalid('統合した食材は元の商品から取り込んでください。');
  group.options.push({ ...copyDineInOption(next, option, uuid), name: change.name!, displayNames: {}, visible: true }); return next;
}
/** Canonical IDs in a trusted preview become local IDs only once, at initialization/import. */
export function localizeDineInCatalog(source: StoreDineInCatalog, uuid: () => string): StoreDineInCatalog {
  const catalog = structuredClone(source), itemIds = new Map(catalog.items.map(item => [item.id, uuid()])), groupIds = new Map(catalog.optionGroups.map(group => [group.id, uuid()]));
  catalog.items = catalog.items.map(item => ({ ...item, id: itemIds.get(item.id)!, optionGroupIds: item.optionGroupIds.map(id => groupIds.get(id)!).filter(Boolean) }));
  catalog.optionGroups = catalog.optionGroups.map(group => {
    const optionIds = new Map(group.options.map(option => [option.id, uuid()]));
    return { ...group, id: groupIds.get(group.id)!, menuCatalogItemId: itemIds.get(group.menuCatalogItemId) ?? '',
      ...(group.explicitItemLinks ? { itemOptionExclusions: Object.fromEntries(Object.entries(group.itemOptionExclusions || {}).filter(([id]) => itemIds.has(id)).map(([id, exclusions]) => [itemIds.get(id)!, exclusions.flatMap(optionId => optionIds.has(optionId) ? [optionIds.get(optionId)!] : [])])) } : {}),
      options: group.options.map(option => ({ ...option, id: optionIds.get(option.id)!, ...(option.linkedItemId ? { linkedItemId: itemIds.get(option.linkedItemId) || option.linkedItemId } : {}) })) };
  });
  return catalog;
}

/** Every supported mutation preserves old snapshots and rejects only newly introduced product-link problems. */
export function applyDineInChange(catalog: StoreDineInCatalog, change: StoreDineInChange, uuid: () => string, context?: DineInChangeContext): StoreDineInCatalog {
  const next = applyDineInChangeUnsafe(catalog, change, uuid, context);
  assertDineInLinkedProductChange(catalog, next); return next;
}

export function assertDineInLinkedProductChange(before: StoreDineInCatalog, after: StoreDineInCatalog): void {
  const previous = dineInLinkedProductProblems(before);
  for (const [key, message] of dineInLinkedProductProblems(after)) if (!previous.has(key)) invalid(message);
}
