import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketMenuClient,rocketGroupUpdate} from '../src/rocket-menu-client.mjs';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';

const group=()=>({optionId:7,optionName:'old',minSelect:0,maxSelect:50,isMandatory:false,isMultiSelect:true,
 exposeStatus:'EXPOSE',mappingDishes:[],mappingDishCount:0,
 optionItems:[{optionItemId:8,optionItemName:'one',salePrice:123,displayStatus:'NOT_EXPOSE'},
 {optionItemId:9,optionItemName:'two',salePrice:227,displayStatus:'ON_SALE'}]});
test('only empty Rocket groups may retain the native zero maximum',()=>{
 assert.equal(rocketGroupUpdate({...group(),optionItems:[],maxSelect:0},{name:'empty'}).maxSelect,1);
 assert.throws(()=>rocketGroupUpdate({...group(),maxSelect:0}),/quantity_invalid/);
 assert.throws(()=>rocketGroupUpdate({...group(),optionItems:[],minSelect:1,maxSelect:0}),/quantity_invalid/);
});
test('Rocket group limits are exact, not clamped to current option count; reordering keeps stock and price',()=>{
 const body=rocketGroupUpdate(group(),{name:'new',min:2,max:100,memberIds:['9','8']});
 assert.equal(body.maxSelect,100);assert.equal(body.minSelect,2);assert.equal(body.isMandatory,true);
 assert.deepEqual(body.optionItems.map(row=>[row.optionItemId,row.salePrice,row.displayStatus]),[[9,227,'ON_SALE'],[8,123,'NOT_EXPOSE']]);
 assert.throws(()=>rocketGroupUpdate(group(),{memberIds:['8']}),/require_migration/);
 assert.throws(()=>rocketGroupUpdate(group(),{min:3,max:2}),/quantity_invalid/);
});
test('Rocket group update independently checks content, stock and existing consumers',async()=>{
 for(const failure of [null,'stock','link','limit']) {
  let state=group();
  const client=new RocketMenuClient({request:async(path,method,body)=>{
   if(method){state={...state,...body,optionItems:body.optionItems.map(item=>({...item,optionItemName:item.name}))};
    if(failure==='stock')state.optionItems[0].displayStatus='ON_SALE';
    if(failure==='link')state.mappingDishes=[{dishId:99}];
    if(failure==='limit')state.maxSelect=2;
    return {};
   }
   return path.includes('all-menu-dishes')?{menus:[]}:structuredClone([state]);
  }},'1');
  if(failure)await assert.rejects(()=>client.updateGroup('7',{name:'new',max:100}),/verification_failed/);
  else assert.equal((await client.updateGroup('7',{name:'new',max:100})).optionName,'new');
 }
});
test('Rocket cannot delete a group whose consumers are unknown or still present',async()=>{
 for(const patch of [{mappingDishCount:undefined},{mappingDishes:undefined},{mappingDishCount:1}]) {
  let writes=0;
  const client=new RocketMenuClient({request:async(path,method)=>{if(method)writes++;return path.includes('all-menu-dishes')?{menus:[]}:[{...group(),...patch}];}},'1');
  await assert.rejects(()=>client.retireUnlinkedGroup('7'),/still_linked/);assert.equal(writes,0);
 }
});
test('Rocket group creation is empty, unlinked and tied to a durable marker receipt',async()=>{
 let call;
 const client=new RocketMenuClient({request:async(...args)=>{call=args;return {optionId:7};}},'1');
 await client.createGroup('FS0123456789abcd');
 assert.deepEqual(call[2].optionItems,[]);
 assert.equal(call[3].receiptKey,'rocket:1:group:FS0123456789abcd');
 assert.equal('mapToDishIdList' in call[2],false);
});
test('Rocket foreign-group edits are blocked instead of pretending the native ID can move',async()=>{
 for(const noMove of [false,true]) {
  let groups=[group(),{...group(),optionId:10,optionItems:[]}];
  const client=new RocketMenuClient({request:async(path,method,body)=>{
   if(method)throw Error('must not issue unsupported write');
   return path.includes('all-menu-dishes')?{menus:[]}:structuredClone(groups);
  }},'1');
  await assert.rejects(()=>client.moveOption('8','10'),/requires_recreation/);
 }
});

