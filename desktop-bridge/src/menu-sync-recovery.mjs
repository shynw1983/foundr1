import {RocketMenuClient} from './rocket-menu-client.mjs';
import {DemaeMenuClient} from './demae-menu-client.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';
import {DemaeStagedOption} from './demae-staged-option.mjs';
import {authorityPhysicalId} from './uber-authority-parents.mjs';
import {validateAuthorityCommand} from './uber-authority-runner.mjs';
import {connectMerchantMenuClient,sameMenuValue} from './merchant-menu-client.mjs';
import {createMenuProgress} from './menu-progress.mjs';

const modes=['inspect','restore_hidden','verify_release'];
const text=value=>String(value??'');
const fail=code=>{throw Error(`menu_sync_recovery_${code}`);};
const current=(row,today)=>text(row.applyStartDate).replaceAll('/','-')<=today&&text(row.applyEndDate).replaceAll('/','-')>=today;

/** The graph and durable mapping establish identity; native names never do. */
export function validateMenuSyncRecovery(payload,platform,merchantId,storeId) {
  if(!['rocket_now','demae_can'].includes(platform))fail('platform_unsupported');
  validateAuthorityCommand(payload,platform,merchantId);
  if(payload.storeId!==storeId)fail('store_scope_mismatch');
  const recovery=payload.recovery;
  if(recovery?.version!==1||!modes.includes(recovery.mode)||!recovery.failedJobId||!recovery.sourceKey||!recovery.externalId)fail('command_invalid');
  const targets=payload.targets.filter(target=>target.sourceKey===recovery.sourceKey);
  if(targets.length!==1)fail('target_ambiguous');
  const target=targets[0];
  if(!['item','option'].includes(target.kind)||target.archived||target.quarantined)fail('target_unsupported');
  const matches=target.mappings.filter(mapping=>mapping.externalId===recovery.externalId);
  if(matches.length!==1||matches[0].created!==true)fail('creation_mapping_unverified');
  const mapping=matches[0];
  if(text(mapping.externalParentId)!==text(recovery.externalParentId))fail('parent_mismatch');
  if(payload.migrationState?.[target.sourceKey]||Object.values(payload.migrationState??{}).some(row=>row?.targetId===target.targetId))fail('migration_pending');
  const physicalId=authorityPhysicalId(platform,target.kind,recovery.externalId,merchantId);
  const owners=payload.targets.filter(row=>row.kind===target.kind).flatMap(row=>row.mappings.map(mapping=>({row,mapping})))
    .filter(entry=>authorityPhysicalId(platform,target.kind,entry.mapping.externalId,merchantId)===physicalId);
  if(owners.length!==1||owners[0].row.targetId!==target.targetId)fail('identity_shared');
  const parent=payload.targets.find(row=>row.targetId===target.parentId);
  if(!parent||parent.archived||parent.quarantined||parent.kind!==(target.kind==='option'?'option_group':'category'))fail('parent_unverified');
  const parentIds=parent.mappings.map(row=>authorityPhysicalId(platform,parent.kind,row.externalId,merchantId));
  if(!parentIds.length||new Set(parentIds).size!==parentIds.length)fail('parent_unverified');
  if(platform==='rocket_now') {
    const encoded=text(recovery.externalId).match(/^sub_checkbox_(\d+)_(\d+)$/u);
    if(encoded?encoded[1]!==text(mapping.externalParentId)||!parentIds.includes(encoded[1])
      :!/^\d+$/.test(text(recovery.externalId))||!parentIds.includes(text(mapping.externalParentId)))fail('parent_mismatch');
  }
  return {recovery,target,mapping,physicalId,parent,parentIds};
}

function validateGuard(payload,context,now) {
  const {recovery}=context,guard=recovery.guard;
  if(!guard||guard.revision!==payload.revision||!Number.isFinite(guard.checkedAt)
    ||now()-guard.checkedAt>120000||guard.checkedAt>now()+5000)fail('guard_stale');
  if(recovery.mode==='restore_hidden'&&(guard.holdActive!==true||guard.releaseCommandId))fail('hold_unverified');
  if(recovery.mode==='verify_release'&&(!guard.releaseCommandId||guard.expectedAvailable!==true||guard.holdActive===true))fail('release_unverified');
}

