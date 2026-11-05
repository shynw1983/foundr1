import { normalizePosPrinterSettings, getReceiptPrinter, createTestPrintPayload, hasPosPrinterDestination } from '../../../../../lib/pos-printer';
import { randomUUID } from 'node:crypto';
import { requireOsSession } from '../../../../../lib/api-auth';
import { roleHasPermission } from '../../../../../lib/role-permissions';
import { sql } from '../../../../../lib/db';
import { assertRelayOrigin, relayError, relayHash, relayResponse, relayPairingCode, relayStations, relayStoreAccess } from '../../../../../lib/store-relay';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const session=await requireOsSession(); if(!session) relayError('ログインしてください。',401);
    const storeId=new URL(request.url).searchParams.get('storeId') || ''; await relayStoreAccess(session,storeId);
    return Response.json({stations:await relayStations(storeId), canManage:await roleHasPermission(session.role,'pos.manageSettings')},{headers:{'Cache-Control':'no-store'}});
  } catch(e){return relayResponse(e);}
}
export async function POST(request: Request) {
  try {
    assertRelayOrigin(request);
    const session=await requireOsSession(); if(!session) relayError('ログインしてください。',401);
    if(!await roleHasPermission(session.role,'pos.manageSettings')) relayError('権限がありません。',403);
    const b=await request.json(); const storeId=String(b.storeId || ''); await relayStoreAccess(session,storeId);
    const id=String(b.stationId || randomUUID());
    if(b.action==='save') {
      const name=String(b.name || 'レジ A').trim().slice(0,60); if(!name) relayError('レジ名を入力してください。',400);
      // Configuration changes fence both the old operator and pending scale readings.
      const saved=await sql.transaction([
        sql`insert into store_relay_stations(id,store_id,name,enabled,print_enabled,scale_enabled)
          values(${id}::uuid,${storeId}::uuid,${name},${b.enabled===true},${b.printEnabled===true},${b.scaleEnabled===true})
          on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,print_enabled=excluded.print_enabled,
            scale_enabled=excluded.scale_enabled,epoch=store_relay_stations.epoch+1,owner_hash='',owner_until=null,
            scale_session=null,scale_tare_context='{}'::jsonb,scale_filter_state='{}'::jsonb,scale_reading=null,scale_received_at=null,updated_at=now()
          where store_relay_stations.store_id=excluded.store_id returning id`,
        sql`update store_relay_print_jobs set state='uncertain',error='設備設定が変更されました。印刷結果を確認してください。',updated_at=now()
          where station_id::text=${id} and store_id::text=${storeId} and state='sending'`,
        sql`insert into store_relay_events(station_id,employee_id,kind,detail)
          select id,${session.id}::uuid,'settings',${JSON.stringify({enabled:b.enabled===true,printEnabled:b.printEnabled===true,scaleEnabled:b.scaleEnabled===true})}::jsonb
          from store_relay_stations where id::text=${id} and store_id::text=${storeId}`
      ]);
      if(!saved[0]?.length)relayError('権限がありません。',403);
      return Response.json({ok:true,stationId:id});
    }
    const station=await sql`select id from store_relay_stations where id::text=${id} and store_id::text=${storeId}`;
    if(!station[0]) relayError('レジが見つかりません。',404);
    if(b.action==='testPrint') {
      const current=(await relayStations(storeId)).find(s=>s.id===id);
      if(!current?.enabled||!current.print_enabled||!current.device_online)relayError('中継端末の接続を確認してください。');
      const settings=await sql`select p.printer_settings,s.name from pos_store_settings p join stores s on s.id=p.store_id where p.store_id::text=${storeId}`;
      const printer=getReceiptPrinter(normalizePosPrinterSettings(settings[0]?.printer_settings));
      if(printer.deviceType!=='escpos_network'||!hasPosPrinterDestination(printer))relayError('中継印刷は ESC/POS Wi-Fi / LAN のみ対応しています。');
      const payload=createTestPrintPayload({...printer,openCashDrawer:false},String(settings[0]?.name||'Foundr1 STORE'));
      await sql`insert into store_relay_print_jobs(station_id,store_id,document_key,sequence,kind,payload,created_by)
        values(${id}::uuid,${storeId}::uuid,${`test:${randomUUID()}`},0,'test',${JSON.stringify(payload)}::jsonb,${session.id}::uuid)`;
      return Response.json({ok:true});
    }
    if(b.action==='pair' || b.action==='revoke') {
      const code=b.action==='pair'?relayPairingCode():'';
      await sql.transaction([
        sql`select id from store_relay_stations where id::text=${id} for update`,
        sql`insert into store_relay_devices(station_id,pairing_hash,pairing_until,revoked)
          values(${id}::uuid,${code?relayHash(code):''},clock_timestamp()+interval '10 minutes',${!code})
          on conflict(station_id) do update set token_hash='',pairing_hash=excluded.pairing_hash,
            pairing_until=excluded.pairing_until,revoked=excluded.revoked,heartbeat_at=null,updated_at=now()`,
        sql`update store_relay_stations set scale_session=null,scale_tare_context='{}'::jsonb,scale_filter_state='{}'::jsonb,scale_reading=null,scale_received_at=null where id::text=${id}`,
        sql`update store_relay_print_jobs set state='uncertain',error='中継端末が変更されました。印刷結果を確認してください。',updated_at=now()
          where station_id::text=${id} and state='sending'`,
        sql`insert into store_relay_events(station_id,employee_id,kind) values(${id}::uuid,${session.id}::uuid,${b.action})`
      ]);
      return Response.json({ok:true,pairingCode:code});
    }
    relayError('操作が不正です。',400);
  }catch(e){return relayResponse(e);}
}
