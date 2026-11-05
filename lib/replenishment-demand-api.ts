import { canAccessStore, requireWritableOsSession } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { roleHasPermission } from "./role-permissions";
import { getStoreOrderAccess } from "./store-order-access";
import { readDemandBuyers, readDemandPool, readDemandProducts, reportReplenishmentDemand, reviewReplenishmentDemand, issueReplenishmentDemandOrder, syncInventoryReplenishmentDemands } from "./replenishment-demand-data";
import { dispatchReplenishmentDemandNotification } from "./replenishment-demand-notification";
import { demandManagerRoles, demandUuid, validDemandQuantity, demandDateAt } from "./replenishment-demand-policy";
import { assertExpectedStoreInventoryOperator, assertStoreInventorySameOrigin, requireStoreInventoryAccess, storeInventoryHeaders } from "./store-inventory-access";
import type { ReplenishmentDemandCreateOrder, ReplenishmentDemandReport, ReplenishmentDemandReview } from "./replenishment-demand-types";

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:storeInventoryHeaders});
const failure=(message:string,status:number,code:string)=>reply({error:message,code},status);
const validText=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
export async function requireDemandManager() {
  const session=await requireWritableOsSession();
  if(!session||!demandManagerRoles.has(session.role)||!await roleHasPermission(session.role,'module.orders'))return null;
  return session;
}
export async function readDemandApi(request:Request,storeMode:boolean) {
  const storeId=new URL(request.url).searchParams.get('storeId')?.trim().toLowerCase() ?? '';
  if(storeMode) {
    const access=await requireStoreInventoryAccess(storeId,'read');
    if(!access.ok)return access.response;
    const all=await getStoreOrderAccess(access.baseSession);
    const stores=all.stores.filter(store=>store.id===storeId).map(({id,name})=>({id,name}));
    await syncInventoryReplenishmentDemands(access.baseSession,storeId);
    const [demands,products]=await Promise.all([readDemandPool(access.baseSession,stores),readDemandProducts(access.baseSession,storeId)]);
    return reply({stores,storeId,demands,products,operator:access.operator,canReport:Boolean(access.actor),canManage:false,buyers:[]});
  }
  const session=await requireDemandManager();
  if(!session)return failure('補充依頼を管理する権限がありません。',403,'manager_required');
  const access=await getStoreOrderAccess(session);
  if(storeId&&(!demandUuid.test(storeId)||!access.stores.some(store=>store.id===storeId)))return failure('この店舗を表示する権限がありません。',403,'store_scope');
  const stores=access.stores.map(({id,name})=>({id,name}));
  const targets=storeId?stores.filter(store=>store.id===storeId):stores;
  for(let start=0;start<targets.length;start+=2) await Promise.all(targets.slice(start,start+2).map(store=>syncInventoryReplenishmentDemands(session,store.id)));
  const [demands,products,buyers]=await Promise.all([readDemandPool(session,storeId?stores.filter(store=>store.id===storeId):stores),
    storeId?readDemandProducts(session,storeId):Promise.resolve([]),storeId?readDemandBuyers(storeId):Promise.resolve([])]);
  return reply({stores,storeId,demands,products,buyers,operator:{id:session.id,name:session.name,role:session.role,expiresAt:null},canReport:true,canManage:true});
}

