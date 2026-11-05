import {requireMasterOsSession} from '../../../../lib/api-auth';
import {menuRecoveryView,startMenuRecovery} from '../../../../lib/menu-sync-recovery-store';
import type {MenuRecoveryAction} from '../../../../lib/menu-sync-recovery';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, max-age=0'};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const codes=new Set(['unsupported_error','target_ambiguous','stale_job','source_changed','mapping_changed','receipt_missing','bridge_offline',
  'bridge_update_required','device_selection_required','inspection_expired','state_changed','inventory_pending','inventory_failed','newer_inventory_intent',
  'hold_conflict','native_identity_unverified','native_changed','restore_unsupported','recovery_blocked','recovery_failed','result_unknown','busy']);
function error(failure:unknown) {
  const message=failure instanceof Error?failure.message:'';
  return Response.json({error:codes.has(message)?message:'state_changed'},{status:409,headers});
}
export async function GET(request:Request) {
  if(!await requireMasterOsSession())return Response.json({error:'forbidden'},{status:403,headers});
  const params=new URL(request.url).searchParams,brandId=params.get('brandId'),jobId=params.get('jobId');
  if(!uuid(brandId)||!uuid(jobId))return Response.json({error:'stale_job'},{status:400,headers});
  try {return Response.json(await menuRecoveryView(brandId,jobId),{headers});}catch(failure){return error(failure);}
}
export async function POST(request:Request) {
  // Authentication alone is insufficient for cookie-authenticated mutations.
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'forbidden'},{status:403,headers});
  const session=await requireMasterOsSession();
  if(!session)return Response.json({error:'forbidden'},{status:403,headers});
  const value:unknown=await request.json().catch(()=>null),body=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  if(!uuid(body.brandId)||!uuid(body.jobId)||!['inspect','restore_hidden','verify_release','retry'].includes(String(body.action)))return Response.json({error:'stale_job'},{status:400,headers});
  try {return Response.json(await startMenuRecovery({brandId:body.brandId,jobId:body.jobId,action:body.action as MenuRecoveryAction,
    actorId:session.id,inspectionId:typeof body.inspectionId==='string'?body.inspectionId:'',token:typeof body.token==='string'?body.token:''}),{headers});}
  catch(failure){return error(failure);}
}
