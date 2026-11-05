import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {CdpPage} from '../src/cdp-page.mjs';
import {connectMerchantMenuClient} from '../src/merchant-menu-client.mjs';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';

test('queued concurrent requests retain their own target and emit lifecycle events at dispatch',async t=>{
 const events=[];
 t.mock.method(CdpPage,'connect',async()=>({close(){},async evaluate(expression){
  if(expression==='location.origin')return 'https://store.rocketnow.co.jp';
  events.push({state:'dispatch'});return {};
 }}));
 const transport=await connectMerchantMenuClient({ensureRunning:async()=>1},'https://store.rocketnow.co.jp','SUCCESS',async event=>events.push(event));
 await Promise.all([
  transport.withProgress({targetName:'Corn',targetKind:'item'},()=>transport.request('/api/dishes/1/detail')),
  transport.withProgress({targetName:'Beef',targetKind:'item'},()=>transport.request('/api/dishes/2/detail')),
  transport.withProgress({},()=>transport.request('/api/all-options'))
 ]);
 assert.deepEqual(events.map(row=>row.state),['waiting','dispatch','received','waiting','dispatch','received','waiting','dispatch','received']);
 assert.deepEqual(events.filter(row=>row.context).map(row=>row.context.targetName),['Corn','Corn','Beef','Beef',undefined,undefined]);
 transport.close();
});

test('Rocket whole snapshots identify actual detail records and never borrow a same-name source identity',async()=>{
 const storage=new AsyncLocalStorage(),reads=[];
 const targets=[{kind:'category',targetId:'c',sourceKey:'category:c',name:'Meals',mappings:[{externalId:'1'}]},
  {kind:'item',targetId:'a',parentId:'c',sourceKey:'item:a',name:'Desired Corn',mappings:[{externalId:'4'}]},
  {kind:'item',targetId:'b',parentId:'c',sourceKey:'item:b',name:'Native Corn',mappings:[{externalId:'8'}]}];
 const transport={withProgress:(context,operation)=>storage.run(context,operation)};
 const driver=new AuthorityNativeDriver(transport,{platformKey:'rocket_now',merchantId:'1',targets});
 driver.client.catalog=async()=>{reads.push({action:'catalog',context:storage.getStore()});return {menus:[{menuId:1,menuName:'Native Meals',dishes:[{dishId:4,dishName:'Native Corn'},{dishId:5,dishName:'Native Corn'}]}],groups:[]};};
 driver.client.detail=async id=>{await Promise.resolve();reads.push({action:'detail',id,context:storage.getStore()});return {dishId:id,dishName:'Native Corn',salePrice:100,mappingMenus:[{menuId:1}],options:[]};};
 await driver.withTargetProgress(targets[2],()=>driver.snapshot());
 assert.deepEqual(reads[0].context,{});
 assert.deepEqual(reads.find(row=>row.id===4).context,{sourceKey:'item:a',targetKind:'item',targetName:'Native Corn',parentName:'Native Meals'});
 assert.equal(reads.find(row=>row.id===5).context.sourceKey,undefined);
 assert.equal(reads.find(row=>row.id===5).context.targetName,'Native Corn');
});

test('Demae snapshots carry item and option group identities through parallel reads',async()=>{
 const storage=new AsyncLocalStorage(),reads=[];
 const targets=[{kind:'category',targetId:'c',sourceKey:'category:c',name:'Meals',mappings:[{externalId:'0010'}]},
  {kind:'item',targetId:'a',parentId:'c',sourceKey:'item:a',name:'Desired Corn',mappings:[{externalId:'0001'}]},
  {kind:'option_group',targetId:'g',sourceKey:'option_group:g',name:'Desired Extras',mappings:[{externalId:'0002'}]}];
 const transport={withProgress:(context,operation)=>storage.run(context,operation)};
 const driver=new AuthorityNativeDriver(transport,{platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',targets});
 driver.client.catalog=async()=>({items:{categoryList:[{categoryCode:'0010',categoryName:'Native Meals',itemList:[{itemCode:'0001',itemName:'Native Corn'}]}]},groups:[{optionGroupCode:'0002',optionGroupName:'Native Extras'}]});
 driver.client.stockCatalog=async()=>({itemList:[],optionList:[]});
 driver.client.item=async id=>{reads.push({kind:'item',context:storage.getStore()});return {itemCode:id,chainId:1,itemName:'Native Corn',sizeInfoList:[]};};
 driver.client.group=async id=>{reads.push({kind:'option_group',context:storage.getStore()});return {detail:{optionGroupCode:id,optionGroupName:'Native Extras'},items:[],options:[]};};
 await driver.snapshot();
 assert.deepEqual(reads.find(row=>row.kind==='item').context,{sourceKey:'item:a',targetKind:'item',targetName:'Native Corn',parentName:'Native Meals'});
 assert.deepEqual(reads.find(row=>row.kind==='option_group').context,{sourceKey:'option_group:g',targetKind:'option_group',targetName:'Native Extras',parentName:undefined});
});
