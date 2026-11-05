import { createHash } from "node:crypto";
import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { getVisibleProductIdsForStore } from "./product-catalog-access";
import { readReplenishmentSnapshot } from "./replenishment-data";
import { createReplenishmentOrderLocks } from "./replenishment-order-locks";
import { openReplenishmentOrderStatuses } from "./replenishment-order-intent";
import { demandProgress, demandSignalBasis, demandDateAt } from "./replenishment-demand-policy";
import type { ReplenishmentDemand, ReplenishmentDemandCreateOrder, ReplenishmentDemandOrder, ReplenishmentDemandProduct, ReplenishmentDemandReport, ReplenishmentDemandReview } from "./replenishment-demand-types";

type Query = typeof sql;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textDate = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value);

export async function readDemandProducts(session: EmployeeSession, storeId: string): Promise<ReplenishmentDemandProduct[]> {
  const ids = await getVisibleProductIdsForStore(session, storeId);
  if (!ids.length) return [];
  const rows = await sql`select id::text,name,unit,(is_orderable and (
    (brand_scope='common' and not exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id where usages.product_id=products.id and brands.store_id::text=${storeId}))
    or exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id where usages.product_id=products.id and brands.store_id::text=${storeId} and usages.is_orderable))) as "isOrderable" from products
    where id::text=any(${ids}) and (is_orderable or exists(select 1 from inventory_items where product_id=products.id and store_id::text=${storeId} and status='active')
      or exists(select 1 from replenishment_demands where product_id=products.id and store_id::text=${storeId})) order by name,id`;
  // Orderability is checked again against the current shared catalog when issuing an order.
  return rows.map(row => ({id:String(row.id),name:String(row.name),unit:String(row.unit ?? ""),isOrderable:row.isOrderable===true}));
}

export async function readDemandBuyers(storeId: string) {
  const rows = await sql`select employees.id::text,employees.name from employees where status='active'
    and role in ('owner','manager','store_owner','store_manager')
    and (role='owner' or coalesce((select is_enabled from role_permissions where role=employees.role and permission_key='module.orders'),true))
    and (role in ('owner','manager') or exists(select 1 from employee_scopes scopes
      where scopes.employee_id=employees.id and scopes.scope_type='store' and scopes.store_id::text=${storeId})) order by name,id`;
  return rows.map(row => ({id:String(row.id),name:String(row.name)}));
}

