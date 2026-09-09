import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
for(const mode of ['success','assigned','populated','ignored','changed'])test(`category retirement ${mode}`,async()=>{
 let writes=0,moved=false;
 const detail={chainId:1,categoryCode:'8',categoryName:'old',applyStartDate:'2026/09/08',applyEndDate:'9999/12/31',categoryItemLinkList:[]};
 const client=new DemaeMenuClient({request:async(path,method='GET',body)=>{
  if(path.endsWith('/search/menu-pattern'))return {menuPatternList:[{chainId:1,menuPatternCode:'draft',shopCountPerMenuPattern:mode==='assigned'?1:0,displayShopCount:0,linkedShopList:[]}],totalCount:1,isContinueNextPage:false};
  if(path.endsWith('/menu-pattern-list'))return [{chainId:1,menuPatternCode:moved?'draft':'live'}];
  if(method==='PUT') {writes++;assert.deepEqual(body.menuPatternCategoryLinkList,[{menuPatternCode:'draft'}]);assert.deepEqual(body.categoryItemLinkList,[]);if(mode!=='ignored')moved=true;if(mode==='changed')detail.categoryName='wrong';}
  return structuredClone(detail);
 }},'1','live',{draftPatternCode:'draft'});
 client.catalog=async()=>({items:{categoryList:moved?[]:[{...detail,itemList:mode==='populated'?[{itemCode:'keep'}]:[]}]}});
 if(mode==='success'){await client.retireCategory('8');await client.retireCategory('8');assert.equal(writes,1);}
 else {await assert.rejects(()=>client.retireCategory('8'));assert.equal(writes,['assigned','populated'].includes(mode)?0:1);}
});
