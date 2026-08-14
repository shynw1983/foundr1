import { setTimeout as delay } from "node:timers/promises";

import { loginState, pageSummary, targetNameTiers } from "./common.mjs";

const OOS_URL = "https://store.rocketnow.co.jp/merchant/management/oos";
const INVENTORY_ROW_SELECTOR = ".nested-checkbox-list__sub_title";

async function waitForInventoryRows(page, targetKind) {
  const routeSuffix = targetKind === "option" ? "/option" : "/menu";
  await page.waitForFunction(
    (suffix) => window.location.pathname.endsWith(suffix),
    { timeout: 20000 },
    routeSuffix
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForSelector(INVENTORY_ROW_SELECTOR, { visible: true, timeout: 25000 });
      return;
    } catch (error) {
      if (attempt > 0) throw error;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    }
  }
}

async function selectInventoryTab(page, targetKind) {
  const tabLabel = targetKind === "option" ? "オプション" : "メニュー";
  const selected = await page.evaluate((label) => {
    const tab = [...document.querySelectorAll(".selectable-tab")]
      .find((candidate) => candidate.textContent?.trim() === label);
    if (!(tab instanceof HTMLElement)) return false;
    if (!tab.classList.contains("selected")) tab.click();
    return true;
  }, tabLabel);
  if (!selected) throw new Error(`rocket_now_inventory_tab_missing:${targetKind}`);
  await page.waitForFunction(
    (label) => [...document.querySelectorAll(".selectable-tab")]
      .some((candidate) => candidate.textContent?.trim() === label && candidate.classList.contains("selected")),
    { timeout: 10000 },
    tabLabel
  );
  await waitForInventoryRows(page, targetKind);
}

async function readRows(page, targets) {
  const requested = targets.map((target) => ({ kind: target.kind, label: target.label, ...targetNameTiers(target) }));
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    return items.map((item) => {
      const findRows = (names) => {
        const wanted = new Set(names.map(normalize));
        return titles
          .filter((title) => wanted.has(normalize(title.textContent)))
          .map((title) => title.closest("div[class*=e1iqhfx24]"))
          .filter(Boolean);
      };
      const primaryRows = findRows(item.primaryNames);
      const rows = primaryRows.length ? primaryRows : findRows(item.aliasNames);
      return {
        kind: item.kind,
        label: item.label,
        names: primaryRows.length ? item.primaryNames : item.aliasNames,
        matches: rows.map((row) => ({
          text: normalize(row.textContent),
          checkboxId: row.querySelector('input[type="checkbox"],input[type="checkBox"]')?.id ?? "",
          hidden: normalize(row.textContent).includes("非表示")
        }))
      };
    });
  }, requested);
}

async function waitForRows(page, labels, hidden, targetKind) {
  const verify = async () => page.waitForFunction(({ wantedLabels, expectedHidden }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    return wantedLabels.every((label) => {
      const title = titles.find((candidate) => normalize(candidate.textContent) === normalize(label));
      const row = title?.closest("div[class*=e1iqhfx24]");
      return Boolean(row) && normalize(row.textContent).includes("非表示") === expectedHidden;
    });
  }, { timeout: 15000 }, { wantedLabels: labels, expectedHidden: hidden });

  try {
    await verify();
  } catch {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    await waitForInventoryRows(page, targetKind);
    await verify();
  }
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
    const targetKind = targets.every((target) => target.kind === "option") ? "option" : "item";
    await selectInventoryTab(page, targetKind);
    return readRows(page, targets);
  }

  async setInventory(payload, located) {
    const page = await this.session.goto(OOS_URL);
    const targetKind = located.every((item) => item.kind === "option") ? "option" : "item";
    await selectInventoryTab(page, targetKind);
    const desiredHidden = payload.isAvailable !== true;
    const fresh = await readRows(page, located.map((item) => ({ kind: item.kind, label: item.label, aliases: item.names })));
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
        await waitForRows(page, [item.label], false, targetKind);
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
    const hideSelected = await page.evaluate(() => {
      const input = document.querySelector('input[type="radio"][value="HIDE"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.click();
      return input.checked;
    });
    if (!hideSelected) throw new Error("rocket_now_hide_option_missing");
    const applied = await page.evaluate(() => {
      const popup = document.querySelector('[data-testid="FloatingPopup"]');
      const button = [...(popup?.querySelectorAll("button") ?? [])]
        .find((candidate) => candidate.textContent?.trim() === "適用");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    });
    if (!applied) throw new Error("rocket_now_apply_button_missing");
    await waitForRows(page, changing.map((item) => item.label), true, targetKind);
    return { outcome: "applied", changed: changing.length, desiredHidden };
  }
}
