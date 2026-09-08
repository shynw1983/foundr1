import assert from 'node:assert/strict';
import test from 'node:test';
import {groupInventoryPreview,inventoryPreviewExpired} from './inventory-preview.ts';

test('only changed rows appear in the two action lists; unknown is not unchanged',()=>{
  const result=groupInventoryPreview([
    {label:'restore',wasAvailable:false,isAvailable:true},
    {label:'stop',wasAvailable:true,isAvailable:false},
    {label:'same',wasAvailable:true,isAvailable:true},
    {label:'unknown',wasAvailable:null,isAvailable:true}
  ]);
  assert.deepEqual(result.restoring.map(r=>r.label),['restore']);
  assert.deepEqual(result.stopping.map(r=>r.label),['stop']);
  assert.deepEqual(result.unchanged.map(r=>r.label),['same']);
  assert.deepEqual(result.unknown.map(r=>r.label),['unknown']);
});
test('preview expires exactly at ten minutes and fails closed on missing timestamp',()=>{
  const start='2026-09-09T00:00:00Z';const now=Date.parse(start);
  assert.equal(inventoryPreviewExpired(start,now+599999),false);
  assert.equal(inventoryPreviewExpired(start,now+600000),true);
  assert.equal(inventoryPreviewExpired(undefined,now),true);
  assert.equal(inventoryPreviewExpired('invalid',now),true);
});
