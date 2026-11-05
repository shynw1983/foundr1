'use client';

import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useOsTranslation} from './OsTranslationProvider';

type Command={id:string;status:string;result?:{connectionRecovered?:boolean;inventoryChanged?:boolean;verifiedAt?:string}};
async function requestJson(url:string,init:RequestInit,controller:AbortController,timeoutMs:number):Promise<{command?:Command;error?:string}> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([
      (async()=>{const response=await fetch(url,{...init,signal:controller.signal});const body=await response.json();
        if(!body||typeof body!=='object'||Array.isArray(body))throw Error('result_unknown');
        if(!response.ok){const known=['forbidden','invalid_platform','bridge_offline','bridge_update_required','device_selection_required','recovery_cooldown','busy'].includes(body.error);throw Object.assign(Error(known?body.error:'request_unknown'),{confirmedRejection:true});}
        return body;})(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('request_timeout'));controller.abort();},timeoutMs);})
    ]);
  }finally{clearTimeout(timer);}
}
export function PlatformConnectionRecovery({storeId,platform}:{storeId:string;platform:string}) {
  const {language}=useOsTranslation(),locale=String(language);
  const text=(ja:string,cn:string,tw:string,en:string)=>locale==='ja'?ja:locale==='zh-Hant'?tw:locale==='en'?en:cn;
  const [command,setCommand]=useState<Command|null>(null),[sending,setSending]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null),context=useRef(''),requestId=useRef<string|null>(null);
  const contextKey=`${storeId}:${platform}`;context.current=contextKey;
  const active=Boolean(command&&['pending','processing'].includes(command.status));
  useEffect(()=>{
    request.current?.abort();request.current=null;requestId.current=null;setCommand(null);setError('');setSending(false);
    return()=>request.current?.abort();
  },[storeId,platform]);
  useEffect(()=>{
    if(!active||!command)return;
    let stopped=false,running=false,read:AbortController|null=null;
    const check=async()=>{
      if(running)return;running=true;read=new AbortController();
      try {
        const body=await requestJson(`/api/bridge/connection-recovery?storeId=${encodeURIComponent(storeId)}&id=${encodeURIComponent(command.id)}`,{cache:'no-store'},read,15000);
        if(!body.command)throw Error('status_unavailable');
        if(!stopped&&context.current===contextKey){setCommand(body.command);setError('');}
      }catch{if(!stopped&&context.current===contextKey)setError('status_unavailable');}finally{running=false;}
    };
    const timer=setInterval(()=>void check(),3000);void check();
    return()=>{stopped=true;clearInterval(timer);read?.abort();};
  },[active,command?.id,storeId,contextKey]);
  const verifyUnknown=async()=>{
    if(!requestId.current)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setSending(true);
    try {
      const body=await requestJson(`/api/bridge/connection-recovery?storeId=${encodeURIComponent(storeId)}&platform=${encodeURIComponent(platform)}&requestId=${encodeURIComponent(requestId.current)}`,{cache:'no-store'},controller,15000);
      if(context.current!==contextKey||controller.signal.aborted)return;
      if(body.command){setCommand(body.command);setError('');}else setError('request_unknown');
    }catch{if(context.current===contextKey)setError('request_unknown');}
    finally{if(context.current===contextKey&&request.current===controller)setSending(false);}
  };
  const start=async()=>{
    if(error==='request_unknown'){await verifyUnknown();return;}
    if(!window.confirm(text('この店舗の指定プラットフォームに再接続します。実行中の処理が終わってから修復します。販売状態は変更せず、失敗した同期も再実行しません。続けますか？','将重新连接此门店的该平台，等待当前任务结束后修复。不改变销售状态，也不重试失败的同步。是否继续？','將重新連接此門店的該平台，等待目前工作結束後修復。不改變銷售狀態，也不重試失敗的同步。是否繼續？','Reconnect this platform for this store after the current task finishes? This will not change availability or retry failed syncs.')))return;
    request.current?.abort();const controller=new AbortController();request.current=controller;requestId.current=crypto.randomUUID();setSending(true);setError('');
    try {
      const body=await requestJson('/api/bridge/connection-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,platform,requestId:requestId.current})},controller,20000);
      if(!body.command||typeof body.command.id!=='string'||!['pending','processing','succeeded','failed'].includes(body.command.status))throw Error('result_unknown');
      if(!controller.signal.aborted&&context.current===contextKey)setCommand(body.command);
    }catch(failure){
      if(context.current===contextKey&&request.current===controller&&(!controller.signal.aborted||(failure instanceof Error&&failure.message==='request_timeout')))
        setError(failure instanceof Error&&'confirmedRejection' in failure&&failure.confirmedRejection===true?failure.message:'request_unknown');
    }finally{if(context.current===contextKey&&request.current===controller)setSending(false);}
  };
  const messages:Record<string,string>={
    request_unknown:text('要求がタイムアウトしました。結果は未確認です。修復結果を確認してから操作してください。','请求超时，结果未知。请先确认修复结果后再操作。','請求逾時，結果未知。請先確認修復結果後再操作。','The request timed out; its result is unknown. Check recovery results before taking another action.'),
    forbidden:text('この店舗を操作する権限がありません。','没有此门店的操作权限。','沒有此門店的操作權限。','You cannot manage this store.'),
    bridge_offline:text('Bridge の電源・接続を確認してください。','请检查 Bridge 电源和网络。','請檢查 Bridge 電源和網路。','Check the Bridge power and connection.'),
    bridge_update_required:text('Bridge の接続修復機能を確認できません。','无法确认 Bridge 支持连接修复。','無法確認 Bridge 支援連接修復。','Bridge connection recovery is unavailable.'),
    device_selection_required:text('店舗の Bridge 登録を管理者に確認してください。','请管理员检查门店 Bridge 注册，当前无法确定唯一服务器。','請管理員檢查門店 Bridge 註冊，目前無法確定唯一伺服器。','Ask an administrator to check this store’s Bridge registration.'),
    recovery_cooldown:text('1分待ってから再実行してください。','请间隔一分钟再修复。','請間隔一分鐘再修復。','Wait one minute before reconnecting again.'),
    status_unavailable:text('結果を取得できません。接続後に確認してください。','暂时无法取得结果，请恢复网络后确认。','暫時無法取得結果，請恢復網路後確認。','Results are unavailable. Check again when connected.')
  };
  if(!storeId||!['uber_eats','rocket_now','demae_can'].includes(platform))return null;
  return <div data-i18n-ignore>
    <button type="button" className="secondary-button compact-button" disabled={sending||active} onClick={()=>void start()}><RefreshCw size={14} aria-hidden="true"/>{error==='request_unknown'?text('修復結果を確認','确认修复结果','確認修復結果','Check recovery results'):text('接続を修復','修复连接','修復連接','Repair connection')}</button>
    <small role="status" style={{display:'block',overflowWrap:'anywhere'}}>{error?messages[error]||text('修復を開始できません。しばらくして再実行してください。','无法开始修复，请稍后再试。','無法開始修復，請稍後再試。','Unable to start recovery. Try again shortly.'):
      command?.status==='pending'?text('処理の完了を待って修復します。','已排队，等待当前任务结束后修复。','已排隊，等待目前工作結束後修復。','Queued until the current task finishes.'):
      command?.status==='processing'?text('再接続・動作確認中…','正在重连并检查页面…','正在重連並檢查頁面…','Reconnecting and checking the page…'):
      command?.status==='succeeded'&&command.result?.connectionRecovered===true&&command.result.inventoryChanged===false?text('接続を復旧しました。失敗した同期は販売状態の履歴で確認してください。','连接已恢复。请在销售状态历史中检查失败的同步。','連接已恢復。請在銷售狀態歷史中檢查失敗的同步。','Connection restored. Review failed syncs in availability history.'):
      command?.status==='failed'?text('復旧を確認できません。Bridge・ログイン状態を確認してください。','未能确认恢复，请检查 Bridge 和平台登录状态。','未能確認恢復，請檢查 Bridge 和平台登入狀態。','Recovery could not be confirmed. Check Bridge and platform sign-in.'):''}</small>
  </div>;
}
