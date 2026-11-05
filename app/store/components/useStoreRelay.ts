'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { RelayOwner,ScaleReading } from '../../../lib/store-relay-policy';
import type { PosScaleTareContext, PosScaleTareSettings } from '../../../lib/pos-scale-tare';
import type { PosScaleFilterSettings } from '../../../lib/pos-scale-filter';
export type RelayScaleFilterReading={source:'software_window';settingsRevision:string;toleranceGrams:number;settleMs:number;sampleCount:number;spanMs:number;rawGrams:number;accepted:boolean;minGrams?:number;maxGrams?:number;windowId?:string};
export type RelayStation={register_open?:boolean;scale_operating?:boolean;id:string;name:string;enabled:boolean;print_enabled:boolean;scale_enabled:boolean;epoch:number;owner_until:string|null;device_online:boolean;device_paired:boolean;scale_session:string|null;scale_sequence:number|string;scale_reading:(ScaleReading & {mode?:string;grossGrams?:number;tareGrams?:number;tarePresetId?:string;settingsRevision?:string;hardwareStable?:boolean;rawGrams?:number;filter?:RelayScaleFilterReading})|null;scale_received_at:string|null;scale_tare_settings?:PosScaleTareSettings;scale_tare_context?:PosScaleTareContext|Record<string,never>;scale_filter_settings?:PosScaleFilterSettings;device_status?:{scale?:string;printer?:string;scaleTareVersion?:number}};
export type RelayJob={id:string;station_id:string;kind:string;state:string;error:string;pickup_code:string;sequence:number;
  documentRole?:'kitchen'|'finishing'|'pickup'|'receipt'|'test';voidEligible?:boolean;reprintEligible?:boolean;receiptHasRefund?:boolean};
