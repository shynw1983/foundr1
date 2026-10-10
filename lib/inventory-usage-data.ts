import { sql } from "./db";
import {
  buildInventoryUsageSummary, type CalibrationInterval, type InventoryCountReconciliation,
  type InventoryUsageAggregate, type InventoryUsageResponse
} from "./inventory-usage-policy";
function number(value: unknown) { return value === null || value === undefined ? null : Number(value); }
function amount(value: unknown) { return Number(value ?? 0); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export async function getInventoryUsage(storeId: string, visibleProductIds: string[]): Promise<InventoryUsageResponse> {
  const now = new Date().toISOString();
  const [settingsRows, items, recent, issueRows] = await Promise.all([
    sql`select enabled,enabled_from::text as "enabledFrom",trigger_mode as "triggerMode" from inventory_usage_settings where store_id=${storeId}::uuid`,
    sql`
      with setting as (select coalesce((select enabled_from from inventory_usage_settings where store_id=${storeId}::uuid),${now}::timestamptz) as started_at)
      select items.id::text as id,items.product_id::text as "productId",products.name as "productName",locations.name as "locationName",
        items.count_unit as "countUnit",items.stock_quantity::float as "bookQuantity",
        anchor.id::text as "anchorId",anchor.quantity::float as "anchorQuantity",anchor.created_at::text as "anchorAt",
        coalesce(flows.incoming,0)::float as incoming,coalesce(flows.exact_order_usage,0)::float as "exactOrderUsage",
        coalesce(flows.estimated_usage,0)::float as "estimatedUsage",coalesce(flows.unknown_exposure,0)::float as "unknownExposure",
        coalesce(flows.unknown_versions,'[]'::jsonb) as "unknownRecipeVersionIds",coalesce(flows.trend_unknown_versions,'[]'::jsonb) as "trendUnknownRecipeVersionIds",
        coalesce(flows.mapped_exposure,0)::float as "mappedExposure",coalesce(flows.broken,false) as broken,
        coalesce(flows.unmeasured_production,false) as "unmeasuredProduction",
        coalesce(flows.trend_exact_usage,0)::float as "trendExactUsage",coalesce(flows.trend_estimated_usage,0)::float as "trendEstimatedUsage",
        coalesce(flows.trend_unknown_exposure,0)::float as "trendUnknownExposure",coalesce(flows.trend_broken,false) as "trendBroken",
        coalesce(calibration.intervals,'[]'::jsonb) as intervals,
        coalesce(active_rules.versions,'[]'::jsonb) as "activeUnmeasuredRecipeVersionIds"
      from inventory_items items join products on products.id=items.product_id
      join inventory_locations locations on locations.id=items.location_id and locations.store_id=items.store_id
      cross join setting
      left join inventory_checks anchor on anchor.id=items.usage_anchor_check_id and anchor.inventory_item_id=items.id
        and anchor.record_type='count' and anchor.count_unit=items.count_unit and anchor.quantity=items.current_quantity and anchor.created_at=items.last_counted_at
      left join lateral (
        select sum(m.quantity) filter(where m.changes_stock and m.quantity>0 and m.kind<>'count' and m.count_unit=items.count_unit and m.occurred_at>anchor.created_at) as incoming,
          sum(-m.quantity) filter(where m.kind='order_use' and m.confidence='exact' and m.quantity<0 and m.count_unit=items.count_unit and m.occurred_at>anchor.created_at) as exact_order_usage,
          sum(-m.quantity) filter(where m.confidence='estimate' and m.quantity<0 and m.count_unit=items.count_unit and m.occurred_at>anchor.created_at) as estimated_usage,
          sum(m.exposure) filter(where m.kind='order_use' and m.confidence='unmeasured' and m.count_unit=items.count_unit and m.occurred_at>anchor.created_at) as unknown_exposure,
          jsonb_agg(distinct m.recipe_version_id::text order by m.recipe_version_id::text) filter(where m.kind='order_use' and m.confidence='unmeasured' and m.recipe_version_id is not null and m.occurred_at>anchor.created_at) as unknown_versions,
          jsonb_agg(distinct m.recipe_version_id::text order by m.recipe_version_id::text) filter(where m.kind='order_use' and m.confidence='unmeasured' and m.recipe_version_id is not null and m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at)) as trend_unknown_versions,
          sum(m.exposure) filter(where m.kind='order_use' and m.occurred_at>anchor.created_at) as mapped_exposure,
          bool_or(m.count_unit<>items.count_unit or m.metadata->>'quantityUnknown'='true' or m.metadata->>'balanceUnknown'='true') filter(where m.occurred_at>anchor.created_at) as broken,
          bool_or(m.kind='production_input' and m.confidence='unmeasured') filter(where m.occurred_at>anchor.created_at) as unmeasured_production,
          sum(-m.quantity) filter(where m.kind='order_use' and m.confidence='exact' and m.quantity<0 and m.count_unit=items.count_unit and m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at)) as trend_exact_usage,
          sum(-m.quantity) filter(where m.kind='order_use' and m.confidence='estimate' and m.quantity<0 and m.count_unit=items.count_unit and m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at)) as trend_estimated_usage,
          sum(m.exposure) filter(where m.kind='order_use' and m.confidence='unmeasured' and m.count_unit=items.count_unit and m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at)) as trend_unknown_exposure,
          bool_or(m.count_unit<>items.count_unit) filter(where m.kind='order_use' and m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at)) as trend_broken
        from inventory_movements m where m.inventory_item_id=items.id and m.kind<>'count' and m.occurred_at<=${now}::timestamptz
          and (m.occurred_at>anchor.created_at or m.occurred_at>greatest(${now}::timestamptz-interval '7 days',setting.started_at))
      ) flows on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('id',checks.id,'createdAt',checks.created_at,'snapshot',checks.reconciliation_snapshot)) as intervals
        from (select id,created_at,reconciliation_snapshot from inventory_checks
          where inventory_item_id=items.id and record_type='count' and count_unit=items.count_unit and reconciliation_snapshot is not null
          order by created_at desc limit 8) checks
      ) calibration on true
      left join lateral (
        select jsonb_agg(versions.id::text order by versions.id::text) as versions
        from inventory_recipes recipes join inventory_recipe_versions versions on versions.id=recipes.current_version_id
        where recipes.kind='menu' and recipes.status='active'
          and recipes.brand_id in (select brand_id from store_brands where store_id=items.store_id)
          and versions.snapshot->'inputs' @> jsonb_build_array(jsonb_build_object('productId',items.product_id::text,'mode','unmeasured'))
      ) active_rules on true
      where items.store_id=${storeId}::uuid and items.product_id::text=any(${visibleProductIds}) and items.status='active' and locations.status='active'
      order by locations.sort_order,locations.name,products.name
    `,
    sql`select checks.id::text as id,products.name as "productName",locations.name as "locationName",checks.reconciliation_snapshot as snapshot
      from inventory_checks checks join inventory_items items on items.id=checks.inventory_item_id
      join inventory_locations locations on locations.id=items.location_id join products on products.id=checks.product_id
      where checks.store_id=${storeId}::uuid and checks.product_id::text=any(${visibleProductIds}) and checks.record_type='count' and checks.reconciliation_snapshot is not null
      order by checks.created_at desc limit 20`,
    sql`select count(distinct order_id)::integer as count from inventory_order_usage_issues where store_id=${storeId}::uuid and resolved_at is null`
  ]);
  const settings = { enabled: Boolean(settingsRows[0]?.enabled),enabledFrom: settingsRows[0]?.enabledFrom ? String(settingsRows[0].enabledFrom) : null,
    triggerMode: "preparation" as const };
  return { selectedStoreId: storeId,settings,
    items: items.map(item => {
      const intervals: CalibrationInterval[] = (Array.isArray(item.intervals) ? item.intervals : []).flatMap(raw => {
        const row=record(raw),snapshot=record(row.snapshot);
        const start=number(snapshot.anchorQuantity),observed=number(snapshot.observedQuantity),incoming=number(snapshot.incomingQuantity),exact=number(snapshot.orderDeductedQuantity),other=number(snapshot.otherDelta),exposure=number(snapshot.unknownExposure);
        if([start,observed,incoming,exact,other,exposure].some(v=>v===null)||typeof snapshot.periodStartedAt!=="string"||typeof snapshot.countUnit!=="string") return [];
        return [{checkId:String(row.id),startedAt:snapshot.periodStartedAt,endedAt:String(row.createdAt),countUnit:snapshot.countUnit,anchorQuantity:start!,observedQuantity:observed!,incomingQuantity:incoming!,exactOrderUsage:exact!,otherDelta:other!,unknownExposure:exposure!,issueReasons:Array.isArray(snapshot.issueReasons)?snapshot.issueReasons.map(String):["unknown_interval"],recipeVersionIds:Array.isArray(snapshot.unknownRecipeVersionIds)?snapshot.unknownRecipeVersionIds.map(String):[]}];
      });
      const aggregate: InventoryUsageAggregate = {
        unknownRecipeVersionIds:Array.isArray(item.unknownRecipeVersionIds)?item.unknownRecipeVersionIds.map(String):[],trendUnknownRecipeVersionIds:Array.isArray(item.trendUnknownRecipeVersionIds)?item.trendUnknownRecipeVersionIds.map(String):[],incoming:amount(item.incoming),exactOrderUsage:amount(item.exactOrderUsage),estimatedUsage:amount(item.estimatedUsage),unknownExposure:amount(item.unknownExposure),mappedExposure:amount(item.mappedExposure),
        broken:Boolean(item.broken),unmeasuredProduction:Boolean(item.unmeasuredProduction),trendExactUsage:amount(item.trendExactUsage),trendEstimatedUsage:amount(item.trendEstimatedUsage),trendUnknownExposure:amount(item.trendUnknownExposure),trendBroken:Boolean(item.trendBroken),activeUnmeasuredRecipeVersionIds:Array.isArray(item.activeUnmeasuredRecipeVersionIds)?item.activeUnmeasuredRecipeVersionIds.map(String):[]
      };
      return buildInventoryUsageSummary({inventoryItemId:String(item.id),productId:String(item.productId),productName:String(item.productName),locationName:String(item.locationName),countUnit:String(item.countUnit),bookQuantity:number(item.bookQuantity),
        anchor:item.anchorId ? {checkId:String(item.anchorId),quantity:amount(item.anchorQuantity),countUnit:String(item.countUnit),countedAt:String(item.anchorAt)} : null,
        movements:[],aggregate,intervals,unmappedOrders:amount(issueRows[0]?.count),now,trackingFrom:settings.enabledFrom});
    }),recentReconciliations:recent.map(row=>({id:String(row.id),productName:String(row.productName),locationName:String(row.locationName),snapshot:row.snapshot as InventoryCountReconciliation}))
  };
}
