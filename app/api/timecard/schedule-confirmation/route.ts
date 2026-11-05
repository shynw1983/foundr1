import { dispatchGoogleHours } from '../../../../lib/google-business-hours-dispatch';
import { sql } from '../../../../lib/db';
import { writeAuditLog } from '../../../../lib/audit-log';
import { requireGoogleBusinessAccess,gbpJson,googleBusinessSameOrigin } from '../../../../lib/google-business-access';
import { readConfirmationSettings,readScheduleDays,scheduleDayReviewKey,confirmSchedulePeriod,confirmScheduleDay,saveScheduleDayStatus,saveBusinessDay,refreshChangedScheduleDays } from '../../../../lib/shift-confirmation';
import { schedulePeriod,validateConfirmationSettings } from '../../../../lib/shift-confirmation-policy';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=120;
export async function GET(request:Request) {
  const url=new URL(request.url),storeId=url.searchParams.get('storeId')??'';
  const access=await requireGoogleBusinessAccess(storeId);if(access.error)return access.error;
  try{
    const period=schedulePeriod(url.searchParams.get('period')??'');
    const otherHalf=period.key.endsWith('first_half')?'second_half':'first_half';
    const [settings,days,otherDays]=await Promise.all([
      readConfirmationSettings(storeId),readScheduleDays(storeId,period.key),
      url.searchParams.get('includeMonth')==='1'?readScheduleDays(storeId,`${period.key.slice(0,7)}-${otherHalf}`):Promise.resolve([]),
    ]);
    const confirmed=days.filter(day=>day.confirmedAt&&!day.needsRefresh&&day.ready).length;
    return gbpJson({settings:{...settings,autoConfirm:false},period,days:days.map(day=>({...day,reviewKey:scheduleDayReviewKey(day)})),otherDays,summary:{confirmed,total:days.length,pending:days.length-confirmed}});
  }catch{return gbpJson({error:'営業予定を読み込めませんでした。期間と移行状況を確認してください。'},503);}
}
export async function POST(request:Request) {
  if(!googleBusinessSameOrigin(request))return gbpJson({error:'このリクエストは許可されていません。'},403);
  const body=await request.json().catch(()=>null);if(!body||typeof body.storeId!=='string')return gbpJson({error:'店舗を選択してください。'},400);
  const storeId=body.storeId,access=await requireGoogleBusinessAccess(storeId);if(access.error)return access.error;
  try{
    const period=schedulePeriod(String(body.period??''));let result:{queued?:boolean|number}|undefined;
    if(body.action==='save_settings'){
      if(!Number.isInteger(body.revision))throw new Error('設定を再読み込みしてください。');
      const settings=validateConfirmationSettings({...body.settings,autoConfirm:false});
      const current=await readConfirmationSettings(storeId);
      const preparation=settings.preparationMinutes===undefined?current.preparationMinutes:settings.preparationMinutes;
      const cleanup=settings.cleanupMinutes===undefined?current.cleanupMinutes:settings.cleanupMinutes;
      for(const value of [preparation,cleanup])if(value!=null&&(!Number.isInteger(value)||value<0||value>720))throw new Error('営業時間の準備・片付け時間は0〜720分で入力してください。');
      const inserted=await sql`insert into timecard_schedule_settings(store_id,auto_confirm,first_day,first_time,second_day,second_time,preparation_minutes,cleanup_minutes,updated_by)
        select ${storeId}::uuid,${settings.autoConfirm},${settings.firstDay}::integer,${settings.firstTime}::time,${settings.secondDay}::integer,${settings.secondTime}::time,${preparation??null}::integer,${cleanup??null}::integer,${access.session.id}::uuid where ${body.revision===0}
        on conflict(store_id) do nothing returning revision`;
      if(!inserted[0]){
        const updated=await sql`update timecard_schedule_settings set auto_confirm=${settings.autoConfirm},first_day=${settings.firstDay}::integer,first_time=${settings.firstTime}::time,
          second_day=${settings.secondDay}::integer,second_time=${settings.secondTime}::time,preparation_minutes=${preparation??null}::integer,cleanup_minutes=${cleanup??null}::integer,revision=revision+1,updated_by=${access.session.id}::uuid,updated_at=now()
          where store_id::text=${storeId} and revision=${body.revision} returning revision`;
        if(!updated[0])return gbpJson({error:'設定が変更されました。再読み込みしてください。'},409);
      }
      if(preparation!==current.preparationMinutes||cleanup!==current.cleanupMinutes){
        await sql`update timecard_schedule_days set needs_refresh=true,refresh_after=now(),revision=revision+1,updated_at=now()
          where store_id::text=${storeId} and confirmed_at is not null and hours_source='schedule' and business_status='open'`;
        const changed = await refreshChangedScheduleDays(storeId,undefined,access.session.id);
        dispatchGoogleHours(storeId, changed.some(day => day.queued));
      }
    }else if(body.action==='set_day'||body.action==='set_business_day'||body.action==='confirm_day'){
      const date=String(body.date??'');if(!period.dates.includes(date))throw new Error('対象期間の日付を選択してください。');
      if(body.action==='set_business_day'){
        if(!['pending','open','closed'].includes(body.status)||!['schedule','manual'].includes(body.hoursSource)||!Number.isInteger(body.revision))throw new Error('営業予定を選択してください。');
        result=await saveBusinessDay(storeId,date,body.status,body.hoursSource,body.intervals??[],body.revision,access.session.id);
      }else if(body.action==='set_day'){
        if(!['pending','open','closed'].includes(body.status)||!Number.isInteger(body.revision))throw new Error('営業予定を選択してください。');
        result=await saveScheduleDayStatus(storeId,date,body.status,body.revision,access.session.id);
      }else{
        const day=(await readScheduleDays(storeId,period.key)).find(item=>item.workDate===date)!;
        if(body.reviewKey!==undefined&&body.reviewKey!==scheduleDayReviewKey(day))throw new Error('営業予定が変更されました。再読み込みしてください。');
        result=await confirmScheduleDay(storeId,date,access.session.id,'manual',day,undefined,undefined,typeof body.reviewKey==='string');
      }
    }else if(body.action==='confirm_period')result=await confirmSchedulePeriod(storeId,period.key,access.session.id,'manual',undefined,String(body.note??'').trim().slice(0,1000)||undefined,undefined,body.review);
    else throw new Error('操作を確認してください。');
    dispatchGoogleHours(storeId, result?.queued ?? 0);
    await writeAuditLog({actorEmployeeId:access.session.id,action:`timecard.schedule.${body.action}`,targetType:'store',targetId:storeId,metadata:{period:period.key,date:body.date??null},request});
    return gbpJson({ok:true,result:result??{ok:true}});
  }catch(error){const message=error instanceof Error&&/^(対象|自動|確定|設定|営業|操作|シフト|希望)/.test(error.message)?error.message:'営業予定を保存できませんでした。';return gbpJson({error:message},400);}
}
