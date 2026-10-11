import { verifyPassword,type EmployeeSession } from "../../../../../lib/auth";
import { canAccessStore } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit-log";
import { roleHasPermission } from "../../../../../lib/role-permissions";
import { isStoreInventoryEmployeeRole,storeInventoryPermission } from "../../../../../lib/store-inventory-policy";
import { requireStoreInventoryAccess,assertStoreInventorySameOrigin,storeInventoryFailure,storeInventoryHeaders,type StoreInventoryAccess,type StoreInventoryOperatorContext } from "../../../../../lib/store-inventory-access";
import { createStoreInventoryOperatorToken,storeInventoryOperatorCookie } from "../../../../../lib/store-inventory-operator-token";
export const dynamic="force-dynamic";
function context(access:StoreInventoryAccess):StoreInventoryOperatorContext {
  return {storeId:access.storeId,baseRole:access.baseSession.role,operator:access.operator,canOperate:Boolean(access.actor),requiresOperatorAuthentication:access.baseSession.role==="store_terminal"&&!access.actor};
}
export async function GET(request:Request) {
  try {
    const access=await requireStoreInventoryAccess(new URL(request.url).searchParams.get("storeId")?.trim()??"","read");
    return access.ok?Response.json(context(access),{headers:storeInventoryHeaders}):access.response;
  }catch{return storeInventoryFailure("操作担当者を読み込めませんでした。再読み込みしてください。",503,"operator_unavailable").response;}
}
export async function POST(request:Request) {
  const originError=assertStoreInventorySameOrigin(request);if(originError)return originError;
  try {
    const body=await request.json().catch(()=>null) as {storeId?:unknown;loginId?:unknown;password?:unknown}|null;
    const storeId=typeof body?.storeId==="string"?body.storeId.trim():"";
    const access=await requireStoreInventoryAccess(storeId,"read");
    if(!access.ok)return access.response;
    if(access.baseSession.role!=="store_terminal"||!access.baseSession.sessionId)return storeInventoryFailure("個人アカウントはログインした本人として操作してください。",400,"personal_operator").response;
    const loginId=typeof body?.loginId==="string"?body.loginId.trim():"";
    const password=typeof body?.password==="string"?body.password:"";
    if(!loginId||!password||loginId.length>200||password.length>500)return storeInventoryFailure("ログインIDとパスワードを入力してください。",400,"credentials_required").response;
    // One database quota per authenticated terminal session survives cold
    // instances and IP changes. Pending checks count until they succeed.
    const quota=await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${`store-operator-attempt:${access.baseSession.sessionId}`},0))`,
      sql`with quota as materialized (
        select count(*) as attempts from os_audit_logs where actor_employee_id=${access.baseSession.id}::uuid
          and action='store.inventory_operator_attempt' and metadata->>'terminalSessionId'=${access.baseSession.sessionId}
          and created_at>now()-interval '10 minutes'
      ) insert into os_audit_logs(actor_employee_id,action,target_type,target_id,metadata)
        select ${access.baseSession.id}::uuid,'store.inventory_operator_attempt','store',${storeId},
          jsonb_build_object('terminalSessionId',${access.baseSession.sessionId}::text,'storeId',${storeId}::text)
        from quota where attempts<8 returning id::text`
    ]);
    const attemptId=quota[1]?.[0]?.id;
    if(!attemptId)return storeInventoryFailure("本人確認の試行回数が多すぎます。10分後に再度確認してください。",429,"operator_rate_limited").response;
    const rows=await sql`select id::text,name,coalesce(login_id,email,'') as "loginId",role,session_version as "sessionVersion",
      password_hash as "passwordHash",coalesce(password_must_change,false) as "passwordMustChange"
      from employees where status='active' and (login_id=${loginId} or email=${loginId}) limit 1`;
    const employee=rows[0] as (EmployeeSession&{passwordHash:string|null;passwordMustChange:boolean})|undefined;
    if(!employee?.passwordHash||!verifyPassword(password,employee.passwordHash)||!isStoreInventoryEmployeeRole(employee.role))return storeInventoryFailure("本人確認できませんでした。ログイン情報を確認してください。",401,"operator_credentials").response;
    if(employee.passwordMustChange)return storeInventoryFailure("初期パスワードを変更してから本人確認してください。Foundr1 STAFFで変更できます。",403,"password_change_required").response;
    if(!await roleHasPermission(employee.role,storeInventoryPermission)||!await canAccessStore(employee,storeId))return storeInventoryFailure("この店舗で在庫を操作する権限がありません。",403,"operator_store_scope").response;
    const minted=createStoreInventoryOperatorToken({terminalEmployeeId:access.baseSession.id,terminalSessionId:access.baseSession.sessionId,
      storeId,operatorEmployeeId:employee.id,operatorSessionVersion:employee.sessionVersion,operatorRole:employee.role});
    const succeeded=await sql`update os_audit_logs set action='store.inventory_operator_attempt_succeeded'
      where id::text=${String(attemptId)} and actor_employee_id=${access.baseSession.id}::uuid
        and action='store.inventory_operator_attempt' and metadata->>'terminalSessionId'=${access.baseSession.sessionId}
      returning id::text`;
    if(!succeeded[0])throw new Error("Operator quota confirmation failed");
    await writeAuditLog({actorEmployeeId:employee.id,action:"store.inventory_operator_verified",targetType:"store",targetId:storeId,
      metadata:{terminalEmployeeId:access.baseSession.id,terminalSessionId:access.baseSession.sessionId,expiresAt:minted.expiresAt},request});
    const response=Response.json({storeId,baseRole:access.baseSession.role,operator:{id:employee.id,name:employee.name,role:employee.role,expiresAt:minted.expiresAt},canOperate:true,requiresOperatorAuthentication:false} satisfies StoreInventoryOperatorContext,{headers:storeInventoryHeaders});
    response.headers.append("Set-Cookie",storeInventoryOperatorCookie(minted.token));return response;
  }catch{return storeInventoryFailure("本人確認を完了できませんでした。再度確認してください。",503,"operator_unavailable").response;}
}
export async function DELETE(request:Request) {
  const originError=assertStoreInventorySameOrigin(request);if(originError)return originError;
  try {
    const body=await request.json().catch(()=>null) as {storeId?:unknown}|null;
    const access=await requireStoreInventoryAccess(typeof body?.storeId==="string"?body.storeId.trim():"","read");
    if(!access.ok)return access.response;
    const response=Response.json({storeId:access.storeId,baseRole:access.baseSession.role,operator:access.baseSession.role==="store_terminal"?null:access.operator,
      canOperate:access.baseSession.role!=="store_terminal",requiresOperatorAuthentication:access.baseSession.role==="store_terminal"} satisfies StoreInventoryOperatorContext,{headers:storeInventoryHeaders});
    response.headers.append("Set-Cookie",storeInventoryOperatorCookie("",0));return response;
  }catch{return storeInventoryFailure("操作担当者の確認を解除できませんでした。",503,"operator_unavailable").response;}
}