export async function readDemandPool(session: EmployeeSession, stores: Array<{id:string;name:string}>, query: Query = sql): Promise<ReplenishmentDemand[]> {
  if (!stores.length) return [];
  const visible = new Map<string,string[]>();
  await Promise.all(stores.map(async store => visible.set(store.id, await getVisibleProductIdsForStore(session,store.id))));
  const rows = await query`select demands.id::text,demands.store_id::text as "storeId",demands.product_id::text as "productId",
    stores.name as "storeName",products.name as "productName",products.unit as "currentUnit",(products.is_orderable and (
      (products.brand_scope='common' and not exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id where usages.product_id=products.id and brands.store_id=demands.store_id))
      or exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id where usages.product_id=products.id and brands.store_id=demands.store_id and usages.is_orderable))) as "isOrderable",
    demands.status,demands.version,demands.quantity,demands.unit,demands.note,demands.sources,
    demands.deferred_until::text as "deferredUntil",demands.created_at::text as "createdAt",demands.updated_at::text as "updatedAt",
    coalesce((select jsonb_agg(history.event order by history.created_at desc,history.id desc) from (
      select events.id,events.created_at,jsonb_build_object('id',events.id::text,'kind',events.kind,'actorName',events.actor_name,
        'note',events.note,'quantity',events.quantity,'unit',events.payload->>'unit','shortageStatus',events.payload->>'shortageStatus','createdAt',events.created_at::text) event
      from replenishment_demand_events events where events.demand_id=demands.id order by events.created_at desc,events.id desc limit 60
    ) history),'[]'::jsonb) as events,
    coalesce((select jsonb_agg(jsonb_build_object('orderId',coalesce(links.purchase_order_id::text,''),'orderNo',links.order_no,
      /* A legacy split changes the original quantity without structured residual lineage. Require explicit manager reconciliation instead of silently attributing another item's receipts. */
      'itemId',coalesce(links.purchase_order_item_id::text,''),'status',case when items.id is null then 'deleted' when items.product_id is distinct from demands.product_id or items.requested_unit is distinct from links.unit or items.requested_quantity is distinct from links.requested_quantity then 'changed' else items.status end,'requestedQuantity',links.requested_quantity,'unit',links.unit,
      'actualQuantity',items.actual_quantity,'actualUnit',actuals.actual_unit,
      'receivedQuantity',coalesce((select sum(receipts.purchase_quantity) from inventory_stock_receipts receipts
        where receipts.purchase_order_item_id=items.id and receipts.store_id=demands.store_id and receipts.product_id=demands.product_id
          and receipts.purchase_unit=links.unit),0)) order by links.created_at desc)
      from replenishment_demand_order_items links left join purchase_order_items items on items.id=links.purchase_order_item_id
      left join lateral(select actual_unit from purchase_actuals where purchase_order_item_id=items.id order by recorded_at desc,id desc limit 1) actuals on true
      where links.demand_id=demands.id and links.cycle=demands.cycle),'[]'::jsonb) as orders,
    coalesce((select jsonb_agg(jsonb_build_object('id',inventory.id::text,'locationName',locations.name,'quantity',inventory.stock_quantity,
      'countUnit',inventory.count_unit,'safetyStock',inventory.safety_stock,'lastCountedAt',inventory.last_counted_at::text,
      'quickStatus',inventory.quick_status,'quickCheckedAt',inventory.quick_checked_at::text) order by locations.name,inventory.id)
      from inventory_items inventory join inventory_locations locations on locations.id=inventory.location_id and locations.store_id=inventory.store_id
      where inventory.product_id=demands.product_id and inventory.store_id=demands.store_id and inventory.status='active' and locations.status='active'),'[]'::jsonb) as inventory,
    coalesce((select jsonb_agg(jsonb_build_object('orderId',orders.id::text,'orderNo',orders.order_no,'itemId',items.id::text,'status',items.status,
      'requestedQuantity',items.requested_quantity,'unit',items.requested_unit,'actualQuantity',items.actual_quantity,
      'actualUnit',(select actual_unit from purchase_actuals where purchase_order_item_id=items.id order by recorded_at desc,id desc limit 1),
      'receivedQuantity',coalesce((select sum(receipts.purchase_quantity) from inventory_stock_receipts receipts
        where receipts.purchase_order_item_id=items.id and receipts.store_id=demands.store_id and receipts.product_id=demands.product_id
          and receipts.purchase_unit=items.requested_unit),0)) order by orders.created_at desc,items.id)
      from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id
      where orders.store_id=demands.store_id and items.product_id=demands.product_id and items.status=any(${[...openReplenishmentOrderStatuses]}) and orders.order_no not like 'RCPT-%'),'[]'::jsonb) as "openOrders",
    coalesce((select array_agg(items.id::text order by items.id::text) from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id
      where orders.store_id=demands.store_id and items.product_id=demands.product_id and items.status=any(${[...openReplenishmentOrderStatuses]}) and orders.order_no not like 'RCPT-%'),'{}'::text[]) as "openItemIds"
    from replenishment_demands demands join stores on stores.id=demands.store_id join products on products.id=demands.product_id
    where demands.store_id::text=any(${stores.map(store=>store.id)})
    order by case when demands.status in ('resolved','dismissed') then 1 else 0 end,demands.updated_at desc,demands.id limit 1000`;
  return rows.filter(row=>visible.get(String(row.storeId))?.includes(String(row.productId))).map(row => {
    const orders = (Array.isArray(row.orders) ? row.orders : []) as ReplenishmentDemandOrder[];
    const status = row.status as ReplenishmentDemand["status"];
    return {id:String(row.id),storeId:String(row.storeId),storeName:String(row.storeName),
      product:{id:String(row.productId),name:String(row.productName),unit:String(row.currentUnit ?? ""),isOrderable:row.isOrderable===true},
      status,version:Number(row.version),quantity:numberOrNull(row.quantity),unit:String(row.unit),note:String(row.note),
      deferredUntil:row.deferredUntil ? textDate(row.deferredUntil):null,createdAt:textDate(row.createdAt),updatedAt:textDate(row.updatedAt),
      inventory:Array.isArray(row.inventory)?row.inventory:[],openOrders:Array.isArray(row.openOrders)?row.openOrders:[],
      sources:Array.isArray(row.sources)?row.sources:[],events:Array.isArray(row.events)?row.events:[],orders,
      openItemIds:Array.isArray(row.openItemIds)?row.openItemIds.map(String):[],progress:demandProgress(status,orders)};
  });
}

