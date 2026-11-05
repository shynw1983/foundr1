'use client';
import {useEffect,useRef,useState} from 'react';
import {useOsTranslation} from '../../components/OsTranslationProvider';
import type {BusinessStatus,ConfirmationSettings} from '../../../../lib/shift-confirmation-policy';
import type {GbpPeriod} from '../../../../lib/google-business-hours-policy';
import type {ScheduleDay} from '../../../../lib/shift-confirmation';
import styles from './schedule-confirmation.module.css';
type Payload={settings:ConfirmationSettings&{revision:number};period:{key:string;startDate:string;endDate:string};days:(ScheduleDay&{reviewKey?:string})[];otherDays?:ScheduleDay[];summary:{confirmed:number;total:number;pending:number}};
export const formatPeriods=(periods:GbpPeriod[]|null|undefined)=>periods?.map(p=>p.closed?'休業':`${String(p.openTime?.hours??0).padStart(2,'0')}:${String(p.openTime?.minutes??0).padStart(2,'0')}-${String(p.closeTime?.hours??0).padStart(2,'0')}:${String(p.closeTime?.minutes??0).padStart(2,'0')}`).join(', ')??'';
type HoursDraft={source:'schedule'|'manual';text:string};
const labels:Record<BusinessStatus,string>={pending:'未確定',open:'営業',closed:'休業'};
export function ScheduleConfirmation({storeId,periodKey,refreshKey='',onChanged,selectedDate,onDays}:{storeId:string;periodKey:string;refreshKey?:string;onChanged:()=>void;selectedDate?:string;onDays?:(days:ScheduleDay[])=>void}){
 const {t}=useOsTranslation();
 const [data,setData]=useState<Payload|null>(null),[settings,setSettings]=useState<ConfirmationSettings|null>(null);
 const [drafts,setDrafts]=useState<Record<string,BusinessStatus>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [note,setNote]=useState('');
 const [review,setReview]=useState(false);
 useEffect(()=>{if(data)onDays?.([...data.days,...(data.otherDays??[])]);},[data,onDays]);
 useEffect(()=>setReview(false),[periodKey,refreshKey]);
 const [hoursDrafts,setHoursDrafts]=useState<Record<string,HoursDraft>>({});
 const generation=useRef(0),readSequence=useRef(0),previousRefresh=useRef(refreshKey);
 const draftRevisions=useRef<Record<string,number>>({});
 async function load(version:number,hydrate=true){
  const sequence=++readSequence.current;
  try{
   const response=await fetch(`/api/timecard/schedule-confirmation?storeId=${encodeURIComponent(storeId)}&period=${encodeURIComponent(periodKey)}${onDays?"&includeMonth=1":""}`,{cache:'no-store'});
   const body=await response.json();if(version!==generation.current||sequence!==readSequence.current)return;if(!response.ok)throw new Error(body.error);
   if(hydrate||!settings){setData(body);setSettings(body.settings);setDrafts({});setHoursDrafts({});draftRevisions.current={};}
   else setData(current=>current?{...body,settings:current.settings}:body);
  }catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'営業予定を読み込めませんでした。');}
 }
 useEffect(()=>{const version=++generation.current;setData(null);setSettings(null);setDrafts({});setHoursDrafts({});setMessage('');setNote('');setBusy(false);draftRevisions.current={};void load(version);return()=>{generation.current++;};},[storeId,periodKey]);
 useEffect(()=>{if(previousRefresh.current===refreshKey)return;previousRefresh.current=refreshKey;void load(generation.current,false);},[refreshKey]);
 async function act(action:string,extra:Record<string,unknown>={}){
  const version=generation.current;const retainedDrafts={...drafts},retainedHours={...hoursDrafts},retainedRevisions={...draftRevisions.current};setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/timecard/schedule-confirmation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,period:periodKey,action,...extra})});
   const body=await response.json();if(version!==generation.current)return;if(!response.ok)throw new Error(body.error);
   if((action==='set_day'||action==='set_business_day'))delete draftRevisions.current[String(extra.date)];
   if((action==='set_day'||action==='set_business_day'))setDrafts(current=>{const next={...current};delete next[String(extra.date)];return next;});
   if(action==='set_business_day')setHoursDrafts(current=>{const next={...current};delete next[String(extra.date)];return next;});
   await load(version,action==='save_settings');
   if(version!==generation.current)return;
   if(action==='save_settings'){setDrafts(retainedDrafts);setHoursDrafts(retainedHours);draftRevisions.current=retainedRevisions;}
   setMessage(body.result?.reason??(action==='confirm_period'&&body.result?.unresolved?.length
      ? t('{confirmed}日を確定しました。未確定の日：{dates}',{confirmed:body.result.confirmed,dates:body.result.unresolved.join('、')})
      : action==='confirm_period'?'確認できた日を確定しました。未確定の日は Google を変更しません。':'営業予定を保存しました。'));
   if(action==='confirm_period'){setNote('');setReview(false);}
   onChanged();
  }catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'営業予定を保存できませんでした。');}
  finally{if(version===generation.current)setBusy(false);}
 }
 const settingsDirty=!!data&&!!settings&&JSON.stringify(settings)!==JSON.stringify(data.settings);
 const pendingDraft=Object.keys(drafts).length>0||Object.keys(hoursDrafts).length>0;
 function changeHours(day:ScheduleDay,value:HoursDraft){draftRevisions.current[day.workDate]??=day.revision;setHoursDrafts(current=>({...current,[day.workDate]:value}));}
 function saveDay(day:ScheduleDay,status:BusinessStatus,hours:HoursDraft){
  const intervals=hours.source==='manual'&&status==='open'?hours.text.split(',').map(text=>{const [scheduledStart,scheduledEnd]=text.trim().split('-');return {workDate:day.workDate,scheduledStart,scheduledEnd};}):[];
  void act('set_business_day',{date:day.workDate,status,hoursSource:hours.source,intervals,revision:draftRevisions.current[day.workDate]??day.revision});
 }
 return <section className={`panel ${styles.panel}`} aria-label={t('店舗の営業日カレンダー')}>
  <div className="panel-title" hidden={selectedDate!==undefined}><div><h3>{t('店舗の営業日カレンダー')}</h3><p>{t('シフトからの提案を確認し、正式な営業時間・営業状態を保存します。Google は確定した営業日カレンダーを参照します。')}</p></div></div>
  {message?<p role="status">{t(message)}</p>:null}
  {!data||!settings?<button className="secondary-button" type="button" onClick={()=>void load(generation.current)}>{t('営業予定を読み込む')}</button>:<>
   <details open={settingsDirty||undefined}><summary>{t('営業時間設定')}</summary>
   <div className={styles.fields}>
    <label>{t('開店前の準備（分）')}<input type="number" min={0} max={720} value={settings.preparationMinutes??''} disabled={busy} onChange={event=>setSettings({...settings,preparationMinutes:event.target.value===''?null:Number(event.target.value)})}/></label>
    <label>{t('閉店後の片付け（分）')}<input type="number" min={0} max={720} value={settings.cleanupMinutes??''} disabled={busy} onChange={event=>setSettings({...settings,cleanupMinutes:event.target.value===''?null:Number(event.target.value)})}/></label>
   </div>
   <p>{t('準備・片付け時間はシフト提案に使用します。未設定の場合、シフトから営業時間を確定しません。')}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>void act('save_settings',{revision:data.settings.revision,settings})}>{t('営業日カレンダー設定を保存')}</button>
   </details>
   <div className={styles.actions}>
    <button type="button" className="primary-button" disabled={busy||pendingDraft||settingsDirty} onClick={()=>setReview(true)}>{t('この半月の営業予定を確定')}</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(generation.current,false)}>{t('営業予定を更新')}</button>
    {pendingDraft||settingsDirty?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(generation.current,true)}>{t('入力を破棄して再読込')}</button>:null}
   </div>
   <p>{data.period.startDate}〜{data.period.endDate} · {t(data.summary.confirmed===data.summary.total?'全日確定':data.summary.confirmed?'一部確定':'未確定')} {data.summary.confirmed}/{data.summary.total}</p>
   {data.summary.pending>0?<p role="status" className={styles.notice}>{t('未確定・人員未配置の日があります。Google では元の営業時間が表示される場合があります。')}</p>:null}
   {review?<div className={styles.notice}>
    <label className={styles.note}>{t('公開メモ（任意）')}<input value={note} maxLength={1000} disabled={busy} onChange={event=>setNote(event.target.value)}/></label>
    <p>{t('営業 {open}日 / 休業 {closed}日 / 未確定 {pending}日',{
      open:data.days.filter(day=>day.ready&&!day.closureCandidate&&day.businessStatus==='open').length,
      closed:data.days.filter(day=>day.ready&&(day.closureCandidate||day.businessStatus==='closed')).length,
      pending:data.days.filter(day=>!day.ready).length,
    })}</p>
    <p>{t('休業日')} {data.days.filter(day=>day.ready&&(day.closureCandidate||day.businessStatus==='closed')).map(day=>day.workDate).join('、')||'—'}</p>
    <p>{t('未確定')} {data.days.filter(day=>!day.ready).map(day=>day.workDate).join('、')||'—'}</p>
    <button type="button" className="primary-button" disabled={busy||pendingDraft||settingsDirty} onClick={()=>void act('confirm_period',{note,review:Object.fromEntries(data.days.map(day=>[day.workDate,day.reviewKey]))})}>{t('確認して確定')}</button>
    <button type="button" className="secondary-button" onClick={()=>setReview(false)}>{t('閉じる')}</button>
   </div>:null}
   <div className={styles.days}>
    {data.days.filter(day=>selectedDate===undefined||day.workDate===selectedDate).map(day=>{
     const value=drafts[day.workDate]??day.businessStatus,hours=hoursDrafts[day.workDate]??{source:day.hoursSource??'schedule',text:formatPeriods(day.manualPeriods??day.suggestedPeriods)},changed=value!==day.businessStatus||!!hoursDrafts[day.workDate];
     const suggestedHours=formatPeriods(day.suggestedPeriods);
     const usesShiftProposal=day.hoursSource==='schedule'&&day.businessStatus==='open'&&!!suggestedHours;
     const canApplyShiftHours=!!suggestedHours&&!usesShiftProposal;
     const confirmLabel=day.confirmedAt&&day.needsRefresh
       ? (usesShiftProposal?'シフトの提案で変更を確定':'変更を確定')
       : 'この日を確定';
     return <div className={styles.day} key={day.workDate} role="group" aria-label={day.workDate}>
      <div><strong>{day.workDate}</strong><p>{t(day.confirmedAt?(day.needsRefresh||!day.ready?'確定後・要確認':'確定済み'):'未確定')} · {day.shiftCount}{t('件のシフト')}</p>
       <p>{t('シフト提案')}：{suggestedHours||t(day.shiftCount?'未設定':'シフトなし')}</p>
       <p>{t(day.confirmedAt&&(day.needsRefresh||!day.ready)?'前回確定した営業時間':'正式な営業時間')}：{day.confirmedAt&&day.businessPeriods?.length?day.businessPeriods.map(p=>p.closed?t('臨時休業'):formatPeriods([p])).join(', '):t('未確定')}</p>
       {day.attentionReason&&(day.businessStatus!=='pending'||day.closureCandidate)?<p className={styles.notice}>{t(canApplyShiftHours&&day.businessStatus==='closed'?'シフトが追加されました。営業する場合は、提案を適用して変更を確定してください。':day.attentionReason)}</p>:null}
      </div>
      <label><span className={styles.srOnly}>{day.workDate} {t('営業予定')}</span><select aria-label={`${day.workDate} ${t('営業予定')}`} value={value} disabled={busy} onChange={event=>{const selected=event.target.value as BusinessStatus;if(selected===day.businessStatus&&!hoursDrafts[day.workDate])delete draftRevisions.current[day.workDate];else draftRevisions.current[day.workDate]??=day.revision;setDrafts(current=>{const next={...current};if(selected===day.businessStatus)delete next[day.workDate];else next[day.workDate]=selected;return next;});}}>
       {(['pending','open','closed'] as const).map(status=><option value={status} key={status}>{t(labels[status])}</option>)}
      </select></label>
      <div className={styles.hours}>
       <label>{t('営業時間の決め方')}<select aria-label={`${day.workDate} ${t('営業時間の決め方')}`} value={hours.source} disabled={busy} onChange={event=>changeHours(day,{source:event.target.value as HoursDraft['source'],text:hours.text||formatPeriods(day.suggestedPeriods)})}><option value="schedule">{t('シフトに連動')}</option><option value="manual">{t('手動の例外設定')}</option></select></label>
       {hours.source==='manual'&&value==='open'?<label>{t('対客営業時間')}<input aria-label={`${day.workDate} ${t('対客営業時間')}`} value={hours.text} placeholder="12:00-15:00, 17:00-21:00" disabled={busy} onChange={event=>changeHours(day,{...hours,text:event.target.value})}/></label>:null}
      </div>
      <div className={styles.actions}>
       {canApplyShiftHours?<button type="button" className="primary-button" disabled={busy||settingsDirty||changed} onClick={()=>saveDay(day,'open',{source:'schedule',text:''})}>{t('シフトの提案を適用')}</button>:null}
       <button type="button" className="secondary-button" disabled={busy||!changed} onClick={()=>saveDay(day,value,hours)}>{t('営業予定を保存')}</button>
       {selectedDate===undefined||!day.confirmedAt||day.needsRefresh?<button type="button" className={canApplyShiftHours?"secondary-button":"primary-button"} disabled={busy||changed||!day.ready||settingsDirty||(selectedDate!==undefined&&!!day.confirmedAt&&!day.needsRefresh)} onClick={()=>void act('confirm_day',{date:day.workDate,reviewKey:day.reviewKey})}>{t(confirmLabel)}</button>:null}
      </div>
     </div>;
    })}
   </div>
   <p>{t('営業時間や営業状態を変更した日は、変更を確定すると Google の同期対象になります。')}</p>
  </>}
 </section>;
}