const registerClosed=(stations:RelayStation[])=>stations.length>0&&stations.every(s=>s.register_open===false);
const pollDelay=(stations:RelayStation[])=>registerClosed(stations)?60000:stations.some(s=>s.scale_session)?1000:stations.some(s=>s.enabled)?15000:60000;
const sameOwner=(a:RelayOwner|null,b:RelayOwner|null)=>Boolean(a&&b&&a.stationId===b.stationId&&a.epoch===b.epoch&&a.token===b.token);
async function relayStatusRequest(url:string,init?:RequestInit){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(url,{...init,signal:controller.signal});return {response,body:await response.json()};}
  catch(cause){if(controller.signal.aborted)throw new Error('接続を確認できませんでした。自動で再接続します。');throw cause;}
  finally{clearTimeout(timer);}
}
function parseOwner(value:string|null):RelayOwner|null{
  try{const owner=JSON.parse(value||'null');return owner&&typeof owner.stationId==='string'&&owner.stationId&&typeof owner.token==='string'&&owner.token&&Number.isSafeInteger(owner.epoch)?owner:null;}catch{return null;}
}
function savedOwner(storeId:string){
  const key=`store-relay-owner:${storeId}`;
  try{const saved=parseOwner(localStorage.getItem(key));if(saved)return saved;}catch{}
  try{return parseOwner(sessionStorage.getItem(key));}catch{return null;}
}
function durableOwner(storeId:string):RelayOwner|null|undefined{
  try{return parseOwner(localStorage.getItem(`store-relay-owner:${storeId}`));}catch{return undefined;}
}
function persistOwner(storeId:string,owner:RelayOwner){
  // Storage can be unavailable in private/restricted browsers; a successful
  // server claim must still work for this mounted page.
  for(const storage of ['localStorage','sessionStorage'] as const)try{window[storage].setItem(`store-relay-owner:${storeId}`,JSON.stringify(owner));}catch{}
  return durableOwner(storeId);
}
function removeSavedOwner(storeId:string,owner:RelayOwner){
  for(const storage of ['localStorage','sessionStorage'] as const)try{
    const key=`store-relay-owner:${storeId}`;
    if(sameOwner(parseOwner(window[storage].getItem(key)),owner))window[storage].removeItem(key);
  }catch{}
}
export function useStoreRelay(storeId:string){
  const [stations,setStations]=useState<RelayStation[]>([]),[jobs,setJobs]=useState<RelayJob[]>([]),[owner,setOwner]=useState<RelayOwner|null>(null),[error,setError]=useState('');
  const [rememberedStationId,setRememberedStationId]=useState<string|null>(null);
  const [recoveryVersion,setRecoveryVersion]=useState(0);
  const recoveryVersionRef=useRef(0);
  const rememberedRef=useRef<RelayOwner|null>(null);
  const knownStoredRef=useRef<RelayOwner|null|undefined>(undefined);
  const generationRef=useRef(0);
  const renewRef=useRef<(()=>Promise<void>)|null>(null);
  const renewFlightRef=useRef<{generation:number;owner:RelayOwner;promise:Promise<void>}|null>(null);
  const requestRef=useRef(0);
  const refreshFlightRef=useRef<{storeId:string;requestId:number;promise:Promise<RelayStation[]|undefined>}|null>(null);
  const [cachedRequired,setCachedRequired]=useState(false);
  const stationRef=useRef<RelayStation[]>([]);
  const reschedulePollRef=useRef<((delay:number)=>void)|null>(null);
  const ownerRef=useRef(owner);ownerRef.current=owner;
  const scopeRef=useRef(storeId);scopeRef.current=storeId;
  const pause=useCallback(()=>{
    if(ownerRef.current){recoveryVersionRef.current++;setRecoveryVersion(recoveryVersionRef.current);}
    ownerRef.current=null;setOwner(null);
  },[]);
  const forget=useCallback((expected:RelayOwner)=>{
    if(!sameOwner(rememberedRef.current,expected))return;
    rememberedRef.current=null;setRememberedStationId(null);pause();removeSavedOwner(storeId,expected);
  },[storeId,pause]);
  // Device wall clocks are not measurement clocks. Keep an upper bound on the
  // server time using monotonic elapsed time and the GET's network round trip.
  const clockRef=useRef<{storeId:string;serverNow:number;receivedAt:number;networkMs:number}|null>(null);
  const now=useCallback(()=>{
    const clock=clockRef.current;
    if(!clock||clock.storeId!==scopeRef.current)return Number.NaN;
    const elapsed=performance.now()-clock.receivedAt;
    return Number.isFinite(elapsed)&&elapsed>=0?clock.serverNow+clock.networkMs+elapsed:Number.NaN;
  },[]);
  const refresh=useCallback(async()=>{
    if(!storeId)return;
    const generation=generationRef.current;
    const requestId=++requestRef.current;
    const requestedAt=performance.now();
    const promise=(async()=>{
    try{
    const {response,body}=await relayStatusRequest(`/api/store/device-relay?storeId=${encodeURIComponent(storeId)}`,{cache:'no-store'});
    if(scopeRef.current!==storeId||generationRef.current!==generation)return;
    if(requestId!==requestRef.current){
      // A mutation/recovery caller still needs the newest delivered snapshot.
      // Only follow a newer same-store flight; never return an older GET's data.
      const latest=refreshFlightRef.current;
      if(latest?.storeId===storeId&&latest.requestId>requestId)return latest.promise;
      return;
    }
    if(!response.ok){
      if([401,403].includes(response.status)&&rememberedRef.current)forget(rememberedRef.current);
      throw Object.assign(new Error(body.error||'設備状態を確認できません。'),{status:response.status});
    }
    const receivedAt=performance.now();
    const roundTripMs=Math.max(0,receivedAt-requestedAt);
    const serverNow=typeof body.serverNow==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.serverNow)?Date.parse(body.serverNow):Number.NaN;
    const serverElapsedMs=typeof body.serverElapsedMs==='number'&&Number.isFinite(body.serverElapsedMs)
      &&body.serverElapsedMs>=0&&body.serverElapsedMs<=roundTripMs+1?Math.min(body.serverElapsedMs,roundTripMs):0;
    clockRef.current=Number.isFinite(serverNow)?{storeId,serverNow,receivedAt,networkMs:Math.max(0,roundTripMs-serverElapsedMs)}:null;
    const required=(body.stations||[]).some((s:RelayStation)=>s.enabled&&(s.print_enabled||s.scale_enabled));
    setCachedRequired(required);
    try{localStorage.setItem(`store-relay-capabilities:v1:${storeId}`,String(required));}catch{}
    const wasClosed=registerClosed(stationRef.current);
    const previousDelay=pollDelay(stationRef.current);
    stationRef.current=body.stations||[];setStations(body.stations||[]);setJobs(body.jobs||[]);
    // A session started by a mutation must not inherit the old five-second idle timer.
    const nextDelay=pollDelay(stationRef.current);
    if(nextDelay!==previousDelay)reschedulePollRef.current?.(nextDelay);
    if(registerClosed(stationRef.current)){pause();setError('');}
    else if(wasClosed)void renewRef.current?.();
    const current=rememberedRef.current;
    const checkedAt=now();
    if(current){
      const station=(body.stations as RelayStation[]).find(s=>s.id===current.stationId&&s.epoch===current.epoch&&s.enabled);
      if(!station)forget(current);
      else if(Number.isFinite(checkedAt)&&!(Date.parse(station.owner_until||'')>checkedAt)){
        // Lease expiry pauses use, but is not proof that this device was replaced.
        // Only a validated resume may reactivate the remembered credential.
        pause();void renewRef.current?.();
      }
    }
    return body.stations as RelayStation[];
    }catch(cause){
      if(scopeRef.current!==storeId||generationRef.current!==generation)return;
      const latest=refreshFlightRef.current;
      if(latest?.storeId===storeId&&latest.requestId>requestId)return latest.promise;
      throw cause;
    }
    })();
    refreshFlightRef.current={storeId,requestId,promise};
    return promise;
  },[storeId,now,forget,pause]);
  const renew=useCallback(async()=>{
    const expected=rememberedRef.current;
    if(!storeId||!expected||document.visibilityState==='hidden'||registerClosed(stationRef.current))return;
    const generation=generationRef.current;
    const existing=renewFlightRef.current;
    if(existing?.generation===generation&&sameOwner(existing.owner,expected))return existing.promise;
    const isCurrent=()=>scopeRef.current===storeId&&generationRef.current===generation&&sameOwner(rememberedRef.current,expected);
    const promise=(async()=>{
      try{
        const {response,body:result}=await relayStatusRequest('/api/store/device-relay',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({storeId,owner:expected,action:sameOwner(ownerRef.current,expected)?'heartbeat':'resume'})});
        if(!isCurrent())return;
        if(!response.ok){
          setError(result.error||'設備の操作を完了できません。');
          if([401,403,409].includes(response.status))forget(expected);
          throw new Error(result.error||'設備の操作を完了できません。');
        }
        // Expired renewal retires live weighing even if the browser's cached
        // lease looked active. Saved cart captures keep their original epoch.
        if(result.resumed){
          recoveryVersionRef.current++;setRecoveryVersion(recoveryVersionRef.current);pause();
        }
        const latest=await refresh();if(!isCurrent()||document.visibilityState==='hidden')return;
        const checkedAt=now();
        if(registerClosed(latest||[]))return;
        if(!latest?.some(s=>s.id===expected.stationId&&s.epoch===expected.epoch&&s.enabled
          &&Number.isFinite(checkedAt)&&Date.parse(s.owner_until||'')>checkedAt))return;
        // Another tab can explicitly replace this browser's choice while our
        // response is in flight. Renewal must not overwrite that newer choice.
        const stored=durableOwner(storeId);
        // A failed storage write may leave our own prior choice behind. It is
        // not another tab's replacement unless it changed since our last save.
        if(stored&&!sameOwner(stored,expected)&&!sameOwner(stored,knownStoredRef.current||null)){forget(expected);return;}
        ownerRef.current=expected;setOwner(expected);setError('');
        const persisted=persistOwner(storeId,expected);if(persisted!==undefined)knownStoredRef.current=persisted;
      }catch(cause){
        if(!isCurrent())return;
        pause();setError(cause instanceof Error?cause.message:'設備状態を確認できません。');
      }
    })();
    const flight={generation,owner:expected,promise};renewFlightRef.current=flight;
    try{await promise;}finally{if(renewFlightRef.current===flight)renewFlightRef.current=null;}
  },[storeId,refresh,now,forget,pause]);
  renewRef.current=renew;
  const action=useCallback(async(action:string,extra:Record<string,unknown>={})=>{
    if(action==='resume'||action==='heartbeat'){await renew();return {ok:Boolean(ownerRef.current)};}
    const generation=generationRef.current;
    if(scopeRef.current===storeId)setError('');
    const response=await fetch('/api/store/device-relay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,owner:ownerRef.current,action,...extra})});
    const result=await response.json();if(!response.ok){
      const message=result.error||'設備の操作を完了できません。';
      if(scopeRef.current===storeId&&generationRef.current===generation)setError(message);
      throw Object.assign(new Error(message),{status:response.status});
    }
    if(scopeRef.current===storeId&&generationRef.current===generation){
      if(result.owner){
        rememberedRef.current=result.owner;setRememberedStationId(result.owner.stationId);ownerRef.current=result.owner;setOwner(result.owner);
        const persisted=persistOwner(storeId,result.owner);if(persisted!==undefined)knownStoredRef.current=persisted;
      }
      // An immutable, server-confirmed capture can fill the POS immediately. Its
      // status refresh still uses the same store/request fences, but cannot delay it.
      const updated=refresh().catch(e=>{if(scopeRef.current===storeId)setError(e instanceof Error?e.message:'設備状態を確認できません。');});
      if(action!=='scaleAdopt')await updated;
    }
    return result;
  },[storeId,refresh,renew]);
  useEffect(()=>{
    generationRef.current++;
    renewFlightRef.current=null;
    rememberedRef.current=null;setRememberedStationId(null);
    knownStoredRef.current=undefined;
    stationRef.current=[];ownerRef.current=null;clockRef.current=null;setStations([]);setJobs([]);setOwner(null);setError('');
    if(!storeId){setCachedRequired(false);return;}
    try{setCachedRequired(localStorage.getItem(`store-relay-capabilities:v1:${storeId}`)==='true');}catch{setCachedRequired(false);}
    const saved=savedOwner(storeId);
    if(saved){rememberedRef.current=saved;knownStoredRef.current=durableOwner(storeId);setRememberedStationId(saved.stationId);}
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    let fetching=false;
    let failures=0;
    const schedule=(delay:number)=>{
      clearTimeout(timer);
      if(active&&!fetching&&document.visibilityState!=='hidden')timer=setTimeout(tick,delay);
    };
    const tick=async()=>{
      if(!active||fetching||document.visibilityState==='hidden')return;
      clearTimeout(timer);fetching=true;
      const requestedAt=performance.now();
      try{await refresh();failures=0;}catch(e){failures++;if(active&&!registerClosed(stationRef.current))setError(e instanceof Error?e.message:'設備状態を確認できません。');}
      fetching=false;
      const delay=failures?Math.min(60000,5000*2**Math.min(failures-1,4)):pollDelay(stationRef.current);
      // Active weighing should not add another second after a slow status GET.
      // Requests remain serialized; idle/background capability polling is unchanged.
      schedule(delay===1000?Math.max(0,delay-(performance.now()-requestedAt)):delay);
    };
    reschedulePollRef.current=schedule;
    const wake=()=>{if(document.visibilityState!=='hidden'){void renew();void tick();}};
    const visible=()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);pause();}else wake();};
    window.addEventListener('focus',wake);window.addEventListener('online',wake);document.addEventListener('visibilitychange',visible);
    void renew();void tick();return()=>{active=false;generationRef.current++;clearTimeout(timer);if(reschedulePollRef.current===schedule)reschedulePollRef.current=null;window.removeEventListener('focus',wake);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',visible);};
  },[storeId,refresh,renew,pause]);
  useEffect(()=>{
    if(!storeId)return;
    const timer=setInterval(()=>{void renew();},12000);
    return()=>clearInterval(timer);
  },[storeId,renew]);
  const station=stations.find(s=>s.id===owner?.stationId);
  return {stations,jobs,owner,station,error,action,recoveryVersion,registerClosed:registerClosed(stations),recoveringStationId:owner||registerClosed(stations)?null:rememberedStationId,required:cachedRequired||stations.some(s=>s.enabled&&(s.print_enabled||s.scale_enabled)),refresh,now};
}
