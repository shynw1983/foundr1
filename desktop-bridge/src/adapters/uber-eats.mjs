import { setTimeout as delay } from "node:timers/promises";

import { CdpPage } from "../cdp-page.mjs";
import { loginState, normalizeText, platformUiChanged, targetNameTiers } from "./common.mjs";

const UBER_ORIGIN = "https://merchants.ubereats.com/";
const STRICT_EXACT_UBER_LABELS = new Set([
  normalizeText("さつまいも板春雨50g")
]);
const NORMALIZE_SOURCE = `const normalize = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/【[^】]*】|\\[[^\\]]*\\]/g, " ")
  .replace(/[\\p{Extended_Pictographic}\\uFE0F\\u200D\\u20E3]/gu, "")
  .replace(/[\\s\\u200b-\\u200d\\ufeff]+/g, " ")
  .trim();`;

export function preferCurrentUberMatches(matches) {
  if (matches.length < 2) return matches;
  const scored = matches.map((match) => ({
    match,
    score: Number(match.price > 0)
      + Number(match.hasSchedule) * 2
      + Number(match.hasCustomization) * 2
      + Number(match.decorated)
  }));
  const highest = Math.max(...scored.map((entry) => entry.score));
  const preferred = scored.filter((entry) => entry.score === highest).map((entry) => entry.match);
  return preferred.length === 1 ? preferred : matches;
}

export function uberTargetNameTiers(target) {
  const tiers = targetNameTiers(target);
  if (!STRICT_EXACT_UBER_LABELS.has(normalizeText(target?.label))) return tiers;
  return {
    ...tiers,
    primaryNames: tiers.exactNames,
    fallbackNames: [],
    aliasNames: []
  };
}

export function parseUberSoldOutDuration(value) {
  return String(value ?? "")
    .trim()
    .replace(/^Selected\s+/iu, "")
    .replace(/[.。．\s]+$/gu, "")
    .trim();
}

function itemPath(value) {
  try {
    return new URL(String(value ?? "")).pathname.replace(/\/$/u, "");
  } catch {
    return "";
  }
}

export function uberItemDetailMatches(item, state) {
  if (!itemPath(item?.matches?.[0]?.href) || itemPath(item?.matches?.[0]?.href) !== itemPath(state?.url)) return false;
  const currentParts = normalizeText(state?.itemName)
    .split(/[|｜]/u)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter(Boolean);
  const expectedNames = [item?.label, ...(Array.isArray(item?.names) ? item.names : [])]
    .map((name) => normalizeText(name).toLocaleLowerCase())
    .filter(Boolean);
  return Boolean(state?.found) && expectedNames.some((name) => currentParts.includes(name));
}

export class UberEatsAdapter {
  constructor(session, platformConfig = {}) {
    this.session = session;
    this.platformConfig = platformConfig;
  }

  itemsUrl() {
    const storeUuid = String(this.platformConfig.storeUuid ?? "").trim();
    if (!storeUuid) return "https://merchants.ubereats.com/manager";
    return `https://merchants.ubereats.com/manager/menumaker/${storeUuid}/items`;
  }

  async connect() {
    const port = await this.session.ensureRunning();
    return CdpPage.connect(port, UBER_ORIGIN);
  }

  async openItemsPage(page) {
    const url = this.itemsUrl();
    const current = await page.evaluate("location.href");
    if (current !== url) await page.navigate(url);
    await page.waitFor(`Boolean(document.querySelector('a[href*="/items/"]'))`);
  }

  async inspect() {
    const page = await this.connect();
    try {
      await page.navigate(this.itemsUrl());
      await delay(1000);
      const summary = await page.evaluate(`({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText ?? "").slice(0, 5000)
      })`);
      return { platform: "uber_eats", ...loginState(summary, "商品") };
    } finally {
      page.close();
    }
  }

