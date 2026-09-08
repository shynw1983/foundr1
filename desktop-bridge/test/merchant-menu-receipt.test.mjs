import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {executeMenuRequest} from '../src/merchant-menu-receipt.mjs';

function browser({failStorage=false,timeout=false,rejectOnce=''}={}) {
 const data=new Map();let writes=0;
 const context=vm.createContext({location:{origin:'https://merchant.test'},AbortSignal,
  localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(failStorage)throw Error('storage full');data.set(key,value);}},
  fetch:async()=>{writes++;if(timeout)throw Error('timeout');if(rejectOnce&&writes===1)return {ok:false,status:400,json:async()=>({code:rejectOnce})};return {ok:true,status:200,json:async()=>({code:rejectOnce?'MSA0000':'OK',data:{optionCode:'001'}})};}
 });
 const args={path:'/api/option',method:'POST',body:{name:'marker'},origin:'https://merchant.test',successCode:'OK',receiptKey:'chain:1:marker'};
 return {data,writes:()=>writes,run:patch=>vm.runInContext(`(${executeMenuRequest.toString()})(${JSON.stringify({...args,...patch})})`,context)};
}
test('discarded successful response is recoverable without another merchant write',async()=>{
 const b=browser();await b.run();
 assert.equal(JSON.parse([...b.data.values()][0]).data.optionCode,'001');
 assert.equal((await b.run()).optionCode,'001');assert.equal(b.writes(),1);
});
test('a recorded explicit validation rejection permits corrected input, unknown errors do not',async()=>{
 const b=browser({rejectOnce:'MWA0074'});
 await assert.rejects(b.run({successCode:'MSA0000'}),/MWA0074/);
 assert.equal((await b.run({successCode:'MSA0000',body:{name:'corrected'}})).optionCode,'001');
 assert.equal(b.writes(),2);
 const unknown=browser({rejectOnce:'MWA_UNKNOWN'});
 await assert.rejects(unknown.run({successCode:'MSA0000'}),/MWA_UNKNOWN/);
 await assert.rejects(unknown.run({successCode:'MSA0000'}),/create_uncertain/);
 assert.equal(unknown.writes(),1);
});
test('storage failure blocks creation before request',async()=>{
 const b=browser({failStorage:true});await assert.rejects(b.run(),/storage full/);assert.equal(b.writes(),0);
});
test('uncertain network result cannot cause a duplicate on retry',async()=>{
 const b=browser({timeout:true});await assert.rejects(b.run(),/timeout/);
 await assert.rejects(b.run(),/create_uncertain/);assert.equal(b.writes(),1);
});
test('receipt cannot be reused for a changed request or another origin',async()=>{
 const b=browser();await b.run();
 await assert.rejects(b.run({body:{name:'other'}}),/intent_mismatch/);
 await assert.rejects(b.run({origin:'https://other.test'}),/origin_changed/);
 assert.equal(b.writes(),1);
});

test('Rocket uses fresh real-browser metadata on reads and writes without journaling headers',async()=>{
 const origin='https://store.rocketnow.co.jp',requests=[],storage=new Map();let now=1000;
 const context=vm.createContext({location:{origin,href:origin+'/merchant/management/menu/118575'},
  navigator:{userAgent:'Actual browser '.repeat(12),language:'ja-JP'},document:{referrer:''},
  window:{screen:{width:1440,height:900}},Date:{now:()=>now},AbortSignal,
  btoa:value=>Buffer.from(value,'binary').toString('base64'),
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  fetch:async(path,options)=>{requests.push({path,options});return {ok:true,status:200,json:async()=>({code:'SUCCESS',data:{optionItemId:123}})};}
 });
 const run=args=>vm.runInContext(`(${executeMenuRequest.toString()})(${JSON.stringify({origin,successCode:'SUCCESS',...args})})`,context);
 await run({path:'/api/read',method:'GET'});
 now=2000;
 await run({path:'/api/create',method:'POST',body:{name:'marker'},receiptKey:'rocket:1:option:marker'});
 for(const [index,{options}] of requests.entries()) {
  assert.equal(options.headers.Accept,'application/json');
  assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest');
  const meta=JSON.parse(Buffer.from(options.headers['X-Request-Meta'],'base64').toString('binary'));
  assert.deepEqual(meta,{o:origin,ua:'Actual browser '.repeat(12).substring(0,100),r:origin+'/merchant/management/menu/118575',t:(index+1)*1000,sr:'1440x900',l:'ja-JP'});
  assert.equal(options.credentials,'include');
  assert.equal(options.cache,'no-store');
 }
 assert.equal(requests[0].options.headers['Content-Type'],undefined);
 assert.equal(requests[1].options.headers['Content-Type'],'application/json');
 assert.equal(requests[1].options.body,JSON.stringify({name:'marker'}));
 assert.ok([...storage.values()].every(value=>!value.includes('X-Request-Meta')));
 await run({path:'/api/create',method:'POST',body:{name:'marker'},receiptKey:'rocket:1:option:marker'});
 assert.equal(requests.length,2);
});

test('other merchant origins do not receive Rocket request metadata',async()=>{
 let options;
 const context=vm.createContext({location:{origin:'https://partner.demae-can.com'},AbortSignal,
  fetch:async(_path,input)=>{options=input;return {ok:true,status:200,json:async()=>({code:'MSA0000',data:[]})};}
 });
 await vm.runInContext(`(${executeMenuRequest.toString()})(${JSON.stringify({origin:'https://partner.demae-can.com',path:'/merchant-admin/api/read',method:'GET',successCode:'MSA0000'})})`,context);
 assert.equal(options.headers,undefined);
});
