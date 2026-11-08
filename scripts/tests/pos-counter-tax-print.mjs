import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from 'react-dom/server';
      import { PosPrintContentPreview } from './app/os/pos/PosSavedPrintPreviews';
      import { OsTranslationProvider } from './app/os/components/OsTranslationProvider';
      export { posCheckoutPrintStatus } from './lib/pos-checkout-print-notice';
      export { buildPosPrintDocumentSnapshots } from './lib/pos-print-document-builder';
      export { buildRelayDocuments } from './lib/store-relay-documents';
      export { applyPosReceiptTaxBreakdown, normalizePosPrinterSettings } from './lib/pos-printer';
      export function renderPreview(payload) {
        return renderToStaticMarkup(<OsTranslationProvider><PosPrintContentPreview content={{ ...payload, paperWidth: '58mm' }} /></OsTranslationProvider>);
      }`,
    resolveDir: process.cwd(),
    loader: 'tsx'
  },
  bundle: true, write: false, outdir: '/virtual', platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'text' }, logLevel: 'silent'
});
const compiled = { exports: {} };
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
new Function('module', 'exports', 'require', javascript)(compiled, compiled.exports, createRequire(import.meta.url));
const { buildPosPrintDocumentSnapshots, buildRelayDocuments, applyPosReceiptTaxBreakdown, normalizePosPrinterSettings, renderPreview } = compiled.exports;

const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '192.0.2.10', port: 9100, paperWidth: '58mm' };
const settings = normalizePosPrinterSettings({
  enabled: true, receiptEnabled: true, receiptPrinter: printer, kitchenPrinter: printer,
  receiptTemplate: { showOrderNote: false }
});
const taxBreakdown = [{ rate: 8, grossAmount: 1300, taxAmount: 97 }, { rate: 10, grossAmount: 550, taxAmount: 50 }];
const sale = {
  pickupCode: '001', orderType: 'takeout', paymentMethod: 'cash', amount: 1850, subtotalAmount: 1850,
  discountAmount: 0, couponDiscountAmount: 0, taxRate: 0, taxAmount: 147, taxBreakdown,
  cashTenderedAmount: 2000, cashChangeAmount: 150, receiptRequested: false, note: '注文メモ', memberLanguage: 'ja'
};
const bowl = {
  fulfillmentMode: 'prepare', productionType: 'bowl', itemKind: 'buildable_product', brandId: 'maamaa', brandName: 'まぁ麻',
  name: '麻辣湯', quantity: 1, amount: 1350, measuredQuantity: 250, measuredUnit: 'g', preparationNote: '辛さ控えめ',
  selectedOptions: [
    { name: '牛筋', groupName: '追加', priceDelta: 100 },
    { name: '缶ビール', groupName: '飲み物', priceDelta: 250, counterStandardTax: true },
    { name: '無料トッピング', groupName: '特典', priceDelta: 0, complimentary: true }
  ]
};
const beer = { ...bowl, name: '瓶ビール', amount: 300, counterStandardTax: true, fulfillmentMode: 'immediate', productionType: 'drink', measuredQuantity: null, selectedOptions: [] };
const tea = { ...beer, name: 'ウーロン茶', amount: 200, counterStandardTax: false };
const tickets = [{ itemIndex: 0, pickupCode: '001' }];
const items = [bowl, beer, tea];
const documents = buildPosPrintDocumentSnapshots(settings, '桜並木店', sale, items, tickets, 'auto');
const relay = buildRelayDocuments(settings, '桜並木店', sale, items, tickets);
const receipts = [documents, relay].map(jobs => jobs.find(job => job.kind === 'receipt').payload);
const printedTax = '8%対象 ¥1,300 (内税 ¥97) / 10%対象 ¥550 (内税 ¥50) / ※軽減税率対象';

test('mixed tax uses immutable receipt payloads that both Android paths can print', () => {
  for (const receipt of receipts) {
    assert.deepEqual(receipt.order.taxBreakdown, taxBreakdown);
    assert.equal(receipt.order.taxRate, 0);
    assert.equal(receipt.order.taxAmount, 147);
    assert.equal(receipt.order.totalAmount, 1850);
    assert.equal(receipt.receiptTemplate.showOrderNote, true);
    assert.equal(receipt.order.note, printedTax);
    assert.equal(receipt.order.originalNote, '注文メモ');
    assert.deepEqual(receipt.order.items.map(item => item.name), ['001 ※麻辣湯', '瓶ビール', '※ウーロン茶']);
    assert.equal(receipt.order.items[0].amount, 1350);
    assert.match(receipt.order.items[0].options.join(' / '), /※牛筋/);
    assert.doesNotMatch(receipt.order.items[0].options.join(' / '), /※缶ビール|※無料トッピング/);
  }
  assert.equal(settings.receiptTemplate.showOrderNote, false);
});

test('preparation and pickup documents retain their existing note, item labels and prices', () => {
  for (const jobs of [documents, relay]) {
    const kitchen = jobs[0].payload.order;
    assert.equal(kitchen.note, '辛さ控えめ / 注文メモ');
    assert.equal(kitchen.items[0].name, '麻辣湯');
    assert.equal(kitchen.items[0].amount, 1350);
    assert.doesNotMatch(kitchen.items[0].options.join(' / '), /※/);
    assert.equal(kitchen.taxBreakdown, undefined);
    assert.equal(jobs.find(job => job.kind === 'pickup').payload.order.note, '');
  }
});

test('later invoice can apply its own note visibility without rewriting or doubling saved tax', () => {
  const original = receipts[0];
  const originalSnapshot = structuredClone(original);
  const invoice = applyPosReceiptTaxBreakdown({ ...original.receiptTemplate, showOrderNote: true }, {
    ...original.order, receiptRequested: true, receiptTitle: '領収書'
  });
  assert.equal(invoice.order.note, `${printedTax} / 注文メモ`);
  assert.deepEqual(invoice.order.taxBreakdown, taxBreakdown);
  assert.deepEqual(original, originalSnapshot);
  const preview = renderPreview({ ...original, ...invoice });
  assert.match(preview, /領収書/);
  assert.match(preview, /※麻辣湯/);
  assert.match(preview, /8%対象 ¥1,300 \(内税 ¥97\) \/ 10%対象 ¥550 \(内税 ¥50\)/);
  assert.doesNotMatch(preview, /消費税 0%/);
});

test('single-rate takeout keeps the reduced-rate markers and legacy sales gain no tax annotation', () => {
  const single = buildPosPrintDocumentSnapshots(settings, '桜並木店', {
    ...sale, amount: 200, taxRate: 8, taxAmount: 15, taxBreakdown: [{ rate: 8, grossAmount: 200, taxAmount: 15 }]
  }, [tea], [], 'none')[0].payload.order;
  assert.equal(single.taxRate, 8);
  assert.match(single.note, /※軽減税率対象/);
  assert.equal(single.items[0].name, '※ウーロン茶');
  const legacy = buildPosPrintDocumentSnapshots(settings, '桜並木店', { ...sale, taxRate: 8, taxBreakdown: undefined }, [tea], [], 'none')[0].payload;
  assert.equal(legacy.order.note, '注文メモ');
  assert.equal(legacy.order.taxBreakdown, undefined);
  assert.equal(legacy.order.items[0].name, 'ウーロン茶');
  assert.equal(legacy.receiptTemplate.showOrderNote, false);
});

test('ticket content rules filter structured groups independently and leave receipts intact', () => {
  const config = normalizePosPrinterSettings({ ...settings, bowlTickets: {
    kitchen: { enabled: true, copies: 1, template: { showWeight: false, showOptionGroupNames: false, optionGroupVisibility: { heat: false } } },
    finishing: { enabled: true, copies: 1, template: { showNote: false, optionGroupVisibility: { noodles: false }, showTimestamp: false } },
    pickup: { enabled: true, copies: 1, template: { showOptions: false, showWeight: false, showTitle: false, showItems: false } }
  } });
  const meal = { ...items[0], selectedOptions: [
    {id:'n',groupId:'noodles',groupName:'麺',name:'春雨 50g'},
    {id:'h',groupId:'heat',groupName:'辛さ',name:'辛さ3'},
    {id:'future',groupId:'new-group',groupName:'新規',name:'新しい選択肢'}
  ] };
  const snapshots = buildPosPrintDocumentSnapshots(config, 'Test', sale, [meal], [{itemIndex:0,itemId:'item',pickupCode:'001'}], 'auto');
  const kitchen = snapshots.find(d=>d.kind==='kitchen').payload;
  assert.deepEqual(kitchen.order.items[0].options, ['春雨 50g','新しい選択肢']);
  const finishing = snapshots.find(d=>d.kind==='finishing').payload;
  assert(!finishing.order.items[0].options.some(x=>x.includes('春雨')));
  assert(finishing.order.items[0].options.some(x=>x.includes('辛さ3')));
  assert.equal(finishing.order.note,'');
  assert.equal(finishing.kitchenTicketTemplate.showTimestamp,false);
  const customer = snapshots.find(d=>d.kind==='pickup').payload;
  assert.deepEqual(customer.order.items[0].options,[]);
  assert.equal(customer.kitchenTicketTemplate.showTitle,false);
  assert.equal(customer.kitchenTicketTemplate.showItems,false);
  const receipt = snapshots.find(d=>d.kind==='receipt').payload;
  assert(receipt.order.items[0].options.some(x=>x.includes('春雨')));
  assert(receipt.order.items[0].options.some(x=>x.includes('辛さ3')));
  const relaySnapshots=buildRelayDocuments(config,'Test',sale,[meal],[{itemIndex:0,itemId:'item',pickupCode:'001'}]);
  assert.deepEqual(relaySnapshots[0].payload.order.items[0].options,kitchen.order.items[0].options);
  assert.equal(settings.bowlTickets.kitchen.template,null);
});

test('completed checkout follows exact order acknowledgements and refuses incomplete or stale queues', () => {
  const status=compiled.exports.posCheckoutPrintStatus;
  const queue=states=>({hasMore:false,documents:states.map((state,i)=>({id:String(i),orderId:'sale',state}))});
  assert.match(status('sale',2,null,''),/確認中/);
  assert.match(status('sale',2,queue(['pending','sending']),'sale'),/印刷待ち/);
  assert.match(status('sale',2,queue(['sent','sent']),'sale'),/伝票送信済み/);
  assert.match(status('sale',2,queue(['sent','uncertain']),'sale'),/確認してください/);
  assert.match(status('sale',2,queue(['sent']),'sale'),/確認中/);
  assert.match(status('sale',2,queue([]),'sale'),/確認中/);
  assert.match(status('sale',2,queue(['sent','sent']),'previous-sale'),/確認中/);
  assert.match(status('sale',2,{...queue(['sent','sent']),hasMore:true},'sale'),/確認中/);
  assert.match(status('sale',2,queue(['sent','sent']),'sale','read failed'),/確認してください/);
  assert.match(status('sale',2,queue(['sent','cancelled']),'sale'),/取消済み/);
  assert.match(status('sale',2,queue(['not_requested','not_requested']),'sale'),/印刷なし/);
});