function rocketObservation(context,detail,parentIds,parentNames) {
  const {target}=context,option=target.kind==='option';
  const status=detail.displayStatus;
  const known=['ON_SALE','NOT_EXPOSE','SOLD_OUT_TODAY'].includes(status)
    &&(detail.forceNotExpose===undefined||typeof detail.forceNotExpose==='boolean');
  const name=option?detail.optionItemName:detail.dishName;
  const price=Number(detail.salePrice);
  return {found:true,name,price:Number.isSafeInteger(price)?price:null,parentIds,parentNames,
    nativeStatus:known?status:'UNKNOWN',hidden:known?status==='NOT_EXPOSE':null,
    isAvailable:known?status==='ON_SALE'&&detail.forceNotExpose!==true:null,
    identityVerified:parentIds.length===1&&context.parentIds.includes(parentIds[0])&&parentIds[0]===text(context.mapping.externalParentId),
    forceNotExpose:detail.forceNotExpose===true};
}

async function inspectRocket(client,context) {
  if(context.target.kind==='item') {
    const detail=await client.detail(context.physicalId);
    if(text(detail?.dishId)!==context.physicalId)fail('native_identity_mismatch');
    if(!Array.isArray(detail.mappingMenus))fail('native_parent_unknown');
    return rocketObservation(context,detail,detail.mappingMenus.map(row=>text(row.menuId)),detail.mappingMenus.map(row=>text(row.menuName)).filter(Boolean));
  }
  const catalog=await client.catalog();
  const matches=catalog.groups.flatMap(group=>(group.optionItems??[]).filter(row=>text(row.optionItemId)===context.physicalId).map(item=>({group,item})));
  if(matches.length>1)fail('native_identity_ambiguous');
  if(!matches.length)return {found:false,identityVerified:false,nativeStatus:'UNKNOWN',hidden:null,isAvailable:null,parentIds:[],parentNames:[]};
  const {group,item}=matches[0];
  return rocketObservation(context,item,[text(group.optionId)],[text(group.optionName)]);
}

// Demae's native status is a shop/order-type hold, including size holds.
// An absent/truncated stock row is unknown, never proof of availability.
export function recoveryDemaeStock(state,kind,id) {
  if(state?.listed!==true||!Array.isArray(state.linkedShops)||!state.linkedShops.length||!Array.isArray(state.records)||!Array.isArray(state.sizes))fail('native_stock_unknown');
  const key=kind==='item'?'itemCode':'optionCode';
  const active=(records,shops,sizeCode)=>{
    if(!Array.isArray(records)||!Array.isArray(shops)||!shops.length)fail('native_stock_unknown');
    if(shops.some(shop=>!state.linkedShops.some(owner=>text(owner.shopId)===text(shop.shopId)&&owner.orderType===shop.orderType)))fail('native_stock_unknown');
    return records.filter(row=>{
      if(typeof row.isCurrentApplying!=='boolean')fail('native_stock_unknown');
      if(!row.isCurrentApplying||row.stockoutCancelDateTime)return false;
      if(text(row[key])!==text(id)||!shops.some(shop=>text(shop.shopId)===text(row.shopId)&&shop.orderType===row.orderType)
        ||sizeCode!==undefined&&text(row.sizeCode)!==text(sizeCode)||!Number.isFinite(Date.parse(row.applyStartTime))||!Number.isFinite(Date.parse(row.applyEndTime)))fail('native_stock_unknown');
      return true;
    });
  };
  const root=active(state.records,state.linkedShops);
  const sizes=state.sizes.flatMap(size=>active(size.records,size.linkedShops,size.sizeCode));
  if(kind==='item'&&!state.sizes.length)fail('native_stock_unknown');
  return {unavailable:root.length+sizes.length>0,permanentlyUnavailable:root.length>0&&state.linkedShops.every(shop=>root.some(row=>text(row.shopId)===text(shop.shopId)&&row.orderType===shop.orderType&&row.isEndSale===true))};
}

