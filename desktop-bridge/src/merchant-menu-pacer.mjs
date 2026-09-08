import {setTimeout as delay} from 'node:timers/promises';

// Native catalogs contain hundreds of related records. Do not fan them all
// out against a merchant session at once. Failures never trigger write retries.
export function createMerchantMenuPacer({intervalMs=250}={}) {
  let queue=Promise.resolve(),lastStarted=0;
  return operation=>{
    const next=queue.then(async()=>{
      const wait=intervalMs-(Date.now()-lastStarted);
      if(wait>0)await delay(wait);
      lastStarted=Date.now();
      return operation();
    });
    queue=next.catch(()=>undefined);
    return next;
  };
}
