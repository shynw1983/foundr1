"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import type {MenuRecoveryView} from '../../../lib/menu-sync-recovery';
import styles from './MenuSyncRecovery.module.css';

type Props={brandId:string;jobId:string;language:string};
const activeStatuses=new Set(['pending','processing','checking','repairing']);
const uuidPattern=/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const cleanName=(value:string|undefined)=>value?.replace(uuidPattern,'').trim()??'';

export function MenuSyncRecovery({brandId,jobId,language}:Props) {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  const scope=`${brandId}:${jobId}`;
  const currentScope=useRef(scope);
  currentScope.current=scope;
  const mounted=useRef(false);
  const controllers=useRef(new Set<AbortController>());
  const requestNumber=useRef(0);
  const [state,setState]=useState<{scope:string;view:MenuRecoveryView}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<'read'|'submit'|null>(null);
  const [failureCode,setFailureCode]=useState('');
  const [paused,setPaused]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const [clock,setClock]=useState(Date.now);
  const view=state?.scope===scope?state.view:null;
  const checking=view?.status==='checking'||view?.status==='repairing';
  const continuationActive=Boolean(view?.continuation&&activeStatuses.has(view.continuation.status));
  const watching=checking||continuationActive;

  const request=useCallback(async(body?:Record<string,string>)=>{
    const expectedScope=`${brandId}:${jobId}`,number=++requestNumber.current;
    const controller=new AbortController();
    controllers.current.add(controller);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(body?'/api/menus/recovery':`/api/menus/recovery?brandId=${encodeURIComponent(brandId)}&jobId=${encodeURIComponent(jobId)}`,{
        method:body?'POST':'GET',cache:'no-store',signal:controller.signal,
        ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify({brandId,jobId,...body})}:{}),
      });
      const next=await response.json() as MenuRecoveryView;
      if(!response.ok){const code=(next as unknown as {error?:unknown}).error;throw new Error(typeof code==='string'?code:'result_unknown');}
      if(next.jobId!==jobId||typeof next.status!=='string')throw new Error('recovery_response_unconfirmed');
      if(mounted.current&&currentScope.current===expectedScope&&number===requestNumber.current) {
        setState({scope:expectedScope,view:next});setError(null);setFailureCode('');setClock(Date.now());
      }
      return next;
    } catch(failure) {
      if(!mounted.current||currentScope.current!==expectedScope||number!==requestNumber.current)return null;
      throw failure;
    } finally {clearTimeout(timeout);controllers.current.delete(controller);}
  },[brandId,jobId]);

  useEffect(()=>{
    mounted.current=true;requestNumber.current+=1;
    setState(null);setBusy(false);setError(null);setFailureCode('');setPaused(false);setConfirm(false);
    const expectedScope=scope;
    void request().catch(()=>{if(mounted.current&&currentScope.current===expectedScope)setError('read');});
    return()=>{mounted.current=false;requestNumber.current+=1;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
  },[request,scope]);

  useEffect(()=>{
    if(!watching||paused||busy)return;
    let stopped=false,failures=0,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {await request();failures=0;}
      catch {if(!stopped){failures+=1;setError('read');if(failures>=3)setPaused(true);}}
      if(!stopped&&failures<3)timer=setTimeout(()=>void poll(),3000);
    };
    timer=setTimeout(()=>void poll(),3000);
    return()=>{stopped=true;clearTimeout(timer);};
  },[watching,paused,busy,request]);

  useEffect(()=>{
    if(!view?.plan)return;
    const timer=setInterval(()=>setClock(Date.now()),1000);
    return()=>clearInterval(timer);
  },[view?.plan]);

  const submit=async(action:'inspect'|'restore_hidden'|'verify_release'|'retry')=>{
    if(busy||checking)return;
    const expectedScope=scope;
    setBusy(true);setError(null);setFailureCode('');setConfirm(false);setPaused(false);
    try {
      const plan=view?.plan,inspection=view?.inspection;
      if(action!=='inspect'&&(!plan||!inspection||Date.parse(plan.expiresAt)<=Date.now()))return;
      await request({action,...(action!=='inspect'&&plan&&inspection?{inspectionId:inspection.id,token:plan.token}:{})});
    } catch(failure) {if(mounted.current&&currentScope.current===expectedScope){setError('submit');setFailureCode(failure instanceof Error?failure.message:'');}}
    finally {if(mounted.current&&currentScope.current===expectedScope)setBusy(false);}
  };
  const refresh=async()=>{
    if(busy)return;
    const expectedScope=scope;setBusy(true);setError(null);
    try {await request();if(currentScope.current===expectedScope)setPaused(false);}
    catch {if(mounted.current&&currentScope.current===expectedScope)setError('read');}
    finally {if(mounted.current&&currentScope.current===expectedScope)setBusy(false);}
  };
  const date=(value:string)=>new Date(value).toLocaleString(language,{timeZone:'Asia/Tokyo'});
  const name=cleanName(view?.target?.name)||label('対象の名称を確認中','正在确认对象名称','正在確認對象名稱');
  const identified=Boolean(cleanName(view?.target?.name));
  const parent=cleanName(view?.target?.parentName);
  const expired=Boolean(view?.plan&&Date.parse(view.plan.expiresAt)<=clock);
  const continuationBlocked=view?.code==='continuation_blocked'||view?.continuation?.status==='blocked';
  const statusLabel=()=>{
    switch(view?.status) {
      case 'checking':return label('プラットフォームの現状を確認中','正在检查平台现状','正在檢查平台現狀');
      case 'ready':return label('確認が完了しました。対応内容を選べます。','检查完成，可以处理','檢查完成，可以處理');
      case 'repairing':return label('対応を実行し、保存結果を回読中','正在处理并回读保存结果','正在處理並回讀儲存結果');
      case 'verified':return label('この問題の対応結果を回読確認しました','已回读确认此问题的处理结果','已回讀確認此問題的處理結果');
      case 'blocked':return continuationBlocked?label('対応結果は確認済みですが、続きの同期はまだ予約されていません','处理结果已确认，后续同步尚未排队','處理結果已確認，後續同步尚未排隊'):label('安全に対応できる条件が揃っていません','尚不满足安全处理条件','尚不滿足安全處理條件');
      case 'unknown':return label('結果をまだ確認できません','结果尚未确认','結果尚未確認');
      default:return label('プラットフォームの現状と対応方法を確認します','检查平台现状及可用处理方式','檢查平台現狀及可用處理方式');
    }
  };
  const reason=(code:string)=>{
    if(code==='uber_publication_reconcile_active'||code==='busy')return label('別の同期が処理中です。完了後に状態を更新し、もう一度確認してください。','其他同步任务仍在处理中，请待完成后更新状态并重新检查。','其他同步工作仍在處理中，請待完成後更新狀態並重新檢查。');
    if(code==='uber_publication_reconcile_pending_removal')return label('Uber メニューの削除候補を確認する必要があります。メニューの最新状態を確認してから再確認してください。','需要核对 Uber 菜单的删除候选，请确认最新菜单后重新检查。','需要核對 Uber 菜單的刪除候選，請確認最新菜單後重新檢查。');
    if(code==='uber_publication_reconcile_disabled'||code==='uber_publication_reconcile_not_configured')return label('同期設定またはプラットフォームの接続設定を確認する必要があります。設定を確認してから再確認してください。','需要核对同步设置或平台连接设置，请检查设置后重新检查。','需要核對同步設定或平台連線設定，請檢查設定後重新檢查。');
    if(code==='continuation_blocked')return label('続きの同期を予約できませんでした。状態を更新して再確認するか、診断情報をダウンロードして担当者に確認してください。','后续同步尚未排队。请更新状态并重新检查，或下载诊断信息交给维护人员核对。','後續同步尚未排隊。請更新狀態並重新檢查，或下載診斷資訊交給維護人員核對。');
    if(code==='continuation_unavailable')return label('続きの同期を予約する処理を完了できませんでした。状態を更新して再確認するか、診断情報をダウンロードしてください。','后续同步的排队处理尚未完成。请更新状态并重新检查，或下载诊断信息。','後續同步的排隊處理尚未完成。請更新狀態並重新檢查，或下載診斷資訊。');
    if(code==='bridge_update_required')return label('この対応には Mac Bridge の更新が必要です。診断情報をダウンロードして担当者に更新を依頼してください。','此处理需要更新 Mac Bridge，请下载诊断信息交给维护人员更新。','此處理需要更新 Mac Bridge，請下載診斷資訊交給維護人員更新。');
    if(code==='device_selection_required')return label('使用する Bridge を一意に確認できません。接続する Mac Bridge を確認してから再確認してください。','无法唯一确认要使用的 Bridge，请确认连接的 Mac Bridge 后重新检查。','無法唯一確認要使用的 Bridge，請確認連線的 Mac Bridge 後重新檢查。');
    if(code==='receipt_missing')return label('この商品の作成結果が記録されていないため、安全な対応を確定できません。診断情報をダウンロードして担当者に確認してください。','缺少此商品的创建结果记录，无法安全处理。请下载诊断信息交给维护人员核对。','缺少此商品的建立結果記錄，無法安全處理。請下載診斷資訊交給維護人員核對。');
    if(code==='inventory_pending')return label('販売状態の操作が処理中です。操作が完了してから再確認してください。','销售状态操作仍在处理中，请待操作完成后重新检查。','銷售狀態操作仍在處理中，請待操作完成後重新檢查。');
    if(code==='inventory_failed')return label('直近の販売操作が完了していません。Store でその操作の結果を確認してから再確認してください。','最近销售操作未完成，请在 Store 核对该操作结果后重新检查。','最近銷售操作未完成，請在 Store 核對該操作結果後重新檢查。');
    if(/login|auth|session/.test(code))return label('Bridge の専用画面でログインし、もう一度確認してください。','请在 Bridge 专用窗口登录后重新检查。','請在 Bridge 專用視窗登入後重新檢查。');
    if(/offline|device|connection|timeout|expired/.test(code))return label('Bridge の接続と処理結果を確認できません。接続後に再確認してください。','尚未确认 Bridge 连接或处理结果，请恢复连接后重新检查。','尚未確認 Bridge 連線或處理結果，請恢復連線後重新檢查。');
    if(/newer|supersed|stale|changed|intent/.test(code))return label('確認後に別の操作が行われました。最新の状態を確認してください。','检查后发生了其他操作，请重新检查最新状态。','檢查後發生了其他操作，請重新檢查最新狀態。');
    if(/identity|mapping|ambiguous|name_mismatch|target|not_found/.test(code))return label('対象の紐付けを一意に確認できません。診断情報をダウンロードして担当者に確認してください。','无法唯一确认商品关联，请下载诊断信息交给维护人员核对。','無法唯一確認商品關聯，請下載診斷資訊交給維護人員核對。');
    if(/hold|unavailable|inventory|operation/.test(code))return label('OS の販売状態と直近の操作を確認する必要があります。Store の販売状態も確認してください。','需要核对 OS 销售状态与最近操作，请同时检查 Store 销售状态。','需要核對 OS 銷售狀態與最近操作，請同時檢查 Store 銷售狀態。');
    if(/unsupported/.test(code))return label('この種類の問題は自動対応の対象外です。診断情報をダウンロードして担当者に確認してください。','此类问题暂不支持自动处理，请下载诊断信息交给维护人员。','此類問題暫不支援自動處理，請下載診斷資訊交給維護人員。');
    return label('現状を確認しても安全な対応を確定できませんでした。再確認するか、診断情報をダウンロードして担当者に確認してください。','目前无法确定安全处理方式。可重新检查，或下载诊断信息交给维护人员。','目前無法確定安全處理方式。可重新檢查，或下載診斷資訊交給維護人員。');
  };
  const download=()=>{
    if(!view)return;
    const diagnostic={version:1,downloadedAt:new Date().toISOString(),jobId:view.jobId,platform:view.platform,
      supported:view.supported,status:view.status,code:view.code,target:view.target,
      command:view.command?{id:view.command.id,status:view.command.status,mode:view.command.mode}:undefined,
      inspection:view.inspection,plan:view.plan?{mode:view.plan.mode,expiresAt:view.plan.expiresAt}:undefined,
      continuation:view.continuation};
    const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`menu-sync-diagnostic-${view.platform}-${new Date().toISOString().slice(0,10)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const planText=view?.plan?.mode==='restore_hidden'
    ?label(`「${name}」を非公開に戻し、回読確認後にこのプラットフォームの同期を続けます。この商品は注文できなくなります。`,`将“${name}”恢复为非公开，回读确认后继续此平台同步；该商品将无法被下单。`,`將「${name}」恢復為非公開，回讀確認後繼續此平台同步；該商品將無法被下單。`)
    :view?.plan?.mode==='verify_release'
      ?label(`「${name}」の直近の販売操作と現状を照合し、確認できた場合に同期を続けます。販売状態は変更しません。`,`核对“${name}”最近的上架操作与平台现状，确认一致后继续同步；保留当前销售状态。`,`核對「${name}」最近的上架操作與平台現狀，確認一致後繼續同步；保留目前銷售狀態。`)
      :label('このプラットフォームの同期を再予約し、新しい処理で結果を確認します。','重新安排此平台同步，由新任务核对最终结果。','重新安排此平台同步，由新工作核對最終結果。');
  const actionLabel=view?.plan?.mode==='restore_hidden'?label('非公開に戻して続ける','恢复非公开并继续','恢復非公開並繼續'):view?.plan?.mode==='verify_release'?label('販売操作を確認して続ける','按最近上架记录验收并继续','按最近上架記錄驗收並繼續'):label('このプラットフォームを再試行','重试此平台','重試此平台');

  return <section className={styles.recovery} data-menu-recovery data-state={view?.status??'idle'} data-i18n-ignore aria-label={label('同期の確認と対応','同步检查与处理','同步檢查與處理')}>
    <strong>{label('OS で確認・対応','在 OS 检查并处理','在 OS 檢查並處理')}</strong>
    <p role="status">{statusLabel()}</p>
    {view?.target&&<div className={styles.target}><span>{view.target.kind==='option'?label('オプション','选项','選項'):label('商品','商品','商品')}</span><strong>{name}</strong>{parent&&<small>{label('所属グループ','所属分组','所屬分組')}：{parent}</small>}</div>}
    {view?.inspection&&<>
      <dl className={styles.facts}>
        <div><dt>{label('OS の販売指定','OS 销售要求','OS 銷售要求')}</dt><dd>{view.inspection.hold==='unavailable'?label('非公開・販売不可','非公开／不可销售','非公開／不可銷售'):view.inspection.hold==='available'?label('販売可','可销售','可銷售'):view.inspection.hold==='follow'?label('プラットフォームの状態を維持','保留平台状态','保留平台狀態'):label('指定なし','未指定','未指定')}</dd></div>
        <div><dt>{label('プラットフォームの現状','平台当前状态','平台目前狀態')}</dt><dd>{view.inspection.native.hidden===true?label('非公開','非公开','非公開'):view.inspection.native.isAvailable===false?label('販売不可','不可销售','不可銷售'):view.inspection.native.hidden===false&&view.inspection.native.isAvailable===true?label('公開・販売可','公开／可销售','公開／可銷售'):label('未確認','尚未确认','尚未確認')}</dd></div>
        {Boolean(view.inspection.native.parentNames?.length)&&<div><dt>{label('プラットフォームの所属グループ','平台所属分组','平台所屬分組')}</dt><dd>{view.inspection.native.parentNames?.map(cleanName).filter(Boolean).join('・')||label('未確認','尚未确认','尚未確認')}</dd></div>}
        {typeof view.inspection.native.price==='number'&&<div><dt>{label('プラットフォーム価格','平台价格','平台價格')}</dt><dd>{new Intl.NumberFormat(language,{style:'currency',currency:'JPY'}).format(view.inspection.native.price)}</dd></div>}
        <div><dt>{label('直近の販売操作','最近销售操作','最近銷售操作')}</dt><dd>{view.inspection.latestOperation?<>{view.inspection.latestOperation.isAvailable?label('販売再開','上架','上架'):label('販売停止','下架','下架')} · {date(view.inspection.latestOperation.at)}<br/>{view.inspection.latestOperation.status==='succeeded'?label('操作完了','操作已完成','操作已完成'):label('操作結果は確認が必要','操作结果待确认','操作結果待確認')}</>:label('操作記録なし','无操作记录','無操作記錄')}</dd></div>
      </dl>
      <small>{label('現状確認','平台检查','平台檢查')}：{date(view.inspection.at)}</small>
    </>}
    {(view?.status==='blocked'||view?.status==='unknown'||view?.supported===false)&&<p className={styles.warning}>{reason(continuationBlocked?view?.continuation?.code??'continuation_blocked':view.inspection?.blockers[0]??view.code??'unsupported')}</p>}
    {view?.plan&&view.status==='ready'&&<div className={styles.plan}>
      <strong>{label('実行する内容','将执行的处理','將執行的處理')}</strong><p>{planText}</p>
      {expired?<p className={styles.warning}>{label('確認内容の有効期限が切れました。もう一度確認してください。','检查结果已过期，请重新检查。','檢查結果已過期，請重新檢查。')}</p>:<small>{label('確認の有効期限','检查有效期','檢查有效期')}：{date(view.plan.expiresAt)}</small>}
      {!expired&&!confirm&&<button type="button" className="primary-button compact-button" disabled={busy||error==='submit'||!identified} onClick={()=>view.plan?.mode==='restore_hidden'?setConfirm(true):void submit(view.plan!.mode)}>{actionLabel}</button>}
      {!expired&&confirm&&<div className={styles.confirm} role="group" aria-label={label('販売状態の変更確認','确认销售状态变更','確認銷售狀態變更')}><p>{label(`「${name}」を非公開に変更します。実行しますか？`,`确认将“${name}”改为非公开？`,`確認將「${name}」改為非公開？`)}</p><button type="button" className="primary-button compact-button" disabled={busy||error==='submit'} onClick={()=>void submit('restore_hidden')}>{label('この商品を非公開にする','确认恢复此商品为非公开','確認恢復此商品為非公開')}</button><button type="button" className="secondary-button compact-button" onClick={()=>setConfirm(false)}>{label('戻る','返回','返回')}</button></div>}
    </div>}
    {view?.status==='verified'&&<p className={styles.success}>{label('対象の確認・対応は完了しました。元の失敗記録は履歴に残ります。','此对象已完成核对处理，原失败记录仍保留在历史中。','此對象已完成核對處理，原失敗記錄仍保留在歷史中。')}</p>}
    {continuationBlocked&&<p className={styles.success}>{label('この対象の対応結果は回読確認済みです。プラットフォーム全体の同期完了は別に確認します。','此对象的处理结果已回读确认；整个平台的同步完成情况仍待确认。','此對象的處理結果已回讀確認；整個平台的同步完成情況仍待確認。')}</p>}
    {view?.continuation&&<p className={styles.continuation}>{label('続きの同期','后续同步','後續同步')}：{view.continuation.status==='blocked'?label('未予約・再確認が必要です','尚未排队，需要重新检查','尚未排隊，需要重新檢查'):view.continuation.status==='succeeded'?label('新しい同期が検証完了しました','新同步已验证完成','新同步已驗證完成'):view.continuation.status==='failed'?label('新しい同期で別の確認が必要です。上の最新結果を確認してください。','新同步仍需处理，请查看上方最新平台结果。','新同步仍需處理，請查看上方最新平台結果。'):label('予約・処理中です。完了結果を待っています。','已排队／处理中，等待最终结果。','已排隊／處理中，等待最終結果。')}</p>}
    {error&&<p className={styles.warning} role="alert">{error==='submit'&&failureCode&&!['result_unknown','recovery_response_unconfirmed','Failed to fetch','Load failed','The operation was aborted.'].includes(failureCode)?<>{reason(failureCode)} {label('対応状況を更新してください。','请更新处理状态。','請更新處理狀態。')}</>:error==='submit'?label('送信結果を確認できません。状態を更新してから次の操作を選んでください。操作は自動で再送しません。','提交结果尚未确认，请先更新状态再选择下一步。系统不会自动重复提交。','提交結果尚未確認，請先更新狀態再選擇下一步。系統不會自動重複提交。'):label('状態を取得できません。接続を確認して状態を更新してください。','无法读取状态，请检查连接后更新状态。','無法讀取狀態，請檢查連線後更新狀態。')}{paused&&label(' 自動確認を一時停止しました。',' 自动检查已暂停。',' 自動檢查已暫停。')}</p>}
    <div className={styles.actions}>
      {!checking&&!continuationActive&&view?.supported!==false&&view?.status!=='verified'&&<button type="button" className="primary-button compact-button" disabled={busy||error==='submit'} onClick={()=>void submit('inspect')}>{busy?label('確認中…','检查中…','檢查中…'):view?.inspection?label('もう一度確認','重新检查','重新檢查'):label('確認して対応','检查并处理','檢查並處理')}</button>}
      {(checking||continuationActive||continuationBlocked||error||paused)&&<button type="button" className="secondary-button compact-button" disabled={busy} onClick={()=>void refresh()}>{label('対応状況を更新','更新处理状态','更新處理狀態')}</button>}
      {view&&<button type="button" className="secondary-button compact-button" onClick={download}>{label('診断情報をダウンロード','下载诊断信息','下載診斷資訊')}</button>}
    </div>
  </section>;
}
