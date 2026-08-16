import { setTimeout as delay } from "node:timers/promises";

import { CdpPage } from "../cdp-page.mjs";
import { loginState, platformUiChanged, targetNameTiers } from "./common.mjs";

const UBER_ORIGIN = "https://merchants.ubereats.com/";
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
      const requested = targets.map((target) => ({ label: target.label, ...targetNameTiers(target) }));
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

  async readSoldOutState(page) {
    return page.evaluate(`(() => {
      const checkbox = document.querySelector('input[name="itemSuspensionState"]');
      return checkbox instanceof HTMLInputElement ? { found: true, checked: checkbox.checked } : { found: false, checked: false };
    })()`);
  }

  async setInventory(payload, located) {
    const desiredSoldOut = payload.isAvailable !== true;
    const page = await this.connect();
    let changed = 0;
    try {
      for (const item of located) {
        const href = item.matches[0]?.href;
        if (!href) throw platformUiChanged("uber_eats", `item_link:${item.label}`);
        await page.navigate(href);
        await page.waitFor(`Boolean(document.querySelector('input[name="itemSuspensionState"]'))`);
        const before = await this.readSoldOutState(page);
        if (!before.found) throw platformUiChanged("uber_eats", `sold_out_control:${item.label}`);
        if (before.checked === desiredSoldOut) continue;
        const saved = await page.evaluate(`(() => {
          const checkbox = document.querySelector('input[name="itemSuspensionState"]');
          if (!(checkbox instanceof HTMLInputElement)) return false;
          checkbox.click();
          const save = [...document.querySelectorAll("button")]
            .find((button) => button.getClientRects().length && !button.disabled && /^(保存|保存する)$/u.test(button.textContent?.trim() ?? ""));
          if (!(save instanceof HTMLButtonElement)) return false;
          save.click();
          return true;
        })()`);
        if (!saved) throw platformUiChanged("uber_eats", `save_button:${item.label}`);
        await delay(1500);
        await page.navigate(this.itemsUrl());
        await page.waitFor(`Boolean(document.querySelector('a[href*="/items/"]'))`);
        await page.navigate(href);
        await page.waitFor(`Boolean(document.querySelector('input[name="itemSuspensionState"]'))`);
        const after = await this.readSoldOutState(page);
        if (!after.found || after.checked !== desiredSoldOut) {
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
