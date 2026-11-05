// Execute the source-status GET SQL against an isolated in-memory Postgres.
// Run with FOUNDR1_PGLITE_MODULE when PGlite is installed outside this repo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
function load(file, modules = {}) {
  const context = { exports: {}, Response, URL, require: name => modules[name.split('/').at(-1)] ?? {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}

const group = { sourceKey: 'option_group:g', targetId: 'g', kind: 'option_group', name: 'トッピング' };
const option = { sourceKey: 'option:g:corn', targetId: 'corn', parentId: 'g', kind: 'option', name: 'チーズコーンボール' };
const category = { sourceKey: 'category:c', targetId: 'c', kind: 'category', name: '定番' };
const item = { sourceKey: 'item:soup', targetId: 'soup', parentId: 'c', kind: 'item', name: '麻辣湯' };
const targets = [group, option, category, item,
  { sourceKey: 'category:decoy', targetId: 'g', kind: 'category', name: '別種類の親' }];
const payload = (entries, platform = 'rocket_now') => ({ sourceId: 'source', revision: 5,
  ...(platform === 'uber_eats' ? { authoritativeSource: true } : { authoritativePublication: true }), targets: entries });
try {
  await db.exec(`create table local_bridge_commands (
    id text primary key, store_id text, platform text, command_type text, status text,
    created_at timestamptz, completed_at timestamptz, updated_at timestamptz default now(), available_at timestamptz default now(),
    last_error text default '', attempts integer default 1, payload jsonb, result jsonb
  )`);
  const jobs = [
    { id: 'rocket', platform: 'rocket_now', date: '2026-10-20T04:00:00Z', targets,
      progress: { sourceKey: option.sourceKey, phase: 'content', action: 'save', telemetryVersion: 2, checkedTargets: 323, totalTargets: 323, skippedTargets: 322, contentChanges: 1, contentCompleted: 1, writeRequestsCompleted: 1, readRequestsCompleted: 55, recent: [{ at: 100, sourceKey: item.sourceKey, phase: 'preflight', action: 'read_item' }] } },
    { id: 'demae', platform: 'demae_can', date: '2026-10-20T03:00:00Z',
      targets: [...targets, { ...category, sourceKey: 'category:ambiguous', name: '曖昧な親' }],
      progress: { sourceKey: item.sourceKey, phase: 'verifying', action: 'read_item' } },
    { id: 'global', platform: 'uber_eats', date: '2026-10-20T02:00:00Z', targets,
      progress: { phase: 'preflight', action: 'read_menu', recent: [{ at: 90, sourceKey: option.sourceKey, phase: 'content', action: 'save' }] } },
    { id: 'historical', platform: 'rocket_now', date: '2026-10-20T01:00:00Z', status: 'succeeded', completedAt: '2026-10-20T01:30:00Z', targets,
      progress: { phase: 'creating', authorityOperation: { sourceKey: item.sourceKey, externalId: 'private-native-id' } } }
  ];
  for (const job of jobs) await db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,created_at,completed_at,payload,result)
    values ($1,'store',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
    [job.id, job.platform, job.platform === 'uber_eats' ? 'capture_menu_snapshot' : 'publish_menu_changes', job.status ?? 'processing',
      job.date, job.completedAt ?? null, JSON.stringify(payload(job.targets, job.platform)), JSON.stringify({ progress: job.progress })]);
  // Newer successful recovery/inventory reads share sourceId and the full copied
  // publication payload. They must not replace the displayed full menu job or
  // claim its last-success version. Wrong command/authority/platform pairs are
  // likewise excluded even when they contain plausible object progress.
  const excluded = [
    ['recovery-inspect','rocket_now','inspect_menu_sync',{}],
    ['recovery-repair','rocket_now','repair_menu_sync',{}],
    ['inventory-write','rocket_now','set_inventory_availability',{}],
    ['inventory-audit','rocket_now','audit_inventory',{}],
    ['unmarked-publication','rocket_now','publish_menu_changes',{authoritativePublication:false}],
    ['wrong-uber-command','uber_eats','publish_menu_changes',{authoritativePublication:true}],
    ['unmarked-capture','uber_eats','capture_menu_snapshot',{authoritativeSource:false}],
    ['wrong-rocket-command','rocket_now','capture_menu_snapshot',{authoritativeSource:true}]
  ];
  for (const [id,platform,commandType,flags] of excluded) await db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,created_at,completed_at,payload,result)
    values ($1,'store',$2,$3,'succeeded','2026-10-20T09:00:00Z','2026-10-20T09:01:00Z',$4::jsonb,$5::jsonb)`,
    [id,platform,commandType,JSON.stringify({...payload(targets,platform),...flags,revision:999}),
      JSON.stringify({progress:{sourceKey:option.sourceKey,targetName:'SHOULD NEVER APPEAR',phase:'verifying'}})]);
  // A different store/source must remain outside the response.
  await db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,created_at,payload,result)
    values ('foreign','other-store','rocket_now','publish_menu_changes','processing',now(),$1::jsonb,'{}'::jsonb)`, [JSON.stringify(payload(targets))]);

  let executions = 0, successExecutions = 0;
  const api = load('app/api/menus/uber-source/route.ts', {
    'api-auth': { requireMasterOsSession: async () => ({ role: 'owner' }) },
    'menu-sync-progress': load('lib/menu-sync-progress.ts'),
    'menu-sync-status': { nextMenuCheck: () => 'next', menuSyncIssueContext: () => ({ issues: [] }) },
    db: { sql: async (parts, ...values) => {
      const query = parts.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, '');
      if (query.includes('as "progressTargets"')) {
        executions++;
        return (await db.query(query, values)).rows;
      }
      if (query.includes('select distinct on(platform)')) {
        successExecutions++;
        return (await db.query(query, values)).rows;
      }
      if (query.includes('from menu_uber_sources')) return [{ id: 'source', store_id: 'store' }];
      return [];
    } }
  });
  const response = await api.GET(new Request('http://isolated.test/api/menus/uber-source?brandId=brand'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(executions, 1);
  assert.equal(successExecutions, 1);
  assert.equal(body.jobHistory.length, 4);
  assert.equal(body.jobs.length, 3);
  assert.deepEqual(body.successes.map(row => [row.platform,row.revision]), [['rocket_now','5']]);
  assert.equal(Date.parse(body.successes[0].completed_at), Date.parse('2026-10-20T01:30:00Z'));
  for (const [id] of excluded) {
    assert.ok(!body.jobHistory.some(job => job.id === id), `${id} cannot masquerade as full publication history`);
    assert.ok(!body.jobs.some(job => job.id === id), `${id} cannot replace the current platform publication`);
  }
  assert.doesNotMatch(JSON.stringify(body), /SHOULD NEVER APPEAR|999/);
  const rocket = body.jobs.find(job => job.id === 'rocket').progress;
  assert.equal(rocket.targetName, option.name);
  assert.equal(rocket.targetKind, 'option');
  assert.equal(rocket.parentName, group.name);
  assert.equal(rocket.telemetryVersion, 2);
  assert.equal(rocket.checkedTargets, 323);
  assert.equal(rocket.totalTargets, 323);
  assert.equal(rocket.skippedTargets, 322);
  assert.equal(rocket.contentChanges, 1);
  assert.equal(rocket.contentCompleted, 1);
  assert.equal(rocket.writeRequestsCompleted, 1);
  assert.equal(rocket.readRequestsCompleted, 55);
  assert.equal(rocket.recent[0].targetName, item.name);
  assert.equal(rocket.recent[0].parentName, category.name);
  const demae = body.jobs.find(job => job.id === 'demae').progress;
  assert.equal(demae.targetName, item.name);
  assert.equal(demae.parentName, undefined);
  const global = body.jobs.find(job => job.id === 'global').progress;
  assert.equal(global.targetName, undefined);
  assert.equal(global.targetKind, undefined);
  assert.equal(global.recent[0].targetName, option.name);
  assert.equal(body.jobHistory.find(job => job.id === 'historical').progress.targetName, item.name);
  assert.doesNotMatch(JSON.stringify(body), /progressTargets|targetNames|authorityOperation|private-native-id|foreign/);
  console.log('PASS: actual GET Postgres SQL resolves exact current/recent context, distinguishes parent kinds, hides ambiguous parents, scopes full publication/capture history and success records, excludes same-source recovery/inventory commands, and preserves global reads.');
} finally {
  await db.close();
}
