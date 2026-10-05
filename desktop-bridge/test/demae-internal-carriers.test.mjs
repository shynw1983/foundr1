import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectDemaeInternalCarriers,readDemaeInternalCarriers} from '../src/demae-internal-carriers.mjs';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

const creationMarker=key=>`FS${createHash('sha256').update(`source:${key}`).digest('hex').slice(0,14)}`;
const optionKey='option:old-group:option-id',newKey='option:new-group:option-id';
const period={applyStartDate:'2020/01/01',applyEndDate:'9999/12/31'};

function fixture({published=true,excluded=false}={}) {
  const requests=[],writes=[],patterns=[
    {chainId:1,menuPatternCode:'live',shopCountPerMenuPattern:1,displayShopCount:1,linkedShopList:[{shopId:'shop'}]},
    {chainId:1,menuPatternCode:'draft',shopCountPerMenuPattern:0,displayShopCount:0,linkedShopList:[]}
  ];
  const sourceOption={chainId:1,optionCode:'194',optionName:'option',price:170,...period,itemType:'REDUCED_RATE_NORMAL_ITEM'};
  const items=new Map(['15','99'].map(id=>[id,{chainId:1,itemCode:id,itemName:id==='15'?'carrier item':'selling item',itemDescription:'',
    categoryItemLinkList:[{chainId:1,categoryCode:id==='15'?'7':'12',...period}],
    sizeInfoList:[{chainId:1,itemCode:id,sizeCode:'001',price:100,...period,
      sizeOptionGroupLinkList:(id==='15'?['28','73']:['10']).map((optionGroupCode,index)=>({chainId:1,optionGroupCode,dispOrder:index+1}))}]}]));
  const groups=new Map([
    ['28',{detail:{chainId:1,optionGroupCode:'28',optionGroupName:creationMarker(optionKey),adminOptionGroupName:creationMarker(optionKey)},options:[structuredClone(sourceOption)]}],
    ['10',{detail:{chainId:1,optionGroupCode:'10',optionGroupName:'business group',adminOptionGroupName:'business group',optionButtonType:'CHECKBOX'},options:published?[structuredClone(sourceOption)]:[]}],
    ['73',{detail:{chainId:1,optionGroupCode:'73',optionGroupName:'old business group',adminOptionGroupName:creationMarker('option_group:old')},options:[]}]
  ]);
  const liveGroupIds=['10'];
  const liveItemIds=['99'];
  const liveOptions=()=>groups.get('10').options.map(row=>structuredClone(row));
  const categoryLinks=new Map([['7',[{chainId:1,menuPatternCode:'draft'}]],['12',[{chainId:1,menuPatternCode:'live'}]]]);
  const consumers=id=>groups.get(id).consumers??[...items.values()].flatMap(item=>{
    const sizes=item.sizeInfoList.filter(size=>size.sizeOptionGroupLinkList.some(link=>String(link.optionGroupCode)===id));
    return sizes.length?[{chainId:1,itemCode:item.itemCode,sizeList:sizes.map(size=>({sizeCode:size.sizeCode}))}]:[];
  });
  const catalog=()=>({categoryList:[{chainId:1,categoryCode:'12',categoryName:'category',itemList:liveItemIds.map(id=>structuredClone(items.get(id)))}]});
  const stock=()=>({hasOverOptionLimitChain:false,itemList:liveItemIds.map(itemCode=>({chainId:1,itemCode,linkedShopList:[{shopId:'shop',orderType:'DELIVERY'}],stockoutItemList:[]})),
    optionList:liveOptions().map(option=>({...option,linkedShopList:[{shopId:'shop',orderType:'DELIVERY'}],stockoutOptionList:[]}))});
  const transport={request:async(path,method='GET',body)=>{
    requests.push({path,method});
    if(method==='PUT') {
      writes.push({path,body:structuredClone(body)});
      const itemId=path.match(/\/item\/([^/]+)$/)?.[1];
      if(itemId) {items.set(itemId,{...items.get(itemId),...structuredClone(body)});return {};}
      const groupId=path.match(/\/option-group\/([^/]+)$/)?.[1];
      if(groupId) {
        const group=groups.get(groupId);
        Object.assign(group.detail,{optionGroupName:body.optionGroupName,adminOptionGroupName:body.adminOptionGroupName,
          optionGroupDescription:body.optionGroupDescription,optionButtonType:body.optionButtonType});
        group.options=body.optionGroupItemLinkList.map(link=>structuredClone(sourceOption));
        return {};
      }
      throw Error(`unexpected write:${path}`);
    }
    if(path.endsWith('/search/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:patterns}];
    if(path.endsWith('/search/menu-pattern'))return {menuPatternList:structuredClone(patterns),totalCount:patterns.length,isContinueNextPage:false};
    if(path.endsWith('/stockout/shop-list'))return {shopList:[{chainId:1,shopId:'shop',orderType:'DELIVERY'}]};
    if(path.endsWith('/stockout/target-list'))return stock();
    if(path.endsWith('/menu-pattern/live/item-list'))return catalog();
    if(path.endsWith('/linked-option-group-list'))return liveGroupIds.map(optionGroupCode=>({optionGroupCode}));
    if(path.endsWith('/menu-pattern/live/option-item-list'))return liveOptions();
    const itemId=path.match(/\/item\/([^/]+)(?:\/linked-category-list)?$/)?.[1];
    if(itemId) {
      const item=items.get(itemId);if(!item)throw Error(`unknown item:${itemId}`);
      return structuredClone(path.endsWith('/linked-category-list')?item.categoryItemLinkList:item);
    }
    const categoryId=path.match(/\/category\/([^/]+)\/(?:menu-pattern-list|[0-9-]+\/[0-9-]+)$/)?.[1];
    if(categoryId)return path.endsWith('/menu-pattern-list')?structuredClone(categoryLinks.get(categoryId)):{chainId:1,categoryCode:categoryId};
    const groupId=path.match(/\/option-group\/([^/]+)(?:\/(?:linked-item-list|option-item-list))?$/)?.[1];
    if(groupId) {
      const group=groups.get(groupId);if(!group)throw Error(`unknown group:${groupId}`);
      return structuredClone(path.endsWith('/linked-item-list')?consumers(groupId):path.endsWith('/option-item-list')?group.options:group.detail);
    }
    throw Error(`unexpected read:${path}`);
  }};
  const target=(kind,id,parentId,source={})=>({kind,targetId:id,sourceKey:`${kind}:${id}`,parentId,source,name:kind==='item'?(id==='15'?'carrier item':'selling item'):kind==='category'?'category':'business group',
    price:kind==='item'?100:null,description:'',sortOrder:0,marker:creationMarker(`${kind}:${id}`),mappings:[{externalId:id}]});
  const carrier=target('item','15','12',{groupIds:[]}),selling=target('item','99','12',{groupIds:['group']});
  const category=target('category','12',null),business=target('option_group','10',null,{id:'group',min:0,max:1});business.sourceKey='option_group:group';
  const archived=target('option_group','73',null);archived.archived=true;
  const option={...target('option','194','10'),sourceKey:newKey,name:'option',price:170,marker:creationMarker(optionKey),mappings:[{externalId:'itemList_1194true',externalParentId:'stage:28'}]};
  const payload={authoritativePublication:true,sourceId:'source',storeId:'store',platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',
    draftPatternCode:'draft',draftCarrierItemCode:'15',revision:38,newItemsHidden:true,imagePolicy:'read_only',selectionPolicy:'preserve_native',
    targets:[category,carrier,selling,business,archived,...(excluded?[]:[option])],authorityState:{[optionKey]:{status:'identified',sourceKey:optionKey,externalId:'itemList_1194true',externalParentId:'stage:28'}}};
  const driver=new AuthorityNativeDriver(transport,payload);
  return {payload,driver,transport,items,groups,requests,writes,patterns,categoryLinks,carrier,option,business,archived,liveGroupIds,liveItemIds};
}

test('published options keep independently verified private carriers and their old receipt marker',async()=>{
  const f=fixture();const plan=await f.driver.preflight(f.payload);
  assert.deepEqual(plan.issues,[]);
  const rows=f.driver.contentSnapshot;
  assert.equal(rows.find(row=>row.kind==='option_group'&&row.id==='28').internalCarrier,true);
  assert.equal(f.driver.managedGroup('28',rows),true);
  assert.deepEqual(f.driver.groupIds(f.carrier),['28']);
  const occurrences=rows.filter(row=>row.kind==='option'&&row.id==='194');
  assert.equal(occurrences.length,1);assert.deepEqual(occurrences[0].parentIds,['10']);
  assert.equal(occurrences[0].hidden,false);assert.notEqual(occurrences[0].staged,true);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/option-group/28')).length,1);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/menu-pattern/live/item-list')).length,1);
  assert.equal(f.writes.length,0);
});