/** All write paths lock the pair before updating demand facts; request keys are global immutable replay identities. */
export async function reportReplenishmentDemand(actor: EmployeeSession, input: ReplenishmentDemandReport, query: Query = sql) {
  const fingerprint=hash({actorId:actor.id,storeId:input.storeId,productId:input.productId,quantity:input.quantity ?? null,unit:input.unit,note:input.note,shortageStatus:input.shortageStatus ?? null});
  const result=await query.transaction([
    query`select pg_advisory_xact_lock(hashtextextended(${`replenishment-request:${input.requestId}`},0))`,
    ...createReplenishmentOrderLocks(query,[{storeId:input.storeId,productIds:[input.productId]}]),
    query`with prior as materialized(select demand_id,request_fingerprint from replenishment_demand_events where request_id=${input.requestId}::uuid),
      valid_product as materialized(select products.id from products where id::text=${input.productId} and unit=${input.unit} and length(btrim(unit))>0
        and exists(select 1 from stores where id::text=${input.storeId} and status='active')
        and (brand_scope='common' or (brand_scope='specific' and exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id
          where usages.product_id=products.id and brands.store_id::text=${input.storeId})))
        and (${["owner","manager"].includes(actor.role)} or catalog_visibility='brand_stores'
          or (catalog_visibility='selected_stores' and exists(select 1 from product_catalog_store_grants grants where grants.product_id=products.id and grants.store_id::text=${input.storeId}))) for share),
      changed as (
        insert into replenishment_demands(store_id,product_id,quantity,unit)
        select ${input.storeId}::uuid,id,${input.quantity ?? null}::integer,${input.unit} from valid_product where not exists(select 1 from prior)
        on conflict(store_id,product_id) do update set
          status=case when replenishment_demands.status in ('resolved','dismissed') then 'open' else replenishment_demands.status end,
          cycle=replenishment_demands.cycle+case when replenishment_demands.status in ('resolved','dismissed') then 1 else 0 end,
          quantity=case when replenishment_demands.status in ('resolved','dismissed') then excluded.quantity else replenishment_demands.quantity end,
          unit=case when replenishment_demands.status in ('resolved','dismissed') then excluded.unit else replenishment_demands.unit end,
          note=case when replenishment_demands.status in ('resolved','dismissed') then '' else replenishment_demands.note end,
          deferred_until=case when replenishment_demands.status in ('resolved','dismissed') then null else replenishment_demands.deferred_until end,
          version=replenishment_demands.version+1,updated_at=now()
        returning id
      ), event as (
        insert into replenishment_demand_events(demand_id,kind,actor_id,actor_name,request_id,request_fingerprint,quantity,note,payload)
        select id,'report',${actor.id}::uuid,${actor.name},${input.requestId}::uuid,${fingerprint},${input.quantity ?? null}::integer,${input.note},
          ${JSON.stringify({unit:input.unit,shortageStatus:input.shortageStatus ?? null})}::jsonb from changed returning demand_id
      ) select coalesce((select demand_id::text from event),(select demand_id::text from prior)) as "demandId",
        not exists(select 1 from prior where request_fingerprint<>${fingerprint}) as "sameRequest"`
  ]);
  return result[result.length-1][0] as {demandId:string|null;sameRequest:boolean};
}

