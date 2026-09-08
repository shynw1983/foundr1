import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDemaeSalesMenu} from '../src/demae-menu-scope.mjs';
const draft={chainId:1,menuPatternCode:'0001',shopCountPerMenuPattern:0,linkedShopList:[]};
const live={chainId:1,menuPatternCode:'D8Ta',shopCountPerMenuPattern:1,linkedShopList:[{shopId:2}]};
const response=rows=>({totalCount:rows.length,isContinueNextPage:false,menuPatternList:rows});
test('an unassigned draft sorted first cannot replace the sales menu',()=>{
 assert.deepEqual(selectDemaeSalesMenu(1,response([draft,live])),{chainId:1,menuPatternCode:'D8Ta'});
});
test('ambiguous, foreign or truncated sales-menu scopes fail closed',()=>{
 for(const rows of [[draft],[live,{...live,menuPatternCode:'other'}],[{...live,chainId:9}],[{...live,shopCountPerMenuPattern:2}],[{...live,linkedShopList:[]}]])
  assert.throws(()=>selectDemaeSalesMenu(1,response(rows)));
 assert.throws(()=>selectDemaeSalesMenu(1,{...response([live]),isContinueNextPage:true}));
});
