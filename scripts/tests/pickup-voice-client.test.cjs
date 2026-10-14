const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function setup({ offline = false, missing = false, suspended = false, corrupt = false, delayedResume = false, chime = false } = {}) {
  const requests = [], starts = [], sources = [], spoken = [], statuses = [], cache = new Map();
  const context = { currentTime: 0, state: suspended ? 'suspended' : 'running', destination: {},
    resume() {
      if (delayedResume) return new Promise((resolve) => setTimeout(() => { this.state = 'running'; resolve(); }, 15));
      this.state = 'running'; return Promise.resolve();
    }, close() { return Promise.resolve(); },
    decodeAudioData() { return Promise.resolve({ duration: corrupt ? 0.1 : 100 }); },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(...args) { starts.push(args); }, stop() { this.onended?.(); } };
      sources.push(source); return source;
    }
  };
  const speech = { cancel() {}, speak(utterance) { spoken.push(utterance); } };
  const sandbox = { console, setTimeout, clearTimeout, AbortSignal, Response, URL,
    AudioContext: function () { return context; },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    window: { AudioContext: true, speechSynthesis: speech, caches: true },
    caches: { async open() { return {
      async match(key) { return cache.get(key)?.clone(); }, async put(key, value) { cache.set(key, value.clone()); }
    }; } },
    async fetch(url) {
      requests.push(url);
      if (offline) throw Error('offline');
      if (missing) return new Response('', { status: 404 });
      return url.endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : new Response(new Uint8Array(4));
    }
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '../../lib', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const env = vm.createContext({ ...sandbox, exports: module.exports, module,
      require(specifier) { return load(specifier.replace('./', '') + '.ts'); }
    });
    vm.runInContext(code, env); modules.set(file, module.exports); return module.exports;
  }
  const phrases = load('pickup-voice.ts').pickupVoicePhrases;
  const manifest = { version: '0123456789abcdef', audio: '/audio/pickup/voice-0123456789abcdef.wav', language: 'ja-JP', voice: 'test',
    clips: Object.fromEntries(Object.keys(phrases).map((token, i) => [token, { offset: i, duration: 0.1 }])) };
  if (chime) manifest.clips.chime = { offset: 50, duration: 1.3 };
  const Player = load('pickup-voice-client.ts').PickupVoicePlayer;
  const player = new Player((status) => statuses.push(status));
  return { player, context, requests, starts, sources, spoken, statuses, cache, manifest };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('first click waits for asynchronous browser activation before its opening prompt', async () => {
  const s = setup({ suspended: true, delayedResume: true });
  await s.player.prepare();
  s.player.activate(); s.player.enabled(); await settle();
  assert.equal(s.starts.length, 1);
  assert.ok(!s.statuses.includes('blocked'));
  s.player.dispose();
});

test('recorded calls queue without overlap; disabling clears pending calls', async () => {
  const s = setup(); await s.player.prepare();
  s.player.activate(); s.player.announce('P-0011'); s.player.announce('M-99');
  await settle();
  assert.equal(s.starts.length, 7); // only first complete identifier scheduled
  assert.equal(s.starts[2][1], s.starts[3][1]); // repeated zero uses same source slice
  assert.equal(s.spoken.length, 0);
  assert.ok(s.requests.every((url) => url.startsWith('/audio/pickup/')));
  s.player.stop(); await settle();
  assert.equal(s.starts.length, 7);
  s.player.dispose();
});

test('second recorded call starts after the first finishes and its pause', async () => {
  const s = setup(); await s.player.prepare();
  s.player.announce('P-1'); s.player.announce('M-2'); await settle();
  assert.equal(s.starts.length, 4);
  s.sources.slice(0, 4).forEach((source) => source.onended());
  s.context.currentTime = 3;
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(s.starts.length, 8);
  assert.ok(s.starts[4][0] > s.starts[3][0]);
  s.player.dispose();
});

test('missing or corrupt pack falls back to explicit per-digit speech', async () => {
  for (const options of [{ missing: true }, { corrupt: true }]) {
    const s = setup(options); s.player.announce('P-0047'); await settle();
    assert.equal(s.starts.length, 0);
    assert.equal(s.spoken.length, 1);
    assert.match(s.spoken[0].text, /ピー、ゼロ、ゼロ、よん、なな/);
    assert.ok(s.statuses.includes('fallback'));
    s.player.dispose();
  }
});

test('complete cached pack can load offline and suspended playback requires activation', async () => {
  const s = setup({ offline: true, suspended: true });
  s.cache.set('/audio/pickup/manifest.json', new Response(JSON.stringify(s.manifest)));
  s.cache.set(s.manifest.audio, new Response(new Uint8Array(4)));
  await s.player.prepare();
  s.player.announce('P-1'); await settle();
  assert.ok(s.statuses.includes('blocked'));
  assert.equal(s.starts.length, 0);
  s.player.activate(); s.player.preview(); await settle();
  assert.equal(s.starts.length, 7);
  assert.equal(s.spoken.length, 0);
  s.player.dispose();
});

test('cancelled fallback does not retain a queued old-store call', async () => {
  const s = setup({ missing: true });
  s.player.announce('P-1'); s.player.announce('P-2'); await settle();
  assert.equal(s.spoken.length, 1);
  s.player.stop(); s.player.announce('M-3'); await settle();
  assert.equal(s.spoken.length, 2);
  assert.match(s.spoken[1].text, /エム、さん/);
  s.player.dispose();
});


test('approved chime precedes speech by 0.3 seconds, once per queued batch; new batch chimes again', async () => {
  const s = setup({ chime: true }); await s.player.prepare();
  s.player.announce('P-1'); s.player.announce('M-2'); await settle();
  assert.equal(s.starts.length, 5);
  assert.equal(s.starts[0][1], 50);
  assert.ok(Math.abs(s.starts[1][0] - s.starts[0][0] - 1.6) < 1e-9);
  s.sources.slice(0, 5).forEach((source) => source.onended());
  s.context.currentTime = 4;
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(s.starts.length, 9);
  assert.notEqual(s.starts[5][1], 50);
  s.sources.slice(5, 9).forEach((source) => source.onended());
  await new Promise((resolve) => setTimeout(resolve, 700));
  s.player.preview(); await settle();
  assert.equal(s.starts[9][1], 50);
  s.player.dispose();
});
