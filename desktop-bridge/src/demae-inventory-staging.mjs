import {DemaeMenuClient} from './demae-menu-client.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';
import {DemaeStagedOption} from './demae-staged-option.mjs';
import {authorityPhysicalId} from './uber-authority-parents.mjs';

const externalIds=values=>[...new Set((values??[]).flatMap(value=>String(value).split(',')).map(value=>value.trim()).filter(Boolean))];
const clearNativeProof=row=>Object.assign(row,{externalIds:[],nativeMatchBasis:null,nativeObservations:[]});
const scalar=value=>typeof value==='string'||typeof value==='number'?String(value):'';
const safeCode=value=>/^[A-Za-z0-9_-]+$/u.test(scalar(value));
const shopKey=row=>JSON.stringify([scalar(row.shopId),row.orderType]);

// The stock target-list is independent of cached inventory DOM. A current
// temporary stockout (isEndSale=false) is still unavailable. Future/noncurrent
// records do not block today's availability. Incomplete or mixed shop/size
// states never prove that a logical object is available everywhere.
function shopAvailability(shops,records,identity) {
 if(!Array.isArray(shops)||!shops.length||!Array.isArray(records)
  ||shops.some(shop=>!/^\d+$/u.test(scalar(shop.shopId))||Number(shop.shopId)<1
   ||typeof shop.orderType!=='string'||!shop.orderType.trim())
  ||new Set(shops.map(shopKey)).size!==shops.length)return null;
 const keys=new Set(shops.map(shopKey));
 if(records.some(record=>!keys.has(shopKey(record))||typeof record.isCurrentApplying!=='boolean'
  ||typeof record.isEndSale!=='boolean'||Object.entries(identity).some(([key,value])=>scalar(record[key])!==value)))return null;
 return new Map(shops.map(shop=>[shopKey(shop),!records.some(record=>shopKey(record)===shopKey(shop)&&record.isCurrentApplying)]));
}

function nativeAvailability(kind,row) {
 const codeKey=kind==='item'?'itemCode':'optionCode',code=scalar(row[codeKey]);
 if(!safeCode(code))return null;
 const shops=shopAvailability(row.linkedShopList,kind==='item'?row.stockoutItemList:row.stockoutOptionList,{[codeKey]:code});
 if(!shops)return null;
 let states=[...shops.values()];
 if(kind==='item') {
  if(!Array.isArray(row.itemSizeList)||!row.itemSizeList.length
   ||row.itemSizeList.some(size=>!safeCode(size.sizeCode))
   ||new Set(row.itemSizeList.map(size=>scalar(size.sizeCode))).size!==row.itemSizeList.length)return null;
  states=[];
  for(const size of row.itemSizeList) {
   const sizes=shopAvailability(size.linkedShopList,size.stockoutItemSizeList,{itemCode:code,sizeCode:scalar(size.sizeCode)});
   if(!sizes||sizes.size!==shops.size||[...shops.keys()].some(key=>!sizes.has(key)))return null;
   states.push(...[...shops].map(([key,available])=>available&&sizes.get(key)));
  }
 }
 return states.length&&states.every(state=>state===states[0])?states[0]:null;
}