test('unpublished and archived options stay private while carrier membership remains independent',async()=>{
  for(const archived of [false,true]) {
    const f=fixture({published:false});f.option.archived=archived;
    const rows=await f.driver.snapshot();
    const option=rows.find(row=>row.kind==='option'&&row.id==='194');
    assert.equal(option.staged,true);assert.equal(option.hidden,true);
    f.driver.contentSnapshot=rows;
    assert.deepEqual(f.driver.groupIds(f.carrier),['28']);
    assert.equal(f.writes.length,0);
  }
});

test('identified historical carriers are preserved even when their logical option is excluded',async()=>{
  const f=fixture({excluded:true});const rows=await f.driver.snapshot();
  f.driver.contentSnapshot=rows;
  assert.deepEqual(f.driver.groupIds(f.carrier),['28']);
  assert.equal(f.driver.managedGroup('28',rows),true);
  assert.equal(collectDemaeInternalCarriers(f.payload).get('28').markers.has(creationMarker(optionKey)),true);
});

test('current stage mappings require their exact original marker when no receipt exists',()=>{
  const f=fixture();f.payload.authorityState={};
  assert.throws(()=>collectDemaeInternalCarriers(f.payload),/marker_conflict/);
  f.option.sourceKey=optionKey;
  assert.equal(collectDemaeInternalCarriers(f.payload).get('28').optionId,'194');
  f.option.mappings[0].externalId='itemList_2194true';
  assert.throws(()=>collectDemaeInternalCarriers(f.payload),/chain_mismatch/);
});

