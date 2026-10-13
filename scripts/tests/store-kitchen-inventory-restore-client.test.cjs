// Exercise the actual Kitchen client functions with local state and fake fetch.
// No browser, database, platform command or live inventory is accessed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const pagePath = 'app/store/display/kitchen/page.tsx';
const pageSource = fs.readFileSync(pagePath, 'utf8');
const parsed = ts.createSourceFile(pagePath, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name) {
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, `Exactly one production ${name} function must be exercised`);
  return matches[0];
}
const compiled = ts.transpileModule(`${actualFunction('registerInventoryCommands')}\n${actualFunction('restoreInventoryItem')}\nexports.restoreInventoryItem=restoreInventoryItem;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const json = value => JSON.parse(JSON.stringify(value));
const optionId = '93e394ea-4f83-4f93-aee7-6de813e8e2ca';
const itemId = 'bec959c7-f887-49ba-84c5-cb9626d6922b';
const row = (kind = 'option', patch = {}) => ({
  inventoryKey: `${kind}:${kind === 'option' ? optionId : itemId}`,
  ingredientLabel: '1杯', targetKind: kind, brandId: 'brand-a',
  targets: [{ kind, targetId: kind === 'option' ? optionId : itemId, label: '1杯', isAvailable: false }], ...patch
});

function harness({ body = { commandId: 'command-a' }, status = 200, restoringKey = '', malformedBody = false, networkError } = {}) {
  const requests = [], events = [];
  const state = { sync: { 'unrelated-row': { status: 'succeeded' } }, listError: '', restoringKey };
  const context = {
    exports: {}, selectedStoreId: 'store-a', inventoryRestoringKey: restoringKey,
    inventoryCommandByIdRef: { current: {} }, t: value => value,
    setInventoryRestoringKey: value => { events.push(['restoring', value]); state.restoringKey = value; context.inventoryRestoringKey = value; },
    setInventoryListError: value => { events.push(['error', value]); state.listError = value; },
    setInventorySyncByKey: updater => { state.sync = updater(state.sync); },
    fetch: async (url, options) => {
      requests.push({ url, method: options.method, headers: json(options.headers), body: JSON.parse(options.body) });
      if (networkError) throw networkError;
      return { ok: status >= 200 && status < 300, json: async () => { if (malformedBody) throw Error('synthetic invalid JSON'); return body; } };
    }
  };
  vm.runInNewContext(compiled, context, { filename: `${pagePath}:isolated-restore`, timeout: 1000 });
  return { restore: context.exports.restoreInventoryItem, requests, events, state, context };
}

for (const kind of ['item', 'option']) test(`Kitchen restores only the exact selected ${kind} ID, not a name or shared ingredient key`, async () => {
  const h = harness(), selected = row(kind);
  const original = json(selected);
  await h.restore(selected);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0], {
    url: '/api/store/display/kitchen/inventory', method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: { action: 'apply', storeId: 'store-a', brandId: 'brand-a', ingredientLabel: '1杯', targetKind: kind,
      targetId: kind === 'option' ? optionId : itemId, isAvailable: true }
  });
  assert.deepEqual(selected, original);
  assert.equal(h.state.sync[selected.inventoryKey].status, 'pending');
  assert.equal(h.state.restoringKey, '');
});

for (const [label, targets] of [
  ['empty', []], ['multiple', [row().targets[0], { ...row().targets[0], targetId: itemId }]],
  ['contradicting kind', [{ ...row().targets[0], kind: 'item' }]],
  ['missing exact ID', [{ ...row().targets[0], targetId: '' }]]
]) test(`Kitchen rejects ${label} restore identities before any request or progress binding`, async () => {
  const h = harness();
  await h.restore(row('option', { targets }));
  assert.deepEqual(h.requests, []);
  assert.equal(h.state.listError, '画面を更新して商品を選び直してください。');
  assert.equal(h.events.some(([event]) => event === 'restoring'), false);
  assert.deepEqual(h.context.inventoryCommandByIdRef.current, {});
  assert.deepEqual(h.state.sync, { 'unrelated-row': { status: 'succeeded' } });
});

test('a shared response inventory key cannot disconnect progress from the selected exact-ID row', async () => {
  const selected = row(), sharedKey = 'option:shared-recipe-ingredient';
  const commands = ['uber_eats', 'rocket_now', 'demae_can'].map((platform, index) => ({ id: `command-${index}`, platform }));
  const h = harness({ body: { commandId: commands[0].id, inventoryKey: sharedKey, commands,
    targets: [{ kind: 'option', targetId: optionId }, { kind: 'item', targetId: itemId }] } });
  await h.restore(selected);
  assert.equal(h.requests[0].body.targetId, optionId);
  assert.equal(h.state.sync[sharedKey], undefined);
  assert.deepEqual(json(h.state.sync[selected.inventoryKey]), {
    commandIds: commands.map(command => command.id), status: 'pending',
    platforms: Object.fromEntries(commands.map(command => [command.platform, { commandId: command.id, status: 'pending' }]))
  });
  for (const command of commands) assert.deepEqual(json(h.context.inventoryCommandByIdRef.current[command.id]),
    { inventoryKey: selected.inventoryKey, platform: command.platform });
  assert.deepEqual(h.state.sync['unrelated-row'], { status: 'succeeded' });
  assert.equal(h.state.restoringKey, '');
});

test('while another restore is pending the client does not send a second operation', async () => {
  const h = harness({ restoringKey: 'already-restoring' });
  await h.restore(row());
  assert.deepEqual(h.requests, []);assert.deepEqual(h.events, []);
  assert.equal(h.state.restoringKey, 'already-restoring');
});

test('a network failure releases the busy row but neither retries nor invents success for the uncertain operation', async () => {
  const h = harness({ networkError: new TypeError('synthetic network disconnect after request') });
  const selected = row(), original = json(selected);
  await h.restore(selected);
  assert.equal(h.requests.length, 1, 'The uncertain write must not be automatically sent again');
  assert.equal(h.requests[0].body.targetId, optionId);
  assert.equal(h.state.restoringKey, '');
  assert.equal(h.state.listError, '販売状態を確認できません。画面を更新して結果を確認してください。');
  assert.deepEqual(h.context.inventoryCommandByIdRef.current, {});
  assert.deepEqual(h.state.sync, { 'unrelated-row': { status: 'succeeded' } });
  assert.deepEqual(selected, original, 'A failed network response does not prove inventory changed');
  assert.deepEqual(h.events.filter(([event]) => event === 'restoring'), [['restoring', selected.inventoryKey], ['restoring', '']]);
});

for (const [label, config, expected] of [
  ['HTTP rejection', { status: 409, body: { error: 'Exact target was removed' } }, 'Exact target was removed'],
  ['missing command receipt', { body: { inventoryKey: 'shared' } }, '販売再開を送信できませんでした。'],
  ['invalid response JSON', { malformedBody: true }, '販売再開を送信できませんでした。']
]) test(`Kitchen ${label} does not invent successful progress or leave the row marked restoring`, async () => {
  const h = harness(config);
  await h.restore(row());
  assert.equal(h.requests.length, 1);assert.equal(h.state.listError, expected);assert.equal(h.state.restoringKey, '');
  assert.deepEqual(h.context.inventoryCommandByIdRef.current, {});
  assert.deepEqual(h.state.sync, { 'unrelated-row': { status: 'succeeded' } });
});
