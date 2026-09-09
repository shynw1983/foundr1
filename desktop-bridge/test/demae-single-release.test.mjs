import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDemaeSingleRelease} from '../src/demae-single-release.mjs';
const target={kind:'option',targetId:'t',label:'thin'};
const payload={manualItemRelease:true,isAvailable:true,syncSource:'store',syncRunId:'r',targets:[target]};
test('single release reuses audit and includes only verified draft plans',async()=>{
 const plan={id:'1'};
 const result=await prepareDemaeSingleRelease({auditInventory:async()=>({items:[{...target,found:true,status:'staged',stagingVerified:true,releasePlan:plan}]})},payload);
 assert.deepEqual(result.targets,[{...target,releasePlan:plan}]);
});
test('unknown, ambiguous or unsafe draft aborts before writes',async()=>{
 for(const rows of [[],[{...target,found:false}],[{...target,found:true,status:'staged'}],[{...target,found:true,isAvailable:null}],[{...target,found:true,isAvailable:true},{...target,found:true,isAvailable:true}]])await assert.rejects(()=>prepareDemaeSingleRelease({auditInventory:async()=>({items:rows})},payload));
});
test('live targets need no release and nonmanual actions cannot release',async()=>{
 assert.deepEqual((await prepareDemaeSingleRelease({auditInventory:async()=>({items:[{...target,found:true,status:'available',isAvailable:true}]})},payload)).targets,[target]);
 for(const p of [{...payload,isAvailable:null},{...payload,syncSource:'scheduled'},{...payload,syncRunId:''}])await assert.rejects(()=>prepareDemaeSingleRelease({},p));
});
test('stockout of verified hidden draft is a no-op; unverified draft fails',async()=>{
 const down={...payload,isAvailable:false};
 const auditInventory=async()=>({items:[{...target,found:true,status:'staged',stagingVerified:true}]});
 assert.deepEqual((await prepareDemaeSingleRelease({auditInventory},down)).targets,[]);
 await assert.rejects(()=>prepareDemaeSingleRelease({auditInventory:async()=>({items:[{...target,found:true,status:'staged'}]})},down));
});
