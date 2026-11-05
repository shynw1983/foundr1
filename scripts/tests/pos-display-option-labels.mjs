// Exercise the actual POS projections with all persistence and printer adapters intercepted.
// This never imports the application runtime, contacts a service, or prints a document.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const args = Object.fromEntries(process.argv.slice(2).reduce((result, value, index, values) => {
  if (value.startsWith('--')) result.push([value.slice(2), values[index + 1]]);
  return result;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-display-option-labels');
const baseline = args.baseline ? resolve(args.baseline) : null;
const require = createRequire(join(source, 'package.json'));
const ts = require('typescript');
const file = 'app/store/pos/StorePosWorkspace.tsx';
const copyFile = 'lib/pos-pickup-ticket-copy.ts';
const checks = [], sources = {};
const hash = text => createHash('sha256').update(text).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const functionNames = [
  'getCustomerDisplayOptionLabel', 'getLocalizedDisplayName', 'getCustomerDisplayItems',
  'createReceiptPrintPayload', 'createKitchenPrintPayload', 'printCheckoutDocuments',
  'getLineBasePrice', 'getLineUnitPrice', 'getWeightLineLabel', 'getPaymentDisplayLabel',
  'absolutizeReceiptTemplateMedia', 'getStoreReceiptPrinter', 'getOptionLabel',
  'formatYen', 'getItemPrice', 'getOptionPrice'
];

async function extract(root, label) {
  const text = await readFile(join(root, file), 'utf8');
  const copyText = await readFile(join(root, copyFile), 'utf8');
  sources[label] = { root, files: { [file]: hash(text), [copyFile]: hash(copyText) } };
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map(), calls = [];
  let weighing;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && functionNames.includes(node.name.text)) {
      assert.ok(!functions.has(node.name.text), `Ambiguous function ${node.name.text}`);
      functions.set(node.name.text, node.getText(tree));
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'weighing' && node.initializer) {
      assert.ok(!weighing, 'Ambiguous weighing projection');
      weighing = node.initializer.getText(tree);
    }
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'getCustomerDisplayOptionLabel') {
      let parent = node.parent;
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
      calls.push({ caller: parent?.name?.text || '', line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, arguments: node.arguments.map(arg => arg.getText(tree)) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(functions.size, functionNames.length);
  assert.ok(weighing, 'Actual weighing projection is required');
  const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const copyContext = vm.createContext({ exports: {} });
  vm.runInContext(transpile(copyText), copyContext);
  const compiled = transpile([...functions.values()].join('\n') + '\nfunction projectWeighing() { return ' + weighing + '; }');
  return { compiled, calls, pickupCopy: copyContext.exports.posPickupTicketCopy };
}

const mild = { id: 'mild', groupId: 'heat', groupKey: 'heat', groupName: '辛さ', groupDisplayNames: { en: 'Heat', zh: '辣度' }, name: '小辛', displayNames: { en: 'Mild', zh: '微辣' }, priceDelta: 0 };
const tendon = { id: 'tendon', groupId: 'addons', groupKey: 'topping', groupName: '追加トッピング', groupDisplayNames: { en: 'Add-ons', zh: '加料' }, name: '牛すじ 50g', displayNames: { en: 'Beef tendon 50g', zh: '牛筋 50g' }, priceDelta: 500 };
const selected = [mild, tendon, { ...tendon }];
const bowl = { id: 'bowl', name: '麻辣湯', displayNames: { en: 'Malatang', zh: '麻辣烫' }, brandId: 'maamaa', brandName: 'まぁ麻', selectedOptions: selected, quantity: 1, measuredQuantity: 220, measuredUnit: 'g', measuredUnitPrice: 4, optionTotal: 1000, basePrice: 4, preparationNote: '別皿' };
const receiptTemplate = { logoUrl: '', promotionImageUrl: '', receiptTitle: 'レシート', invoiceTitle: '領収書', invoiceRecipientName: '', invoicePurposeText: '' };
const printer = { connectionType: 'tcp', identifier: 'fixture-printer', openCashDrawer: true };
const total = 1880;
const body = { orderId: 'fixture-order', pickupCode: 'A01', orderType: 'dine_in', paymentMethod: 'cash', subtotalAmount: total, discountAmount: 0, couponDiscountAmount: 0, taxAmount: 139, taxRate: 8, amount: total, cashTenderedAmount: 2000, cashChangeAmount: 120, servingTickets: [{ itemIndex: 0, itemId: 'fixture-item', pickupCode: 'A01' }] };
function fixture(code, cart = [bowl]) {
  const effects = { savedBatches: [], sentBatches: [], refreshes: 0, forbidden: [] };
  const forbidden = name => () => { effects.forbidden.push(name); throw new Error(`Unexpected external call: ${name}`); };
  const context = vm.createContext({
    URL, window: { location: { origin: 'https://isolated.test' } },
    cart: plain(cart), selectedStoreId: 'fixture-store', stores: [{ id: 'fixture-store', name: 'テスト店' }],
    posSettings: { priceTaxMode: 'tax_included', externalPaymentTerminalBrand: '端末', printerSettings: { enabled: true, kitchenEnabled: true, receiptEnabled: true, receiptTemplate } },
    orderType: 'dine_in', paymentMethod: 'cash', note: '', receiptRequested: false,
    subtotal: total, posDiscountAmount: 0, couponDiscountAmount: 0, taxSummary: { taxAmount: 139 }, taxRate: 8, payableAmount: total, cashTenderedValue: 2000,
    getReceiptPrinter: () => plain(printer), isPrintablePrinter: () => true,
    createAutoStarBluetoothPrinter: forbidden('createAutoStarBluetoothPrinter'),
    resolvePosReceiptTemplate: () => plain(receiptTemplate),
    resolvePosKitchenTicketTemplate: () => ({ blockStyles: { pickup: {} } }),
    getKitchenPrinterForBrand: () => plain(printer), hasPosPrinterDestination: () => true,
    posPickupTicketCopy: code.pickupCopy, debugMode: false,
    listPosPrintJobs: async () => [], savePosPrintBatch: async jobs => { effects.savedBatches.push(plain(jobs)); },
    runPosPrintJobs: async jobs => { effects.sentBatches.push(plain(jobs)); },
    savePosPrintJob: forbidden('savePosPrintJob'), printWithAndroidBridge: forbidden('printWithAndroidBridge'),
    printKitchenAfterCheckout: forbidden('printKitchenAfterCheckout'), printReceiptAfterCheckout: forbidden('printReceiptAfterCheckout'),
    refreshPrintJobs: async () => { effects.refreshes += 1; }, relay: { refresh: forbidden('relay.refresh') },
    fetch: forbidden('fetch'),
    weightPricing: { unitPrice: 4, unit: 'g' }, configuringItem: plain(bowl), weighingPreviewId: 'fixture-preview',
    selectedOptions: plain(selected), customerDisplayLanguage: 'ja', ready: true, manual: true, quantity: 220, optionsAmount: 1000, measurement: undefined, scaleCapture: undefined
  });
  vm.runInContext(code.compiled, context);
  return { context, effects };
}
function normalizeBatch(value) {
  return JSON.parse(JSON.stringify(value, (key, field) => ['printedAt', 'createdAt'].includes(key) ? '<timestamp>' : field));
}
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); }
}

