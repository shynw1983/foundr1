import { sql } from "./db";
import type { EmployeeSession } from "./auth";
import { getVisibleProductIdsForStore } from "./product-catalog-access";
import {
  normalizeInventoryOrderSource, inventoryOrderUsageOccurredAt, nullableInventoryUsageNumber, planInventoryOrderUsage,
  isInventoryUsageUuid,isInventoryMappedOptionAllowed,
  type InventoryOrderReadyOptions, type InventoryOrderSourceSnapshot, type InventoryOrderUsagePlan,
  type InventoryUsageProduct, type InventoryUsageRecipe, type InventoryUsageSettings, type InventoryUsageStock,
  type InventoryOrderUsageResponse,type InventoryOrderMappingItem,type InventoryOrderMappingTarget,
  type InventoryOrderMappingOption,type InventoryOrderUsagePendingSource
} from "./inventory-order-usage-policy";

type OrderRow = {
  id: string; storeId: string; orderNo: string; orderSource: string; status: string; paymentStatus: string;
  createdAt: string; paidAt: string | null; firstPreparedAt: string | null; preparingAt: string | null;
  readyAt: string | null; completedAt: string | null; itemsReadyAt: string | null;
  sourceSnapshot: InventoryOrderSourceSnapshot | null; rawItems: Array<Record<string, unknown>>;
  preparationSourceSnapshot: InventoryOrderSourceSnapshot | null;
  sourceExternalId: string | null; internalPreparedAt: string | null;
};

async function readSourceOrders(orderIds:string[]):Promise<OrderRow[]> {
  const rows = await sql`
    select orders.id::text,orders.store_id::text as "storeId",orders.pickup_code as "orderNo",orders.order_source as "orderSource",
      orders.status,orders.payment_status as "paymentStatus",orders.created_at::text as "createdAt",orders.paid_at::text as "paidAt",
      orders.inventory_first_prepared_at::text as "firstPreparedAt",orders.preparing_at::text as "preparingAt",
      orders.ready_at::text as "readyAt",orders.completed_at::text as "completedAt",
      orders.inventory_items_ready_at::text as "itemsReadyAt",orders.inventory_source_snapshot as "sourceSnapshot",
      orders.inventory_preparation_source_snapshot as "preparationSourceSnapshot",
      orders.source_external_id as "sourceExternalId",
      (select min(tasks.started_at)::text from order_production_tasks tasks where tasks.order_id=orders.id) as "internalPreparedAt",
      coalesce((select jsonb_agg(jsonb_build_object(
        'sourceItemId',items.id::text,'menuCatalogItemId',items.menu_catalog_item_id::text,'itemName',items.item_name,
        'quantity',items.quantity,'measuredQuantity',items.measured_quantity,'measuredUnit',items.measured_unit,
        'sizeKey',items.size_key,'temperature',items.temperature,'sweetness',items.sweetness,'ice',items.ice,
        'optionKey',items.option_key,'optionLabel',items.option_label,'sizeLabel',items.size_label,'toppingKeys',items.topping_keys,'toppingLabels',items.topping_labels,'customizations',items.customizations,
        'refundStatus',items.refund_status
      ) order by items.sort_order,items.id) from store_customer_order_items items where items.order_id=orders.id),'[]'::jsonb) as "rawItems"
    from store_customer_orders orders where orders.id::text=any(${orderIds}) order by orders.created_at desc,orders.id
  `;
  return rows as OrderRow[];
}
async function readSourceOrder(orderId:string):Promise<OrderRow|null> { return (await readSourceOrders([orderId]))[0]??null; }

function hasPreparation(order:OrderRow) { return Boolean(order.firstPreparedAt||order.preparingAt||order.readyAt||order.completedAt); }
const isExternalOrder=(order:OrderRow)=>!["store_pos","table_qr","nanacha_web","maamaa_web"].includes(order.orderSource);
function trustedPreparationTime(order:OrderRow):string|null {
  if(!isExternalOrder(order))return order.firstPreparedAt||order.preparingAt||order.readyAt||order.completedAt;
  const evidence=order.preparationSourceSnapshot?.preparationEvidence;
  return evidence&&["internal_preparation","operator_confirmed"].includes(evidence.kind)?evidence.occurredAt:order.internalPreparedAt;
}
function mappingSnapshot(order:OrderRow):InventoryOrderSourceSnapshot {
  const snapshot=hasPreparation(order)&&order.preparationSourceSnapshot ? order.preparationSourceSnapshot
    : order.sourceSnapshot ?? normalizeInventoryOrderSource(order.rawItems,order.orderSource);
  return {...snapshot,orderIdentity:{orderId:order.id,storeId:order.storeId,orderNo:order.orderNo,sourceExternalId:order.sourceExternalId,createdAt:order.createdAt}};
}
async function readInventoryMappingTargets(storeId:string) {
  const [menus,options]=await Promise.all([
    sql`select items.id::text,items.name,items.brand_id::text as "brandId",brands.name as "brandName",coalesce(items.category,'') as category
      from menu_catalog_items items join brands on brands.id=items.brand_id where items.is_active and items.store_id is null
        and exists(select 1 from store_brands where store_id::text=${storeId} and brand_id=items.brand_id) order by items.name,items.id`,
    sql`select options.id::text,options.name,groups.brand_id::text as "brandId",groups.id::text as "groupId",groups.name as "groupName",
      groups.menu_catalog_item_id::text as "menuCatalogItemId",groups.applicable_categories as "groupApplicableCategories",options.applicable_categories as "applicableCategories"
      from menu_options options join menu_option_groups groups on groups.id=options.option_group_id
      left join menu_catalog_items parent on parent.id=groups.menu_catalog_item_id
      where options.is_active and groups.is_active and (groups.menu_catalog_item_id is null or parent.is_active and parent.store_id is null)
        and exists(select 1 from store_brands where store_id::text=${storeId} and brand_id=groups.brand_id) order by groups.name,options.name,options.id`
  ]);
  return {menuTargets:menus as InventoryOrderMappingTarget[],optionTargets:options as InventoryOrderMappingOption[]};
}
function pendingSource(order:OrderRow):InventoryOrderUsagePendingSource {
  const snapshot=mappingSnapshot(order);
  const external=isExternalOrder(order);
  return {orderId:order.id,orderNo:order.orderNo,orderSource:order.orderSource,status:order.status,
    firstPreparedAt:trustedPreparationTime(order),
    orderedAt:order.createdAt,requiresPreparationTime:external&&!trustedPreparationTime(order),
    identityWarnings:[...new Set([...snapshot.issueCodes,...(external?["verify_original_order_date","verify_original_line_order","verify_original_quantities"]:[]),
      ...(!order.itemsReadyAt&&!order.preparationSourceSnapshot?["source_incomplete"]:[])])],expectedSourceSnapshot:snapshot,
    items:snapshot.rawItems.map((value,index)=>{
      const row=value as Record<string,unknown>;
      const rawSpecifications=[row.sizeLabel,row.sizeKey,row.temperature,row.sweetness,row.ice,row.optionLabel]
        .filter(label=>typeof label==="string"&&label.trim()) as string[];
      // Composite label strings are reference text, never an extra ingredient.
      // Only independent observed labels seed choices; an operator can add all
      // remaining actual options after checking the complete original order.
      const labels=(Array.isArray(row.toppingLabels)?row.toppingLabels:[]).filter(label=>typeof label==="string"&&label.trim()) as string[];
      if(Array.isArray(row.customizations))for(const customization of row.customizations as Array<Record<string,unknown>>) {
        if(Array.isArray(customization.optionLabels))for(const label of customization.optionLabels)if(typeof label==="string"&&label.trim())labels.push(label);
      }
      return {sourceItemId:String(row.sourceItemId??snapshot.items[index]?.sourceItemId??""),rawName:String(row.itemName??""),
        quantity:nullableInventoryUsageNumber(row.quantity),rawOptions:[...new Set(labels)].map(name=>({name,quantity:null})),rawSpecifications:[...new Set(rawSpecifications)]};
    })};
}

