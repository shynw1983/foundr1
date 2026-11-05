import { sql } from './db';
import { schedulePeriod, confirmationDeadline, assertAfterSubmission, dayReadiness, periodKeyForDate, type BusinessStatus, type ConfirmationSettings } from './shift-confirmation-policy';
import { canonicalPeriods, deriveSpecialHours, dateKey, parseDate, type GbpPeriod, type PublishedShift, type HoursRules } from './google-business-hours-policy';
import { createOsNotification } from './web-push';

type AutomaticContext={revision:number;submissionFirstDay:number;submissionSecondDay:number;submissionTime:string};
export type ScheduleDay = { hoursSource:"schedule"|"manual"; manualPeriods:GbpPeriod[]|null; businessPeriods:GbpPeriod[]|null; suggestedPeriods:GbpPeriod[]; suggestionRules?:HoursRules; workDate:string; businessStatus:BusinessStatus; revision:number; confirmedAt:string|null; needsRefresh:boolean; attentionReason:string|null; shifts:PublishedShift[]; shiftCount:number; boundarySnapshot:PublishedShift[]; neighborVersions:{date:string;revision:number}[]; ready:boolean; closureCandidate?:boolean };
export async function readConfirmationSettings(storeId:string) {
  const rows=await sql`
    select coalesce(s.auto_confirm,false) as "autoConfirm",s.first_day as "firstDay",to_char(s.first_time,'HH24:MI') as "firstTime",
      s.second_day as "secondDay",to_char(s.second_time,'HH24:MI') as "secondTime",coalesce(s.revision,0) as revision,
      case when s.store_id is null then c.preparation_minutes else s.preparation_minutes end as "preparationMinutes",case when s.store_id is null then c.cleanup_minutes else s.cleanup_minutes end as "cleanupMinutes",
      coalesce(st.shift_first_half_submission_deadline_day,25) as "submissionFirstDay",
      coalesce(st.shift_second_half_submission_deadline_day,10) as "submissionSecondDay",
      to_char(coalesce(st.shift_submission_deadline_time,'23:59'::time),'HH24:MI') as "submissionTime"
    from stores st left join timecard_schedule_settings s on s.store_id=st.id left join google_business_connections c on c.store_id=st.id where st.id::text=${storeId}
  `;
  return rows[0] as unknown as ConfirmationSettings & {revision:number;submissionFirstDay:number;submissionSecondDay:number;submissionTime:string};
}
async function storeRules(storeId:string):Promise<HoursRules|undefined> {
  const settings=await readConfirmationSettings(storeId);
  if(settings.preparationMinutes==null||settings.cleanupMinutes==null)return undefined;
  return {preparationMinutes:settings.preparationMinutes,cleanupMinutes:settings.cleanupMinutes};
}
export async function readScheduleDays(storeId:string,periodKey:string):Promise<ScheduleDay[]> {
  const period=schedulePeriod(periodKey);
  const rows=await sql`
    select to_char(calendar.day,'YYYY-MM-DD') as "workDate",
      coalesce(d.business_status,case when jsonb_array_length(sh.shifts)>0 then 'open' else 'pending' end) as "businessStatus",
      coalesce(d.hours_source,'schedule') as "hoursSource",d.manual_periods as "manualPeriods",d.business_periods as "businessPeriods",
      coalesce(d.revision,0) as revision,d.confirmed_at::text as "confirmedAt",coalesce(d.needs_refresh,false) as "needsRefresh",d.attention_reason as "attentionReason",sh.shifts
    from generate_series(${period.startDate}::date-1,${period.endDate}::date+1,interval '1 day') calendar(day)
    left join timecard_schedule_days d on d.store_id::text=${storeId} and d.work_date=calendar.day::date
    cross join lateral(select coalesce(jsonb_agg(jsonb_build_object('workDate',to_char(work_date,'YYYY-MM-DD'),
      'scheduledStart',to_char(scheduled_start,'HH24:MI'),'scheduledEnd',to_char(scheduled_end,'HH24:MI')) order by scheduled_start,scheduled_end),'[]'::jsonb) as shifts
      from timecard_shifts where store_id::text=${storeId} and work_date=calendar.day::date) sh
    order by calendar.day
  `;
  const rules=await storeRules(storeId);
  const all=rows as unknown as ScheduleDay[];
  return all.filter(day=>period.dates.includes(day.workDate)).map(day=>{
    const index=all.indexOf(day),previous=all[index-1],next=all[index+1];
    let suggestedPeriods:GbpPeriod[]=[];
    try { if(rules&&day.shifts.length)suggestedPeriods=deriveSpecialHours(day.shifts,rules,day.workDate.slice(0,7)); } catch { /* Readiness below explains invalid shifts. */ }
    // An implicit empty date can be closed by a deliberate confirmation.
    // A saved pending status is an explicit decision to defer.
    const closureCandidate=day.hoursSource==='schedule'&&!day.shifts.length&&
      ((!day.revision&&day.businessStatus==='pending')||(!!day.confirmedAt&&day.businessStatus==='open'));
    let reason=day.hoursSource==='manual'
      ? day.businessStatus==='pending'?'営業予定が未確定です。':day.businessStatus==='open'&&!day.manualPeriods?.length?'営業時間を入力してください。':null
      : dayReadiness(closureCandidate?'closed':day.businessStatus,day.shifts,day.workDate,rules);
    if(!reason&&day.hoursSource==='schedule'&&day.businessStatus==='open'&&!closureCandidate&&!rules)reason='準備・片付け時間を設定してください。';
    if(!reason){
      try{
        const periods=(value:ScheduleDay|undefined):GbpPeriod[]=>!value?[]:value!==day&&value.confirmedAt&&!value.needsRefresh&&value.businessPeriods?value.businessPeriods.filter(p=>!p.closed):value.hoursSource==='manual'
          ? value.businessStatus==='open'?value.manualPeriods??[]:[]
          : value.shifts.length?deriveSpecialHours(value.shifts,rules??{preparationMinutes:0,cleanupMinutes:0},value.workDate.slice(0,7)):[];
        const own=day.businessStatus==='open'?periods(day):[];
        const spill=(value:ScheduleDay|undefined,date:string)=>Math.max(0,...periods(value).filter(p=>p.endDate&&dateKey(p.endDate)===date&&dateKey(p.startDate)!==date).map(p=>(p.closeTime?.hours??0)*60+(p.closeTime?.minutes??0)));
        const start=(value:ScheduleDay|undefined)=>Math.min(1440,...periods(value).map(p=>(p.openTime?.hours??0)*60+(p.openTime?.minutes??0)));
        const incoming=spill(previous,day.workDate);
        if(incoming>0&&((day.businessStatus==='closed'||closureCandidate)||incoming>start(day)))reason='前日からの営業と営業時間・休業日が重なっています。';
        const outgoing=next?Math.max(0,...own.filter(p=>p.endDate&&dateKey(p.endDate)===next.workDate).map(p=>(p.closeTime?.hours??0)*60+(p.closeTime?.minutes??0))):0;
        if(outgoing>0&&next&&(next.businessStatus==='closed'||(!next.needsRefresh&&next.businessPeriods?.some(p=>p.closed))||outgoing>start(next)))reason='翌日の営業時間・休業日と重なっています。';
      }catch{reason='前後日のシフト時刻を確認してください。';}
    }
    return {...day,closureCandidate,suggestedPeriods,suggestionRules:rules,neighborVersions:[previous,next].filter((value):value is ScheduleDay=>!!value).map(value=>({date:value.workDate,revision:Number(value.revision)})),boundarySnapshot:[...(previous?.shifts??[]),...day.shifts,...(next?.shifts??[])],shiftCount:day.shifts.length,ready:!reason,attentionReason:reason??day.attentionReason};
  });
}
export async function confirmScheduleDay(storeId:string,date:string,actorId:string|null,source:'manual'|'automatic'|'change'='manual',prepared?:ScheduleDay,note?:string,automatic?:AutomaticContext, allowImplicitClosure=false) {
  const periodKey=periodKeyForDate(date);
  const initial=prepared??(await readScheduleDays(storeId,periodKey)).find(day=>day.workDate===date)!;
  if(initial.businessStatus==='pending'&&!initial.revision&&(!allowImplicitClosure||!initial.closureCandidate||!initial.ready))return {confirmed:false,queued:false,reason:initial.attentionReason??'営業予定が未確定です。'};
  // Keep schedule-driven intent as open so a future shift can propose reopening.
  const storedStatus=initial.closureCandidate&&!initial.revision?'open':initial.businessStatus;
  const inserted=await sql`insert into timecard_schedule_days(store_id,work_date,business_status) values(${storeId}::uuid,${date}::date,${storedStatus}) on conflict(store_id,work_date) do nothing returning revision`;
  const day=inserted[0]?{...initial,businessStatus:storedStatus,revision:Number(inserted[0].revision)}:initial.revision?initial:(await readScheduleDays(storeId,periodKey)).find(day=>day.workDate===date)!;
  const reason=day.ready?null:day.attentionReason;
  if(reason){
    await sql`update timecard_schedule_days set attention_reason=${reason},refresh_after=now()+interval '1 hour' where store_id::text=${storeId} and work_date=${date}::date and revision=${day.revision}`;
    return {confirmed:false,queued:false,reason};
  }
  if(source==='automatic'&&day.confirmedAt)return {confirmed:true,queued:false};
  const snapshot=JSON.stringify(day.shifts);
  const closed=day.businessStatus==='closed'||day.closureCandidate===true;
  const resolved=closed?[{startDate:parseDate(date),closed:true}]:day.hoursSource==='manual'?day.manualPeriods!:day.suggestedPeriods;
  if(source==='change'&&canonicalPeriods(resolved)!==canonicalPeriods(day.businessPeriods??[])){
    await sql`update timecard_schedule_days set refresh_after=now()+interval '1 hour'
      where store_id::text=${storeId} and work_date=${date}::date and revision=${day.revision}`;
    return {confirmed:false,queued:false,reason:'営業時間の変更を確認してください。'};
  }
  const businessPeriods=JSON.stringify(resolved);
  const rules=day.hoursSource==='schedule'&&!closed&&day.businessStatus==='open'?day.suggestionRules:undefined;
  // Store-wide lock serializes neighboring day edits; the second statement receives a fresh snapshot.
  const confirmation=sql`
    with confirmed as (
      update timecard_schedule_days set shift_snapshot=${snapshot}::jsonb,business_periods=${businessPeriods}::jsonb,confirmed_at=now(),confirmed_by=${actorId}::uuid,
        confirmation_source=${source},needs_refresh=false,attention_reason=null,revision=revision+1,updated_at=now()
      where store_id::text=${storeId} and work_date=${date}::date and revision=${day.revision} and business_status=${day.businessStatus}
        and (${day.hoursSource!=='schedule'||closed||day.businessStatus!=='open'} or exists(
          select 1 from stores st left join timecard_schedule_settings s on s.store_id=st.id left join google_business_connections c on c.store_id=st.id
          where st.id::text=${storeId} and (case when s.store_id is null then c.preparation_minutes else s.preparation_minutes end)=${rules?.preparationMinutes??-1}
          and (case when s.store_id is null then c.cleanup_minutes else s.cleanup_minutes end)=${rules?.cleanupMinutes??-1}
        ))
        and ${JSON.stringify(day.neighborVersions)}::jsonb=(select coalesce(jsonb_agg(jsonb_build_object('date',to_char(calendar.day,'YYYY-MM-DD'),'revision',coalesce(n.revision,0)) order by calendar.day),'[]'::jsonb)
          from (values(${date}::date-1),(${date}::date+1)) calendar(day)
          left join timecard_schedule_days n on n.store_id::text=${storeId} and n.work_date=calendar.day)
        and (${source!=='automatic'} or exists(
          select 1 from timecard_schedule_settings s join stores st on st.id=s.store_id
          where s.store_id::text=${storeId} and s.auto_confirm and s.revision=${automatic?.revision??-1}
          and coalesce(st.shift_first_half_submission_deadline_day,25)=${automatic?.submissionFirstDay??0}
          and coalesce(st.shift_second_half_submission_deadline_day,10)=${automatic?.submissionSecondDay??0}
          and to_char(coalesce(st.shift_submission_deadline_time,'23:59'::time),'HH24:MI')=${automatic?.submissionTime??''}
        ))
        and ${JSON.stringify(day.boundarySnapshot)}::jsonb=(select coalesce(jsonb_agg(jsonb_build_object('workDate',to_char(work_date,'YYYY-MM-DD'),
          'scheduledStart',to_char(scheduled_start,'HH24:MI'),'scheduledEnd',to_char(scheduled_end,'HH24:MI')) order by work_date,scheduled_start,scheduled_end),'[]'::jsonb)
          from timecard_shifts where store_id::text=${storeId} and work_date between ${date}::date-1 and ${date}::date+1)
      returning *
    ), publication as (
      insert into timecard_shift_publications(store_id,schedule_month,note,published_by,shift_snapshot,period_key,work_date,business_periods)
      select store_id,${date.slice(0,7)},${note??source},${actorId}::uuid,shift_snapshot,${periodKey},work_date,business_periods from confirmed returning id,store_id,work_date
    ), queued as (
      insert into google_business_hours_jobs(publication_id,store_id,schedule_month,connection_revision,location_name,rules,closed_dates,work_date,day_revision)
      select p.id,p.store_id,${date.slice(0,7)},c.revision,c.location_name,jsonb_build_object('preparationMinutes',c.preparation_minutes,'cleanupMinutes',c.cleanup_minutes),
        case when ${closed} then jsonb_build_array(${date}::text) else '[]'::jsonb end,p.work_date,d.revision
      from publication p join confirmed d on d.store_id=p.store_id and d.work_date=p.work_date
      join google_business_connections c on c.store_id=p.store_id and c.enabled
      where p.work_date >= (now() at time zone 'Asia/Tokyo')::date
        and (
          (c.applied_dates -> to_char(p.work_date,'YYYY-MM-DD')) is distinct from d.business_periods
          or c.lease_until>now()
          or exists (
            select 1 from google_business_hours_jobs previous
            where previous.store_id=p.store_id and previous.work_date=p.work_date
              and previous.connection_revision=c.revision and previous.status in ('pending','failed')
              and previous.intended_periods is not null
          )
        )
      returning id
    ) select publication.id::text,(select id::text from queued) as "jobId" from publication
  `;
  const results=await sql.transaction([sql`select pg_advisory_xact_lock(hashtextextended(${storeId},0))`,confirmation]);
  const rows=results[1];
  if(!rows[0])return {confirmed:false,queued:false,reason:'シフトが変更されました。再読み込みして確認してください。'};
  return {confirmed:true,queued:!!rows[0].jobId};
}
export function scheduleDayReviewKey(day:ScheduleDay) {
  return JSON.stringify([day.workDate,day.revision,day.ready,day.businessStatus,day.closureCandidate,
    day.hoursSource,day.manualPeriods,day.suggestedPeriods,day.boundarySnapshot]);
}
export async function confirmSchedulePeriod(storeId:string,key:string,actorId:string|null,source:'manual'|'automatic'='manual',notBefore?:string,note?:string,automatic?:AutomaticContext,review?:Record<string,string>) {
  const period=schedulePeriod(key);
  const days=await readScheduleDays(storeId,key);
  let confirmed=0,queued=0;
  const unresolved:string[]=[];
  for(const day of days){
    if(source==='automatic'&&(day.confirmedAt||day.closureCandidate||!day.ready||day.workDate<(notBefore??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))))continue;
    const fresh=(await readScheduleDays(storeId,key)).find(item=>item.workDate===day.workDate)!;
    if(review&&review[day.workDate]!==scheduleDayReviewKey(fresh)){
      unresolved.push(day.workDate);
      continue;
    }
    const result=await confirmScheduleDay(storeId,day.workDate,actorId,source,fresh,note,automatic,!!review);
    if(result.confirmed)confirmed++;else unresolved.push(day.workDate);
    if(result.queued)queued++;
  }
  if(confirmed>0){
    const staff=await sql`select e.id::text from employees e join employee_work_stores w on w.employee_id=e.id where w.store_id::text=${storeId} and e.status='active'`;
    await Promise.allSettled(staff.map(employee=>createOsNotification({employeeId:String(employee.id),type:'shift_schedule_confirmed',title:'シフトが確定しました',message:`${period.startDate}〜${period.endDate}: ${confirmed}日分のシフトを確認してください。`,href:'/store/timecard',sendPush:false})));
  }
  return {period:period.key,confirmed,queued,unresolved};
}
export async function refreshChangedScheduleDays(storeId:string,dates?:string[],actorId:string|null=null) {
  const dirty=await sql`select to_char(work_date,'YYYY-MM-DD') as date from timecard_schedule_days where store_id::text=${storeId} and needs_refresh and confirmed_at is not null and (${!!dates} or (work_date>=(now() at time zone 'Asia/Tokyo')::date and refresh_after<=now())) and (${!dates} or to_char(work_date,'YYYY-MM-DD')=any(${dates??[]})) order by work_date limit ${dates?.length??62}`;
  const results=[];
  for(const day of dirty)results.push(await confirmScheduleDay(storeId,String(day.date),actorId,'change'));
  return results;
}
export async function saveScheduleDayStatus(storeId:string,date:string,status:BusinessStatus,revision:number,actorId:string) {
  const rows=await sql`
    insert into timecard_schedule_days(store_id,work_date,business_status)
    select ${storeId}::uuid,${date}::date,${status} where ${revision===0}
    on conflict(store_id,work_date) do nothing returning revision
  `;
  if(!rows[0]){
    const updated=await sql`
      update timecard_schedule_days set business_status=${status},revision=revision+1,
        confirmed_at=case when ${status}='pending' then null else confirmed_at end,
        needs_refresh=case when ${status}='pending' then false else confirmed_at is not null end,
        attention_reason=null,refresh_after=now(),updated_at=now()
      where store_id::text=${storeId} and work_date=${date}::date and revision=${revision} returning revision
    `;
    if(!updated[0])throw new Error('営業予定が変更されました。再読み込みしてください。');
  }
  const dirty=await sql`select confirmed_at from timecard_schedule_days where store_id::text=${storeId} and work_date=${date}::date`;
  if(dirty[0]?.confirmed_at&&status!=='pending')return confirmScheduleDay(storeId,date,actorId,'change');
  return {confirmed:false,queued:false};
}
export async function saveBusinessDay(storeId:string,date:string,status:BusinessStatus,hoursSource:'schedule'|'manual',intervals:PublishedShift[],revision:number,actorId:string) {
  let periods:GbpPeriod[]|null=null;
  if(hoursSource==='manual'&&status==='open'){
    if(!Array.isArray(intervals)||!intervals.length||intervals.length>8||intervals.some(item=>item.workDate!==date))throw new Error('営業時間を入力してください。');
    // Manual hours are already customer-facing; preparation/cleanup must not be subtracted twice.
    periods=deriveSpecialHours(intervals,{preparationMinutes:0,cleanupMinutes:0},date.slice(0,7));
  }
  const rows=await sql`
    insert into timecard_schedule_days(store_id,work_date,business_status,hours_source,manual_periods)
    select ${storeId}::uuid,${date}::date,${status},${hoursSource},${JSON.stringify(periods)}::jsonb where ${revision===0}
    on conflict(store_id,work_date) do nothing returning revision
  `;
  if(!rows[0]){
    const updated=await sql`update timecard_schedule_days set business_status=${status},hours_source=${hoursSource},manual_periods=${JSON.stringify(periods)}::jsonb,
      confirmed_at=case when ${status}='pending' then null else confirmed_at end,
      needs_refresh=case when ${status}='pending' then false else confirmed_at is not null end,
      revision=revision+1,attention_reason=null,refresh_after=now(),updated_at=now()
      where store_id::text=${storeId} and work_date=${date}::date and revision=${revision} returning revision`;
    if(!updated[0])throw new Error('営業予定が変更されました。再読み込みしてください。');
  }
  const saved=await sql`select confirmed_at from timecard_schedule_days where store_id::text=${storeId} and work_date=${date}::date`;
  if(saved[0]?.confirmed_at&&status!=='pending')return confirmScheduleDay(storeId,date,actorId,'change');
  return {confirmed:false,queued:false};
}
async function remindUnresolved(storeId:string,key:string,unresolved:string[],today:string) {
  if(!unresolved.length)return;
  const managers=await sql`select id::text from employees where status='active' and (role in('owner','manager') or (role in('store_owner','store_manager') and exists(select 1 from employee_scopes where employee_id=employees.id and scope_type='store' and store_id::text=${storeId})))`;
  await Promise.allSettled(managers.map(manager=>createOsNotification({employeeId:String(manager.id),type:'shift_schedule_attention',sendPush:false,sourceKey:`shift-schedule:${storeId}:${key}:${today}`,title:'シフトの営業予定を確認してください',message:`${key}: ${unresolved.length}日分の営業予定・人員を確認してください。`,href:`/os/timecard/requests?storeId=${storeId}&date=${unresolved[0]}`})));
}
export async function sweepScheduleConfirmations(now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const month=today.slice(0,7),[year,number]=month.split('-').map(Number);
  const nextMonth=new Date(Date.UTC(year,number,1)).toISOString().slice(0,7);
  const stores=await sql`select s.store_id::text,s.updated_by::text from timecard_schedule_settings s join stores st on st.id=s.store_id and st.status='active' where s.auto_confirm order by s.last_checked_at nulls first,s.store_id limit 1`;
  let count=0;
  for(const store of stores){
    const storeId=String(store.store_id),settings=await readConfirmationSettings(storeId);
    await sql`update timecard_schedule_settings set last_checked_at=now() where store_id::text=${storeId}`;
    if(!settings.autoConfirm)continue;
    try{assertAfterSubmission(settings,{firstDay:settings.submissionFirstDay,secondDay:settings.submissionSecondDay,time:settings.submissionTime});}
    catch{await remindUnresolved(storeId,`${month}-settings`,[today],today);continue;}
    for(const key of [`${month}-first_half`,`${month}-second_half`,`${nextMonth}-first_half`]){
      const period=schedulePeriod(key),deadline=confirmationDeadline(period,settings);
      if(period.endDate<today||!deadline||Date.parse(deadline)>now.getTime())continue;
      const result=await confirmSchedulePeriod(storeId,key,store.updated_by?String(store.updated_by):null,'automatic',today,undefined,settings);
      const unresolved=(await readScheduleDays(storeId,key)).filter(day=>day.workDate>=today&&(!day.confirmedAt||day.needsRefresh||!!day.attentionReason)).map(day=>day.workDate);
      await remindUnresolved(storeId,key,unresolved,today);
      count+=result.confirmed;
    }
  }
  const dirtyStores=await sql`select d.store_id::text from timecard_schedule_days d join stores st on st.id=d.store_id and st.status='active' where d.needs_refresh and d.confirmed_at is not null and d.work_date>=(now() at time zone 'Asia/Tokyo')::date and d.refresh_after<=now() group by d.store_id order by min(d.refresh_after) limit 2`;
  for(const row of dirtyStores)await refreshChangedScheduleDays(String(row.store_id));
  return {confirmed:count};
}