test('native marker, member, consumer, chain, live-placement and size mismatches stop before writes',async()=>{
  const cases=[
    f=>{f.groups.get('28').detail.optionGroupName='FS00000000000000';},
    f=>{f.groups.get('28').detail.adminOptionGroupName='FS00000000000000';},
    f=>{f.groups.get('28').options[0].optionCode='unknown';},
    f=>{f.groups.get('28').options.push({...f.groups.get('28').options[0],optionCode:'unknown'});},
    f=>{f.groups.get('28').consumers=[{chainId:1,itemCode:'99',sizeList:[{sizeCode:'001'}]}];},
    f=>{f.groups.get('28').consumers=[{chainId:1,itemCode:'15',sizeList:[{sizeCode:'001'}]},{chainId:1,itemCode:'unknown',sizeList:[{sizeCode:'001'}]}];},
    f=>{f.groups.get('28').detail.chainId=2;},
    f=>{f.liveGroupIds.push('28');},
    f=>{f.liveItemIds.push('15');},
    f=>{f.groups.get('28').consumers=[{chainId:1,itemCode:'15',sizeList:[{sizeCode:'unknown'}]}];},
    f=>{f.items.get('15').sizeInfoList.push({...structuredClone(f.items.get('15').sizeInfoList[0]),sizeCode:'002'});
      f.groups.get('28').consumers=[{chainId:1,itemCode:'15',sizeList:[{sizeCode:'001'}]}];},
    f=>{f.patterns[1].displayShopCount=1;},
    f=>{f.categoryLinks.set('7',[{chainId:1,menuPatternCode:'live'}]);}
  ];
  for(const mutate of cases) {
    const f=fixture();mutate(f);
    await assert.rejects(()=>runUberAuthorityPublication(f.payload,f.driver,async()=>{}),/carrier_|identity_mismatch|assigned|shared/);
    assert.equal(f.writes.length,0);
  }
});

test('conflicting receipts and business mappings cannot claim an internal group',async()=>{
  const f=fixture();f.payload.authorityState['option:another:other']={status:'identified',externalId:'itemList_1195true',externalParentId:'stage:28'};
  assert.throws(()=>collectDemaeInternalCarriers(f.payload),/receipt_conflict/);
  delete f.payload.authorityState['option:another:other'];
  f.business.mappings=[{externalId:'28'}];
  await assert.rejects(()=>readDemaeInternalCarriers(f.driver.client,f.payload),/business_mapping_conflict/);
  assert.equal(f.writes.length,0);
});

test('empty recorded internal groups remain private, while missing active options still fail',async()=>{
  const f=fixture({published:false});f.groups.get('28').options=[];
  const plan=await f.driver.preflight(f.payload);
  assert.ok(plan.issues.some(issue=>issue.sourceKey===newKey&&issue.code==='mapped_object_missing'));
  assert.deepEqual(f.driver.groupIds(f.carrier),['28']);
  assert.equal(f.writes.length,0);
});

test('unrecorded carrier groups with known options still block the configured private storage item',async()=>{
  const f=fixture();delete f.payload.authorityState[optionKey];f.option.mappings[0].externalParentId='';
  await assert.rejects(()=>runUberAuthorityPublication(f.payload,f.driver,async()=>{}),/preflight_blocked/);
  assert.equal(f.writes.length,0);
});

