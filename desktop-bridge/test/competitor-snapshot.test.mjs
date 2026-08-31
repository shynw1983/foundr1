import assert from "node:assert/strict";
import test from "node:test";

import { buildUberCompetitorSnapshot, parseUberCompetitorCards } from "../src/competitor-snapshot.mjs";

const context = encodeURIComponent(JSON.stringify({ itemUuid: "squid-item" }));

test("reads normal price, discount price, and discount rate from a public Uber card", () => {
  const products = parseUberCompetitorCards([{
    href: `https://www.ubereats.com/store/example?mod=quickView&modctx=${context}`,
    text: "Quick Add\n(9)いかと筍のシャキぷりセット\n¥2,014\n¥2,518\n20% off"
  }]);
  assert.deepEqual(products, [{
    key: "squid-item",
    name: "(9)いかと筍のシャキぷりセット",
    currentPrice: "¥2,014",
    originalPrice: "¥2,518",
    discountLabels: ["20% off"]
  }]);
});

test("only marks a promotion observation complete while the store is open and menu cards loaded", () => {
  const cards = [{ href: `https://www.ubereats.com/store/example?modctx=${context}`, text: "商品\n¥800\n¥1,000\n20% off" }];
  assert.equal(buildUberCompetitorSnapshot({ sourceId: "source", apiData: { isOpen: false }, cards, menuLoaded: true, locationReady: true }).promotionComplete, false);
  assert.equal(buildUberCompetitorSnapshot({ sourceId: "source", apiData: { isOpen: true }, cards, menuLoaded: true, locationReady: false }).promotionComplete, false);
  assert.equal(buildUberCompetitorSnapshot({ sourceId: "source", apiData: { isOpen: true }, cards, menuLoaded: true, locationReady: true }).promotionComplete, true);
});
