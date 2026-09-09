import {DemaeMenuClient} from './demae-menu-client.mjs';
import {authorityPhysicalId} from './uber-authority-parents.mjs';
import {verifyDemaeInventoryStaging} from './demae-inventory-staging.mjs';

// Planning and execution both read native relationships. Inventory release
// never creates objects, guesses names, or enables an entire draft pattern.
export async function planDemaeRelease(transport,scope,target,cache=new Map()) {
 const graph=scope.graph??[],node=graph.find(n=>n.kind===target.kind&&n.targetId===target.targetId);
 const physical=(kind,id)=>authorityPhysicalId('demae_can',kind,id,String(scope.merchantId));
 const ids=n=>(n?.mappings??[]).map(m=>physical(n.kind,m.externalId));
 if(!node||ids(node).length!==1)throw Error('新品の対応関係が不完全です');
 const id=ids(node)[0],client=new DemaeMenuClient(transport,scope.merchantId,scope.menuPatternCode,scope);
 const key=`${scope.merchantId}:${scope.menuPatternCode}`;
 if(!cache.has(key))cache.set(key,await client.catalog());
 const catalog=cache.get(key);
 if(node.kind==='option') {
  const parent=graph.find(n=>n.kind==='option_group'&&n.targetId===node.parentId);
  const groups=ids(parent);
  if(!groups.length)throw Error('対応する選択グループがありません。メニュー連携を確認してください');
  const liveIds=new Set(catalog.items.categoryList.flatMap(c=>c.itemList??[]).map(i=>String(i.itemCode)));
  const consumers=graph.filter(n=>n.kind==='item'&&n.source?.groupIds?.some(g=>parent.sourceKey===`option_group:${g}`)).flatMap(ids).filter(id=>liveIds.has(id));
  const links=[];
  for(const itemId of [...new Set(consumers)]) {
   const itemKey=`${key}:item:${itemId}`;
   if(!cache.has(itemKey))cache.set(itemKey,await client.item(itemId));
   const item=cache.get(itemKey),sizes=(item.sizeInfoList??[]).filter(s=>String(s.applyStartDate).replaceAll('/','-')<=client.today&&String(s.applyEndDate).replaceAll('/','-')>=client.today);
   if(sizes.length!==1)throw Error('商品の有効なサイズを特定できません');
   links.push({itemCode:itemId,sizeCode:sizes[0].sizeCode});
  }
  for(const groupId of groups) {
   const group=await client.group(groupId);
   if(!catalog.groups.some(g=>String(g.optionGroupCode)===groupId)&&!links.length)throw Error('Uber の選択グループに販売中の商品が関連付けられていません');
   const hidden=group.items.filter(i=>!liveIds.has(String(i.itemCode)));
   if(hidden.length)await client.hiddenGroupItems(hidden);
   const stock=await client.stockCatalog();
   if(group.options.some(o=>String(o.optionCode)!==id&&!stock.optionList.some(l=>String(l.optionCode)===String(o.optionCode))))throw Error('同じ選択グループに未確認の下書きがあります');
  }
  return {kind:node.kind,targetId:node.targetId,id,groups,links};
 }
 if(id===String(scope.draftCarrierItemCode??''))throw Error('下書き保管用の商品です。先に選択肢の保管先を整理してください');
 const parent=graph.find(n=>n.kind==='category'&&n.targetId===node.parentId),categories=ids(parent);
 if(categories.length!==1||!catalog.items.categoryList.some(c=>String(c.categoryCode)===categories[0]))throw Error('対応する正式分類がありません');
 const sourceGroups=node.source?.groupIds;
 if(!Array.isArray(sourceGroups))throw Error('商品の選択グループ情報が不完全です');
 const groups=sourceGroups.flatMap(sourceId=>{
  const mapped=ids(graph.find(n=>n.sourceKey===`option_group:${sourceId}`));
  if(!mapped.length)throw Error('商品の選択グループ対応がありません');return mapped;
 });
 for(const groupId of groups) {
  const group=await client.group(groupId);
  if(!group.options.length||!catalog.groups.some(g=>String(g.optionGroupCode)===groupId))throw Error('商品の選択グループが未公開または空です');
 }
 return {kind:node.kind,targetId:node.targetId,id,category:categories[0],groups:[...new Set(groups)]};
}

export async function releaseDemaeInventory(transport,payload,storeId,onProgress=async()=>{}) {
 if(payload.availabilityAuthority!=='uber_eats'||payload.isAvailable!==true||!payload.fullSyncRunId||payload.syncSource!=='store')throw Error('demae_release_requires_manual_confirmation');
 const tasks=[],cache=new Map();
 for(const target of payload.targets??[]) {
  if(!target.releasePlan)continue;
  await onProgress({phase:'locating',targetName:target.label,action:'release_preflight',completed:tasks.length,total:payload.targets.filter(t=>t.releasePlan).length});
  const scopes=(payload.demaeStaging??[]).filter(s=>s.storeId===storeId&&s.targets.some(t=>t.kind===target.kind&&t.targetId===target.targetId));
  if(scopes.length!==1)throw Error('demae_release_scope_mismatch');
  const scope=scopes[0],plan=await planDemaeRelease(transport,scope,target,cache);
  if(JSON.stringify(plan)!==JSON.stringify(target.releasePlan))throw Error('公開先がプレビュー後に変わりました。再読み取りしてください');
  const client=new DemaeMenuClient(transport,scope.merchantId,scope.menuPatternCode,scope);
  const stock=await client.stockState(target.kind,plan.id);
  if(!stock.listed) {
   const rows=[{kind:target.kind,targetId:target.targetId,found:false,status:'unknown',isAvailable:null}];
   await verifyDemaeInventoryStaging(transport,{targets:[target],demaeStaging:[scope]},rows,storeId);
   if(rows[0].stagingVerified!==true)throw Error('下書きの安全確認に失敗しました');
  } // A prior partially successful attempt is re-read, never recreated.
  tasks.push({client,plan,label:target.label});
 }
 // All selected targets are preflighted before any release write.
 let completed=0;
 for(const {client,plan,label} of tasks) {
  await onProgress({phase:'applying',targetName:label,action:'release_new_item',completed,total:tasks.length});
  if(plan.kind==='option') {
   for(const id of plan.groups) {
    const group=await client.group(id),ids=[...new Set(group.options.map(o=>String(o.optionCode)))];
    const existing=group.items.flatMap(i=>i.sizeList.map(s=>({itemCode:i.itemCode,sizeCode:s.sizeCode})));
    const additions=(plan.links??[]).filter(l=>!existing.some(e=>e.itemCode===l.itemCode&&e.sizeCode===l.sizeCode));
    if(!ids.includes(plan.id)||additions.length)await client.updateGroup(id,{optionCodes:[...new Set([...ids,plan.id])],releaseAvailableOptionIds:[plan.id],...(additions.length?{releaseItemLinks:[...existing,...additions]}:{})});
   }
  }else {
   const groupLinks=[];
   for(const id of plan.groups) {const g=await client.group(id);groupLinks.push({chainId:Number(client.chainId),optionGroupCode:id,optionGroupName:g.detail.optionGroupName,dispOrder:groupLinks.length+1});}
   await client.updateItem(plan.id,{categoryLinks:[{categoryCode:plan.category}],groupLinks,allowCategoryMove:true,releaseAvailable:true});
  }
  if(!(await client.stockState(plan.kind,plan.id)).listed)throw Error('新品の公開結果を確認できません。再読み取りしてください');
  completed++;await onProgress({phase:'applying',targetName:label,action:'release_verified',completed,total:tasks.length});
 }
 return tasks.length;
}
