import { randomUUID } from 'node:crypto';
import { acknowledgeDineInSourceBaseline, applyDineInSourceReview, buildDineInSourceReview, captureDineInSourceBaseline, pruneDineInSourceReview, type SourceReviewContext, type StoreDineInSourceReview } from './store-dine-in-source-review';
import { sql } from './db';
import { posMenuLock } from './pos-menu-settings';
import { isPosSellableItem } from './pos-catalog-policy';
import { isPosBowl } from './pos-serving-policy';
import { applyDineInChange, emptyDineInCatalog, localizeDineInCatalog, normalizeDineInCatalogPricing, type StoreDineInCatalog, type StoreDineInChange, type StoreDineInGroup, type StoreDineInItem, type DineInChangeContext } from './store-dine-in-menu-policy';

export type StoreDineInMenu = { brandId: string; revision: string; enabled: boolean; catalog: StoreDineInCatalog };
export type StoreDineInMenus = { ready: boolean; revision: string; menus: StoreDineInMenu[] };
export type StoreDineInEditorState = {
  ready: boolean; exists: boolean; enabled: boolean; revision: string;
  aggregateRevision: string; catalog: StoreDineInCatalog; sourceReview?: StoreDineInSourceReview; source?: StoreDineInCatalog; pricingDefaults?: { unit: string; unitPrice: number | null };
};
// Review metadata does not change sellable content or interrupt an active POS cart.
const aggregateSql = `md5('pricing-policy-v2:'||coalesce(string_agg(brand_id::text||':'||enabled::text||':'||md5((catalog-'sourceReview')::text),',' order by brand_id),''))`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.map(record) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
const names = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const numberOrNull = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
function failure(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }

export async function readDineInMenus(storeId: string): Promise<StoreDineInMenus> {
  try {
    // Aggregate and rows share one statement snapshot, including disabled rows and new catalogs.
    const result = await sql.query(`select ${aggregateSql} as revision,
      coalesce(jsonb_agg(jsonb_build_object('brandId',brand_id::text,'revision',revision::text,'enabled',enabled,'catalog',catalog) order by brand_id),'[]'::jsonb) as menus
      from store_dine_in_menus where store_id::text=$1`, [storeId]);
    return { ready: true, revision: String(result[0].revision), menus: (result[0].menus as StoreDineInMenu[]).map(menu => ({ ...menu, catalog: normalizeDineInCatalogPricing(menu.catalog) })) };
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return { ready: false, revision: '', menus: [] };
    throw error;
  }
}

/** Lightweight POS change detection: return the same aggregate used by full
 * reads and checkout guards without transferring any catalog JSON. */
export async function readDineInMenuRevision(storeId: string): Promise<Pick<StoreDineInMenus, 'ready' | 'revision'>> {
  try {
    const result = await sql.query(`select ${aggregateSql} as revision from store_dine_in_menus where store_id::text=$1`, [storeId]);
    return { ready: true, revision: String(result[0].revision) };
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return { ready: false, revision: '' };
    throw error;
  }
}

/** Call after posMenuLock, inside the same transaction as order persistence. */
export function dineInMenuGuard(storeId: string, revision: string) {
  return sql.query(`select 1 / case when (select ${aggregateSql} from store_dine_in_menus where store_id::text=$1)=$2
    then 1 else 0 end as dine_in_menu_current`, [storeId, revision]);
}

