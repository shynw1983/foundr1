import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { assertExpectedStoreInventoryOperator, assertStoreInventorySameOrigin, requireStoreInventoryAccess } from "../../../../lib/store-inventory-access";
import type { EmployeeSession } from "../../../../lib/auth";
import { createReplenishmentOrderLocks } from "../../../../lib/replenishment-order-locks";

import { createDeliveryBatchTransitionQuery } from "../../../../lib/procurement-delivery-transition";

type ReceivingPayload = {
  type?: "batch" | "items";
  batchId?: string;
  itemIds?: string[];
  storeId?: string;
  expectedOperatorId?: string;
  confirmArrivalOnly?: true;
};

export const dynamic = "force-dynamic";
const noStore={"Cache-Control":"no-store, max-age=0"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeItemIds(value: unknown) {
  return Array.from(new Set(Array.isArray(value) ? value.map(item=>String(item).trim().toLowerCase()).filter(Boolean) : []));
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const scope = await getSessionStoreScope(session);
  const requestedStoreId=new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  let canConfirmReceiving=false;
  let operator:unknown=null;
  if(requestedStoreId || !["owner","manager"].includes(session.role)) {
    const selected=requestedStoreId || (scope.storeIds.length===1 ? scope.storeIds[0]:"");
    const access=await requireStoreInventoryAccess(selected,"read");
    if(!access.ok)return access.response;
    scope.allStores=false;scope.storeIds=[access.storeId];
    canConfirmReceiving=Boolean(access.actor);operator=access.operator;
  } else {
    if(!await roleHasPermission(session.role,"store.inventory"))return Response.json({error:"在庫を操作する権限がありません。"},{status:403,headers:noStore});
    canConfirmReceiving=true;
  }
  const batches = await sql`
    select
      concat('batch:', delivery_batches.id::text) as id,
      'batch' as type,
      delivery_batches.id::text as "batchId",
      purchase_orders.order_no as "orderId",
      stores.id::text as "storeId",
      stores.name as "storeName",
      concat(purchase_orders.order_no, '-', delivery_batches.batch_no) as label,
      delivery_batches.status,
      to_char(delivery_batches.delivered_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "deliveredLabel",
      to_char(delivery_batches.store_confirmed_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "confirmedLabel",
      coalesce(json_agg(json_build_object(
        'id', purchase_order_items.id::text,
        'name', coalesce(products.name, purchase_order_items.temporary_product_name, '商品'),
        'requestedQuantity', purchase_order_items.requested_quantity,
        'actualQuantity', coalesce(purchase_order_items.actual_quantity, actuals.actual_quantity),
        'actualUnit', case when actuals.actual_quantity is not null and actuals.actual_quantity is not distinct from coalesce(purchase_order_items.actual_quantity,actuals.actual_quantity) then nullif(btrim(actuals.actual_unit),'') else null end,
        'requestedUnit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'productId', purchase_order_items.product_id::text,
        'status',purchase_order_items.status,
        'stockReceivedQuantity',stock_receipts.quantity,
        'stockReceivedUnits',stock_receipts.units,
        'unit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'note', coalesce(purchase_order_items.procurement_note, purchase_order_items.note, '')
      ) order by coalesce(products.name, purchase_order_items.temporary_product_name, '商品')) filter (where purchase_order_items.id is not null), '[]'::json) as items
    from delivery_batches
    join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join delivery_batch_items on delivery_batch_items.delivery_batch_id = delivery_batches.id
    left join purchase_order_items on purchase_order_items.id = delivery_batch_items.purchase_order_item_id
    left join products on products.id = purchase_order_items.product_id
    left join lateral (select actual_quantity,actual_unit from purchase_actuals where purchase_order_item_id=purchase_order_items.id order by recorded_at desc,id desc limit 1) actuals on true
    left join lateral (select coalesce(sum(receipts.purchase_quantity),0)::float as quantity,
      coalesce(jsonb_agg(distinct receipts.purchase_unit),'[]'::jsonb) as units
      from inventory_stock_receipts receipts where receipts.purchase_order_item_id=purchase_order_items.id) stock_receipts on true
    where delivery_batches.status in ('delivered', 'received')
      and (
        ${scope.allStores}
        or purchase_orders.store_id::text = any(${scope.storeIds})
      )
    group by delivery_batches.id, purchase_orders.order_no, stores.id, stores.name
    order by delivery_batches.delivered_at desc nulls last, delivery_batches.created_at desc
    limit 50
  `;

  const directGroups = await sql`
    select
      concat('items:', purchase_orders.order_no) as id,
      'items' as type,
      null::text as "batchId",
      purchase_orders.order_no as "orderId",
      stores.id::text as "storeId",
      stores.name as "storeName",
      concat(purchase_orders.order_no, '-NET') as label,
      case
        when bool_and(purchase_order_items.status = 'received') then 'received'
        else 'delivered'
      end as status,
      '' as "deliveredLabel",
      to_char(max(purchase_order_items.store_feedback_confirmed_at) at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "confirmedLabel",
      coalesce(json_agg(json_build_object(
        'id', purchase_order_items.id::text,
        'name', coalesce(products.name, purchase_order_items.temporary_product_name, '商品'),
        'requestedQuantity', purchase_order_items.requested_quantity,
        'actualQuantity', coalesce(purchase_order_items.actual_quantity, actuals.actual_quantity),
        'actualUnit', case when actuals.actual_quantity is not null and actuals.actual_quantity is not distinct from coalesce(purchase_order_items.actual_quantity,actuals.actual_quantity) then nullif(btrim(actuals.actual_unit),'') else null end,
        'requestedUnit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'productId', purchase_order_items.product_id::text,
        'status',purchase_order_items.status,
        'stockReceivedQuantity',stock_receipts.quantity,
        'stockReceivedUnits',stock_receipts.units,
        'unit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'note', coalesce(purchase_order_items.procurement_note, purchase_order_items.note, '')
      ) order by coalesce(products.name, purchase_order_items.temporary_product_name, '商品')), '[]'::json) as items
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join products on products.id = purchase_order_items.product_id
    left join lateral (select actual_quantity,actual_unit from purchase_actuals where purchase_order_item_id=purchase_order_items.id order by recorded_at desc,id desc limit 1) actuals on true
    left join lateral (select coalesce(sum(receipts.purchase_quantity),0)::float as quantity,
      coalesce(jsonb_agg(distinct receipts.purchase_unit),'[]'::jsonb) as units
      from inventory_stock_receipts receipts where receipts.purchase_order_item_id=purchase_order_items.id) stock_receipts on true
    left join delivery_batch_items on delivery_batch_items.purchase_order_item_id = purchase_order_items.id
    where delivery_batch_items.purchase_order_item_id is null
      and purchase_order_items.status in ('delivered', 'received')
      and (
        ${scope.allStores}
        or purchase_orders.store_id::text = any(${scope.storeIds})
      )
    group by purchase_orders.order_no, stores.id, stores.name
    order by purchase_orders.order_no desc
    limit 50
  `;

  const confirmations=[...batches,...directGroups].map(group=>({...group,items:(Array.isArray(group.items)?group.items:[]).map((item:Record<string,unknown>)=>{
    const actual=item.actualQuantity===null || item.actualQuantity===undefined ? null:Number(item.actualQuantity);
    const units=Array.isArray(item.stockReceivedUnits)?item.stockReceivedUnits:[];
    const known=actual!==null&&Number.isFinite(actual)&&actual>0&&typeof item.actualUnit==="string"&&Boolean(item.actualUnit)&&units.every(unit=>unit===item.actualUnit);
    const registered=Number(item.stockReceivedQuantity ?? 0);
    return {...item,stockRecordStatus:!item.productId?"unsupported":!known?"needs_review":actual!==null&&registered>=actual?"complete":registered>0?"partial":"pending"};
  })}));
  return Response.json({confirmations,canConfirmReceiving,operator}, {headers:noStore});
}

async function receivingActor(session:EmployeeSession,storeId:string,body:ReceivingPayload) {
  if(body.storeId && body.storeId!==storeId)return {ok:false as const,response:Response.json({error:"店舗が変わりました。納品内容を確認してください。",code:"store_changed"},{status:409,headers:noStore})};
  const access=await requireStoreInventoryAccess(storeId,"receipt");
  if(!access.ok)return access;
  if(body.confirmArrivalOnly||!["owner","manager"].includes(session.role)||body.expectedOperatorId!==undefined) {
    const failure=assertExpectedStoreInventoryOperator(access,body.expectedOperatorId);
    if(failure)return {ok:false as const,response:failure};
  }
  if(!access.actor)return {ok:false as const,response:Response.json({error:"操作する従業員を確認してください。",code:"operator_required"},{status:401,headers:noStore})};
  return {ok:true as const,actor:access.actor};
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const parsed = await request.json().catch(() => null);
  const body = (parsed && typeof parsed==="object" && !Array.isArray(parsed) ? parsed : {}) as ReceivingPayload;
  if(!["owner","manager"].includes(session.role)||body.confirmArrivalOnly) {
    const originFailure=assertStoreInventorySameOrigin(request);
    if(originFailure)return originFailure;
  }
  if(parsed?.confirmArrivalOnly!==undefined && parsed.confirmArrivalOnly!==true) return Response.json({error:"確認種別が正しくありません。"},{status:400,headers:noStore});
  if(body.confirmArrivalOnly&&body.type!=="items")return Response.json({error:"確認種別が正しくありません。"},{status:400,headers:noStore});

  if (body.type === "batch") {
    const batchId = String(body.batchId ?? "");
    if (!uuid.test(batchId)) return Response.json({ error: "配送バッチが見つかりません。" }, { status: 400,headers:noStore });

    const batchRows = await sql`
      select purchase_orders.store_id::text as "storeId",
        exists (
          select 1 from delivery_batch_items
          join purchase_order_items on purchase_order_items.id = delivery_batch_items.purchase_order_item_id
          where delivery_batch_items.delivery_batch_id = delivery_batches.id
        ) as "hasItems"
      from delivery_batches
      join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
      where delivery_batches.id = ${batchId}
      limit 1
    `;
    if (!batchRows[0]) return Response.json({ error: "配送バッチが見つかりません。" }, { status: 404 });
    const access=await receivingActor(session,String(batchRows[0].storeId),body);
    if(!access.ok)return access.response;
    if (!batchRows[0].hasItems) {
      return Response.json({ error: "確認する商品がありません。発注内容を確認してください。" }, { status: 409 });
    }

    const transitions = await createDeliveryBatchTransitionQuery(sql, {
      batchId, storeId: String(batchRows[0].storeId), status: "received", employeeId: access.actor.id
    });
    if (!transitions[0]) {
      return Response.json({ error: "配送状態が変わりました。最新の納品内容を確認してください。" }, { status: 409 });
    }

    return Response.json({ ok: true });
  }

  if (body.type === "items") {
    const itemIds = normalizeItemIds(body.itemIds);
    if (itemIds.length === 0 || itemIds.length>200 || itemIds.some(id=>!uuid.test(id))) return Response.json({ error: "確認対象がありません。" }, { status: 400,headers:noStore });

    const storeRows = await sql`
      select purchase_order_items.id::text,purchase_orders.store_id::text as "storeId",
        purchase_orders.id::text as "purchaseOrderId",purchase_order_items.product_id::text as "productId"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      where purchase_order_items.id::text = any(${itemIds})
    `;
    if (storeRows.length !== itemIds.length) return Response.json({ error: "確認対象が見つかりません。" }, { status: 404,headers:noStore });
    if(body.confirmArrivalOnly && new Set(storeRows.map(row=>String(row.storeId))).size!==1) {
      return Response.json({error:"この店舗の納品を確認してください。",code:"store_scope"},{status:403,headers:noStore});
    }
    let actor:EmployeeSession|null=null;
    for (const storeId of new Set(storeRows.map(row=>String(row.storeId)))) {
      const access=await receivingActor(session,storeId,body);
      if(!access.ok)return access.response;
      if(actor&&actor.id!==access.actor.id)return Response.json({error:"操作する従業員が変わりました。入力内容を確認してください。",code:"operator_changed"},{status:409,headers:noStore});
      actor=access.actor;
    }

    if(body.confirmArrivalOnly) {
      const batches=await sql`select distinct batches.id::text,orders.id::text as "purchaseOrderId",orders.store_id::text as "storeId"
        from delivery_batch_items links join delivery_batches batches on batches.id=links.delivery_batch_id
        join purchase_orders orders on orders.id=batches.purchase_order_id
        where links.purchase_order_item_id::text=any(${itemIds}) order by batches.id::text`;
      const batchIds=batches.map(row=>String(row.id));
      try {
        const result=await sql.transaction([
          // Acquire every order before SKU locks, so selections spanning orders cannot invert the shared order/SKU lock order.
          ...[...new Set(storeRows.map(row=>String(row.purchaseOrderId)))].sort().flatMap(orderId=>createReplenishmentOrderLocks(sql,[],orderId)),
          ...createReplenishmentOrderLocks(sql,[{storeId:String(storeRows[0].storeId),productIds:storeRows.map(row=>row.productId ? String(row.productId):null)}]),
          // Match the receipt and batch lifecycle lock order before locking the selected source rows.
          sql`select id from delivery_batches where id::text=any(${batchIds}) order by id for update`,
          sql`select id from purchase_order_items where id::text=any(${itemIds}) order by id for update`,
          sql`select 1/count(*)::int from (
            select 1 where (select count(*) from purchase_order_items where id::text=any(${itemIds}))=${itemIds.length}
              and not exists(select 1 from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id
                join jsonb_to_recordset(${JSON.stringify(storeRows.map(row=>({id:String(row.id),purchaseOrderId:String(row.purchaseOrderId),productId:row.productId===null ? null:String(row.productId)})))}::jsonb)
                  as expected(id text,"purchaseOrderId" text,"productId" text) on expected.id=items.id::text
                left join lateral(select actual_quantity,actual_unit from purchase_actuals where purchase_order_item_id=items.id order by recorded_at desc,id desc limit 1) actuals on true
                left join delivery_batch_items links on links.purchase_order_item_id=items.id
                left join delivery_batches batches on batches.id=links.delivery_batch_id
                where items.id::text=any(${itemIds}) and (
                  items.status not in ('delivered','received') or orders.store_id::text<>${String(storeRows[0].storeId)}
                  or items.purchase_order_id::text<>expected."purchaseOrderId" or items.product_id::text is distinct from expected."productId"
                  or (batches.id is not null and (batches.id::text<>all(${batchIds}) or batches.purchase_order_id<>items.purchase_order_id or batches.status not in ('delivered','received')))
                  or (items.product_id is not null and coalesce(items.actual_quantity,actuals.actual_quantity)>0
                    and actuals.actual_quantity is not null and actuals.actual_quantity is not distinct from coalesce(items.actual_quantity,actuals.actual_quantity)
                    and nullif(btrim(actuals.actual_unit),'') is not null)
                ))
          ) valid`,
          sql`update purchase_order_items set status='received',
            store_feedback_confirmed_at=coalesce(store_feedback_confirmed_at,now()),
            store_feedback_confirmed_by=coalesce(store_feedback_confirmed_by,${actor!.id}::uuid)
            where id::text=any(${itemIds}) and status='delivered' returning id::text`,
          sql`update delivery_batches batches set status='received',store_confirmed_at=coalesce(store_confirmed_at,now()),
            store_confirmed_by=coalesce(store_confirmed_by,${actor!.id}::uuid)
            where batches.id::text=any(${batchIds}) and batches.status='delivered'
              and exists(select 1 from delivery_batch_items where delivery_batch_id=batches.id)
              and not exists(select 1 from delivery_batch_items links join purchase_order_items items on items.id=links.purchase_order_item_id
                where links.delivery_batch_id=batches.id and (items.purchase_order_id<>batches.purchase_order_id or items.status<>'received'))
            returning batches.id::text`
        ]);
        return Response.json({ok:true,arrivalOnly:true,changed:result[result.length-2].length>0||result[result.length-1].length>0},{headers:noStore});
      } catch(error) {
        if(error&&typeof error==="object"&&"code" in error&&error.code==="22012")return Response.json({error:"購入数量や配送状態が変わりました。納品内容を更新して確認してください。",code:"receiving_changed"},{status:409,headers:noStore});
        return Response.json({error:"到着確認を保存できませんでした。更新して確認してください。",code:"receiving_failed"},{status:503,headers:noStore});
      }
    }

    const transitions=await sql`
      with locked_items as materialized (
        select items.id,items.status,orders.store_id::text as store_id
        from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id
        where items.id::text=any(${itemIds}) for update of items
      ), eligible as (
        select 1 where (select count(*) from locked_items)=${itemIds.length}
          and not exists(select 1 from locked_items where status not in ('delivered','received'))
          and not exists(select 1 from locked_items locked join
            jsonb_to_recordset(${JSON.stringify(storeRows.map(row=>({id:String(row.id),storeId:String(row.storeId)})))}::jsonb)
              as expected(id text,"storeId" text) on expected.id=locked.id::text
            where locked.store_id<>expected."storeId")
          and not exists(select 1 from delivery_batch_items where purchase_order_item_id::text=any(${itemIds}))
      ), updated_items as (
        update purchase_order_items items set status='received',
          store_feedback_confirmed_at=coalesce(items.store_feedback_confirmed_at,now()),
          store_feedback_confirmed_by=coalesce(items.store_feedback_confirmed_by,${actor!.id}::uuid)
        where items.id in (select id from locked_items) and exists(select 1 from eligible)
        returning items.id
      ) select (select count(*) from updated_items)::int as "itemCount" from eligible
    `;
    if(!transitions[0])return Response.json({error:"配送状態が変わりました。最新の納品内容を確認してください。"},{status:409,headers:noStore});

    return Response.json({ ok: true });
  }

  return Response.json({ error: "確認種別が正しくありません。" }, { status: 400 });
}
