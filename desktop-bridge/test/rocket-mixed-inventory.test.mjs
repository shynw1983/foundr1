import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketNowAdapter,rocketNeedsInventoryChange} from '../src/adapters/rocket-now.mjs';

test('today sold out must be restored and is not a permanent hide',()=>{
 assert.equal(rocketNeedsInventoryChange({hidden:false,unavailable:true},true),true);
 assert.equal(rocketNeedsInventoryChange({hidden:false,unavailable:true},false),true);
 assert.equal(rocketNeedsInventoryChange({hidden:true,unavailable:true},false),false);
 assert.equal(rocketNeedsInventoryChange({hidden:true,unavailable:true},true),true);
 assert.equal(rocketNeedsInventoryChange({hidden:false,unavailable:false},true),false);
});

test('mixed inventory lookup visits both kinds, retaining stable IDs', async () => {
  const targets = [{kind:'item', knownExternalIds:['dish']}, {kind:'option', knownExternalIds:['option']}];
  const calls = [];
  const receiver = {async locateTargets(rows) { calls.push(rows); return rows.map(t=>({...t,matches:[{}]})); }};
  const result = await RocketNowAdapter.prototype.locateTargets.call(receiver, targets);
  assert.deepEqual(calls, [[targets[0]], [targets[1]]]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1].knownExternalIds, ['option']);
});

test('mixed inventory writes are sequential and split by kind', async () => {
  const located = [{kind:'item'}, {kind:'option'}];
  const calls = [];
  const receiver = {async setInventory(payload, rows) { calls.push({payload, rows}); return {changed:1}; }};
  const result = await RocketNowAdapter.prototype.setInventory.call(receiver, {isAvailable:false,soldOutMode:'indefinite'}, located);
  assert.equal(result.changed, 2);
  assert.equal(result.desiredHidden, true);
  assert.deepEqual(calls.map(c=>c.rows), [[located[0]], [located[1]]]);
  assert.ok(calls.every(c=>c.payload.soldOutMode==='indefinite'));
});
