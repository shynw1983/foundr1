import {ensureUberAuthorityObject} from './uber-authority-create.mjs';

export function validateAuthorityCommand(payload,platform,merchantId) {
  if(payload?.authoritativePublication!==true||payload.platformKey!==platform
    ||String(payload.merchantId)!==String(merchantId)||!payload.sourceId||!payload.storeId
    ||!Number.isSafeInteger(payload.revision)||payload.revision<1||payload.newItemsHidden!==true
    ||payload.imagePolicy!=='read_only'||!Array.isArray(payload.targets)||!payload.targets.length)
    throw Error('uber_authority_command_invalid');
  const keys=new Set();
  for(const target of payload.targets) {
    if(!target.sourceKey||keys.has(target.sourceKey)||!target.targetId
      ||!['category','option_group','item','option'].includes(target.kind)
      ||!Array.isArray(target.mappings)||!/^FS[0-9a-f]{14}$/.test(target.marker))throw Error('uber_authority_target_invalid');
    keys.add(target.sourceKey);
    if(!target.archived&&['item','option'].includes(target.kind)&&(!Number.isSafeInteger(target.price)||target.price<0))throw Error('uber_authority_price_invalid');
  }
}

/** A single resumable execution path for both platforms. Drivers must preflight
 * the complete graph before writes and must return fresh native observations,
 * never desired-state echoes. Progress acknowledgements are mandatory. */
export async function runUberAuthorityPublication(payload,driver,reportProgress) {
  validateAuthorityCommand(payload,driver.platform,driver.merchantId);
  if(typeof reportProgress!=='function')throw Error('uber_authority_progress_required');
  await reportProgress({phase:'preflight',total:payload.targets.length});
  const plan=await driver.preflight(payload);
  if(!plan||!Array.isArray(plan.issues))throw Error('uber_authority_preflight_missing');
  if(plan.issues.length) {
    await reportProgress({phase:'blocked',issues:plan.issues});
    const error=Error(`uber_authority_preflight_blocked:${plan.issues.length}:${JSON.stringify(plan.issues).slice(0,2500)}`);
    error.issues=plan.issues;
    throw error;
  }
  const active=payload.targets.filter(target=>!target.archived&&!target.quarantined);
  await driver.beginPhase?.('content');
  // Categories/groups must exist before creating products/options. Native
  // drivers may stage all children with a group creation, journaled separately.
  for(const kind of ['category','option_group','option','item']) {
    for(const target of active.filter(target=>target.kind===kind)) {
      if(!target.mappings.length)await ensureUberAuthorityObject(target,payload,driver,reportProgress);
      await reportProgress({phase:'content',sourceKey:target.sourceKey});
      try {await driver.updateContent(target,payload);}
      catch(error) {throw new Error(`uber_authority_content_failed:${target.sourceKey}:${target.name}:${error.message}`,{cause:error});}
    }
  }
  // Remove retired choices before validating the remaining group membership.
  // Content updates never restore stock; removals cannot expose a new choice.
  for(const target of payload.targets.filter(target=>target.archived&&!target.quarantined&&target.kind==='option')) {
    await reportProgress({phase:'retiring',sourceKey:target.sourceKey});
    await driver.retire(target,payload);
  }
  // Relationship changes come last, after children are persisted and hidden.
  await driver.beginPhase?.('relationships');
  for(const target of ['option_group','item','category'].flatMap(kind=>active.filter(target=>target.kind===kind))) {
    await reportProgress({phase:'relationships',sourceKey:target.sourceKey});
    await driver.updateRelationships(target,payload);
  }
  for(const kind of ['item','option_group','category'])for(const target of payload.targets.filter(target=>target.archived&&!target.quarantined&&target.kind===kind)) {
    await reportProgress({phase:'retiring',sourceKey:target.sourceKey});
    await driver.retire(target,payload);
  }
  await reportProgress({phase:'verifying'});
  await driver.beginPhase?.('verifying');
  const observations=[];
  for(const target of payload.targets) {
    if(target.quarantined){observations.push({sourceKey:target.sourceKey,quarantined:true});continue;}
    const rows=await driver.observe(target,payload);
    if(!Array.isArray(rows)||!rows.length)throw Error(`uber_authority_observation_missing:${target.sourceKey}`);
    for(const row of rows) {
      if(row.sourceKey!==target.sourceKey)throw Error('uber_authority_observation_identity_mismatch');
      if(target.archived) {
        if(row.exists!==false&&row.hidden!==true)throw Error(`uber_authority_retirement_unverified:${target.sourceKey}`);
      } else if(row.name!==target.name||(target.price!==null&&row.price!==target.price)||row.structureVerified!==true) {
        throw Error(`uber_authority_content_unverified:${target.sourceKey}`);
      }
      // A new category/group may contain an already-selling product moved
      // from another parent. Only newly created sellable records must remain
      // hidden; all parent memberships are independently verified above.
      if(['item','option'].includes(target.kind)&&target.mappings.some(mapping=>mapping.externalId===row.externalId&&mapping.created===true)&&row.hidden!==true)throw Error(`uber_authority_draft_exposed:${target.sourceKey}`);
    }
    for(const mapping of target.mappings)if(!rows.some(row=>row.externalId===mapping.externalId))throw Error(`uber_authority_occurrence_unverified:${target.sourceKey}`);
    observations.push(...rows);
  }
  return {outcome:'applied',observations,imagePolicy:'read_only'};
}
