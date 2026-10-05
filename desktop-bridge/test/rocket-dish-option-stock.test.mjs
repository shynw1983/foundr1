import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketMenuClient} from '../src/rocket-menu-client.mjs';

function fixture({globalStatuses=['NOT_EXPOSE','NOT_EXPOSE','NOT_EXPOSE'],localStatuses=['ON_SALE','ON_SALE','ON_SALE'],mode='ok'}={}) {
  const choices=[{id:7876266,name:'1杯(コク旨)',price:200},{id:7876267,name:'2杯(濃厚おすすめ!)',price:300},{id:7876265,name:'3杯(超濃厚!)',price:500}];
  const groups=[{optionId:1712738,optionName:'【10月限定】ピリ辛・特製旨味醤ブースト',optionItems:choices.map((row,index)=>({
    optionItemId:row.id,optionItemName:row.name,salePrice:row.price,displayStatus:globalStatuses[index],forceNotExpose:false,exposeOrder:index
  }))},{optionId:8,optionName:'other',optionItems:[{optionItemId:9,optionItemName:'unrelated',salePrice:70,displayStatus:'SOLD_OUT_TODAY',forceNotExpose:false,exposeOrder:0}]}];
  let detail={dishId:12,dishName:'existing soup',description:'description',salePrice:330,displayStatus:'ON_SALE',mappingMenus:[{menuId:2}],
    allDishImages:[{imageId:1}],allDetailImages:[],
    options:[{optionId:8,exposeOrder:0,optionItems:[{optionItemId:9,displayStatus:'SOLD_OUT_TODAY'}]},
      {optionId:1712738,exposeOrder:1,optionItems:choices.map((row,index)=>({optionItemId:row.id,displayStatus:localStatuses[index]}))}]};
  const calls=[],writes=[];
  const client=new RocketMenuClient({request:async(path,method,body)=>{
    calls.push({path,method});
    if(method==='POST') {
      assert.equal(path,'/api/v1/merchant/web/catalog/stores/118575/dishes/12/update');
      writes.push(structuredClone(body));
      detail={...detail,dishName:body.dishName,description:body.description,salePrice:body.salePrice,
        mappingMenus:body.toMenuId===body.fromMenuId?detail.mappingMenus:[{menuId:body.toMenuId}],
        options:body.optionMappingDtos.map(group=>({optionId:group.optionId,exposeOrder:group.exposeOrder,
          optionItems:group.optionItemSaveDtos.map(item=>({optionItemId:item.optionItemId,displayStatus:item.displayStatus}))}))};
      // Model the dangerous stock-coupled save, not a desired-state echo:
      // a wrong DTO can alter the independently read global catalog.
      for(const group of body.optionMappingDtos)for(const item of group.optionItemSaveDtos)
        groups.find(row=>row.optionId===group.optionId).optionItems.find(row=>row.optionItemId===item.optionItemId).displayStatus=item.displayStatus;
      if(mode==='stock')groups[0].optionItems[0].displayStatus='ON_SALE';
      if(mode==='otherStock')groups[1].optionItems[0].displayStatus='ON_SALE';
      if(mode==='force')groups[0].optionItems[0].forceNotExpose=true;
      if(mode==='globalIdentity')groups[0].optionItems[0].optionItemId=99;
      if(mode==='name')detail.dishName='wrong';
      if(mode==='description')detail.description='wrong';
      if(mode==='price')detail.salePrice=1;
      if(mode==='dishStock')detail.displayStatus='NOT_EXPOSE';
      if(mode==='groups')detail.options=[];
      if(mode==='order')detail.options.reverse().forEach((group,index)=>{group.exposeOrder=index;});
      if(mode==='category')detail.mappingMenus=[{menuId:99}];
      if(mode==='images')detail.allDishImages=[];
      return {};
    }
    if(path==='/api/v1/merchant/web/stores/118575/all-options?fetchDish=true')return structuredClone(groups);
    assert.equal(path,'/api/v1/merchant/web/stores/118575/dishes/12/detail');
    return structuredClone(detail);
  }},'118575');
  return {client,groups,calls,writes,get detail(){return detail;}};
}

test('content saves preserve real new boost global holds despite ON_SALE detail associations',async()=>{
  const f=fixture(),before=structuredClone(f.groups);
  await f.client.updateDish('12',{name:'updated soup',price:390,description:'updated description'});
  assert.equal(f.writes.length,1);
  assert.deepEqual(f.groups,before);
  assert.deepEqual(f.writes[0].optionMappingDtos[1].optionItemSaveDtos,[
    {optionItemId:7876265,displayStatus:'NOT_EXPOSE'},
    {optionItemId:7876266,displayStatus:'NOT_EXPOSE'},
    {optionItemId:7876267,displayStatus:'NOT_EXPOSE'}
  ]);
  assert.deepEqual(f.calls.map(call=>call.path.split('/').at(-1)),['detail','all-options?fetchDish=true','update','detail','all-options?fetchDish=true']);
  assert.equal(f.detail.dishName,'updated soup');assert.equal(f.detail.salePrice,390);
  assert.deepEqual(f.detail.allDishImages,[{imageId:1}]);
});