export async function mutateDemandApi(request:Request,storeMode:boolean) {
  const origin=assertStoreInventorySameOrigin(request);if(origin)return origin;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.storeId!=='string'||!demandUuid.test(body.storeId))return failure('店舗と操作内容を確認してください。',400,'invalid_input');
  body.storeId=body.storeId.toLowerCase();
  let actor:EmployeeSession;
  let catalogRole:string;
  if(storeMode) {
    if(body.action!=='report')return failure('店舗からは不足報告を登録してください。',403,'report_only');
    const access=await requireStoreInventoryAccess(body.storeId,'exception_report');if(!access.ok)return access.response;
    const operatorFailure=assertExpectedStoreInventoryOperator(access,body.expectedOperatorId);if(operatorFailure)return operatorFailure;
    actor=access.actor!;catalogRole=access.baseSession.role;
  } else {
    const session=await requireDemandManager();if(!session)return failure('補充依頼を管理する権限がありません。',403,'manager_required');
    if(!await canAccessStore(session,body.storeId))return failure('この店舗を操作する権限がありません。',403,'store_scope');
    actor=session;catalogRole=session.role;
  }
  if(body.action==='report') {
    if(typeof body.productId!=='string'||!demandUuid.test(body.productId)||typeof body.requestId!=='string'||!demandUuid.test(body.requestId)
      ||!validText(body.unit,100)||!body.unit.trim()||!validText(body.note,2000)
      ||!validDemandQuantity(body.quantity ?? null,true)||body.shortageStatus!==undefined&&!['low_stock','unavailable'].includes(body.shortageStatus))return failure('商品、数量、単位と不足内容を確認してください。',400,'invalid_report');
    body.productId=body.productId.toLowerCase();body.requestId=body.requestId.toLowerCase();
    // The transaction checks current catalog for new writes but replays an immutable committed report even if its SKU was later hidden.
    const result=await reportReplenishmentDemand({...actor,role:catalogRole},body as ReplenishmentDemandReport);
    if(!result.sameRequest)return failure('同じ送信番号が別の内容で使用されています。送信内容を確認してください。',409,'request_changed');
    if(!result.demandId)return failure('商品の単位または公開範囲が変わりました。最新の内容を確認してください。',409,'catalog_changed');
    return reply({ok:true,demandId:result.demandId});
  }
  if(body.action==='review') {
    if(typeof body.demandId!=='string'||!demandUuid.test(body.demandId)||!Number.isInteger(body.expectedVersion)||body.expectedVersion<1
      ||!['open','reviewing','deferred','ordered','resolved','dismissed'].includes(body.status)||!validDemandQuantity(body.quantity,true)
      ||!validText(body.unit,100)||!body.unit.trim()||!validText(body.note,2000)
      ||(['resolved','dismissed'].includes(body.status)&&!body.note.trim())
      ||(body.status==='deferred'&&(!validText(body.deferredUntil,100)||!demandDateAt(body.deferredUntil))))return failure('状態、数量、単位と判断理由を確認してください。',400,'invalid_review');
    const demandId=await reviewReplenishmentDemand(actor,body as ReplenishmentDemandReview);
    return demandId?reply({ok:true,demandId}):failure('依頼または商品の単位が変わりました。更新して確認してください。',409,'demand_changed');
  }
  if(body.action==='create_order') {
    if(body.expectedActorId!==actor.id)return failure('操作する従業員が変わりました。発注内容を確認し直してください。',409,'actor_changed');
    if(typeof body.requestId!=='string'||!demandUuid.test(body.requestId)||typeof body.buyerId!=='string'||!demandUuid.test(body.buyerId)
      ||!Array.isArray(body.items)||!body.items.length||body.items.length>100||typeof body.additionalOrderConfirmed!=='boolean'
      ||body.note!==undefined&&!validText(body.note,2000)||body.deadline!==undefined&&(!validText(body.deadline,100)||!demandDateAt(body.deadline)))return failure('購入担当、商品と到着希望日時を確認してください。',400,'invalid_order');
    const demandIds=new Set<string>();
    for(const item of body.items) {
      if(!item||typeof item!=='object'||typeof item.demandId!=='string'||!demandUuid.test(item.demandId)||demandIds.has(item.demandId.toLowerCase())
        ||!Number.isInteger(item.expectedVersion)||item.expectedVersion<1||!validDemandQuantity(item.quantity)||!validText(item.unit,100)||!item.unit.trim()
        ||!Array.isArray(item.expectedOpenItemIds)||item.expectedOpenItemIds.length>10000
        ||item.expectedOpenItemIds.some((id:unknown)=>typeof id!=='string'||!demandUuid.test(id))
        ||new Set(item.expectedOpenItemIds).size!==item.expectedOpenItemIds.length)return failure('数量を1から999の整数で入力し、商品と未受領の発注を確認してください。',400,'invalid_order_item');
      item.demandId=item.demandId.toLowerCase();item.expectedOpenItemIds=item.expectedOpenItemIds.map((id:string)=>id.toLowerCase()).sort();demandIds.add(item.demandId);
    }
    body.requestId=body.requestId.toLowerCase();body.buyerId=body.buyerId.toLowerCase();
    const result=await issueReplenishmentDemandOrder(actor,body as ReplenishmentDemandCreateOrder);
    if(!result.sameRequest)return failure('同じ送信番号が別の内容で使用されています。発注履歴を確認してください。',409,'request_changed');
    if(!result.orderId)return failure('依頼、単位、公開範囲、購入担当または未受領の発注が変わりました。更新して確認してください。',409,'order_changed');
    if(result.notificationId)await dispatchReplenishmentDemandNotification(result.notificationId).catch(()=>console.error('replenishment_demand_notification_failed'));
    return reply({ok:true,orderId:result.orderId});
  }
  return failure('操作内容を確認してください。',400,'invalid_action');
}
export async function handleDemandApi(request:Request,storeMode:boolean,mutation=false) {
  try {return mutation?await mutateDemandApi(request,storeMode):await readDemandApi(request,storeMode);}
  catch(error) {
    // Do not disguise missing migration or database outages as an empty, healthy pool.
    console.error('replenishment_demand_request_failed',error&&typeof error==='object'&&'code' in error?error.code:'unknown');
    return failure('補充依頼を処理できませんでした。内容を保持して再試行してください。',503,'replenishment_unavailable');
  }
}