/** Human-confirmed exact OS identities. The original operational rows are not rewritten. */
export async function mapInventoryOrderSource(storeId:string,orderId:string,expected:InventoryOrderSourceSnapshot,mappedItems:InventoryOrderMappingItem[],actorId:string,confirmedPreparedAt?:string) {
  const invalid=(error:string,status=400)=>({ok:false as const,error,status});
  if(!expected||expected.schema!==1||!Array.isArray(expected.rawItems)||!Array.isArray(expected.items)||!expected.rawItems.length
    ||!Array.isArray(mappedItems)||mappedItems.length!==expected.rawItems.length||mappedItems.length>200)return invalid("原注文の全明細を確認してください。");
  const sourceIds=expected.rawItems.map(value=>String((value as Record<string,unknown>)?.sourceItemId??""));
  const seen=new Set<string>();
  for(const item of mappedItems) {
    if(!item||!isInventoryUsageUuid(item.sourceItemId)||!sourceIds.includes(item.sourceItemId)||seen.has(item.sourceItemId)
      ||!isInventoryUsageUuid(item.menuCatalogItemId)||!Number.isSafeInteger(item.quantity)||item.quantity<=0||item.quantity>1_000_000
      ||!Array.isArray(item.options)||item.options.length>200)return invalid("全明細のメニュー・数量・選択肢を確認してください。");
    seen.add(item.sourceItemId);const optionIds=new Set<string>();
    for(const option of item.options) {
      if(!option||!isInventoryUsageUuid(option.id)||optionIds.has(option.id)||!Number.isSafeInteger(option.quantity)||option.quantity<=0||option.quantity>1_000_000)return invalid("選択肢の数量を確認してください。");
      optionIds.add(option.id);
    }
    if(item.measuredQuantity!==undefined&&item.measuredQuantity!==null&&(!Number.isFinite(item.measuredQuantity)||item.measuredQuantity<=0
      ||item.measuredQuantity>999_999_999_999||Number(item.measuredQuantity.toFixed(6))!==item.measuredQuantity||!String(item.measuredUnit??"").trim()))return invalid("重量・計量単位を確認してください。");
  }
  if(new Set(sourceIds).size!==sourceIds.length||sourceIds.some(id=>!seen.has(id)))return invalid("原注文の全明細を確認してください。");
  const order=await readSourceOrder(orderId);
  if(!order||order.storeId!==storeId)return invalid("この店舗の注文を確認してください。",404);
  const actual=mappingSnapshot(order);
  if(JSON.stringify(actual)!==JSON.stringify(expected))return invalid("原注文が更新されています。画面を更新して確認してください。",409);
  const frozen=hasPreparation(order);
  const trustedPreparedAt=trustedPreparationTime(order);
  const confirmationTime=typeof confirmedPreparedAt==="string"?Date.parse(confirmedPreparedAt):null;
  if(confirmedPreparedAt!==undefined&&(typeof confirmedPreparedAt!=="string"||confirmationTime===null||!Number.isFinite(confirmationTime)||confirmationTime>Date.now()))return invalid("原注文の実際の製作日時を入力してください。未来の日時は指定できません。");
  if(isExternalOrder(order)&&!trustedPreparedAt&&confirmationTime===null)return invalid("原注文の実際の製作日時を確認して入力してください。");
  if(trustedPreparedAt&&confirmationTime!==null&&Date.parse(trustedPreparedAt)!==confirmationTime)return invalid("記録済みの製作日時は変更できません。",409);
  const preparationTime=trustedPreparedAt||(confirmationTime!==null?new Date(confirmationTime).toISOString():null);
  if(!order.preparationSourceSnapshot&&(!order.itemsReadyAt||JSON.stringify(order.rawItems)!==JSON.stringify(actual.rawItems)))return invalid("原注文の取込が完了していません。再取得してください。",409);
  if(frozen&&!order.preparationSourceSnapshot&&actual.items.some(item=>item.refundStatus))return invalid("製作時の原注文を復元できません。本部で確認してください。",409);
  const targets=await readInventoryMappingTargets(storeId);
  const menus=new Map(targets.menuTargets.map(menu=>[menu.id,menu]));
  const options=new Map(targets.optionTargets.map(option=>[option.id,option]));
  for(const item of mappedItems) {
    const menu=menus.get(item.menuCatalogItemId);
    if(!menu||item.options.some(option=>!options.has(option.id)||!isInventoryMappedOptionAllowed(options.get(option.id)!,menu)))return invalid("この店舗で使用できるメニュー・選択肢を指定してください。",409);
  }
  const snapshot=normalizeInventoryOrderSource(actual.rawItems as Array<Record<string,unknown>>,order.orderSource,{reliableIdentity:true,mappedItems});
  if(preparationTime)snapshot.preparationEvidence={kind:order.preparationSourceSnapshot?.preparationEvidence?.kind??(order.internalPreparedAt?"internal_preparation":"operator_confirmed"),occurredAt:preparationTime};
  if(snapshot.identityConfidence!=="exact")return invalid("原注文の全明細を確認してください。");
  const menuIds=[...new Set(mappedItems.map(item=>item.menuCatalogItemId))].sort();
  const optionIds=[...new Set(mappedItems.flatMap(item=>item.options.map(option=>option.id)))].sort();
  const payload=JSON.stringify(mappedItems);
  const {orderIdentity,...storedExpected}=actual;
  const queries=[
    sql`select id from store_customer_orders where id::text=${orderId} and store_id::text=${storeId} for update`,
    sql`select id from menu_catalog_items where id::text=any(${menuIds}) order by id for share`,
    sql`select id from menu_option_groups where id in(select option_group_id from menu_options where id::text=any(${optionIds})) order by id for share`,
    sql`select id from menu_options where id::text=any(${optionIds}) order by id for share`,
    sql`
      with mappings as materialized(select * from jsonb_to_recordset(${payload}::jsonb) as item("sourceItemId" text,"menuCatalogItemId" text,options jsonb)),valid as materialized(
        select orders.id from store_customer_orders orders where orders.id::text=${orderId} and orders.store_id::text=${storeId}
          and not exists(select 1 from inventory_order_usage_events where order_id=orders.id)
          and not exists(select 1 from inventory_order_usage_issues where order_id=orders.id and code='source_deletion_pending' and resolved_at is null)
          and (case when ${Boolean(frozen&&order.preparationSourceSnapshot)} then orders.inventory_preparation_source_snapshot
            else orders.inventory_source_snapshot end)=${JSON.stringify(storedExpected)}::jsonb
          and orders.pickup_code=${order.orderNo} and orders.created_at=${order.createdAt}::timestamptz
          and orders.source_external_id is not distinct from ${order.sourceExternalId}
          and orders.inventory_first_prepared_at is not distinct from ${order.firstPreparedAt}::timestamptz
          and (select min(tasks.started_at) from order_production_tasks tasks where tasks.order_id=orders.id) is not distinct from ${order.internalPreparedAt}::timestamptz
          and ${frozen}=(coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at) is not null)
          and (${Boolean(frozen&&order.preparationSourceSnapshot)} or orders.inventory_items_ready_at is not null and coalesce((select jsonb_agg(jsonb_build_object(
            'sourceItemId',items.id::text,'menuCatalogItemId',items.menu_catalog_item_id::text,'itemName',items.item_name,
            'quantity',items.quantity,'measuredQuantity',items.measured_quantity,'measuredUnit',items.measured_unit,
            'sizeKey',items.size_key,'temperature',items.temperature,'sweetness',items.sweetness,'ice',items.ice,
            'optionKey',items.option_key,'optionLabel',items.option_label,'sizeLabel',items.size_label,'toppingKeys',items.topping_keys,'toppingLabels',items.topping_labels,'customizations',items.customizations,
            'refundStatus',items.refund_status) order by items.sort_order,items.id) from store_customer_order_items items where items.order_id=orders.id),'[]'::jsonb)=${JSON.stringify(actual.rawItems)}::jsonb)
          and not exists(select 1 from mappings mapping left join menu_catalog_items menu on menu.id::text=mapping."menuCatalogItemId"
            where menu.id is null or not menu.is_active or menu.store_id is not null or not exists(select 1 from store_brands where store_id=orders.store_id and brand_id=menu.brand_id)
              or exists(select 1 from jsonb_array_elements(mapping.options) selected left join menu_options option on option.id::text=selected->>'id'
                left join menu_option_groups groups on groups.id=option.option_group_id
                where option.id is null or not option.is_active or not groups.is_active or groups.brand_id<>menu.brand_id
                  or groups.menu_catalog_item_id is not null and groups.menu_catalog_item_id<>menu.id
                  or groups.menu_catalog_item_id is null and cardinality(groups.applicable_categories)>0 and not(coalesce(nullif(menu.category,''),'未分類')=any(groups.applicable_categories))
                  or cardinality(option.applicable_categories)>0 and not(coalesce(nullif(menu.category,''),'未分類')=any(option.applicable_categories))))
      ), changed as (
        update store_customer_orders orders set inventory_items_ready_at=clock_timestamp(),
          inventory_source_snapshot=case when ${Boolean(frozen&&order.preparationSourceSnapshot)} then orders.inventory_source_snapshot else ${JSON.stringify(snapshot)}::jsonb end,
          inventory_first_prepared_at=case when ${Boolean(preparationTime)} then ${preparationTime}::timestamptz else orders.inventory_first_prepared_at end,
          inventory_preparation_source_snapshot=case when ${Boolean(frozen||preparationTime)} then ${JSON.stringify(snapshot)}::jsonb else orders.inventory_preparation_source_snapshot end
        from valid where orders.id=valid.id returning orders.id
      )
      insert into inventory_order_usage_issues(order_id,store_id,code,details,resolved_at)
      select id,${storeId}::uuid,'source_mapping_confirmed',jsonb_build_object('confirmedBy',${actorId}::text,'confirmedAt',clock_timestamp(),'originalVerified',true),clock_timestamp() from changed
      on conflict(order_id,code) do update set details=excluded.details,resolved_at=excluded.resolved_at,updated_at=now() returning order_id::text
    `
  ];
  const results=await sql.transaction(queries);
  if(!results.at(-1)?.[0])return invalid("原注文またはメニューが更新済みです。記録済みの耗用は変更できません。",409);
  try { await sql`update inventory_order_usage_issues set resolved_at=now(),updated_at=now() where order_id::text=${orderId} and resolved_at is null
    and code in ('unsupported_bridge_identity','missing_menu_identity','missing_option_identity','missing_structured_options','invalid_option_identity','unresolved_replacement','prepared_source_missing','source_incomplete','source_changed_not_ready','preparation_time_unconfirmed')`; } catch { /* confirmation was committed; explicit retry remains safe */ }
  return {ok:true as const,result:await safeSyncInventoryOrderUsage(orderId)};
}
export async function readInventoryUsageSettings(storeId: string): Promise<InventoryUsageSettings> {
  const rows = await sql`select enabled,enabled_from::text as "enabledFrom",trigger_mode as "triggerMode",revision
    from inventory_usage_settings where store_id::text=${storeId}`;
  return { storeId,enabled:rows[0]?.enabled===true,enabledFrom:rows[0]?.enabledFrom ? String(rows[0].enabledFrom):null,
    triggerMode:rows[0]?.triggerMode==="confirmed_sale"?"confirmed_sale":"preparation",revision:Number(rows[0]?.revision??0) };
}

