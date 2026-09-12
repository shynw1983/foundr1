import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpPage } from '../src/cdp-page.mjs';
import { competitorPageState, waitForCompetitorMenu } from '../src/competitor-page.mjs';
import { UberEatsAdapter } from '../src/adapters/uber-eats.mjs';

test('security checks are not mistaken for loaded menus', async () => {
  assert.equal(competitorPageState({ text: 'Cloudflare セキュリティ検証', menuLoaded: true }), 'verification');
  assert.equal(competitorPageState({ menuLoaded: true }), 'ready');
  assert.equal(competitorPageState({ text: 'Cloudflare', menuLoaded: true }), 'ready');
  assert.equal(competitorPageState({ title: 'Just a moment...' }), 'verification');
  assert.equal(competitorPageState({ text: 'Enter delivery address' }), 'address_required');
  assert.equal(competitorPageState({ text: 'Store not found' }), 'store_not_found');
  await assert.rejects(waitForCompetitorMenu({ evaluate: async () => ({ title: 'Verify you are human' }) }), /competitor_security_verification_required/);
});

test('loading waits for menu, but a dead renderer fails without swallowing its error', async () => {
  const states = [{}, { menuLoaded: true }];
  await waitForCompetitorMenu({ evaluate: async () => states.shift() }, { wait: async () => {} });
  await assert.rejects(waitForCompetitorMenu({ evaluate: async () => { throw new Error('CDP Runtime.evaluate timeout'); } }), /Runtime.evaluate timeout/);
  await assert.rejects(waitForCompetitorMenu({}, { timeoutMs: 0 }), /competitor_menu_load_timeout/);
});

test('owned tab is pinned on reattach and cleanup never selects merchant tabs', async () => {
  const page = new CdpPage(1, '', '');
  page.ownedTargetId = 'temporary';
  page.targetId = async () => { throw new Error('must never select another tab'); };
  const calls = [];
  page.send = async (method, params) => { calls.push([method, params]); return { sessionId: 'session' }; };
  await page.attach('https://merchants.ubereats.com/');
  await page.dispose();
  assert.equal(calls[0][1].targetId, 'temporary');
  assert.deepEqual(calls[1], ['Target.closeTarget', { targetId: 'temporary' }]);
  calls.length = 0;
  await page.dispose({ keepOpen: true });
  assert.equal(calls.length, 0);
});

test('competitor capture isolates tabs, preserves verification, closes timed out tabs', async () => {
  const original = CdpPage.connect;
  let disposal;
  let timeout = false;
  CdpPage.connect = async (_port, _prefix, options) => {
    assert.equal(_port, 9334);
    assert.equal(options.isolated, true);
    assert.equal(options.reuse, true);
    return {
      send: async () => { if (timeout) throw new Error('CDP Page.navigate timeout'); return {}; },
      evaluate: async () => ({ text: 'Cloudflare セキュリティ検証' }),
      dispose: async options => { disposal = options; }
    };
  };
  try {
    const adapter = new UberEatsAdapter({ ensureRunning: async () => 9331 });
    adapter.competitorSession = { ensureRunning: async () => 9334 };
    const payload = { sourceId: 'source', sourceUrl: 'https://www.ubereats.com/store/test/id', storeUuid: 'id' };
    await assert.rejects(adapter.captureCompetitorMenuSnapshot(payload), /competitor_security_verification_required/);
    assert.equal(disposal.keepOpen, true);
    timeout = true;
    await assert.rejects(adapter.captureCompetitorMenuSnapshot(payload), /Page.navigate timeout/);
    assert.equal(disposal.keepOpen, false);
  } finally { CdpPage.connect = original; }
});

test('retained verification is checked without navigation or another tab', async () => {
  const original = CdpPage.connect;
  let kept = false;
  CdpPage.connect = async () => ({
    reusedTarget: true,
    evaluate: async () => ({ challenge: true }),
    send: async () => { assert.fail('must not navigate away from verification'); },
    dispose: async ({ keepOpen }) => { kept = keepOpen; }
  });
  try {
    const adapter = new UberEatsAdapter({});
    adapter.competitorSession = { ensureRunning: async () => 9334 };
    for (let i = 0; i < 3; i++) {
      await assert.rejects(adapter.captureCompetitorMenuSnapshot({ sourceId: 'source', sourceUrl: 'https://www.ubereats.com/store/test/id', storeUuid: 'id' }), /competitor_security_verification_required/);
      assert.equal(kept, true);
    }
  } finally { CdpPage.connect = original; }
});
