import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

function fixture() {
 const target=(kind,id,parentId=null)=>({kind,targetId:id,sourceKey:`${kind}:${id}`,parentId,source:{groupIds:[]},name:id,price:kind==='item'?100:null,description:'',sortOrder:0,marker:'FS0123456789abcd',mappings:[{externalId:id}]});
 const targets=[target('category','old'),target('category','new'),target('item','food','new')];
 const payload={authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'demae_can',merchantId:'1',revision:1,newItemsHidden:true,imagePolicy:'read_only',targets};
 const rows=[{kind:'category',id:'old',name:'old',price:null,childIds:['food'],hidden:false},{kind:'category',id:'new',name:'new',price:null,childIds:[],hidden:true},{kind:'item',id:'food',name:'food',price:100,description:'',parentIds:['old'],groupIds:[],hidden:false,native:{categoryItemLinkList:[{categoryCode:'old'}]}}];
 const driver=new AuthorityNativeDriver({},payload);driver.snapshot=async()=>structuredClone(rows);
 const writes=[];
 driver.client.updateItem=async(id,patch)=>{
  writes.push(patch);const item=rows.find(row=>row.kind==='item'&&row.id===id);
  if(patch.categoryLinks){for(const row of rows.filter(row=>row.kind==='category'))row.childIds=row.childIds.filter(child=>child!==id);item.parentIds=patch.categoryLinks.map(link=>link.categoryCode);for(const parent of item.parentIds)rows.find(row=>row.kind==='category'&&row.id===parent).childIds.push(id);}
  if(patch.groupLinks)item.groupIds=patch.groupLinks.map(link=>link.optionGroupCode);
 };
 return {targets,payload,rows,driver,writes};
}
test('Demae category moves verify fresh memberships without changing availability',async()=>{
 const {payload,driver,rows,writes}=fixture();
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.deepEqual(writes,[{groupLinks:[],categoryLinks:[{categoryCode:'new'}],allowCategoryMove:true}]);
 assert.deepEqual(rows[0].childIds,[]);assert.deepEqual(rows[1].childIds,['food']);
 assert.equal(result.observations.find(row=>row.sourceKey==='item:food').hidden,false);
});
test('Demae unknown category members block the batch before any write',async()=>{
 const {payload,driver,rows,writes}=fixture();rows[0].childIds.push('unowned');
 await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/preflight_blocked/);
 assert.equal(writes.length,0);
});
test('Demae hidden drafts are never released as a category move',async()=>{
 const {payload,driver,rows,writes}=fixture();rows[0].childIds=[];rows[2].parentIds=[];rows[2].staged=true;rows[2].hidden=true;
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(writes.length,0);assert.equal(result.observations.find(row=>row.sourceKey==='item:food').hidden,true);
});
test('Demae retired items are detached before checking retained categories',async()=>{
 const {payload,driver,targets,rows}=fixture();targets[2].archived=true;let retired=0;
 driver.client.retireItem=async id=>{retired++;assert.equal(id,'food');rows[0].childIds=[];rows[2].parentIds=[];rows[2].native.categoryItemLinkList=[];rows[2].hidden=true;rows[2].staged=true;};
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(retired,1);assert.equal(result.observations.find(row=>row.sourceKey==='item:food').hidden,true);
 await runUberAuthorityPublication(payload,driver,async()=>{});assert.equal(retired,1);
});
test('Demae cannot retire a category that contains an unmanaged item',async()=>{
 const {payload,driver,targets,rows,writes}=fixture();targets[0].archived=true;rows[0].childIds.push('unowned');
 await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/retirement_unowned_item/);assert.equal(writes.length,0);
});