async function recordIssues(orderId: string, issues: InventoryOrderUsagePlan["issues"]) {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const issue of issues) grouped.set(issue.code,[...(grouped.get(issue.code)??[]),issue.details]);
  if (!grouped.size) return;
  await sql.transaction([...grouped].map(([code,details])=>sql`
    insert into inventory_order_usage_issues(order_id,store_id,code,details)
    select id,store_id,${code},${JSON.stringify({items:details})}::jsonb from store_customer_orders where id::text=${orderId}
    on conflict(order_id,code) do update set details=excluded.details,updated_at=now(),resolved_at=null
  `));
}

/** Called only after the source writer has successfully persisted every line. */
export async function markInventoryOrderReady(orderId: string, options: InventoryOrderReadyOptions = {}): Promise<boolean> {
  try {
    const order = await readSourceOrder(orderId);
    if (!order || !order.rawItems.length) return false;
    const fullyMapped = Boolean(options.reliableIdentity===true && options.mappedItems?.length===order.rawItems.length
      && order.rawItems.every(item=>options.mappedItems?.some(mapping=>mapping.sourceItemId===item.sourceItemId)));
    const durableCodes = fullyMapped ? [] : (order.sourceSnapshot?.issueCodes??[]).filter(code=>["unresolved_replacement","unsupported_bridge_identity"].includes(code));
    const snapshot = normalizeInventoryOrderSource(order.rawItems,order.orderSource,{...options,issueCodes:[...new Set([...durableCodes,...(options.issueCodes??[])])]});
    const preparedAt=trustedPreparationTime(order);
    if(preparedAt)snapshot.preparationEvidence={kind:order.preparationSourceSnapshot?.preparationEvidence?.kind??"internal_preparation",occurredAt:preparedAt};
    const rows = await sql`
      update store_customer_orders orders
      set inventory_items_ready_at=clock_timestamp(),inventory_source_snapshot=${JSON.stringify(snapshot)}::jsonb,
        inventory_preparation_source_snapshot=case when inventory_first_prepared_at is not null
          and inventory_preparation_source_snapshot is null and ${order.rawItems.every(item=>!item.refundStatus)}
          then ${JSON.stringify(snapshot)}::jsonb else inventory_preparation_source_snapshot end
      where orders.id::text=${orderId} and coalesce((select jsonb_agg(jsonb_build_object(
        'sourceItemId',items.id::text,'menuCatalogItemId',items.menu_catalog_item_id::text,'itemName',items.item_name,
        'quantity',items.quantity,'measuredQuantity',items.measured_quantity,'measuredUnit',items.measured_unit,
        'sizeKey',items.size_key,'temperature',items.temperature,'sweetness',items.sweetness,'ice',items.ice,
        'optionKey',items.option_key,'optionLabel',items.option_label,'sizeLabel',items.size_label,'toppingKeys',items.topping_keys,'toppingLabels',items.topping_labels,'customizations',items.customizations,
        'refundStatus',items.refund_status
      ) order by items.sort_order,items.id) from store_customer_order_items items where items.order_id=orders.id),'[]'::jsonb)=${JSON.stringify(order.rawItems)}::jsonb
      returning id::text
    `;
    if (rows[0]) await safeSyncInventoryOrderUsage(orderId);
    return Boolean(rows[0]);
  } catch {
    // Readiness/usage errors must not roll back a paid order or kitchen action.
    try { await recordIssues(orderId,[{code:"source_readiness_failed",details:{retryRequired:true}}]); } catch { /* durable source remains unready */ }
    return false;
  }
}