  async locateTargets(targets) {
    const page = await this.connect();
    try {
      await this.openItemsPage(page);
      const requested = targets.map((target) => ({ label: target.label, ...uberTargetNameTiers(target) }));
      return await page.evaluate(`(() => {
        ${NORMALIZE_SOURCE}
        const items = ${JSON.stringify(requested)};
        const anchors = [...document.querySelectorAll('a[href*="/items/"]')]
          .filter((anchor) => anchor.getClientRects().length);
        return items.map((item) => {
          const findMatches = (names) => {
            const wanted = new Set(names.map(normalize));
            const found = anchors
              .filter((anchor) => normalize(anchor.textContent).split(/[|｜]/u).some((part) => wanted.has(part.trim())))
              .map((anchor) => {
                let record = anchor.closest('tr, [role="row"], .cw.bd.il.r6.cu');
                if (!record) {
                  let current = anchor.parentElement;
                  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
                    const text = current.innerText ?? current.textContent ?? "";
                    if (text.length < 1600 && text.split("\\n").filter(Boolean).length >= 2) {
                      record = current;
                      break;
                    }
                  }
                }
                const lines = (record?.innerText ?? "")
                  .split("\\n").map((line) => line.trim()).filter(Boolean);
                const price = Number(String(lines[1] ?? "").replace(/[^0-9]/g, "")) || 0;
                return {
                  text: normalize(anchor.textContent),
                  href: anchor.href,
                  price,
                  hasSchedule: Boolean(lines[2] && lines[2] !== "-"),
                  hasCustomization: Boolean(lines[5] && lines[5] !== "-"),
                  decorated: /【|[\\p{Extended_Pictographic}]/u.test(anchor.textContent ?? "")
                };
              });
            const unique = [...new Map(found.map((match) => [match.href, match])).values()];
            if (unique.length < 2) return unique;
            const scored = unique.map((match) => ({
              match,
              score: Number(match.price > 0)
                + Number(match.hasSchedule) * 2
                + Number(match.hasCustomization) * 2
                + Number(match.decorated)
            }));
            const highest = Math.max(...scored.map((entry) => entry.score));
            const preferred = scored.filter((entry) => entry.score === highest).map((entry) => entry.match);
            return preferred.length === 1 ? preferred : unique;
          };
          const exactMatches = findMatches(item.exactNames);
          const fallbackMatches = exactMatches.length ? [] : findMatches(item.fallbackNames);
          const aliasMatches = exactMatches.length || fallbackMatches.length ? [] : findMatches(item.aliasNames);
          const matches = exactMatches.length ? exactMatches : fallbackMatches.length ? fallbackMatches : aliasMatches;
          return {
            label: item.label,
            names: exactMatches.length
              ? item.exactNames
              : fallbackMatches.length
                ? item.fallbackNames
                : item.aliasNames,
            matches
          };
        });
      })()`);
    } finally {
      page.close();
    }
  }

  async readItemDetailState(page) {
    return page.evaluate(`(() => {
      const checkbox = document.querySelector('input[name="itemSuspensionState"]');
      const nameInput = document.querySelector('input[name="name"]');
      const duration = [...document.querySelectorAll('input[role="combobox"][aria-label^="Selected "]')]
        .map((input) => String(input.getAttribute("aria-label") ?? "")
          .trim()
          .replace(/^Selected\\s+/iu, "")
          .replace(/[.。．\\s]+$/gu, "")
          .trim())
        .find(Boolean) ?? "";
      return checkbox instanceof HTMLInputElement && nameInput instanceof HTMLInputElement
        ? { found: true, checked: checkbox.checked, itemName: nameInput.value, duration, url: location.href }
        : { found: false, checked: false, itemName: "", duration: "", url: location.href };
    })()`);
  }

  async openInventoryItem(page, item) {
    const href = item.matches[0]?.href;
    if (!href) throw platformUiChanged("uber_eats", `item_link:${item.label}`);
    await Promise.race([
      page.navigate(href),
      delay(30000).then(() => {
        throw new Error(`uber_eats_item_navigation_timeout:${item.label}`);
      })
    ]);
    const deadline = Date.now() + 20000;
    let state = null;
    while (Date.now() < deadline) {
      try {
        state = await this.readItemDetailState(page);
        if (uberItemDetailMatches(item, state)) return state;
      } catch {
        // Uber may briefly replace the document while the next item is loading.
      }
      await delay(250);
    }
    throw new Error(`uber_eats_item_identity_timeout:${item.label}:${state?.itemName ?? ""}`);
  }

