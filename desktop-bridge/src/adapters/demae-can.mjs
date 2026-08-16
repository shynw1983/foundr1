import { loginState, pageSummary, targetNameTiers } from "./common.mjs";
import { withPlatformTargetAliases } from "./platform-target-aliases.mjs";
import { loadDemaeCredentials } from "../demae-credentials.mjs";

const STOCKOUT_URL = "https://partner.demae-can.com/merchant-admin/shop/stockout";
const LOGIN_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

function isLoginPage(summary) {
  return /\/merchant-admin\/login(?:[/?#]|$)/u.test(summary.url)
    || (/ログイン/u.test(summary.text) && /パスワード/u.test(summary.text));
}

async function fillInput(page, selector, value) {
  const input = await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => null);
  if (!input) return false;
  await input.click({ clickCount: 3 });
  await input.press("Backspace");
  await input.type(value);
  return true;
}

async function waitForInventoryRows(page) {
  await page.waitForSelector("[class*=Styles_name__]", { visible: true, timeout: 30000 });
}

async function readRows(page, targets) {
  const requested = targets.map((target) => {
    const projected = withPlatformTargetAliases("demae_can", target);
    return { label: projected.label, ...targetNameTiers(projected) };
  });
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    return items.map((item) => {
      const findRows = (names) => {
        const wanted = names.map(normalize);
        return titles
          .filter((title) => {
            const titleParts = normalize(title.textContent).split(/[|｜]/u).map((part) => part.trim());
            return wanted.some((name) => titleParts.includes(name));
          })
          .map((title) => title.closest("label[class*=TableSubRow_tableSubRow]"))
          .filter(Boolean);
      };
      const exactRows = findRows(item.exactNames);
      const fallbackRows = exactRows.length ? [] : findRows(item.fallbackNames);
      const aliasRows = exactRows.length || fallbackRows.length ? [] : findRows(item.aliasNames);
      const rows = exactRows.length ? exactRows : fallbackRows.length ? fallbackRows : aliasRows;
      const matches = rows.map((row, index) => ({
        text: normalize(row.textContent),
        rowId: row.querySelector('input[type="checkbox"]')?.id ?? "",
        matchIndex: index,
        unavailable: /品切れ|終売/u.test(normalize(row.textContent)),
        permanentlyUnavailable: /終売|無期限/u.test(normalize(row.textContent))
      }));
      return {
        label: item.label,
        names: exactRows.length
          ? item.exactNames
          : fallbackRows.length
            ? item.fallbackNames
            : item.aliasNames,
        matches: matches.length ? [{
          ...matches[0],
          rowMatches: matches,
          unavailable: matches.some((match) => match.unavailable),
          permanentlyUnavailable: matches.every((match) => match.permanentlyUnavailable)
        }] : []
      };
    });
  }, requested);
}

async function clickRows(page, items) {
  for (const item of items) {
    const rowIds = (item.matches[0]?.rowMatches ?? item.matches)
      .map((match) => match.rowId).filter(Boolean);
    const clicked = await page.evaluate((ids) => ids.every((id) => {
      const checkbox = document.getElementById(id);
      if (!(checkbox instanceof HTMLInputElement)) return false;
      checkbox.click();
      return true;
    }), rowIds);
    if (!clicked) throw new Error(`demae_can_checkbox_missing:${item.label}`);
  }
}

