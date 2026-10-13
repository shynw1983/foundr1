"use client";

import { useEffect, useRef, useState } from "react";
import { inventoryPreviewExpired } from "../../../lib/inventory-preview";
import {InventoryComparisonPreview,type InventoryComparison} from './InventoryComparisonPreview';
import {InventoryReadProgress,type InventoryRead} from './InventoryReadProgress';

type InventoryConflict = {kind:string;targetId:string;label:string;reason:string;platform?:string};
type Report = { id:string; status:string; reads?:InventoryRead[]; details:{comparison?:InventoryComparison;authority?:string;referencePlatform?:string;previewRevision?:string;referenceConflicts?:InventoryConflict[];previousWriteConflictsUnavailable?:boolean;previousWriteConflicts?:Array<{kind:string;targetId:string;label:string;isAvailable:boolean;successfulPlatforms:string[]}>;osApplied?:boolean;targetCount?:number;previewAt?:string;preview?:Array<{label:string;isAvailable:boolean;wasAvailable:boolean|null}>;excluded?:Array<{label:string}>}; platforms:Array<{platform:string;succeeded:number;total:number;failed:number;timedOut:number}> };
async function inventoryMutationRequest(url:string,body:Record<string,unknown>,controller:AbortController) {
  const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const result=await response.json();
    return {response,body:result};
  } finally {clearTimeout(timeout);}
}
export function inventorySyncErrorMessage(error:unknown,language:string) {
  const message=error instanceof Error?error.message:String(error);
  const messages:Record<string,[string,string,string]>={
    'Unauthorized':['ログインし直してから、進捗を再取得してください。','请重新登录后获取进度。','請重新登入後取得進度。'],
    'ログインしてください。':['ログインし直してから、進捗を再取得してください。','请重新登录后获取进度。','請重新登入後取得進度。'],
    '権限がありません。':['この店舗を操作する権限がありません。店舗・ログインを確認してください。','没有操作此门店的权限，请确认门店与登录账号。','沒有操作此門店的權限，請確認門店與登入帳號。'],
    '販売状態の基準プラットフォームが無効です。':['今回の基準を選び直してください。','请选择有效的本次依据。','請選擇有效的本次依據。'],
    '今回の基準とプレビューを確認してください。全プラットフォームを再読み取りしてください。':['今回の基準とプレビューを確認し、全プラットフォームを再読み取りしてください。','本次依据或预览无效，请重新读取所有平台。','本次依據或預覽無效，請重新讀取所有平台。'],
    'プレビューの有効期限（10分）が切れたか、適用済みです。再読み取りしてください。':['プレビューが期限切れ、または適用済みです。全プラットフォームを再読み取りしてください。','预览已过期或已应用，请重新读取所有平台。','預覽已過期或已套用，請重新讀取所有平台。'],
    'プレビューが変更されました。最新の内容を確認してください。':['プレビューが更新されました。進捗を再取得し、差分を確認してください。','预览已更新，请重新获取进度并确认差异。','預覽已更新，請重新取得進度並確認差異。'],
    '基準またはプレビューが変更されました。最新の内容を確認してください。':['基準またはプレビューが更新されました。進捗を再取得し、差分を確認してください。','本次依据或预览已更新，请重新获取进度并确认差异。','本次依據或預覽已更新，請重新取得進度並確認差異。'],
    '各プラットフォームの状態が未確認、または基準にできる商品がありません。再読み取りしてください。':['状態が未確認、または基準にできる項目がありません。全プラットフォームを再読み取りしてください。','状态尚未确认，或没有可依据的项目，请重新读取所有平台。','狀態尚未確認，或沒有可依據的項目，請重新讀取所有平台。'],
    '在庫保護・プラットフォーム別設定と競合しています。解除する対象を確認してください。':['店舗の在庫保護・個別設定と競合しています。対象を確認し、上書きの確認にチェックしてください。','与门店库存保护或平台单独设置冲突，请核对项目后勾选覆盖确认。','與門店庫存保護或平台單獨設定衝突，請核對項目後勾選覆蓋確認。'],
    '基準プラットフォームの全商品対応・販売状態を確認できません。再読み取りしてください。':['基準プラットフォームの商品対応・販売状態が未確認です。全プラットフォームを再読み取りしてください。','无法完整确认依据平台的对应关系或销售状态，请重新读取所有平台。','無法完整確認依據平台的對應關係或銷售狀態，請重新讀取所有平台。'],
    '読取後に販売状態が変更されたか、別の同期が実行中です。完了後に再読み取りしてください。':['読取後に状態が変わったか、別の同期が実行中です。処理の完了後に全プラットフォームを再読み取りしてください。','读取后状态已变化或有其他同步正在执行，请等待完成后重新读取所有平台。','讀取後狀態已變化或有其他同步正在執行，請等待完成後重新讀取所有平台。'],
    '商品対応が読取後に変更されました。再読み取りしてください。':['商品対応が読取後に変更されました。全プラットフォームを再読み取りしてください。','读取后商品对应关系已变化，请重新读取所有平台。','讀取後商品對應關係已變化，請重新讀取所有平台。'],
    '基準プラットフォームの読取結果が古いか不明です。全プラットフォームを再読み取りしてください。':['基準プラットフォームの読取結果が古いか未確認です。全プラットフォームを再読み取りしてください。','依据平台的读取结果已过期或未确认，请重新读取所有平台。','依據平台的讀取結果已過期或未確認，請重新讀取所有平台。'],
    '読取結果が変更されました。最新の内容を確認してください。':['読取結果が変更されました。全プラットフォームを再読み取りしてください。','读取结果已变化，请重新读取所有平台。','讀取結果已變化，請重新讀取所有平台。'],
    '基準プラットフォームの連携設定が変更されました。再読み取りしてください。':['基準プラットフォームの連携設定が変わりました。全プラットフォームを再読み取りしてください。','依据平台的连接设置已变化，请重新读取所有平台。','依據平台的連線設定已變化，請重新讀取所有平台。'],
    '各プラットフォームの状態が未確認です。全プラットフォームを再読み取りしてください。':['各プラットフォームの状態が未確認です。全プラットフォームを再読み取りしてください。','平台状态尚未确认，请重新读取所有平台。','平台狀態尚未確認，請重新讀取所有平台。']
  };
  const translated=messages[message]??['操作結果を確認できません。進捗を再取得し、最新の状態を確認してください。','无法确认操作结果，请重新获取进度并核对最新状态。','無法確認操作結果，請重新取得進度並核對最新狀態。'];
  return translated[language==='zh-Hans'?1:language==='zh-Hant'?2:0];
}
export function WholeStoreAvailabilitySync({storeId,language,disabled,onApplied}:{storeId:string;language:string;disabled:boolean;onApplied:()=>void}) {
  const zh=language==='zh-Hans', hant=language==='zh-Hant';
  const label=(ja:string,cn:string,tw=cn)=>zh?cn:hant?tw:ja;
  const [storedReport,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [refreshFailed,setRefreshFailed]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const [awaitingPreview,setAwaitingPreview]=useState(false);
  const [acknowledgedPreview,setAcknowledgedPreview]=useState<string|null>(null);
  const [now,setNow]=useState(()=>Date.now());
  const storeScope=useRef(storeId);
  const loadedStore=useRef(storeId);
  const requestEpoch=useRef(0);
  const mutationBusy=useRef(false);
  const mutationControllers=useRef(new Set<AbortController>());
  const expectedPreview=useRef<{runId:string;referencePlatform:string;previewRevision?:string}|null>(null);
  // Invalidate old-store responses immediately, before effects run.
  if(storeScope.current!==storeId){storeScope.current=storeId;requestEpoch.current++;mutationBusy.current=false;expectedPreview.current=null;}
  const report=loadedStore.current===storeId?storedReport:null;
  const reportRef=useRef(report);
  reportRef.current=report;
  const names:Record<string,string>={uber_eats:'Uber',rocket_now:label('Rocket Now','火箭','火箭'),demae_can:label('出前館','出前馆','出前館'),foundr1:'OS'};
  const referencePlatform=report?.details.referencePlatform??'uber_eats';
  const previewKey=`${storeId}:${report?.id??''}:${referencePlatform}:${report?.details.previewRevision??''}`;
  const comparison=report?.details.comparison;
  const previewMatches=!!report?.details.previewRevision&&comparison?.referencePlatform===referencePlatform&&!awaitingPreview;
  const conflicts=report?.details.referenceConflicts??[];
  const acknowledged=acknowledgedPreview===previewKey;
  const readPending=report?.reads?.some(r=>['queued','pending','processing'].includes(r.status))||comparison?.pending;
  const changeCount=comparison?.rows.filter(row=>row.changes.length>0).length??0;
  async function postInventory(url:string,body:Record<string,unknown>) {
    const controller=new AbortController();mutationControllers.current.add(controller);
    try{return await inventoryMutationRequest(url,body,controller);}
    finally{mutationControllers.current.delete(controller);}
  }
  function acceptReport(next:Report|null) {
    const expected=expectedPreview.current;
    if(expected&&(!next||next.id!==expected.runId||(expected.previewRevision&&
      (next.details.previewRevision!==expected.previewRevision||next.details.referencePlatform!==expected.referencePlatform||next.details.comparison?.referencePlatform!==expected.referencePlatform))))return false;
    loadedStore.current=storeId;reportRef.current=next;setReport(next);
    expectedPreview.current=null;setAwaitingPreview(false);
    return true;
  }
  function requestCurrent(epoch:number,runId?:string) {
    return storeScope.current===storeId&&requestEpoch.current===epoch&&(!runId||reportRef.current?.id===runId);
  }
  useEffect(()=>{
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[]);
  const expired=inventoryPreviewExpired(report?.details.previewAt,now);
  const applied=useRef('');
  const onAppliedRef=useRef(onApplied);
  useEffect(()=>{onAppliedRef.current=onApplied;},[onApplied]);
  useEffect(()=>{
    if(report?.details.osApplied&&applied.current!==report.id){applied.current=report.id;onAppliedRef.current();}
  },[report]);
  useEffect(()=>{
    setReport(null);
    setRefreshFailed(false);
    setError('');
    setBusy(false);setAwaitingPreview(false);setAcknowledgedPreview(null);
    return()=>{
      requestEpoch.current++;
      for(const controller of mutationControllers.current)controller.abort();
      mutationControllers.current.clear();
    };
  },[storeId]);
  useEffect(()=>setAcknowledgedPreview(null),[previewKey]);
  useEffect(()=>{
    let cancelled=false;
    let pending=false;
    let controller:AbortController|null=null;
    const refresh=async()=>{
      if(!storeId||pending||mutationBusy.current)return;
      const epoch=requestEpoch.current;
      pending=true;
      setRefreshing(true);
      controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),15000);
      try {
        const response=await fetch(`/api/store/inventory-history?storeId=${encodeURIComponent(storeId)}&days=30&scope=latest_full_sync`,{cache:'no-store',signal:controller.signal});
        if(!response.ok){
          const body=await response.json().catch(()=>null);
          throw new Error(body?.error||(response.status===401?'Unauthorized':response.status===403?'権限がありません。':'progress_unavailable'));
        }
        const body=await response.json();
        if(!Array.isArray(body.reports))throw new Error('invalid_progress');
        if(!cancelled&&requestCurrent(epoch)){
          const accepted=acceptReport(body.reports.find((r:Report)=>r.details.authority==='uber_eats')??null);
          setRefreshFailed(!accepted);
          if(!accepted){
            setAwaitingPreview(false);
            setError(inventorySyncErrorMessage(new Error('基準またはプレビューが変更されました。最新の内容を確認してください。'),language));
          }
        }
      } catch(e) {
        // Preserve verified progress and show that it is stale. Retrying this
        // request only reads status; it never starts another synchronization.
        if(!cancelled&&requestCurrent(epoch)){
          setRefreshFailed(true);
          if(e instanceof Error&&e.message!=='progress_unavailable')setError(inventorySyncErrorMessage(e,language));
        }
      } finally {
        clearTimeout(timeout);
        pending=false;
        if(!cancelled&&requestCurrent(epoch))setRefreshing(false);
      }
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),5000);
    return()=>{cancelled=true;clearInterval(timer);controller?.abort();};
  },[storeId,refreshKey]);
  async function start() {
    if(mutationBusy.current)return;
    const epoch=++requestEpoch.current;mutationBusy.current=true;
    expectedPreview.current=null;setAwaitingPreview(false);setAcknowledgedPreview(null);
    setBusy(true);setError('');
    try {
      const {response,body}=await postInventory('/api/store/display/kitchen/inventory',{action:'full_sync',storeId});
      if(!response.ok)throw new Error(body.error);
      if(!requestCurrent(epoch))return;
      if(typeof body.runId!=='string'||!body.runId)throw new Error(label('開始結果を確認できません。進捗を再取得してください。','无法确认读取是否已开始，请重新获取进度。','無法確認讀取是否已開始，請重新取得進度。'));
      loadedStore.current=storeId;
      const next:Report={id:body.runId,status:'processing',details:{authority:'uber_eats',referencePlatform:'uber_eats',osApplied:false,targetCount:body.targetCount,excluded:body.excluded},platforms:[]};
      reportRef.current=next;setReport(next);expectedPreview.current={runId:body.runId,referencePlatform:'uber_eats'};
      setRefreshKey(key=>key+1);
    } catch(e){if(requestCurrent(epoch)){setError(inventorySyncErrorMessage(e,language));setRefreshFailed(true);setRefreshKey(key=>key+1);}}
    finally{if(requestCurrent(epoch)){mutationBusy.current=false;setBusy(false);}}
  }
  async function changeReference(nextPlatform:string) {
    if(!report||mutationBusy.current||disabled||report.details.osApplied||expired||readPending||!report.details.previewRevision||
      !comparison?.referenceOptions.some(option=>option.platform===nextPlatform&&option.enabled)||nextPlatform===referencePlatform)return;
    const runId=report.id,epoch=++requestEpoch.current;
    let completionEpoch=epoch;
    mutationBusy.current=true;setBusy(true);setAwaitingPreview(true);setAcknowledgedPreview(null);setError('');
    try {
      const {response,body}=await postInventory('/api/store/display/kitchen/inventory',{action:'set_full_sync_reference',storeId,runId,referencePlatform:nextPlatform,previewRevision:report.details.previewRevision});
      if(!response.ok)throw new Error(body.error||label('基準を変更できません。状態を再読み取りしてください。','无法调整本次依据，请重新读取状态。','無法調整本次依據，請重新讀取狀態。'));
      if(!requestCurrent(epoch,runId))return;
      if(body.referencePlatform!==nextPlatform||typeof body.previewRevision!=='string'||!body.previewRevision)throw new Error(label('新しい比較を確認できません。進捗を再取得してください。','无法确认新的预览，请重新获取进度。','無法確認新的預覽，請重新取得進度。'));
      // The acknowledgement proves a new token, not its conflict list. Obtain
      // the complete server report before enabling confirmation.
      expectedPreview.current={runId,referencePlatform:nextPlatform,previewRevision:body.previewRevision};
      const next={...report,details:{...report.details,referencePlatform:nextPlatform,previewRevision:body.previewRevision,comparison:undefined,referenceConflicts:undefined}};
      reportRef.current=next;setReport(next);
      completionEpoch=++requestEpoch.current;setRefreshKey(key=>key+1);
    } catch(e){if(requestCurrent(epoch,runId)){setError(inventorySyncErrorMessage(e,language));setRefreshFailed(true);setRefreshKey(key=>key+1);}}
    finally{if(requestCurrent(completionEpoch,runId)){mutationBusy.current=false;setBusy(false);}}
  }
  async function confirm() {
    if(!report||mutationBusy.current||disabled||refreshFailed||!previewMatches||!comparison?.ready||readPending||report.details.osApplied||conflicts.length>0&&!acknowledged)return;
    if(inventoryPreviewExpired(report?.details.previewAt,Date.now())) {
      setError(label('プレビューの有効期限が切れました。全プラットフォームを再読み取りしてください。','预览已过期，请重新读取所有平台。','預覽已過期，請重新讀取所有平台。'));return;
    }
    const referenceName=names[referencePlatform];
    if(!window.confirm(label(`表示した ${referenceName} の状態で OS と他の連携先を揃えます。個別設定を解除し、売切商品の販売再開や表示された新品の公開を行う場合があります。実行しますか？`,`将按显示的${referenceName}状态校正 OS 和其他平台，清除受影响项目的单独设置，可能恢复缺货商品销售或上架预览中列出的新品。确认执行？`,`將按顯示的${referenceName}狀態校正 OS 和其他平台，清除受影響項目的單獨設定，可能恢復缺貨商品銷售或上架預覽中列出的新品。確認執行？`)))return;
    const runId=report.id,epoch=++requestEpoch.current;mutationBusy.current=true;
    setBusy(true);setError('');
    try {
      const {response,body}=await postInventory('/api/store/display/kitchen/inventory',{action:'confirm_full_sync',runId,storeId,referencePlatform,previewRevision:report.details.previewRevision,acknowledgeInventoryConflicts:acknowledged});
      if(!response.ok)throw new Error(body.error);
      if(!requestCurrent(epoch,runId))return;
      const next={...report,status:'processing',details:{...report.details,osApplied:true}};
      reportRef.current=next;setReport(next);
      setRefreshKey(key=>key+1);
    }catch(e){if(requestCurrent(epoch,runId)){setError(inventorySyncErrorMessage(e,language));setRefreshFailed(true);setRefreshKey(key=>key+1);}}
    finally{if(requestCurrent(epoch,runId)){mutationBusy.current=false;setBusy(false);}}
  }
  async function retryRead(commandId:string) {
    if(!report||mutationBusy.current)return;
    const runId=report.id,epoch=++requestEpoch.current;mutationBusy.current=true;
    expectedPreview.current=null;setAcknowledgedPreview(null);
    setBusy(true);setError('');
    try {
      const {response}=await postInventory('/api/store/menu-sync-runs/retry',{action:'retry_read',storeId,commandId});
      if(!response.ok)throw new Error(label('再読み取りできません。他の処理の完了後、全プラットフォームを読み直してください。','暂时无法重读，请等待其他任务完成后重新读取所有平台。','暫時無法重讀，請等待其他工作完成後重新讀取所有平台。'));
      if(!requestCurrent(epoch,runId))return;
      const next={...report,details:{...report.details,comparison:comparison?{...comparison,pending:true,ready:false}:undefined},reads:report.reads?.map(r=>r.id===commandId?{...r,status:'queued',error:''}:r)};
      reportRef.current=next;setReport(next);
      setRefreshKey(key=>key+1);
    } catch(e){if(requestCurrent(epoch,runId)){setError(inventorySyncErrorMessage(e,language));setRefreshFailed(true);setRefreshKey(key=>key+1);}}
    finally{if(requestCurrent(epoch,runId)){mutationBusy.current=false;setBusy(false);}}
  }
  return <details className="panel inventory-calibration-panel" data-i18n-ignore>
    <summary>{label('販売状態をまとめて同期','批量同步销售状态','批次同步銷售狀態')}</summary>
    <div className="store-menu-head">
      <div>
        <h3>{label('販売状態を揃える','校正销售状态','校正銷售狀態')}</h3>
        <p>{label('通常は Uber が基準です。読み取り後、今回だけ変更できます。','默认以 Uber 为准，读取后可调整本次依据。','預設以 Uber 為準，讀取後可調整本次依據。')}</p>
      </div>
      <button type="button" className={report?.status==='awaiting_confirmation'&&!expired?'secondary-button':'primary-button'} disabled={disabled||busy||refreshFailed||(!report&&refreshing)||!storeId||report?.status==='processing'||report?.details.comparison?.pending} onClick={()=>void start()}>
        {busy?label('送信中…','正在提交…'):report?.status==='processing'?label('読取／同期中…','读取／同步中…','讀取／同步中…'):label('状態を読み取る','读取状态','讀取狀態')}
      </button>
    </div>
    {refreshFailed&&<div className="inventory-progress-refresh-error" role="alert">
      <p>{label('進捗を更新できません。自動で再取得しています。','进度更新失败，正在自动重试。','進度更新失敗，正在自動重試。')}</p>
      <button className="secondary-button" type="button" disabled={refreshing||busy} onClick={()=>{expectedPreview.current=null;requestEpoch.current++;setError('');setAcknowledgedPreview(null);setRefreshKey(key=>key+1);}}>{label('進捗を再取得','重新获取进度','重新取得進度')}</button>
    </div>}
    {report&&!report.details.osApplied&&!!report.reads?.length&&<InventoryReadProgress
      reads={report.reads} language={language} counts={report.details.comparison?.counts??{}}
      confirmedByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>['available','sold_out'].includes(r.cells[p]?.state)).length??0]))}
      stagedByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>r.cells[p]?.state==='staged').length??0]))}
      unknownByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>r.cells[p]?.state==='unknown').length??0]))}
      onRetry={id=>void retryRead(id)} disabled={disabled||busy||report.reads.some(r=>['queued','pending','processing'].includes(r.status))||Boolean(report.details.previewAt&&expired)}
    />}
    {report&&!report.details.osApplied&&(comparison||awaitingPreview||['awaiting_confirmation','expired'].includes(report.status))&&<div>
      <div className="inventory-reference-control">
        <label>{label('今回の基準','本次依据','本次依據')}
          <select aria-label={label('今回の基準','本次依据','本次依據')} value={referencePlatform} disabled={busy||disabled||refreshFailed||expired||readPending||awaitingPreview||!report.details.previewRevision} onChange={e=>void changeReference(e.target.value)}>
            {(comparison?.referenceOptions??[{platform:referencePlatform,enabled:false}]).map(option=><option key={option.platform} value={option.platform} disabled={!option.enabled}>{names[option.platform]??option.platform}{!option.enabled?label('（未確認）','（未确认）','（未確認）'):''}</option>)}
          </select>
        </label>
        <small>{label('今回のみ。名称・価格・通常の基準は変更しません。','仅本次；名称、价格和默认依据不变。','僅本次；名稱、價格和預設依據不變。')}</small>
      </div>
      {!!comparison?.referenceOptions.some(option=>!option.enabled)&&<p className="inventory-reference-unavailable">{comparison.referenceOptions.filter(option=>!option.enabled).map(option=>`${names[option.platform]}：${option.reason==='not_connected'?label('未接続','未连接','未連線'):option.reason==='reading'?label('読取中','读取中','讀取中'):option.reason==='read_failed'?label('全体の比較が未確認・再読み取りしてください','完整状态对照尚未确认，请重读','完整狀態對照尚未確認，請重讀'):label('基準にできる状態が未確認','尚无可依据的已确认状态','尚無可依據的已確認狀態')}`).join(' · ')}</p>}
      {report.details.previousWriteConflictsUnavailable&&<p className="inventory-reference-warning">{label('前回の変更履歴を確認できません。今回の比較で状態を確認してください。','暂时无法核对上次修改记录，请以本次读取的状态对照为准。','暫時無法核對上次修改紀錄，請以本次讀取的狀態對照為準。')}</p>}
      {!!report.details.previousWriteConflicts?.length&&<details className="inventory-reference-warning"><summary>{label('前回の変更は一部のプラットフォームだけに反映されています。','上次修改仅在部分平台成功，请核对本次依据。','上次修改僅在部分平台成功，請核對本次依據。')} ({report.details.previousWriteConflicts.length})</summary><ul>{report.details.previousWriteConflicts.map(conflict=><li key={`${conflict.kind}:${conflict.targetId}`}>{conflict.label} · {conflict.successfulPlatforms.map(platform=>names[platform]??platform).join('、')} · {conflict.isAvailable?label('販売再開','恢复销售','恢復銷售'):label('売切','缺货','缺貨')}</li>)}</ul></details>}
      {awaitingPreview?<p role="status" className="inventory-state-tag is-info">{label('新しい比較を確認中…まだ変更していません。','正在更新预览，尚未修改销售状态。','正在更新預覽，尚未修改銷售狀態。')}</p>:comparison?<InventoryComparisonPreview key={previewKey} comparison={comparison} language={language}/>:<p>{label('旧プレビューです。全プラットフォームを再読み取りしてください。','旧预览不包含其他平台状态，请重新读取所有平台。','舊預覽不包含其他平台狀態，請重新讀取所有平台。')}</p>}
      {!awaitingPreview&&conflicts.length>0&&<div className="inventory-reference-conflicts">
        <details><summary>{label('店舗の個別設定と異なる項目','与门店单独设置冲突的项目','與門店單獨設定衝突的項目')} ({conflicts.length})</summary><ul>{conflicts.map(conflict=><li key={`${conflict.kind}:${conflict.targetId}:${conflict.reason}:${conflict.platform??''}`}>{conflict.label} · {conflict.reason==='inventory_block'?label('在庫保護','库存保护','庫存保護'):`${names[conflict.platform??'']??label('プラットフォーム','平台','平台')} · ${label('個別設定','单独设置','單獨設定')}`}</li>)}</ul></details>
        <label><input type="checkbox" checked={acknowledged} disabled={busy||disabled||expired||!previewMatches} onChange={e=>setAcknowledgedPreview(e.target.checked?previewKey:null)}/><span>{label('表示した差分で店舗の個別設定を上書きすることを確認しました。','我已确认按以上差异覆盖这些项目的门店单独设置。','我已確認按以上差異覆蓋這些項目的門店單獨設定。')}</span></label>
      </div>}
      <button className="primary-button" type="button" disabled={busy||disabled||refreshFailed||expired||!previewMatches||!comparison?.ready||readPending||conflicts.length>0&&!acknowledged} onClick={()=>void confirm()}>{label(`${names[referencePlatform]} に合わせて ${changeCount} 件を同期`,`按${names[referencePlatform]}同步 ${changeCount} 项`,`按${names[referencePlatform]}同步 ${changeCount} 項`)}</button>
      {expired&&<p>{label('期限切れ · 再読み取りしてください。','预览已过期，请重新读取。','預覽已過期，請重新讀取。')}</p>}
    </div>}
    {report&&<div role="status" aria-live="polite">
      {!refreshFailed&&!['awaiting_confirmation','expired'].includes(report.status)&&(!report.reads?.length||report.details.osApplied)&&<p className={`inventory-state-tag is-${report.status==='failed'?'error':report.status==='succeeded'?'success':'info'}`}>{report.status==='failed'?label('同期が停止しました。履歴で原因を確認してください。','同步已停止，请在履历中查看原因。','同步已停止，請在履歷中查看原因。'):report.status==='succeeded'?label('全店同期完了','整店同步完成'):report.details.osApplied?label('OS 反映済み · 他社へ配信中','OS 已更新 · 正在发布到其他平台','OS 已更新 · 正在發佈到其他平台'):label('読取の準備中 · まだ変更していません','正在准备读取 · 尚未修改状态','正在準備讀取 · 尚未修改狀態')}</p>}
      {report.details.osApplied&&report.platforms.length>0&&<div className="inventory-state-tags">{report.platforms.map(p=><span key={p.platform} className={`inventory-state-tag is-${p.failed||p.timedOut?'error':p.succeeded===p.total?'success':'info'}`}>{p.failed||p.timedOut?'!':p.succeeded===p.total?'✓':'◌'} {names[p.platform]??p.platform}: {p.succeeded}/{p.total}</span>)}</div>}
      {!!report.details.excluded?.length&&<details><summary>{label('Uber 未対応・変更しない商品','未关联 Uber、不改动的商品','未關聯 Uber、不變更的商品')} ({report.details.excluded.length})</summary><p>{report.details.excluded.map(t=>t.label).join('、')}</p></details>}
      <a className="secondary-button" href="/store/menu/inventory-history">{label('履歴・失敗した項目を確認','查看记录与失败项','查看紀錄與失敗項')}</a>
    </div>}
    {error&&<p role="alert" className="is-error">{error}</p>}
    <details className="inventory-sync-rules"><summary>{label('同期ルール・その他','同步规则与更多','同步規則與更多')}</summary>
      <p>{label('単品操作は Store、まとめて同期は通常 Uber が基準です。今回の基準は読み取り後に選べます。選んだ基準プラットフォーム自体は変更しません。本店の全ブランドが対象です。確認するまで変更しません。プレビューは10分間有効です。販売状態の定時同期はありません。','单品操作以 Store 为准，批量同步默认以 Uber 为准。读取后可选本次依据，作为依据的平台本身不修改。范围为本店全部品牌，确认后才修改。预览有效期 10 分钟，不定时同步销售状态。','單品操作以 Store 為準，批次同步預設以 Uber 為準。讀取後可選本次依據，作為依據的平台本身不修改。範圍為本店全部品牌，確認後才修改。預覽有效期 10 分鐘，不定時同步銷售狀態。')}</p>
      <a className="secondary-button" href="/os/menus">{label('メニュー管理','菜单管理','菜單管理')}</a>
    </details>
  </details>;
}
