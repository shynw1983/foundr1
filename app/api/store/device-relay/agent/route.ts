import { randomUUID } from 'node:crypto';
import { sql } from '../../../../../lib/db';
import { activeRelayDevice, relayError, relayHash, relayResponse, relayRegisterOpenSql } from '../../../../../lib/store-relay';
import { evaluatePosScaleFilter, normalizePosScaleFilterSettings } from '../../../../../lib/pos-scale-filter';
import { parseAndScaleLine } from '../../../../../lib/store-relay-policy';
import { cancelRefundedRelayJobs, relayJobCanPrintSql, relayJobHasRefundSql, relayPrintLock, relayReceiptWithRefundNotice } from '../../../../../lib/store-relay-print-policy';
import { cancelIneligiblePosPrintRelayJobs, posPrintDocumentRelayEligibleSql, posPrintDocumentRelayOwnedSql } from '../../../../../lib/pos-print-document-ledger';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    const device=await activeRelayDevice(request);const b=await request.json();
    const lock=sql`select s.id from store_relay_stations s join store_relay_devices d on d.station_id=s.id
      where d.id=${device.id}::uuid and not d.revoked and s.enabled for update of s,d`;
    // Recheck the credential inside every transaction: revocation must fence in-flight requests.
    const hash=relayHash(request.headers.get('authorization')!.slice(7));
    const guard=sql`select 1 / case when exists(select 1 from store_relay_devices d join store_relay_stations s on s.id=d.station_id
      where d.id=${device.id}::uuid and d.token_hash=${hash} and not d.revoked and s.enabled) then 1 else 0 end`;
    if(b.action==='heartbeat'){
      const status={printer:String(b.status?.printer||'unknown').slice(0,120),scale:String(b.status?.scale||'not_configured').slice(0,120),version:1,scaleTareVersion:b.status?.scaleTareVersion===1?1:0};
      const results=await sql.transaction([lock,guard,sql`update store_relay_devices set heartbeat_at=now(),status=${JSON.stringify(status)}::jsonb where id=${device.id}::uuid`,
        sql`select s.id,s.store_id,s.print_enabled,(${sql.unsafe(relayRegisterOpenSql)} and s.scale_enabled) as scale_enabled,s.scale_sequence,
          (${sql.unsafe(relayRegisterOpenSql)}) as register_open,
          case when not (${sql.unsafe(relayRegisterOpenSql)}) then 15000
            when s.scale_enabled and s.owner_until>now() then case when s.scale_session is null then 1000 else 3000 end else 10000 end as heartbeat_interval_ms,
          case when exists(select 1 from store_relay_print_jobs j where j.station_id=s.id and j.state in ('pending','sending')) then 3000 else 15000 end as print_interval_ms,
          case when ${sql.unsafe(relayRegisterOpenSql)} and owner_until>now() then scale_session else null end as scale_session,
          case when ${sql.unsafe(relayRegisterOpenSql)} and owner_until>now() and scale_session is not null then scale_tare_context else '{}'::jsonb end as scale_tare_context,epoch
          from store_relay_stations s where id=${device.station_id}::uuid`,
        sql`update store_relay_stations s set scale_reading=null,scale_received_at=null,scale_filter_state='{}'::jsonb,
          scale_session=case when ${sql.unsafe(relayRegisterOpenSql)} then scale_session else null end,
          scale_tare_context=case when ${sql.unsafe(relayRegisterOpenSql)} then scale_tare_context else '{}'::jsonb end
          where id=${device.station_id}::uuid and (${status.scale!=='connected'} or not scale_enabled or owner_until<=now() or not (${sql.unsafe(relayRegisterOpenSql)}))`]);
      return Response.json({ok:true,station:results[3][0]});
    }
    if(b.action==='claim'){
      const claim=randomUUID();
      const results=await sql.transaction([lock,guard,relayPrintLock(String(device.store_id)),
        // Handoff and refunds lock the order. Lock only this station's pending
        // ledger orders, then obtain a fresh statement snapshot before dequeue.
        sql`select o.id from store_customer_orders o where o.store_id=${device.store_id}::uuid
          and exists(select 1 from store_relay_print_jobs j where j.order_id=o.id
            and j.station_id=${device.station_id}::uuid and j.state='pending'
            and ${sql.unsafe(posPrintDocumentRelayOwnedSql)}) order by o.id for update of o`,
        cancelRefundedRelayJobs(String(device.store_id)),
        cancelIneligiblePosPrintRelayJobs(String(device.store_id),String(device.station_id)),
        sql`update store_relay_print_jobs set state='uncertain',error='印刷結果を確認できません。実物を確認してください。',updated_at=now()
          where station_id=${device.station_id}::uuid and state='sending' and claimed_at<now()-interval '2 minutes'`,
        sql`with candidate as (select j.id from store_relay_print_jobs j
          join store_relay_stations s on s.id=j.station_id
          where j.station_id=${device.station_id}::uuid and s.enabled and s.print_enabled and j.state='pending'
            and not exists(select 1 from store_relay_print_jobs x where x.store_id=j.store_id and x.state in ('sending','uncertain'))
            and ((not ${sql.unsafe(posPrintDocumentRelayOwnedSql)} and ${sql.unsafe(relayJobCanPrintSql)})
              or (${sql.unsafe(posPrintDocumentRelayOwnedSql)} and ${sql.unsafe(posPrintDocumentRelayEligibleSql)}))
          order by j.created_at,j.sequence,j.id limit 1 for update of j skip locked)
          update store_relay_print_jobs j set state='sending',claimed_by=${device.id}::uuid,claim_token=${claim}::uuid,claimed_at=now(),updated_at=now()
          from candidate where j.id=candidate.id returning j.id,j.claim_token,j.payload,
            (j.kind='receipt' and ${sql.unsafe(relayJobHasRefundSql)}) as receipt_has_refund`]);
      const job=results[7][0];
      // Only the delivered copy is labelled; its saved original amounts and payload stay intact.
      if(job?.receipt_has_refund)job.payload=relayReceiptWithRefundNotice(job.payload);
      return Response.json({ok:true,job:job||null});
    }
    if(b.action==='ack'){
      const state=b.result==='sent'?'sent':'uncertain';
      const results=await sql.transaction([lock,guard,sql`update store_relay_print_jobs set state=${state},error=${String(b.error||'').slice(0,500)},updated_at=now()
        where id::text=${String(b.jobId||'')} and station_id=${device.station_id}::uuid and claimed_by=${device.id}::uuid
          and claim_token::text=${String(b.claimToken||'')} and (state in ('sending','uncertain') or (state='sent' and ${state}='sent')) returning id`]);
      if(!results[2][0])relayError('印刷タスクの実行権が失効しました。');return Response.json({ok:true});
    }
    if(b.action==='reading'){
      const reading=parseAndScaleLine(String(b.line||''));const sequence=Number(b.sequence),measuredAt=Number(b.measuredAt);
      if(!Number.isSafeInteger(sequence)||sequence<0)relayError('計量データが不正です。',400);
      // Preserve measurement time: a slow upload must not make an old reading fresh again.
      const invalidTime=!Number.isSafeInteger(measuredAt)||measuredAt<Date.now()-5000||measuredAt>Date.now()+1000;
      const snapshots=await sql`select (${sql.unsafe(relayRegisterOpenSql)}) as register_open,s.scale_sequence,s.scale_session,s.epoch,s.scale_filter_state,s.scale_tare_context,
        extract(epoch from s.scale_received_at)*1000 as scale_received_ms,d.heartbeat_at::text as device_heartbeat_at,
        coalesce(p.scale_filter_settings,'{}'::jsonb) as scale_filter_settings
        from store_relay_stations s left join pos_store_settings p on p.store_id=s.store_id
        join store_relay_devices d on d.station_id=s.id and d.id=${device.id}::uuid
        where s.id=${device.station_id}::uuid`;
      const snapshot=snapshots[0];
      if(!snapshot?.register_open)relayError('開店確認後に計量を開始してください。');
      if(!snapshot||String(snapshot.scale_session||'')!==String(b.scaleSession||'')||Number(snapshot.epoch)!==Number(b.epoch))relayError('計量セッションが終了しました。');
      const filterSettings=normalizePosScaleFilterSettings(snapshot.scale_filter_settings);
      const previousSequence=Number(snapshot.scale_sequence);
      if(!Number.isSafeInteger(previousSequence)||sequence<=previousSequence)relayError('新しい計量データを取得してください。');
      const tareContext=snapshot.scale_tare_context||{};
      const filterLock=sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-filter:${device.store_id}`},0))`;
      const backwards=filterSettings.enabled&&snapshot.scale_received_ms!=null&&measuredAt<=Number(snapshot.scale_received_ms);
      if(!reading||invalidTime||backwards){
        if(filterSettings.enabled){
          // A newly authenticated bad frame invalidates evidence; old/replayed requests cannot clear a newer window.
          const reset=await sql.transaction([lock,guard,filterLock,sql`update store_relay_stations s set scale_filter_state='{}'::jsonb,
            scale_reading=null,scale_received_at=null,scale_sequence=${sequence}
            where id=${device.station_id}::uuid and enabled and scale_enabled and owner_until>now() and (${sql.unsafe(relayRegisterOpenSql)})
              and scale_session::text=${String(b.scaleSession||'')} and epoch=${Number(b.epoch)||-1}
              and scale_sequence=${previousSequence} and scale_filter_state=${JSON.stringify(snapshot.scale_filter_state||{})}::jsonb
              and scale_tare_context=${JSON.stringify(tareContext)}::jsonb
              and coalesce((select scale_filter_settings->>'revision' from pos_store_settings p where p.store_id=s.store_id),'')=${filterSettings.revision}
              and exists(select 1 from store_relay_devices d where d.id=${device.id}::uuid and d.status->>'scale'='connected'
                and (${!filterSettings.enabled} or d.heartbeat_at::text is not distinct from ${snapshot.device_heartbeat_at}))
              and (coalesce(scale_tare_context->>'mode','device_net')<>'preset' or (scale_tare_context->>'token'=${String(b.tareToken||'')}
                and ${Boolean(b.tareToken)} and exists(select 1 from store_relay_devices d where d.id=${device.id}::uuid and d.status->'scaleTareVersion'='1'::jsonb))) returning id`]);
          if(!reset[3][0])relayError('計量セッションが終了しました。');
        }
        if(!reading)relayError('計量データが不正です。',400);
        relayError('新しい計量データを取得してください。スマホの日時も確認してください。',409);
      }
      const filtered=evaluatePosScaleFilter({settings:filterSettings,state:snapshot.scale_filter_state||{},
        contextKey:JSON.stringify([device.id,snapshot.epoch,snapshot.scale_session,tareContext]),reading,measuredAt,
        tareGrams:tareContext.mode==='preset'?Number(tareContext.tareGrams):0,newWindowId:randomUUID()});
      const effectiveReading=filtered.reading;
      const results=await sql.transaction([lock,guard,filterLock,sql`with frame_time as materialized (select clock_timestamp() as checked_at) update store_relay_stations s set scale_reading=case
          when ${filterSettings.enabled} and to_timestamp(${measuredAt}/1000.0)<=frame_time.checked_at-interval '5 seconds' then null
          when scale_tare_context->>'mode'='preset'
          then ${effectiveReading?JSON.stringify(effectiveReading):null}::jsonb || jsonb_build_object('mode','preset','grossGrams',${effectiveReading?.grams??null}::numeric,
            'rawGrossGrams',${reading.grams}::numeric,
            'grams',round((${effectiveReading?.grams??null}::numeric-(scale_tare_context->>'tareGrams')::numeric)*1000)/1000,
            'tareGrams',(scale_tare_context->>'tareGrams')::numeric,'tarePresetId',scale_tare_context->>'presetId',
            'settingsRevision',scale_tare_context->>'settingsRevision','tareToken',scale_tare_context->>'token')
          else ${effectiveReading?JSON.stringify(effectiveReading):null}::jsonb end,
        scale_filter_state=case when ${filterSettings.enabled} and to_timestamp(${measuredAt}/1000.0)<=frame_time.checked_at-interval '5 seconds' then '{}'::jsonb else ${JSON.stringify(filtered.state)}::jsonb end,
        scale_sequence=${sequence},scale_received_at=case when ${filterSettings.enabled} and to_timestamp(${measuredAt}/1000.0)<=frame_time.checked_at-interval '5 seconds' then null else to_timestamp(${measuredAt}/1000.0) end
        from frame_time where id=${device.station_id}::uuid and enabled and scale_enabled and owner_until>now() and (${sql.unsafe(relayRegisterOpenSql)})
          and scale_session::text=${String(b.scaleSession||'')} and epoch=${Number(b.epoch)||-1}
          and scale_sequence=${previousSequence}
          and scale_filter_state=${JSON.stringify(snapshot.scale_filter_state||{})}::jsonb
          and scale_tare_context=${JSON.stringify(tareContext)}::jsonb
          and coalesce((select scale_filter_settings->>'revision' from pos_store_settings p where p.store_id=s.store_id),'')=${filterSettings.revision}
          and (${!filterSettings.enabled} or scale_received_at is null or to_timestamp(${measuredAt}/1000.0)>scale_received_at)
          and exists(select 1 from store_relay_devices d where d.id=${device.id}::uuid and d.status->>'scale'='connected'
                and (${!filterSettings.enabled} or d.heartbeat_at::text is not distinct from ${snapshot.device_heartbeat_at}))
          and (coalesce(scale_tare_context->>'mode','device_net')<>'preset' or (scale_tare_context->>'token'=${String(b.tareToken||'')}
            and ${Boolean(b.tareToken)} and exists(select 1 from store_relay_devices d where d.id=${device.id}::uuid and d.status->'scaleTareVersion'='1'::jsonb)))
          and (${filterSettings.enabled} or to_timestamp(${measuredAt}/1000.0)>frame_time.checked_at-interval '5 seconds')
          returning id,to_timestamp(${measuredAt}/1000.0)>frame_time.checked_at-interval '5 seconds' as fresh`]);
      if(!results[3][0])relayError('計量セッションが終了しました。');
      if(!results[3][0].fresh)relayError('新しい計量データを取得してください。スマホの日時も確認してください。');return Response.json({ok:true});
    }
    relayError('操作が不正です。',400);
  }catch(e){if((e as {code?:string}).code==='22012')return Response.json({error:'端末認証が無効です。'},{status:401});return relayResponse(e);}
}
