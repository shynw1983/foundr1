import {requireMasterOsSession} from '../../../../lib/api-auth';
import {getScopedStoreFilter,getStoreOrderAccess} from '../../../../lib/store-order-access';
import {withInventoryOperationLock} from '../../../../lib/inventory-operation-lock';
import {sql} from '../../../../lib/db';
import {publishBridgeCommandAvailable} from '../../../../lib/local-bridge-realtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const platforms=['uber_eats','rocket_now','demae_can'];
const validRequestId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clean=(value:unknown,max=80)=>typeof value==='string'?value.trim().slice(0,max):'';
async function permitted(storeId:string) {
  const session=await requireMasterOsSession();
  if(!session||!['owner','manager'].includes(session.role)||!storeId)return null;
  const access=await getStoreOrderAccess(session);
  if(getScopedStoreFilter(access,storeId)==='__forbidden__'||!access.stores.some(store=>store.id===storeId))return null;
  return session;
}
function publicCommand(row:Record<string,unknown>) {
  const result=row.result&&typeof row.result==='object'?row.result as Record<string,unknown>:{};
  const verifiedAt=typeof result.verifiedAt==='string'&&Number.isFinite(Date.parse(result.verifiedAt))?new Date(result.verifiedAt).toISOString():undefined;
  return {id:String(row.id),status:String(row.status),result:{
    ...(typeof result.connectionRecovered==='boolean'?{connectionRecovered:result.connectionRecovered}:{}),
    ...(typeof result.inventoryChanged==='boolean'?{inventoryChanged:result.inventoryChanged}:{}),...(verifiedAt?{verifiedAt}:{})}};
}
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams,storeId=clean(params.get('storeId')),id=clean(params.get('id')),platform=clean(params.get('platform'),30),requestId=clean(params.get('requestId'));
  if(!await permitted(storeId))return Response.json({error:'forbidden'},{status:403});
  if(!id&&(!platforms.includes(platform)||!validRequestId(requestId)))return Response.json({error:'invalid_platform'},{status:400});
  const rows=await sql`select id::text,case when (status='pending' and created_at<now()-interval '5 minutes')
    or (status='processing' and claim_expires_at<now()) then 'failed' else status end as status,result
    from local_bridge_commands where store_id::text=${storeId} and (${id}<>'' and id::text=${id} or ${id}='' and platform=${platform} and payload->>'requestId'=${requestId})
      and command_type='reset_platform_connection' order by created_at desc,id desc limit 1`;
  return Response.json({command:rows[0]?publicCommand(rows[0]):null},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'forbidden'},{status:403});
  const value:unknown=await request.json().catch(()=>null),body=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const storeId=clean(body.storeId),platform=clean(body.platform,30),requestId=clean(body.requestId),session=await permitted(storeId);
  if(!session)return Response.json({error:'forbidden'},{status:403});
  if(!platforms.includes(platform)||!validRequestId(requestId))return Response.json({error:'invalid_platform'},{status:400});
  try {
    const command=await withInventoryOperationLock(storeId,async()=>{
      const devices=await sql`select id::text,last_seen_at,health_status from local_bridge_devices
        where store_id::text=${storeId} and platform='desktop' and is_enabled=true`;
      if(devices.length!==1)throw Error('device_selection_required');
      const device=devices[0],seen=Date.parse(String(device.last_seen_at??''));
      if(!Number.isFinite(seen)||Date.now()-seen>120000||seen>Date.now()+5000)throw Error('bridge_offline');
      if((device.health_status as Record<string,unknown>)?.connectionRecoveryVersion!==1)throw Error('bridge_update_required');
      await sql`update local_bridge_commands set status='failed',last_error='connection_recovery_expired',completed_at=now(),updated_at=now()
        where store_id::text=${storeId} and command_type='reset_platform_connection'
          and ((status='pending' and created_at<now()-interval '5 minutes') or (status='processing' and claim_expires_at<now()))`;
      const previous=await sql`select id::text,status,created_at from local_bridge_commands
        where store_id::text=${storeId} and command_type='reset_platform_connection' and platform=${platform}
        order by created_at desc,id desc limit 1`;
      if(previous[0]&&['pending','processing'].includes(String(previous[0].status)))return {id:String(previous[0].id),status:String(previous[0].status)};
      if(previous[0]&&Date.now()-Date.parse(String(previous[0].created_at))<60000)throw Error('recovery_cooldown');
      const rows=await sql`insert into local_bridge_commands(store_id,platform,command_type,idempotency_key,payload)
        values(${storeId},${platform},'reset_platform_connection',${`connection-recovery:${storeId}:${platform}:${requestId}`},
          ${JSON.stringify({deviceId:String(device.id),requestedBy:session.id,requestId,connectionRecoveryVersion:1})}::jsonb) returning id::text,status`;
      return {id:String(rows[0].id),status:String(rows[0].status)};
    });
    await publishBridgeCommandAvailable(storeId).catch(()=>undefined);
    return Response.json({command},{headers:{'Cache-Control':'no-store'}});
  } catch(failure) {
    const code=failure instanceof Error?failure.message:'';
    if(['device_selection_required','bridge_offline','bridge_update_required','recovery_cooldown'].includes(code))return Response.json({error:code},{status:409});
    if(code==='販売状態を更新中です。完了後に再実行してください。')return Response.json({error:'busy'},{status:409});
    // A lost DB response or post-insert lock-release failure may have queued
    // the request. The client must inspect its nonce instead of replaying it.
    return Response.json({error:'request_unknown'},{status:503});
  }
}
