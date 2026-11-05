import assert from 'node:assert/strict';
import test from 'node:test';
import {createBridgePollSchedule} from '../src/poll-schedule.mjs';
test('empty polls back off to 30 seconds while successful work resets discovery immediately',()=>{
  const schedule=createBridgePollSchedule(5000);
  assert.deepEqual(Array.from({length:6},()=>schedule.empty()),[10000,20000,30000,30000,30000,30000]);
  schedule.busy();assert.equal(schedule.empty(),10000);
});
test('network failures back off to a bounded minute without replaying commands',()=>{
  const schedule=createBridgePollSchedule(5000);
  assert.deepEqual(Array.from({length:5},()=>schedule.failed()),[10000,20000,40000,60000,60000]);
  assert.equal(schedule.empty(),10000);schedule.busy();assert.equal(schedule.failed(),10000);
});
test('explicit slow configuration is respected and invalid intervals are bounded',()=>{
  assert.equal(createBridgePollSchedule(60000).empty(),60000);
  assert.equal(createBridgePollSchedule(NaN).empty(),10000);
  assert.equal(createBridgePollSchedule(-1).empty(),4000);
});
