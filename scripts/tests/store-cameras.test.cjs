const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundr1-camera-test-'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
for (const name of ['store-camera-state', 'store-camera-ticket', 'store-camera-handlers']) {
  const source = fs.readFileSync(path.join(__dirname, '../../lib', name + '.ts'), 'utf8');
  fs.writeFileSync(path.join(dir, name + '.js'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createCameraSigner, cameraBlobPath, cameraBridgeChannel, cameraViewerChannel } = require(path.join(dir, 'store-camera-ticket.js'));
const { createCameraHandlers, CameraRequestError } = require(path.join(dir, 'store-camera-handlers.js'));
const { cameraMaxBytes, cameraRoles } = require(path.join(dir, 'store-camera-state.js'));
const ids = Array.from({ length: 6 }, (_, i) => `10000000-0000-4000-8000-00000000000${i}`);
function fixture() {
  let clock = Date.now();
  const events = [], clips = new Map(), deleted = [], cleaned = [];
  let actor = { id: ids[0], sessionId: ids[1] }, bridgeId = ids[3], denied = 0;
  const cameras = [{ storeId: ids[2], id: 'parking', name: '駐車場', model: 'SoloCam S340', bridgeDeviceId: ids[3], bridgePlatform: 'desktop' }];
  const signer = createCameraSigner('a'.repeat(40), () => clock);
  const handlers = createCameraHandlers({
    cameras: () => cameras, signer: () => signer,
    authorizeStore: async storeId => { if (denied) throw new CameraRequestError(denied, 'denied'); if (storeId !== ids[2]) throw new CameraRequestError(403, 'denied'); return actor; },
    authorizeBridge: async () => bridgeId,
    realtime: () => ({ key: 'test', cluster: 'ap3' }), channelAuth: (socket, channel) => ({ auth: `${socket}:${channel}` }),
    publish: async (channel, event, data) => { events.push({ channel, event, data }); },
    putClip: async (key, bytes) => { if (clips.has(key)) throw new Error('exists'); clips.set(key, bytes); },
    getClip: async key => clips.get(key) || null,
    deleteClip: async key => { deleted.push(key); clips.delete(key); }, cleanExpired: async prefix => cleaned.push(prefix),
  });
  const request = body => new Request('https://store.example/api/store/cameras', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://store.example' }, body: JSON.stringify(body) });
  const issue = () => signer.issue({ storeId: ids[2], cameraId: 'parking', bridgeDeviceId: ids[3], actorId: ids[0], sessionId: ids[1] });
  return { handlers, request, issue, signer, events, clips, deleted, cleaned, cameras, advance: n => clock += n, setActor: value => actor = value, setBridge: value => bridgeId = value, deny: value => denied = value };
}
test('signed tickets reject tampering, wrong key, expiry and capture after deadline', () => {
  const f = fixture(), { token, ticket } = f.issue();
  assert.equal(f.signer.read(token).requestId, ticket.requestId);
  assert.equal(f.signer.read(token + 'x'), null);
  assert.equal(f.signer.read(token + '.x'), null);
  assert.equal(createCameraSigner('b'.repeat(40)).read(token), null);
  f.advance(91_000); assert.equal(f.signer.read(token, true), null); assert.ok(f.signer.read(token));
  f.advance(210_000); assert.equal(f.signer.read(token), null);
  assert.throws(() => createCameraSigner('short'));
});
test('camera listing and prepare obey store access, session binding and roles', async () => {
  const f = fixture();
  assert.deepEqual([...cameraRoles].sort(), ['manager', 'owner', 'store_terminal']);
  assert.equal((await f.handlers.storeGet(new Request(`https://store.example/api/store/cameras?storeId=${ids[4]}`))).status, 403);
  const list = await (await f.handlers.storeGet(new Request(`https://store.example/api/store/cameras?storeId=${ids[2]}`))).json();
  assert.deepEqual(Object.keys(list.cameras[0]).sort(), ['id', 'model', 'name']);
  f.deny(401); assert.equal((await f.handlers.storePost(f.request({ action: 'prepare', storeId: ids[2], cameraId: 'parking' }))).status, 401);
  f.deny(0);
  assert.equal((await f.handlers.storePost(f.request({ action: 'prepare', storeId: ids[2], cameraId: 'unknown' }))).status, 404);
  const prepared = await (await f.handlers.storePost(f.request({ action: 'prepare', storeId: ids[2], cameraId: 'parking' }))).json();
  f.setActor({ id: ids[0], sessionId: ids[5] });
  assert.equal((await f.handlers.storePost(f.request({ action: 'capture', ticket: prepared.ticket }))).status, 403);
  assert.equal(f.events.length, 0);
});
test('CSRF, malformed JSON and viewer channel escalation fail before publishing', async () => {
  const f = fixture(), { token, ticket } = f.issue();
  const cross = new Request('https://store.example/api/store/cameras', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ action: 'capture', ticket: token }) });
  assert.equal((await f.handlers.storePost(cross)).status, 403);
  assert.equal((await f.handlers.storePost(f.request(null))).status, 400);
  assert.equal((await f.handlers.storePost(f.request({ action: 'realtime', ticket: token, socket_id: '1.2', channel_name: cameraBridgeChannel(ids[3]) }))).status, 403);
  assert.equal((await f.handlers.storePost(f.request({ action: 'realtime', ticket: token, socket_id: '1.2', channel_name: cameraViewerChannel(ticket.requestId) }))).status, 200);
  assert.equal(f.events.length, 0);
});
test('capture and cancellation target only the bound bridge and exact clip', async () => {
  const f = fixture(), { token, ticket } = f.issue();
  assert.equal((await f.handlers.storePost(f.request({ action: 'capture', ticket: token }))).status, 200);
  assert.equal(f.events[0].channel, cameraBridgeChannel(ids[3]));
  assert.equal(f.events[0].data.cameraId, 'parking');
  await f.handlers.storePost(f.request({ action: 'cancel', ticket: token }));
  assert.equal(f.events[1].event, 'camera.cancel'); assert.deepEqual(f.deleted, [cameraBlobPath(ticket)]);
  f.cameras.length = 0;
  assert.equal((await f.handlers.storePost(f.request({ action: 'capture', ticket: token }))).status, 410);
});
test('actual upload path validates bridge, media limit and MP4 then privately delivers and deletes', async () => {
  const f = fixture(), { token, ticket } = f.issue();
  const clip = Buffer.alloc(48); clip.write('ftyp', 4);
  const upload = (value = clip, extra = {}) => new Request('https://store.example/api/local-bridge/cameras', { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-Camera-Action': 'upload', 'X-Camera-Ticket': token, 'X-Camera-Captured-At': new Date().toISOString(), ...extra }, body: value });
  f.setBridge(ids[4]); assert.equal((await f.handlers.bridgePost(upload())).status, 403); assert.equal(f.clips.size, 0);
  f.setBridge(ids[3]);
  assert.equal((await f.handlers.bridgePost(upload(clip, { 'Content-Length': String(cameraMaxBytes + 1) }))).status, 413);
  assert.equal((await f.handlers.bridgePost(upload(Buffer.alloc(48)))).status, 400);
  assert.equal((await f.handlers.bridgePost(upload())).status, 200);
  assert.equal(f.events[0].channel, cameraViewerChannel(ticket.requestId)); assert.equal(f.events[0].event, 'camera.ready');
  assert.equal('url' in f.events[0].data, false);
  const response = await f.handlers.storePost(f.request({ action: 'media', ticket: token }));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), clip);
  assert.equal(f.clips.size, 0); assert.deepEqual(f.deleted, [cameraBlobPath(ticket)]);
  assert.equal((await f.handlers.storePost(f.request({ action: 'media', ticket: token }))).status, 410);
});
test('bridge auth only permits configured channel; failure codes and cleanup stay scoped', async () => {
  const f = fixture(), { token } = f.issue();
  assert.equal((await f.handlers.bridgePost(f.request({ action: 'realtime', storeId: ids[2], socket_id: '1.2', channel_name: cameraBridgeChannel(ids[4]) }))).status, 403);
  await f.handlers.bridgePost(f.request({ action: 'failure', ticket: token, code: 'secret password raw error' }));
  assert.equal(f.events[0].data.code, 'unavailable');
  await f.handlers.bridgePost(f.request({ action: 'cleanup', storeId: ids[2] }));
  assert.deepEqual(f.cleaned, [`store-cameras/${ids[3]}/${ids[2]}/`]);
  f.setBridge(''); assert.equal((await f.handlers.bridgeGet(new Request(`https://store.example/api/local-bridge/cameras?storeId=${ids[2]}`))).status, 403);
});
