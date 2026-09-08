"use client";

import { useEffect, useRef, useState } from "react";
import { groupInventoryPreview, inventoryPreviewExpired, type InventoryPreviewRow } from "../../../lib/inventory-preview";

type Report = { id:string; status:string; details:{authority?:string;osApplied?:boolean;targetCount?:number;previewAt?:string;preview?:Array<{label:string;isAvailable:boolean;wasAvailable:boolean|null}>;excluded?:Array<{label:string}>}; platforms:Array<{platform:string;succeeded:number;total:number;failed:number;timedOut:number}> };
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
  const preview=groupInventoryPreview(report?.details.preview??[]);
  const expired=inventoryPreviewExpired(report?.details.previewAt,now);
  const statusLabel=(available:boolean|null)=>available===null?label('不明','未知','未知'):available?label('販売中','可售','可售'):label('売切','缺货','缺貨');
  const renderRows=(rows:InventoryPreviewRow[])=> <ul className="inventory-preview-rows">{rows.map((row,index)=><li key={`${row.label}:${index}`}>
    <span>{row.label}</span>
    <span className="inventory-preview-transition"><span>Store: {statusLabel(row.wasAvailable)}</span><span aria-hidden="true"> → </span><span>Uber: {statusLabel(row.isAvailable)}</span></span>
  </li>)}</ul>;
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
    if(inventoryPreviewExpired(report?.details.previewAt,Date.now())) {
      setError(label('プレビューの有効期限が切れました。Uber を再読み取りしてください。','预览已过期，请重新读取 Uber。','預覽已過期，請重新讀取 Uber。'));return;
    }
    if(!report||!window.confirm(label('表示した Uber の状態で OS と連携先を上書きします。個別設定を解除し、売切商品を販売再開する場合があります。実行しますか？','将按显示的 Uber 状态覆盖 OS 和关联平台，清除单独设置，可能恢复缺货商品的销售。确认执行？','將按顯示的 Uber 狀態覆蓋 OS 和關聯平台，清除單獨設定，可能恢復缺貨商品的銷售。確認執行？')))return;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/store/display/kitchen/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm_full_sync',runId:report.id,storeId})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      setReport({...report,status:'processing',details:{...report.details,osApplied:true}});
    }catch(e){setError(e instanceof Error?e.message:label('同期できませんでした。','同步失败。','同步失敗。'));}
    finally{setBusy(false);}
  }
  return <details className="panel inventory-calibration-panel" data-i18n-ignore>
    <summary>{label('その他の操作 · Uber 基準で全店の販売状態を揃える','更多操作 · 按 Uber 校准全店销售状态','更多操作 · 按 Uber 校準全店銷售狀態')}</summary>
    <div className="store-menu-head">
      <div>
        <h3>{label('Uber 基準で販売状態を揃える','按 Uber 校准销售状态','按 Uber 校準銷售狀態')}</h3>
        <p>{label('単品操作は Store 基準。全店同期は Uber 読取 → OS → 連携先。販売状態の定時同期は行いません。','单品操作以 Store 为准。整店同步：读取 Uber → OS → 关联平台。不再定时同步销售状态。','單品操作以 Store 為準。整店同步：讀取 Uber → OS → 關聯平台。不再定時同步銷售狀態。')}</p>
      </div>
      <button type="button" className="primary-button" disabled={disabled||busy||!storeId||report?.status==='processing'} onClick={()=>void start()}>
        {busy?label('送信中…','正在提交…'):report?.status==='processing'?label('読取／同期中…','读取／同步中…','讀取／同步中…'):label('Uber を読み取り、変更をプレビュー','读取 Uber，预览变更','讀取 Uber，預覽變更')}
      </button>
    </div>
    <p>{label('全ブランドが対象です。読取のみでは販売状態は変わりません。プレビューは10分間有効です。','范围为本店全部品牌。只读取不会修改销售状态；预览有效期为 10 分钟。','範圍為本店全部品牌。只讀取不會修改銷售狀態；預覽有效期為 10 分鐘。')}</p>
    {report?.status==='awaiting_confirmation'&&<div>
      <h4>{label('Store と Uber の差分','Store 与 Uber 的差异','Store 與 Uber 的差異')} · {preview.restoring.length+preview.stopping.length} {label('件','项','項')}</h4>
      <p>{label('この一覧は Store と Uber の比較です。他社との比較ではありません。確認後は変更なしの商品も含め、連携先へ Uber の状態を反映します。','此处比较 Store 与 Uber，不是各外卖平台之间的比较。确认后，会把包含无变化商品在内的 Uber 状态传给关联平台。','此處比較 Store 與 Uber，不是各外送平台之間的比較。確認後，會把包含無變化商品在內的 Uber 狀態傳給關聯平台。')}</p>
      <p>{label('読取時刻','读取时间','讀取時間')}：{Number.isFinite(Date.parse(report.details.previewAt??''))?new Date(report.details.previewAt!).toLocaleString(language,{timeZone:'Asia/Tokyo'}):'—'}（JST）</p>
      <p role="status" className={expired?'is-error':''}>{expired?label('期限切れ · Uber を再読み取りしてください。まだ変更していません。','预览已过期，请重新读取 Uber。尚未修改任何状态。','預覽已過期，請重新讀取 Uber。尚未修改任何狀態。'):label('確認待ち · まだ変更していません','等待确认 · 尚未修改','等待確認 · 尚未修改')}</p>
      <h4>{label('販売再開','恢复销售','恢復銷售')} · {preview.restoring.length}</h4>
      {renderRows(preview.restoring)}
      <h4>{label('売切に変更','设为缺货','設為缺貨')} · {preview.stopping.length}</h4>
      {renderRows(preview.stopping)}
      {preview.unknown.length>0&&<><h4>{label('Store 状態不明','Store 状态未知','Store 狀態未知')} · {preview.unknown.length}</h4>{renderRows(preview.unknown)}</>}
      <details key={report.id}><summary>{label('変更なし','无变化','無變化')} · {preview.unchanged.length}</summary>{renderRows(preview.unchanged)}</details>
      <button className="primary-button" type="button" disabled={busy||disabled||expired||preview.unknown.length>0} onClick={()=>void confirm()}>{label(`確認して実行：販売再開 ${preview.restoring.length}件、売切 ${preview.stopping.length}件`,`确认执行：恢复 ${preview.restoring.length} 项、缺货 ${preview.stopping.length} 项`,`確認執行：恢復 ${preview.restoring.length} 項、缺貨 ${preview.stopping.length} 項`)}</button>
      {preview.unknown.length>0&&<p className="is-error">{label('不明な状態があります。再読み取りして確認してください。','存在未知状态，请重新读取并确认。','存在未知狀態，請重新讀取並確認。')}</p>}
    </div>}
    {report&&<div role="status" aria-live="polite">
      {report.status!=='awaiting_confirmation'&&<p>{report.status==='failed'?label('同期が停止しました。履歴で原因を確認してください。','同步已停止，请在履历中查看原因。','同步已停止，請在履歷中查看原因。'):report.status==='succeeded'?label('全店同期完了','整店同步完成'):report.details.osApplied?label('OS 反映済み · 他社へ配信中','OS 已更新 · 正在发布到其他平台','OS 已更新 · 正在發佈到其他平台'):label('Uber 読取待ち／読取中 · OS はまだ変更していません','等待／正在读取 Uber · 尚未修改 OS','等待／正在讀取 Uber · 尚未修改 OS')}</p>}
      {report.platforms.length>0&&<p>{report.platforms.map(p=>`${({foundr1:'OS',uber_eats:'Uber',rocket_now:'Rocket Now',demae_can:'出前館'} as Record<string,string>)[p.platform]??p.platform}: ${p.succeeded}/${p.total}`).join(' · ')}</p>}
      {!!report.details.excluded?.length&&<details><summary>{label('Uber 未対応・変更しない商品','未关联 Uber、不改动的商品','未關聯 Uber、不變更的商品')} ({report.details.excluded.length})</summary><p>{report.details.excluded.map(t=>t.label).join('、')}</p></details>}
      <a href="/store/menu/inventory-history">{label('同期履歴・エラー詳細・失敗分の再試行','同步履历、错误详情与失败项重试','同步履歷、錯誤詳情與失敗項重試')}</a>
    </div>}
    {error&&<p role="alert" className="is-error">{error}</p>}
    <p><a href="/os/menus">{label('メニュー内容・価格・同期履歴は OS へ','菜单内容、价格与同步履历：前往 OS','菜單內容、價格與同步履歷：前往 OS')}</a></p>
  </details>;
}
