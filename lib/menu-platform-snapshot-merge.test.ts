import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePlatformSnapshotEntries as merge} from './menu-platform-snapshot-merge.ts';

test('physical occurrences sharing an OS target remain independently visible',()=>{
  const a={targetId:'beef',externalId:'standard',isActive:true};
  const b={targetId:'beef',externalId:'premium',isActive:true};
  assert.deepEqual(merge([a,b],[{...b,isActive:false}]),[a,{...b,isActive:false}]);
});
test('unidentified placeholders are replaced but unrelated records are retained',()=>{
  const actual={targetId:'duck',externalId:'native'};
  assert.deepEqual(merge([{targetId:'duck'},{targetId:'other'},null,{}],[actual]),[{targetId:'other'},actual]);
});
test('native and OS identifiers cannot collide in the merge key space',()=>{
  assert.equal(merge([{targetId:'123'}],[{externalId:'123'}]).length,2);
});