function demaeFixture({failure,linked=true}={}) {
 let detail={chainId:1,optionGroupCode:'g',optionGroupName:'old',adminOptionGroupName:'admin',optionGroupDescription:null,optionButtonType:'CHECKBOX',sizeOptionGroupLinkList:[],optionGroupItemLinkList:[]};
 let members=[{chainId:1,optionCode:'a',optionName:'one',price:180}];
 let items=linked?[{chainId:1,itemCode:'item',sizeList:[{sizeCode:'001'}]}]:[];
 let records=[{isEndSale:true}];const calls=[];
 const transport={request:async(path,method,body,options)=>{
  calls.push({path,method,body,options});
  if(path.endsWith('chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'}]}];
  if(path.endsWith('stockout/shop-list'))return {shopList:[{chainId:1,shopId:2}]};
  if(path.endsWith('stockout/target-list'))return structuredClone({hasOverOptionLimitChain:false,itemList:[],optionList:[{chainId:1,optionCode:'a',stockoutOptionList:records}]});
  if(method==='PUT'||method==='POST') {
   detail={...detail,...body,optionGroupCode:'g'};
   members=body.optionGroupItemLinkList.map(row=>members.find(member=>member.optionCode===row.optionCode)??{chainId:1,optionCode:row.optionCode});
   if(failure==='stock')records=[];
   if(failure==='link')items=[];
   if(failure==='members')members=[];
   if(failure==='price')members[0]={...members[0],price:999};
   return {chainId:1,optionGroupCode:'g'};
  }
  if(path.endsWith('linked-item-list'))return structuredClone(items);
  if(path.endsWith('option-item-list'))return structuredClone(members);
  return structuredClone(detail);
 }};
 return {client:new DemaeMenuClient(transport,'1','live'),calls};
}
test('Demae group edits reconstruct real size links instead of trusting empty detail arrays',async()=>{
 const {client,calls}=demaeFixture();
 await client.updateGroup('g',{name:'new',description:'line1\nline2'});
 const write=calls.find(call=>call.method==='PUT');
 assert.deepEqual(write.body.sizeOptionGroupLinkList,[{itemCode:'item',sizeCode:'001'}]);
 assert.equal(write.body.optionGroupDescription,'line1<br>line2');
 assert.equal(write.body.optionButtonType,'CHECKBOX');
 assert.equal(Object.keys(write.body).some(key=>/image/i.test(key)),false);
});
test('Demae rejects a lost relationship, changed stock or missing members after group writes',async()=>{
 for(const failure of ['stock','link','members','price']) {
  const {client}=demaeFixture({failure});
  await assert.rejects(()=>client.updateGroup('g',{name:'new'}),/verification_failed|availability_changed|member_content_changed/);
 }
});
test('Demae refuses to expose a new option by adding it to a live group',async()=>{
 const {client,calls}=demaeFixture();
 await assert.rejects(()=>client.updateGroup('g',{optionCodes:['a','b']}),/requires_staging/);
 assert.equal(calls.some(call=>call.method==='PUT'),false);
});

