const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const exported = {};
runInNewContext(ts.transpileModule(readFileSync('lib/pickup-call-tracker.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: exported, Map, Number, Math });
const { updatePickupCalls } = exported;
const codes = calls => Array.from(calls.calls);

test('initial ready orders stay silent, new ready bowls and recalls announce once', () => {
  let current = updatePickupCalls(null, [{ pickupCode: '037' }]);
  assert.deepEqual(codes(current), []);
  current = updatePickupCalls(current.versions, [{ pickupCode: '037' }, { pickupCode: '038', callVersion: 1 }]);
  assert.deepEqual(codes(current), ['038']);
  current = updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: 1 }, { pickupCode: '038', callVersion: 1 }]);
  assert.deepEqual(codes(current), ['037']);
  assert.deepEqual(codes(updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: 1 }, { pickupCode: '038', callVersion: 1 }])), []);
});

test('stale reads and duplicate rows cannot replay a consumed call', () => {
  let current = updatePickupCalls(null, [{ pickupCode: '037', callVersion: 3 }]);
  current = updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: 2 }]);
  assert.deepEqual(codes(current), []);
  current = updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: 3 }]);
  assert.deepEqual(codes(current), []);
  current = updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: 4 }, { pickupCode: '037', callVersion: 4 }]);
  assert.deepEqual(codes(current), ['037']);
});

test('a store reset is silent and removed ready bowls leave the active set', () => {
  const current = updatePickupCalls(null, [{ pickupCode: '037', callVersion: 8 }]);
  assert.equal(updatePickupCalls(current.versions, []).versions.size, 0);
  assert.deepEqual(codes(updatePickupCalls(null, [{ pickupCode: '037', callVersion: 10 }])), []);
  assert.deepEqual(codes(updatePickupCalls(current.versions, [{ pickupCode: '037', callVersion: NaN }])), []);
});
