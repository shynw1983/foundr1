// Real GET handler and scope/SQL contracts against isolated PostgreSQL. The weather provider is synthetic.
// This test never reads DATABASE_URL or contacts a weather service, store device, or production backend.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, i, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[i + 1]]); return all;
}, []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/pos-display-weather-api');
await mkdir(output, { recursive: true });
const files = ['app/api/store/pos/customer-display/weather/route.ts', 'lib/pos-display-weather.ts', 'components/pos/usePosDisplayWeather.ts', 'scripts/tests/pos-display-weather-api.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(join(source, file))).digest('hex')])));
const hashesBefore = await hashes();
const fixture = await createPrintDocumentFixture(source), { db, ids, state, modules } = fixture;
const validSession = state.session, checks = [], statements = [], providerCalls = [];
const NativeDate = Date;
let now = NativeDate.parse('2026-10-21T04:00:00.000Z');
class TestDate extends NativeDate {
  constructor(...values) { super(...(values.length ? values : [now])); }
  static now() { return now; }
}
let scopeIds = [ids.store], allStores = false, forecasts = [], providerFails = false, advanceProviderMs = 0;
modules['api-auth'] = { requireOsSession: async () => state.session, getSessionStoreScope: async () => ({ allStores, storeIds: scopeIds }) };
modules['role-permissions'] = { roleHasPermission: async () => true };
delete modules['store-order-access'];
modules['weather-forecast'] = { getStoreWeatherForecast: async input => {
  providerCalls.push(input); now += advanceProviderMs;
  if (providerFails) throw new Error('Synthetic provider outage');
  return forecasts;
} };
// Inject a deterministic clock into the actual route/module VM, then immediately restore the host clock.
let route, model;
try {
  globalThis.Date = TestDate;
  route = fixture.reload('app/api/store/pos/customer-display/weather/route.ts');
  model = fixture.load('lib/pos-display-weather.ts');
} finally { globalThis.Date = NativeDate; }
const query = db.query.bind(db);
const get = (storeId = ids.store, suffix = '') => route.GET(fixture.request(`/api/store/pos/customer-display/weather${storeId ? `?storeId=${storeId}${suffix}` : ''}`));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function check(name, work) {
  try { await work(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
const forecast = (patch = {}) => ({ date: '2026-10-21', weatherCode: 2, label: '晴れ時々曇り', temperatureMax: 25,
  temperatureMin: 18, precipitationProbabilityMax: 20, precipitationSum: null, windSpeedMax: null, windLabel: '',
  reliability: null, sourceName: '気象庁', sourceUrl: 'https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=400000',
  updatedAt: '2026-10-21T02:00:00.000Z', isFallback: false, ...patch });
const snapshot = async () => {
  const tables = (await query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  return Object.fromEntries(await Promise.all(tables.map(async ({ tablename }) => [tablename, (await query(`select to_jsonb(t) as row from "${tablename}" t order by to_jsonb(t)::text`)).rows])));
};
try {
  await query('update stores set weather_latitude=33.59,weather_longitude=130.4,attendance_latitude=34.7,attendance_longitude=135.5,social_insurance_prefecture=$2 where id=$1', [ids.store, '福岡県']);
  const databaseBefore = await snapshot();
  db.query = async (text, values, options) => { statements.push(text); return query(text, values, options); };

  await check('anonymous and out-of-scope GET reject before fetching weather', async () => {
    state.session = null; await json(await get(), 401); state.session = validSession;
    await json(await get(ids.other), 403);
    assert.equal(providerCalls.length, 0);
  });
  await check('only an accessible active store can be selected, including owner scope', async () => {
    allStores = true;
    await json(await get('missing-store'), 403);
    await query("update stores set status='inactive' where id=$1", [ids.other]);
    await json(await get(ids.other), 403);
    await query("update stores set status='active' where id=$1", [ids.other]);
    allStores = false;
  });
  await check('today-only JST daily forecast is explicit and contains attribution without coordinates', async () => {
    forecasts = [forecast({ date: '2026-10-20', label: '昨日' }), forecast(), forecast({ date: '2026-10-22', label: '明日' })];
    const response = await get(), value = await json(response);
    assert.equal(value.status, 'ready'); assert.equal(value.date, '2026-10-21');
    assert.equal(value.data.kind, 'daily_forecast'); assert.equal(value.data.highC, 25); assert.equal(value.data.lowC, 18);
    assert.equal(value.data.condition, '晴れ時々曇り'); assert.equal(value.data.sourceName, '気象庁');
    assert.equal(value.data.updatedAt, '2026-10-21T02:00:00.000Z'); assert.equal(value.data.fetchedAt, '2026-10-21T04:00:00.000Z');
    assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('vary'), 'Cookie');
    assert.ok(!/latitude|longitude|address|currentTemperature/.test(JSON.stringify(value)));
  });
  await check('client coordinates and arbitrary prefecture are ignored in favor of the saved store', async () => {
    await json(await get(ids.store, '&latitude=0&longitude=0&prefecture=東京都'));
    assert.deepEqual(JSON.parse(JSON.stringify(providerCalls.at(-1))), { latitude: 33.59, longitude: 130.4, prefecture: '福岡県' });
  });
  await check('a missing store parameter resolves the same scoped default as customer display', async () => {
    const value = await json(await get('')); assert.equal(value.storeId, ids.store); assert.equal(value.status, 'ready');
  });
  await check('no saved coordinate pair returns not_configured with no weather provider call', async () => {
    await query('update stores set weather_latitude=null,weather_longitude=null,attendance_latitude=null,attendance_longitude=null where id=$1', [ids.store]);
    const count = providerCalls.length, value = await json(await get());
    assert.equal(value.status, 'not_configured'); assert.equal(value.data, null); assert.equal(providerCalls.length, count);
  });
  await check('complete attendance location can supply weather when dedicated weather coordinates are missing', async () => {
    await query('update stores set attendance_latitude=34.7,attendance_longitude=135.5 where id=$1', [ids.store]);
    assert.equal((await json(await get())).status, 'ready');
    assert.equal(providerCalls.at(-1).latitude, 34.7); assert.equal(providerCalls.at(-1).longitude, 135.5);
  });
  await check('partial or invalid weather coordinates never mix unrelated location pairs', async () => {
    await query('update stores set weather_latitude=33.59,weather_longitude=null where id=$1', [ids.store]);
    await json(await get()); assert.equal(providerCalls.at(-1).latitude, 34.7); assert.equal(providerCalls.at(-1).longitude, 135.5);
    await query('update stores set weather_latitude=95,weather_longitude=130.4 where id=$1', [ids.store]);
    await json(await get()); assert.equal(providerCalls.at(-1).latitude, 34.7);
    await query('update stores set weather_latitude=33.59,weather_longitude=130.4 where id=$1', [ids.store]);
  });
  await check('a provider outage is a truthful quiet unavailable result', async () => {
    providerFails = true; const value = await json(await get()); providerFails = false;
    assert.equal(value.status, 'unavailable'); assert.equal(value.data, null);
  });
  await check('future-only or missing daily data never masquerades as today', async () => {
    for (const value of [[], [forecast({ date: '2026-10-22' })], [forecast({ date: '2026-10-20' })]]) {
      forecasts = value; const response = await json(await get()); assert.equal(response.status, 'unavailable'); assert.equal(response.data, null);
    }
  });
  await check('old or implausibly future provider timestamps are explicitly stale', async () => {
    for (const updatedAt of ['2026-10-19T02:00:00.000Z', '2026-10-21T08:00:00.000Z']) {
      forecasts = [forecast({ updatedAt })]; const value = await json(await get()); assert.equal(value.status, 'stale'); assert.equal(value.data.updatedAt, updatedAt);
    }
  });
  await check('invalid attribution, temperatures and payloads cannot be displayed as a forecast', async () => {
    for (const patch of [{ sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://external.test/data' }, { updatedAt: '' },
      { temperatureMax: 100, temperatureMin: null, weatherCode: null }, { temperatureMax: 18, temperatureMin: 25 }, { label: '' }]) {
      forecasts = [forecast(patch)]; const value = await json(await get()); assert.equal(value.status, 'unavailable'); assert.equal(value.data, null);
    }
  });
  await check('fallback attribution is preserved without claiming an official or current reading', async () => {
    forecasts = [forecast({ sourceName: 'Open-Meteo（予備）', sourceUrl: 'https://open-meteo.com/en/docs', isFallback: true })];
    const value = await json(await get()); assert.equal(value.status, 'ready'); assert.equal(value.data.sourceName, 'Open-Meteo（予備）');
    assert.equal(value.data.kind, 'daily_forecast');
  });
  await check('JST rollover reselects today after an in-flight provider request', async () => {
    now = NativeDate.parse('2026-10-21T14:59:59.000Z'); advanceProviderMs = 2000;
    forecasts = [forecast(), forecast({ date: '2026-10-22', label: '明日の晴れ', updatedAt: '2026-10-21T14:00:00.000Z' })];
    const value = await json(await get()); advanceProviderMs = 0;
    assert.equal(value.date, '2026-10-22'); assert.equal(value.data.date, '2026-10-22'); assert.equal(value.data.condition, '明日の晴れ');
  });
  await check('client DTO parser rejects mismatched store, wrong date and untrusted source', async () => {
    forecasts = [forecast({ date: '2026-10-22', updatedAt: '2026-10-21T14:00:00.000Z' })];
    const value = await json(await get()); const at = new TestDate();
    assert.ok(model.readPosDisplayWeatherResponse(value, ids.store, at));
    assert.equal(model.readPosDisplayWeatherResponse(value, ids.other, at), null);
    assert.equal(model.readPosDisplayWeatherResponse({ ...value, date: '2026-10-21' }, ids.store, at), null);
    assert.equal(model.readPosDisplayWeatherResponse({ ...value, data: { ...value.data, sourceUrl: 'https://fake.jma.go.jp/data' } }, ids.store, at), null);
    assert.equal(model.getPosDisplayWeatherDate(new NativeDate('2026-10-21T14:59:59.000Z')), '2026-10-21');
    assert.equal(model.getPosDisplayWeatherDate(new NativeDate('2026-10-21T15:00:00.000Z')), '2026-10-22');
    assert.equal(model.isPosDisplayWeatherStale(value.data, now + 91 * 60 * 1000), true);
  });
  await check('all handler requests preserve every business table and issue only SELECT statements', async () => {
    await query('update stores set weather_latitude=33.59,weather_longitude=130.4,attendance_latitude=34.7,attendance_longitude=135.5 where id=$1', [ids.store]);
    assert.deepEqual(await snapshot(), databaseBefore);
    assert.ok(statements.length > 0); assert.ok(statements.every(text => /^\s*select\b/i.test(text)), statements.filter(text => !/^\s*select\b/i.test(text)).join('\n'));
    assert.equal(state.externalCalls, 0);
  });
} finally { await db.close(); }
const hashesAfter = await hashes();
const report = { passed: checks.every(check => check.passed) && JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter),
  source, checks, hashesBefore, hashesAfter, providerCalls: providerCalls.length, externalCalls: state.externalCalls,
  database: 'isolated PostgreSQL / PGlite', productionAccess: false, createdAt: new NativeDate().toISOString() };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, report: join(output, 'report.json') }));
if (!report.passed) process.exitCode = 1;