// Native group 0009 reads proved that linked-item-list generates a different
// CDN `v` on each GET, even with no write. Keep the observed response shape,
// dated size links and image path; only that cache parameter is volatile.
function demaeConsumerVersionFixture({failure}={}) {
 const image='https://cdn.demae-can.com/files/imgix/item720/jkaW8rzm/l2_ce0830f864adeafa45db78bab505a771a999320f4075c9921a9b1670d21b1f82.jpg';
 const consumers=[
  {chainId:410649,itemCode:'00000004',itemName:'既存の麻辣湯セット',itemImageUri:image,
   sizeList:[{sizeCode:'001',sizeName:'',applyStartDate:'2026/08/11',applyEndDate:'9999/12/31'}]},
  {chainId:410649,itemCode:'a0a10002',itemName:'既存のカスタム麻辣湯',itemImageUri:'https://cdn.demae-can.com/files/imgix/item720/jkaW8rzm/l2_D8Ta0a10002.jpg',
   sizeList:[{sizeCode:'1',sizeName:'',applyStartDate:'2026/08/06',applyEndDate:'9999/12/31'}]}
 ];
 if(failure==='unknownHost')consumers[0].itemImageUri='https://images.example.test/files/imgix/item720/original.jpg';
 if(failure==='unknownPath')consumers[0].itemImageUri='https://cdn.demae-can.com/contents/non/l2_non.png';
 let detail={chainId:410649,optionGroupCode:'0009',optionGroupName:'麺の種類を変更する',adminOptionGroupName:'麺の種類を変更する 管理用',
  optionGroupDescription:null,optionButtonType:'RADIO',sizeOptionGroupLinkList:[],optionGroupItemLinkList:[]};
 const options=[{chainId:410649,optionCode:'00000202',optionName:'既存の麺',price:170,applyStartDate:'2026/08/11',applyEndDate:'9999/12/31'},
  {chainId:410649,optionCode:'00000232',optionName:'追加先へ移す既存の麺',price:180,applyStartDate:'2026/08/11',applyEndDate:'9999/12/31'}];
 let members=[options[0]],written=false,consumerReads=0;const calls=[];
 const stock=()=>({hasOverOptionLimitChain:false,itemList:[],optionList:options.map(option=>({chainId:410649,optionCode:option.optionCode,
  linkedShopList:[{shopId:2,orderType:'DELIVERY'}],stockoutOptionList:written&&failure==='stock'?[]:[{shopId:2,orderType:'DELIVERY',isEndSale:true,isCurrentApplying:true}]}))});
 const transport={request:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.endsWith('chain-menu-pattern'))return [{chain:{chainId:410649},menuPatternList:[{menuPatternCode:'D8Ta'}]}];
  if(path.endsWith('stockout/shop-list'))return {shopList:[{chainId:410649,shopId:2,orderType:'DELIVERY'}]};
  if(path.endsWith('stockout/target-list'))return structuredClone(stock());
  if(method==='PUT') {
   written=true;detail={...detail,...body};
   if(failure!=='ignoredMembers')members=body.optionGroupItemLinkList.map(link=>options.find(row=>row.optionCode===link.optionCode));
   if(failure==='memberOrder')members.reverse();
   if(failure==='memberPrice')members=members.map(row=>row.optionCode==='00000202'?{...row,price:999}:row);
   return {};
  }
  if(path.endsWith('linked-item-list')) {
   const rows=structuredClone(consumers);consumerReads++;
   for(const row of rows)row.itemImageUri+=`?v=${1791261380+consumerReads}`;
   if(written) {
    if(failure==='imagePath')rows[0].itemImageUri=rows[0].itemImageUri.replace('l2_ce0830f864','l2_DIFFERENT');
    if(failure==='imageQuery')rows[0].itemImageUri+='&crop=changed';
    if(failure==='itemId')rows[0].itemCode='unknown';
    if(failure==='itemName')rows[0].itemName='別の商品';
    if(failure==='sizeId')rows[0].sizeList[0].sizeCode='unknown';
    if(failure==='sizeDates')rows[0].sizeList[0].applyEndDate='2026/10/05';
    if(failure==='consumerOrder')rows.reverse();
    if(failure==='lostConsumer')rows.pop();
   }
   return rows;
  }
  if(path.endsWith('option-item-list'))return structuredClone(members);
  return structuredClone(detail);
 }};
 return {client:new DemaeMenuClient(transport,'410649','D8Ta'),calls,stock:()=>structuredClone(stock())};
}