async function inspectDemae(client,context,payload) {
  const {target,physicalId,parentIds,mapping}=context;
  await client.assertScope();
  const remote=await client.catalog();
  let native,actualParents,parentNames,staged=false;
  if(target.kind==='item') {
    native=await client.item(physicalId);
    if(text(native?.itemCode)!==physicalId||text(native.chainId)!==client.chainId)fail('native_identity_mismatch');
    const parents=remote.items.categoryList.filter(category=>category.itemList?.some(row=>text(row.itemCode)===physicalId));
    actualParents=parents.map(row=>text(row.categoryCode));parentNames=parents.map(row=>text(row.categoryName));
    if(!actualParents.length) {
      native=await new DemaeDraftClient(client.transport,client.chainId,payload.menuPatternCode).assertHiddenItem(payload.draftPatternCode,physicalId);
      staged=true;actualParents=[`draft:${payload.draftPatternCode}`];parentNames=[''];
    }
  } else {
    const options=(await client.options()).filter(row=>text(row.optionCode)===physicalId&&current(row,client.today));
    if(options.length>1)fail('native_identity_ambiguous');
    if(options.length===1) {
      native=options[0];actualParents=(await client.optionOccurrences(physicalId)).map(String);
      parentNames=actualParents.map(id=>text(remote.groups.find(row=>text(row.optionGroupCode)===id)?.optionGroupName));
    } else {
      if(!text(mapping.externalParentId).startsWith('stage:')||mapping.externalParentId==='stage:__creating__')fail('native_missing');
      const result=await new DemaeStagedOption(client).read({optionCode:physicalId,groupCode:mapping.externalParentId.slice(6),marker:target.marker});
      native=result.option;staged=true;actualParents=[mapping.externalParentId];parentNames=[''];
    }
    if(text(native?.chainId)!==client.chainId||text(native.optionCode)!==physicalId)fail('native_identity_mismatch');
  }
  const sizes=target.kind==='item'?(native.sizeInfoList??[]).filter(row=>current(row,client.today)):[];
  const price=Number(target.kind==='item'?(sizes.length===1?sizes[0].price:NaN):native.price);
  let hidden=true,isAvailable=false,nativeStatus='UNASSIGNED_DRAFT';
  if(!staged) {
    const state=recoveryDemaeStock(await client.stockState(target.kind,physicalId),target.kind,physicalId);
    hidden=state.permanentlyUnavailable;isAvailable=!state.unavailable;
    nativeStatus=hidden?'PERMANENT_HOLD':state.unavailable?'HELD':'AVAILABLE';
  }
  return {found:true,identityVerified:staged?actualParents.length===1&&actualParents[0]===text(mapping.externalParentId)
    :actualParents.length===1&&parentIds.includes(actualParents[0]),name:target.kind==='item'?native.itemName:native.optionName,
    price:Number.isSafeInteger(price)?price:null,parentIds:actualParents,parentNames,nativeStatus,hidden,isAvailable,staged};
}

function blockersFor(observation,target) {
  const blockers=[];
  if(!observation.found)blockers.push('native_missing');
  if(!observation.identityVerified)blockers.push('identity_unverified');
  if(observation.name!==target.name||observation.price!==target.price)blockers.push('content_changed');
  if(observation.nativeStatus==='UNKNOWN'||typeof observation.hidden!=='boolean'||typeof observation.isAvailable!=='boolean')blockers.push('native_status_unknown');
  return blockers;
}

/** Native reads never adopt by name. Only restore_hidden may mutate, and only
 * an existing exact ID after the server accepts a fresh final guard ACK. */