await mkdir(output, { recursive: true });
const current = await extract(source, 'current');
const previous = baseline ? await extract(baseline, 'baseline') : null;
await check('actual call sites opt out of group names only for cart and weighing screens', () => {
  assert.equal(current.calls.length, 5);
  const printCalls = current.calls.filter(call => ['createReceiptPrintPayload', 'createKitchenPrintPayload', 'printCheckoutDocuments'].includes(call.caller));
  assert.equal(printCalls.length, 3);
  assert.ok(printCalls.every(call => call.arguments.length === 2));
  const screenCalls = current.calls.filter(call => !printCalls.includes(call));
  assert.equal(screenCalls.length, 2);
  assert.ok(screenCalls.every(call => call.arguments[2] === 'false'));
  assert.ok(screenCalls.some(call => call.caller === 'getCustomerDisplayItems'));
});

const expected = { ja: '小辛 / 牛すじ 50g x2', en: 'Mild / Beef tendon 50g x2', zh: '微辣 / 牛筋 50g x2' };
const grouped = { ja: '辛さ: 小辛 / 追加トッピング: 牛すじ 50g x2', en: 'Heat: Mild / Add-ons: Beef tendon 50g x2', zh: '辣度: 微辣 / 加料: 牛筋 50g x2' };
for (const language of ['ja', 'en', 'zh']) {
  await check(`${language}: actual cart projection shows option values and repetitions while retaining quantity and price`, () => {
    const { context, effects } = fixture(current);
    const projected = plain(context.getCustomerDisplayItems(language));
    assert.equal(projected[0].optionLabel, expected[language]);
    assert.equal(projected[0].quantity, 1); assert.equal(projected[0].measuredQuantity, 220);
    assert.equal(projected[0].unitPrice, total); assert.equal(projected[0].amount, total);
    assert.deepEqual(plain(context.cart[0].selectedOptions), selected);
    assert.deepEqual(effects.forbidden, []);
  });
  await check(`${language}: actual manual, automatic and waiting weighing projections all omit group names`, () => {
    const { context } = fixture(current);
    context.customerDisplayLanguage = language;
    for (const mode of ['manual', 'automatic', 'waiting']) {
      context.manual = mode === 'manual'; context.ready = mode !== 'waiting';
      context.scaleCapture = mode === 'automatic' ? { id: 'capture' } : undefined;
      const preview = plain(context.projectWeighing());
      assert.equal(preview.optionLabel, expected[language]);
      assert.equal(preview.source, mode === 'automatic' ? 'capture' : mode);
      assert.equal(preview.optionsAmount, 1000); assert.equal(preview.unitPrice, 4);
      assert.equal(preview.quantity, mode === 'waiting' ? null : 220);
      assert.equal(preview.amount, mode === 'waiting' ? null : total);
    }
  });
  await check(`${language}: actual checkout batch preserves group labels in receipt, kitchen, finishing and pickup documents`, async () => {
    const runtime = fixture(current);
    await runtime.context.printCheckoutDocuments({ ...body, memberLanguage: language }, plain([bowl]));
    assert.equal(runtime.effects.savedBatches.length, 1); assert.equal(runtime.effects.sentBatches.length, 1);
    const jobs = runtime.effects.savedBatches[0];
    assert.deepEqual(jobs.map(job => job.kind), ['kitchen', 'finishing', 'pickup', 'receipt']);
    for (const job of jobs) {
      const item = job.payload.order.items[0];
      const documentLanguage = job.kind === 'pickup' ? language : 'ja';
      assert.deepEqual(item.options.slice(1), grouped[documentLanguage].split(' / '));
      assert.equal(item.options[0], '220g x ¥4/g');
    }
    assert.equal(jobs.find(job => job.kind === 'receipt').payload.order.totalAmount, total);
    assert.equal(jobs.find(job => job.kind === 'receipt').payload.order.cashChangeAmount, 120);
    assert.deepEqual(runtime.effects.forbidden, []);
    if (previous) {
      const oldRuntime = fixture(previous);
      await oldRuntime.context.printCheckoutDocuments({ ...body, memberLanguage: language }, plain([bowl]));
      assert.deepEqual(normalizeBatch(jobs), normalizeBatch(oldRuntime.effects.savedBatches[0]));
    }
  });
}

