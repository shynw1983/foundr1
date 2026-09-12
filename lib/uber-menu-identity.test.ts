import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUberOptionMove, missingUberSourceObjects, pendingUberRemovals, type UberSourceIdentity } from './uber-menu-identity.ts';

const old: UberSourceIdentity = { sourceKey:'option:noodles:rice',kind:'option',uberId:'rice',parentUberId:'noodles',targetId:'os-rice',priceMode:'manual',archived:false };
const input = { uberId:'rice',parentUberId:'standard',currentParents:['standard'],sourceObjects:[old],legacyTargetIds:['os-rice'],claimedTargetIds:[] };

test('missing, repeated pending, restored and confirmed removal preserve exact identity',()=>{
 const missing=missingUberSourceObjects([old],[]);
 assert.deepEqual(pendingUberRemovals(missing,[]),[old]);
 assert.deepEqual(pendingUberRemovals(missing,[]),[old]);
 assert.deepEqual(pendingUberRemovals(missingUberSourceObjects([old],[old]),[]),[]);
 assert.deepEqual(pendingUberRemovals(missing,[{sourceKey:old.sourceKey}]),[]);
 assert.deepEqual(pendingUberRemovals([{...old,archived:true}],[]),[]);
 assert.equal(old.archived,false);
});

test('group move preserves the existing OS identity and manual price policy', () => {
  assert.deepEqual(resolveUberOptionMove(input), { ...old, movedFromSourceKey:old.sourceKey });
});
test('first import adopts a unique legacy entity across groups', () => {
  assert.deepEqual(resolveUberOptionMove({...input,sourceObjects:[]}), {targetId:'os-rice'});
});
test('ambiguous old duplicates and multi-group splits are not guessed', () => {
  assert.throws(()=>resolveUberOptionMove({...input,legacyTargetIds:['os-rice','duplicate']}),/move_ambiguous/);
  assert.throws(()=>resolveUberOptionMove({...input,currentParents:['standard','basic']}),/move_ambiguous/);
});
test('a currently used or differently owned identity cannot be stolen', () => {
  assert.throws(()=>resolveUberOptionMove({...input,sourceObjects:[{...old,parentUberId:'standard'}]}),/owner_conflict/);
  assert.throws(()=>resolveUberOptionMove({...input,sourceObjects:[{...old,uberId:'different'}]}),/owner_conflict/);
  assert.equal(resolveUberOptionMove({...input,claimedTargetIds:['os-rice']}),null);
});
test('an entirely new entity has no move identity', () => {
  assert.equal(resolveUberOptionMove({...input,sourceObjects:[],legacyTargetIds:[]}),null);
});
test('a moved option is not queued for removal, while genuine missing options are', () => {
  const moved = {...old,sourceKey:'option:standard:rice',parentUberId:'standard'};
  assert.deepEqual(missingUberSourceObjects([old],[moved]),[]);
  assert.deepEqual(missingUberSourceObjects([old],[]),[old]);
});
