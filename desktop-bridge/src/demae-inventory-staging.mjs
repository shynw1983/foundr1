import {DemaeMenuClient} from './demae-menu-client.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';
import {DemaeStagedOption} from './demae-staged-option.mjs';
import {authorityPhysicalId} from './uber-authority-parents.mjs';

// A missing DOM row alone is never evidence of a draft. Reuse the menu
// publisher's isolation checks against fresh native reads; no write APIs.
export async function verifyDemaeInventoryStaging(transport,payload,items,storeId) {
 for(const scope of payload.demaeStaging??[]) {
  if(scope.storeId!==storeId)throw Error('demae_inventory_staging_scope_mismatch');
  const client=new DemaeMenuClient(transport,scope.merchantId,scope.menuPatternCode,scope);
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
   for(const {row} of options)Object.assign(row,{found:true,status:'staged',isAvailable:null,stagingVerified:true});
  }catch {for(const {row} of options)row.reason='staging_verification_failed';}
 }
 return items;
}
