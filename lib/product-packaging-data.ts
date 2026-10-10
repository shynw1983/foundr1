import type { EmployeeSession } from "./auth";
import { canAccessStore } from "./api-auth";
import { assertProductViewable, assertProductViewableAtStore } from "./product-catalog-access";
import { sql } from "./db";
import { normalizeProductBatchPackaging, ProductPackagingError, type ProductPackagingTemplate } from "./product-packaging-policy";

export async function readProductPackagingTemplates(productIds:string[],headquarters:boolean):Promise<ProductPackagingTemplate[]> {
  if(!productIds.length) return [];
  const rows=await sql`select id::text,product_id::text as "productId",name,supplier_id::text as "supplierId",packaging,status,updated_at::text as "updatedAt"
    from product_packaging_templates where product_id::text=any(${productIds}) and status='active' order by name,id`;
  return rows.map(row=>({id:String(row.id),productId:String(row.productId),name:String(row.name),supplierId:headquarters && row.supplierId ? String(row.supplierId):null,
    ...normalizeProductBatchPackaging(row.packaging),status:row.status as "active"|"inactive",updatedAt:String(row.updatedAt)}));
}
export async function assertPackagingProductAccess(session:EmployeeSession,productId:string,storeId?:string) {
  const decision=storeId ? await assertProductViewableAtStore(session,storeId,productId):await assertProductViewable(session,productId);
  if(decision.ok) return;
  // Own historical stock/purchase can use packaging without exposing unrelated catalog products.
  if(storeId && await canAccessStore(session,storeId)) {
    const rows=await sql`select exists(select 1 from inventory_items where store_id::text=${storeId} and product_id::text=${productId})
      or exists(select 1 from purchase_order_items items join purchase_orders orders on orders.id=items.purchase_order_id where orders.store_id::text=${storeId} and items.product_id::text=${productId}) as allowed`;
    if(rows[0]?.allowed===true) return;
  }
  throw new ProductPackagingError(decision.error,decision.status,"product_scope");
}
export async function saveProductPackagingTemplate(session:EmployeeSession,value:unknown) {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new ProductPackagingError("包装情報が不正です。");
  const raw=value as Record<string,unknown>,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const productId=String(raw.productId??""),id=raw.id ? String(raw.id):String(raw.requestId??"");
  if(!uuid.test(productId) || !uuid.test(id)) throw new ProductPackagingError("商品・包装を正しく指定してください。");
  const action=raw.action??"save";
  if(action!=="save" && action!=="inactivate") throw new ProductPackagingError("操作を確認してください。");
  const name=String(raw.name??"").trim(),supplierId=raw.supplierId ? String(raw.supplierId):null;
  if(action==="save" && (!name || name.length>160 || (supplierId && !uuid.test(supplierId)))) throw new ProductPackagingError("包装名・発注先を確認してください。");
  const packaging=action==="save" ? normalizeProductBatchPackaging(raw.packaging):null;
  if(packaging) delete packaging.templateId;
  if(raw.id && typeof raw.expectedUpdatedAt!=="string") throw new ProductPackagingError("包装情報を再取得してください。",409,"template_changed");
  const createPayload=JSON.stringify({productId,name,supplierId,packaging});
  const queries=[sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-packaging:${id}`},0))`,sql`select id from products where id::text=${productId} for share`];
  if(raw.id) {
    queries.push(sql`select id from product_packaging_templates where id::text=${id} for update`);
    queries.push(sql`select 1/count(*)::int from product_packaging_templates where id::text=${id} and product_id::text=${productId} and updated_at::text=${raw.expectedUpdatedAt as string}`);
    queries.push(action==="inactivate" ? sql`update product_packaging_templates set status='inactive',updated_at=clock_timestamp(),updated_by=${session.id}::uuid where id::text=${id}`:
      sql`update product_packaging_templates set name=${name},supplier_id=${supplierId}::uuid,packaging=${JSON.stringify(packaging)}::jsonb,status='active',updated_at=clock_timestamp(),updated_by=${session.id}::uuid where id::text=${id}`);
  } else {
    if(action!=="save") throw new ProductPackagingError("停止する包装を指定してください。");
    queries.push(sql`select 1/count(*)::int from (select 1 where not exists(select 1 from product_packaging_templates where id::text=${id})
      or exists(select 1 from product_packaging_templates where id::text=${id} and create_request_payload=${createPayload}::jsonb)) valid`);
    queries.push(sql`insert into product_packaging_templates(id,product_id,supplier_id,name,packaging,created_by,updated_by,create_request_payload)
      values(${id}::uuid,${productId}::uuid,${supplierId}::uuid,${name},${JSON.stringify(packaging)}::jsonb,${session.id}::uuid,${session.id}::uuid,${createPayload}::jsonb)
      on conflict(id) do nothing returning id::text`);
  }
  let replayed=false;
  try {const results=await sql.transaction(queries);replayed=!raw.id && !results[results.length-1]?.[0]?.id;} catch(error) {
    if(error && typeof error==="object" && "code" in error) {
      if(error.code==="22012") throw new ProductPackagingError(raw.id ? "包装情報が更新されました。再取得してください。":"同じ送信IDで別の包装は保存できません。",409,raw.id ? "template_changed":"request_conflict");
      if(error.code==="23505") throw new ProductPackagingError("同じ商品に同名の包装テンプレートが既にあります。既存の包装を選択して編集してください。",409,"template_exists");
    }
    throw error;
  }
  return {id,replayed};
}
