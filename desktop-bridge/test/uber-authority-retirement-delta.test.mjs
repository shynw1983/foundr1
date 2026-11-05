import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

function fixture(kind='item',initial='hidden') {
 const target={kind,sourceKey:`${kind}:retired`,targetId:'retired',name:'retired',price:227,description:'',
  archived:true,marker:'FS0123456789abcd',mappings:[{externalId:'4'}]};
 const payload={authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'rocket_now',merchantId:'1',
  revision:1,newItemsHidden:true,imagePolicy:'read_only',targets:[target]};
 const rows=initial==='absent'?[]:[{kind,id:'4',name:'retired',price:227,hidden:initial==='hidden',parentIds:[],groupIds:[],childIds:[]}];
 const driver=new AuthorityNativeDriver({},payload),reads=[],writes=[];
 driver.snapshot=async options=>{reads.push(options);return structuredClone(rows);};
 driver.client.updateDish=async(id,patch)=>{writes.push({id,patch});};
 driver.client.retireOption=async id=>{writes.push({option:id});};
 return {payload,target,driver,rows,reads,writes};
}

for(const [kind,initial] of [['item','hidden'],['item','absent'],['option','absent'],
 ['category','hidden'],['category','absent'],['option_group','hidden'],['option_group','absent']]) {
 test(`Rocket known retired ${kind}/${initial} requires no per-target full read or mutation`,async()=>{
  const {payload,target,driver,reads,writes}=fixture(kind,initial);
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  const count=reads.length;
  await driver.retire(target);
  assert.equal(reads.length,count);assert.deepEqual(writes,[]);
 });

 test(`Rocket retired ${kind}/${initial} still fails when fresh final native state becomes visible`,async()=>{
  for(const visibleAtEnd of [false,true]) {
   const {payload,driver,reads,writes}=fixture(kind,initial);
   const beginPhase=driver.beginPhase.bind(driver),snapshot=driver.snapshot;let verifying=false;
   driver.beginPhase=async(...args)=>{if(args[0]==='verifying')verifying=true;return beginPhase(...args);};
   driver.snapshot=async options=>{
    const rows=await snapshot(options);
    if(verifying&&visibleAtEnd)return [{kind,id:'4',name:'retired',price:227,hidden:false,parentIds:[],groupIds:[],childIds:[]}];
    return rows;
   };
   if(visibleAtEnd)await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/retirement_unverified/);
   else {
    const result=await runUberAuthorityPublication(payload,driver,async()=>{});
    assert.equal(result.observations[0].exists,initial!=='absent');
   }
   // Preflight, relationship, category and final reads remain independent;
   // there is no extra full-menu scan for this already-retired object.
   assert.equal(reads.length,4);assert.deepEqual(writes,[]);
  }
 });
}

test('Rocket absence proof uses exact native kind and ID, including overlapping ID values',async()=>{
 const {payload,target,driver,rows,reads,writes}=fixture('item','absent');
 rows.push({kind:'option',id:'4',name:'another native kind',price:227,hidden:false,parentIds:['group']});
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
 await driver.retire(target);
 assert.equal(reads.length,1);assert.deepEqual(writes,[]);
});

test('Rocket visible items and present options retain their fresh retirement guards',async()=>{
 for(const kind of ['item','option']) {
  const {payload,target,driver,reads,writes}=fixture(kind,kind==='item'?'visible':'hidden');
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  await driver.retire(target);
  assert.equal(reads.length,2);
  assert.deepEqual(writes,kind==='item'?[{id:'4',patch:{retire:true}}]:[{option:'4'}]);
 }
});

test('Rocket visible retired parents retain fresh reads and fail without mutation',async()=>{
 for(const kind of ['category','option_group']) {
  const {payload,target,driver,reads,writes}=fixture(kind,'visible');
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  await assert.rejects(()=>driver.retire(target),/parent_still_available/);
  assert.equal(reads.length,2);assert.deepEqual(writes,[]);
 }
});

test('Rocket unverified or unknown retirement hints cannot skip fresh native reads',async()=>{
 for(const proof of ['none','outside_payload','ambiguous']) {
  const {payload,target,driver,rows,reads,writes}=fixture();
  if(proof==='none')driver.contentSnapshot=structuredClone(rows);
  else {
   if(proof==='ambiguous')rows.push({...rows[0],hidden:false});
   assert.deepEqual((await driver.preflight(payload)).issues,[]);
  }
  const before=reads.length;
  await driver.retire(proof==='outside_payload'?{...target}:target);
  assert.equal(reads.length,before+1,proof);assert.deepEqual(writes,[]);
 }
});

test('a failed later Rocket preflight invalidates earlier retirement no-op proof',async()=>{
 const {payload,target,driver,rows,reads,writes}=fixture();
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
 const snapshot=driver.snapshot;
 driver.snapshot=async()=>{throw Error('latest native read unavailable');};
 await assert.rejects(()=>driver.preflight(payload),/latest native read unavailable/);
 rows[0].hidden=false;driver.snapshot=snapshot;
 await driver.retire(target);
 assert.equal(reads.length,2);assert.deepEqual(writes,[{id:'4',patch:{retire:true}}]);
});
