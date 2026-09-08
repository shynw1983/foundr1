/** No blind create retries. A deterministic hidden marker plus a required,
 * server-persisted reservation covers both uncertain HTTP results and revisions. */
export async function ensureUberAuthorityObject(target, payload, driver, reportProgress) {
  if(target.quarantined===true)throw Error(`uber_authority_object_quarantined:${target.sourceKey}`);
  if (target.mappings?.length) return target.mappings;
  const saveReceipt=async receipt=>{
    if(!receipt?.externalId)throw Error('uber_authority_receipt_missing');
    await reportProgress({phase:'received',authorityOperation:{sourceKey:target.sourceKey,status:'received',externalId:String(receipt.externalId),externalParentId:String(receipt.externalParentId??'')}});
    payload.authorityState??={};
    payload.authorityState[target.sourceKey]={status:'creating',externalId:String(receipt.externalId),externalParentId:String(receipt.externalParentId??'')};
  };
  const locate = async candidate => {
    if(candidate?.externalId && driver.findById) {
      const direct=await driver.findById(String(candidate.externalId),target,candidate);
      if(direct) {
        if(String(direct.externalId)!==String(candidate.externalId)||direct.marker!==target.marker)throw Error(`uber_authority_receipt_identity_mismatch:${target.sourceKey}`);
        return direct;
      }
    }
    const found = await driver.findMarker(target.marker, target);
    if (!Array.isArray(found) || found.length > 1) throw new Error(`uber_authority_marker_ambiguous:${target.sourceKey}`);
    if(found[0] && candidate?.externalId && String(found[0].externalId)!==String(candidate.externalId))throw Error(`uber_authority_receipt_identity_mismatch:${target.sourceKey}`);
    return found[0];
  };
  let found = await locate(payload.authorityState?.[target.sourceKey]);
  if(!found&&payload.authorityState?.[target.sourceKey]?.status==='creating'&&driver.resumeHidden) {
    const receipt=await driver.resumeHidden(target,{receipt:payload.authorityState[target.sourceKey],saveReceipt});
    if(receipt)found=await locate(receipt);
  }
  if (!found) {
    if (payload.authorityState?.[target.sourceKey] && payload.authorityState[target.sourceKey].status!=='rejected') throw new Error(`uber_authority_create_uncertain:${target.sourceKey}`);
    // The server reserves this source/platform/object across all revisions.
    // A lost acknowledgement must abort here, before any merchant write.
    await reportProgress({phase:'creating',authorityOperation:{sourceKey:target.sourceKey,status:'creating'}});
    let receipt;
    try {receipt=await driver.createHidden(target,{saveReceipt});} catch(error) {
      // Only a platform-specific, definite input rejection permits another
      // attempt. A timeout/network/server error remains uncertain forever
      // until the marker or a human investigation resolves it.
      if(driver.isDefiniteRejection?.(error)===true)await reportProgress({phase:'rejected',authorityOperation:{sourceKey:target.sourceKey,status:'rejected'}});
      throw error;
    }
    if(receipt?.externalId)await saveReceipt(receipt);
    found = await locate(receipt);
    if (!found) throw new Error(`uber_authority_create_uncertain:${target.sourceKey}`);
  }
  if (!found.externalId || found.hidden !== true) throw new Error(`uber_authority_create_not_hidden:${target.sourceKey}`);
  const mapping={externalId:String(found.externalId),externalParentId:String(found.externalParentId??''),created:true};
  // Persist the identity BEFORE replacing the marker with the customer name.
  await reportProgress({phase:'identified',authorityOperation:{sourceKey:target.sourceKey,status:'identified',...mapping}});
  target.mappings=[mapping];
  return target.mappings;
}
