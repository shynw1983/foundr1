import { setTimeout as delay } from "node:timers/promises";

import { loginState, pageSummary, targetNames } from "./common.mjs";

const OOS_URL = "https://store.rocketnow.co.jp/merchant/management/oos";

async function readRows(page, targets) {
  const requested = targets.map((target) => ({ label: target.label, names: targetNames(target) }));
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    return items.map((item) => {
      const wanted = new Set(item.names.map(normalize));
      const rows = titles
        .filter((title) => wanted.has(normalize(title.textContent)))
        .map((title) => title.closest("div[class*=e1iqhfx24]"))
        .filter(Boolean);
      return {
        label: item.label,
        names: item.names,
        matches: rows.map((row) => ({
          text: normalize(row.textContent),
          checkboxId: row.querySelector('input[type="checkbox"],input[type="checkBox"]')?.id ?? "",
          hidden: normalize(row.textContent).includes("非表示")
        }))
      };
    });
  }, requested);
}

async function waitForRows(page, labels, hidden) {
  await page.waitForFunction(({ wantedLabels, expectedHidden }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    return wantedLabels.every((label) => {
      const title = titles.find((candidate) => normalize(candidate.textContent) === normalize(label));
      const row = title?.closest("div[class*=e1iqhfx24]");
      return Boolean(row) && normalize(row.textContent).includes("非表示") === expectedHidden;
    });
  }, { timeout: 15000 }, { wantedLabels: labels, expectedHidden: hidden });
}

export class RocketNowAdapter {
  constructor(session) {
    this.session = session;
  }

  async inspect() {
    const page = await this.session.goto(OOS_URL);
    const summary = await pageSummary(page);
    return { platform: "rocket_now", ...loginState(summary, "売り切れ・非表示") };
  }

  async locateTargets(targets) {
    const page = await this.session.goto(OOS_URL);
    return readRows(page, targets);
  }

  async setInventory(payload, located) {
    const page = await this.session.goto(OOS_URL);
    const desiredHidden = payload.isAvailable !== true;
    const fresh = await readRows(page, located.map((item) => ({ label: item.label, aliases: item.names })));
    const changing = fresh.filter((item) => item.matches[0]?.hidden !== desiredHidden);
    if (!changing.length) return { outcome: "already_applied", changed: 0, desiredHidden };

    if (!desiredHidden) {
      for (const item of changing) {
        const clicked = await page.evaluate((checkboxId) => {
          const checkbox = document.getElementById(checkboxId);
          const row = checkbox?.closest("div[class*=e1iqhfx24]");
          const button = [...(row?.querySelectorAll("button") ?? [])]
            .find((candidate) => candidate.textContent?.trim() === "解除");
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        }, item.matches[0].checkboxId);
        if (!clicked) throw new Error(`rocket_now_unhide_button_missing:${item.label}`);
        await waitForRows(page, [item.label], false);
      }
      return { outcome: "applied", changed: changing.length, desiredHidden };
    }

    for (const item of changing) {
      const checkboxId = item.matches[0].checkboxId;
      if (!checkboxId) throw new Error(`rocket_now_checkbox_missing:${item.label}`);
      await page.evaluate((id) => document.getElementById(id)?.click(), checkboxId);
    }
    await page.waitForSelector('[data-testid="FloatingPopup"]', { visible: true, timeout: 10000 });
    const selectedHide = await page.evaluate(() => {
      const popup = document.querySelector('[data-testid="FloatingPopup"]');
      const trigger = popup?.querySelector(":scope > div > div");
      if (!(trigger instanceof HTMLElement)) return false;
      trigger.click();
      return true;
    });
    if (!selectedHide) throw new Error("rocket_now_status_picker_missing");
    await delay(250);
    const hideChoice = await page.$('input[type="radio"][value="HIDE"]');
    if (!hideChoice) throw new Error("rocket_now_hide_option_missing");
    await hideChoice.click();
    const applied = await page.evaluate(() => {
      const popup = document.querySelector('[data-testid="FloatingPopup"]');
      const button = [...(popup?.querySelectorAll("button") ?? [])]
        .find((candidate) => candidate.textContent?.trim() === "適用");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    });
    if (!applied) throw new Error("rocket_now_apply_button_missing");
    await waitForRows(page, changing.map((item) => item.label), true);
    return { outcome: "applied", changed: changing.length, desiredHidden };
  }
}