async function loadPlanContext(order: OrderRow) {
  const targetIds = [...new Set(order.sourceSnapshot!.items.flatMap(item=>[item.menuCatalogItemId,...item.options.map(option=>option.id)]).filter((id):id is string=>Boolean(id)))];
  const recipeRows = targetIds.length ? await sql`
    select recipes.id::text,recipes.brand_id::text as "brandId",recipes.target_type as "targetType",recipes.target_id::text as "targetId",
      versions.id::text as "versionId",versions.snapshot
    from inventory_recipes recipes join inventory_recipe_versions versions on versions.id=recipes.current_version_id and versions.recipe_id=recipes.id
    where recipes.kind='menu' and recipes.status='active' and recipes.target_id::text=any(${targetIds})
      and exists(select 1 from store_brands where store_id::text=${order.storeId} and brand_id=recipes.brand_id)
      and ((recipes.target_type='item' and exists(select 1 from menu_catalog_items target where target.id=recipes.target_id and target.brand_id=recipes.brand_id))
        or (recipes.target_type='option' and exists(select 1 from menu_options target join menu_option_groups groups on groups.id=target.option_group_id
          where target.id=recipes.target_id and groups.brand_id=recipes.brand_id)))
  ` : [];
  const recipes = recipeRows as InventoryUsageRecipe[];
  const productIds = [...new Set(recipes.flatMap(recipe=>recipe.snapshot.inputs.map(input=>input.productId)))];
  const [productRows,stockRows,locationRows] = productIds.length ? await Promise.all([
    sql`select products.id::text,products.unit,products.package_quantity::float as "packageQuantity",products.package_quantity_unit as "packageQuantityUnit",
      products.inventory_unit_conversions as "inventoryUnitConversions",products.brand_scope as "brandScope",
      coalesce((select array_agg(brand_id::text) from product_brand_usages where product_id=products.id),'{}'::text[]) as "brandIds"
      from products where products.id::text=any(${productIds})`,
    sql`select items.id::text,items.product_id::text as "productId",items.count_unit as "countUnit",items.stock_quantity::float as quantity,
      items.stock_revision as "stockRevision",items.stock_conversion_snapshot as "conversionSnapshot",items.last_counted_at::text as "lastCountedAt",
      exists(select 1 from inventory_stock_receipts receipts where receipts.inventory_item_id=items.id and receipts.batch_packaging_snapshot is not null) as "hasBatchPackaging"
      from inventory_items items join inventory_locations locations on locations.id=items.location_id and locations.store_id=items.store_id
      where items.store_id::text=${order.storeId} and items.product_id::text=any(${productIds}) and items.status='active' and locations.status='active'`,
    sql`select product_id::text as "productId",inventory_item_id::text as "inventoryItemId" from inventory_product_usage_locations where store_id::text=${order.storeId}`
  ]) : [[],[],[]];
  const products = productRows as InventoryUsageProduct[];
  const stocks = stockRows.map(row=>({...row,quantity:nullableInventoryUsageNumber(row.quantity)})) as InventoryUsageStock[];
  const explicitLocations = new Map(locationRows.map(row=>[String(row.productId),String(row.inventoryItemId)]));
  return {recipes,products,stocks,explicitLocations};
}

