import { canAccessStore,requireOsSession,requireWritableOsSession } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { assertProductViewableAtStore } from "../../../../lib/product-catalog-access";
import { sql } from "../../../../lib/db";
import { readInventoryOrderUsage,retryInventoryOrderUsage,mapInventoryOrderSource } from "../../../../lib/inventory-order-usage";
import { isInventoryUsageUuid,type InventoryOrderUsageRequest } from "../../../../lib/inventory-order-usage-policy";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
export async function GET(request:Request) {
  const session=await requireOsSession();
  if(!session||!await roleHasPermission(session.role,"module.inventory"))return Response.json({error:"権限がありません。"},{status:403,headers});
  const storeId=new URL(request.url).searchParams.get("storeId")?.trim()??"";
  if(!isInventoryUsageUuid(storeId))return Response.json({error:"店舗を指定してください。"},{status:400,headers});
  if(!await canAccessStore(session,storeId))return Response.json({error:"この店舗を操作する権限がありません。"},{status:403,headers});
  try {
    const writable=await requireWritableOsSession();
    const canManage=Boolean(writable&&writable.id===session.id&&writable.role===session.role);
    return Response.json(await readInventoryOrderUsage(session,storeId,canManage),{headers});
  }catch{return Response.json({error:"注文の在庫連動を読み込めませんでした。"},{status:503,headers});}
}
export async function POST(request:Request) {
  const session=await requireWritableOsSession();
  if(!session||!await roleHasPermission(session.role,"module.inventory"))return Response.json({error:"権限がありません。"},{status:403,headers});
  const body=await request.json().catch(()=>null) as InventoryOrderUsageRequest|null;
  if(!body||!isInventoryUsageUuid(body.storeId)||!["settings","location","retry","map_source"].includes(body.action))return Response.json({error:"店舗と操作を確認してください。"},{status:400,headers});
  if(!await canAccessStore(session,body.storeId))return Response.json({error:"この店舗を操作する権限がありません。"},{status:403,headers});
  try {
    if(body.action==="settings") {
      if(body.triggerMode!=="preparation")return Response.json({error:"注文の在庫連動は実際の調理開始・完了時のみ対応しています。"},{status:400,headers});
      if(typeof body.enabled!=="boolean"||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)return Response.json({error:"設定と更新情報を確認してください。"},{status:400,headers});
      const rows=await sql`
        insert into inventory_usage_settings(store_id,enabled,enabled_from,trigger_mode,revision,updated_by)
        select ${body.storeId}::uuid,${body.enabled},case when ${body.enabled} then clock_timestamp() else null end,${body.triggerMode},1,${session.id}::uuid
        where ${body.expectedRevision===0} or exists(select 1 from inventory_usage_settings where store_id::text=${body.storeId} and revision=${body.expectedRevision})
        on conflict(store_id) do update set enabled=excluded.enabled,trigger_mode=excluded.trigger_mode,
          enabled_from=case when excluded.enabled and (not inventory_usage_settings.enabled or inventory_usage_settings.trigger_mode<>excluded.trigger_mode)
            then clock_timestamp() else inventory_usage_settings.enabled_from end,
          revision=inventory_usage_settings.revision+1,updated_by=excluded.updated_by,updated_at=now()
        where inventory_usage_settings.revision=${body.expectedRevision}
        returning store_id::text
      `;
      if(!rows[0])return Response.json({error:"設定が更新されています。画面を更新してください。"},{status:409,headers});
      return Response.json({ok:true},{headers});
    }
    if(body.action==="retry")return Response.json({ok:true,result:await retryInventoryOrderUsage(body.storeId)},{headers});
    if(body.action==="map_source") {
      if(!isInventoryUsageUuid(body.orderId)||body.confirmOriginalOrder!==true)return Response.json({error:"元の注文日・注文番号・全明細と数量を確認してください。"},{status:400,headers});
      const result=await mapInventoryOrderSource(body.storeId,body.orderId,body.expectedSourceSnapshot,body.mappedItems,session.id,body.confirmedPreparedAt);
      return Response.json(result.ok?result:{error:result.error},{status:result.ok?200:result.status,headers});
    }
    if(!isInventoryUsageUuid(body.productId)||!(body.inventoryItemId===null||isInventoryUsageUuid(body.inventoryItemId))
      ||!Object.prototype.hasOwnProperty.call(body,"expectedInventoryItemId")||!(body.expectedInventoryItemId===null||isInventoryUsageUuid(body.expectedInventoryItemId)))return Response.json({error:"商品と使用庫位を確認してください。"},{status:400,headers});
    const access=await assertProductViewableAtStore(session,body.storeId,body.productId);
    if(!access.ok)return Response.json({error:access.error},{status:access.status,headers});
    if(body.inventoryItemId===null) {
      const results=await sql.transaction([
        sql`select product_id from inventory_product_usage_locations where store_id::text=${body.storeId} and product_id::text=${body.productId} for update`,
        sql`delete from inventory_product_usage_locations where store_id::text=${body.storeId} and product_id::text=${body.productId}
          and inventory_item_id::text is not distinct from ${body.expectedInventoryItemId} returning product_id::text`
      ]);
      if(!results[1]?.[0]&&body.expectedInventoryItemId!==null)return Response.json({error:"使用庫位が更新されています。画面を更新してください。"},{status:409,headers});
      if(!results[1]?.[0]) {
        const exists=await sql`select product_id from inventory_product_usage_locations where store_id::text=${body.storeId} and product_id::text=${body.productId}`;
        if(exists[0])return Response.json({error:"使用庫位が更新されています。画面を更新してください。"},{status:409,headers});
      }
      return Response.json({ok:true},{headers});
    }
    const results=await sql.transaction([
      sql`select id from products where id::text=${body.productId} for share`,
      sql`select id from inventory_items where id::text=${body.inventoryItemId} order by id for update`,
      sql`
        insert into inventory_product_usage_locations(store_id,product_id,inventory_item_id,updated_by)
        select stock.store_id,stock.product_id,stock.id,${session.id}::uuid from inventory_items stock
        join inventory_locations location on location.id=stock.location_id and location.store_id=stock.store_id
        where stock.id::text=${body.inventoryItemId} and stock.store_id::text=${body.storeId} and stock.product_id::text=${body.productId}
          and stock.status='active' and location.status='active'
          and (${body.expectedInventoryItemId===null} or exists(select 1 from inventory_product_usage_locations where store_id=stock.store_id and product_id=stock.product_id and inventory_item_id::text=${body.expectedInventoryItemId}))
        on conflict(store_id,product_id) do update set inventory_item_id=excluded.inventory_item_id,updated_by=excluded.updated_by,updated_at=now()
        where inventory_product_usage_locations.inventory_item_id::text is not distinct from ${body.expectedInventoryItemId}
        returning product_id::text
      `
    ]);
    if(!results[2]?.[0])return Response.json({error:"商品・庫位・設定が更新されています。画面を更新してください。"},{status:409,headers});
    return Response.json({ok:true},{headers});
  }catch{return Response.json({error:"注文の在庫連動を保存できませんでした。"},{status:503,headers});}
}
