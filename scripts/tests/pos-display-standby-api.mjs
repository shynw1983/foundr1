// Actual settings and customer-display handlers against isolated PostgreSQL.
// No production configuration, database, uploads or external services are used.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createDineInMenuFixture } from './store-dine-in-menu-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, i, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[i + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-display-standby-api');
await mkdir(output, { recursive: true });
const sourceFiles = ['lib/pos-display-standby.ts', 'app/api/os/pos/settings/route.ts', 'app/api/store/pos/customer-display/route.ts', 'app/api/store/pos/route.ts', 'scripts/tests/pos-display-standby-api.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(join(source, file))).digest('hex')])));
const hashesBefore = await sourceHashes();
const f = await createDineInMenuFixture(source), { db, ids, state, modules, sql } = f;
await f.installMigration();
const originalSession = state.session;
let canManage = true, scopeIds = [ids.store], allStores = false;
modules['api-auth'] = {
  requireOsSession: async () => state.session,
  getSessionStoreScope: async () => ({ allStores, storeIds: scopeIds })
};
modules['role-permissions'] = { roleHasPermission: async (_role, permission) => permission === 'pos.manageSettings' ? canManage : true };
delete modules['store-order-access']; // Use the real scope and active-store query.
modules['order-realtime'] = { publishPosCustomerDisplayEvent: async () => { throw new Error('Unexpected transaction display write'); } };
const settingsApi = f.reload('app/api/os/pos/settings/route.ts');
const displayApi = f.load('app/api/store/pos/customer-display/route.ts');
const posApi = f.load('app/api/store/pos/route.ts');
const model = f.load('lib/pos-display-standby.ts');
const realQuery = db.query.bind(db), realTransaction = sql.transaction.bind(sql);
const statements = [], checks = [];
db.query = async (text, values, options) => { statements.push(text); return realQuery(text, values, options); };
sql.transaction = async queries => { statements.push(...queries.map(query => query.text)); return realTransaction(queries); };
const plain = value => JSON.parse(JSON.stringify(value));
const valid = () => ({ ...plain(model.defaultPosDisplayStandbySettings()), enabled: true });
const mixedFonts = () => {
  const value = valid();
  for (const orientation of ['portrait', 'landscape']) {
    for (const block of value.layouts[orientation]) {
      block.fontFamily = (orientation === 'portrait' ? ['clock', 'storeName'] : ['text']).includes(block.type) ? 'georgia' : 'standard';
    }
  }
  return value;
};
const authoredGreetings = 'Welcome, take a breath\nいらっしゃいませ、どうぞごゆっくり\n欢迎光临，慢慢享用\n歡迎光臨，慢慢享用\n어서 오세요, 편히 쉬세요\nChào mừng, cứ thong thả\nस्वागत छ, आराम गर्नुहोस्';
const widgetLayout = () => {
  const value = mixedFonts();
  for (const orientation of ['portrait', 'landscape']) {
    const portrait = orientation === 'portrait';
    value.layouts[orientation].push(
      { ...plain(model.createPosDisplayStandbyBlock('date', `date_${orientation}`)), fontFamily: portrait ? 'georgia' : 'standard', showYear: portrait },
      { ...plain(model.createPosDisplayStandbyBlock('weather', `weather_${orientation}`)), fontFamily: portrait ? 'standard' : 'georgia' },
      { ...plain(model.createPosDisplayStandbyBlock('wordCloud', `cloud_${orientation}`)), text: authoredGreetings,
        fontFamily: portrait ? 'georgia' : 'standard', motion: portrait ? 'gentle' : 'still', animationSeconds: portrait ? 90 : 8 },
      { ...plain(model.createPosDisplayStandbyBlock('messages', `messages_${orientation}`)), text: authoredGreetings,
        fontFamily: portrait ? 'standard' : 'georgia', motion: portrait ? 'still' : 'gentle', animationSeconds: portrait ? 8 : 90 }
    );
  }
  return value;
};
const body = (value = valid(), storeId = ids.store) => ({ storeId, section: 'customerDisplayStandby', customerDisplayStandby: value });
const request = (path, data) => new Request('http://isolated.test' + path, data === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://isolated.test' }, body: JSON.stringify(data)
});
const post = data => settingsApi.POST(request('/api/os/pos/settings', data));
const getSettings = (storeId = ids.store) => settingsApi.GET(request(`/api/os/pos/settings?storeId=${storeId}`));
const getDisplay = (debug = false, storeId = ids.store) => displayApi.GET(request(`/api/store/pos/customer-display?storeId=${storeId}${debug ? '&debug=1' : ''}`));
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function stored(storeId = ids.store) { return (await realQuery('select to_jsonb(p) as row from pos_store_settings p where store_id=$1', [storeId])).rows[0]?.row; }
async function allData() {
  const tables = (await realQuery("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  return Object.fromEntries(await Promise.all(tables.map(async ({ tablename }) => [tablename, (await realQuery(`select to_jsonb(t) as row from "${tablename}" t order by to_jsonb(t)::text`)).rows])));
}
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function assertUnchanged(fn) {
  const before = await allData(); await fn(); assert.deepEqual(await allData(), before);
}
const media = { mode: 'slideshow', transition: 'slide', slideDurationSeconds: 11, videoMuted: false, videoLoop: false,
  backgroundColor: '#123456', assets: [{ id: 'ad', type: 'image', url: 'https://example.test/ad.png', pathname: 'ad.png', name: '広告', durationSeconds: 9, fit: 'contain' }],
  weighing: { enabled: true, showTare: true, futureNested: { keep: 'exactly' } },
  futureSetting: { version: 12, values: ['preserve', true, 7] }
};
try {
  await db.exec('create table pos_customer_display_states(store_id uuid primary key, display_state jsonb, updated_at timestamptz default now())');
  await realQuery('insert into pos_customer_display_states(store_id,display_state) values($1,$2::jsonb)', [ids.store, JSON.stringify({ status: 'completed', pickupCode: 'REAL-SECRET', subtotal: 815 })]);
  await realQuery('update pos_store_settings set customer_display_media_settings=$2::jsonb where store_id=$1', [ids.store, JSON.stringify(media)]);
  statements.length = 0;
  const schemaBefore = (await realQuery("select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows;

  await check('legacy defaults are disabled; reads preserve weighing and unknown fields without writes', async () => {
    await assertUnchanged(async () => {
      const os = await json(await getSettings());
      assert.equal(os.settings.customerDisplayMediaSettings.standby.enabled, false);
      assert.deepEqual(os.settings.customerDisplayMediaSettings.weighing, media.weighing);
      assert.deepEqual(os.settings.customerDisplayMediaSettings.futureSetting, media.futureSetting);
      const display = await json(await getDisplay());
      assert.deepEqual(display.customerDisplayMediaSettings.standby, plain(model.defaultPosDisplayStandbySettings()));
      assert.deepEqual(display.customerDisplayMediaSettings.weighing, media.weighing);
      assert.equal(display.state.pickupCode, 'REAL-SECRET');
    });
  });
  await check('default fonts and CSS stacks are allowlisted without changing the original Georgia stack', async () => {
    const defaults = plain(model.defaultPosDisplayStandbySettings());
    assert.ok(Object.values(defaults.layouts).flat().every(block => block.fontFamily === 'standard'));
    assert.equal(model.getPosDisplayStandbyFontFamily('georgia'), 'Georgia, "Times New Roman", serif');
    for (const value of ['standard', undefined, null, 'Georgia', 'url(https://example.test/font)', 'georgia; color:red', 1, {}]) {
      assert.equal(model.getPosDisplayStandbyFontFamily(value), 'inherit');
    }
  });
  await check('new date, weather, welcome cloud and messages are opt-in factory drafts without changing saved legacy defaults', async () => {
    const before = plain(model.defaultPosDisplayStandbySettings());
    assert.deepEqual(Object.values(before.layouts).map(blocks => blocks.map(block => block.type)), [
      ['clock', 'image', 'text', 'storeName'], ['clock', 'image', 'text', 'storeName']
    ]);
    assert.equal(before.enabled, false);
    assert.deepEqual(before.layouts.portrait.map(block => [block.id, block.x, block.y, block.width, block.height]), [
      ['clock', 6, 5, 58, 17], ['image', 72, 5, 22, 17], ['welcome', 6, 39, 88, 18], ['store', 6, 61, 88, 12]
    ]);
    assert.deepEqual(before.layouts.landscape.map(block => [block.id, block.x, block.y, block.width, block.height]), [
      ['clock', 5, 6, 43, 24], ['image', 76, 6, 19, 24], ['welcome', 10, 39, 80, 22], ['store', 10, 65, 80, 15]
    ]);
    await assertUnchanged(async () => {
      for (const type of ['date', 'weather', 'wordCloud', 'messages']) {
        const block = plain(model.createPosDisplayStandbyBlock(type, `draft_${type}`));
        assert.equal(block.type, type); assert.equal(block.id, `draft_${type}`);
        const draft = valid(); draft.layouts.landscape.push(block);
        const result = model.validatePosDisplayStandbySettings(draft);
        assert.equal(result.error, undefined); assert.deepEqual(plain(result.settings), draft);
        assert.equal((await json(await getSettings())).settings.customerDisplayMediaSettings.standby.enabled, false);
      }
    });
    assert.deepEqual(plain(model.defaultPosDisplayStandbySettings()), before);
  });
  await check('saved legacy layouts missing font choices keep enabled state and exact geometry in all readers without writes', async () => {
    const legacy = valid(); legacy.backgroundColor = '#345678';
    legacy.layouts.portrait[0].x = 8.25; legacy.layouts.portrait[0].width = 55.5;
    legacy.layouts.landscape[2].text = 'Welcome'; legacy.layouts.landscape[2].y = 31.75;
    for (const block of Object.values(legacy.layouts).flat()) delete block.fontFamily;
    await realQuery('update pos_store_settings set customer_display_media_settings=$2::jsonb where store_id=$1', [ids.store, JSON.stringify({ ...media, standby: legacy })]);
    const normalized = plain(model.normalizePosDisplayStandbySettings(legacy));
    assert.equal(normalized.enabled, true);
    const stripped = plain(normalized); for (const block of Object.values(stripped.layouts).flat()) delete block.fontFamily;
    assert.deepEqual(stripped, legacy);
    assert.ok(Object.values(normalized.layouts).flat().every(block => block.fontFamily === 'standard'));
    await assertUnchanged(async () => {
      const readers = [
        (await json(await getSettings())).settings,
        await json(await getDisplay()), await json(await getDisplay(true)),
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings
      ];
      for (const reader of readers) {
        assert.deepEqual(reader.customerDisplayMediaSettings.standby, normalized);
        assert.deepEqual(reader.customerDisplayMediaSettings.weighing, media.weighing);
        assert.deepEqual(reader.customerDisplayMediaSettings.futureSetting, media.futureSetting);
      }
    });
    assert.deepEqual((await stored()).customer_display_media_settings.standby, legacy);
    await realQuery('update pos_store_settings set customer_display_media_settings=$2::jsonb where store_id=$1', [ids.store, JSON.stringify(media)]);
  });
  await check('independent save updates only standby and metadata, preserving every other store setting', async () => {
    const before = await stored(), allBefore = await allData(), value = mixedFonts();
    value.layouts.portrait[1].imageUrl = '/uploads/store-logo.png';
    const saved = await json(await post({ ...body(value), dineInEnabled: false, printerSettings: { enabled: false }, customerDisplayMediaSettings: { mode: 'video' } }));
    assert.deepEqual(saved.settings.customerDisplayMediaSettings.standby, value);
    const after = await stored();
    assert.deepEqual(after.customer_display_media_settings, { ...media, standby: value });
    const ignored = ['customer_display_media_settings', 'updated_at', 'updated_by'];
    assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => !ignored.includes(key))), Object.fromEntries(Object.entries(before).filter(([key]) => !ignored.includes(key))));
    assert.equal(after.updated_by, ids.employee);
    const allAfter = await allData(); delete allAfter.pos_store_settings; delete allBefore.pos_store_settings;
    assert.deepEqual(allAfter, allBefore);
  });
  await check('OS, normal display, and debug projection all return the saved layout', async () => {
    const expected = (await stored()).customer_display_media_settings.standby;
    const os = await json(await getSettings()), display = await json(await getDisplay());
    const start = statements.length, debug = await json(await getDisplay(true));
    assert.deepEqual(os.settings.customerDisplayMediaSettings.standby, expected);
    assert.deepEqual(display.customerDisplayMediaSettings.standby, expected);
    assert.deepEqual(debug.customerDisplayMediaSettings.standby, expected);
    assert.equal(debug.debugMode, true); assert.equal(debug.state.pickupCode, '');
    assert.ok(!statements.slice(start).some(text => /from\s+pos_customer_display_states/i.test(text)), 'Debug config must not read transaction display state');
    assert.deepEqual(debug.customerDisplayMediaSettings.weighing, media.weighing);
    const mixedExpected = mixedFonts(); mixedExpected.layouts.portrait[1].imageUrl = '/uploads/store-logo.png';
    assert.deepEqual(expected, mixedExpected);
    assert.equal(expected.layouts.portrait.find(block => block.type === 'clock').fontFamily, 'georgia');
    assert.equal(expected.layouts.portrait.find(block => block.type === 'text').fontFamily, 'standard');
    assert.equal(expected.layouts.portrait.find(block => block.type === 'storeName').fontFamily, 'georgia');
    assert.equal(expected.layouts.landscape.find(block => block.type === 'clock').fontFamily, 'standard');
    assert.equal(expected.layouts.landscape.find(block => block.type === 'text').fontFamily, 'georgia');
    assert.equal(expected.layouts.landscape.find(block => block.type === 'storeName').fontFamily, 'standard');
  });
  await check('POS fallback and debug catalog preserve the same standby and weighing settings without writes', async () => {
    const expected = (await stored()).customer_display_media_settings;
    await assertUnchanged(async () => {
      const normal = await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)));
      const start = statements.length;
      const debug = await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)));
      for (const response of [normal, debug]) {
        assert.deepEqual(response.posSettings.customerDisplayMediaSettings.standby, expected.standby);
        assert.deepEqual(response.posSettings.customerDisplayMediaSettings.weighing, media.weighing);
        assert.deepEqual(response.posSettings.customerDisplayMediaSettings.futureSetting, media.futureSetting);
      }
      assert.ok(!statements.slice(start).some(text => /\b(store_customer_orders|store_customer_order_items|pos_cash_sessions|pos_print_documents)\b/i.test(text)));
      assert.equal(debug.debugMode, true);
    });
  });
  await check('an old full save cannot replace standby through its stale nested media field', async () => {
    const before = (await stored()).customer_display_media_settings;
    const stale = valid(); stale.enabled = false; stale.backgroundColor = '#ff0000';
    const response = await json(await post({ storeId: ids.store, customerDisplayMediaSettings: { ...media, mode: 'video', standby: stale, weighing: { enabled: false }, futureSetting: null } }));
    const after = (await stored()).customer_display_media_settings;
    assert.equal(after.mode, 'video'); assert.deepEqual(after.standby, before.standby);
    assert.deepEqual(after.weighing, media.weighing); assert.deepEqual(after.futureSetting, media.futureSetting);
    assert.deepEqual(response.settings.customerDisplayMediaSettings.standby, before.standby);
  });
  await check('a new full save explicitly updates standby while preserving unknown stored media keys', async () => {
    const value = valid(); value.backgroundColor = '#abcdef'; value.layouts.landscape[2].text = 'ご来店ありがとうございます';
    await json(await post({ storeId: ids.store, customerDisplayMediaSettings: { ...media, mode: 'default' }, customerDisplayStandby: value }));
    const after = (await stored()).customer_display_media_settings;
    assert.deepEqual(after.standby, value); assert.equal(after.mode, 'default');
    assert.deepEqual(after.weighing, media.weighing); assert.deepEqual(after.futureSetting, media.futureSetting);
  });
  await check('a legacy save without font choices normalizes each block and survives later reloads', async () => {
    const legacy = valid(); legacy.layouts.landscape[2].text = 'Welcome';
    for (const block of Object.values(legacy.layouts).flat()) delete block.fontFamily;
    const expected = plain(model.normalizePosDisplayStandbySettings(legacy));
    assert.deepEqual((await json(await post(body(legacy)))).settings.customerDisplayMediaSettings.standby, expected);
    assert.deepEqual((await stored()).customer_display_media_settings.standby, expected);
    assert.deepEqual((await json(await getSettings())).settings.customerDisplayMediaSettings.standby, expected);
    assert.deepEqual((await json(await getDisplay())).customerDisplayMediaSettings.standby, expected);
    assert.deepEqual((await json(await getDisplay(true))).customerDisplayMediaSettings.standby, expected);
  });
  await check('authored seven-language widgets, separate fonts, year choices and motion survive save and every POS/display reader', async () => {
    const value = widgetLayout(), before = await stored(), allBefore = await allData();
    const saved = await json(await post(body(value)));
    assert.deepEqual(saved.settings.customerDisplayMediaSettings.standby, value);
    const after = await stored();
    assert.deepEqual(after.customer_display_media_settings, { ...before.customer_display_media_settings, standby: value });
    const ignored = ['customer_display_media_settings', 'updated_at', 'updated_by'];
    assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => !ignored.includes(key))), Object.fromEntries(Object.entries(before).filter(([key]) => !ignored.includes(key))));
    const allAfter = await allData(); delete allAfter.pos_store_settings; delete allBefore.pos_store_settings;
    assert.deepEqual(allAfter, allBefore);
    await assertUnchanged(async () => {
      const readers = [(await json(await getSettings())).settings, await json(await getDisplay()), await json(await getDisplay(true)),
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings];
      for (const reader of readers) {
        assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
        assert.deepEqual(reader.customerDisplayMediaSettings.weighing, media.weighing);
        assert.deepEqual(reader.customerDisplayMediaSettings.futureSetting, media.futureSetting);
      }
    });
    for (const orientation of ['portrait', 'landscape']) {
      const blocks = after.customer_display_media_settings.standby.layouts[orientation];
      for (const type of ['wordCloud', 'messages']) assert.equal(blocks.find(block => block.type === type).text, authoredGreetings);
    }
  });
  await check('weather detail and icon display choices persist independently in both layouts through every settings POS and display reader', async () => {
    for (const fullSave of [false, true]) {
      const value = widgetLayout();
      value.layouts.portrait.find(block => block.type === 'weather').weatherDisplay = fullSave ? 'details' : 'icon';
      value.layouts.landscape.find(block => block.type === 'weather').weatherDisplay = fullSave ? 'icon' : 'details';
      const before = await stored(), allBefore = await allData();
      const saved = await json(await post(fullSave ? { storeId: ids.store, customerDisplayStandby: value, customerDisplayMediaSettings: before.customer_display_media_settings } : body(value)));
      assert.deepEqual(saved.settings.customerDisplayMediaSettings.standby, value);
      const after = await stored();
      assert.deepEqual(after.customer_display_media_settings, { ...before.customer_display_media_settings, standby: value });
      const ignored = ['customer_display_media_settings', 'updated_at', 'updated_by'];
      assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => !ignored.includes(key))), Object.fromEntries(Object.entries(before).filter(([key]) => !ignored.includes(key))));
      const allAfter = await allData(); delete allAfter.pos_store_settings; delete allBefore.pos_store_settings; assert.deepEqual(allAfter, allBefore);
      await assertUnchanged(async () => {
        const readers = [(await json(await getSettings())).settings, await json(await getDisplay()), await json(await getDisplay(true)),
          (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
          (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings];
        for (const reader of readers) assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
      });
    }
  });
  await check('legacy weather mode omission stays omitted through normalization save and five readers without migrating other blocks', async () => {
    const value = widgetLayout();
    for (const block of Object.values(value.layouts).flat()) assert.equal(Object.hasOwn(block, 'weatherDisplay'), false);
    assert.deepEqual(plain(model.normalizePosDisplayStandbySettings(value)), value);
    await json(await post(body(value)));
    await assertUnchanged(async () => {
      const readers = [(await json(await getSettings())).settings, await json(await getDisplay()), await json(await getDisplay(true)),
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings];
      for (const reader of readers) assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
      assert.deepEqual((await stored()).customer_display_media_settings.standby, value);
    });
    const polluted = plain(value); for (const block of Object.values(polluted.layouts).flat()) if (block.type !== 'weather') block.weatherDisplay = 'icon';
    const validated = model.validatePosDisplayStandbySettings(polluted); assert.equal(validated.error, undefined); assert.deepEqual(plain(validated.settings), value);
  });
  await check('invalid weather display values reject atomically in independent and full saves for both orientations', async () => {
    for (const orientation of ['portrait', 'landscape']) for (const weatherDisplay of [null, false, true, 0, 1, '', 'detail', 'icons', 'DETAILS', ' icon ', [], {}, ['icon']]) {
      const value = widgetLayout(); value.layouts[orientation].find(block => block.type === 'weather').weatherDisplay = weatherDisplay;
      await assertUnchanged(async () => {
        await json(await post(body(value)), 400);
        await json(await post({ storeId: ids.store, dineInEnabled: false, customerDisplayMediaSettings: { ...media, mode: 'video' }, customerDisplayStandby: value }), 400);
      });
    }
    const explicitUndefined = widgetLayout(); explicitUndefined.layouts.landscape.find(block => block.type === 'weather').weatherDisplay = undefined;
    assert.ok(model.validatePosDisplayStandbySettings(explicitUndefined).error);
  });
  await check('per-phrase welcome sizes persist exactly through isolated SQL and every OS POS normal and debug display reader', async () => {
    const value = widgetLayout();
    value.layouts.portrait.find(block => block.type === 'wordCloud').wordFontSizes = [2, null, 7.5, 20, null, 4, 9];
    value.layouts.landscape.find(block => block.type === 'wordCloud').wordFontSizes = [12, 8, null, 6.5, 5, null, 2];
    const before = await stored();
    const result = await json(await post(body(value)));
    assert.deepEqual(result.settings.customerDisplayMediaSettings.standby, value);
    const after = await stored();
    assert.deepEqual(after.customer_display_media_settings, { ...before.customer_display_media_settings, standby: value });
    await assertUnchanged(async () => {
      const readers = [
        (await json(await getSettings())).settings,
        await json(await getDisplay()), await json(await getDisplay(true)),
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings
      ];
      for (const reader of readers) assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
    });
  });
  await check('automatic varied and explicit uniform size modes persist independently through every POS display reader', async () => {
    const value = widgetLayout();
    value.layouts.portrait.find(block => block.type === 'wordCloud').wordSizeMode = 'varied';
    value.layouts.landscape.find(block => block.type === 'wordCloud').wordSizeMode = 'uniform';
    const result = await json(await post(body(value)));
    assert.deepEqual(result.settings.customerDisplayMediaSettings.standby, value);
    assert.deepEqual((await stored()).customer_display_media_settings.standby, value);
    await assertUnchanged(async () => {
      const readers = [(await json(await getSettings())).settings, await json(await getDisplay()), await json(await getDisplay(true)),
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
        (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings];
      for (const reader of readers) assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
    });
  });
  await check('invalid automatic size modes fail atomically while inherited variation and explicit phrase sizes remain deterministic', async () => {
    for (const wordSizeMode of [null, false, 1, '', 'random', [], {}, ['varied']]) {
      const value = widgetLayout(); value.layouts.landscape.find(block => block.type === 'wordCloud').wordSizeMode = wordSizeMode;
      await assertUnchanged(async () => {
        await json(await post(body(value)), 400);
        await json(await post({ storeId: ids.store, dineInEnabled: false, customerDisplayStandby: value }), 400);
      });
    }
    for (const baseSize of [7, 12]) {
      const cloud = plain(model.createPosDisplayStandbyBlock('wordCloud', 'size_contract'));
      cloud.fontSize = baseSize;
      const count = cloud.text.split('\n').length;
      const sizes = Array.from({ length: count }, (_, i) => model.getPosDisplayStandbyWordFontSize(cloud, i));
      assert.ok(new Set(sizes).size >= 4); assert.ok(Math.max(...sizes) / Math.min(...sizes) >= 1.4);
      assert.deepEqual(Array.from({ length: count }, (_, i) => model.getPosDisplayStandbyWordFontSize(cloud, i)), sizes);
      cloud.wordSizeMode = 'uniform';
      assert.deepEqual(Array.from({ length: count }, (_, i) => model.getPosDisplayStandbyWordFontSize(cloud, i)), Array(count).fill(baseSize));
      cloud.wordFontSizes = [20, null, 2];
      assert.equal(model.getPosDisplayStandbyWordFontSize(cloud, 0), 20);
      assert.equal(model.getPosDisplayStandbyWordFontSize(cloud, 1), baseSize);
      assert.equal(model.getPosDisplayStandbyWordFontSize(cloud, 2), 2);
    }
  });
  await check('density contrast and speed-depth boundaries persist independently through settings and all normal/debug POS readers', async () => {
    for (const fullSave of [false, true]) {
      const value = widgetLayout();
      Object.assign(value.layouts.portrait.find(block => block.type === 'wordCloud'), { wordDensity: 50, wordSizeContrast: 0, wordSpeedVariance: 0 });
      Object.assign(value.layouts.landscape.find(block => block.type === 'wordCloud'), { wordDensity: 180, wordSizeContrast: 100, wordSpeedVariance: 40, wordFontSizes: [20, null, 2] });
      const before = await stored();
      const result = await json(await post(fullSave ? { storeId: ids.store, customerDisplayStandby: value, customerDisplayMediaSettings: before.customer_display_media_settings } : body(value)));
      assert.deepEqual(result.settings.customerDisplayMediaSettings.standby, value);
      const saved = await stored();
      assert.deepEqual(saved.customer_display_media_settings, { ...before.customer_display_media_settings, standby: value });
      await assertUnchanged(async () => {
        const readers = [(await json(await getSettings())).settings, await json(await getDisplay()), await json(await getDisplay(true)),
          (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}`)))).posSettings,
          (await json(await posApi.GET(request(`/api/store/pos?storeId=${ids.store}&debug=1`)))).posSettings];
        for (const reader of readers) assert.deepEqual(reader.customerDisplayMediaSettings.standby, value);
      });
    }
  });
  await check('legacy omitted ambient controls remain omitted and do not migrate store layouts or other components', async () => {
    const value = widgetLayout();
    const normalized = plain(model.normalizePosDisplayStandbySettings(value));
    assert.deepEqual(normalized, value);
    for (const block of Object.values(normalized.layouts).flat()) for (const key of ['wordDensity', 'wordSizeContrast', 'wordSpeedVariance']) assert.equal(Object.hasOwn(block, key), false);
    await json(await post(body(value)));
    await assertUnchanged(async () => {
      assert.deepEqual((await json(await getDisplay())).customerDisplayMediaSettings.standby, value);
      assert.deepEqual((await stored()).customer_display_media_settings.standby, value);
    });
    for (const orientation of ['portrait', 'landscape']) for (const block of value.layouts[orientation]) if (block.type !== 'wordCloud') {
      block.wordDensity = 115; block.wordSizeContrast = 65; block.wordSpeedVariance = 18;
    }
    const stripped = plain(model.validatePosDisplayStandbySettings(value).settings);
    assert.ok(stripped);
    for (const block of Object.values(stripped.layouts).flat()) if (block.type !== 'wordCloud') for (const key of ['wordDensity', 'wordSizeContrast', 'wordSpeedVariance']) assert.equal(Object.hasOwn(block, key), false);
  });
  await check('invalid ambient controls reject atomically for independent and full saves including explicit nonfinite values', async () => {
    for (const [key, min, max] of [['wordDensity', 50, 180], ['wordSizeContrast', 0, 100], ['wordSpeedVariance', 0, 40]]) {
      for (const orientation of ['portrait', 'landscape']) for (const invalid of [null, false, '', '100', [], {}, min - .01, max + .01]) {
        const value = widgetLayout(); value.layouts[orientation].find(block => block.type === 'wordCloud')[key] = invalid;
        await assertUnchanged(async () => {
          for (const data of [body(value), { storeId: ids.store, dineInEnabled: false, customerDisplayMediaSettings: { ...media, mode: 'video' }, customerDisplayStandby: value }]) {
            const rejected = await json(await post(data), 400); assert.match(rejected.error, /[\u3040-\u30ff\u4e00-\u9fff]/);
          }
        });
      }
      for (const invalid of [undefined, NaN, Infinity, -Infinity]) {
        const value = widgetLayout(); value.layouts.landscape.find(block => block.type === 'wordCloud')[key] = invalid;
        assert.ok(model.validatePosDisplayStandbySettings(value).error, `${key} must reject explicit nonfinite/undefined`);
      }
    }
  });
  await check('size contrast is deterministic and independent of density/speed while explicit phrase sizes always win', async () => {
    for (const fontSize of [7, 12]) {
      const cloud = { ...plain(model.createPosDisplayStandbyBlock('wordCloud', 'contrast_contract')), fontSize, wordSizeMode: 'varied' };
      const count = cloud.text.split('\n').length;
      const sizes = contrast => Array.from({ length: count }, (_, index) => model.getPosDisplayStandbyWordFontSize({ ...cloud, wordSizeContrast: contrast }, index));
      assert.deepEqual(sizes(0), Array(count).fill(fontSize));
      const medium = sizes(50), high = sizes(100);
      assert.ok(Math.max(...high) - Math.min(...high) > Math.max(...medium) - Math.min(...medium));
      assert.deepEqual(sizes(50), Array.from({ length: count }, (_, i) => model.getPosDisplayStandbyWordFontSize(cloud, i)));
      Object.assign(cloud, { wordDensity: 180, wordSpeedVariance: 40 }); assert.deepEqual(sizes(50), medium);
      cloud.wordFontSizes = [20, null, 2];
      for (const contrast of [0, 50, 100]) { const result = sizes(contrast); assert.equal(result[0], 20); assert.equal(result[2], 2); }
      cloud.wordSizeMode = 'uniform'; assert.equal(model.getPosDisplayStandbyWordFontSize({ ...cloud, wordSizeContrast: 100 }, 1), fontSize);
    }
  });
  await check('malformed per-phrase sizes fail atomically including full settings saves and non-finite model inputs', async () => {
    const invalid = [null, false, '7', {}, 7, [1.99], [20.01], ['7'], [true], [{}], [[]], Array(13).fill(7)];
    for (const orientation of ['portrait', 'landscape']) for (const wordFontSizes of invalid) {
      const value = widgetLayout();
      value.layouts[orientation].find(block => block.type === 'wordCloud').wordFontSizes = wordFontSizes;
      await assertUnchanged(async () => {
        await json(await post(body(value)), 400);
        await json(await post({ storeId: ids.store, dineInEnabled: false,
          customerDisplayMediaSettings: { ...media, mode: 'video' }, customerDisplayStandby: value }), 400);
      });
    }
    for (const number of [NaN, Infinity, -Infinity]) {
      const value = widgetLayout(); value.layouts.landscape.find(block => block.type === 'wordCloud').wordFontSizes = [number];
      assert.equal(model.validatePosDisplayStandbySettings(value).settings, undefined);
    }
  });
  await check('legacy welcome geometry and absent phrase-size fields remain intact without a database rewrite', async () => {
    const value = widgetLayout();
    const cloud = value.layouts.landscape.find(block => block.type === 'wordCloud');
    cloud.x = 12.5; cloud.width = 71.25; delete cloud.wordFontSizes;
    await json(await post(body(value)));
    const storedBefore = await stored();
    await assertUnchanged(async () => {
      const read = (await json(await getDisplay())).customerDisplayMediaSettings.standby;
      assert.deepEqual(read, value);
      assert.equal(Object.hasOwn(read.layouts.landscape.find(block => block.type === 'wordCloud'), 'wordFontSizes'), false);
    });
    assert.deepEqual(await stored(), storedBefore);
  });
  await check('new widget defaults normalize missing optional settings while preserving existing Georgia fonts and exact old block geometry', async () => {
    const value = widgetLayout();
    for (const orientation of ['portrait', 'landscape']) {
      for (const block of value.layouts[orientation]) {
        delete block.showYear; delete block.motion; delete block.animationSeconds;
      }
    }
    const expected = plain(model.normalizePosDisplayStandbySettings(value));
    const oldBlocks = orientation => value.layouts[orientation].filter(block => ['clock', 'image', 'text', 'storeName'].includes(block.type));
    for (const orientation of ['portrait', 'landscape']) {
      assert.deepEqual(expected.layouts[orientation].filter(block => ['clock', 'image', 'text', 'storeName'].includes(block.type)), oldBlocks(orientation));
      assert.equal(expected.layouts[orientation].find(block => block.type === 'date').showYear, true);
      assert.equal(expected.layouts[orientation].find(block => block.type === 'wordCloud').animationSeconds, 24);
      assert.equal(expected.layouts[orientation].find(block => block.type === 'messages').animationSeconds, 8);
      for (const type of ['wordCloud', 'messages']) assert.equal(expected.layouts[orientation].find(block => block.type === type).motion, 'gentle');
    }
    await json(await post(body(value)));
    assert.deepEqual((await stored()).customer_display_media_settings.standby, expected);
    assert.deepEqual((await json(await getSettings())).settings.customerDisplayMediaSettings.standby, expected);
    assert.deepEqual((await json(await getDisplay())).customerDisplayMediaSettings.standby, expected);
    assert.deepEqual((await json(await getDisplay(true))).customerDisplayMediaSettings.standby, expected);
  });
  await check('twelve authored lines and eighty Unicode code points per line save without chopping text or adding translations', async () => {
    const value = widgetLayout();
    value.layouts.portrait.find(block => block.type === 'wordCloud').text = Array.from({ length: 12 }, (_, index) => `${index + 1}. Welcome ゆっくり`).join('\n');
    value.layouts.landscape.find(block => block.type === 'messages').text = '🌿'.repeat(80);
    const result = await json(await post(body(value)));
    assert.deepEqual(result.settings.customerDisplayMediaSettings.standby, value);
    assert.deepEqual((await stored()).customer_display_media_settings.standby, value);
  });
  await check('malformed widget optional settings and authored text fail atomically before standby or unrelated media can change', async () => {
    const mutations = [
      block => { block.showYear = null; }, block => { block.showYear = 1; }, block => { block.showYear = 'true'; },
      block => { block.motion = ''; }, block => { block.motion = null; }, block => { block.motion = true; },
      block => { block.motion = 'spin'; }, block => { block.motion = { speed: 'gentle' }; },
      block => { block.animationSeconds = 7.99; }, block => { block.animationSeconds = 90.01; },
      block => { block.animationSeconds = null; }, block => { block.animationSeconds = '24'; },
      block => { block.animationSeconds = false; }, block => { block.animationSeconds = {}; }
    ];
    await assertUnchanged(async () => {
      for (const orientation of ['portrait', 'landscape']) {
        for (const type of ['date', 'weather', 'wordCloud', 'messages']) {
          for (const mutate of mutations) {
            const value = widgetLayout(); mutate(value.layouts[orientation].find(block => block.type === type));
            const result = await json(await post(body(value)), 400); assert.match(result.error, /[\u3040-\u30ff\u4e00-\u9fff]/);
          }
        }
        for (const type of ['wordCloud', 'messages']) {
          for (const text of ['', ' \n\t\r\n ', Array.from({ length: 13 }, (_, index) => `Welcome ${index + 1}`).join('\n'), 'a'.repeat(81), '🌿'.repeat(81)]) {
            const value = widgetLayout(); value.layouts[orientation].find(block => block.type === type).text = text;
            await json(await post({ ...body(value), dineInEnabled: false, customerDisplayMediaSettings: { ...media, mode: 'video', weighing: { enabled: false } } }), 400);
            await json(await post({ storeId: ids.store, dineInEnabled: false, customerDisplayStandby: value,
              customerDisplayMediaSettings: { ...media, mode: 'video', standby: valid(), futureSetting: null } }), 400);
          }
        }
      }
    });
    for (const key of ['showYear', 'motion', 'animationSeconds']) {
      const value = widgetLayout(); value.layouts.landscape.find(block => block.type === 'messages')[key] = undefined;
      assert.ok(model.validatePosDisplayStandbySettings(value).error, `Explicit undefined ${key} must not masquerade as a legacy omission`);
    }
    for (const animationSeconds of [NaN, Infinity, -Infinity]) {
      const value = widgetLayout(); value.layouts.portrait.find(block => block.type === 'wordCloud').animationSeconds = animationSeconds;
      assert.ok(model.validatePosDisplayStandbySettings(value).error);
    }
  });
  await check('scoped role permissions apply to independent and full saves; unauthenticated reads and writes deny', async () => {
    await assertUnchanged(async () => {
      state.session = null;
      await json(await post(body()), 401); await json(await getSettings(), 401); await json(await getDisplay(), 401);
      state.session = originalSession; canManage = false;
      await json(await post(body()), 403); await json(await post({ storeId: ids.store, customerDisplayStandby: valid() }), 403);
      const readOnly = await json(await getSettings()); assert.equal(readOnly.access.canManagePosSettings, false);
      canManage = true;
      await json(await post(body(valid(), ids.other)), 403); await json(await getSettings(ids.other), 403); await json(await getDisplay(true, ids.other), 403);
      allStores = true;
      await json(await post(body(valid(), '00000000-0000-4000-8000-000000009999')), 403);
      allStores = false;
    });
  });
  await check('invalid, missing, and malformed settings fail before any write with Japanese errors', async () => {
    const cases = [undefined, null, [], {}, { ...valid(), enabled: 'true' }, { ...valid(), backgroundColor: 'red' }, { ...valid(), layouts: {} }];
    await assertUnchanged(async () => {
      for (const value of cases) { const result = await json(await post(body(value === undefined ? null : value)), 400); assert.match(result.error, /[\u3040-\u30ff\u4e00-\u9fff]/); }
      await json(await post({ storeId: ids.store, section: 'customerDisplayStandby' }), 400);
      await json(await settingsApi.POST(new Request('http://isolated.test/api/os/pos/settings', { method: 'POST', body: '{' })), 400);
      await json(await post(null), 400);
      await json(await post({ storeId: ids.store, customerDisplayStandby: { enabled: true } }), 400);
    });
  });
  await check('layout bounds, block limits, unique IDs, text length, and presentation fields are validated', async () => {
    const mutations = [
      s => { s.layouts.portrait = Array.from({ length: 17 }, (_, i) => ({ ...s.layouts.portrait[0], id: 'block_' + i })); },
      s => { s.layouts.portrait[1].id = s.layouts.portrait[0].id; },
      s => { s.layouts.portrait[0].id = '<script>'; },
      s => { s.layouts.portrait[0].type = 'html'; },
      s => { s.layouts.portrait[0].x = -1; },
      s => { s.layouts.portrait[0].y = 99; },
      s => { s.layouts.portrait[0].width = 0; },
      s => { s.layouts.portrait[0].height = 101; },
      s => { s.layouts.portrait[0].fontSize = 1.9; },
      s => { s.layouts.portrait[0].fontSize = 21; },
      s => { s.layouts.portrait[0].fontSize = '6'; },
      s => { s.layouts.portrait[0].color = 'url(javascript:alert(1))'; },
      s => { s.layouts.portrait[0].align = 'justify'; },
      s => { s.layouts.portrait[0].text = 'a'.repeat(501); },
      s => { s.layouts.portrait[0].showDate = 1; }
    ];
    await assertUnchanged(async () => { for (const mutate of mutations) { const value = valid(); mutate(value); await json(await post(body(value)), 400); } });
    const value = valid(); value.layouts.portrait[0].x = NaN;
    assert.ok(model.validatePosDisplayStandbySettings(value).error);
    value.layouts.portrait[0].x = Infinity; assert.ok(model.validatePosDisplayStandbySettings(value).error);
  });
  await check('unknown font values and types are rejected in every orientation and block without partial settings writes', async () => {
    const unsafe = ['Georgia', 'serif', 'Arial', 'georgia; color:red', 'url(https://example.test/font.woff2)', '', null, 1, true, [], { family: 'georgia' }];
    await assertUnchanged(async () => {
      for (const orientation of ['portrait', 'landscape']) {
        for (const index of [0, 1, 2, 3]) {
          for (const fontFamily of unsafe) {
            const value = mixedFonts(); value.layouts[orientation][index].fontFamily = fontFamily;
            const result = await json(await post(body(value)), 400);
            assert.match(result.error, /フォントを選択してください/);
          }
        }
      }
      const invalidFullSave = mixedFonts(); invalidFullSave.layouts.landscape[2].fontFamily = 'Comic Sans MS';
      await json(await post({ storeId: ids.store, dineInEnabled: false, customerDisplayMediaSettings: { ...media, mode: 'video' }, customerDisplayStandby: invalidFullSave }), 400);
    });
    const ownUndefined = valid(); ownUndefined.layouts.portrait[0].fontFamily = undefined;
    assert.match(model.validatePosDisplayStandbySettings(ownUndefined).error, /フォント/);
  });
  await check('script, data, SVG, credentialed, protocol-relative, and malformed image URLs are rejected', async () => {
    const unsafe = ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,aA==', 'http://example.test/a.png', '//example.test/a.png', '/\\example.test/a.png', 'https://u:p@example.test/a.png', 'https://example.test/a.svg', '/img/a.SVG?x=1', '/img/a.%73vg', '/img/a.svg%3fquery', 'https://example.test/a.svgz', 'https://example.test/a.png\n', 'https://example.test/%00.png', '/%zz', '/<img>.png'];
    await assertUnchanged(async () => { for (const imageUrl of unsafe) { const value = valid(); value.layouts.portrait[1].imageUrl = imageUrl; await json(await post(body(value)), 400); } });
    for (const imageUrl of ['', '/uploads/photo.png?width=100', 'https://blob.example.test/photo.jpg?token=valid', 'https://example.test/店舗.webp', '/uploads/store%20logo.png']) assert.equal(model.isSafePosDisplayStandbyImageUrl(imageUrl), true, imageUrl);
  });
  await check('unknown block/settings payload fields are stripped and empty layouts can be saved intentionally', async () => {
    const value = valid(); value.someFutureWrite = { unwanted: true }; value.layouts.portrait[0].html = '<script/>';
    const result = await json(await post(body(value)));
    assert.equal(result.settings.customerDisplayMediaSettings.standby.someFutureWrite, undefined);
    assert.equal(result.settings.customerDisplayMediaSettings.standby.layouts.portrait[0].html, undefined);
    const blank = { enabled: true, backgroundColor: '#ffffff', layouts: { portrait: [], landscape: [] } };
    await json(await post(body(blank))); assert.deepEqual((await stored()).customer_display_media_settings.standby, blank);
  });
  await check('a store without settings gets only standby and normal schema defaults; other stores remain unchanged', async () => {
    const before = await stored(); scopeIds = [ids.store, ids.other];
    await json(await post(body(valid(), ids.other)));
    const other = await stored(ids.other);
    assert.deepEqual(other.customer_display_media_settings, { standby: valid() });
    assert.deepEqual(await stored(), before); scopeIds = [ids.store];
  });
  await check('invalid stored layouts fall back disabled without changing stored settings', async () => {
    const malformed = { ...media, standby: { enabled: true, backgroundColor: 'javascript:bad', layouts: {} } };
    await realQuery('update pos_store_settings set customer_display_media_settings=$2::jsonb where store_id=$1', [ids.store, JSON.stringify(malformed)]);
    await assertUnchanged(async () => {
      assert.equal((await json(await getSettings())).settings.customerDisplayMediaSettings.standby.enabled, false);
      assert.equal((await json(await getDisplay(true))).customerDisplayMediaSettings.standby.enabled, false);
    });
  });
  await check('hidden flags round-trip for all block types and orientations through OS, POS and normal/debug display readers', async () => {
    const value=widgetLayout();for(const orientation of ['portrait','landscape'])value.layouts[orientation].forEach((block,index)=>{block.hidden=index%2===0;});
    await json(await post(body(value)));assert.deepEqual((await stored()).customer_display_media_settings.standby,value);
    await assertUnchanged(async()=>{for(const result of [(await json(await getSettings())).settings,await json(await getDisplay()),await json(await getDisplay(true)),(await json(await posApi.GET(request('/api/store/pos?storeId='+ids.store)))).posSettings])assert.deepEqual(result.customerDisplayMediaSettings.standby,value);});
  });
  await check('explicit non-boolean hidden values reject before any settings write', async () => {
    await assertUnchanged(async()=>{for(const orientation of ['portrait','landscape'])for(const invalid of [null,'false',0,1,{},[]]){const value=valid();value.layouts[orientation][0].hidden=invalid;const response=await post(body(value));assert.equal(response.status,400);assert.equal((await response.json()).error,'部品の表示設定を確認してください。');}});
  });
  await check('all-hidden layouts remain enabled and retain full content; restoring visibility changes only the flag',async()=>{
    const value=widgetLayout();for(const blocks of Object.values(value.layouts))for(const block of blocks)block.hidden=true;await json(await post(body(value)));assert.deepEqual((await json(await getDisplay())).customerDisplayMediaSettings.standby,value);
    const restored=plain(value);restored.layouts.landscape[2].hidden=false;await json(await post(body(restored)));assert.deepEqual((await stored()).customer_display_media_settings.standby,restored);
    const legacy=valid();assert.deepEqual(plain(model.normalizePosDisplayStandbySettings(legacy)),legacy);
  });
  await check('all route writes are confined to POS settings, with no schema changes or transaction side effects', async () => {
    assert.ok(statements.some(text => /jsonb_set\(/.test(text)), 'Dedicated save must use atomic JSONB update');
    assert.ok(!statements.some(text => /\b(create|alter|drop)\s+(table|index|schema)/i.test(text)));
    const mutations = statements.filter(text => /^\s*(insert|update|delete)\b/i.test(text));
    assert.ok(mutations.every(text => /^\s*(insert\s+into|update)\s+pos_store_settings\b/i.test(text)), mutations.join('\n'));
    const schemaAfter = (await realQuery("select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows;
    assert.deepEqual(schemaAfter, schemaBefore);
  });
  const hashes = await sourceHashes();
  assert.deepEqual(hashes, hashesBefore, 'Tested source changed during the API run');
  const report = { source, isolatedPGlite: true, productionWrites: 0, externalRequests: 0, passed: checks.every(check => check.passed), checks, hashes, hashesBefore, sourceUnchanged: true };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, output }));
  if (!report.passed) process.exitCode = 1;
} finally { await db.close(); }