  async ensureIndefiniteSoldOut(page) {
    const current = await this.readItemDetailState(page);
    if (current.duration === "期限を設定しない") return;
    await page.waitFor(`[...document.querySelectorAll('input[role="combobox"][aria-label^="Selected "]')]
      .some((input) => input.getClientRects().length)`);
    const opened = await page.evaluate(`(() => {
      const combo = [...document.querySelectorAll('input[role="combobox"][aria-label^="Selected "]')]
        .find((input) => input.getClientRects().length);
      const trigger = combo?.parentElement?.parentElement?.querySelector('[value]');
      if (!(trigger instanceof HTMLElement)) return false;
      trigger.click();
      return true;
    })()`);
    if (!opened) throw platformUiChanged("uber_eats", "sold_out_duration_control");
    await page.waitFor(`[...document.querySelectorAll('[role="option"]')]
      .some((option) => option.getClientRects().length
        && String(option.textContent ?? "").trim().replace(/[.。．\\s]+$/gu, "") === ${JSON.stringify("期限を設定しない")})`);
    const selected = await page.evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find((candidate) => candidate.getClientRects().length
          && String(candidate.textContent ?? "").trim().replace(/[.。．\\s]+$/gu, "") === ${JSON.stringify("期限を設定しない")});
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`);
    if (!selected) throw platformUiChanged("uber_eats", "sold_out_duration_option");
    await page.waitFor(`[...document.querySelectorAll('input[role="combobox"][aria-label^="Selected "]')]
      .some((input) => input.getAttribute("aria-label")?.includes(${JSON.stringify("期限を設定しない")}))`);
  }

  async setInventory(payload, located) {
    const desiredSoldOut = payload.isAvailable !== true;
    const page = await this.connect();
    let changed = 0;
    try {
      for (const item of located) {
        const before = await this.openInventoryItem(page, item);
        if (!before.found) throw platformUiChanged("uber_eats", `sold_out_control:${item.label}`);
        const durationNeedsUpdate = desiredSoldOut
          && payload.soldOutMode === "indefinite"
          && before.duration !== "期限を設定しない";
        if (before.checked === desiredSoldOut && !durationNeedsUpdate) continue;
        if (before.checked !== desiredSoldOut) {
          const toggled = await page.evaluate(`(() => {
            const checkbox = document.querySelector('input[name="itemSuspensionState"]');
            if (!(checkbox instanceof HTMLInputElement)) return false;
            checkbox.click();
            return true;
          })()`);
          if (!toggled) throw platformUiChanged("uber_eats", `sold_out_control:${item.label}`);
        }
        if (desiredSoldOut && payload.soldOutMode === "indefinite") {
          await this.ensureIndefiniteSoldOut(page);
        }
        await page.waitFor(`[...document.querySelectorAll("button")]
          .some((button) => button.getClientRects().length && !button.disabled
            && /^(保存|保存する)$/u.test(button.textContent?.trim() ?? ""))`);
        const saved = await page.evaluate(`(() => {
          const checkbox = document.querySelector('input[name="itemSuspensionState"]');
          const save = [...document.querySelectorAll("button")]
            .find((button) => button.getClientRects().length && !button.disabled && /^(保存|保存する)$/u.test(button.textContent?.trim() ?? ""));
          if (!(checkbox instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement)) return false;
          save.click();
          return true;
        })()`);
        if (!saved) throw platformUiChanged("uber_eats", `save_button:${item.label}`);
        await delay(1500);
        await page.navigate(this.itemsUrl());
        await page.waitFor(`Boolean(document.querySelector('a[href*="/items/"]'))`);
        const after = await this.openInventoryItem(page, item);
        const durationVerified = !desiredSoldOut
          || payload.soldOutMode !== "indefinite"
          || after.duration === "期限を設定しない";
        if (!after.found || after.checked !== desiredSoldOut || !durationVerified) {
          throw new Error(`uber_eats_verification_failed:${item.label}`);
        }
        changed += 1;
      }
      return { outcome: changed ? "applied" : "already_applied", changed, desiredSoldOut };
    } finally {
      page.close();
    }
  }
}