const blockingPlanIssues = new Set(["recipe_missing","recipe_product_scope_changed","measured_basis_unknown","usage_location_missing",
  "usage_location_ambiguous","unit_conversion_unknown","stock_unit_snapshot_unknown","batch_unit_identity_required"]);
export async function safeSyncInventoryOrderUsage(orderId: string): Promise<"applied"|"already"|"ineligible"|"blocked"|"failed"> {
  try { return await syncInventoryOrderUsage(orderId); }
  catch {
    try { await recordIssues(orderId,[{code:"usage_sync_failed",details:{retryRequired:true}}]); } catch { /* next explicit retry can recover */ }
    return "failed";
  }
}

async function syncInventoryOrderUsage(orderId: string): Promise<"applied"|"already"|"ineligible"|"blocked"> {
  const order = await readSourceOrder(orderId);
  if (!order) return "ineligible";
  const settings = await readInventoryUsageSettings(order.storeId);
  const deleting=await sql`select id from inventory_order_usage_issues where order_id::text=${orderId} and code='source_deletion_pending' and resolved_at is null`;
  if(deleting[0])return "ineligible";
  const existing = await sql`select id::text from inventory_order_usage_events where order_id::text=${orderId}`;
  if (existing[0]) {
    const usedSource=hasPreparation(order)?order.preparationSourceSnapshot:order.sourceSnapshot;
    if(usedSource?.identityConfidence==="unresolved") await recordIssues(orderId,usedSource.issueCodes.map(code=>({code,details:{alreadyConsumed:true,confirmationRequired:true}})));
    try { await sql`update inventory_order_usage_issues set resolved_at=now(),updated_at=now()
      where order_id::text=${orderId} and code in ('usage_sync_failed','usage_state_changed_retry','source_readiness_failed') and resolved_at is null`; } catch { /* stock facts are already committed */ }
    return "already";
  }
  const occurredAt = inventoryOrderUsageOccurredAt(order,settings);
  if (!occurredAt) {
    if (settings.enabled && order.sourceSnapshot?.identityConfidence==="unresolved" && !["cancelled","payment_failed","checkout_failed"].includes(order.status)) {
      await recordIssues(orderId,order.sourceSnapshot.issueCodes.map(code=>({code,details:{itemCount:order.sourceSnapshot!.items.length}})));
    }
    return "ineligible";
  }
  if(isExternalOrder(order)&&(!trustedPreparationTime(order)||Date.parse(trustedPreparationTime(order)!)!==Date.parse(occurredAt))) {
    await recordIssues(orderId,[{code:"preparation_time_unconfirmed",details:{confirmationRequired:true}}]);return "blocked";
  }
  const frozen=Boolean(order.firstPreparedAt||order.preparingAt||order.readyAt||order.completedAt);
  if(frozen) {
    if(!order.preparationSourceSnapshot) {
      await recordIssues(orderId,[{code:"prepared_source_missing",details:{confirmationRequired:true}}]);return "blocked";
    }
    order.sourceSnapshot=order.preparationSourceSnapshot;
  }
  if ((!frozen&&!order.itemsReadyAt) || !order.sourceSnapshot || !order.sourceSnapshot.items.length) {
    await recordIssues(orderId,[{code:"source_incomplete",details:{retryRequired:true}}]);return "blocked";
  }
  if (!frozen && JSON.stringify(order.rawItems)!==JSON.stringify(order.sourceSnapshot.rawItems)) {
    // JSONB key order is canonical in both reads. A writer still changing rows
    // must complete its readiness snapshot before the first consumption plan.
    await recordIssues(orderId,[{code:"source_changed_not_ready",details:{retryRequired:true}}]);return "blocked";
  }
  const context = await loadPlanContext(order);
  const plan = planInventoryOrderUsage({source:order.sourceSnapshot,...context,occurredAt});
  if (plan.issues.length) await recordIssues(orderId,plan.issues);
  if (order.sourceSnapshot.identityConfidence!=="exact" || plan.issues.some(issue=>blockingPlanIssues.has(issue.code))) return "blocked";
  return commitInventoryOrderUsage(order,settings,occurredAt,plan,context);
}

