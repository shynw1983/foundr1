import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';

for(const mode of ['success','assigned','shared','ignored','changed','timeout'])test(`Demae retirement into unassigned category: ${mode}`,async()=>{
 let writes=0,hidden=false;
 const item={chainId:1,itemCode:'6',itemName:'old soup',itemDescription:null,categoryItemLinkList:[{categoryCode:'live'}],sizeInfoList:[{sizeCode:'1',applyStartDate:'2026/08/11',applyEndDate:'9999/12/31',originalApplyStartDate:null,originalApplyEndDate:null,price:330,sizeName:'1人前',linkageItemCode:null,linkageItemName:null,sizeOptionGroupLinkList:[]}]};
 const category={chainId:1,categoryCode:'hidden',categoryName:'未公開 FS0123456789abcd',applyStartDate:'2026/08/11',applyEndDate:'9999/12/31'};
 const client=new DemaeMenuClient({request:async(path,method='GET',body)=>{
  if(path.endsWith('/search/menu-pattern'))return {menuPatternList:[{chainId:1,menuPatternCode:'draft',shopCountPerMenuPattern:mode==='assigned'?1:0,displayShopCount:0,linkedShopList:[]}],totalCount:1,isContinueNextPage:false};
  if(path.endsWith('/menu-pattern/draft/item-list'))return {categoryList:[category]};
  if(path.endsWith('/category/hidden/menu-pattern-list'))return [{chainId:1,menuPatternCode:mode==='shared'?'live':'draft'}];
  if(path.includes('/category/hidden/'))return category;
  if(path.endsWith('/item/6/linked-category-list'))return [hidden?category:{...category,categoryCode:'live'}];
  if(path.endsWith('/item/6')) {
   if(method==='PUT') {
    writes++;assert.deepEqual(body.categoryItemLinkList,[{categoryCode:'hidden'}]);
    assert.equal(body.itemDescription,'');assert.equal(body.sizeInfoList[0].price,330);
    assert.equal(body.sizeInfoList[0].linkageItemCode,'');assert.equal(body.itemImageEditType,'NOT_EDIT');
    if(mode==='timeout')throw Error('timeout');
    if(mode!=='ignored'){hidden=true;item.categoryItemLinkList=[{categoryCode:'hidden'}];}
    if(mode==='changed')item.sizeInfoList[0].price=999;
   }
   return structuredClone(item);
  }
  throw Error(`Unexpected request ${method} ${path}`);
 }},'1','live',{draftPatternCode:'draft'});
 client.assertScope=async()=>{};
 client.catalog=async()=>({items:{categoryList:[{itemList:hidden?[]:[{itemCode:'6'}]}]}});
 if(mode==='success'){await client.retireItem('6');await client.retireItem('6');assert.equal(writes,1);}
 else {await assert.rejects(()=>client.retireItem('6'));assert.equal(writes,['assigned','shared'].includes(mode)?0:1);}
});