test('relationship ordering and content retain global sale, today-stockout and permanent-hide states',async()=>{
  for(const globalStatuses of [['ON_SALE','SOLD_OUT_TODAY','NOT_EXPOSE'],['SOLD_OUT_TODAY','SOLD_OUT_TODAY','SOLD_OUT_TODAY'],['NOT_EXPOSE','NOT_EXPOSE','NOT_EXPOSE']]) {
    const f=fixture({globalStatuses,localStatuses:globalStatuses});
    const before=structuredClone(f.groups);
    const patch={groups:[f.groups[0],f.groups[1]],name:'renamed',price:390};
    await f.client.updateDish('12',patch);
    assert.deepEqual(f.groups,before);
    assert.deepEqual(f.detail.options.map(row=>row.optionId),[1712738,8]);
    assert.deepEqual(f.detail.options.map(row=>row.exposeOrder),[0,1]);
    assert.deepEqual(f.detail.allDishImages,[{imageId:1}]);
    assert.equal(f.writes.length,1);assert.equal(f.calls.some(call=>/create/.test(call.path)),false);
  }
  const f=fixture({globalStatuses:['NOT_EXPOSE','NOT_EXPOSE','NOT_EXPOSE'],localStatuses:['NOT_EXPOSE','NOT_EXPOSE','NOT_EXPOSE']});
  f.groups[0].optionItems.forEach(row=>{row.forceNotExpose=true;});
  const before=structuredClone(f.groups);
  await f.client.updateDish('12',{name:'renamed'});assert.deepEqual(f.groups,before);
});

test('global holds may only tighten local associations, never lift either restriction',async()=>{
  for(const [globalStatus,localStatus] of [['NOT_EXPOSE','ON_SALE'],['NOT_EXPOSE','SOLD_OUT_TODAY'],['SOLD_OUT_TODAY','ON_SALE']]) {
    const f=fixture({globalStatuses:Array(3).fill(globalStatus),localStatuses:Array(3).fill(localStatus)});
    await f.client.updateDish('12',{groups:f.groups});
    assert.ok(f.detail.options.find(row=>row.optionId===1712738).optionItems.every(row=>row.displayStatus===globalStatus));
    assert.ok(f.groups[0].optionItems.every(row=>row.displayStatus===globalStatus));
  }
  for(const [globalStatus,localStatus] of [['ON_SALE','NOT_EXPOSE'],['ON_SALE','SOLD_OUT_TODAY'],['SOLD_OUT_TODAY','NOT_EXPOSE']]) {
    const f=fixture({globalStatuses:Array(3).fill(globalStatus),localStatuses:Array(3).fill(localStatus)});
    await assert.rejects(()=>f.client.updateDish('12',{groups:f.groups}),/option_stock_conflict/);
    assert.equal(f.writes.length,0);
  }
  const f=fixture({globalStatuses:Array(3).fill('ON_SALE'),localStatuses:Array(3).fill('ON_SALE')});
  f.groups[0].optionItems[0].forceNotExpose=true;
  await assert.rejects(()=>f.client.updateDish('12',{name:'renamed'}),/option_stock_conflict/);
  assert.equal(f.writes.length,0);
});

test('unknown, missing, duplicate or wrong-parent global identities stop before a POST',async()=>{
  for(const mode of ['missingGroup','missingOption','duplicateGroup','duplicateOption','mixedParent','unknownGlobal','unknownLocal','unknownForce','localParent']) {
    const f=fixture();
    if(mode==='missingGroup')f.groups.shift();
    if(mode==='missingOption')f.groups[0].optionItems.pop();
    if(mode==='duplicateGroup')f.groups.push(structuredClone(f.groups[0]));
    if(mode==='duplicateOption')f.groups[0].optionItems.push(structuredClone(f.groups[0].optionItems[0]));
    if(mode==='mixedParent')f.groups[1].optionItems.push(structuredClone(f.groups[0].optionItems[0]));
    if(mode==='unknownGlobal')f.groups[0].optionItems[0].displayStatus='UNKNOWN';
    if(mode==='unknownLocal')f.detail.options[1].optionItems[0].displayStatus='UNKNOWN';
    if(mode==='unknownForce')f.groups[0].optionItems[0].forceNotExpose='false';
    if(mode==='localParent')f.detail.options[1].optionId=99;
    await assert.rejects(()=>f.client.updateDish('12',{name:'renamed'}),/option_stock_/ ,mode);
    assert.equal(f.writes.length,0,mode);
  }
});

test('independent global reread rejects changed stock, forced holds, parents and native identities',async()=>{
  for(const mode of ['stock','otherStock','force','globalIdentity']) {
    const f=fixture({mode});
    await assert.rejects(()=>f.client.updateDish('12',{name:'renamed'}),/option_availability_changed/,mode);
    assert.equal(f.writes.length,1,mode);
    assert.equal(f.calls.filter(call=>call.path.endsWith('all-options?fetchDish=true')).length,2,mode);
  }
});

test('global stock proof cannot replace dish content, order, stock, category or image readback',async()=>{
  for(const mode of ['name','description','price','dishStock','groups','order','category','images']) {
    const f=fixture({mode});
    await assert.rejects(()=>f.client.updateDish('12',{name:'renamed',description:'new description',price:390}),/dish_verification_failed/,mode);
    assert.equal(f.writes.length,1,mode);
    assert.equal(f.calls.filter(call=>call.path.endsWith('all-options?fetchDish=true')).length,2,mode);
  }
});
