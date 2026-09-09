import { CdpPage } from './cdp-page.mjs';
import { executeMenuRequest } from './merchant-menu-receipt.mjs';
import {createMerchantMenuPacer} from './merchant-menu-pacer.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {menuRequestAction} from './menu-progress.mjs';

export async function retryTransientMenuRead(method,operation,wait=delay) {
  for(let attempt=0;;attempt++) {
    try{return await operation();}
    catch(error) {
      // Only repeat read-only requests, never authentication/input failures
      // or writes whose acknowledgement could have been lost.
      if(method!=='GET'||attempt>=2||!/Failed to fetch|Runtime\.evaluate timeout|AbortError|TimeoutError|timed out|network error/i.test(error.message))throw error;
      await wait(500*(attempt+1));
    }
  }
}

// Requests remain inside the authenticated merchant browser. Never export its
// cookies or replay requests against an unverified origin.
export async function connectMerchantMenuClient(session, origin, successCode, onProgress=async()=>{}) {
  const page = await CdpPage.connect(await session.ensureRunning(), origin);
  const paced=createMerchantMenuPacer();
  if (await page.evaluate('location.origin') !== origin) {
    page.close();
    throw new Error('merchant_menu_origin_mismatch');
  }
  return {
    close: () => page.close(),
    async creationReceipt(receiptKey) {
      if(!/^[A-Za-z0-9:_-]{1,160}$/.test(receiptKey))throw Error('merchant_menu_receipt_key_invalid');
      return page.evaluate(`(() => {if(location.origin!==${JSON.stringify(origin)})throw Error('merchant_menu_origin_changed');const value=localStorage.getItem(${JSON.stringify(`foundr1.menu-create.v1:${receiptKey}`)});return value?JSON.parse(value):null;})()`);
    },
    async request(path, method = 'GET', body, {receiptKey} = {}) {
      if (!path.startsWith('/api/') && !path.startsWith('/merchant-admin/api/')) throw new Error('merchant_menu_path_invalid');
      if(receiptKey && (method!=='POST'||!/^[A-Za-z0-9:_-]{1,160}$/.test(receiptKey)))throw Error('merchant_menu_receipt_key_invalid');
      // Writes are deliberately not retried here. Create retry safety belongs
      // to the persistent authority reservation/marker protocol.
      const action=menuRequestAction(path,method);
      let attempt=0;
      const result=await retryTransientMenuRead(method,async()=>{
        await onProgress({action,state:attempt++?'retrying':'waiting',retry:attempt-1});
        return paced(async()=>{
        try {return await page.evaluate(`(${executeMenuRequest.toString()})(${JSON.stringify({path,method,body,successCode,origin,receiptKey})})`);}
        catch(error) {throw new Error(`merchant_menu_operation_failed:${method}:${path}:${error.message}`,{cause:error});}
        });
      });
      await onProgress({action,state:'received'});
      return result;
    }
  };
}

// Compare API records without depending on object-key order. Array order is
// intentional: relationship ordering is menu content, not incidental metadata.
export function sameMenuValue(left, right) {
  const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function positiveId(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) <= 0) throw new Error('merchant_menu_id_invalid');
  return text;
}

export function yen(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('merchant_menu_price_invalid');
  return value;
}
