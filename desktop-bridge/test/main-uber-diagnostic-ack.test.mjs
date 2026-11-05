import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createBridgePollSchedule} from '../src/poll-schedule.mjs';

// Execute the actual final run-loop catch block without loading main.mjs's
// configuration, launching browsers, polling commands or making network calls.
const mainPath=process.env.BRIDGE_MAIN_UNDER_TEST||new URL('../src/main.mjs',import.meta.url);
const mainSource=readFileSync(mainPath,'utf8');
const marker='  } catch (error) {';
const start=mainSource.lastIndexOf(marker),end=mainSource.lastIndexOf('\n  }\n}');
assert.ok(start>mainSource.lastIndexOf('const api = new BridgeApiClient(config);'));
assert.ok(end>start&&/^\n  \}\n\}\s*$/u.test(mainSource.slice(end)), 'Expected the actual final run-loop catch');
const catchBody=mainSource.slice(start+marker.length,end);
const hasAuthoritativeAckHint=catchBody.includes('authoritativePublication: command.payload?.authoritativePublication === true');
const hasRecoveryGuard=catchBody.includes('recoveryGuard.record(');
const executeCatch=new Script(`(async () => {${catchBody}\n})()`,{filename:'main.mjs:actual-run-loop-catch'});

async function captureAck({message,diagnostic,platform='uber_eats',payload={},ackError}={}) {
  const calls=[],finishes=[],waits=[],logs=[],recoveryRecords=[];
  const error=new Error(message);
  if(diagnostic)error.diagnostic=diagnostic;
  const command={id:'test-command',type:'capture_menu_snapshot',platform,payload};
  await executeCatch.runInNewContext({
    Error,error,command,console:{error:(...values)=>logs.push(values)},
    config:{pollIntervalMs:5000},pollSchedule:createBridgePollSchedule(5000),commandWake:{wait:async ms=>{waits.push(ms);}},delay:async ms=>{waits.push(ms);},
    publicError:value=>value,
    // Optional installed recovery extension remains in the executed source.
    // Disable only recovery activation, never the ACK call or its rejection.
    recoveryGuard:{record:(...args)=>{recoveryRecords.push(args);return false;}},
    localStatus:{state:{},finish:async(...args)=>{finishes.push(args);},save:async()=>{}},
    api:{acknowledge:async(...args)=>{calls.push(args);if(ackError)throw ackError;}}
  },{timeout:1000});
  assert.equal(recoveryRecords.length,hasRecoveryGuard?1:0);
  if(hasRecoveryGuard)assert.deepEqual(recoveryRecords[0],[platform,message]);
  return {calls,finishes,waits,logs,command};
}

function assertAckHint(args,authoritativePublication) {
  assert.equal(args.length,hasAuthoritativeAckHint?5:4);
  if(hasAuthoritativeAckHint)assert.equal(args[4].authoritativePublication,authoritativePublication);
}

test('actual main ACK preserves a retry-classifiable timeout and attaches human guidance separately',async()=>{
  const message='uber_eats_page_unresponsive:menu_load:CDP Runtime.evaluate timeout';
  const diagnostic={platform:'uber_eats',error:'uber_eats_page_unresponsive',stage:'menu_load',
    problem:'Uber 専用画面が応答していません。接続を確認し、必要なら接続をリセットしてください。'};
  const captured=await captureAck({message,diagnostic,payload:{authoritativeSource:true}});
  assert.equal(captured.calls.length,1);
  const [id,status,result,error]=captured.calls[0];
  assert.equal(id,'test-command');assert.equal(status,'failed');
  assert.equal(error,message);assert.notEqual(error,diagnostic.problem);
  assert.match(error,/timeout/iu);assert.equal(result.diagnostic,diagnostic);
  assert.equal(result.diagnostic.problem,diagnostic.problem);
  assertAckHint(captured.calls[0],false);
  assert.equal(captured.finishes[0][0],captured.command);assert.equal(captured.finishes[0][1],message);
  assert.deepEqual(captured.waits,[10000]);
});

test('actual main ACK preserves login-required identity and the authoritative publication timeout hint',async()=>{
  const message='uber_eats_login_required:menu_load:url=https://auth.uber.com/v2/:anchors=0';
  const diagnostic={platform:'uber_eats',error:'uber_eats_login_required',loginRequired:true,
    problem:'Uber 専用画面にログインしてから再試行してください。'};
  const {calls}=await captureAck({message,diagnostic,payload:{authoritativePublication:true}});
  assert.equal(calls[0][1],'failed');assert.equal(calls[0][3],message);
  assert.equal(calls[0][2].diagnostic,diagnostic);assert.match(calls[0][3],/login_required/u);
  assertAckHint(calls[0],true);
});

test('another platform cannot receive Uber diagnostic metadata or replace its actual failure',async()=>{
  const message='demae_can_verification_failed';
  const {calls}=await captureAck({message,platform:'demae_can',diagnostic:{platform:'uber_eats',problem:'not this platform'}});
  assert.equal(calls[0][3],message);assert.equal(Object.keys(calls[0][2]).length,0);
  assert.equal(calls[0][1],'failed');
  assertAckHint(calls[0],false);
});

test('actual main reports failed ACK delivery without inventing a successful acknowledgement',async()=>{
  const captured=await captureAck({message:'uber_eats_login_required',diagnostic:{platform:'uber_eats',problem:'human guidance'},
    ackError:new Error('offline simulated HTTP 409')});
  assert.equal(captured.calls.length,1);assert.equal(captured.calls[0][1],'failed');
  assert.equal(captured.calls[0][3],'uber_eats_login_required');
  assertAckHint(captured.calls[0],false);
  assert.ok(captured.logs.some(values=>values.includes('acknowledgement failed')&&values.includes('offline simulated HTTP 409')));
  assert.deepEqual(captured.waits,[10000]);
});