// Complete trusted source content, not only updated_at: initialization must conflict
// with stock/settings, links, translations, portions or source edits during preparation.
// These fixed SQL fragments never contain client-provided SQL.
const sourceSnapshotSql = `with context as (
    select sb.*,b.name as brand_name,to_jsonb(b) as brand_record,to_jsonb(s) as store_record
    from store_brands sb join brands b on b.id=sb.brand_id join stores s on s.id=sb.store_id
    where sb.store_id::text=$1 and sb.brand_id::text=$2 and b.status='active' and s.status='active'
  ), snapshot as (select jsonb_build_object(
    'context',(select to_jsonb(context) from context),
    'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('legacy',to_jsonb(ms)) order by i.id)
      from menu_catalog_items i left join menu_store_settings ms on ms.menu_catalog_item_id=i.id and ms.store_id::text=$1
      where i.brand_id::text=$2 and i.store_id is null and i.is_active),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('options',coalesce((
      select jsonb_agg(to_jsonb(o)||jsonb_build_object('legacy',to_jsonb(os)) order by o.id)
      from menu_options o left join menu_option_store_settings os on os.menu_option_id=o.id and os.store_id::text=$1
      where o.option_group_id=g.id and o.is_active),'[]'::jsonb)) order by g.id)
      from menu_option_groups g where g.brand_id::text=$2 and g.is_active),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from menu_categories c
      where c.brand_id::text=$2 and c.store_id is null),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.menu_catalog_item_id,l.option_group_id)
      from menu_catalog_item_option_groups l join menu_catalog_items i on i.id=l.menu_catalog_item_id
      where i.brand_id::text=$2 and i.store_id is null and i.is_active and l.is_active),'[]'::jsonb),
    'settings',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from menu_pos_settings p
      where p.store_id::text=$1 and p.brand_id::text=$2),'[]'::jsonb)
    ) as source)
  select source,md5(source::text) as revision from snapshot`;

function sourceQuery(storeId: string, brandId: string) {
  return sql.query(sourceSnapshotSql, [storeId, brandId]);
}

