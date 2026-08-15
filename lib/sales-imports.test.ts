import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseRocketNowSalesXlsx } from "./sales-imports.ts";

function createRocketWorkbookBytes(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["この販売データの金額は変更される可能性があります。"],
    ["説明"],
    ["説明"],
    ["説明"],
    [
      "店舗名",
      "店舗ID",
      "取引日",
      "取引日時",
      "取引タイプ",
      "注文番号",
      "注文履歴",
      "売上高",
      "店舗負担クーポン金額",
      "総手数料",
      "消費税",
      "手数料の割引金額",
      "精算予定金額"
    ],
    ...rows
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sales Detail");
  return new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("Rocket Now Excel imports payments and applies partial/full cancellations", () => {
  const bytes = createRocketWorkbookBytes([
    ["まぁ麻", "118575", "2026-08-11", "2026-08-11T23:23:56", "PAY", "PARTIAL", "商品", 4879, 0, 146, 15, 0, 4718],
    ["まぁ麻", "118575", "2026-08-12", "2026-08-12T00:20:12", "CANCEL", "PARTIAL", "商品x0", -350, 0, -10, -1, 0, -339],
    ["まぁ麻", "118575", "2026-08-13", "2026-08-13T01:39:08", "PAY", "FULL", "商品", 2889, 0, 87, 9, 0, 2793],
    ["まぁ麻", "118575", "2026-08-13", "2026-08-13T01:39:15", "CANCEL", "FULL", "商品", -2889, 0, -87, -9, 0, -2793]
  ]);

  const parsed = parseRocketNowSalesXlsx(bytes);

  assert.equal(parsed.detectedMonth, "2026-08");
  assert.equal(parsed.rawRows.length, 4);
  assert.equal(parsed.skippedRowCount, 0);
  assert.equal(parsed.orders.length, 2);

  const partial = parsed.orders.find((order) => order.orderNo === "PARTIAL");
  assert.ok(partial);
  assert.equal(partial.total, 4529);
  assert.equal(partial.tax, 14);
  assert.equal(partial.subtotal, 4515);
  assert.equal(partial.adjustment, -350);
  assert.equal(partial.status, "completed");
  assert.equal(partial.paymentStatus, "partial_refunded");
  assert.equal(partial.rowCount, 2);

  const full = parsed.orders.find((order) => order.orderNo === "FULL");
  assert.ok(full);
  assert.equal(full.total, 0);
  assert.equal(full.tax, 0);
  assert.equal(full.subtotal, 0);
  assert.equal(full.adjustment, -2889);
  assert.equal(full.status, "cancelled");
  assert.equal(full.paymentStatus, "refunded");
  assert.equal(full.cancelledAt?.toISOString(), "2026-08-12T16:39:15.000Z");
});
