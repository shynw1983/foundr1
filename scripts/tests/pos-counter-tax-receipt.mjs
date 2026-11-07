import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptPdf } from '../../lib/receipt-pdf.ts';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';

test('new POS electronic receipts retain original tax buckets after refunds and legacy receipts are unaffected', async () => {
  const fixture = await createPrintDocumentFixture(process.cwd());
  const { db, ids, load, request } = fixture;
  fixture.modules['receipt-pdf'] = { createReceiptPdf }; // Keep the real legacy PDF generator in Node's Buffer context.
  try {
    await db.exec(`create table if not exists companies (
      id uuid primary key, legal_name text, name text, invoice_registration_number text,
      receipt_purpose_text text, address text, phone text
    )`);
    const taxBreakdown = [{ rate: 8, grossAmount: 1300, taxAmount: 97 }, { rate: 10, grossAmount: 550, taxAmount: 50 }];
    const summary = {
      taxableAmount: 1850, subtotalAmount: 1950, discountAmount: 100, taxBreakdown,
      orderType: 'takeout', name: 'Fixture', items: [
        { name: '麻辣湯', options: [{ name: '牛筋', priceDelta: 100 }, { name: '缶ビール', priceDelta: 250, counterStandardTax: true }] },
        { name: '瓶ビール', counterStandardTax: true, options: [{ name: '有料サイズ', priceDelta: 30 }] },
        { name: 'ウーロン茶' }
      ]
    };
    const orderId = '00000000-0000-4000-8000-000000000810';
    const legacyId = '00000000-0000-4000-8000-000000000811';
    const badId = '00000000-0000-4000-8000-000000000812';
    const insertOrder = (id, source, amount, status, data) => db.query(`insert into store_customer_orders
      (id,store_id,brand_id,pickup_code,pickup_date,pickup_time,status,payment_status,order_source,amount,customer_summary)
      values ($1,$2,$3,'008',current_date,'12:00','completed',$4,$5,$6,$7::jsonb)`, [id, ids.store, ids.brand, status, source, amount, JSON.stringify(data)]);
    await insertOrder(orderId, 'store_pos', 1550, 'partial_refunded', summary);
    await insertOrder(legacyId, 'maamaa_web', 1850, 'paid', summary);
    await insertOrder(badId, 'store_pos', 1850, 'paid', { ...summary, taxBreakdown: taxBreakdown.slice(0, 1) });
    for (const [index, item] of summary.items.entries()) {
      const [amount, refunded] = [[1450, 0], [300, 300], [200, 0]][index];
      await db.query(`insert into store_customer_order_items (order_id,item_name,quantity,amount,refunded_amount,sort_order)
        values ($1,$2,1,$3,$4,$5)`, [orderId, item.name, amount, refunded, index]);
    }
    const { getOnlineReceiptViewModel } = load('lib/receipt-data.ts');
    const { GET } = load('app/api/public/orders/receipt/route.ts');
    const download = id => GET(request(`/api/public/orders/receipt?orderId=${id}&pickupCode=008`));
    const view = (id, recordDownload = false) => getOnlineReceiptViewModel({ orderId: id, pickupCode: '008', recordDownload });
    const readCount = async id => (await db.query('select receipt_download_count as count from store_customer_orders where id=$1', [id])).rows[0].count;

    const preview = await view(orderId);
    assert.equal(preview.receiptStatus, 'partially_refunded');
    assert.equal(preview.totalAmount, 1550);
    assert.equal(preview.refundAmount, 300);
    assert.equal(preview.posDiscountAmount, 100);
    assert.equal(preview.taxRate, 0);
    assert.equal(preview.taxIncludedAmount, 147);
    assert.deepEqual(structuredClone(preview.taxBreakdown), taxBreakdown);
    assert.deepEqual(Array.from(preview.items, item => item.title), ['※麻辣湯', '瓶ビール', '※ウーロン茶']);
    assert.deepEqual(Array.from(preview.items[0].sections[0].items), ['※牛筋', '缶ビール']);
    assert.deepEqual(Array.from(preview.items[1].sections[0].items), ['有料サイズ']);

    const redirect = await download(orderId);
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get('location'), `/api/public/orders/receipt/preview-pdf?orderId=${orderId}&pickupCode=008&recipientMode=registered`);
    assert.equal(await readCount(orderId), 0);
    assert.equal((await view(orderId, true)).downloadCount, 1);
    assert.equal(await readCount(orderId), 1);

    await db.query("update store_customer_orders set amount=0, status='cancelled', payment_status='refunded' where id=$1", [orderId]);
    await db.query('update store_customer_order_items set refunded_amount = case sort_order when 0 then 1350 when 1 then 300 else 200 end where order_id=$1', [orderId]);
    const refunded = await view(orderId);
    assert.equal(refunded.receiptStatus, 'cancelled');
    assert.equal(refunded.totalAmount, 0);
    assert.equal(refunded.refundAmount, 1850);
    assert.deepEqual(structuredClone(refunded.taxBreakdown), taxBreakdown);

    assert.equal(await view(badId, true), null);
    assert.equal((await download(badId)).status, 409);
    assert.equal(await readCount(badId), 0);
    const legacyDownload = await download(legacyId);
    assert.equal(legacyDownload.headers.get('content-type'), 'application/pdf');
    assert.match(await legacyDownload.text(), /^%PDF-1.7/);
    assert.equal((await view(legacyId)).taxBreakdown, undefined);
    assert.equal((await view(legacyId)).taxRate, 8);
  } finally {
    await db.close();
  }
});