export async function runMenuSyncRecovery(payload,client,reportProgress,{now=Date.now,platform=payload.platformKey,merchantId=payload.merchantId,storeId=payload.storeId}={}) {
  const context=validateMenuSyncRecovery(payload,platform,merchantId,storeId);
  const {recovery,target,mapping}=context;
  if(typeof reportProgress!=='function')fail('progress_required');
  if(recovery.mode!=='inspect')validateGuard(payload,context,now);
  const progress={sourceKey:target.sourceKey,targetName:target.name,targetKind:target.kind,parentName:context.parent.name};
  await reportProgress({phase:'recovery_inspecting',...progress,completed:0,total:1});
  const inspect=()=>platform==='rocket_now'?inspectRocket(client,context):inspectDemae(client,context,payload);
  const before=await inspect();
  const blockers=blockersFor(before,target);
  let changed=0,observation=before,outcome='inspected';
  if(recovery.mode==='verify_release') {
    validateGuard(payload,context,now);
    if(before.isAvailable!==true)blockers.push('release_not_available');
    outcome=blockers.length?'blocked':'verified_release';
  } else if(recovery.mode==='restore_hidden') {
    if(blockers.length)outcome='blocked';
    else if(before.hidden===true)outcome='already_hidden';
    else if(platform!=='rocket_now') {blockers.push('restore_unsupported');outcome='blocked';}
    else {
      const finalGuard=async native=>{
        const currentObservation=target.kind==='item'?rocketObservation(context,native.detail,native.detail.mappingMenus.map(row=>text(row.menuId)),native.detail.mappingMenus.map(row=>text(row.menuName)).filter(Boolean))
          :rocketObservation(context,native.item,[text(native.group.optionId)],[text(native.group.optionName)]);
        if(blockersFor(currentObservation,target).length||!sameMenuValue(currentObservation,before))fail('native_changed');
        validateGuard(payload,context,now);
        // Awaiting this ACK is a write precondition. A rejected, unavailable or
        // stale server must stop the merchant mutation, never be swallowed.
        await reportProgress({phase:'recovery_guard',recoveryGuard:true,...progress,recoveryMode:recovery.mode,
          externalId:recovery.externalId,externalParentId:mapping.externalParentId,failedJobId:recovery.failedJobId});
        validateGuard(payload,context,now);
      };
      if(target.kind==='item')await client.updateDish(context.physicalId,{retire:true},finalGuard);
      else await client.updateOption(context.physicalId,{retire:true},finalGuard);
      // The existing client verifies its own write; this independent read is
      // the recovery evidence sent to OS and may still fail the whole action.
      observation=await inspect();changed=1;
      if(blockersFor(observation,target).length||observation.hidden!==true||observation.isAvailable!==false)fail('readback_unverified');
      outcome='restored_hidden';
    }
  }
  const identified={...observation,sourceKey:target.sourceKey,targetId:target.targetId,kind:target.kind,
    externalId:recovery.externalId,externalParentId:text(mapping.externalParentId)};
  await reportProgress({phase:'recovery_complete',...progress,completed:1,total:1});
  const inspectedAt=now(),capturedAt=new Date(inspectedAt).toISOString();
  return {recoveryVersion:1,sourceId:payload.sourceId,brandId:payload.brandId,storeId:payload.storeId,revision:payload.revision,
    platformKey:platform,merchantId:text(merchantId),failedJobId:recovery.failedJobId,mode:recovery.mode,
    sourceKey:target.sourceKey,targetId:target.targetId,kind:target.kind,externalId:recovery.externalId,
    externalParentId:text(mapping.externalParentId),inspection:identified,observations:[identified],
    outcome,changed,blockers,inspectedAt,capturedAt,canRestoreHidden:platform==='rocket_now'&&!blockers.length&&observation.hidden===false};
}

export async function recoverNativeMenuSync(session,platform,payload,reportProgress,merchantId) {
  validateMenuSyncRecovery(payload,platform,merchantId??payload.merchantId,session.config?.storeId);
  const rocket=platform==='rocket_now',progress=createMenuProgress(reportProgress);
  const transport=await connectMerchantMenuClient(session,rocket?'https://store.rocketnow.co.jp':'https://partner.demae-can.com',rocket?'SUCCESS':'MSA0000',progress.request);
  const client=rocket?new RocketMenuClient(transport,payload.merchantId):new DemaeMenuClient(transport,payload.merchantId,payload.menuPatternCode,{draftPatternCode:payload.draftPatternCode,draftCarrierItemCode:payload.draftCarrierItemCode});
  const target=payload.targets.find(row=>row.sourceKey===payload.recovery.sourceKey);
  const parent=payload.targets.find(row=>row.targetId===target.parentId);
  try {
    // Guard progress bypasses telemetry throttling, because the server ACK is
    // part of the authorization protocol immediately preceding a mutation.
    const report=update=>update.recoveryGuard===true?reportProgress(update):progress.stage(update);
    return await transport.withProgress({sourceKey:target.sourceKey,targetName:target.name,targetKind:target.kind,parentName:parent?.name},
      ()=>runMenuSyncRecovery(payload,client,report,{platform,merchantId:merchantId??payload.merchantId,storeId:session.config?.storeId}));
  } finally {transport.close();}
}