async function commitInventoryOrderUsage(order: OrderRow,settings: InventoryUsageSettings,occurredAt: string,plan: InventoryOrderUsagePlan,context: Awaited<ReturnType<typeof loadPlanContext>>): Promise<"applied"|"already"|"blocked"> {
  const affectedIds = [...new Set(plan.lines.filter(line=>line.inventoryItemId && line.metadata.anchorIncludesOrder!==true).map(line=>line.inventoryItemId!))];
  const updates = affectedIds.map(id=>{
    const original = context.stocks.find(stock=>stock.id===id)!;
    const last = plan.lines.filter(line=>line.inventoryItemId===id).at(-1)!;
    return {id,productId:original.productId,countUnit:original.countUnit,expectedQuantity:original.quantity,
      expectedRevision:original.stockRevision,expectedSnapshot:original.conversionSnapshot,expectedCountedAt:original.lastCountedAt,
      afterQuantity:last.afterQuantity};
  });
  const productFacts = context.products.map(product=>({id:product.id,unit:product.unit,packageQuantity:product.packageQuantity??null,
    packageQuantityUnit:product.packageQuantityUnit??null,inventoryUnitConversions:product.inventoryUnitConversions??[],brandScope:product.brandScope,brandIds:product.brandIds}));
  const linePayload = plan.lines.map((line,index)=>({...line,index}));
  const recipeFacts = context.recipes.map(recipe=>({id:recipe.id,versionId:recipe.versionId,brandId:recipe.brandId}));
  const locationFacts = context.products.map(product=>({productId:product.id,explicitInventoryItemId:context.explicitLocations.get(product.id)??null,
    candidateIds:context.stocks.filter(stock=>stock.productId===product.id).map(stock=>stock.id).sort()}));
  const sourceJson = JSON.stringify(order.sourceSnapshot);
  const queries = [
    sql`select store_id from inventory_usage_settings where store_id::text=${order.storeId} for share`,
    sql`select id from store_customer_orders where id::text=${order.id} for share`,
    sql`select id from products where id::text=any(${context.products.map(product=>product.id)}) order by id for share`,
    sql`select id from inventory_items where id::text=any(${affectedIds}) order by id for update`,
    sql`
      with product_facts as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(productFacts)}::jsonb)
          as fact(id text,unit text,"packageQuantity" numeric,"packageQuantityUnit" text,"inventoryUnitConversions" jsonb,"brandScope" text,"brandIds" jsonb)
      ), stock_facts as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
          as fact(id text,"productId" text,"countUnit" text,"expectedQuantity" numeric,"expectedRevision" integer,
            "expectedSnapshot" jsonb,"expectedCountedAt" timestamptz,"afterQuantity" numeric)
      ), recipe_facts as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(recipeFacts)}::jsonb) as fact(id text,"versionId" text,"brandId" text)
      ), location_facts as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(locationFacts)}::jsonb) as fact("productId" text,"explicitInventoryItemId" text,"candidateIds" jsonb)
      ), valid as materialized (
        select orders.id from store_customer_orders orders
        join inventory_usage_settings settings on settings.store_id=orders.store_id
        where orders.id::text=${order.id} and orders.store_id::text=${order.storeId}
          and not exists(select 1 from inventory_order_usage_issues where order_id=orders.id and code='source_deletion_pending' and resolved_at is null)
          and settings.enabled and settings.revision=${settings.revision} and settings.trigger_mode=${settings.triggerMode}
          and settings.enabled_from is not distinct from ${settings.enabledFrom}::timestamptz
          and (orders.inventory_first_prepared_at is not null or orders.preparing_at is not null or orders.ready_at is not null or orders.completed_at is not null
            or (settings.trigger_mode='confirmed_sale' and orders.order_source<>'table_qr' and orders.payment_status in ('paid','partial_refunded') and orders.status not in ('cancelled','refund_pending','pending_payment','checkout_failed','payment_failed')))
          and (case when coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at) is not null
            then orders.inventory_preparation_source_snapshot=${sourceJson}::jsonb
            else orders.inventory_items_ready_at is not null and orders.inventory_source_snapshot=${sourceJson}::jsonb
              and coalesce((select jsonb_agg(jsonb_build_object(
            'sourceItemId',items.id::text,'menuCatalogItemId',items.menu_catalog_item_id::text,'itemName',items.item_name,
            'quantity',items.quantity,'measuredQuantity',items.measured_quantity,'measuredUnit',items.measured_unit,
            'sizeKey',items.size_key,'temperature',items.temperature,'sweetness',items.sweetness,'ice',items.ice,
            'optionKey',items.option_key,'optionLabel',items.option_label,'sizeLabel',items.size_label,'toppingKeys',items.topping_keys,'toppingLabels',items.topping_labels,'customizations',items.customizations,
            'refundStatus',items.refund_status
          ) order by items.sort_order,items.id) from store_customer_order_items items where items.order_id=orders.id),'[]'::jsonb)=${JSON.stringify(order.rawItems)}::jsonb end)
          and coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at,
            case when settings.trigger_mode='confirmed_sale' and orders.order_source<>'table_qr' then orders.paid_at else null end)=${occurredAt}::timestamptz
          and not exists(select 1 from product_facts fact left join products product on product.id::text=fact.id
            where product.id is null or product.unit is distinct from fact.unit
              or product.package_quantity is distinct from fact."packageQuantity"
              or product.package_quantity_unit is distinct from fact."packageQuantityUnit"
              or product.inventory_unit_conversions is distinct from fact."inventoryUnitConversions"
              or product.brand_scope is distinct from fact."brandScope"
              or coalesce((select jsonb_agg(usage.brand_id::text order by usage.brand_id) from product_brand_usages usage where usage.product_id=product.id),'[]'::jsonb)
                is distinct from (select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements_text(fact."brandIds") value))
          and not exists(select 1 from recipe_facts fact left join inventory_recipes recipe on recipe.id::text=fact.id
            where recipe.id is null or recipe.status<>'active' or recipe.current_version_id::text<>fact."versionId" or recipe.brand_id::text<>fact."brandId"
              or not exists(select 1 from store_brands where store_id=orders.store_id and brand_id=recipe.brand_id))
          and not exists(select 1 from stock_facts fact left join inventory_items stock on stock.id::text=fact.id
            left join inventory_locations location on location.id=stock.location_id and location.store_id=stock.store_id
            where stock.id is null or stock.status<>'active' or location.status is distinct from 'active'
              or stock.store_id<>orders.store_id or stock.product_id::text<>fact."productId" or stock.count_unit<>fact."countUnit"
              or stock.stock_revision<>fact."expectedRevision" or stock.stock_quantity is distinct from fact."expectedQuantity"
              or stock.stock_conversion_snapshot is distinct from fact."expectedSnapshot" or stock.last_counted_at is distinct from fact."expectedCountedAt")
          and not exists(select 1 from location_facts fact
            where (select inventory_item_id::text from inventory_product_usage_locations where store_id=orders.store_id and product_id::text=fact."productId") is distinct from fact."explicitInventoryItemId"
              or coalesce((select jsonb_agg(stock.id::text order by stock.id) from inventory_items stock
                join inventory_locations location on location.id=stock.location_id and location.store_id=stock.store_id
                where stock.store_id=orders.store_id and stock.product_id::text=fact."productId" and stock.status='active' and location.status='active'),'[]'::jsonb) is distinct from fact."candidateIds")
      ), claimed as (
        insert into inventory_order_usage_events(order_id,store_id,occurred_at,source_snapshot,plan_snapshot)
        select id,${order.storeId}::uuid,${occurredAt}::timestamptz,${sourceJson}::jsonb,
          ${JSON.stringify({...plan,settings})}::jsonb from valid
        on conflict(order_id) do nothing returning id,order_id
      ), updated as (
        update inventory_items stock set stock_quantity=fact."afterQuantity",stock_revision=stock.stock_revision+1,updated_at=now()
        from stock_facts fact where stock.id::text=fact.id and exists(select 1 from claimed)
        returning stock.id
      ), movements as (
        insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,exposure,
          occurred_at,source_order_id,source_order_item_id,recipe_version_id,before_quantity,after_quantity,changes_stock,metadata)
        select 'order:'||claimed.order_id::text||':'||line.index::text,${order.storeId}::uuid,line."productId"::uuid,line."inventoryItemId"::uuid,
          'order_use',line.quantity,line."countUnit",line.confidence,line.exposure,${occurredAt}::timestamptz,
          claimed.order_id,line."sourceItemId"::uuid,line."recipeVersionId"::uuid,line."beforeQuantity",line."afterQuantity",line."changesStock",
          line.metadata||jsonb_build_object('conversion',line."conversionSnapshot",'productConfiguration',line."productConfiguration",'usageEventId',claimed.id)
        from claimed cross join jsonb_to_recordset(${JSON.stringify(linePayload)}::jsonb)
          as line(index integer,"productId" text,"inventoryItemId" text,quantity numeric,"countUnit" text,confidence text,exposure numeric,
            "sourceItemId" text,"recipeVersionId" text,"beforeQuantity" numeric,"afterQuantity" numeric,"changesStock" boolean,
            metadata jsonb,"conversionSnapshot" jsonb,"productConfiguration" jsonb)
        returning id
      ) select id::text from claimed
    `
  ];
  const results = await sql.transaction(queries);
  if (results.at(-1)?.[0]) {
    const openCodes = [...new Set(plan.issues.map(issue=>issue.code))];
    try { await sql`update inventory_order_usage_issues set resolved_at=now(),updated_at=now()
      where order_id::text=${order.id} and resolved_at is null and not(code=any(${openCodes}))`; } catch { /* reconciliation cannot undo a committed usage event */ }
    return "applied";
  }
  const raced = await sql`select id from inventory_order_usage_events where order_id::text=${order.id}`;
  if (raced[0]) return "already";
  await recordIssues(order.id,[{code:"usage_state_changed_retry",details:{retryRequired:true}}]);return "blocked";
}

