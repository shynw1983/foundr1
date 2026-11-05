'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,CheckCircle2,Download,RefreshCw,Smartphone} from 'lucide-react';
import type {RelayStation} from '../components/useStoreRelay';
import {getStoredStoreSelection,storeSelectionEventName} from '../components/store-selection';
import {AndScaleSetup} from './AndScaleSetup';
import styles from './page.module.css';

type NativeRelay={start:(token:string)=>string;resume:()=>string;stop:()=>string;status:()=>string;backgroundStatus?:()=>string;openBackgroundSettings?:()=>string};
declare global {interface Window {Foundr1DeviceRelay?:NativeRelay}}
type LocalStatus={known:boolean;running:boolean;message:string};
type BackgroundStatus={automaticResumeEnabled:boolean;hasSavedConnection:boolean;batteryOptimizationExempt:boolean;backgroundRestricted:boolean;manufacturer:string;model:string;sdkInt:number};
type StoreOption={id:string;name:string};

function nativeRelay():NativeRelay|null {
  const bridge=window.Foundr1DeviceRelay;
  return bridge&&['start','resume','stop','status'].every(key=>typeof bridge[key as keyof NativeRelay]==='function')?bridge:null;
}
function nativeResult(value:string,action:'start'|'resume'|'stop') {
  const result=JSON.parse(value) as {ok?:boolean;error?:string};
  if(!result||result.ok!==true)throw new Error(result?.error||(action==='stop'?'中継を停止できません。Store App を開いて再操作してください。':'中継を開始できません。Store App を開いて再操作してください。'));
}
async function readResponse(response:Response) {
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'接続状態を確認できません。再読込してください。');
  return body;
}
function normalizePairingCode(value:string) {
  return value.replace(/[０-９]/g,digit=>String.fromCharCode(digit.charCodeAt(0)-0xfee0)).replace(/[^0-9]/g,'').slice(0,6);
}