test('ordinary publication retires the archived business group but preserves carriers, stock and group order',async()=>{
  const f=fixture();const beforeStock=await f.driver.client.stockCatalog();
  const result=await runUberAuthorityPublication(f.payload,f.driver,async()=>{});
  assert.equal(result.outcome,'applied');
  assert.deepEqual(f.items.get('15').sizeInfoList[0].sizeOptionGroupLinkList.map(row=>row.optionGroupCode),['28']);
  assert.deepEqual(f.items.get('99').sizeInfoList[0].sizeOptionGroupLinkList.map(row=>row.optionGroupCode),['10']);
  assert.deepEqual(await f.driver.client.stockCatalog(),beforeStock);
  const carrier=result.observations.find(row=>row.sourceKey===f.carrier.sourceKey);
  assert.equal(carrier.hidden,true);assert.equal(carrier.placement,'staged');assert.equal(carrier.structureVerified,true);
  assert.equal(result.observations.find(row=>row.sourceKey===f.archived.sourceKey).hidden,true);
  assert.equal(f.writes.length,1);assert.match(f.writes[0].path,/\/item\/15$/);
  assert.equal(f.writes[0].body.categoryItemLinkList[0].categoryCode,'7');
});

test('business group ordering is repaired and independently verified without dropping private carriers',async()=>{
  for(const corruptReadback of [false,true]) {
    const f=fixture();
    f.groups.set('20',{detail:{chainId:1,optionGroupCode:'20',optionGroupName:'second business group',adminOptionGroupName:'second business group'},options:[]});
    f.liveGroupIds.push('20');
    f.items.get('99').sizeInfoList[0].sizeOptionGroupLinkList=[{optionGroupCode:'20'},{optionGroupCode:'10'}];
    f.payload.targets.find(target=>target.kind==='item'&&target.targetId==='99').source.groupIds.push('second');
    f.payload.targets.push({kind:'option_group',sourceKey:'option_group:second',targetId:'20',parentId:null,name:'second business group',price:null,
      description:'',sortOrder:1,source:{id:'second',min:0,max:1},marker:creationMarker('option_group:second'),mappings:[{externalId:'20'}]});
    if(corruptReadback) {
      const update=f.driver.client.updateItem.bind(f.driver.client);
      f.driver.client.updateItem=async(id,patch)=>{
        const result=await update(id,patch);
        if(id==='99')f.items.get('99').sizeInfoList[0].sizeOptionGroupLinkList.reverse();
        return result;
      };
      await assert.rejects(()=>runUberAuthorityPublication(f.payload,f.driver,async()=>{}),/content_unverified:item:99/);
    } else {
      const result=await runUberAuthorityPublication(f.payload,f.driver,async()=>{});
      assert.equal(result.observations.find(row=>row.sourceKey==='item:99').structureVerified,true);
      assert.deepEqual(f.items.get('99').sizeInfoList[0].sizeOptionGroupLinkList.map(row=>row.optionGroupCode),['10','20']);
    }
    assert.deepEqual(f.items.get('15').sizeInfoList[0].sizeOptionGroupLinkList.map(row=>row.optionGroupCode),['28']);
  }
});

test('carrier ownership is freshly checked again after native writes, not cached from preflight',async()=>{
  const f=fixture();
  const update=f.driver.client.updateItem.bind(f.driver.client);
  f.driver.client.updateItem=async(id,patch)=>{
    const result=await update(id,patch);
    f.groups.get('28').detail.optionGroupName='FS00000000000000';
    return result;
  };
  await assert.rejects(()=>runUberAuthorityPublication(f.payload,f.driver,async()=>{}),/carrier_group_identity_invalid/);
  assert.equal(f.writes.length,1);
});

test('each carrier is read once per snapshot without a per-group draft/catalog refetch',async()=>{
  const f=fixture();
  for(let i=0;i<8;i++) {
    const id=`carrier${i}`,key=`option:old:option${i}`,optionId=`option${i}`,name=creationMarker(key);
    f.payload.authorityState[key]={status:'identified',externalId:optionId,externalParentId:`stage:${id}`};
    f.groups.set(id,{detail:{chainId:1,optionGroupCode:id,optionGroupName:name,adminOptionGroupName:name},
      options:[{chainId:1,optionCode:optionId,optionName:'private',price:100,...period}]});
    f.items.get('15').sizeInfoList[0].sizeOptionGroupLinkList.push({optionGroupCode:id});
  }
  await f.driver.snapshot();
  for(const id of ['28',...Array.from({length:8},(_,i)=>`carrier${i}`)])
    assert.equal(f.requests.filter(row=>row.path.endsWith(`/option-group/${id}`)).length,1);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/menu-pattern/live/item-list')).length,1);
  // Pattern checks are phase-scoped (source scope, carrier and other draft
  // consumers), not multiplied by the number of internal option groups.
  assert.ok(f.requests.filter(row=>row.path.endsWith('/search/menu-pattern')).length<12);
  assert.equal(f.writes.length,0);
});
