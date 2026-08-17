import { setTimeout as delay } from "node:timers/promises";

import { loginState, pageSummary, platformUiChanged, targetNameTiers } from "./common.mjs";
import { withPlatformTargetAliases } from "./platform-target-aliases.mjs";

const OOS_URL = "https://store.rocketnow.co.jp/merchant/management/oos";
const INVENTORY_ROW_SELECTOR = ".nested-checkbox-list__sub_title";

export function rocketInventoryUrl(storeId, targetKind = "item") {
  const merchantStoreId = String(storeId ?? "").trim();
  if (!/^\d+$/.test(merchantStoreId)) return OOS_URL;
  const tab = targetKind === "option" ? "option" : "menu";
  return `${OOS_URL}/${merchantStoreId}/${tab}`;
}

async function waitForInventoryRows(page, targetKind) {
  const routeSuffix = targetKind === "option" ? "/option" : "/menu";
  await page.waitForFunction(
    (suffix) => window.location.pathname.endsWith(suffix),
    { timeout: 20000 },
    routeSuffix
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForFunction((selector) => {
        const visible = (element) => Boolean(element?.getClientRects().length);
        return [...document.querySelectorAll(selector)].some(visible)
          || [...document.querySelectorAll('input[type="checkbox"]')]
            .some((input) => visible(input.closest("label, [role=row], li")));
      }, { timeout: 25000 }, INVENTORY_ROW_SELECTOR);
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
  const routeSuffix = targetKind === "option" ? "/option" : "/menu";

  // Rocket renders the route before the tab bar on slower machines. If the
  // browser is already on the requested inventory page, waiting for the rows
  // is enough and avoids misclassifying the still-rendering tab as a UI change.
  const alreadyOnTargetRoute = await page.evaluate(
    (suffix) => window.location.pathname.endsWith(suffix),
    routeSuffix
  );
  if (alreadyOnTargetRoute) {
    await waitForInventoryRows(page, targetKind);
    return;
  }

  try {
    await page.waitForFunction(({ label, suffix }) => {
      if (window.location.pathname.endsWith(suffix)) return true;
      return [...document.querySelectorAll('.selectable-tab, [role="tab"], button')]
        .some((candidate) => candidate.getClientRects().length
          && candidate.textContent?.trim() === label);
    }, { timeout: 20000 }, { label: tabLabel, suffix: routeSuffix });
  } catch {
    // A temporarily missing tab is a loading timeout and must remain retryable.
    // platform_ui_changed is reserved for controls that disappear after the
    // inventory page has fully loaded.
    throw new Error(`rocket_now_inventory_tab_timeout:${targetKind}`);
  }

  const selected = await page.evaluate(({ label, suffix }) => {
    if (window.location.pathname.endsWith(suffix)) return true;
    const tab = [...document.querySelectorAll('.selectable-tab, [role="tab"], button')]
      .find((candidate) => candidate.getClientRects().length
        && candidate.textContent?.trim() === label);
    if (!(tab instanceof HTMLElement)) return false;
    if (!tab.classList.contains("selected") && tab.getAttribute("aria-selected") !== "true") tab.click();
    return true;
  }, { label: tabLabel, suffix: routeSuffix });
  if (!selected) throw new Error(`rocket_now_inventory_tab_timeout:${targetKind}`);
  await page.waitForFunction(
    ({ label, suffix }) => location.pathname.endsWith(suffix)
      || [...document.querySelectorAll('.selectable-tab, [role="tab"], button')]
        .some((candidate) => candidate.textContent?.trim() === label
          && (candidate.classList.contains("selected") || candidate.getAttribute("aria-selected") === "true")),
    { timeout: 10000 },
    { label: tabLabel, suffix: routeSuffix }
  );
  await waitForInventoryRows(page, targetKind);
}

async function readRows(page, targets) {
  const requested = targets.map((target) => {
    const projected = withPlatformTargetAliases("rocket_now", target);
    return { kind: projected.kind, label: projected.label, ...targetNameTiers(projected) };
  });
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    const rowFor = (element) => {
      const stable = element?.closest('label, [role="row"], li, div[class*=e1iqhfx24]');
      if (stable && stable.querySelector('input[type="checkbox"], input[type="checkBox"]')) return stable;
      let current = element?.parentElement;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        const text = normalize(current.textContent);
        if (text.length < 1200 && current.querySelector('input[type="checkbox"], input[type="checkBox"]')) return current;
      }
      return null;
    };
    const checkboxRows = [...document.querySelectorAll('input[type="checkbox"], input[type="checkBox"]')]
      .map(rowFor).filter((row) => row?.getClientRects().length);
    const rowParts = (row) => (row?.innerText ?? row?.textContent ?? "")
      .split(/\n|[|｜]/u).map(normalize).filter(Boolean);
    return items.map((item) => {
      const findRows = (names) => {
        const wanted = new Set(names.map(normalize));
        const primary = titles
          .filter((title) => normalize(title.textContent).split(/[|｜]/u).some((part) => wanted.has(part.trim())))
          .map(rowFor)
          .filter(Boolean);
        const found = primary.length ? primary : checkboxRows
          .filter((row) => rowParts(row).some((part) => wanted.has(part)));
        return [...new Set(found)];
      };
      const exactRows = findRows(item.exactNames);
      const fallbackRows = exactRows.length ? [] : findRows(item.fallbackNames);
      const aliasRows = exactRows.length || fallbackRows.length ? [] : findRows(item.aliasNames);
      const rows = exactRows.length ? exactRows : fallbackRows.length ? fallbackRows : aliasRows;
      const matches = rows.map((row) => ({
        text: normalize(row.textContent),
        checkboxId: row.querySelector('input[type="checkbox"],input[type="checkBox"]')?.id ?? "",
        hidden: normalize(row.textContent).includes("非表示")
      }));
      return {
        kind: item.kind,
        label: item.label,
        names: exactRows.length
          ? item.exactNames
          : fallbackRows.length
            ? item.fallbackNames
            : item.aliasNames,
        matches: matches.length ? [{
          ...matches[0],
          rowMatches: matches,
          hidden: matches.every((match) => match.hidden)
        }] : []
      };
    });
  }, requested);
}

