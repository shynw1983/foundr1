import { loginState, pageSummary, targetNames } from "./common.mjs";

const STOCKOUT_URL = "https://partner.demae-can.com/merchant-admin/shop/stockout";

async function readRows(page, targets) {
  const requested = targets.map((target) => ({ label: target.label, names: targetNames(target) }));
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    return items.map((item) => {
      const wanted = item.names.map(normalize);
      const rows = titles
        .filter((title) => wanted.some((name) => normalize(title.textContent) === name || normalize(title.textContent).startsWith(`${name}|`)))
        .map((title) => title.closest("label[class*=TableSubRow_tableSubRow]"))
        .filter(Boolean);
      return {
        label: item.label,
        names: item.names,
        matches: rows.map((row, index) => ({
          text: normalize(row.textContent),
          matchIndex: index,
          unavailable: /品切れ|終売/u.test(normalize(row.textContent)),
          permanentlyUnavailable: /終売|無期限/u.test(normalize(row.textContent))
        }))
      };
    });
  }, requested);
}

async function clickRows(page, items) {
  for (const item of items) {
    const clicked = await page.evaluate((names) => {
      const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
      const wanted = names.map(normalize);
      const candidates = [...document.querySelectorAll("[class*=Styles_name__]")]
        .filter((title) => wanted.some((name) => normalize(title.textContent) === name || normalize(title.textContent).startsWith(`${name}|`)));
      if (candidates.length !== 1) return false;
      const row = candidates[0].closest("label[class*=TableSubRow_tableSubRow]");
      const checkbox = row?.querySelector('input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) return false;
      checkbox.click();
      return true;
    }, item.names);
    if (!clicked) throw new Error(`demae_can_checkbox_missing:${item.label}`);
  }
}

async function waitForRows(page, items, permanentlyUnavailable) {
  await page.waitForFunction(({ requested, expectedPermanentlyUnavailable }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    return requested.every((item) => {
      const wanted = item.names.map(normalize);
      const title = titles.find((candidate) => wanted.some((name) => normalize(candidate.textContent) === name || normalize(candidate.textContent).startsWith(`${name}|`)));
      const rowText = normalize(title?.closest("label[class*=TableSubRow_tableSubRow]")?.textContent);
      return Boolean(title) && (expectedPermanentlyUnavailable
        ? /終売|無期限/u.test(rowText)
        : !/品切れ|終売/u.test(rowText));
    });
  }, { timeout: 15000 }, { requested: items, expectedPermanentlyUnavailable: permanentlyUnavailable });
}

async function waitForVisibleForm(page, selector, errorCode) {
  try {
    await page.waitForFunction((formSelector) => {
      const form = document.querySelector(formSelector);
      const rect = form?.getBoundingClientRect();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    }, { timeout: 5000 }, selector);
  } catch {
    throw new Error(errorCode);
  }
}

export class DemaeCanAdapter {
  constructor(session) {
    this.session = session;
  }

  async inspect() {
    const page = await this.session.goto(STOCKOUT_URL);
    const summary = await pageSummary(page);
    return { platform: "demae_can", ...loginState(summary, "品切れ終売設定") };
  }

  async locateTargets(targets) {
    const page = await this.session.goto(STOCKOUT_URL);
    return readRows(page, targets);
  }

  async setInventory(payload, located) {
    const page = await this.session.goto(STOCKOUT_URL);
    // Demae leaves selection and confirmation overlays mounted after a slow or
    // interrupted submission. Always begin an execution from a clean page so
    // the next command cannot interact with stale modal state.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("[class*=Styles_name__]", { visible: true, timeout: 15000 });
    const desiredUnavailable = payload.isAvailable !== true;
    const fresh = await readRows(page, located.map((item) => ({ label: item.label, aliases: item.names })));
    const changing = fresh.filter((item) => desiredUnavailable
      ? item.matches[0]?.permanentlyUnavailable !== true
      : item.matches[0]?.unavailable === true);
    if (!changing.length) return { outcome: "already_applied", changed: 0, desiredUnavailable };

    await clickRows(page, changing);
    await page.waitForSelector("[class*=FloatingModal_isOpen]", { visible: true, timeout: 10000 });
    if (desiredUnavailable) {
      const opened = await page.evaluate(() => {
        const tab = document.querySelector('[data-key="stockoutSetting"]');
        if (!(tab instanceof HTMLElement)) return false;
        tab.click();
        return true;
      });
      if (!opened) throw new Error("demae_can_stockout_tab_missing");
      await waitForVisibleForm(page, "form[class*=StockoutSetting_form]", "demae_can_stockout_form_timeout");
      const selected = await page.evaluate(() => {
        const form = document.querySelector("form[class*=StockoutSetting_form]");
        const labels = [...(form?.querySelectorAll("label") ?? [])];
        const label = labels.find((candidate) => candidate.textContent?.trim() === "終売");
        const radio = label?.querySelector('input[type="radio"]');
        if (!(radio instanceof HTMLInputElement)) return false;
        radio.click();
        return true;
      });
      if (!selected) throw new Error("demae_can_indefinite_option_missing");
    } else {
      const opened = await page.evaluate(() => {
        const tab = document.querySelector('[data-key="stockoutDelete"]');
        if (!(tab instanceof HTMLElement)) return false;
        tab.click();
        return true;
      });
      if (!opened) throw new Error("demae_can_restore_tab_missing");
      await waitForVisibleForm(page, "form[class*=StockoutDelete_form]", "demae_can_restore_form_timeout");
    }
    const submitted = await page.evaluate((restoring) => {
      const selector = restoring ? "form[class*=StockoutDelete_form]" : "form[class*=StockoutSetting_form]";
      const form = document.querySelector(selector);
      const button = [...(form?.querySelectorAll("button") ?? [])]
        .find((candidate) => candidate.textContent?.trim() === "適用");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    }, !desiredUnavailable);
    if (!submitted) throw new Error("demae_can_apply_button_missing");
    try {
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => {
        const rect = button.getBoundingClientRect();
        return button.textContent?.trim() === "確定" && rect.width > 0 && rect.height > 0;
      }), { timeout: 5000 });
    } catch {
      throw new Error("demae_can_confirmation_timeout");
    }
    const confirmed = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return candidate.textContent?.trim() === "確定" && rect.width > 0 && rect.height > 0;
      });
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    });
    if (!confirmed) throw new Error("demae_can_confirmation_missing");
    try {
      await waitForRows(page, changing, desiredUnavailable);
    } catch {
      throw new Error("demae_can_verification_timeout");
    }
    return { outcome: "applied", changed: changing.length, desiredUnavailable };
  }
}