export async function reviewReplenishmentDemand(actor: EmployeeSession, input: ReplenishmentDemandReview, query: Query=sql) {
  const result=await query.transaction([
    // The version predicate and row update serialize reviews against issuance and automatic observations.
    query`select pg_advisory_xact_lock(hashtextextended('replenishment-demand-review:'||${input.demandId},0))`,
    query`with changed as(update replenishment_demands demands set status=${input.status},quantity=${input.quantity},unit=${input.unit},note=${input.note},
      cycle=demands.cycle+case when demands.status in ('resolved','dismissed') and ${!['resolved','dismissed'].includes(input.status)} then 1 else 0 end,
      deferred_until=${input.status==='deferred' ? demandDateAt(input.deferredUntil):null}::timestamptz,version=version+1,automatic_observed_at=clock_timestamp(),updated_at=now()
      from products where demands.id::text=${input.demandId} and demands.store_id::text=${input.storeId} and demands.version=${input.expectedVersion}
        and (${input.status!=='ordered'} or demands.status='ordered')
        and products.id=demands.product_id and products.unit=${input.unit} and length(btrim(products.unit))>0
        and (products.brand_scope='common' or (products.brand_scope='specific' and exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id
          where usages.product_id=products.id and brands.store_id::text=${input.storeId})))
        and (${["owner","manager"].includes(actor.role)} or products.catalog_visibility='brand_stores' or (products.catalog_visibility='selected_stores'
          and exists(select 1 from product_catalog_store_grants grants where grants.product_id=products.id and grants.store_id::text=${input.storeId})))
      returning demands.id), event as(insert into replenishment_demand_events(demand_id,kind,actor_id,actor_name,quantity,note,payload)
      select id,'review',${actor.id}::uuid,${actor.name},${input.quantity},${input.note},${JSON.stringify({status:input.status,unit:input.unit,expectedVersion:input.expectedVersion,deferredUntil:input.deferredUntil ?? null})}::jsonb from changed returning id)
      select (select id::text from changed) as "demandId"`
  ]);
  return result[result.length-1][0]?.demandId as string|undefined;
}

