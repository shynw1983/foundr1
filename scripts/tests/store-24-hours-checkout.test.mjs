import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as receptionPolicy from '../../lib/maamaa-reception-policy.ts';

const code = ts.transpileModule(readFileSync('app/api/public/orders/maamaa/checkout/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function fixture(businessDay) {
  let passed = 0;
  const modules = {
    'maamaa-compatible-menu': { getMaamaaCompatibleMenu: async () => ({ brandId: 'fixture', baseMenu: {
      stores: [{ id: 'fixture', osStoreId: 'fixture' }],
      storeOperation: { reservationsEnabled: true, acceptanceMode: 'force_open', minimumPickupMinutes: 0 }
    } }) },
    'store-payment-accounts': { getActiveStorePaymentAccount: async () => ({ secretKey: 'unused-fixture-key' }) },
    'store-business-hours': {
      getStoreCashBusinessDayState: () => ({ status: 'business_open', businessDate: '2099-01-01', openAt: '2099-01-01T00:00', ...businessDay }),
      isPickupWithinBusinessHours: () => true
    },
    'store-reservation-windows': { getStoreReservationWindowsForDate: async () => { passed++; throw Error('PASSED_BUSINESS_DAY_GUARD'); } },
    'store-temporary-closures': {}, 'customer-orders': {}, loyalty: {}, 'maamaa-order-policy': {},
    'maamaa-reception-policy': receptionPolicy
  };
  const exports = {};
  runInNewContext(code, { exports, Response, require: name => {
    const key = name.split('/').at(-1);
    assert.ok(key in modules, `Unexpected dependency ${name}`);
    return modules[key];
  } });
  return { passed: () => passed, submit: (pickupDate, pickup) => exports.POST({ json: async () => ({
    store: 'fixture', pickupDate, pickup, shortagePreference: 'refund'
  }) }) };
}

test('actual checkout guard excludes next midnight only for explicit 24-hour days, before order or payment writes', async () => {
  const allDay = fixture({ closeAt: '2099-01-02T00:00', closeExclusive: true });
  const response = await allDay.submit('2099-01-02', '00:00');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Pickup time is outside the current business day');
  assert.equal(allDay.passed(), 0);
  await assert.rejects(allDay.submit('2099-01-01', '23:59'), { message: 'PASSED_BUSINESS_DAY_GUARD' });
  const timed = fixture({ closeAt: '2099-01-01T20:00' });
  await assert.rejects(timed.submit('2099-01-01', '20:00'), { message: 'PASSED_BUSINESS_DAY_GUARD' });
  assert.equal((await timed.submit('2099-01-01', '20:01')).status, 409);
});
