import { cookies } from "next/headers";
import { canAccessStore,requireOsSession } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { roleHasPermission } from "./role-permissions";
import { sql } from "./db";
import { canUseStoreInventory,isStoreInventoryEmployeeRole,storeInventoryPermission,storeInventoryUuid,type StoreInventoryAction } from "./store-inventory-policy";
import { readStoreInventoryOperatorToken,storeInventoryOperatorCookieName } from "./store-inventory-operator-token";
export type StoreInventoryOperator={id:string;name:string;role:string;expiresAt:string|null};
export type StoreInventoryOperatorContext={storeId:string;baseRole:string;operator:StoreInventoryOperator|null;canOperate:boolean;requiresOperatorAuthentication:boolean};
export type StoreInventoryAccess = {ok:true;baseSession:EmployeeSession;actor:EmployeeSession|null;storeId:string;operator:StoreInventoryOperator|null};
export type StoreInventoryAccessResult = StoreInventoryAccess|{ok:false;response:Response};
export const storeInventoryHeaders={"Cache-Control":"no-store, max-age=0"};
export function storeInventoryFailure(error:string,status:number,code:string) {
  return {ok:false as const,response:Response.json({error,code},{status,headers:storeInventoryHeaders})};
}
export function assertStoreInventorySameOrigin(request:Request):Response|null {
  return request.headers.get("origin")===new URL(request.url).origin&&request.headers.get("sec-fetch-site")!=="cross-site"
    ? null : storeInventoryFailure("不正なリクエスト元です。",403,"invalid_origin").response;
}
export async function requireStoreInventoryAccess(storeId:string,action:StoreInventoryAction):Promise<StoreInventoryAccessResult> {
  if(!["read","quick_check","count","receipt","exception_report"].includes(action))return storeInventoryFailure("操作を確認してください。",400,"invalid_action");
  const baseSession=await requireOsSession();
  if(!baseSession)return storeInventoryFailure("ログインしてください。",401,"session_required");
  if(!canUseStoreInventory(baseSession.role)||!await roleHasPermission(baseSession.role,storeInventoryPermission))return storeInventoryFailure("在庫を操作する権限がありません。",403,"inventory_permission");
  if(!storeInventoryUuid.test(storeId))return storeInventoryFailure("店舗を指定してください。",400,"store_required");
  if(!await canAccessStore(baseSession,storeId))return storeInventoryFailure("この店舗を操作する権限がありません。",403,"store_scope");
  const stores=await sql`select id from stores where id::text=${storeId} and status='active'`;
  if(!stores[0])return storeInventoryFailure("有効な店舗が見つかりません。",404,"store_inactive");
  if(isStoreInventoryEmployeeRole(baseSession.role)) {
    return {ok:true,baseSession,actor:baseSession,storeId,operator:{id:baseSession.id,name:baseSession.name,role:baseSession.role,expiresAt:null}};
  }
  const cookieStore=await cookies();
  const proof=readStoreInventoryOperatorToken(cookieStore.get(storeInventoryOperatorCookieName)?.value);
  const token=proof.value;
  let actor:EmployeeSession|null=null;
  if(token&&token.terminalEmployeeId===baseSession.id&&token.terminalSessionId===baseSession.sessionId&&token.storeId===storeId) {
    const rows=await sql`select id::text,name,coalesce(login_id,email,'') as "loginId",role,session_version as "sessionVersion"
      from employees where id::text=${token.operatorEmployeeId} and status='active'
        and role=${token.operatorRole} and session_version=${token.operatorSessionVersion}
        and not coalesce(password_must_change,false)`;
    const employee=rows[0] as EmployeeSession|undefined;
    if(employee&&isStoreInventoryEmployeeRole(employee.role)&&await roleHasPermission(employee.role,storeInventoryPermission)&&await canAccessStore(employee,storeId))actor=employee;
  }
  if(!actor&&action!=="read")return storeInventoryFailure(proof.expired?"操作担当者の確認期限が切れました。もう一度本人確認してください。":"操作担当者の本人確認をしてください。",401,proof.expired?"operator_expired":"operator_required");
  return {ok:true,baseSession,actor,storeId,operator:actor&&token?{id:actor.id,name:actor.name,role:actor.role,expiresAt:new Date(token.expiresAt).toISOString()}:null};
}
/** Assertion only: never accept an employee ID as an identity credential. */
export function assertExpectedStoreInventoryOperator(access:StoreInventoryAccess,expectedOperatorId:unknown):Response|null {
  if(!access.actor)return storeInventoryFailure("操作担当者の本人確認をしてください。",401,"operator_required").response;
  if(typeof expectedOperatorId!=="string"||expectedOperatorId!==access.actor.id)return storeInventoryFailure("操作担当者が変更されています。入力内容を確認し直してください。",409,"operator_changed").response;
  return null;
}