async function waitForRows(page, items, permanentlyUnavailable) {
  await page.waitForFunction(({ requested, expectedPermanentlyUnavailable }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    return requested.every((item) => {
      const wanted = item.names.map(normalize);
      const matching = titles.filter((candidate) => {
        const titleParts = normalize(candidate.textContent).split(/[|｜]/u).map((part) => part.trim());
        return wanted.some((name) => titleParts.includes(name));
      });
      return matching.length > 0 && matching.every((title) => {
        const rowText = normalize(title.closest("label[class*=TableSubRow_tableSubRow]")?.textContent);
        return expectedPermanentlyUnavailable ? /終売|無期限/u.test(rowText) : !/品切れ|終売/u.test(rowText);
      });
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
  constructor(session, config = {}, credentialLoader = loadDemaeCredentials) {
    this.session = session;
    this.config = config;
    this.credentialLoader = credentialLoader;
    this.loginPromise = null;
    this.lastLoginFailureAt = 0;
    this.lastLoginFailure = "";
  }

  async ensureAuthenticated(page) {
    const initial = await pageSummary(page);
    if (loginState(initial, "品切れ終売設定").ok) return page;
    if (!isLoginPage(initial)) throw new Error("demae_can_page_unavailable");
    if (this.config.autoLogin === false) throw new Error("demae_can_login_required");
    if (this.lastLoginFailureAt && Date.now() - this.lastLoginFailureAt < LOGIN_FAILURE_COOLDOWN_MS) {
      throw new Error(this.lastLoginFailure || "demae_can_login_cooldown");
    }
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.login(page).catch((error) => {
      this.lastLoginFailureAt = Date.now();
      this.lastLoginFailure = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async login(page) {
    const credentials = await this.credentialLoader();
    const beforeLogin = await pageSummary(page);
    if (/CAPTCHA|reCAPTCHA|画像認証|認証コード|ワンタイムパスワード/u.test(beforeLogin.text)) {
      throw new Error("demae_can_login_manual_verification_required");
    }
    let hasCodeForm = await page.$('input[name="handleCd"]');
    if (!hasCodeForm) {
      await page.evaluate(() => {
        const candidates = [...document.querySelectorAll("button, [role=tab]")];
        const tab = candidates.find((element) => /コード|ログインID/u.test(element.textContent ?? ""));
        if (tab instanceof HTMLElement) tab.click();
      });
      hasCodeForm = await page.waitForSelector('input[name="handleCd"]', { visible: true, timeout: 5000 }).catch(() => null);
    }
    if (!hasCodeForm) throw new Error("demae_can_login_form_missing");
    const completed = [];
    const codeForm = 'form:has(input[name="handleCd"])';
    completed.push(await fillInput(page, `${codeForm} input[name="handleCd"]`, credentials.handleCode));
    completed.push(await fillInput(page, `${codeForm} input[name="loginId"]`, credentials.loginId));
    completed.push(await fillInput(page, `${codeForm} input[name="password"]`, credentials.password));
    if (completed.some((value) => !value)) throw new Error("demae_can_login_form_missing");
    const submitted = await page.evaluate(() => {
      const form = document.querySelector('input[name="handleCd"]')?.closest("form");
      const button = [...(form?.querySelectorAll("button") ?? [])]
        .find((candidate) => candidate.textContent?.trim() === "ログイン");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    });
    if (!submitted) throw new Error("demae_can_login_submit_missing");
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? "";
      return text.includes("品切れ終売設定")
        || text.includes("一致していません")
        || text.includes("アカウントがロックされました")
        || text.includes("仮パスワードの有効期限が切れています")
        || !location.pathname.includes("/login");
    }, { timeout: 30000 }).catch(() => undefined);
    const result = await pageSummary(page);
    if (/アカウントがロックされました/u.test(result.text)) throw new Error("demae_can_login_account_locked");
    if (/一致していません/u.test(result.text)) throw new Error("demae_can_login_credentials_rejected");
    if (/仮パスワードの有効期限が切れています/u.test(result.text)) throw new Error("demae_can_login_password_expired");
    if (/CAPTCHA|reCAPTCHA|画像認証|認証コード|ワンタイムパスワード/u.test(result.text)) {
      throw new Error("demae_can_login_manual_verification_required");
    }
    if (!loginState(result, "品切れ終売設定").ok) {
      await page.goto(STOCKOUT_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    }
    const verified = await pageSummary(page);
    if (!loginState(verified, "品切れ終売設定").ok) throw new Error("demae_can_login_failed");
    this.lastLoginFailureAt = 0;
    this.lastLoginFailure = "";
    return page;
  }

  async inspect() {
    const page = await this.session.goto(STOCKOUT_URL);
    await this.ensureAuthenticated(page);
    const summary = await pageSummary(page);
    return { platform: "demae_can", ...loginState(summary, "品切れ終売設定") };
  }

  async refreshInventoryPage(page) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    await this.ensureAuthenticated(page);
    await waitForInventoryRows(page);
  }

  async readInventoryRowsWithAuthRecovery(page, targets) {
    let refreshed = false;
    try {
      await waitForInventoryRows(page);
    } catch {
      await this.refreshInventoryPage(page);
      refreshed = true;
    }

    let located = await readRows(page, targets);
    if (!refreshed && located.some((item) => item.matches.length === 0)) {
      // Demae can leave the expired stockout page and its old DOM visible while
      // showing only a small request-error notice. A hard reload is required to
      // expose the login redirect, after which ensureAuthenticated can log in.
      await this.refreshInventoryPage(page);
      located = await readRows(page, targets);
    }
    return located;
  }

  async locateTargets(targets) {
    const page = await this.session.goto(STOCKOUT_URL);
    await this.ensureAuthenticated(page);
    return this.readInventoryRowsWithAuthRecovery(page, targets);
  }

  async setInventory(payload, located) {
    const page = await this.session.goto(STOCKOUT_URL);
    await this.ensureAuthenticated(page);
    // locateTargets has just verified this same page. Reusing it is more reliable
    // than reloading Demae's slow inventory screen before every save.
    const desiredUnavailable = payload.isAvailable !== true;
    const fresh = await this.readInventoryRowsWithAuthRecovery(
      page,
      located.map((item) => ({ label: item.label, aliases: item.names }))
    );
    const disappeared = fresh.filter((item) => item.matches.length === 0);
    if (disappeared.length) {
      throw new Error(`demae_can_target_disappeared:${disappeared.map((item) => item.label).join(",")}`);
    }
    const changing = fresh.flatMap((item) => {
      const rowMatches = (item.matches[0]?.rowMatches ?? item.matches).filter((match) => desiredUnavailable
        ? match.permanentlyUnavailable !== true
        : match.unavailable === true);
      return rowMatches.length ? [{
        ...item,
        matches: [{ ...rowMatches[0], rowMatches }]
      }] : [];
    });
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
