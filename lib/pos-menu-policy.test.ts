import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPosItems,applyPosOptions,parsePosMenuChange,type PosMenuSetting} from './pos-menu-policy.ts';
test('POS overrides preserve shared master data, zero prices, hidden children and inherited defaults',()=>{
  const master=[{id:'a',basePrice:699,priceOverride:650,price:650},{id:'b',basePrice:599,priceOverride:null,price:599}];
  const settings:PosMenuSetting[]=[{kind:'item',targetId:'a',visible:null,price:null},{kind:'item',targetId:'b',visible:false,price:null}];
  assert.deepEqual(applyPosItems(master,[]),master);
  const changed=applyPosItems(master,settings);assert.equal(changed.length,1);assert.equal(changed[0].price,699);assert.equal(master[0].price,650);
  const options=[{id:'o',groupId:'g',priceDelta:699},{id:'p',groupId:'g',priceDelta:599}];
  const local:PosMenuSetting[]=[{kind:'group',targetId:'g',visible:true,price:null},{kind:'option',targetId:'o',visible:null,price:0},{kind:'option',targetId:'p',visible:false,price:null}];
  assert.deepEqual(applyPosOptions(options,local),[{...options[0],priceDelta:0,posEnabled:true}]);
  assert.equal(options[0].priceDelta,699);
  assert.equal(applyPosOptions(options,[{kind:'group',targetId:'g',visible:false,price:null}]).length,0);
});
test('POS pricing rejects invalid input rather than coercing blank or negative values to free',()=>{
  const good={kind:'option',targetId:'00000000-0000-4000-8000-000000000001',visible:null,price:null};
  assert.equal(parsePosMenuChange({...good,price:0}).price,0);
  for(const price of ['',undefined,-1,1.5,NaN,Infinity,1000000])assert.throws(()=>parsePosMenuChange({...good,price}));
  assert.throws(()=>parsePosMenuChange({...good,visible:'false'}));
  assert.throws(()=>parsePosMenuChange({...good,kind:'group',price:100}));
});
