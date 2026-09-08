import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeDraftClient} from '../src/demae-draft-client.mjs';

const area='FS0123456789abcd';
const live={chainId:1,menuPatternCode:'live',menuPatternName:'live',shopCountPerMenuPattern:1,displayShopCount:1,linkedShopList:[{shopId:2}]};
const draft={chainId:1,menuPatternCode:'draft',menuPatternName:`Foundr1 下書き ${area}`,shopCountPerMenuPattern:0,displayShopCount:0,linkedShopList:[]};
test('missing store-top image requires merchant setup, never copies or publishes an image',async()=>{
 let writes=0;
 const client=new DemaeDraftClient({request:async(path,method)=>{
  if(path.endsWith('/search/menu-pattern'))return {totalCount:2,isContinueNextPage:false,menuPatternList:[live,draft]};
  if(method&&method!=='GET')writes++;
  return {recommendCategory:null,categoryList:[]};
 }},'1','live');
 await assert.rejects(()=>client.ensureTopImage('draft'),/requires_merchant_setup/);
 assert.equal(writes,0);
});
test('unassigned menu creation is journaled before verification and never assigns shops',async()=>{
 const rows=[live],events=[];
 const transport={request:async(path,method,body,options)=>{
  if(path.endsWith('/search/menu-pattern'))return {totalCount:rows.length,isContinueNextPage:false,menuPatternList:structuredClone(rows)};
  if(path.endsWith('/linked-category-list'))return {recommendCategory:{chainId:1,categoryCode:'image'},categoryList:[]};
  assert.equal(path,'/merchant-admin/api/v1/product/chain/1/menu-pattern');
  assert.equal(method,'POST');assert.deepEqual(body.menuPatternCategoryLinkList,[]);
  assert.equal(options.receiptKey,`demae:1:draft:${area}`);
  events.push('create');rows.push(draft);return {chainId:1,menuPatternCode:'draft'};
 }};
 const client=new DemaeDraftClient(transport,'1','live');
 assert.equal(await client.ensurePattern(area,async()=>events.push('saved')),'draft');
 assert.equal(await client.ensurePattern(area,async()=>events.push('saved')),'draft');
 assert.deepEqual(events,['create','saved']);
});
test('assigned, truncated, unknown or foreign draft scope cannot pass',async()=>{
 for(const patch of [{shopCountPerMenuPattern:1},{displayShopCount:1},{linkedShopList:[{shopId:2}]},{chainId:9}]) {
  const c=new DemaeDraftClient({request:async()=>({totalCount:2,isContinueNextPage:false,menuPatternList:[live,{...draft,...patch}]})},'1','live');
  await assert.rejects(c.assertHiddenPattern('draft'),/assigned|scope_mismatch/);
 }
 const c=new DemaeDraftClient({request:async()=>({totalCount:3,isContinueNextPage:true,menuPatternList:[live,draft]})},'1','live');
 await assert.rejects(c.assertHiddenPattern('draft'),/incomplete/);
 await assert.rejects(c.assertHiddenPattern('live'),/is_live_pattern/);
});
test('draft categories must have exactly one association, to the unassigned pattern',()=>{
 const c=new DemaeDraftClient({},'1','live');
 c.assertCategoryLinks({chainId:1,menuPatternCategoryLinkList:[{menuPatternCode:'draft'}]},'draft');
 for(const links of [[],[{menuPatternCode:'live'}],[{menuPatternCode:'draft'},{menuPatternCode:'live'}]])
  assert.throws(()=>c.assertCategoryLinks({chainId:1,menuPatternCategoryLinkList:links},'draft'),/shared/);
});
test('new items are not written if the draft has become assigned',async()=>{
 let writes=0;
 const c=new DemaeDraftClient({request:async path=>{
  if(path.endsWith('/search/menu-pattern'))return {totalCount:2,isContinueNextPage:false,menuPatternList:[live,{...draft,shopCountPerMenuPattern:1}]};
  writes++;
 }},'1','live');
 await assert.rejects(c.createItem({patternId:'draft',category:{},marker:area,price:800,itemType:'REDUCED_RATE_NORMAL_ITEM'},async()=>{}),/assigned/);
 assert.equal(writes,0);
});