async function waitForRows(page, items, hidden, targetKind) {
  const verify = async () => page.waitForFunction(({ requested, expectedHidden }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll(".nested-checkbox-list__sub_title")];
    const rowFor = (element) => {
      const stable = element?.closest('label, [role="row"], li, div[class*=e1iqhfx24]');
      if (stable && stable.querySelector('input[type="checkbox"], input[type="checkBox"]')) return stable;
      let current = element?.parentElement;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        if (normalize(current.textContent).length < 1200 && current.querySelector('input[type="checkbox"], input[type="checkBox"]')) return current;
      }
      return null;
    };
    const checkboxRows = [...document.querySelectorAll('input[type="checkbox"], input[type="checkBox"]')]
      .map(rowFor).filter((row) => row?.getClientRects().length);
    const rowParts = (row) => (row?.innerText ?? row?.textContent ?? "")
      .split(/\n|[|｜]/u).map(normalize).filter(Boolean);
    return requested.every((item) => {
      const wanted = new Set(item.names.map(normalize));
      const matchingTitles = titles.filter((candidate) => normalize(candidate.textContent).split(/[|｜]/u).some((part) => wanted.has(part.trim())));
      const matching = matchingTitles.length
        ? matchingTitles.map(rowFor).filter(Boolean)
        : checkboxRows.filter((row) => rowParts(row).some((part) => wanted.has(part)));
      return matching.length > 0 && matching.every((row) => {
        return Boolean(row) && normalize(row.textContent).includes("非表示") === expectedHidden;
      });
    });
  }, { timeout: 15000 }, { requested: items, expectedHidden: hidden });

  try {
    await verify();
  } catch {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    await waitForInventoryRows(page, targetKind);
    await verify();
  }
}

export function uniqueLocatedRows(items) {
  const rows = new Map();
  for (const item of items) {
    const rowMatches = item.matches[0]?.rowMatches ?? item.matches;
    for (const match of rowMatches) {
      const checkboxId = match?.checkboxId ?? "";
      if (checkboxId && !rows.has(checkboxId)) {
        rows.set(checkboxId, { ...item, matches: [{ ...match, rowMatches: [match] }] });
      }
    }
  }
  return [...rows.values()];
}

export class RocketNowAdapter {
  constructor(session, config = {}) {
    this.session = session;
    this.config = config;
  }