test('Demae existing-member migration and subsequent ordering survive read-generated image versions',async()=>{
 const h=demaeConsumerVersionFixture(),beforeStock=h.stock();
 const added=await h.client.updateGroup('0009',{optionCodes:['00000202','00000232']});
 assert.deepEqual(added.options.map(row=>row.optionCode),['00000202','00000232']);
 const ordered=await h.client.updateGroup('0009',{optionCodes:['00000232','00000202']});
 assert.deepEqual(ordered.options.map(row=>row.optionCode),['00000232','00000202']);
 assert.deepEqual(h.stock(),beforeStock);
 const writes=h.calls.filter(call=>call.method==='PUT');assert.equal(writes.length,2);
 assert.deepEqual(writes[1].body.optionGroupItemLinkList,[{optionCode:'00000232',dispOrder:1},{optionCode:'00000202',dispOrder:2}]);
 assert.deepEqual(writes[0].body.sizeOptionGroupLinkList,[{itemCode:'00000004',sizeCode:'001'},{itemCode:'a0a10002',sizeCode:'1'}]);
 assert.equal(Object.keys(writes[0].body).some(key=>/image/i.test(key)),false);
});

test('Demae group verification ignores no image identity, relationship, order or stock changes',async()=>{
 for(const failure of ['unknownHost','unknownPath','imagePath','imageQuery','itemId','itemName','sizeId','sizeDates',
  'consumerOrder','lostConsumer','ignoredMembers','memberOrder','memberPrice','stock']) {
  const h=demaeConsumerVersionFixture({failure});
  await assert.rejects(()=>h.client.updateGroup('0009',{optionCodes:['00000232','00000202']}),
   /verification_failed|member_content_changed|availability_changed/,failure);
  assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,failure);
 }
});
test('Demae rejects unsupported unlinked group creation before a native write',async()=>{
 const {client,calls}=demaeFixture({linked:false});
 await assert.rejects(()=>client.createUnlinkedGroup({marker:'FS0123456789abcd',optionCodes:['a'],buttonType:'CHECKBOX'},async()=>{}),/requires_hidden_item/);
 assert.equal(calls.length,0);
});

test('Rocket option retirement is idempotent and detects collateral changes',async()=>{
 for(const failure of [null,'still_exists','other_changed']) {
  let state=group(),writes=0;
  const client=new RocketMenuClient({request:async(path,method)=>{
   if(method) {
    writes++;
    if(failure!=='still_exists')state.optionItems=state.optionItems.filter(row=>row.optionItemId!==8);
    if(failure==='other_changed')state.optionItems[0].salePrice=999;
    return {};
   }
   return path.includes('all-menu-dishes')?{menus:[]}:structuredClone([state]);
  }},'1');
  if(failure)await assert.rejects(()=>client.retireOption('8'),/still_exists|changed_other_records/);
  else {await client.retireOption('8');await client.retireOption('8');assert.equal(writes,1);}
 }
});

test('Demae retirement removes every occurrence, retaining other choices',async()=>{
 const client=new DemaeMenuClient({},'1','live');
 let groups={g1:['old','one'],g2:['two','old']};const writes=[];
 client.optionOccurrences=async id=>Object.keys(groups).filter(key=>groups[key].includes(id));
 client.group=async id=>({options:groups[id].map(optionCode=>({optionCode}))});
 client.updateGroup=async(id,{optionCodes})=>{writes.push(id);groups[id]=optionCodes;};
 client.options=async()=>Object.values(groups).flat().map(optionCode=>({optionCode}));
 await client.retireOption('old');await client.retireOption('old');
 assert.deepEqual(groups,{g1:['one'],g2:['two']});assert.deepEqual(writes,['g1','g2']);
 client.options=async()=>[{optionCode:'old'}];
 await assert.rejects(()=>client.retireOption('old'),/still_listed/);
});
