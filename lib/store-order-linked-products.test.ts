import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(file: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw Error('Unexpected dependency ' + name);
    return modules[name];
  }});
  return exports;
}
const group = { groupId: 'local-drink-group', optionIds: [], optionLabels: ['ビール'], optionPrices: [500],
  linkedItems: [{ menuCatalogItemId: 'canonical-drink', quantity: 1 }] };
function fixture() {
  let sqlReads = 0, sideEffects = 0;
  const forbidden = () => { sideEffects++; throw Error('No financial or business mutation permitted in negative fixture'); };
  const target = { paymentStatus: 'paid', status: 'new', refundStatus: '', amount: 1500, grossAmount: 1500,
    paidAmount: 1500, itemName: 'マーラータン', shortagePreference: 'substitute_or_refund', customizations: [group] };
  const api = load('./store-order-shortages.ts', {
    './db': { sql: async () => { sqlReads++; return [target]; } },
    './customer-orders': { findCustomerOrderById: forbidden, refundCustomerOrderPayment: forbidden },
    './loyalty': { reverseLoyaltyForRefundedOrderItem: forbidden },
    './order-production': { ensureProductionTasksForOrder: forbidden },
    './sales-orders': { syncWebReservationToSalesOrder: forbidden },
    './inventory-order-usage': { markInventoryOrderReady: forbidden },
    './store-order-shortage-rules': load('./store-order-shortage-rules.ts')
  }) as unknown as typeof import('./store-order-shortages');
  return { api, counts: () => ({ sqlReads, sideEffects }) };
}
test('linked products remain with their parent refund unit while ordinary ingredients keep separate candidates', () => {
  const { api } = fixture();
  const choices = api.buildShortageCandidates({ id: 'bowl', itemName: 'マーラータン', amount: 1500,
    customizations: [group, { groupId: 'topping', groupName: '追加', optionIds: ['real-option'], optionLabels: ['牛すじ50g'], optionPrices: [200] }] });
  assert.equal(choices.length, 2);
  assert.equal(choices[0].key, 'item');
  assert.equal(choices[0].price, 1500);
  assert.equal(choices[1].key, 'option:1:0');
  assert.equal(choices[1].name, '牛すじ50g');
  assert.equal(api.buildShortageCandidates({ id: 'drink', itemName: 'ビール', amount: 500, customizations: [] })[0].price, 500);
});
test('forged linked-product option indices cannot initiate partial refunds or substitutions', async () => {
  for (const actionType of ['refund', 'replace'] as const) {
    const { api, counts } = fixture();
    const result = await api.handleStoreOrderShortage({ orderId: 'order', orderItemId: 'bowl', targetKey: 'option:0:0',
      actionType, replacementName: 'unknown replacement', employeeId: 'cashier', employeeName: 'cashier' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(counts().sqlReads, 1);
    assert.equal(counts().sideEffects, 0);
  }
});