/** Pure automatic observations have no employee actor. Changed source facts reopen a closed episode, never elapsed time alone. */
export async function syncInventoryReplenishmentDemands(session: EmployeeSession, storeId: string) {
  // DB time establishes ordering across concurrent hooks/cron, including delayed observations versus a manual decision.
  const observed = await sql`select clock_timestamp()::text as at`;
  const observedAt=String(observed[0].at);
  const snapshot=await readReplenishmentSnapshot({...session,role:'owner'},storeId,false);
  if(!snapshot) return {changed:0};
  const risks=snapshot.risks.map(risk=>({productId:risk.product.id,unit:risk.product.unit,sources:risk.sources,fingerprint:hash(demandSignalBasis(risk.sources))})).filter(risk=>risk.unit.trim());
  return syncReplenishmentDemandSignals(storeId,risks,observedAt);
}
export async function syncReplenishmentDemandSignals(storeId:string, signals:Array<{productId:string;unit:string;sources:unknown[];fingerprint:string}>, observedAt:string, query:Query=sql) {
  const result=await query.transaction([
    query`select pg_advisory_xact_lock(hashtextextended(${`replenishment-automatic:${storeId}`},0))`,
    query`insert into replenishment_demand_sync_state(store_id,observed_at) values(${storeId}::uuid,${observedAt}::timestamptz)
      on conflict(store_id) do update set observed_at=excluded.observed_at
      where replenishment_demand_sync_state.observed_at<=excluded.observed_at`,
    ...createReplenishmentOrderLocks(query,[{storeId,productIds:signals.map(signal=>signal.productId)}]),
    query`with signals as materialized(select * from jsonb_to_recordset(${JSON.stringify(signals)}::jsonb) as signal("productId" text,unit text,sources jsonb,fingerprint text)),
      changed as(insert into replenishment_demands(store_id,product_id,unit,sources,automatic_fingerprint,automatic_observed_at)
        select ${storeId}::uuid,"productId"::uuid,unit,sources,fingerprint,${observedAt}::timestamptz from signals
          where exists(select 1 from replenishment_demand_sync_state where store_id::text=${storeId} and observed_at=${observedAt}::timestamptz)
        on conflict(store_id,product_id) do update set
          sources=excluded.sources,automatic_fingerprint=excluded.automatic_fingerprint,automatic_observed_at=excluded.automatic_observed_at,
          status=case when replenishment_demands.status in ('dismissed','resolved') and replenishment_demands.automatic_fingerprint is distinct from excluded.automatic_fingerprint then 'open' else replenishment_demands.status end,
          cycle=replenishment_demands.cycle+case when replenishment_demands.status in ('dismissed','resolved') and replenishment_demands.automatic_fingerprint is distinct from excluded.automatic_fingerprint then 1 else 0 end,
          quantity=case when replenishment_demands.status in ('dismissed','resolved') then null else replenishment_demands.quantity end,
          unit=case when replenishment_demands.status in ('dismissed','resolved') then excluded.unit else replenishment_demands.unit end,
          note=case when replenishment_demands.status in ('dismissed','resolved') then '' else replenishment_demands.note end,
          deferred_until=case when replenishment_demands.status in ('dismissed','resolved') then null else replenishment_demands.deferred_until end,
          version=replenishment_demands.version+1,updated_at=now()
        where replenishment_demands.automatic_fingerprint is distinct from excluded.automatic_fingerprint
          and (replenishment_demands.automatic_observed_at is null or replenishment_demands.automatic_observed_at<=excluded.automatic_observed_at)
        returning id,sources,automatic_fingerprint
      ), events as(insert into replenishment_demand_events(demand_id,kind,payload)
        select id,'automatic',jsonb_build_object('sources',sources,'fingerprint',automatic_fingerprint) from changed returning id)
      select count(*)::int as changed from events`,
    query`update replenishment_demands set automatic_fingerprint=null,sources='[]'::jsonb,automatic_observed_at=${observedAt}::timestamptz,version=version+1,updated_at=now()
      where store_id::text=${storeId} and product_id::text<>all(${signals.map(signal=>signal.productId)}) and automatic_fingerprint is not null
        and exists(select 1 from replenishment_demand_sync_state where store_id::text=${storeId} and observed_at=${observedAt}::timestamptz)
        and (automatic_observed_at is null or automatic_observed_at<=${observedAt}::timestamptz)`,
    // Even an unchanged observation advances its watermark, preventing a late older hook from restoring obsolete facts.
    query`update replenishment_demands set automatic_observed_at=${observedAt}::timestamptz
      where store_id::text=${storeId} and product_id::text=any(${signals.map(signal=>signal.productId)})
        and exists(select 1 from replenishment_demand_sync_state where store_id::text=${storeId} and observed_at=${observedAt}::timestamptz)
        and (automatic_observed_at is null or automatic_observed_at<=${observedAt}::timestamptz)`
  ]);
  const changed=result.find(rows=>rows[0]&&'changed' in rows[0])?.[0]?.changed;
  return {changed:Number(changed ?? 0)};
}