  inventoryUrl(targetKind) {
    return rocketInventoryUrl(this.config.storeId, targetKind);
  }

  async inspect() {
    const page = await this.session.goto(this.inventoryUrl("item"));
    const summary = await pageSummary(page);
    return { platform: "rocket_now", ...loginState(summary, "売り切れ・非表示") };
  }

  async locateTargets(targets) {
    const targetKind = targets.every((target) => target.kind === "option") ? "option" : "item";
    const page = await this.session.goto(this.inventoryUrl(targetKind));
    await selectInventoryTab(page, targetKind);
    return readRows(page, targets);
  }

  async setInventory(payload, located) {
    const targetKind = located.every((item) => item.kind === "option") ? "option" : "item";
    const page = await this.session.goto(this.inventoryUrl(targetKind));
    await selectInventoryTab(page, targetKind);
    const desiredHidden = payload.isAvailable !== true;
    const fresh = await readRows(page, located.map((item) => ({ kind: item.kind, label: item.label, aliases: item.names })));
    const changing = fresh.flatMap((item) => {
      const rowMatches = (item.matches[0]?.rowMatches ?? item.matches)
        .filter((match) => match.hidden !== desiredHidden);
      return rowMatches.length ? [{
        ...item,
        matches: [{ ...rowMatches[0], rowMatches }]
      }] : [];
    });
    if (!changing.length) return { outcome: "already_applied", changed: 0, desiredHidden };

    const uniqueChanging = uniqueLocatedRows(changing);

    if (!desiredHidden) {
      for (const item of uniqueChanging) {
        const clicked = await page.evaluate((checkboxId) => {
          const checkbox = document.getElementById(checkboxId);
          let row = checkbox?.closest('label, [role="row"], li, div[class*=e1iqhfx24]');
          for (let depth = 0; row && depth < 7 && ![...row.querySelectorAll("button")].some((button) => button.textContent?.trim() === "解除"); depth += 1) {
            row = row.parentElement;
          }
          const button = [...(row?.querySelectorAll("button") ?? [])]
            .find((candidate) => candidate.textContent?.trim() === "解除");
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        }, item.matches[0].checkboxId);
        if (!clicked) throw platformUiChanged("rocket_now", `unhide_button:${item.label}`);
        await waitForRows(page, [item], false, targetKind);
      }
      return { outcome: "applied", changed: uniqueChanging.length, desiredHidden };
    }

    for (const item of uniqueChanging) {
      const checkboxId = item.matches[0].checkboxId;
      if (!checkboxId) throw platformUiChanged("rocket_now", `checkbox:${item.label}`);
      await page.evaluate((id) => document.getElementById(id)?.click(), checkboxId);
      await page.waitForSelector('[data-testid="FloatingPopup"]', { visible: true, timeout: 10000 });
      const selectedHide = await page.evaluate(() => {
        const popup = document.querySelector('[data-testid="FloatingPopup"]');
        if (document.querySelector('input[type="radio"][value="HIDE"]')) return true;
        const trigger = [...(popup?.querySelectorAll('[role="combobox"], button, [tabindex="0"]') ?? [])]
          .find((candidate) => candidate.getClientRects().length && /表示|売り切れ|ステータス/u.test(candidate.textContent ?? ""))
          ?? popup?.querySelector(":scope > div > div");
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.click();
        return true;
      });
      if (!selectedHide) throw platformUiChanged("rocket_now", "status_picker");
      await delay(250);
      const hideSelected = await page.evaluate(() => {
        const input = document.querySelector('input[type="radio"][value="HIDE"]');
        if (!(input instanceof HTMLInputElement)) return false;
        input.click();
        return input.checked;
      });
      if (!hideSelected) throw platformUiChanged("rocket_now", "hide_option");
      const applied = await page.evaluate(() => {
        const popup = document.querySelector('[data-testid="FloatingPopup"]');
        const button = [...(popup?.querySelectorAll("button") ?? [])]
          .find((candidate) => candidate.textContent?.trim() === "適用");
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      });
      if (!applied) throw platformUiChanged("rocket_now", "apply_button");
      await waitForRows(page, [item], true, targetKind);
    }
    return { outcome: "applied", changed: uniqueChanging.length, desiredHidden };
  }
}
