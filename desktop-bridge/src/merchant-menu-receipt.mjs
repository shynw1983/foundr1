// Runs in the merchant browser. Keep this function self-contained so it can be
// serialized by CDP. Only explicitly keyed creations use this local journal.
export async function executeMenuRequest({path,method,body,successCode,origin,receiptKey}) {
  if(location.origin!==origin)throw Error('merchant_menu_origin_changed');
  const headers=body===undefined?{}:{'Content-Type':'application/json'};
  if(origin==='https://store.rocketnow.co.jp') {
    // Match Rocket's merchant request interceptor using this browser's real
    // environment. Never copy credentials/metadata from another session, cache
    // the timestamp, or persist these transient headers in creation receipts.
    headers.Accept='application/json';
    headers['X-Requested-With']='XMLHttpRequest';
    headers['X-Request-Meta']=btoa(JSON.stringify({
      o:location.origin,ua:navigator.userAgent.substring(0,100),
      r:(document.referrer||location.href).substring(0,200),t:Date.now(),
      sr:`${window.screen.width}x${window.screen.height}`,l:navigator.language
    }));
  }
  const key=receiptKey?`foundr1.menu-create.v1:${receiptKey}`:null;
  const intent=JSON.stringify({path,method,body});
  if(key) {
    const previous=localStorage.getItem(key);
    if(previous) {
      const saved=JSON.parse(previous);
      if(saved.status!=='rejected'&&saved.intent!==intent)throw Error('merchant_menu_receipt_intent_mismatch');
      if(saved.status==='received')return saved.data; // Receipt, not verification.
      if(saved.status!=='rejected')throw Error('merchant_menu_create_uncertain');
    }
    // If storage is unavailable/full, fail BEFORE creating anything remotely.
    localStorage.setItem(key,JSON.stringify({intent,status:'pending'}));
  }
  const response=await fetch(path,{
    method,credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:Object.keys(headers).length?headers:undefined,
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const value=await response.json().catch(()=>({}));
  if(!response.ok||value.code!==successCode) {
    // Demae's documented form validation failures reject before creation.
    // All other failures (including 5xx) keep the pending reservation.
    if(key&&successCode==='MSA0000'&&response.status===400&&['MWA0012','MWA0074'].includes(value.code))
      localStorage.setItem(key,JSON.stringify({intent,status:'rejected',rejectionCode:value.code}));
    throw Error(`merchant_menu_request_failed:${response.status}:${value.code??'unknown'}:${String(value.message??'').slice(0,160)}:${JSON.stringify(value.data??{}).slice(0,1200)}`);
  }
  // Save inside the browser BEFORE returning over CDP: a lost connection or
  // discarded caller return value can no longer lose the creation identity.
  if(key)localStorage.setItem(key,JSON.stringify({intent,status:'received',data:value.data}));
  return value.data;
}