// A missing DOM row alone is never evidence of a draft. Reuse the menu
// publisher's isolation checks against fresh native reads; no write APIs.
export async function verifyDemaeInventoryStaging(transport,payload,items,storeId) {
 for(const scope of payload.demaeStaging??[]) {
  if(scope.storeId!==storeId)throw Error('demae_inventory_staging_scope_mismatch');
  const client=new DemaeMenuClient(transport,scope.merchantId,scope.menuPatternCode,scope);
  // A visible inventory row is not enough: confirm its physical identity with
  // the same native client used by menu publication (not cached DOM alone).
  const nativeStock=await client.stockCatalog();
  for(const row of items.filter(row=>row.found&&(scope.graph??[]).some(n=>n.kind===row.kind&&n.targetId===row.targetId))) {
   const target=payload.targets.find(t=>t.kind===row.kind&&t.targetId===row.targetId);
   try {
    const expected=externalIds(target?.knownExternalIds),codeKey=row.kind==='item'?'itemCode':'optionCode';
    const ids=expected.map(id=>authorityPhysicalId('demae_can',row.kind,id,String(scope.merchantId)));
    const native=row.kind==='item'?nativeStock.itemList:nativeStock.optionList;
    const actual=ids.map(id=>native?.filter(n=>String(n.chainId)===String(scope.merchantId)&&scalar(n[codeKey])===id)??[]);
    if(!ids.length||actual.some(matches=>matches.length!==1))throw Error('native_menu_identity_missing');
    const observed=row.nativeObservations;
    if(row.nativeMatchBasis!=='external_id'||!Array.isArray(observed)||observed.length!==expected.length
     ||new Set(observed.map(n=>n.externalId)).size!==expected.length
     ||expected.some(id=>!observed.some(n=>n.externalId===id&&n.found===true&&n.matchBasis==='external_id'
      &&typeof n.isAvailable==='boolean'&&n.isAvailable===row.isAvailable)))throw Error('native_menu_identity_unproven');
    const observations=actual.map(([native])=>({
     // Construct the wrapper from the independently fetched chain/code, not
     // the requested mapping or a private carrier's staging parent.
     externalId:`itemList_${native.chainId}${native[codeKey]}${row.kind==='option'?'true':'false'}`,
     physicalId:scalar(native[codeKey]),found:true,isAvailable:nativeAvailability(row.kind,native),matchBasis:'native_stock'}));
    if(observations.some(n=>!expected.includes(n.externalId)))throw Error('native_menu_identity_unproven');
    if(observations.some(n=>typeof n.isAvailable!=='boolean'||n.isAvailable!==row.isAvailable))throw Error('native_menu_availability_unproven');
    Object.assign(row,{externalIds:observations.map(n=>n.externalId),nativeMatchBasis:'native_stock',nativeObservations:observations});
   }catch(error) {
    clearNativeProof(row);
    Object.assign(row,{found:false,status:'unknown',isAvailable:null,reason:['native_menu_identity_missing','native_menu_identity_unproven','native_menu_availability_unproven'].includes(error.message)?error.message:'native_menu_identity_unproven'});
   }
  }
  const candidates=items.filter(row=>!row.found).flatMap(row=>{
   const hint=scope.targets.find(t=>t.kind===row.kind&&t.targetId===row.targetId);
   const requested=payload.targets.find(t=>t.kind===row.kind&&t.targetId===row.targetId);
   if(!hint||!hint.mappings?.length||!requested?.knownExternalIds?.length||JSON.stringify(hint.mappings.map(m=>m.externalId).sort())!==JSON.stringify([...requested.knownExternalIds].sort()))return [];
   return [{row,hint}];
  });
  if(!candidates.length)continue;
  const id=(kind,value)=>authorityPhysicalId('demae_can',kind,value,String(scope.merchantId));
  await client.assertScope();
  const stock=await client.stockCatalog();
  for(const {row,hint} of candidates.filter(c=>c.row.kind==='item')) {
   try {
    for(const mapping of hint.mappings) {
     const code=id('item',mapping.externalId);
     if(stock.itemList.some(t=>String(t.itemCode)===code))throw Error('published');
     const item=await client.item(code);
     if(String(item.chainId)!==String(scope.merchantId)||String(item.itemCode)!==code)throw Error('identity');
     if(!Array.isArray(item.categoryItemLinkList)||item.categoryItemLinkList.length)
      await new DemaeDraftClient(transport,scope.merchantId,scope.menuPatternCode).assertHiddenItem(scope.draftPatternCode,code);
    }
    clearNativeProof(row);
    Object.assign(row,{found:true,status:'staged',isAvailable:null,stagingVerified:true});
   }catch {row.reason='staging_verification_failed';}
  }
  const options=candidates.filter(c=>c.row.kind==='option');
  // Batch the expensive scope/readback checks; no per-option full catalog loop.
  try {
   const identities=options.flatMap(({hint})=>hint.mappings.map(m=>{
    if(!m.externalParentId?.startsWith('stage:'))throw Error('staging_parent_missing');
    return {optionCode:id('option',m.externalId),groupCode:m.externalParentId.slice(6),marker:hint.marker};
   }));
   await new DemaeStagedOption(client).readAll(identities);
   for(const {row} of options) {
    clearNativeProof(row);
    Object.assign(row,{found:true,status:'staged',isAvailable:null,stagingVerified:true});
   }
  }catch {for(const {row} of options)row.reason='staging_verification_failed';}
 }
 return items;
}
