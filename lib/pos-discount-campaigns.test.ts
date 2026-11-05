import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePosDiscounts, isPosCampaignActive, normalizePosCampaignFields, posCampaignDate, posDiscountAmount, validatePosCampaignPresets, matchesPosDiscountQuote, type PosDiscountRule } from "./pos-discount-campaigns.ts";
const now = Date.parse("2026-10-26T03:00:00Z");
const lines = [{ amount: 815, brandId: "a", category: "food", itemKind: "bowl" }, { amount: 185, brandId: "b", category: "drink", itemKind: "drink" }];
const campaign = (patch: Partial<PosDiscountRule> = {}): PosDiscountRule => ({ key: "campaign_a", name: "平日キャンペーン", enabled: true, applicationMode: "campaign", startsOn: "2026-10-26", endsOn: "2026-10-27", minimumSubtotal: 1000, discountType: "percent", discountValue: 20, targetScope: "all", targetValue: "", ...patch });
const manual = (patch: Partial<PosDiscountRule> = {}) => campaign({ key: "manual", applicationMode: "manual", ...patch });
test("Japan dates include both days and switch at midnight, not UTC midnight", () => {
  const c = campaign();
  for (const [timestamp, active] of [["2026-10-25T14:59:59.999Z", false], ["2026-10-25T15:00:00Z", true], ["2026-10-27T14:59:59.999Z", true], ["2026-10-27T15:00:00Z", false]] as const) assert.equal(isPosCampaignActive(c, Date.parse(timestamp)), active);
  assert.equal(posCampaignDate(Date.parse("2026-10-25T15:00:00Z")), "2026-10-26");
  assert.equal(posCampaignDate(NaN), ""); assert.equal(posCampaignDate(1e20), "");
});
test("threshold is inclusive and applies to pre-discount subtotal", () => {
  assert.equal(evaluatePosDiscounts([campaign()], "", lines, 999, now).amount, 0);
  assert.equal(evaluatePosDiscounts([campaign()], "", lines, 1000, now).amount, 200);
  assert.equal(evaluatePosDiscounts([campaign({ minimumSubtotal: 0 })], "", lines.slice(0, 1), 815, now).amount, 163);
});
test("automatic campaigns never add together, greatest value wins", () => {
  const result = evaluatePosDiscounts([campaign(), campaign({ key: "amount", discountType: "amount", discountValue: 300 }), campaign({ key: "other", discountValue: 25 })], "", lines, 1000, now);
  assert.equal(result.appliedKey, "amount"); assert.equal(result.amount, 300);
});
test("better manual choice wins, better campaign overrides, ties keep manual", () => {
  for (const [value, key] of [[25, "manual"], [10, "campaign_a"], [20, "manual"]] as const) {
    const result = evaluatePosDiscounts([manual({ discountValue: value }), campaign()], "manual", lines, 1000, now);
    assert.equal(result.appliedKey, key); assert.equal(result.amount, Math.max(value * 10, 200));
  }
});
test("campaign keys cannot be selected as manual discounts and disabled choices are ignored", () => {
  const future = campaign({ startsOn: "2026-11-01", endsOn: "2026-11-30" });
  assert.equal(evaluatePosDiscounts([future], future.key, lines, 1000, now).amount, 0);
  assert.equal(evaluatePosDiscounts([manual({ enabled: false }), campaign({ enabled: false })], "manual", lines, 1000, now).amount, 0);
});
test("scoped discounts use eligible lines, retain rounding and fixed-value caps", () => {
  for (const [scope, target, expected] of [["category", "food", 163], ["item_kind", "drink", 37], ["brand", "a", 163]] as const) {
    assert.equal(evaluatePosDiscounts([campaign({ targetScope: scope, targetValue: target })], "", lines, 1000, now).amount, expected);
  }
  assert.equal(posDiscountAmount(campaign({ targetScope: "brand", targetValue: "b", discountType: "amount", discountValue: 500 }), lines, 1000), 185);
  assert.equal(evaluatePosDiscounts([campaign({ targetScope: "brand", targetValue: "missing" })], "", lines, 1000, now).preset, undefined);
});
test("malformed saved periods and thresholds fail closed", () => {
  for (const patch of [{ startsOn: "2026-02-29" }, { startsOn: "2026-10-26-extra" }, { startsOn: "2026-10-29" }, { endsOn: "" }, { minimumSubtotal: -10 }, { minimumSubtotal: NaN }]) {
    const raw = campaign(patch); const rule = { ...raw, ...normalizePosCampaignFields(raw) };
    assert.equal(evaluatePosDiscounts([rule], "", lines, 1000, now).amount, 0, JSON.stringify(patch));
  }
});
test("save validation rejects invalid periods, rates, scopes and amounts", () => {
  assert.equal(validatePosCampaignPresets([campaign()]), null);
  assert.equal(validatePosCampaignPresets([{ ...manual(), startsOn: "", endsOn: "" }]), null);
  for (const patch of [{ startsOn: "2026-02-30" }, { startsOn: "2026-11-01" }, { endsOn: "" }, { minimumSubtotal: -1 }, { minimumSubtotal: 1.5 }, { discountValue: 101 }, { name: "" }, { targetScope: "brand" as const, targetValue: "" }]) assert(validatePosCampaignPresets([campaign(patch)]));
  assert(validatePosCampaignPresets(Array.from({ length: 21 }, (_, i) => campaign({ key: String(i) }))));
});
test("client quote must match trusted applied key and integer amount", () => {
  const expected = evaluatePosDiscounts([campaign()], "", lines, 1000, now);
  assert(matchesPosDiscountQuote({ version: 1, appliedKey: "campaign_a", amount: 200 }, expected));
  for (const value of [undefined, {}, { version: 1, appliedKey: "campaign_a", amount: "200" }, { version: 1, appliedKey: "manual", amount: 200 }, { version: 1, appliedKey: "campaign_a", amount: 0 }]) assert(!matchesPosDiscountQuote(value, expected));
});
