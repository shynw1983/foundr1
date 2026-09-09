// An explicit Store available action may publish only freshly verified drafts.
// Unknown identities must fail before any of the batch is written.
export async function prepareDemaeSingleRelease(adapter,payload) {
 if(payload.manualItemRelease!==true)return payload;
 if(payload.syncSource!=='store'||typeof payload.isAvailable!=='boolean'||!payload.syncRunId||payload.fullSyncRunId)throw Error('demae_release_requires_manual_confirmation');
 const audit=await adapter.auditInventory(payload);
 const targets=payload.targets??[];
 if(!targets.length||audit.items.length!==targets.length)throw Error('inventory_readback_mismatch');
 const prepared=targets.flatMap(target=>{
  const matches=audit.items.filter(row=>row.kind===target.kind&&row.targetId===target.targetId);
  const row=matches[0];
  if(matches.length!==1||row.found!==true)throw Error(`商品の対応関係を確認できません。メニュー連携を確認してください: ${target.label}`);
  if(row.status==='staged') {
   if(row.stagingVerified===true&&payload.isAvailable===false)return [];
   if(row.stagingVerified!==true||!row.releasePlan)throw Error(`非公開商品の販売開始を確認できません: ${target.label} (${row.releaseError??'メニュー連携を確認してください'})`);
   return [{...target,releasePlan:row.releasePlan}];
  }
  if(typeof row.isAvailable!=='boolean')throw Error(`販売状態を確認できません: ${target.label}`);
  return [target];
 });
 return {...payload,targets:prepared};
}
