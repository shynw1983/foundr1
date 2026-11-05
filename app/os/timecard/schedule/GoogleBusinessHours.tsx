'use client';
import { useEffect, useRef, useState } from 'react';
import { useOsTranslation } from '../../components/OsTranslationProvider';
import styles from './google-business-hours.module.css';

type Connection = { revision:number; enabled:boolean; connected:boolean; preparationMinutes:number|null; cleanupMinutes:number|null; locationName:string|null; locationTitle?:string };
type Job = { id:string; month:string; date?:string; status:string; lastError:string|null; syncedAt:string|null; attempts:number };
type Payload = { configured:boolean; connection:Connection; jobs:Job[]; queue?:{resumable:number;conflicts:number} };
type Location = { name:string; title:string; storefrontAddress?:{ addressLines?:string[]; locality?:string } };
const statusLabels:Record<string,string> = { pending:'同期待ち', failed:'同期失敗', conflict:'要確認',synced:'Google 保存確認済み',superseded:'新しい公開・設定に置換済み' };
export function GoogleBusinessHours({storeId, refreshKey}:{storeId:string;refreshKey:string}) {
  const {t}=useOsTranslation();
  function translatedMessage(value:string) {
    const match = /^(.*?)(: |（)(.*)$/.exec(value);
    return match ? `${t(match[1])}${match[2]}${match[3]}` : t(value);
  }
  const [data,setData]=useState<Payload|null>(null);
  const [locations,setLocations]=useState<Location[]>([]);
  const [location,setLocation]=useState('');
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const generation=useRef(0);
  const previousPublication=useRef(refreshKey);
  async function load(id:string,version:number,hydrate=true) {
    try {
      const response=await fetch(`/api/os/google-business?storeId=${encodeURIComponent(id)}`,{cache:'no-store'});
      const body=await response.json();
      if (version!==generation.current) return;
      if (!response.ok) throw new Error(body.error);
      if (!hydrate) { setData(current=>current?{...current,jobs:body.jobs,queue:body.queue}:current); return; }
      setData(body);
      setLocation(body.connection.locationName ?? '');
      setEnabled(body.connection.enabled);
    } catch(error) { if(version===generation.current)setMessage(error instanceof Error?error.message:'読み込めませんでした。'); }
  }
  useEffect(()=> {
    const version=++generation.current;
    setData(null);setLocations([]);setMessage('');setBusy(false);
    const query=new URLSearchParams(window.location.search);
    if(query.get('storeId')===storeId && query.has('googleBusiness')) setMessage(query.get('googleBusiness')==='connected'?'Google アカウントを連携しました。店舗を選択して設定を保存してください。':'Google アカウントを連携できませんでした。認証をやり直してください。');
    if(storeId)void load(storeId,version);
    return ()=>{generation.current++;};
  },[storeId]);
  useEffect(()=>{
    if(previousPublication.current===refreshKey)return;
    previousPublication.current=refreshKey;
    if(storeId)void load(storeId,generation.current,false);
  },[storeId,refreshKey]);
  async function act(action:string,extra:Record<string,unknown>={}) {
    const version=generation.current;
    setBusy(true);setMessage('');
    try {
      const response=await fetch('/api/os/google-business',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,action,...extra})});
      const result=await response.json();
      if(version!==generation.current)return;
      if(!response.ok)throw new Error(result.error);
      if(result.url){window.location.assign(result.url);return;}
      const resuming=action==='retry'||action==='resume';
      await load(storeId,version,!resuming);
      if(version===generation.current)setMessage(resuming?'同期を再試行します。':result.unchanged?'連携設定に変更はありません。':'保存しました。必要な日・半月のシフトを再確定してください。');
    } catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'保存できませんでした。');}
    finally{if(version===generation.current)setBusy(false);}
  }
  async function loadLocations() {
    const version=generation.current;
    setBusy(true);setMessage('');
    try {
      const response=await fetch(`/api/os/google-business?storeId=${encodeURIComponent(storeId)}&locations=1`,{cache:'no-store'});
      const result=await response.json();
      if(version!==generation.current)return;
      if(!response.ok)throw new Error(result.error);
      setLocations(result.locations);
      if(!result.locations.length)setMessage('管理できる Google の店舗がありません。');
    } catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'読み込めませんでした。');}
    finally{if(version===generation.current)setBusy(false);}
  }
  return <section className={`panel ${styles.panel}`} aria-label={t('Google 営業時間連携')}>
    <div className="panel-title"><div><h3>{t('Google 営業時間連携')}</h3><p>{t('確定した日別の営業予定から特別営業時間を同期します。通常営業時間は Google の設定を維持します。')}</p></div></div>
    {message?<p role="status">{translatedMessage(message)}</p>:null}
    {!data&&message?<button type="button" className="secondary-button" onClick={()=>{setMessage('');void load(storeId,generation.current);}}>{t('同期状態を更新')}</button>:null}
    {!data?<p>{t(message?'同期状態を更新してください。':'連携設定を読み込み中')}</p>:<>
      {!data.configured?<p>{t('Google API・認証の環境設定が必要です。自動同期はまだ利用できません。')}</p>:null}
      <div className={styles.actions}>
        <span>{t(data.connection.connected?'Google アカウント連携済み':'Google アカウント未連携')}</span>
        <button type="button" className="secondary-button" disabled={busy||!data.configured} onClick={()=>void act('connect')}>{t('Google アカウントを連携')}</button>
        {data.connection.connected?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void loadLocations()}>{t('Google の店舗を取得')}</button>:null}
      </div>
      <div className={styles.fields}>
        <label>{t('Google の店舗')}<select value={location} disabled={busy} onChange={event=>setLocation(event.target.value)}>
          <option value="">{t('店舗を選択してください。')}</option>
          {data.connection.locationName&&!locations.some(item=>item.name===data.connection.locationName)?<option value={data.connection.locationName}>{data.connection.locationTitle ?? data.connection.locationName}</option>:null}
          {locations.map(item=><option key={item.name} value={item.name}>{item.title} — {item.storefrontAddress?.addressLines?.join(' ') ?? item.storefrontAddress?.locality ?? item.name}</option>)}
        </select></label>
      </div>
      <label className={styles.check}><input type="checkbox" checked={enabled} disabled={busy||!data.configured||!data.connection.connected||!location} onChange={event=>setEnabled(event.target.checked)}/>{t('確定した営業予定を自動同期する')}</label>
      <p>{t('確定済みの営業日カレンダーだけを同期します。Google 側の手動変更と競合する場合は停止します。')}</p>
      <div className={styles.actions}>
        <button type="button" className="primary-button" disabled={busy} onClick={()=>void act('save',{revision:data.connection.revision,locationName:location,enabled})}>{t('連携設定を保存')}</button>
        {data.connection.connected?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act('disconnect',{revision:data.connection.revision,enabled:false})}>{t('連携を解除')}</button>:null}
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(storeId,generation.current,false)}>{t('同期状態を更新')}</button>
      </div>
      {data.queue&&(data.queue.resumable>0||data.queue.conflicts>0)?<div className={styles.actions}>
        <span>{t('同期未完了 {count}日',{count:data.queue.resumable+data.queue.conflicts})}</span>
        {data.queue.resumable>0?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act('resume')}>{t('同期を続ける')}</button>:null}
      </div>:null}
      {data.jobs.length?<div className={styles.history}>{data.jobs.map(job=><div className={styles.job} key={job.id}>
        <span>{job.date ?? job.month} · {t(statusLabels[job.status] ?? job.status)}{job.syncedAt?` · ${new Date(job.syncedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`:''}</span>
        {job.lastError?<span role="status">{translatedMessage(job.lastError)}</span>:null}
        {data.connection.enabled&&['pending','failed','conflict'].includes(job.status)?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act('retry',{jobId:job.id})}>{t('同期を再試行')}</button>:null}
      </div>)}</div>:<p>{t('同期履歴はありません。設定を保存し、対象日または半月のシフトを確定してください。')}</p>}
      <p>{t('保存確認は Google 管理データの確認です。検索・マップへの反映には時間がかかる場合があります。')}</p>
    </>}
  </section>;
}