// A failed immediate refresh never loses the trigger-recorded work or misreports a saved shift as unsaved.
export async function reconcileScheduleMutation(storeId:string,dates:string[],actorId:string) {
  try {
    const affectedDates=new Set(dates.flatMap(date=>{
      const timestamp=Date.parse(`${date}T00:00:00Z`);
      return [-1,0,1].map(offset=>new Date(timestamp+offset*86400000).toISOString().slice(0,10));
    }));
    const results=await refreshChangedScheduleDays(storeId,[...affectedDates],actorId);
    const reasons=results.flatMap(result=>result.reason?[result.reason]:[]);
    return {queued:results.filter(result=>result.queued).length,warning:reasons[0]??null};
  }catch{return {queued:0,warning:'シフトは保存されました。確定済み日の同期状態を確認してください。'};}
}

// Commit a user's bulk edit as one staffing fact; workers must never see the delete/insert gap.
export async function writeScheduleShiftsBulk(storeId:string,actorId:string,entries:Array<{employeeId:string;workDate:string;scheduledStart?:unknown;scheduledEnd?:unknown;breakMinutes?:unknown;note?:unknown}>,remove=false) {
  if(remove){
    await sql.transaction(entries.map(entry=>sql`delete from timecard_shifts where employee_id=${entry.employeeId}::uuid and store_id=${storeId}::uuid and work_date=${entry.workDate}::date`));
    return [] as string[];
  }
  const normalized=entries.map(entry=>{
    const start=String(entry.scheduledStart??''),end=String(entry.scheduledEnd??'');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end))throw new Error('開始時刻と終了時刻を入力してください。');
    return {...entry,start,end,breakMinutes:Math.max(0,Math.min(720,Math.round(Number(entry.breakMinutes??0)||0))),note:String(entry.note??'').trim()||null};
  });
  const operations=normalized.flatMap(entry=>[
    sql`delete from timecard_shifts where employee_id=${entry.employeeId}::uuid and store_id=${storeId}::uuid and work_date=${entry.workDate}::date`,
    sql`insert into timecard_shifts(employee_id,store_id,work_date,scheduled_start,scheduled_end,break_minutes,note,created_by,updated_at)
      values(${entry.employeeId}::uuid,${storeId}::uuid,${entry.workDate}::date,${entry.start}::time,${entry.end}::time,${entry.breakMinutes},${entry.note},${actorId}::uuid,now()) returning id::text`
  ]);
  const results=await sql.transaction(operations);
  return results.filter((_rows,index)=>index%2===1).flatMap(rows=>rows[0]?.id?[String(rows[0].id)]:[]);
}