await check('missing requested translation falls back to English, then Japanese source, never to unrelated Chinese', () => {
  const { context } = fixture(current);
  const options = [
    { ...mild, displayNames: { en: 'Mild' } },
    { ...tendon, displayNames: { zh: '牛筋 50g' } }
  ];
  context.cart[0].selectedOptions = plain(options);
  context.selectedOptions = plain(options);
  for (const language of ['en', 'ko', 'vi']) {
    assert.equal(context.getCustomerDisplayItems(language)[0].optionLabel, 'Mild / 牛すじ 50g');
    context.customerDisplayLanguage = language;
    assert.equal(context.projectWeighing().optionLabel, 'Mild / 牛すじ 50g');
  }
  assert.equal(context.getCustomerDisplayItems('ja')[0].optionLabel, '小辛 / 牛すじ 50g');
});
await check('same option ID in different groups remains separate and punctuation inside an option name is preserved', () => {
  const { context } = fixture(current);
  context.cart[0].selectedOptions = [
    { ...tendon, id: 'shared', groupId: 'first', name: '青梅: ソーダ', displayNames: { en: 'Plum: soda' } },
    { ...tendon, id: 'shared', groupId: 'first', name: '青梅: ソーダ', displayNames: { en: 'Plum: soda' } },
    { ...tendon, id: 'shared', groupId: 'second', name: '青梅: ソーダ', displayNames: { en: 'Plum: soda' } }
  ];
  assert.equal(context.getCustomerDisplayItems('ja')[0].optionLabel, '青梅: ソーダ x2 / 青梅: ソーダ');
  assert.equal(context.getCustomerDisplayItems('en')[0].optionLabel, 'Plum: soda x2 / Plum: soda');
});
await check('empty selections have no orphan punctuation and fixed-price items retain their original amount', () => {
  const { context } = fixture(current, [{ id: 'tea', name: 'お茶', quantity: 2, selectedOptions: [], optionTotal: 0, basePrice: 300 }]);
  const item = context.getCustomerDisplayItems('ja')[0];
  assert.equal(item.optionLabel, ''); assert.equal(item.amount, 600); assert.equal(item.weightLabel, '');
  context.selectedOptions = []; context.optionsAmount = 0;
  const preview = context.projectWeighing();
  assert.equal(preview.optionLabel, ''); assert.equal(preview.amount, 880);
});
await check('staff-facing option grouping remains unchanged', () => {
  const { context } = fixture(current);
  assert.equal(context.getOptionLabel(plain(selected)), grouped.ja);
  if (previous) assert.equal(context.getOptionLabel(plain(selected)), fixture(previous).context.getOptionLabel(plain(selected)));
});

const hashesAfter = {};
for (const [label, snapshot] of Object.entries(sources)) {
  hashesAfter[label] = Object.fromEntries(await Promise.all(Object.keys(snapshot.files).map(async path => [path, hash(await readFile(join(snapshot.root, path), 'utf8'))])));
}
await check('source files did not change during verification', () => {
  for (const [label, snapshot] of Object.entries(sources)) assert.deepEqual(hashesAfter[label], snapshot.files);
});
const report = { passed: checks.every(check => check.passed), createdAt: new Date().toISOString(), scope: 'Actual TypeScript AST-extracted POS cart, weighing and print projections; isolated VM adapters; no database, printer, device or network access.', baselinePrintComparison: Boolean(previous), sources, hashesAfter, callSites: current.calls, checks, summary: { total: checks.length, passed: checks.filter(check => check.passed).length } };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, passed: report.passed, report: join(output, 'report.json') }));
if (!report.passed) process.exitCode = 1;