export async function issueReplenishmentDemandOrder(actor:EmployeeSession,input:ReplenishmentDemandCreateOrder,query:Query=sql) {
  const fingerprint=hash({...input,items:[...input.items].map(item=>({...item,expectedOpenItemIds:[...item.expectedOpenItemIds].sort()})).sort((a,b)=>a.demandId.localeCompare(b.demandId)),actorId:actor.id});
  const ids=input.items.map(item=>item.demandId);
  const pairs=await query`select product_id::text as "productId" from replenishment_demands where id::text=any(${ids}) and store_id::text=${input.storeId}`;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
  const prefix=`PO-${date}`;
  const result=await query.transaction([
    query`select pg_advisory_xact_lock(hashtextextended(${`replenishment-request:${input.requestId}`},0))`,
    query`select pg_advisory_xact_lock(hashtextextended(${`purchase-order-number:${prefix}`},0))`,
    ...createReplenishmentOrderLocks(query,[{storeId:input.storeId,productIds:pairs.map(row=>String(row.productId))}]),
    query`select id from replenishment_demands where id::text=any(${ids}) order by id for update`,
    query`select id from products where id::text=any(${pairs.map(row=>String(row.productId))}) order by id for share`,
    query`with submitted as materialized(select * from jsonb_to_recordset(${JSON.stringify(input.items)}::jsonb)
        as line("demandId" text,"expectedVersion" integer,quantity integer,unit text,"expectedOpenItemIds" jsonb)),
      prior as materialized(select request_fingerprint,order_no from replenishment_demand_issues where request_id=${input.requestId}::uuid),
      current_lines as materialized(select demands.*,submitted.quantity as final_quantity,submitted.unit as final_unit,submitted."expectedVersion",submitted."expectedOpenItemIds",
        products.unit as current_unit,products.is_orderable,products.brand_scope,products.catalog_visibility,
        coalesce((select array_agg(items.id::text order by items.id::text) from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id
          where orders.store_id=demands.store_id and items.product_id=demands.product_id
            and items.status=any(${[...openReplenishmentOrderStatuses]}) and orders.order_no not like 'RCPT-%'),'{}'::text[]) as current_open
        from submitted join replenishment_demands demands on demands.id::text=submitted."demandId"
        join products on products.id=demands.product_id),
      eligibility as(select
        (select count(*) from current_lines)=${ids.length} and exists(select 1 from stores where id::text=${input.storeId} and status='active')
        and exists(select 1 from employees where id::text=${input.buyerId} and status='active' and role in ('owner','manager','store_owner','store_manager')
    and (role='owner' or coalesce((select is_enabled from role_permissions where role=employees.role and permission_key='module.orders'),true))
          and (role in ('owner','manager') or exists(select 1 from employee_scopes scopes where scopes.employee_id=employees.id and scopes.scope_type='store' and scopes.store_id::text=${input.storeId})))
        and not exists(select 1 from current_lines line where line.store_id::text<>${input.storeId} or line.version<>line."expectedVersion"
          or line.status in ('resolved','dismissed') or line.final_quantity not between 1 and 999 or line.final_unit<>line.unit
          or line.current_unit<>line.final_unit or length(btrim(line.current_unit))=0 or not line.is_orderable
          or line.current_open<>array(select jsonb_array_elements_text(line."expectedOpenItemIds") order by 1)
          or (cardinality(line.current_open)>0 and not ${input.additionalOrderConfirmed})
          or not(line.brand_scope='common' or (line.brand_scope='specific' and exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id
            where usages.product_id=line.product_id and brands.store_id::text=${input.storeId})))
          or ((line.brand_scope='specific' or exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id
            where usages.product_id=line.product_id and brands.store_id::text=${input.storeId}))
            and not exists(select 1 from product_brand_usages usages join store_brands brands on brands.brand_id=usages.brand_id
              where usages.product_id=line.product_id and brands.store_id::text=${input.storeId} and usages.is_orderable))
          or (${!["owner","manager"].includes(actor.role)} and not(line.catalog_visibility='brand_stores' or (line.catalog_visibility='selected_stores'
            and exists(select 1 from product_catalog_store_grants grants where grants.product_id=line.product_id and grants.store_id::text=${input.storeId}))))
        ) as valid),
      order_number as(select ${prefix}||'-'||lpad((coalesce(max((substring(order_no from ${`^${prefix}-([0-9]{4})$`}))::integer),0)+1)::text,4,'0') value
        from purchase_orders where order_no like ${`${prefix}-%`}),
      inserted_order as(insert into purchase_orders(order_no,store_id,requested_by,assigned_to,deadline_label,deadline_at,requested_item_count,priority,status,note,replenishment_source)
        select order_number.value,${input.storeId}::uuid,${actor.id}::uuid,${input.buyerId}::uuid,${input.deadline ?? ''},${demandDateAt(input.deadline)}::timestamptz,${ids.length},'中','購入待ち',${input.note ?? ''},
          ${JSON.stringify({kind:'demand_pool',storeId:input.storeId,demandIds:ids,requestId:input.requestId,items:input.items})}::jsonb
        from order_number,eligibility where eligibility.valid and not exists(select 1 from prior) returning id,order_no),
      issue as(insert into replenishment_demand_issues(request_id,request_fingerprint,actor_id,purchase_order_id,order_no)
        select ${input.requestId}::uuid,${fingerprint},${actor.id}::uuid,id,order_no from inserted_order returning request_id,purchase_order_id,order_no),
      items as(insert into purchase_order_items(purchase_order_id,product_id,requested_quantity,requested_unit,status)
        select inserted_order.id,line.product_id,line.final_quantity,line.final_unit,'requested' from inserted_order,current_lines line returning id,purchase_order_id,product_id),
      links as(insert into replenishment_demand_order_items(demand_id,issue_request_id,purchase_order_id,purchase_order_item_id,order_no,cycle,requested_quantity,unit)
        select line.id,issue.request_id,issue.purchase_order_id,items.id,issue.order_no,line.cycle,line.final_quantity,line.final_unit
        from issue join items on items.purchase_order_id=issue.purchase_order_id join current_lines line on line.product_id=items.product_id returning demand_id,order_no),
      changed as(update replenishment_demands demands set status='ordered',quantity=line.final_quantity,unit=line.final_unit,deferred_until=null,
        version=demands.version+1,updated_at=now(),automatic_observed_at=clock_timestamp()
        from current_lines line where demands.id=line.id and exists(select 1 from links where demand_id=demands.id) returning demands.id,demands.quantity,demands.unit),
      events as(insert into replenishment_demand_events(demand_id,kind,actor_id,actor_name,quantity,note,payload)
        select changed.id,'create_order',${actor.id}::uuid,${actor.name},changed.quantity,links.order_no,jsonb_build_object('unit',changed.unit,'orderNo',links.order_no)
        from changed join links on links.demand_id=changed.id returning id),
      notification as(insert into os_notifications(recipient_employee_id,notification_type,title,message,href)
        select ${input.buyerId}::uuid,'new_order','新しい発注依頼',stores.name||' から '||${ids.length}::text||' 件の発注依頼が届きました。',
          '/os/procurement?order='||inserted_order.order_no from inserted_order,stores where stores.id::text=${input.storeId} returning id)
      select coalesce((select order_no from inserted_order),(select order_no from prior)) as "orderId",
        not exists(select 1 from prior where request_fingerprint<>${fingerprint}) as "sameRequest",
        (select count(*) from events)::integer as "changedCount",(select count(*) from notification)::integer as "notificationCount",
        (select id::text from notification) as "notificationId"`
  ]);
  return result[result.length-1][0] as {orderId:string|null;sameRequest:boolean;changedCount:number;notificationCount:number;notificationId:string|null};
}
