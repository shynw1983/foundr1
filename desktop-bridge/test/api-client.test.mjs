import assert from 'node:assert/strict';
import test from 'node:test';
import {BridgeApiClient} from '../src/api-client.mjs';

test('only failed authoritative publication ACK waits for bounded server name preparation', async () => {
  const originalFetch=globalThis.fetch, originalTimeout=AbortSignal.timeout;
  const requests=[],timeouts=[];
  AbortSignal.timeout=(ms)=>{timeouts.push(ms);return new AbortController().signal;};
  globalThis.fetch=async (url,init)=>{requests.push({url,init});return Response.json({ok:true});};
  try {
    const api=new BridgeApiClient({serverUrl:'https://example.invalid',storeId:'store',bridgeToken:'test-only'});
    await api.acknowledge('job','failed',{},'native name rejection',{authoritativePublication:true});
    await api.acknowledge('job','failed',{},'network');
    await api.acknowledge('job','succeeded',{},'',{authoritativePublication:true});
    await api.reportProgress('job',{phase:'verifying'});
    await api.nextCommand();
    assert.deepEqual(timeouts,[45000,20000,20000,20000,20000]);
    assert.deepEqual(JSON.parse(requests[0].init.body),{commandId:'job',status:'failed',result:{},error:'native name rejection'});
    assert(requests.every(({init})=>init.signal instanceof AbortSignal));
    assert.equal(requests[0].init.headers.Authorization,'Bearer test-only');
    assert(requests.every(({init})=>!Object.hasOwn(init,'timeoutMs')));
  } finally {globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});

test('ACK HTTP failures remain failures rather than being treated as prepared or succeeded', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async ()=>Response.json({error:'Command changed'},{status:409});
  try {
    const api=new BridgeApiClient({serverUrl:'https://example.invalid',storeId:'store',bridgeToken:'test-only'});
    await assert.rejects(api.acknowledge('job','failed',{},'name',{authoritativePublication:true}),/Foundr1 HTTP 409: Command changed/);
  } finally {globalThis.fetch=originalFetch;}
});
