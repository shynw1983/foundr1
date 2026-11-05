'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useOsTranslation } from '../../os/components/OsTranslationProvider';
import type { ReturnTypeRelay } from './StoreRelayScale';
import styles from './StoreRelayPanel.module.css';
export function StoreRelayPanel({relay,storeId}:{relay:ReturnTypeRelay;storeId:string}){
  const {t}=useOsTranslation();
  const [busy,setBusy]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const detailsId=useId();
  const busyRef=useRef(false);
  const currentStoreRef=useRef(storeId);currentStoreRef.current=storeId;
  useEffect(()=>{setExpanded(false);},[storeId]);
  const act=async(action:string,extra:Record<string,unknown>)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);
    const actionStore=storeId;
    try{
      await relay.action(action,extra);
      if(currentStoreRef.current===actionStore&&(action==='claim'||action==='takeover'))setExpanded(false);
    }catch{}finally{busyRef.current=false;setBusy(false);}
  };
  const stations=relay.stations.filter(s=>s.enabled);
  const connectionStation=relay.station||(stations.length===1?stations[0]:undefined);
  const recovering=Boolean(relay.recoveringStationId);
  const currentStation=relay.station||stations.find(s=>s.id===relay.recoveringStationId)||connectionStation;
  const warningJobs=relay.jobs.filter(j=>j.state==='uncertain'||(['pending','sending'].includes(j.state)&&Boolean(j.error)));
  const waitingJobs=relay.jobs.filter(j=>j.state==='pending'||j.state==='sending');
  const otherStationWarnings=relay.stations.filter(s=>s.id!==relay.owner?.stationId&&warningJobs.some(j=>j.station_id===s.id));
  const scaleState=currentStation?.device_status?.scale;
  const scaleStatus=relay.registerClosed?'はかり：閉店中は休止':!currentStation?.device_online?'はかり：未接続':scaleState==='connected'?'はかり：接続済み':scaleState==='connecting'?'はかり：再接続中':'はかり：未確認';
  const connectionParams=new URLSearchParams({storeId});
  if(connectionStation)connectionParams.set('stationId',connectionStation.id);
  if(!relay.stations.some(s=>s.enabled))return relay.error?<div className="action-notice" role="alert">{relay.error}</div>:null;
  return <section className={`panel ${styles.panel}`} aria-label={t('会計端末')}>
    <div className={styles.compact}>
      <div className={styles.overview}>
        <strong className={relay.owner?styles.current:styles.deviceState}>
          {stations.length>1&&currentStation?<span>{currentStation.name} · </span>:null}
          {t(relay.registerClosed?'閉店中・設備待機':relay.owner?'この端末で会計中':recovering?'会計端末を再接続中':'会計端末を選択してください')}
        </strong>
        {currentStation?<span className={currentStation.device_online?styles.connection:styles.attention}>
          {t(currentStation.device_online?'中継スマホ：オンライン':'中継スマホ：未接続')}
        </span>:null}
        {currentStation?.scale_enabled?<span className={relay.registerClosed||scaleState==='connected'&&currentStation.device_online?styles.connection:styles.attention}>{t(scaleStatus)}</span>:null}
        {warningJobs.length?<span className={styles.attention} role="status">{t('印刷結果の確認：{count}件',{count:warningJobs.length})}</span>
          :waitingJobs.length?<span className={styles.connection}>{t('印刷処理中：{count}件',{count:waitingJobs.length})}</span>:null}
      </div>
      <button type="button" className={`secondary-button ${styles.toggle}`} aria-expanded={expanded} aria-controls={detailsId} onClick={()=>setExpanded(value=>!value)}>
        {t(expanded?'閉じる':relay.owner||recovering?'接続・印刷の詳細':'接続設定を開く')}
        <ChevronDown size={16} aria-hidden="true" className={expanded?styles.chevronOpen:undefined}/>
      </button>
    </div>
    {relay.registerClosed?<p className={styles.help}>{t('開店確認後、電子はかりに自動で接続します。')}</p>:null}
    {relay.error&&!relay.registerClosed?<p className={styles.error} role="alert">{relay.error}</p>:null}
    <div id={detailsId} className={styles.details} hidden={!expanded}>
    <p className={styles.help}>一度選ぶと、このブラウザーに記憶して自動で再接続します。ほかの端末に引き継いだ場合は、もう一度選んでください。</p>
    {stations.map(s=><div key={s.id} className={styles.station}>
      <div className={styles.status}>
        {stations.length>1?<strong>{s.name}</strong>:null}
        <span>{s.device_online?'印刷用スマホ：オンライン':'印刷用スマホ：未接続'}</span>
        {s.print_enabled?<span>レシート・伝票の印刷を使用</span>:null}
        {s.scale_enabled?<span>電子はかり：接続状況を確認してください</span>:null}
      </div>
      {relay.owner?.stationId===s.id?<strong className={styles.current}>この端末で会計中</strong>:relay.recoveringStationId===s.id?<strong className={styles.current} role="status">この端末の会計を再接続しています…</strong>:<button type="button" className="primary-button" disabled={busy||relay.registerClosed||!Number.isFinite(relay.now())} onClick={()=>{
        const checkedAt=relay.now();if(!Number.isFinite(checkedAt))return;
        const occupied=Date.parse(s.owner_until||'')>checkedAt;
        if(occupied&&!window.confirm(t('ほかの端末から会計を引き継ぎます。元の端末は会計できなくなり、未確定の計量は終了します。')))return;
        void act(occupied?'takeover':'claim',{stationId:s.id,epoch:s.epoch});
      }}>{Date.parse(s.owner_until||'')>relay.now()?'この端末に会計を引き継ぐ':'この端末で会計を始める'}</button>}
    </div>)}
    {otherStationWarnings.map(s=><p key={s.id} className={styles.attention}>{t(s.enabled
      ?'印刷結果の確認が必要です：{name}。そのレジの操作権を取得して確認してください。'
      :'停止中のレジで印刷結果の確認が必要です：{name}。管理者に確認してください。',{name:s.name})}</p>)}
    <a href={`/store/device-relay?${connectionParams}`}>印刷用スマホを接続・確認する</a>
    {relay.station?.print_enabled?<details><summary>中継印刷状況</summary>
      <p>送信済みは、用紙への印刷完了を保証しません。現物を確認して補打してください。</p>
      {relay.jobs.filter(j=>j.station_id===relay.station?.id).slice(0,25).map(j=><div key={j.id} style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:8}}>
        <span>{j.pickup_code} · {t(({kitchen:'厨房伝票',finishing:'出品伝票',pickup:'お客様番号札',receipt:'レシート',test:'テスト印刷'} as Record<string,string>)[j.documentRole||j.kind]||j.kind)} · {t(({pending:'印刷待ち',sending:'送信中',sent:'送信済み',uncertain:'結果確認が必要',cancelled:'終了'} as Record<string,string>)[j.state]||j.state)} {j.error}
          {j.receiptHasRefund?<small className={styles.refundNote}>{t('返金あり：金額は返金前の元会計です。')}</small>:null}
          {j.voidEligible?<small className={styles.refundNote}>{t('返金・キャンセル済みの内容を含みます。現物を確認して伝票を無効にできます。')}</small>:null}
        </span>
        {['uncertain','sent'].includes(j.state)?<>
          {j.state==='uncertain'?<button type="button" className="secondary-button" disabled={busy} onClick={()=>{if(window.confirm(t('現物の印刷を確認しましたか。')))void act('confirmSent',{jobId:j.id});}}>印刷済みを確認</button>:null}
          {j.reprintEligible!==false?<button type="button" className="secondary-button" disabled={busy} onClick={()=>{if(window.confirm(t('現物を確認しましたか。同じ番号で再印刷します。')))void act('reprint',{jobId:j.id});}}>再印刷</button>:null}
        </>:null}
        {j.voidEligible===true?<button type="button" className="secondary-button" disabled={busy} onClick={()=>{
          if(window.confirm(t('返金・キャンセル済みの伝票を無効にして、次の印刷へ進めます。現物を確認し、印刷済み・遅れて出る伝票を使用しないことを確認しましたか。')))
            void act('voidRefunded',{jobId:j.id,confirmed:true});
        }}>確認して伝票を無効化</button>:null}
      </div>)}
    </details>:null}
    </div>
  </section>;
}
