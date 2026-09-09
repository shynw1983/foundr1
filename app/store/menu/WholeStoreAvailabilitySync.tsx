"use client";

import { useEffect, useRef, useState } from "react";
import { inventoryPreviewExpired } from "../../../lib/inventory-preview";
import {InventoryComparisonPreview,type InventoryComparison} from './InventoryComparisonPreview';
import {InventoryReadProgress,type InventoryRead} from './InventoryReadProgress';

type Report = { id:string; status:string; reads?:InventoryRead[]; details:{comparison?:InventoryComparison;authority?:string;osApplied?:boolean;targetCount?:number;previewAt?:string;preview?:Array<{label:string;isAvailable:boolean;wasAvailable:boolean|null}>;excluded?:Array<{label:string}>}; platforms:Array<{platform:string;succeeded:number;total:number;failed:number;timedOut:number}> };
export function WholeStoreAvailabilitySync({storeId,language,disabled,onApplied}:{storeId:string;language:string;disabled:boolean;onApplied:()=>void}) {
  const zh=language==='zh-Hans', hant=language==='zh-Hant';
  const label=(ja:string,cn:string,tw=cn)=>zh?cn:hant?tw:ja;
  const [report,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [now,setNow]=useState(()=>Date.now());
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
    let cancelled=false;
    setReport(null);
    const refresh=async()=>{
      try {
        const response=await fetch(`/api/store/inventory-history?storeId=${encodeURIComponent(storeId)}&days=30`,{cache:'no-store'});
        if(!response.ok) return;
        const body=await response.json();
        if(!cancelled) setReport((body.reports??[]).find((r:Report)=>r.details.authority==='uber_eats')??null);
      } catch { /* Keep the last verified status; never trigger a write from polling. */ }
    };
    if(storeId) void refresh();
    const timer=setInterval(()=>{if(storeId)void refresh();},5000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[storeId]);
  async function start() {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/store/display/kitchen/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'full_sync',storeId})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setReport({id:body.runId,status:'processing',details:{authority:'uber_eats',osApplied:false,targetCount:body.targetCount,excluded:body.excluded},platforms:[]});
    } catch(e){setError(e instanceof Error?e.message:label('開始できませんでした。','无法开始。','無法開始。'));}
    finally{setBusy(false);}
  }
  async function confirm() {
    if(!report?.details.comparison?.ready)return;
    if(inventoryPreviewExpired(report?.details.previewAt,Date.now())) {
      setError(label('プレビューの有効期限が切れました。Uber を再読み取りしてください。','预览已过期，请重新读取 Uber。','預覽已過期，請重新讀取 Uber。'));return;
    }
    if(!report||!window.confirm(label('表示した Uber の状態で OS と連携先を上書きします。個別設定を解除し、売切商品を販売再開し、表示された新品を公開する場合があります。実行しますか？','将按显示的 Uber 状态覆盖 OS 和关联平台，清除单独设置，可能恢复缺货商品的销售，并上架预览中列出的新品。确认执行？','將按顯示的 Uber 狀態覆蓋 OS 和關聯平台，清除單獨設定，可能恢復缺貨商品的銷售，並上架預覽中列出的新品。確認執行？')))return;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/store/display/kitchen/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm_full_sync',runId:report.id,storeId})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      setReport({...report,status:'processing',details:{...report.details,osApplied:true}});
    }catch(e){setError(e instanceof Error?e.message:label('同期できませんでした。','同步失败。','同步失敗。'));}
    finally{setBusy(false);}
  }
  async function retryRead(commandId:string) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/store/menu-sync-runs/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry_read',storeId,commandId})});
      if(!response.ok)throw new Error(label('再読み取りできません。他の処理の完了後、全プラットフォームを読み直してください。','暂时无法重读，请等待其他任务完成后重新读取所有平台。','暫時無法重讀，請等待其他工作完成後重新讀取所有平台。'));
      setReport(current=>current?{...current,reads:current.reads?.map(r=>r.id===commandId?{...r,status:'queued',error:''}:r)}:current);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <details className="panel inventory-calibration-panel" data-i18n-ignore>
    <summary>{label('その他の操作 · Uber 基準で全店の販売状態を揃える','更多操作 · 按 Uber 校准全店销售状态','更多操作 · 按 Uber 校準全店銷售狀態')}</summary>
    <div className="store-menu-head">
      <div>
        <h3>{label('Uber 基準で販売状態を揃える','按 Uber 校准销售状态','按 Uber 校準銷售狀態')}</h3>
        <p>{label('単品操作は Store 基準。全店同期は Uber 読取 → OS → 連携先。販売状態の定時同期は行いません。','单品操作以 Store 为准。整店同步：读取 Uber → OS → 关联平台。不再定时同步销售状态。','單品操作以 Store 為準。整店同步：讀取 Uber → OS → 關聯平台。不再定時同步銷售狀態。')}</p>
      </div>
      <button type="button" className="primary-button" disabled={disabled||busy||!storeId||report?.status==='processing'||report?.details.comparison?.pending} onClick={()=>void start()}>
        {busy?label('送信中…','正在提交…'):report?.status==='processing'?label('読取／同期中…','读取／同步中…','讀取／同步中…'):label('全プラットフォームを読み取り、比較','读取所有平台，预览差异','讀取所有平台，預覽差異')}
      </button>
    </div>
    <p>{label('全ブランドが対象です。読取のみでは販売状態は変わりません。プレビューは10分間有効です。','范围为本店全部品牌。只读取不会修改销售状态；预览有效期为 10 分钟。','範圍為本店全部品牌。只讀取不會修改銷售狀態；預覽有效期為 10 分鐘。')}</p>
    {report&&!report.details.osApplied&&!!report.reads?.length&&<InventoryReadProgress
      reads={report.reads} language={language} counts={report.details.comparison?.counts??{}}
      confirmedByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>['available','sold_out'].includes(r.cells[p]?.state)).length??0]))}
      stagedByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>r.cells[p]?.state==='staged').length??0]))}
      unknownByPlatform={Object.fromEntries((report.details.comparison?.platforms??[]).map(p=>[p,report.details.comparison?.rows.filter(r=>r.cells[p]?.state==='unknown').length??0]))}
      onRetry={id=>void retryRead(id)} disabled={disabled||busy||report.reads.some(r=>['queued','pending','processing'].includes(r.status))||Boolean(report.details.previewAt&&expired)}
    />}
    {report&&['awaiting_confirmation','expired'].includes(report.status)&&<div>
      {report.details.comparison?<InventoryComparisonPreview key={report.id} comparison={report.details.comparison} language={language}/>:<p>{label('旧プレビューです。全プラットフォームを再読み取りしてください。','旧预览不包含其他平台状态，请重新读取所有平台。','舊預覽不包含其他平台狀態，請重新讀取所有平台。')}</p>}
      <button className="primary-button" type="button" disabled={busy||disabled||expired||!report.details.comparison?.ready||report.reads?.some(r=>['queued','pending','processing'].includes(r.status))} onClick={()=>void confirm()}>{label('確認して同期（販売状態を変更）','确认同步（修改销售状态）','確認同步（修改銷售狀態）')} · {Object.entries(report.details.comparison?.counts??{}).map(([p,n])=>`${({foundr1:'OS',rocket_now:'Rocket Now',demae_can:'出前館'} as Record<string,string>)[p]} ${n}`).join(' / ')}</button>
      {expired&&<p>{label('期限切れ · 再読み取りしてください。','预览已过期，请重新读取。','預覽已過期，請重新讀取。')}</p>}
    </div>}
    {report&&<div role="status" aria-live="polite">
      {!['awaiting_confirmation','expired'].includes(report.status)&&(!report.reads?.length||report.details.osApplied)&&<p className={`inventory-state-tag is-${report.status==='failed'?'error':report.status==='succeeded'?'success':'info'}`}>{report.status==='failed'?label('同期が停止しました。履歴で原因を確認してください。','同步已停止，请在履历中查看原因。','同步已停止，請在履歷中查看原因。'):report.status==='succeeded'?label('全店同期完了','整店同步完成'):report.details.osApplied?label('OS 反映済み · 他社へ配信中','OS 已更新 · 正在发布到其他平台','OS 已更新 · 正在發佈到其他平台'):label('読取の準備中 · まだ変更していません','正在准备读取 · 尚未修改状态','正在準備讀取 · 尚未修改狀態')}</p>}
      {report.details.osApplied&&report.platforms.length>0&&<div className="inventory-state-tags">{report.platforms.map(p=><span key={p.platform} className={`inventory-state-tag is-${p.failed||p.timedOut?'error':p.succeeded===p.total?'success':'info'}`}>{p.failed||p.timedOut?'!':p.succeeded===p.total?'✓':'◌'} {({foundr1:'OS',uber_eats:'Uber',rocket_now:'Rocket Now',demae_can:'出前館'} as Record<string,string>)[p.platform]??p.platform}: {p.succeeded}/{p.total}</span>)}</div>}
      {!!report.details.excluded?.length&&<details><summary>{label('Uber 未対応・変更しない商品','未关联 Uber、不改动的商品','未關聯 Uber、不變更的商品')} ({report.details.excluded.length})</summary><p>{report.details.excluded.map(t=>t.label).join('、')}</p></details>}
      <a href="/store/menu/inventory-history">{label('同期履歴・エラー詳細・失敗分の再試行','同步履历、错误详情与失败项重试','同步履歷、錯誤詳情與失敗項重試')}</a>
    </div>}
    {error&&<p role="alert" className="is-error">{error}</p>}
    <p><a href="/os/menus">{label('メニュー内容・価格・同期履歴は OS へ','菜单内容、价格与同步履历：前往 OS','菜單內容、價格與同步履歷：前往 OS')}</a></p>
  </details>;
}
