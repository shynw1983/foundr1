import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPosScaleFilterSettings, evaluatePosScaleFilter, normalizePosScaleFilterSettings, validatePosScaleFilterSettings } from './pos-scale-filter.ts';
import type { PosScaleFilterState, PosScaleFilterSettings } from './pos-scale-filter.ts';

const settings: PosScaleFilterSettings = { ...defaultPosScaleFilterSettings(), enabled: true, revision: 'fixture-revision' };
const windowUuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function windowFor(grams: number[], options: { times?: number[]; tare?: number; stable?: boolean; config?: PosScaleFilterSettings; windowIds?: string[] } = {}) {
  let state: PosScaleFilterState = {};
  return grams.map((value, index) => {
    const result = evaluatePosScaleFilter({ settings: options.config ?? settings, state, contextKey: 'station:epoch:session:tare-token',
      reading: { grams: value, stable: options.stable ?? false, overload: false }, measuredAt: options.times?.[index] ?? 10000 + index * 1250, tareGrams: options.tare,
      newWindowId: options.windowIds?.[index] });
    state = result.state; return result;
  });
}
test('default is disabled; off preserves ST/US exactly and discards old window', () => {
  assert.equal(defaultPosScaleFilterSettings().enabled, false);
  for (const stable of [false, true]) {
    const reading = { grams: 500.1, stable, overload: false };
    assert.deepEqual(evaluatePosScaleFilter({ settings: defaultPosScaleFilterSettings(), state: { acceptedGrams: 1 }, contextKey: 's', reading, measuredAt: 1 }), { state: {}, reading });
  }
});
test('requires 3 distinct native samples spanning requested time; US remains marked hardware unstable', () => {
  const results = windowFor([500.2, 499.8, 500.1]);
  assert.equal(results[0].reading?.stable, false); assert.equal(results[1].reading?.stable, false);
  assert.equal(results[2].reading?.stable, true); assert.equal(results[2].reading?.grams, 500);
  assert.equal(results[2].reading?.hardwareStable, false); assert.equal(results[2].reading?.filter?.sampleCount, 3);
  assert.equal(results[2].reading?.rawGrams, 500.1);
  assert.equal(windowFor([500, 500, 500], { times: [1, 500, 1000] }).at(-1)?.reading?.stable, false);
});
test('jitter stays latched; changed load blocks immediately then settles to new load', () => {
  const results = windowFor([500.1, 499.9, 500.2, 501, 500.4, 530, 530.2, 529.8]);
  assert.deepEqual(results.slice(2, 5).map(r => r.reading?.grams), [500, 500, 500]);
  assert.equal(results[5].reading?.stable, false);
  assert.equal(results[7].reading?.grams, 530); assert.equal(results[7].reading?.stable, true);
});
test('even hardware ST must pass the software window when enabled', () => {
  assert.deepEqual(windowFor([500, 500, 500], { stable: true }).map(r => r.reading?.stable), [false, false, true]);
});
test('outlier cannot be diluted by a median; recovery starts again after it', () => {
  const results = windowFor([500, 500, 500, 1000, 500, 500, 500]);
  assert.deepEqual(results.slice(3).map(r => r.reading?.stable), [false, false, false, true]);
});
test('latch participates in total range, so gradual drift cannot hold an obsolete weight', () => {
  const results = windowFor([500, 500, 500, 500.8, 501.4, 502.1]);
  assert.equal(results.at(-1)?.reading?.stable, false);
});
test('zeros, overloads, invalid values, capacity and nonpositive net clear evidence', () => {
  const state = windowFor([500, 500, 500]).at(-1)!.state;
  for (const reading of [null, { grams: 0, stable: true, overload: false }, { grams: -1, stable: true, overload: false },
    { grams: 3001, stable: true, overload: false }, { grams: 500, stable: true, overload: true }, { grams: NaN, stable: true, overload: false }]) {
    const result = evaluatePosScaleFilter({ settings, state, contextKey: 'station:epoch:session:tare-token', reading, measuredAt: 14000 });
    assert.deepEqual(result.state, {}); assert.ok(!result.reading?.stable);
  }
  assert.equal(windowFor([100, 100, 100], { tare: 100 }).at(-1)?.reading?.stable, false);
  assert.equal(windowFor([100.2, 100.3, 100.4], { tare: 100 }).at(-1)?.reading?.stable, false);
});
test('gap and clock regression/duplicate cannot accumulate stability', () => {
  assert.equal(windowFor([500, 500, 500], { times: [10000, 11250, 15000] }).at(-1)?.reading?.stable, false);
  assert.deepEqual(windowFor([500, 500, 500], { times: [10000, 11250, 11250] }).at(-1)?.state, {});
  assert.deepEqual(windowFor([500, 500, 500], { times: [10000, 11250, 10001] }).at(-1)?.state, {});
});
test('session, revision, parameters and tare invalidate prior evidence', () => {
  const state = windowFor([500, 500, 500]).at(-1)!.state;
  for (const change of [{ contextKey: 'other-session' }, { settings: { ...settings, revision: 'new' } },
    { settings: { ...settings, toleranceGrams: 3 } }, { settings: { ...settings, settleMs: 3000 } }, { tareGrams: 100 }]) {
    const result = evaluatePosScaleFilter({ settings, state, contextKey: 'station:epoch:session:tare-token',
      reading: { grams: 500, stable: false, overload: false }, measuredAt: 14000, ...change });
    assert.equal(result.reading?.stable, false); assert.equal(result.state.samples?.length, 1);
  }
});
test('rounds net to 1g before the backend subtracts plate tare exactly once', () => {
  const result = windowFor([600.1, 600.2, 600.3], { tare: 100.4 }).at(-1)!;
  assert.equal(result.reading?.grams, 600.4);
  assert.equal(Math.round((result.reading!.grams - 100.4) * 1000) / 1000, 500);
  assert.equal(result.reading?.rawGrams, 600.3);
});
test('maximum settle time works with irregular 1Hz uploads and retains the last boundary sample', () => {
  const results = windowFor([500, 500.1, 499.9, 500, 500.2, 500], {
    config: { ...settings, toleranceGrams: 1, settleMs: 5000 }, times: [10000, 11020, 12200, 13400, 14600, 15800]
  });
  assert.deepEqual(results.map(result => result.reading?.stable), [false, false, false, false, false, true]);
});
test('slow independent uploads retain three samples rather than waiting forever at two', () => {
  const results = windowFor([204, 204, 204, 204, 204], { times: [10000, 12010, 14020, 16030, 18040] });
  assert.deepEqual(results.map(result => result.reading?.stable), [false, false, true, true, true]);
  assert.equal(results[2].reading?.filter?.sampleCount, 3);
  assert.equal(results[2].reading?.filter?.spanMs, 4020);
  // Sample preservation never bypasses the real elapsed-time or sample-gap checks.
  assert.equal(windowFor([204, 204, 204], { times: [10000, 13001, 16002] }).at(-1)?.reading?.stable, false);
  assert.equal(windowFor([204, 204, 204], { times: [10000, 10900, 11800] }).at(-1)?.reading?.stable, false);
});
test('decimal half-gram net values round up despite binary floating-point subtraction', () => {
  for (const [gross, tare, expectedNet] of [[100.6, 50.1, 51], [512.8, 50.3, 463]]) {
    const result = windowFor([gross, gross, gross], { tare }).at(-1)!.reading!;
    assert.equal(Math.round((result.grams - tare) * 1000) / 1000, expectedNet);
  }
});
test('accepted net remains an integer within tolerance and capacity for fractional plate weights', () => {
  for (const tare of [0, 100.1, 100.4, 200.9]) {
    for (const toleranceGrams of [1, 2, 5]) {
      for (const net of [1.6, 49.3, 499.7, 1000.4, 2798.5]) {
        const raw = [net + tare - 0.1, net + tare, net + tare + 0.1];
        if (Math.max(...raw) > 3000) continue;
        const result = windowFor(raw, { tare, config: { ...settings, toleranceGrams } }).at(-1)!.reading!;
        assert.equal(result.stable, true);
        const acceptedNet = Math.round((result.grams - tare) * 1000) / 1000;
        assert.ok(Number.isInteger(acceptedNet) && acceptedNet > 0);
        assert.ok(result.grams <= 3000);
        assert.ok(Math.max(...raw, result.grams) - Math.min(...raw, result.grams) <= toleranceGrams + 0.000001);
      }
    }
  }
});
test('sample state is bounded during sustained stable traffic; no input is mutated', () => {
  const grams = Array.from({ length: 150 }, () => 500);
  const final = windowFor(grams).at(-1)!;
  assert.equal(final.reading?.stable, true); assert.ok(final.state.samples!.length <= 32);
  const before = structuredClone(final.state);
  evaluatePosScaleFilter({ settings, state: final.state, contextKey: 'station:epoch:session:tare-token', reading: { grams: 500, stable: false, overload: false }, measuredAt: 200000 });
  assert.deepEqual(final.state, before);
});
test('settings validate bounds and ignore client revision; corrupted enabled config fails closed', () => {
  assert.equal(validatePosScaleFilterSettings({ ...settings, revision: 'client' }).settings?.revision, '');
  for (const value of [{ ...settings, toleranceGrams: 0 }, { ...settings, toleranceGrams: 1.5 }, { ...settings, toleranceGrams: 6 },
    { ...settings, settleMs: 1000 }, { ...settings, settleMs: 2500 }, { ...settings, settleMs: 6000 }, { ...settings, enabled: 'true' }]) {
    assert.ok(validatePosScaleFilterSettings(value).error);
  }
  const corrupt = normalizePosScaleFilterSettings({ enabled: true, revision: 'saved' });
  assert.equal(corrupt.enabled, true);
  assert.equal(windowFor([500, 500, 500], { config: corrupt }).at(-1)?.reading?.stable, false);
});
test('server window identity starts at acceptance and stays latched across fresh ST/US jitter', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => windowUuid(index + 1));
  const results = windowFor([500.2, 499.8, 500.1, 501, 500.4, 500.3, 499.9, 500.2], { windowIds: candidates });
  assert.deepEqual(results.slice(0, 2).map(result => result.state.acceptedWindowId), [undefined, undefined]);
  for (const result of results.slice(2)) {
    assert.equal(result.state.acceptedWindowId, candidates[2]);
    assert.equal(result.reading?.filter?.windowId, candidates[2]);
    assert.equal(result.reading?.grams, 500);
  }
});
test('a load excursion retires its window identity even when the final stable weight is unchanged', () => {
  const results = windowFor([500, 500, 500, 530, 500, 500, 500], {
    windowIds: Array.from({ length: 7 }, (_, index) => windowUuid(index + 1))
  });
  assert.equal(results[2].state.acceptedWindowId, windowUuid(3));
  for (const result of results.slice(3, 6)) {
    assert.equal(result.state.acceptedWindowId, undefined); assert.equal(result.reading?.filter?.windowId, undefined);
  }
  assert.equal(results[6].state.acceptedWindowId, windowUuid(7)); assert.equal(results[6].reading?.grams, 500);
});
test('window identity cannot survive invalid frames, time gaps, clock regression or context changes', () => {
  const state = windowFor([500, 500, 500], { windowIds: [windowUuid(1), windowUuid(2), windowUuid(3)] }).at(-1)!.state;
  for (const change of [{ reading: null }, { reading: { grams: 0, stable: true, overload: false } },
    { reading: { grams: 500, stable: true, overload: true } }, { measuredAt: 20000 }, { measuredAt: 12500 },
    { contextKey: 'new-session' }, { settings: { ...settings, revision: 'new-revision' } }, { tareGrams: 100 }]) {
    const result = evaluatePosScaleFilter({ settings, state, contextKey: 'station:epoch:session:tare-token',
      reading: { grams: 500, stable: false, overload: false }, measuredAt: 14000, newWindowId: windowUuid(4), ...change });
    assert.equal(result.state.acceptedWindowId, undefined); assert.equal(result.reading?.filter?.windowId, undefined);
    assert.ok(!result.reading?.stable);
  }
});
test('pre-upgrade accepted state gets a server identity only after a fresh native frame', () => {
  const legacy = windowFor([500, 500, 500]).at(-1)!.state;
  const next = evaluatePosScaleFilter({ settings, state: legacy, contextKey: 'station:epoch:session:tare-token',
    reading: { grams: 500.1, stable: true, overload: false }, measuredAt: 14000, newWindowId: windowUuid(1) });
  assert.equal(next.reading?.stable, true); assert.equal(next.state.acceptedWindowId, windowUuid(1));
  const replay = evaluatePosScaleFilter({ settings, state: legacy, contextKey: 'station:epoch:session:tare-token',
    reading: { grams: 500.1, stable: true, overload: false }, measuredAt: 12500, newWindowId: windowUuid(1) });
  assert.deepEqual(replay.state, {}); assert.equal(replay.reading?.filter?.windowId, undefined);
});
test('malformed window identities cannot become continuity evidence or preserve corrupt accepted state', () => {
  assert.equal(windowFor([500, 500, 500], { windowIds: ['bad', 'bad', 'bad'] }).at(-1)?.reading?.filter?.windowId, undefined);
  const state = windowFor([500, 500, 500]).at(-1)!.state;
  const result = evaluatePosScaleFilter({ settings, state: { ...state, acceptedWindowId: 'forged' },
    contextKey: 'station:epoch:session:tare-token', reading: { grams: 500, stable: false, overload: false },
    measuredAt: 14000, newWindowId: windowUuid(1) });
  assert.equal(result.reading?.stable, false); assert.equal(result.state.samples?.length, 1); assert.equal(result.state.acceptedWindowId, undefined);
});
