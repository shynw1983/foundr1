import { loadConfig } from "../src/config.mjs";
import { BrowserSession } from "../src/browser-session.mjs";
import { DemaeCanAdapter } from "../src/adapters/demae-can.mjs";
import {
  DEMAE_ITEM_NOODLE_RULES,
  describeDemaeNoodleChange
} from "../src/demae-menu-rules.mjs";

const apply = process.argv.includes("--apply");
const canary = process.argv.includes("--canary");
const STOCKOUT_URL = "https://partner.demae-can.com/merchant-admin/shop/stockout";
const MENU_URL = "https://partner.demae-can.com/merchant-admin/product/category?chainId=410649&menuPatternCode=D8Ta";

function itemPutBody(item, groups) {
  return {
    chainId: 1,
    itemCode: "",
    itemName: item.itemName,
    itemDescription: item.itemDescription ?? "",
    comboItemType: item.comboItemType,
    itemType: item.itemType,
    appealIconCode: item.appealIconCode,
    sizeInfoList: item.sizeInfoList.map((size, index) => ({
      chainId: 1,
      itemCode: "",
      sizeCode: size.sizeCode,
      applyStartDate: size.applyStartDate,
      applyEndDate: size.applyEndDate,
      originalApplyStartDate: size.applyStartDate,
      originalApplyEndDate: size.applyEndDate,
      dispOrder: index + 1,
      sizeName: size.sizeName,
      price: size.price,
      linkageItemCode: size.linkageItemCode ?? "",
      linkageItemName: size.linkageItemName ?? "",
      sizeOptionGroupLinkList: (index === 0 ? groups : size.sizeOptionGroupLinkList).map((group) => ({
        optionGroupCode: group.optionGroupCode,
        dispOrder: group.dispOrder
      }))
    })),
    categoryItemLinkList: item.categoryItemLinkList.map((category) => ({
      categoryCode: category.categoryCode
    })),
    itemImageEditType: "NOT_EDIT"
  };
}

const config = await loadConfig();
const session = new BrowserSession(config, "demae_can");
const adapter = new DemaeCanAdapter(session, config.platforms.demae_can);
let page;
try {
  const authPage = await session.goto(STOCKOUT_URL);
  await adapter.ensureAuthenticated(authPage);
  page = await session.browser.newPage();
  await page.goto(MENU_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  const results = [];
  let saveAttempts = 0;
  for (const [itemCode, rule] of DEMAE_ITEM_NOODLE_RULES) {
    const response = await page.evaluate(async (code) => {
      const result = await fetch(`/merchant-admin/api/v1/product/chain/410649/item/${code}`);
      return { ok: result.ok, status: result.status, body: await result.json() };
    }, itemCode);
    if (!response.ok || !response.body?.data) throw new Error(`demae_item_read_failed:${itemCode}:${response.status}`);
    const item = response.body.data;
    const groups = item.sizeInfoList?.[0]?.sizeOptionGroupLinkList ?? [];
    const change = describeDemaeNoodleChange(itemCode, groups);
    const beforeNoodle = change.before.find((group) => ["a011", "0009", "0004"].includes(group.optionGroupCode));
    const afterNoodle = change.after.find((group) => ["a011", "0009", "0004"].includes(group.optionGroupCode));
    const row = {
      itemCode,
      itemName: item.itemName,
      rule,
      changed: change.changed,
      before: beforeNoodle ? `${beforeNoodle.optionGroupName} @ ${beforeNoodle.dispOrder}` : "missing",
      after: afterNoodle ? `${afterNoodle.optionGroupName} @ ${afterNoodle.dispOrder}` : "missing",
      status: apply && change.changed ? "pending" : change.changed ? "preview" : "already_correct"
    };
    if (apply && change.changed && (!canary || saveAttempts === 0)) {
      saveAttempts += 1;
      const saved = await page.evaluate(async ({ code, body }) => {
        await fetch("/merchant-admin/api/v1/auth/csrf");
        const result = await fetch(`/merchant-admin/api/v1/product/chain/410649/item/${code}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        return { ok: result.ok, status: result.status, body: await result.json().catch(() => ({})) };
      }, { code: itemCode, body: itemPutBody(item, change.after) });
      if (!saved.ok) {
        throw new Error(`demae_item_save_failed:${itemCode}:${saved.status}:${JSON.stringify(saved.body)}`);
      }
      const verified = await page.evaluate(async (code) => (
        fetch(`/merchant-admin/api/v1/product/chain/410649/item/${code}`).then((result) => result.json())
      ), itemCode);
      const verification = describeDemaeNoodleChange(
        itemCode,
        verified.body?.data?.sizeInfoList?.[0]?.sizeOptionGroupLinkList
          ?? verified.data?.sizeInfoList?.[0]?.sizeOptionGroupLinkList
          ?? []
      );
      if (verification.changed) throw new Error(`demae_item_verification_failed:${itemCode}`);
      row.status = "saved_verified";
    } else if (apply && change.changed && canary) {
      row.status = "deferred_after_canary";
    }
    results.push(row);
  }
  console.table(results);
  console.log(JSON.stringify({
    mode: apply ? canary ? "canary" : "apply" : "preview",
    checked: results.length,
    needsChange: results.filter((row) => row.changed).length,
    saved: results.filter((row) => row.status === "saved_verified").length,
    alreadyCorrect: results.filter((row) => row.status === "already_correct").length
  }, null, 2));
} finally {
  if (page) await page.close().catch(() => undefined);
  await session.disconnect();
}