/** No source IDs or editable prices are accepted from the browser. */
export function buildDineInSourceCatalog(raw: Record<string, unknown>): StoreDineInCatalog {
  const context = record(raw.context), brandId = String(context.brand_id || ''), brandName = String(context.brand_name || '');
  const settings = rows(raw.settings);
  const setting = (field: string, id: string) => settings.find(row => row[field] === id);
  const itemRows = rows(raw.items).filter(row => isPosSellableItem({ name: String(row.name || '') }));
  const itemIdSet = new Set(itemRows.map(row => String(row.id)));
  const groups: StoreDineInGroup[] = rows(raw.groups)
    .filter(row => !row.menu_catalog_item_id || itemIdSet.has(String(row.menu_catalog_item_id)))
    .map(row => {
      const id = String(row.id), config = setting('group_id', id);
      return {
        id, sourceGroupId: id, sourceName: String(row.name), brandId,
        menuCatalogItemId: String(row.menu_catalog_item_id || ''), applicableCategories: strings(row.applicable_categories),
        groupKey: String(row.group_key), name: String(row.name), displayNames: names(row.display_names),
        selectionType: String(row.selection_type || 'single'), ruleJson: structuredClone(record(row.rule_json)),
        sortOrder: Number(row.sort_order || 0), posEnabled: config?.visible === true, visible: config?.visible !== false,
        options: rows(row.options).map(option => ({
          id: String(option.id), sourceOptionId: String(option.id), sourceName: String(option.name), sourceGroupId: id, sourceGroupName: String(row.name),
          optionKey: String(option.option_key), applicableCategories: strings(option.applicable_categories),
          name: String(option.name), displayNames: names(option.display_names), priceDelta: Math.round(Number(setting('option_id', String(option.id))?.price_override ?? option.price_delta ?? 0)),
          sortOrder: Number(option.sort_order || 0), visible: setting('option_id', String(option.id))?.visible !== false
        })).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const items: StoreDineInItem[] = itemRows.map((row): StoreDineInItem => {
    const id = String(row.id), config = setting('item_id', id), legacy = record(row.legacy);
    const priceOverride = config ? numberOrNull(config.price_override) : numberOrNull(legacy.price_override);
    const basePrice = numberOrNull(row.base_price), itemKind = String(row.item_kind || 'fixed_product');
    // POS presently uses item/category scopes, not the public menu's explicit-link precedence.
    // Snapshot exactly that graph; web-only links cannot expand a store item's choices.
    const applicable = groups.filter(group => group.menuCatalogItemId === id || !group.menuCatalogItemId && (!group.applicableCategories.length || group.applicableCategories.includes(String(row.category || '未分類')))).map(group => group.id);
    return {
      id, sourceItemId: id, sourceName: String(row.name), brandId, brandName,
      name: String(row.name), displayNames: names(row.display_names), itemKind, category: String(row.category || '未分類'),
      imageUrl: String(row.image_url || ''), basePrice, priceOverride, price: Math.round(Number(priceOverride ?? basePrice ?? 0)),
      variableSchema: structuredClone(record(row.variable_schema)), posPricingMode: itemKind === 'drink' ? 'fixed' : String(context.pos_pricing_mode || 'fixed'),
      posWeightUnit: String(context.pos_weight_unit || 'g'), posWeightUnitPrice: numberOrNull(context.pos_weight_unit_price),
      productionType: itemKind === 'drink' ? 'drink' : isPosBowl({ brandName, itemKind }) ? 'bowl' : 'item',
      sortOrder: Number(row.sort_order || 100), visible: config?.visible === null || config?.visible === undefined ? legacy.pos_enabled !== false : config.visible === true,
      optionGroupIds: applicable
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return normalizeDineInCatalogPricing({ version: 1, items, optionGroups: groups, categories: rows(raw.categories).map(row => ({ id: String(row.id), brandId, name: String(row.name), sortOrder: Number(row.sort_order || 100) })).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)) });
}

/** Brand prices and website associations are projected separately from effective POS import settings. */
export function buildDineInCanonicalSourceCatalog(raw: Record<string, unknown>): StoreDineInCatalog {
  const canonical = buildDineInSourceCatalog({ ...raw, settings: [],
    context: { ...record(raw.context), pos_pricing_mode: 'fixed', pos_weight_unit_price: null },
    items: rows(raw.items).map(item => ({ ...item, legacy: {} })),
    groups: rows(raw.groups).map(group => ({ ...group, options: rows(group.options).map(option => ({ ...option, legacy: {} })) })) });
  // Network products have per-portion master prices even if a POS defaults to weighing.
  canonical.items = canonical.items.map(item => ({ ...item, posPricingMode: 'fixed', posPricingOverride: 'fixed', price: Math.round(item.basePrice ?? 0), priceOverride: null }));
  const links = rows(raw.links), categories = rows(raw.categories);
  for (const item of canonical.items) {
    const explicit = links.filter(link => String(link.menu_catalog_item_id) === item.sourceItemId);
    const category = categories.find(category => category.name === item.category), schema = item.variableSchema;
    const food = String(schema.productType || category?.product_type || 'other') === 'food';
    item.optionGroupIds = explicit.length
      ? explicit.map(link => String(link.option_group_id)).filter(id => canonical.optionGroups.some(group => group.id === id))
      : canonical.optionGroups.filter(group => (!group.menuCatalogItemId || group.menuCatalogItemId === item.sourceItemId)
        && (!food || group.menuCatalogItemId === item.sourceItemId || group.applicableCategories.includes(item.category))
        && (group.menuCatalogItemId || !group.applicableCategories.length || group.applicableCategories.includes(item.category))).map(group => group.id);
  }
  return canonical;
}
export function buildDineInSourceReviewContext(raw: Record<string, unknown>, sourceRevision: string): SourceReviewContext {
  const networkPrices: Record<string, number | null> = {};
  for (const item of rows(raw.items)) networkPrices[`item:${item.id}`] = numberOrNull(record(item.legacy).price_override ?? item.base_price);
  for (const group of rows(raw.groups)) for (const option of rows(group.options)) networkPrices[`option:${option.id}`] = numberOrNull(option.price_delta);
  return { canonical: buildDineInCanonicalSourceCatalog(raw), effective: buildDineInSourceCatalog(raw), sourceRevision, networkPrices };
}

export async function readDineInEditor(storeId: string, brandId: string): Promise<StoreDineInEditorState> {
  const config = await readDineInMenus(storeId), menu = config.menus.find(menu => menu.brandId === brandId);
  if (!config.ready) return { ready: false, exists: false, enabled: false, revision: '', aggregateRevision: '', catalog: emptyDineInCatalog() };
  const source = await sourceQuery(storeId, brandId), raw = record(source[0]?.source), sourceContext = record(raw.context);
  const reviewContext = buildDineInSourceReviewContext(raw, String(source[0]?.revision || ''));
  const pricingDefaults = { unit: String(sourceContext.pos_weight_unit || 'g'), unitPrice: numberOrNull(sourceContext.pos_weight_unit_price) };
  if (menu) return { ready: true, exists: true, enabled: menu.enabled, revision: menu.revision, aggregateRevision: config.revision, catalog: menu.catalog, pricingDefaults, source: reviewContext.effective, sourceReview: buildDineInSourceReview(menu.catalog, reviewContext) };
  return { ready: true, exists: false, enabled: false, revision: '', aggregateRevision: config.revision, catalog: emptyDineInCatalog(), pricingDefaults, source: reviewContext.effective, sourceReview: buildDineInSourceReview(emptyDineInCatalog(), reviewContext) };
}

export async function mutateDineInMenu(storeId: string, brandId: string, employeeId: string, change: StoreDineInChange, fingerprint: string): Promise<StoreDineInEditorState> {
  const findOperation = () => sql`select employee_id::text as employee_id,request_fingerprint from store_dine_in_menu_operations
    where store_id::text=${storeId} and brand_id::text=${brandId} and operation_id::text=${change.operationId}`;
  const replay = async () => {
    const previous = await findOperation();
    if (!previous.length) return false;
    if (previous[0].employee_id !== employeeId || previous[0].request_fingerprint !== fingerprint) failure('操作番号が別の内容に使用されています。再読込してください。');
    return true;
  };
  if (await replay()) return readDineInEditor(storeId, brandId);
  const config = await readDineInMenus(storeId);
  if (!config.ready) failure('店内メニューのデータベース更新が必要です。', 503);
  const menu = config.menus.find(menu => menu.brandId === brandId);
  let catalog: StoreDineInCatalog, enabled: boolean, sourceRevision = '';
  let reviewContext: SourceReviewContext | undefined;
  if (change.action === 'initialize') {
    if (menu || change.revision !== '') failure('店内メニューは既に作成されています。再読込してください。');
    const source = await sourceQuery(storeId, brandId), raw = record(source[0]?.source);
    if (!record(raw.context).brand_id) failure('店舗とブランドの状態を確認してください。', 403);
    sourceRevision = String(source[0].revision);
    catalog = change.mode === 'empty' ? emptyDineInCatalog() : localizeDineInCatalog(buildDineInSourceCatalog(raw), randomUUID);
    reviewContext = buildDineInSourceReviewContext(raw, sourceRevision);
    catalog = captureDineInSourceBaseline(catalog, null, reviewContext); enabled = change.enabled ?? (change.mode !== 'empty');
  } else {
    if (!menu || menu.revision !== change.revision) failure('設定が変更されました。再読込して確認してください。');
    // Imports resolve lineage and initial prices from the live scoped catalog.
    // Explicit option-price edits affect only the independent local snapshot.
    let sourceCatalog: StoreDineInCatalog | undefined;
    let weightPricing: DineInChangeContext['weightPricing'];
    const capturesRate = (change.action === 'createItem' || change.action === 'setItemPricing') && change.pricingMode === 'weight';
    let brandName = menu.catalog.items[0]?.brandName || '';
    const importsOptions = change.action === 'createAddonGroup' || change.action === 'importAddonOptions' || change.action === 'importOptionGroup' && change.origin === 'brand';
    if (['createCategory', 'createItem', 'importItem', 'reviewSource', 'acknowledgeSourceBaseline'].includes(change.action) || importsOptions || capturesRate) {
      const source = await sourceQuery(storeId, brandId), raw = record(source[0]?.source);
      if (!record(raw.context).brand_id) failure('店舗とブランドの状態を確認してください。', 403);
      brandName = String(record(raw.context).brand_name || '');
      if (change.action === 'importItem' || importsOptions || capturesRate || change.action === 'reviewSource' || change.action === 'acknowledgeSourceBaseline') sourceRevision = String(source[0].revision);
      if (change.action === 'importItem' || importsOptions || change.action === 'reviewSource' || change.action === 'acknowledgeSourceBaseline') reviewContext = buildDineInSourceReviewContext(raw, sourceRevision);
      if (change.action === 'importItem' || importsOptions) sourceCatalog = buildDineInSourceCatalog(raw);
      if (capturesRate) weightPricing = { unit: String(record(raw.context).pos_weight_unit || 'g'), unitPrice: numberOrNull(record(raw.context).pos_weight_unit_price) };
    }
    catalog = change.action === 'acknowledgeSourceBaseline'
      ? acknowledgeDineInSourceBaseline(menu.catalog, change, reviewContext!, employeeId)
      : change.action === 'reviewSource'
      ? applyDineInSourceReview(menu.catalog, change, reviewContext!, randomUUID, employeeId)
      : applyDineInChange(menu.catalog, change, randomUUID, { brandId, brandName, source: sourceCatalog, weightPricing });
    if (reviewContext && change.action !== 'reviewSource' && change.action !== 'acknowledgeSourceBaseline') catalog = captureDineInSourceBaseline(catalog, menu.catalog, reviewContext, importsOptions);
    catalog = pruneDineInSourceReview(catalog, reviewContext);
    enabled = change.action === 'setEnabled' ? change.enabled! : menu.enabled;
  }
  if (JSON.stringify(catalog).length > 2_000_000) failure('店内メニューが大きすぎます。内容を整理してください。', 400);
  const writes = [posMenuLock(storeId), dineInMenuGuard(storeId, config.revision)];
  // Review-only writes keep the POS business revision, but concurrent admin writes must still conflict.
  if (menu) writes.push(sql`select 1 / case when exists(select 1 from store_dine_in_menus where store_id::text=${storeId}
    and brand_id::text=${brandId} and revision::text=${change.revision}) then 1 else 0 end as dine_in_editor_current`);
  // Scope and employee activity are rechecked at the write boundary too.
  writes.push(sql`select 1 / case when exists(select 1 from store_brands sb join stores s on s.id=sb.store_id join brands b on b.id=sb.brand_id
    where sb.store_id::text=${storeId} and sb.brand_id::text=${brandId} and s.status='active' and b.status='active')
    and exists(select 1 from employees where id::text=${employeeId} and status='active') then 1 else 0 end as dine_in_scope_current`);
  writes.push(sql`select 1 / case when not exists(select 1 from store_dine_in_menu_operations where store_id::text=${storeId}
    and brand_id::text=${brandId} and operation_id::text=${change.operationId}) then 1 else 0 end as dine_in_operation_new`);
  if (menu && sourceRevision) writes.push(sql.query(`select 1 / case when current_source.revision=$3 then 1 else 0 end as dine_in_import_source_current
    from (${sourceSnapshotSql}) current_source`, [storeId, brandId, sourceRevision]));
  if (change.action === 'createItem') {
    const item = catalog.items.at(-1)!;
    // A store-only canonical row preserves the existing order FK and stock/recipe identity.
    // Shared/public catalog readers explicitly exclude storeDineInOnly identities.
    writes.push(sql`insert into menu_catalog_items(id,brand_id,store_id,item_kind,name,category,base_price,variable_schema,sort_order,is_active)
      values(${item.sourceItemId}::uuid,${brandId}::uuid,${storeId}::uuid,${item.itemKind},${item.name},${item.category},${item.basePrice},${JSON.stringify(item.variableSchema)}::jsonb,${item.sortOrder},true)`);
  }
  if (menu) writes.push(sql`update store_dine_in_menus set catalog=${JSON.stringify(catalog)}::jsonb,enabled=${enabled},revision=revision+1,
    updated_by=${employeeId}::uuid,updated_at=now() where store_id::text=${storeId} and brand_id::text=${brandId}`);
  // One statement compares the complete source and stores the prepared copy using
  // the same database snapshot. Later brand changes are deliberately independent.
  else writes.push(sql.query(`insert into store_dine_in_menus(store_id,brand_id,enabled,catalog,updated_by)
    select $1::uuid,$2::uuid,$3::boolean,$4::jsonb,$5::uuid from (${sourceSnapshotSql}) current_source
    where 1 / case when current_source.revision=$6 then 1 else 0 end=1`, [storeId, brandId, enabled, JSON.stringify(catalog), employeeId, sourceRevision]));
  writes.push(sql`insert into store_dine_in_menu_operations(store_id,brand_id,operation_id,employee_id,request_fingerprint)
    values(${storeId}::uuid,${brandId}::uuid,${change.operationId}::uuid,${employeeId}::uuid,${fingerprint})`);
  try { await sql.transaction(writes); }
  catch (error) { if (['22012', '23505'].includes(String((error as { code?: string }).code)) && await replay()) return readDineInEditor(storeId, brandId); throw error; }
  return readDineInEditor(storeId, brandId);
}
