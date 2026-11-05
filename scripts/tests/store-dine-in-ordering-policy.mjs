// Pure menu policy regression: no credentials, database, network, or production writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => { if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]); return out; }, []));
const source = resolve(args.source || process.cwd()), require = createRequire(resolve(source, 'package.json'));
const ts = require('typescript'), cache = new Map();
function load(path) {
  const file = resolve(source, path); if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(js, { exports, structuredClone, Date, require: name => name.startsWith('.') ? load(resolve(dirname(file), name) + '.ts') : require(name) }, { filename: file });
  return exports;
}
const policy = load('lib/store-dine-in-menu-policy.ts'), review = load('lib/store-dine-in-source-review.ts');
const clone = value => JSON.parse(JSON.stringify(value));
let sequence = 8000; const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
const brand = uuid(), category = { id: uuid(), brandId: brand, name: '料理', sortOrder: 100 }, drinks = { id: uuid(), brandId: brand, name: '飲み物', sortOrder: 200 };
const bowl = { id: uuid(), sourceItemId: uuid(), sourceName: '基本麻辣湯', brandId: brand, brandName: 'まぁ麻', name: '基本麻辣湯', displayNames: {}, itemKind: 'buildable_product', category: category.name, imageUrl: '', basePrice: 0, priceOverride: null, price: 0, variableSchema: { allowed_flavor: ['old-only'] }, posPricingMode: 'weight', posPricingOverride: 'weight', posWeightUnit: 'g', posWeightUnitPrice: 4, productionType: 'bowl', sortOrder: 100, visible: true, optionGroupIds: [] };
const drink = { ...clone(bowl), id: uuid(), sourceItemId: uuid(), name: '烏龍茶', sourceName: '烏龍茶', itemKind: 'drink', category: drinks.name, basePrice: 300, price: 300, variableSchema: { storeDineInOnly: true }, posPricingMode: 'fixed', posPricingOverride: 'fixed', productionType: 'drink', sortOrder: 200, visible: false, optionGroupIds: [] };
const option = (name, price, index) => ({ id: uuid(), sourceOptionId: uuid(), sourceName: name, sourceGroupId: '', sourceGroupName: '', optionKey: name, applicableCategories: [], name, displayNames: {}, priceDelta: price, sortOrder: index, visible: true });
const group = { id: uuid(), sourceGroupId: uuid(), sourceName: '味', brandId: brand, menuCatalogItemId: bowl.id, applicableCategories: [], groupKey: 'flavor', name: '味', displayNames: {}, selectionType: 'single', ruleJson: { minSelections: 1, maxSelections: 1, limit: 1, portionGrams: 50 }, sortOrder: 0, posEnabled: true, visible: true, options: [option('麻辣味', 0, 0), option('酸辣味', 50, 1)] };
for (const entry of group.options) { entry.sourceGroupId = group.sourceGroupId; entry.sourceGroupName = group.name; }
bowl.optionGroupIds = [group.id];
const base = { version: 1, items: [bowl, drink], categories: [category, drinks], optionGroups: [group] };
const context = { brandId: brand, brandName: 'まぁ麻', source: clone(base), weightPricing: { unit: 'g', unitPrice: 4 } };
const command = fields => policy.parseDineInChange({ operationId: uuid(), revision: '1', ...fields });
const apply = (catalog, fields) => policy.applyDineInChange(catalog, command(fields), uuid, context);
const checks = []; function check(name, run) { run(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
check('strict-reorder-complete-siblings-preserve-hidden-price-and-source', () => {
  const next = apply(base, { action: 'reorder', kind: 'item', ids: [drink.id, bowl.id] });
  assert.deepEqual(clone(next.items.map(item => [item.id, item.sortOrder])), [[drink.id, 0], [bowl.id, 1]]);
  assert.equal(next.items[0].visible, false); assert.equal(next.items[0].price, 300); assert.equal(next.items[1].posWeightUnitPrice, 4);
  assert.throws(() => apply(base, { action: 'reorder', kind: 'item', ids: [bowl.id] }));
  assert.throws(() => command({ action: 'reorder', kind: 'item', ids: [bowl.id, bowl.id] }));
  assert.throws(() => command({ action: 'reorder', kind: 'category', ids: [], targetId: bowl.id }));
  const categories = apply(base, { action: 'reorder', kind: 'category', ids: [drinks.id, category.id] }); assert.equal(categories.categories[0].id, drinks.id);
  assert.deepEqual(clone(base.items.map(item => item.id)), [bowl.id, drink.id]);
});
check('per-product-group-order-does-not-reorder-shared-consumer', () => {
  const catalog = clone(base), second = { ...clone(group), id: uuid(), menuCatalogItemId: '', options: [] };
  catalog.optionGroups.push(second); catalog.items[0].optionGroupIds.push(second.id); catalog.items[1].optionGroupIds = [group.id, second.id];
  const next = apply(catalog, { action: 'reorder', kind: 'group', targetId: bowl.id, ids: [second.id, group.id] });
  assert.deepEqual(clone(next.items[0].optionGroupIds), [second.id, group.id]); assert.deepEqual(clone(next.items[1].optionGroupIds), [group.id, second.id]);
  const choices = apply(catalog, { action: 'reorder', kind: 'option', targetId: group.id, ids: [...group.options].reverse().map(option => option.id) });
  assert.equal(choices.optionGroups[0].options[0].priceDelta, 50); assert.equal(choices.optionGroups[0].options[0].sortOrder, 0);
});
check('hidden-item-restores-without-new-identity-or-price-change', () => {
  const hidden = apply(base, { action: 'setVisibility', kind: 'item', targetId: bowl.id, visible: false });
  const shown = apply(hidden, { action: 'setVisibility', kind: 'item', targetId: bowl.id, visible: true });
  assert.deepEqual(clone(shown), clone(base)); assert.equal(hidden.items[0].visible, false);
});
check('archive-and-restore-retain-full-product-graph-and-source-review-baseline', () => {
  const catalog = clone(base); catalog.sourceReview = { version: 1, baseline: { [`item:${bowl.id}`]: { sourceId: bowl.sourceItemId, fields: { name: { name: 'old acknowledged' } } } }, decisions: [] };
  const removed = apply(catalog, { action: 'delete', kind: 'item', targetId: bowl.id });
  assert.equal(removed.items.length, 1); assert.equal(removed.optionGroups.length, 0); assert.equal(removed.trash[0].payload.optionGroups[0].ruleJson.portionGrams, 50);
  const pruned = review.pruneDineInSourceReview(removed); assert.equal(pruned.sourceReview.baseline[`item:${bowl.id}`], undefined);
  const restored = apply(pruned, { action: 'restore', targetId: removed.trash[0].id });
  assert.equal(restored.items.find(item => item.id === bowl.id).posWeightUnitPrice, 4); assert.equal(restored.optionGroups[0].options[1].priceDelta, 50);
  assert.equal(restored.sourceReview.baseline[`item:${bowl.id}`].fields.name.name, 'old acknowledged'); assert.equal(restored.trash.length, 0);
  assert.throws(() => apply(restored, { action: 'restore', targetId: removed.trash[0].id }));
});
check('restore-reuses-surviving-shared-group-with-later-local-edits', () => {
  const catalog = clone(base); catalog.optionGroups[0].menuCatalogItemId = ''; catalog.items[1].optionGroupIds = [group.id];
  const removed = apply(catalog, { action: 'delete', kind: 'item', targetId: bowl.id }); removed.optionGroups[0].options[1].priceDelta = 999;
  const restored = apply(removed, { action: 'restore', targetId: removed.trash[0].id });
  assert.equal(restored.optionGroups.filter(row => row.id === group.id).length, 1); assert.equal(restored.optionGroups[0].options[1].priceDelta, 999);
});
check('archive-group-restores-attachments-and-option-restores-parent', () => {
  const active = clone(base); active.items[0].variableSchema = {};
  const removed = apply(active, { action: 'delete', kind: 'group', targetId: group.id }); assert.equal(removed.items[0].optionGroupIds.length, 0);
  const restored = apply(removed, { action: 'restore', targetId: removed.trash[0].id }); assert.deepEqual(clone(restored.items[0].optionGroupIds), [group.id]);
  const optionRemoved = apply(restored, { action: 'delete', kind: 'option', targetId: group.options[1].id });
  const optionRestored = apply(optionRemoved, { action: 'restore', targetId: optionRemoved.trash[0].id }); assert.equal(optionRestored.optionGroups[0].options[1].id, group.options[1].id);
  const parentMissing = clone(optionRemoved); parentMissing.optionGroups = []; assert.throws(() => apply(parentMissing, { action: 'restore', targetId: optionRemoved.trash[0].id }));
});
check('category-restore-does-not-reverse-explicit-product-moves', () => {
  const removed = apply(base, { action: 'delete', kind: 'category', targetId: category.id, replacementCategoryId: drinks.id });
  const restored = apply(removed, { action: 'restore', targetId: removed.trash[0].id });
  assert.equal(restored.items[0].category, drinks.name); assert.equal(restored.categories.some(row => row.id === category.id), true);
});
check('protected-flavor-whole-import-retains-rules-portions-price-and-separate-group', () => {
  const next = apply(base, { action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'brand', name: '味を選ぶ' });
  const copied = next.optionGroups.at(-1); assert.notEqual(copied.id, group.id); assert.equal(copied.localKind, 'imported');
  assert.equal(copied.groupKey, 'flavor'); assert.equal(copied.ruleJson.minSelections, 1); assert.equal(copied.ruleJson.portionGrams, 50); assert.equal(copied.options[1].priceDelta, 50);
  assert.equal(copied.options[1].sourceOptionId, group.options[1].sourceOptionId); assert.equal(copied.options[1].sourceGroupId, group.sourceGroupId); assert.equal(copied.menuCatalogItemId, bowl.id);
  assert.equal(next.optionGroups[0].name, group.name); assert.equal(base.optionGroups.length, 1);
  assert.equal(policy.getDineInAddonCandidates(base, bowl.id, undefined, base).length, 0);
});
check('group-import-subsets-are-explicit-and-minimum-capacity-checked', () => {
  const next = apply(base, { action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'store', optionIds: [group.options[1].id] });
  assert.equal(next.optionGroups.at(-1).options.length, 1); assert.equal(next.optionGroups.at(-1).options[0].priceDelta, 50);
  const catalog = clone(base); catalog.optionGroups[0].selectionType = 'multiple'; catalog.optionGroups[0].ruleJson.minSelections = 2;
  assert.throws(() => apply(catalog, { action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'store', optionIds: [group.options[0].id] }));
  assert.throws(() => command({ action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'brand', optionIds: [] }));
});
check('noodle-quantity-rules-support-repeated-portions-and-preserve-specification', () => {
  const catalog = clone(base); catalog.optionGroups[0].groupKey = 'noodle-addition'; catalog.optionGroups[0].sourceName = '面类';
  const next = apply(catalog, { action: 'setGroupSelection', targetId: group.id, selectionType: 'quantity', minSelections: 0, maxSelections: 9, perOptionMax: 3 });
  assert.deepEqual(clone(next.optionGroups[0].ruleJson), { minSelections: 0, maxSelections: 9, limit: 9, portionGrams: 50, allowRepeat: true, perOptionMax: 3 });
  assert.equal(next.optionGroups[0].options[1].priceDelta, 50);
});
check('renamed-heat-and-numb-source-groups-cannot-become-repeatable', () => {
  for (const key of ['heat', 'heat-level', 'numb']) {
    const catalog = clone(base); catalog.optionGroups[0].groupKey = key; catalog.optionGroups[0].sourceName = '元の選択'; catalog.optionGroups[0].name = '変更した名前';
    assert.throws(() => apply(catalog, { action: 'setGroupSelection', targetId: group.id, selectionType: 'quantity', minSelections: 0, maxSelections: 3, perOptionMax: 3 }));
  }
  assert.throws(() => command({ action: 'setGroupSelection', targetId: group.id, selectionType: 'single', minSelections: 0, maxSelections: 3, perOptionMax: 1 }));
  assert.throws(() => command({ action: 'setGroupSelection', targetId: group.id, selectionType: 'multiple', minSelections: 0, maxSelections: 3, perOptionMax: 2 }));
});
function linkFixture() {
  const catalog = apply(base, { action: 'createOptionGroup', itemId: bowl.id, name: '一緒に飲む', selectionType: 'quantity' });
  return apply(catalog, { action: 'linkItemOptions', targetId: catalog.optionGroups.at(-1).id, itemIds: [drink.id] });
}
check('hidden-standalone-product-can-be-linked-with-real-product-reference', () => {
  const next = linkFixture(), linked = next.optionGroups.at(-1).options[0];
  assert.equal(linked.linkedItemId, drink.id); assert.equal(linked.sourceOptionId, ''); assert.equal(linked.priceDelta, 300); assert.equal(next.items.find(item => item.id === drink.id).visible, false);
  assert.equal(policy.getDineInAddonCandidates(next, bowl.id).some(candidate => candidate.option.linkedItemId), false);
  assert.throws(() => apply(next, { action: 'linkItemOptions', targetId: next.optionGroups.at(-1).id, itemIds: [drink.id] }));
});
check('linked-label-and-price-follow-product-and-cannot-edit-as-independent-option', () => {
  let next = linkFixture(); const linkedId = next.optionGroups.at(-1).options[0].id;
  next = apply(next, { action: 'setItemPrice', targetId: drink.id, price: 450 }); next = apply(next, { action: 'rename', kind: 'item', targetId: drink.id, name: '黒烏龍茶' });
  assert.equal(next.optionGroups.at(-1).options[0].priceDelta, 450); assert.equal(next.optionGroups.at(-1).options[0].name, '黒烏龍茶');
  assert.throws(() => apply(next, { action: 'setOptionPrice', targetId: linkedId, price: 1 })); assert.throws(() => apply(next, { action: 'rename', kind: 'option', targetId: linkedId, name: '別名' }));
  const projection = review.buildDineInSourceReview(next, { canonical: clone(base), effective: clone(base), sourceRevision: 'a'.repeat(32) });
  const entry = projection.entries.find(entry => entry.kind === 'option' && entry.targetId === linkedId); assert.equal(entry.status, 'localOnly'); assert.equal(entry.pending, false);
});
check('linked-choices-reject-bowl-required-configuration-and-cross-brand-products', () => {
  const catalog = linkFixture(), target = catalog.optionGroups.at(-1).id;
  assert.throws(() => apply(catalog, { action: 'linkItemOptions', targetId: target, itemIds: [bowl.id] }));
  const required = clone(catalog); required.items[1].optionGroupIds = [group.id]; assert.throws(() => apply(required, { action: 'linkItemOptions', targetId: target, itemIds: [drink.id] }));
  const other = clone(catalog); other.items[1].brandId = uuid(); assert.throws(() => apply(other, { action: 'linkItemOptions', targetId: target, itemIds: [drink.id] }));
});
check('parser-rejects-forged-values-extra-fields-and-invalid-numeric-types', () => {
  for (const fields of [
    { action: 'restore', targetId: uuid(), payload: base },
    { action: 'linkItemOptions', targetId: group.id, itemIds: [drink.id], price: 0 },
    { action: 'setGroupSelection', targetId: group.id, selectionType: 'quantity', minSelections: 0, maxSelections: '9', perOptionMax: 3 },
    { action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'brand', catalog: base }
  ]) assert.throws(() => command(fields));
});
check('source-review-rules-match-local-single-type-and-retain-heat-invariant', () => {
  const canonical = clone(base); canonical.optionGroups[0].groupKey = 'topping'; canonical.optionGroups[0].sourceName = '食材';
  const local = policy.localizeDineInCatalog(canonical, uuid), ctx = { canonical: clone(canonical), effective: clone(canonical), sourceRevision: 'a'.repeat(32) };
  ctx.canonical.optionGroups[0].selectionType = 'single'; ctx.canonical.optionGroups[0].ruleJson = { minSelections: 2, maxSelections: 2, limit: 2 };
  let entry = review.buildDineInSourceReview(local, ctx).entries.find(entry => entry.kind === 'group' && entry.status === 'linked');
  assert.equal(entry.fields.find(field => field.field === 'rules').canAdopt, false);
  local.optionGroups[0].groupKey = 'heat'; ctx.canonical.optionGroups[0].selectionType = 'quantity';
  entry = review.buildDineInSourceReview(local, ctx).entries.find(entry => entry.kind === 'group' && entry.status === 'linked');
  assert.equal(entry.fields.find(field => field.field === 'rules').canAdopt, false);
});
check('mandatory-quantity-delete-hide-and-import-respect-per-option-capacity', () => {
  const catalog = clone(base); catalog.items[0].variableSchema = {}; catalog.optionGroups[0].selectionType = 'quantity';
  catalog.optionGroups[0].ruleJson = { minSelections: 2, maxSelections: 2, limit: 2, allowRepeat: false, perOptionMax: 2, portionGrams: 50 };
  assert.throws(() => apply(catalog, { action: 'delete', kind: 'option', targetId: group.options[1].id }));
  assert.throws(() => apply(catalog, { action: 'setVisibility', kind: 'option', targetId: group.options[1].id, visible: false }));
  assert.throws(() => apply(catalog, { action: 'importOptionGroup', itemId: bowl.id, sourceGroupId: group.id, origin: 'store', optionIds: [group.options[0].id] }));
  catalog.optionGroups[0].ruleJson.allowRepeat = true; catalog.optionGroups[0].ruleJson.perOptionMax = 1;
  assert.throws(() => apply(catalog, { action: 'delete', kind: 'option', targetId: group.options[1].id }));
  assert.throws(() => apply(catalog, { action: 'setVisibility', kind: 'option', targetId: group.options[1].id, visible: false }));
  catalog.optionGroups[0].ruleJson.perOptionMax = 2;
  assert.equal(apply(catalog, { action: 'delete', kind: 'option', targetId: group.options[1].id }).optionGroups[0].options.length, 1);
});
const files = ['lib/store-dine-in-menu-policy.ts', 'lib/store-dine-in-menu.ts', 'lib/store-dine-in-source-review.ts', 'lib/dine-in-option-selection.ts', 'scripts/tests/store-dine-in-ordering-policy.mjs'];
const sourceHashes = Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(resolve(source, path))).digest('hex')]));
const report = { passed: true, checkCount: checks.length, checks, source, sourceHashes, liveWrites: 0, externalCalls: 0 };
if (args.output) { mkdirSync(resolve(args.output), { recursive: true }); writeFileSync(resolve(args.output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ passed: true, checkCount: checks.length }));
