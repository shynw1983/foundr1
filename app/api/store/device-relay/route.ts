import { randomUUID } from 'node:crypto';
import { normalizePosScaleFilterSettings } from '../../../../lib/pos-scale-filter';
import { normalizePosScaleTareSettings, posWeightMeasurementFromReading } from '../../../../lib/pos-scale-tare';
import { requireOsSession } from '../../../../lib/api-auth';
import { sql } from '../../../../lib/db';
import { assertRelayOrigin, ownerGuardSql, relayError, relayHash, relayResponse, relayRegisterOpenSql, relaySecret, relayStations, relayStoreAccess, requireRelayOwner } from '../../../../lib/store-relay';
import type { RelayOwner } from '../../../../lib/store-relay-policy';
import { relayJobCanReprintSql, relayJobHasRefundSql, relayJobNeedsReviewSql, relayJobRefundedSql, relayPrintLock } from '../../../../lib/store-relay-print-policy';
import { posPrintDocumentRelayOwnedSql } from '../../../../lib/pos-print-document-ledger';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const requestStarted=performance.now();
  try{
    const session=await requireOsSession();if(!session)relayError('ログインしてください。',401);
    if(!['owner','manager','store_owner','store_manager','store_terminal'].includes(session.role))relayError('権限がありません。',403);
    const params=new URL(request.url).searchParams;
    const storeId=params.get('storeId')||'';await relayStoreAccess(session,storeId);
    const orderId=params.get('orderId')||'';
    const stations=await relayStations(storeId);
    const jobs=stations.length?await sql`select j.id,j.station_id,j.order_id,j.kind,j.sequence,
      case when j.state='sending' and j.claimed_at<clock_timestamp()-interval '2 minutes' then 'uncertain' else j.state end as state,
      j.error,j.reprint_of,j.created_at,j.payload->'order'->>'pickupCode' as pickup_code,
      case when j.kind='kitchen' and j.payload->'kitchenTicketTemplate'->>'title'='出品伝票' then 'finishing' else j.kind end as "documentRole",
      case when ${sql.unsafe(relayJobRefundedSql)} then 'refunded'
        when ${sql.unsafe(relayJobHasRefundSql)} then 'partial_refunded' else 'active' end as "refundDisposition",
      (j.kind='receipt' and ${sql.unsafe(relayJobHasRefundSql)}) as "receiptHasRefund",
      (${sql.unsafe(relayJobNeedsReviewSql)} and ${sql.unsafe(relayJobRefundedSql)}) as "voidEligible",
      ((j.state='sent' or ${sql.unsafe(relayJobNeedsReviewSql)}) and ${sql.unsafe(relayJobCanReprintSql)}) as "reprintEligible"
      from store_relay_print_jobs j where j.store_id::text=${storeId} and (${orderId}='' or j.order_id::text=${orderId})
        and not ${sql.unsafe(posPrintDocumentRelayOwnedSql)}
      order by case when ${sql.unsafe(relayJobNeedsReviewSql)} then 0 when j.state='sending' then 1 when j.state='pending' then 2 else 3 end,
        j.created_at desc,j.sequence limit 100`:[];
    // Sample after all reads: their time and network lag must still age the
    // original measurement, independently of the cashier device's wall clock.
    const serverElapsedMs=Math.max(0,Math.floor(performance.now()-requestStarted));
    return Response.json({stations,jobs,serverNow:new Date().toISOString(),serverElapsedMs},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return relayResponse(e);}
}
export async function POST(request:Request){
  try{
    assertRelayOrigin(request);const session=await requireOsSession();if(!session)relayError('ログインしてください。',401);
    if(!['owner','manager','store_owner','store_manager','store_terminal'].includes(session.role))relayError('権限がありません。',403);
    const b=await request.json();const storeId=String(b.storeId||'');await relayStoreAccess(session,storeId);
    const owner=b.owner as RelayOwner || {stationId:String(b.stationId||''),token:'',epoch:-1};
    if(b.action==='pair'){
      const pairingStationId=String(b.stationId||'');
      const code=typeof b.code==='string'?b.code.trim():'';
      const numericCode=/^[0-9]{6}$/.test(code);
      // Already-issued long codes retain only their original ten-minute lifetime.
      const legacyCode=/^[A-Za-z0-9_-]{43}$/.test(code);
      if(!numericCode&&!legacyCode)relayError('接続コードは6桁の数字で入力してください。',400);
      if(numericCode&&!pairingStationId)relayError('接続先のレジを選択してから、もう一度お試しください。',400);
      const token=relaySecret();
      const codeHash=relayHash(code);
      const results=await sql.transaction([
        // Issuing a code takes this same lock. The next statement obtains a fresh
        // READ COMMITTED snapshot after any competing pairing has finished.
        sql`select s.id from store_relay_stations s join store_relay_devices d on d.station_id=s.id
          where s.store_id::text=${storeId} and s.enabled
            and (s.id::text=${pairingStationId} or (${!pairingStationId} and d.pairing_hash=${codeHash}))
          order by s.id for update of s`,
        sql`with candidate as (
          select d.id,d.station_id,d.pairing_hash,
            (select count(*) from store_relay_events e where e.station_id=s.id and e.kind='pair_failed'
              and e.id>coalesce((select max(g.id) from store_relay_events g where g.station_id=s.id and g.kind='pair'),0)) as failures
          from store_relay_devices d join store_relay_stations s on d.station_id=s.id
          where s.store_id::text=${storeId} and s.enabled and not d.revoked
            and (s.id::text=${pairingStationId} or (${!pairingStationId} and d.pairing_hash=${codeHash}))
            and d.pairing_hash<>'' and d.pairing_until>clock_timestamp()
        ), paired as (
          update store_relay_devices d set token_hash=${relayHash(token)},pairing_hash='',pairing_until=null,revoked=false,updated_at=now()
          from candidate c where d.id=c.id and c.pairing_hash=${codeHash} and c.failures<5
          returning d.id,d.station_id
        ), failed as (
          insert into store_relay_events(station_id,employee_id,kind)
          select c.station_id,${session.id}::uuid,'pair_failed' from candidate c
          where c.pairing_hash<>${codeHash} and c.failures<5 returning station_id
        )
        select id,station_id,true as paired,0::bigint as failures from paired
        union all
        select c.id,c.station_id,false as paired,
          c.failures+case when exists(select 1 from failed f where f.station_id=c.station_id) then 1 else 0 end as failures
        from candidate c where c.failures>=5 or exists(select 1 from failed f where f.station_id=c.station_id)`
      ],{isolationLevel:'ReadCommitted'});
      // Return errors only after commit, so incorrect attempts consume the quota.
      const result=results[1][0];
      if(!result?.paired){
        if(Number(result?.failures)>=5)relayError('接続コードを5回間違えました。管理者に新しいコードの発行を依頼してください。',429);
        relayError('接続コードが無効または期限切れです。');
      }
      return Response.json({ok:true,token,stationId:result.station_id});
    }
    if(b.action==='claim'||b.action==='takeover'){
      const token=relaySecret();const epoch=Number(b.epoch);
      if(!Number.isSafeInteger(epoch))relayError('レジを再読み込みしてください。');
      const rows=await sql`update store_relay_stations set owner_hash=${relayHash(token)},owner_employee_id=${session.id}::uuid,
        owner_session_id=${session.sessionId||''},owner_until=now()+interval '45 seconds',epoch=epoch+1,
        scale_session=null,scale_tare_context='{}'::jsonb,scale_filter_state='{}'::jsonb,scale_reading=null,scale_received_at=null,updated_at=now()
        where id::text=${String(b.stationId||'')} and store_id::text=${storeId} and enabled and epoch=${epoch}
          and (${b.action==='takeover'} or owner_until is null or owner_until<=now()) returning id,epoch`;
      if(!rows[0])relayError('別の端末が使用中です。状態を確認して引き継いでください。');
      await sql`insert into store_relay_events(station_id,employee_id,kind) values(${rows[0].id}::uuid,${session.id}::uuid,${b.action})`;
      return Response.json({ok:true,owner:{stationId:rows[0].id,epoch:rows[0].epoch,token}});
    }
    if(b.action==='resume'||b.action==='heartbeat'){
      if(typeof owner.stationId!=='string'||typeof owner.token!=='string'||!Number.isSafeInteger(owner.epoch))relayError('操作権が失効しました。');
      const results=await sql.transaction([
        // Takeovers use this row lock too. The following statement gets a fresh
        // READ COMMITTED snapshot and cannot revive credentials a successor replaced.
        sql`select id from store_relay_stations where id::text=${owner.stationId} and store_id::text=${storeId} for update`,
        sql`with candidate as materialized (
          select id,(owner_until is null or owner_until<=clock_timestamp()) as resumed
          from store_relay_stations where id::text=${owner.stationId} and store_id::text=${storeId} and enabled
            and owner_hash=${relayHash(owner.token)} and epoch=${owner.epoch}
            and owner_employee_id::text=${session.id} and owner_session_id=${session.sessionId||''}
        ), renewed as (
          update store_relay_stations s set owner_until=clock_timestamp()+interval '45 seconds',
            scale_session=case when c.resumed then null else s.scale_session end,
            scale_tare_context=case when c.resumed then '{}'::jsonb else s.scale_tare_context end,
            scale_filter_state=case when c.resumed then '{}'::jsonb else s.scale_filter_state end,
            scale_sequence=case when c.resumed then -1 else s.scale_sequence end,
            scale_reading=case when c.resumed then null else s.scale_reading end,
            scale_received_at=case when c.resumed then null else s.scale_received_at end,
            updated_at=clock_timestamp()
          from candidate c where s.id=c.id returning s.id,s.owner_until,c.resumed
        ), audited as (
          insert into store_relay_events(station_id,employee_id,kind)
          select id,${session.id}::uuid,'resume' from renewed where resumed returning station_id
        ) select id,owner_until,resumed from renewed`
      ],{isolationLevel:'ReadCommitted'});
      const renewed=results[1][0];
      if(!renewed)relayError('操作権が失効しました。');
      return Response.json({ok:true,resumed:renewed.resumed,ownerUntil:renewed.owner_until});
    }
    await requireRelayOwner(storeId,owner,session);
    const lock=sql`select id from store_relay_stations where id::text=${owner.stationId} for update`;
    if(b.action==='scaleStart'||b.action==='scaleEnd'||b.action==='scaleAdopt'){
      if(b.action!=='scaleEnd'){
        const open=await sql`select id from pos_cash_sessions where store_id::text=${storeId} and status='open' limit 1`;
        if(!open[0])relayError('開店確認後に計量を開始してください。');
      }
      const suppliedSession=b.scaleSession;
      const scaleId=suppliedSession===undefined&&b.action==='scaleStart'?randomUUID():String(suppliedSession||'').toLowerCase();
      const isUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
      if(!isUuid(scaleId))relayError('計量セッションを確認してください。',400);
      const tareRows=await sql`select scale_tare_settings,scale_filter_settings from pos_store_settings where store_id::text=${storeId}`;
      const tareSettings=normalizePosScaleTareSettings(tareRows[0]?.scale_tare_settings);
      const filterSettings=normalizePosScaleFilterSettings(tareRows[0]?.scale_filter_settings);
      const tareLock=sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-tare:${storeId}`},0))`;
      const tareGuard=sql`select 1 / case when coalesce((select scale_tare_settings->>'revision' from pos_store_settings where store_id::text=${storeId}),'')=${tareSettings.revision}
        then 1 else 0 end as tare_settings_current`;
      const filterLock=sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-filter:${storeId}`},0))`;
      const filterGuard=sql`select 1 / case when coalesce((select scale_filter_settings->>'revision' from pos_store_settings where store_id::text=${storeId}),'')=${filterSettings.revision}
        then 1 else 0 end as filter_settings_current`;
      if(b.action==='scaleStart'){
        if(tareSettings.enabled&&!tareSettings.revision)relayError('ボウルの重量設定を保存し直してください。',409);
        const preset=tareSettings.presets.find(p=>p.id===b.tarePresetId);
        if(tareSettings.enabled&&(!preset||preset.grams===null))relayError('ボウル（小）またはボウル（大）を選び直してください。',409);
        const tareContext=tareSettings.enabled?{mode:'preset',token:randomUUID(),presetId:preset!.id,tareGrams:preset!.grams,settingsRevision:tareSettings.revision}:{};
        const expected=b.expectedScaleSession==null?null:String(b.expectedScaleSession).toLowerCase();
        if(expected!==null&&!isUuid(expected))relayError('計量セッションを確認してください。',400);
        const results=await sql.transaction([lock,tareLock,tareGuard,filterLock,filterGuard,ownerGuardSql(storeId,owner,session),sql`update store_relay_stations s set
          scale_tare_context=case when scale_session=${scaleId}::uuid then scale_tare_context else ${JSON.stringify(tareContext)}::jsonb end,
          scale_session=${scaleId}::uuid,
          scale_filter_state=case when scale_session=${scaleId}::uuid then scale_filter_state else '{}'::jsonb end,
          scale_sequence=case when scale_session=${scaleId}::uuid then scale_sequence else -1 end,
          scale_reading=case when scale_session=${scaleId}::uuid then scale_reading else null end,
          scale_received_at=case when scale_session=${scaleId}::uuid then scale_received_at else null end
          where id::text=${owner.stationId} and scale_enabled and (${sql.unsafe(relayRegisterOpenSql)})
            and (${!tareSettings.enabled} or exists(select 1 from store_relay_devices d where d.station_id=s.id and not d.revoked and d.token_hash<>''
              and d.heartbeat_at>clock_timestamp()-interval '30 seconds' and d.status->'scaleTareVersion'='1'::jsonb))
            and (scale_session is distinct from ${scaleId}::uuid or coalesce(scale_tare_context->>'presetId','')=${tareSettings.enabled?preset!.id:''})
            and (scale_session is not distinct from ${expected}::uuid or scale_session=${scaleId}::uuid)
            and not exists(select 1 from store_relay_scale_captures c where c.session_id=${scaleId}::uuid)
            and (scale_session=${scaleId}::uuid or not exists(select 1 from store_relay_events e
              where e.station_id=s.id and e.kind in ('scale_start','scale_end') and e.detail->>'scaleSession'=${scaleId}))
          returning id,scale_tare_context`,
          sql`insert into store_relay_events(station_id,employee_id,kind,detail)
            select id,${session.id}::uuid,'scale_start',jsonb_build_object('scaleSession',${scaleId}::text)
            from store_relay_stations s where id::text=${owner.stationId} and scale_session=${scaleId}::uuid
              and not exists(select 1 from store_relay_events e where e.station_id=s.id and e.kind='scale_start' and e.detail->>'scaleSession'=${scaleId})`]);
        if(!results[6][0])relayError(tareSettings.enabled?'ボウルの設定、スマホの更新状態、計量セッションを確認してください。':'計量セッションが変わりました。もう一度お試しください。');
        return Response.json({ok:true,scaleSession:scaleId,scaleTareContext:results[6][0].scale_tare_context});
      }
      if(b.action==='scaleEnd'){
        const results=await sql.transaction([lock,ownerGuardSql(storeId,owner,session),sql`update store_relay_stations set
          scale_session=null,scale_tare_context='{}'::jsonb,scale_filter_state='{}'::jsonb,scale_sequence=-1,scale_reading=null,scale_received_at=null
          where id::text=${owner.stationId} and scale_session=${scaleId}::uuid returning id`,
          // Record cancellation even if its start request has not reached the server yet.
          sql`insert into store_relay_events(station_id,employee_id,kind,detail)
            select id,${session.id}::uuid,'scale_end',jsonb_build_object('scaleSession',${scaleId}::text)
            from store_relay_stations s where id::text=${owner.stationId}
              and not exists(select 1 from store_relay_events e where e.station_id=s.id and e.kind='scale_end' and e.detail->>'scaleSession'=${scaleId})`]);
        return Response.json({ok:true,scaleSession:scaleId,ended:Boolean(results[2][0])});
      }
      const expectedSequence=b.scaleSequence===undefined?null:b.scaleSequence;
      if(b.scaleSequence!==undefined&&(!Number.isSafeInteger(expectedSequence)||expectedSequence<0))relayError('計量データを確認してください。',400);
      // Sequence advances during network travel. Only the same server-owned
      // accepted window and exact integer net weight can prove equivalent frames.
      const windowProof=b.scaleWindowId!==undefined||b.scaleGrams!==undefined;
      const expectedWindowId=typeof b.scaleWindowId==='string'?b.scaleWindowId.toLowerCase():'';
      const expectedGrams=windowProof?b.scaleGrams:null;
      if(windowProof&&(!isUuid(expectedWindowId)||expectedSequence===null||!Number.isSafeInteger(expectedGrams)||expectedGrams<=0||expectedGrams>3000))
        relayError('計量データを確認してください。',400);
      const validSoftwareFilter=filterSettings.enabled&&Boolean(filterSettings.revision)&&filterSettings.toleranceGrams>=1
        &&filterSettings.toleranceGrams<=5&&filterSettings.settleMs>=2000&&filterSettings.settleMs<=5000;
      if(windowProof&&!validSoftwareFilter)relayError('安定した最新の重量を確認してください。');
      // A confirmed software window can keep monitoring this same bowl. Each
      // session still owns one immutable capture; changed loads need a new session.
      const keepMonitoring=b.keepMonitoring===true&&expectedSequence!==null&&validSoftwareFilter;
      const captureId=randomUUID();
      const result=await sql.transaction([lock,tareLock,tareGuard,filterLock,filterGuard,ownerGuardSql(storeId,owner,session),sql`insert into store_relay_scale_captures(id,station_id,session_id,epoch,employee_id,grams,reading,received_at)
        select ${captureId}::uuid,id,scale_session,epoch,${session.id}::uuid,(scale_reading->>'grams')::numeric,
          scale_reading||jsonb_build_object('scaleSequence',scale_sequence),scale_received_at
        from store_relay_stations s where id::text=${owner.stationId} and scale_enabled and (${sql.unsafe(relayRegisterOpenSql)}) and scale_session=${scaleId}::uuid
          and ((${!windowProof} and (${expectedSequence}::bigint is null or scale_sequence=${expectedSequence}::bigint))
            or (${windowProof} and scale_sequence>=${expectedSequence}::bigint and (scale_reading->>'grams')::numeric=${expectedGrams}::numeric
              and scale_reading->'filter'->>'windowId'=${expectedWindowId} and scale_filter_state->>'acceptedWindowId'=${expectedWindowId}))
          and exists(select 1 from store_relay_devices d where d.station_id=s.id and not d.revoked and d.token_hash<>''
            and d.heartbeat_at>now()-interval '30 seconds' and d.status->>'scale'='connected')
          and (${!tareSettings.enabled} or (scale_tare_context->>'mode'='preset'
            and scale_tare_context->>'settingsRevision'=${tareSettings.revision}
            and scale_reading->>'tareToken'=scale_tare_context->>'token'
            and scale_reading->>'settingsRevision'=scale_tare_context->>'settingsRevision'
            and exists(select 1 from store_relay_devices d where d.station_id=s.id
              and not d.revoked and d.token_hash<>'' and d.heartbeat_at>clock_timestamp()-interval '30 seconds' and d.status->'scaleTareVersion'='1'::jsonb)))
          and (coalesce(scale_reading->>'mode','device_net')<>'preset' or scale_reading->>'settingsRevision'=${tareSettings.revision})
          and (${!filterSettings.enabled} or (scale_reading->'filter'->>'source'='software_window' and scale_reading->'filter'->>'settingsRevision'=${filterSettings.revision}
            and scale_reading->'filter'->'accepted'='true'::jsonb))
          and (scale_reading->'filter' is null or scale_reading->'filter'->>'settingsRevision'=${filterSettings.revision})
          and scale_received_at>clock_timestamp()-interval '5 seconds' and (scale_reading->>'stable')::boolean
          and not (scale_reading->>'overload')::boolean
          and (coalesce(scale_reading->>'rawGrossGrams',scale_reading->>'grossGrams',scale_reading->>'rawGrams',scale_reading->>'grams'))::numeric<=3000
          and (scale_reading->>'grams')::numeric>0 and (scale_reading->>'grams')::numeric<=3000
        on conflict(session_id) do nothing returning id,grams`,
        sql`select id,grams,reading,reading->'scaleSequence' as scale_sequence from store_relay_scale_captures
          where station_id::text=${owner.stationId} and session_id=${scaleId}::uuid and epoch=${owner.epoch}
            and employee_id::text=${session.id} and order_id is null
            and (coalesce(reading->>'mode','device_net')<>'preset' or reading->>'settingsRevision'=${tareSettings.revision})
            and ((${!windowProof} and (${expectedSequence}::bigint is null or (reading->>'scaleSequence')::bigint=${expectedSequence}::bigint))
              or (${windowProof} and (reading->>'scaleSequence')::bigint>=${expectedSequence}::bigint
                and reading->'filter'->>'windowId'=${expectedWindowId} and grams=${expectedGrams}::numeric))`,
        sql`update store_relay_stations set scale_session=null,scale_tare_context='{}'::jsonb,scale_filter_state='{}'::jsonb,scale_reading=null,scale_received_at=null
          where id::text=${owner.stationId} and scale_session=${scaleId}::uuid and ${!keepMonitoring}
            and exists(select 1 from store_relay_scale_captures c where c.station_id=store_relay_stations.id
              and c.session_id=${scaleId}::uuid and c.epoch=${owner.epoch} and c.employee_id::text=${session.id} and c.order_id is null
              and ((${!windowProof} and (${expectedSequence}::bigint is null or (c.reading->>'scaleSequence')::bigint=${expectedSequence}::bigint))
                or (${windowProof} and (c.reading->>'scaleSequence')::bigint>=${expectedSequence}::bigint
                  and c.reading->'filter'->>'windowId'=${expectedWindowId} and c.grams=${expectedGrams}::numeric)))`,
        sql`select id from store_relay_stations where id::text=${owner.stationId} and enabled and scale_enabled
          and scale_session=${scaleId}::uuid and epoch=${owner.epoch} and owner_until>clock_timestamp()
          and (${!windowProof} or (scale_sequence>=${expectedSequence}::bigint and (scale_reading->>'grams')::numeric=${expectedGrams}::numeric
            and scale_reading->'filter'->>'windowId'=${expectedWindowId} and scale_filter_state->>'acceptedWindowId'=${expectedWindowId}
            and scale_reading->'filter'->>'settingsRevision'=${filterSettings.revision} and scale_reading->'filter'->'accepted'='true'::jsonb
            and (scale_reading->>'stable')::boolean and not (scale_reading->>'overload')::boolean
            and scale_received_at>clock_timestamp()-interval '5 seconds'
            and exists(select 1 from store_relay_devices d where d.station_id=store_relay_stations.id and not d.revoked
              and d.token_hash<>'' and d.heartbeat_at>clock_timestamp()-interval '30 seconds' and d.status->>'scale'='connected')))`]);
      const captured=result[7][0];
      if(!captured)relayError('安定した最新の重量を確認してください。');
      return Response.json({ok:true,capture:{id:captured.id,grams:captured.grams,weightMeasurement:posWeightMeasurementFromReading(captured.reading)},scaleSession:scaleId,
        scaleSequence:captured.scale_sequence==null?null:Number(captured.scale_sequence),monitoring:keepMonitoring&&Boolean(result[9][0])});
    }
    if(b.action==='confirmSent'||b.action==='reprint'||b.action==='voidRefunded'){
      const jobId=String(b.jobId||'');const newId=randomUUID();
      if(b.action==='voidRefunded'&&b.confirmed!==true)relayError('現物と返金・キャンセルを確認してから終了してください。',400);
      const change=b.action==='reprint'?sql`with changed as (
        update store_relay_print_jobs j set state='cancelled',claim_token=null,updated_at=now()
        where j.id::text=${jobId} and j.station_id::text=${owner.stationId}
          and not ${sql.unsafe(posPrintDocumentRelayOwnedSql)}
          and (j.state='sent' or ${sql.unsafe(relayJobNeedsReviewSql)})
          and ${sql.unsafe(relayJobCanReprintSql)}
        returning j.*), queued as (
        insert into store_relay_print_jobs(id,station_id,store_id,order_id,document_key,sequence,kind,payload,reprint_of,created_by,created_at)
        select ${newId}::uuid,station_id,store_id,order_id,${`reprint:${newId}`},sequence,kind,
          jsonb_set(jsonb_set(payload,'{printer,openCashDrawer}','false'::jsonb),'{order,note}',to_jsonb(concat('再印刷 / ',payload->'order'->>'note'))),
          id,${session.id}::uuid,created_at from changed returning id,station_id), audited as (
          insert into store_relay_events(station_id,employee_id,kind,detail)
          select station_id,${session.id}::uuid,'reprint',${JSON.stringify({jobId})}::jsonb from queued
        ) select id from queued`
        :b.action==='voidRefunded'?sql`with changed as (update store_relay_print_jobs j set state='cancelled',claim_token=null,
          error='返金・キャンセル済みの伝票を現物確認のうえ終了しました。',updated_at=now()
          where j.id::text=${jobId} and j.station_id::text=${owner.stationId}
            and not ${sql.unsafe(posPrintDocumentRelayOwnedSql)}
            and ${sql.unsafe(relayJobNeedsReviewSql)} and ${sql.unsafe(relayJobRefundedSql)} returning j.id,j.station_id), audited as (
          insert into store_relay_events(station_id,employee_id,kind,detail)
          select station_id,${session.id}::uuid,'voidRefunded',${JSON.stringify({jobId,confirmed:true})}::jsonb from changed
        ) select id from changed`
        :sql`with changed as (update store_relay_print_jobs j set state='sent',claim_token=null,updated_at=now()
          where j.id::text=${jobId} and j.station_id::text=${owner.stationId}
            and not ${sql.unsafe(posPrintDocumentRelayOwnedSql)} and ${sql.unsafe(relayJobNeedsReviewSql)} returning j.id,j.station_id), audited as (
          insert into store_relay_events(station_id,employee_id,kind,detail)
          select station_id,${session.id}::uuid,'confirmSent',${JSON.stringify({jobId})}::jsonb from changed
        ) select id from changed`;
      const results=await sql.transaction([lock,ownerGuardSql(storeId,owner,session),relayPrintLock(storeId),change]);
      if(!results[3].length)relayError('対象の印刷状態が変わりました。');return Response.json({ok:true});
    }
    relayError('操作が不正です。',400);
  }catch(e){if((e as {code?:string}).code==='22012')return Response.json({error:'操作権が失効しました。'},{status:409});return relayResponse(e);}
}