export default function DeviceRelayPage() {
  const [ready,setReady]=useState(false),[storeId,setStoreId]=useState(''),[requestedStationId,setRequestedStationId]=useState<string|null>(null);
  const [stores,setStores]=useState<StoreOption[]>([]),[stations,setStations]=useState<RelayStation[]>([]),[stationId,setStationId]=useState('');
  const [loadedStoreId,setLoadedStoreId]=useState(''),[canManage,setCanManage]=useState(false),[loading,setLoading]=useState(false),[serverError,setServerError]=useState('');
  const [serverCheckedAt,setServerCheckedAt]=useState(0);
  const [supported,setSupported]=useState(false),[oldApp,setOldApp]=useState(false),[androidBrowser,setAndroidBrowser]=useState(false);
  const [local,setLocal]=useState<LocalStatus>({known:false,running:false,message:''}),[localError,setLocalError]=useState('');
  const [backgroundAvailable,setBackgroundAvailable]=useState(false),[background,setBackground]=useState<BackgroundStatus|null>(null),[backgroundError,setBackgroundError]=useState(''),[settingsError,setSettingsError]=useState(''),[settingsOpening,setSettingsOpening]=useState(false);
  const [code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[startedHere,setStartedHere]=useState('');
  const mounted=useRef(false),scope=useRef(''),selected=useRef(''),requested=useRef<string|null>(null),operation=useRef(0),busyRef=useRef(false),readId=useRef(0);
  const actionController=useRef<AbortController|null>(null);
  const settingsPending=useRef(false),settingsTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  scope.current=storeId;selected.current=stationId;requested.current=requestedStationId;

  const refreshLocal=useCallback(()=>{
    const bridge=nativeRelay();
    setSupported(Boolean(bridge));
    setOldApp(Boolean((window as Window&{Foundr1Printer?:unknown}).Foundr1Printer)&&!bridge);
    setAndroidBrowser(/Android/i.test(navigator.userAgent));
    if(!bridge){setLocal({known:false,running:false,message:''});setLocalError('');setBackgroundAvailable(false);setBackground(null);setBackgroundError('');setSettingsError('');return;}
    try {
      const status=JSON.parse(bridge.status()) as {running?:unknown;message?:unknown};
      if(!status||typeof status.running!=='boolean')throw new Error('Store App からこの接続ページを開き直してください。');
      setLocal({known:true,running:status.running,message:typeof status.message==='string'?status.message:''});setLocalError('');
    } catch(error) {
      setLocal(current=>({...current,known:false}));
      setLocalError(error instanceof Error?error.message:'このスマホの状態を読み取れません。Store App を開き直してください。');
    }
    const backgroundSupported=typeof bridge.backgroundStatus==='function'&&typeof bridge.openBackgroundSettings==='function';
    setBackgroundAvailable(backgroundSupported);
    if(!backgroundSupported){setBackground(null);setBackgroundError('');setSettingsError('');return;}
    try {
      const status=JSON.parse(bridge.backgroundStatus!()) as BackgroundStatus;
      if(!status||['automaticResumeEnabled','hasSavedConnection','batteryOptimizationExempt','backgroundRestricted'].some(key=>typeof status[key as keyof BackgroundStatus]!=='boolean'))throw new Error('バックグラウンド設定を確認できません。Store App を開き直してください。');
      setBackground(status);setBackgroundError('');
    } catch {
      setBackground(null);
      setBackgroundError('バックグラウンド設定を確認できません。Store App を開き直してください。');
    }
  },[]);

  useEffect(()=>{
    mounted.current=true;
    const readTarget=()=>{
      const params=new URLSearchParams(window.location.search);
      let nextStoreId='';
      if(params.has('storeId'))nextStoreId=(params.get('storeId')||'').trim();
      else {try {nextStoreId=getStoredStoreSelection().trim();}catch { /* A new browser may have no saved store. */ }}
      const nextStationId=params.has('stationId')?(params.get('stationId')||'').trim():null;
      if(nextStoreId!==scope.current||nextStationId!==requested.current){
        operation.current+=1;actionController.current?.abort();busyRef.current=false;
        scope.current=nextStoreId;selected.current='';requested.current=nextStationId;setBusy(false);
      }
      setStoreId(nextStoreId);setRequestedStationId(nextStationId);
      setReady(true);
    };
    readTarget();refreshLocal();
    const timer=window.setInterval(refreshLocal,3000);
    window.addEventListener('focus',refreshLocal);window.addEventListener('popstate',readTarget);window.addEventListener(storeSelectionEventName,readTarget);
    return()=>{mounted.current=false;operation.current+=1;actionController.current?.abort();if(settingsTimer.current)clearTimeout(settingsTimer.current);window.clearInterval(timer);window.removeEventListener('focus',refreshLocal);window.removeEventListener('popstate',readTarget);window.removeEventListener(storeSelectionEventName,readTarget);};
  },[refreshLocal]);

  useEffect(()=>{
    operation.current+=1;actionController.current?.abort();busyRef.current=false;
    setBusy(false);setCode('');setMessage('');setStartedHere('');
  },[storeId,stationId]);

  useEffect(()=>{
    if(!ready)return;
    const controller=new AbortController();
    void fetch(`/api/store/context${storeId?`?storeId=${encodeURIComponent(storeId)}`:''}`,{cache:'no-store',signal:controller.signal})
      .then(readResponse).then(body=>{if(!controller.signal.aborted)setStores(((body.access as {stores?:StoreOption[]}|undefined)?.stores)||[]);})
      .catch(()=>{if(!controller.signal.aborted)setStores([]);});
    return()=>controller.abort();
  },[ready,storeId]);

  const refreshServer=useCallback(async(signal?:AbortSignal)=>{
    if(!storeId)return;
    const request=++readId.current;
    const body=await readResponse(await fetch(`/api/os/stores/device-relay?storeId=${encodeURIComponent(storeId)}`,{cache:'no-store',signal}));
    if(!mounted.current||signal?.aborted||scope.current!==storeId||request!==readId.current)return;
    const next=Array.isArray(body.stations)?body.stations as RelayStation[]:[];
    setStations(next);setCanManage(body.canManage===true);setLoadedStoreId(storeId);setServerError('');setServerCheckedAt(Date.now());
    setStationId(current=>requestedStationId!==null
      ?next.some(station=>station.id===requestedStationId)?requestedStationId:''
      :next.some(station=>station.id===current)?current:next.length===1?next[0].id:'');
  },[storeId,requestedStationId]);

  useEffect(()=>{
    setStations([]);setStationId('');setCanManage(false);setLoadedStoreId('');setServerError('');setServerCheckedAt(0);
    if(!ready||!storeId){setLoading(false);return;}
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,fetching=false;
    const tick=async()=>{
      if(fetching||controller.signal.aborted)return;
      clearTimeout(timer);
      if(document.visibilityState==='hidden'){timer=setTimeout(()=>void tick(),10000);return;}
      fetching=true;
      try {await refreshServer(controller.signal);}
      catch(error){if(!controller.signal.aborted&&scope.current===storeId)setServerError(error instanceof Error?error.message:'接続状態を確認できません。');}
      finally {fetching=false;if(!controller.signal.aborted){setLoading(false);timer=setTimeout(()=>void tick(),10000);}}
    };
    const visible=()=>{if(document.visibilityState==='visible')void tick();};
    document.addEventListener('visibilitychange',visible);
    setLoading(true);void tick();
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[ready,storeId,refreshServer]);

  const station=stations.find(entry=>entry.id===stationId);
  const invalidStation=loadedStoreId===storeId&&requestedStationId!==null&&!stations.some(entry=>entry.id===requestedStationId);
  const storeName=stores.find(entry=>entry.id===storeId)?.name;
  const targetReady=Boolean(storeId&&station&&station.enabled&&loadedStoreId===storeId&&!serverError&&!invalidStation);
  const busyTarget=`${storeId}:${stationId}`;
  const serverFresh=loadedStoreId===storeId&&!serverError&&Date.now()-serverCheckedAt<15000;
  const settingsHref=canManage&&storeId?`/os/stores/devices?storeId=${encodeURIComponent(storeId)}`:'/os/stores/devices';

  function chooseStore(nextStoreId:string) {
    if(!nextStoreId)return;
    operation.current+=1;actionController.current?.abort();busyRef.current=false;
    scope.current=nextStoreId;selected.current='';setBusy(false);
    window.history.replaceState(null,'',`/store/device-relay?storeId=${encodeURIComponent(nextStoreId)}`);
    setRequestedStationId(null);setStoreId(nextStoreId);
  }
  function chooseStation(nextStationId:string) {
    operation.current+=1;actionController.current?.abort();busyRef.current=false;
    selected.current=nextStationId;setBusy(false);
    const params=new URLSearchParams({storeId});
    if(nextStationId)params.set('stationId',nextStationId);
    window.history.replaceState(null,'',`/store/device-relay?${params}`);
    setRequestedStationId(nextStationId||null);setStationId(nextStationId);
  }

  async function connect(automatic:boolean) {
    if(busyRef.current||!targetReady||!station||!nativeRelay()||!local.known)return;
    const target={storeId,stationId:station.id},id=++operation.current,controller=new AbortController();
    busyRef.current=true;actionController.current=controller;setBusy(true);setMessage('');
    const timer=window.setTimeout(()=>controller.abort(),20000);
    const current=()=>mounted.current&&operation.current===id&&scope.current===target.storeId&&selected.current===target.stationId&&!controller.signal.aborted;
    try {
      let pairingCode=code.trim();
      if(automatic){
        // Confirm current permission and pairing state before replacing a phone.
        const fresh=await readResponse(await fetch(`/api/os/stores/device-relay?storeId=${encodeURIComponent(target.storeId)}`,{cache:'no-store',signal:controller.signal}));
        if(!current())return;
        const currentStation=(fresh.stations as RelayStation[]|undefined)?.find(entry=>entry.id===target.stationId);
        if(fresh.canManage!==true||!currentStation?.enabled)throw new Error('接続先の設定が変わりました。管理画面で確認してから再読込してください。');
        const localState=JSON.parse(nativeRelay()!.status()) as {running?:unknown};
        if(typeof localState.running!=='boolean')throw new Error('このスマホの状態を確認できません。Store App を開き直してください。');
        if((currentStation.device_paired||localState.running===true)&&!window.confirm('このレジの接続を、このスマホに切り替えます。以前のスマホは中継できなくなります。実行中の印刷は用紙で結果を確認してください。続けますか。'))return;
        if(!current())return;
        const issued=await readResponse(await fetch('/api/os/stores/device-relay',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'pair',...target})}));
        if(!current())return;
        pairingCode=typeof issued.pairingCode==='string'?issued.pairingCode:'';
      } else if(local.running&&!window.confirm('このスマホの保存済みの接続を変更します。接続コードの対象レジと印刷結果を確認してから続けてください。'))return;
      if(!/^[0-9]{6}$/.test(pairingCode))throw new Error('接続コードは6桁の数字で入力してください。');
      if(!current())return;
      const paired=await readResponse(await fetch('/api/store/device-relay',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'pair',...target,code:pairingCode})}));
      if(!current())return;
      if(String(paired.stationId)!==target.stationId)throw new Error('このコードは選択中のレジのものではありません。管理画面で接続先を確認してください。');
      if(typeof paired.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(paired.token))throw new Error('接続を開始できません。新しい接続コードでやり直してください。');
      const bridge=nativeRelay();if(!bridge)throw new Error('対応する Store App から開き直してください。');
      nativeResult(bridge.start(paired.token),'start');
      setStartedHere(`${target.storeId}:${target.stationId}`);setCode('');
      setMessage('このスマホで中継の開始を受け付けました。下の状態を確認してください。');
      refreshLocal();void refreshServer().catch(()=>{});
    } catch(error) {
      if(mounted.current&&operation.current===id)setMessage(controller.signal.aborted?'接続を完了できませんでした。接続先と印刷結果を確認してから再操作してください。':error instanceof Error?error.message:'接続を開始できません。');
    } finally {
      window.clearTimeout(timer);
      if(operation.current===id){busyRef.current=false;actionController.current=null;if(mounted.current)setBusy(false);}
    }
  }

  function controlLocal(action:'resume'|'stop') {
    if(busyRef.current)return;
    const bridge=nativeRelay();if(!bridge)return;
    if(action==='stop'&&!window.confirm('このスマホの中継を停止しますか。印刷中の場合は用紙で結果を確認してください。'))return;
    busyRef.current=true;setBusy(true);setMessage('');
    try {
      nativeResult(action==='resume'?bridge.resume():bridge.stop(),action);
      setStartedHere('');refreshLocal();
      setMessage(action==='resume'?'保存済みの接続で再開を受け付けました。お店側の通信も確認してください。':'中継の停止を受け付けました。このスマホの状態を確認してください。');
    } catch(error) {setMessage(error instanceof Error?error.message:'このスマホの操作を完了できません。Store App を開き直してください。');refreshLocal();}
    finally {busyRef.current=false;setBusy(false);}
  }

  function openBackgroundSettings() {
    const bridge=nativeRelay();
    if(busyRef.current||settingsPending.current||!local.known||!background||typeof bridge?.openBackgroundSettings!=='function')return;
    settingsPending.current=true;setSettingsOpening(true);setSettingsError('');
    try {
      const result=JSON.parse(bridge.openBackgroundSettings()) as {ok?:boolean;error?:string};
      if(result?.ok!==true)throw new Error(result?.error||'Android の設定画面を開けません。Store App のアプリ情報から電池の設定を確認してください。');
    } catch(error) {setSettingsError(error instanceof Error&&!(error instanceof SyntaxError)?error.message:'Android の設定画面を開けません。Store App のアプリ情報から電池の設定を確認してください。');}
    finally {
      settingsTimer.current=setTimeout(()=>{settingsPending.current=false;if(mounted.current)setSettingsOpening(false);},1500);
    }
  }

  return <main className={`store-shell ${styles.page}`}>
    <header className={styles.header}>
      <a className={styles.back} href={canManage?settingsHref:'/store'}><ArrowLeft size={17}/>{canManage?'設備設定に戻る':'Store ホームへ'}</a>
      <h1>スマホで印刷・計量を中継</h1>
      <p>この Android スマホを、お店のプリンターと電子はかりにつなぎます。iPad などで受け付けた会計の印刷や、重量の受け取りに使います。</p>
    </header>
    {!ready?<p role="status">読み込み中...</p>:null}
    {ready&&!storeId?<section className={`panel ${styles.section}`}>
      <h2>店舗を選んでください</h2><p>管理画面の設備設定から接続ページを開くか、対象店舗を選択してください。</p>
      {stores.length?<label>対象店舗<select aria-label="接続する店舗" value="" onChange={event=>chooseStore(event.target.value)}><option value="">店舗を選択</option>{stores.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>:null}
      <a href="/os/stores/devices">管理画面で店舗を選ぶ</a>
    </section>:null}
    {ready&&!supported?<section className={`panel ${styles.section}`} aria-label="Store App の確認">
      <div className={styles.title}><Smartphone size={22}/><h2>{oldApp?'Store App を更新してください':'Android Store App で開いてください'}</h2></div>
      <p>{oldApp?'この Store App には中継機能がありません。最新版をインストールして、App からこの接続ページを開き直してください。':androidBrowser?'この画面で中継機能を確認できません。Android のブラウザからは中継サービスを開始できないため、最新版の Store App をインストールして App の設備設定から開いてください。':'この画面で中継機能を確認できません。中継に使う Android スマホの Store App で開いてください。iPad や通常のブラウザでは中継サービスを開始できません。'}</p>
      <a className={`primary-button ${styles.download}`} href="/downloads/foundr1-store-latest.apk"><Download size={18}/>Android Store App をダウンロード</a>
      <p className={styles.help}>インストール後は Store App にログインし、同じ店舗の「設備中継」から接続してください。</p>
    </section>:null}
    {storeId?<section className={`panel ${styles.section}`}>
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>接続先</span><h2>{storeName||'選択中の店舗'}</h2></div><button type="button" className="secondary-button" disabled={loading||busy} onClick={()=>void refreshServer().catch(error=>setServerError(error.message))}><RefreshCw size={16}/>状態を更新</button></div>
      {loading?<p role="status">接続先を確認中...</p>:null}
      {serverError?<p className={styles.warning} role="alert">{serverError} <a href={settingsHref}>設備設定で確認</a></p>:null}
      {invalidStation?<p className={styles.warning} role="alert">指定されたレジがこの店舗に見つかりません。別のレジには接続しません。<a href={settingsHref}>設備設定から開き直してください。</a></p>:null}
      {!loading&&loadedStoreId===storeId&&!stations.length?<p>中継の接続先がありません。管理画面の設備設定で作成・保存してください。</p>:null}
      {stations.length>1&&!invalidStation?<label>接続先を選択<select aria-label="接続先のレジ" value={stationId} disabled={busy} onChange={event=>chooseStation(event.target.value)}><option value="">レジを選択</option>{stations.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>:null}
      {station&&!station.enabled?<p className={styles.warning}>この接続先の中継はオフです。管理画面で設定を保存してから接続してください。<a href={settingsHref}>設備設定を開く</a></p>:null}
      {station?<>
        <div className={styles.serverStatus} data-online={serverFresh&&station.device_online===true}>
          {serverFresh&&station.device_online?<CheckCircle2 size={18}/>:<Smartphone size={18}/>}<div><strong>お店側の通信：{!serverFresh?'確認できません':station.device_online?'オンライン':'オフライン'}</strong><p>{serverFresh&&station.device_online?'お店に接続済みのスマホから、新しい通信を確認しています。':'お店に接続済みのスマホから、新しい通信を確認できていません。'}</p></div>
        </div>
        {supported&&canManage&&!local.running?<button type="button" className={`primary-button ${styles.start}`} disabled={!targetReady||busy||!local.known} onClick={()=>void connect(true)}><Smartphone size={21}/>{busy?'接続を確認中...':'このスマホで中継を開始'}</button>:null}
        {supported&&!canManage?<p className={styles.help}>管理者が発行した接続コードで接続できます。</p>:null}
        <details className={styles.details}><summary>接続先と利用機能を確認</summary><dl className={styles.info}><div><dt>レジ</dt><dd>{station.name}</dd></div><div><dt>中継印刷</dt><dd>{station.print_enabled?'オン':'オフ'}</dd></div><div><dt>電子はかり</dt><dd>{station.scale_enabled?'オン':'オフ'}</dd></div><div><dt>店舗 ID</dt><dd>{storeId}</dd></div></dl></details>
      </>:null}
    </section>:null}
    {supported?<section className={`panel ${styles.section}`} aria-label="このスマホの状態">
      <div className={styles.title}><Smartphone size={22}/><h2>このスマホのサービス</h2></div>
      <p className={styles.localState}>{local.known?local.running?'中継サービス起動中':'中継サービス停止中':'中継サービスの状態を確認できません'}</p>
      {localError?<p className={styles.warning} role="alert">{localError}</p>:null}
      {local.running?<p className={styles.help}>{startedHere===busyTarget?'この接続先で開始操作済みです。印刷結果は用紙で確認してください。':'印刷結果は用紙で確認してください。'}</p>:null}
      <div className={styles.actions}>
        <button type="button" className="secondary-button" disabled={busy||!local.known||(local.running&&!(background?.hasSavedConnection&&!background.automaticResumeEnabled))} onClick={()=>controlLocal('resume')}>保存済みの接続を再開</button>
        <button type="button" className="secondary-button" disabled={busy||!local.known||!local.running} onClick={()=>controlLocal('stop')}>このスマホの中継を停止</button>
      </div>
      <div className={styles.background} aria-label="バックグラウンドでの中継">
        <h3>画面を閉じた後の中継</h3>
        {!backgroundAvailable?<><p className={styles.help}>自動復帰に対応した Store App へ更新してください。現在の中継操作は引き続き利用できます。</p><a href="/downloads/foundr1-store-latest.apk">最新版の Store App をダウンロード</a></>:background?<>
          <p className={styles.backgroundState}>{!background.hasSavedConnection?'接続情報が保存されていません。':background.automaticResumeEnabled?'自動復帰を設定済み':'自動復帰はオフ'}</p>
          <p className={styles.help}>{!background.hasSavedConnection?'先に、このスマホをお店につないでください。':background.automaticResumeEnabled?'スマホの再起動後などに、保存済みの接続で中継を再開します。':'「保存済みの接続を再開」を一度押すと、次回からの自動復帰を設定できます。'}</p>
          <p className={styles.help}>{background.backgroundRestricted?'バックグラウンド動作が制限されています。':background.batteryOptimizationExempt?'電池の最適化の対象外です。':'電池の最適化が有効です。画面を閉じると中継が止まることがあります。'}</p>
          {!background.batteryOptimizationExempt||background.backgroundRestricted?<button type="button" className="secondary-button" disabled={busy||settingsOpening||!local.known} onClick={openBackgroundSettings}>バックグラウンドでの実行を許可</button>:null}
          <p className={styles.help}>端末の省電力設定で中継が止まる場合があります。機種に設定がある場合は自動起動も許可してください。強制停止した後は Store App を開いてください。</p>
        </>:null}
        {backgroundError||settingsError?<p className={styles.warning} role="alert">{backgroundError||settingsError}</p>:null}
      </div>
      {canManage&&local.running&&station?<button type="button" className="secondary-button" disabled={busy||!targetReady} onClick={()=>void connect(true)}>このスマホに接続し直す</button>:null}
      <p className={styles.help}>保存済みの接続を再開しても、新しい接続先への変更や再登録は行いません。</p>
      <details className={styles.details}><summary>詳しいサービス状態</summary>
        <p className={styles.help}>起動中という表示だけでは、選択中の店舗・レジにつながっていると判断できません。保存済みの接続先は、この画面から特定できません。</p>
        {local.message?<p className={styles.serviceMessage}>{local.message}</p>:null}
      </details>
    </section>:null}
    {supported&&storeId&&station?<details className={`panel ${styles.section} ${styles.details}`} open={!canManage}>
      <summary>接続コードで設定する</summary>
      <p id="pairing-code-help">管理者が発行した、このレジの6桁の接続コードを入力します。コードの有効期限は10分です。</p>
      <label>接続コード<input className={styles.pairingInput} type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="123456" aria-label="接続コード" aria-describedby="pairing-code-help" value={code} disabled={busy} onChange={event=>setCode(normalizePairingCode(event.target.value))} onPaste={event=>{event.preventDefault();const input=event.currentTarget;setCode(normalizePairingCode(code.slice(0,input.selectionStart??0)+event.clipboardData.getData('text')+code.slice(input.selectionEnd??code.length)));}} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false}/></label>
      <button type="button" className="secondary-button" disabled={!targetReady||busy||!local.known||!/^[0-9]{6}$/.test(code)} onClick={()=>void connect(false)}>接続コードで開始</button>
    </details>:null}
    {station&&supported?<AndScaleSetup key={`${storeId}:${stationId}`} enabled={targetReady&&station.scale_enabled} storeId={storeId} stationId={stationId} scopeKey={`${storeId}:${stationId}`}/>:null}
    {message?<p className={styles.notice} role="status">{message}</p>:null}
    <footer className={styles.footer}><p>印刷結果は用紙で確認してください。電子はかりは、利用前にはかりの表示と POS の重量が一致することを確認してください。</p><a href="/store">Store ホームへ</a></footer>
  </main>;
}
