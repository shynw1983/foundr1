import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EufyCamera, CameraError, publicCode } from '../src/eufy-camera.mjs';

function fixture({ login = 'ok', fragments = [{ init: Buffer.from('init'), data: Buffer.from('video') }], failDisconnect = false } = {}) {
  let options, stops = 0, disconnected = 0, mediaOptions;
  class Client {
    constructor(value) { options = value; } on() {}
    async login() { return { status: login }; }
    async getDevices() { return [{ sn: 'T8170TEST00001', model: 'T8170', name: 'parking' }]; }
    async getDevice() { return { camera: () => ({ recordFragments: value => { mediaOptions = value; return { stop: () => stops++, async *[Symbol.asyncIterator]() { for (const fragment of fragments) yield fragment; } }; } }) }; }
    async disconnect() { disconnected++; if (failDisconnect) throw new Error('disconnect failed'); }
  }
  const camera = new EufyCamera({ email: 'test@example.test', password: 'test-only' }, null, () => {}, Client);
  return { camera, inspect: () => ({ options, stops, disconnected, mediaOptions }) };
}
test('capture uses fresh battery stream, finite clip and always disconnects', async () => {
  const f = fixture(), result = await f.camera.capture('T8170TEST00001');
  assert.deepEqual(result.clip, Buffer.from('initvideo'));
  const state = f.inspect();
  assert.equal(state.options.autoRealtime, false); assert.equal(state.options.pollMs, 0);
  assert.equal(state.mediaOptions.preBufferSeconds, 0); assert.equal(state.mediaOptions.powered, 'battery');
  assert.ok(state.stops); assert.equal(state.disconnected, 1); assert.equal(f.camera.active, null);
});
test('2FA does not retry login, unbound camera does not stream, oversize data fails closed', async () => {
  const auth = fixture({ login: '2fa' }); await assert.rejects(auth.camera.capture('T8170TEST00001'), { message: 'login_required' });
  assert.equal(auth.inspect().mediaOptions, undefined);
  const missing = fixture(); await assert.rejects(missing.camera.capture('T8170NOTBOUND1'), { message: 'unavailable' });
  assert.equal(missing.inspect().mediaOptions, undefined);
  const big = fixture(); await assert.rejects(big.camera.capture('T8170TEST00001', { maxBytes: 2 }), { message: 'too_large' });
  assert.equal(big.inspect().disconnected, 1); assert.equal(big.camera.active, null);
});
test('codec changes or missing initialization fail, and disconnect errors release capture lock', async () => {
  const changed = fixture({ fragments: [{ init: Buffer.from('1'), data: Buffer.from('a') }, { init: Buffer.from('2'), data: Buffer.from('b') }] });
  await assert.rejects(changed.camera.capture('T8170TEST00001'), { message: 'unavailable' });
  const noInit = fixture({ fragments: [{ data: Buffer.from('a') }] }); await assert.rejects(noInit.camera.capture('T8170TEST00001'));
  const disconnect = fixture({ failDisconnect: true }); await assert.rejects(disconnect.camera.capture('T8170TEST00001')); assert.equal(disconnect.camera.active, null);
  assert.equal(publicCode(new Error('raw credential error')), 'unavailable'); assert.equal(publicCode(new CameraError('timeout')), 'timeout');
});