export async function retryInventoryOrderUsage(storeId: string,limit=50) {
  const rows = await sql`select orders.id::text from store_customer_orders orders
    join inventory_usage_settings settings on settings.store_id=orders.store_id
    where orders.store_id::text=${storeId} and settings.enabled and orders.created_at>now()-interval '14 days'
      and not exists(select 1 from inventory_order_usage_events events where events.order_id=orders.id)
      and coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at,
        case when settings.trigger_mode='confirmed_sale' and orders.order_source<>'table_qr' and orders.payment_status in ('paid','partial_refunded')
          and orders.status not in ('cancelled','refund_pending','payment_failed','checkout_failed','pending_payment') then orders.paid_at else null end)>=settings.enabled_from
    order by orders.created_at,orders.id limit ${Math.min(100,Math.max(1,limit))}`;
  const result={attempted:rows.length,applied:0,already:0,ineligible:0,blocked:0,failed:0};
  for (const row of rows) result[await safeSyncInventoryOrderUsage(String(row.id))]++;
  return result;
}

export async function readInventoryOrderUsage(session: EmployeeSession,storeId: string,canManage: boolean): Promise<InventoryOrderUsageResponse> {
  const visible = new Set(await getVisibleProductIdsForStore(session,storeId));
  const [settings,products,stocks,selected,issues,events,movements,targets,pendingIds] = await Promise.all([
    readInventoryUsageSettings(storeId),
    sql`select id::text,name from products order by name,id`,
    sql`select items.id::text,items.product_id::text as "productId",locations.name as "locationName",items.count_unit as "countUnit",
      items.stock_quantity::float as "stockQuantity",items.stock_revision as "stockRevision"
      from inventory_items items join inventory_locations locations on locations.id=items.location_id and locations.store_id=items.store_id
      where items.store_id::text=${storeId} and items.status='active' and locations.status='active' order by locations.name,items.id`,
    sql`select product_id::text as "productId",inventory_item_id::text as "inventoryItemId" from inventory_product_usage_locations where store_id::text=${storeId}`,
    sql`select issues.id::text,issues.order_id::text as "orderId",orders.pickup_code as "orderNo",issues.code,issues.details,
      issues.created_at::text as "createdAt",issues.updated_at::text as "updatedAt",issues.resolved_at::text as "resolvedAt"
      from inventory_order_usage_issues issues join store_customer_orders orders on orders.id=issues.order_id
      where issues.store_id::text=${storeId} and issues.resolved_at is null order by issues.updated_at desc,issues.id limit 100`,
    sql`select events.id::text,events.order_id::text as "orderId",orders.pickup_code as "orderNo",events.occurred_at::text as "occurredAt"
      from inventory_order_usage_events events join store_customer_orders orders on orders.id=events.order_id
      where events.store_id::text=${storeId} order by events.occurred_at desc,events.id limit 20`,
    sql`select movements.id::text,movements.source_order_id::text as "orderId",movements.product_id::text as "productId",products.name as "productName",
      movements.inventory_item_id::text as "inventoryItemId",coalesce(locations.name,'') as "locationName",movements.quantity::float as quantity,
      movements.count_unit as "countUnit",movements.confidence,movements.changes_stock as "changesStock",
      movements.before_quantity::float as "beforeQuantity",movements.after_quantity::float as "afterQuantity"
      from inventory_movements movements join products on products.id=movements.product_id
      left join inventory_items items on items.id=movements.inventory_item_id left join inventory_locations locations on locations.id=items.location_id
      where movements.store_id::text=${storeId} and movements.kind='order_use'
        and movements.source_order_id in (select order_id from inventory_order_usage_events where store_id::text=${storeId} order by occurred_at desc,id limit 20)
      order by movements.id`,
    readInventoryMappingTargets(storeId),
    sql`select orders.id::text from store_customer_orders orders
      where orders.store_id::text=${storeId} and orders.created_at>now()-interval '14 days'
        and not exists(select 1 from inventory_order_usage_events events where events.order_id=orders.id)
        and ((case when coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at) is not null
            then coalesce(orders.inventory_preparation_source_snapshot,orders.inventory_source_snapshot) else orders.inventory_source_snapshot end)->>'identityConfidence'='unresolved'
          or exists(select 1 from inventory_order_usage_issues issues where issues.order_id=orders.id and issues.code='preparation_time_unconfirmed' and issues.resolved_at is null)
          or coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at) is not null and orders.inventory_preparation_source_snapshot is null)
        and (orders.status not in ('cancelled','refund_pending','payment_failed','checkout_failed')
          or coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at) is not null)
      order by orders.created_at desc,orders.id limit 30`
  ]);
  const pending=pendingIds.length?await readSourceOrders(pendingIds.map(row=>String(row.id))):[];
  const headquarters = ["owner","manager"].includes(session.role);
  return {
    settings,canManage,...targets,pendingSources:pending.map(pendingSource),
    locations:products.filter(product=>visible.has(String(product.id))).map(product=>{
      const choices=stocks.filter(stock=>String(stock.productId)===String(product.id));
      const explicit=selected.find(row=>String(row.productId)===String(product.id));
      const explicitId=explicit?String(explicit.inventoryItemId):null;
      const effective=explicitId?choices.find(stock=>String(stock.id)===explicitId):choices.length===1?choices[0]:undefined;
      return {productId:String(product.id),productName:String(product.name),explicitInventoryItemId:explicitId,
        inventoryItemId:effective?String(effective.id):null,selection:explicitId?"explicit":choices.length===1?"single":choices.length>1?"ambiguous":"missing",
        items:choices.map(stock=>({id:String(stock.id),locationName:String(stock.locationName),countUnit:String(stock.countUnit),stockQuantity:nullableInventoryUsageNumber(stock.stockQuantity),stockRevision:Number(stock.stockRevision)}))};
    }),
    issues:issues.map(issue=>({id:String(issue.id),orderId:String(issue.orderId),orderNo:String(issue.orderNo),code:String(issue.code),
      details:headquarters?issue.details as Record<string,unknown>:{},createdAt:String(issue.createdAt),updatedAt:String(issue.updatedAt),resolvedAt:null})),
    recentUsage:events.map(event=>{
      const all=movements.filter(movement=>String(movement.orderId)===String(event.orderId));
      return {id:String(event.id),orderId:String(event.orderId),orderNo:String(event.orderNo),occurredAt:String(event.occurredAt),
        restrictedItemCount:all.filter(movement=>!visible.has(String(movement.productId))).length,
        items:all.filter(movement=>visible.has(String(movement.productId))).map(movement=>({id:String(movement.id),productId:String(movement.productId),productName:String(movement.productName),
          inventoryItemId:movement.inventoryItemId?String(movement.inventoryItemId):null,locationName:String(movement.locationName),quantity:nullableInventoryUsageNumber(movement.quantity),
          countUnit:String(movement.countUnit),confidence:movement.confidence,changesStock:movement.changesStock===true,
          beforeQuantity:nullableInventoryUsageNumber(movement.beforeQuantity),afterQuantity:nullableInventoryUsageNumber(movement.afterQuantity)}))};
    })
  } as InventoryOrderUsageResponse;
}
