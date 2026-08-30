import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCompetitorProductIdentity } from "./competitor-menu-identity.ts";
import { describeStorePromotionChange, storePromotionSnapshotChanged } from "./competitor-promotion-history.ts";

test("treats bare and prefixed Uber UUIDs as the same product identity", () => {
  const uuid = "d7e1189b-5e61-5380-93ac-9c67f13cb358";
  assert.equal(canonicalCompetitorProductIdentity(uuid), uuid);
  assert.equal(canonicalCompetitorProductIdentity(`id:${uuid}`), uuid);
});

test("keeps derived identities distinct from Uber IDs", () => {
  assert.equal(canonicalCompetitorProductIdentity("derived:menu-hash"), "derived:menu-hash");
});

test("lists every discounted item with regular and promotional prices", () => {
  const summary = describeStorePromotionChange(
    { active: false, campaigns: [] },
    {
      active: true,
      campaigns: [{
        title: "Save on Select Items",
        itemCount: 2,
        discountLabels: ["20% off"],
        items: [
          { name: "麻辣湯", originalPrice: "¥1,500", currentPrice: "¥1,200", discountLabels: ["20% off"] },
          { name: "トマトスープ", originalPrice: "¥1,600", currentPrice: "¥1,280", discountLabels: ["20% off"] }
        ]
      }]
    }
  );

  assert.match(summary, /店舗キャンペーンが開始/);
  assert.match(summary, /麻辣湯（通常 ¥1,500 → 割引 ¥1,200/);
  assert.match(summary, /トマトスープ（通常 ¥1,600 → 割引 ¥1,280/);
});

test("keeps older campaign history readable when item names were not stored", () => {
  const summary = describeStorePromotionChange(
    { active: true, campaigns: [{ title: "Save on Select Items", itemCount: 1, discountLabels: ["20% off"] }] },
    { active: false, campaigns: [] }
  );

  assert.match(summary, /店舗キャンペーンが終了/);
  assert.match(summary, /Save on Select Items/);
  assert.match(summary, /1商品/);
  assert.match(summary, /対象商品名は保存されていません/);
});

test("does not report a false promotion change when legacy snapshots gain item details", () => {
  const previous = { active: true, campaigns: [{ title: "Save on Select Items", itemCount: 1, discountLabels: ["20% off"] }] };
  const current = {
    active: true,
    campaigns: [{
      title: "Save on Select Items",
      itemCount: 1,
      discountLabels: ["20% off"],
      items: [{ name: "麻辣湯", originalPrice: "¥1,500", currentPrice: "¥1,200", discountLabels: ["20% off"] }]
    }]
  };

  assert.equal(storePromotionSnapshotChanged(previous, current), false);
  assert.equal(storePromotionSnapshotChanged(previous, { ...current, campaigns: [{ ...current.campaigns[0], discountLabels: ["30% off"] }] }), true);
});
