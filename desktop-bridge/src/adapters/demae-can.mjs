import { loginState, pageSummary, platformUiChanged, targetNameTiers } from "./common.mjs";
import { withPlatformTargetAliases } from "./platform-target-aliases.mjs";
import { loadDemaeCredentials } from "../demae-credentials.mjs";

const STOCKOUT_URL = "https://partner.demae-can.com/merchant-admin/shop/stockout";
const LOGIN_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

function isLoginPage(summary) {
  return /\/merchant-admin\/login(?:[/?#]|$)/u.test(summary.url)
    || (/ログイン/u.test(summary.text) && /パスワード/u.test(summary.text));
}

export async function fillInput(page, selector, value) {
  const input = await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => null);
  if (!input) return false;
  await input.dispose?.().catch(() => undefined);
  return page.evaluate(({ selectorValue, inputValue }) => {
    const element = document.querySelector(selectorValue);
    if (!(element instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(element, inputValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value === inputValue;
  }, { selectorValue: selector, inputValue: value });
}

async function waitForInventoryRows(page) {
  if (typeof page.waitForFunction !== "function") {
    await page.waitForSelector("[class*=Styles_name__]", { visible: true, timeout: 30000 });
    return;
  }
  await page.waitForFunction(() => {
    const visible = (element) => Boolean(element?.getClientRects().length);
    return [...document.querySelectorAll("[class*=Styles_name__]")].some(visible)
      || [...document.querySelectorAll('label input[type="checkbox"]')]
        .some((input) => visible(input.closest("label")));
  }, { timeout: 30000 });
}

async function readRows(page, targets) {
  const requested = targets.map((target) => {
    const projected = withPlatformTargetAliases("demae_can", target);
    return { kind: projected.kind, label: projected.label, ...targetNameTiers(projected) };
  });
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    const checkboxRows = [...document.querySelectorAll('label input[type="checkbox"]')]
      .map((input) => input.closest("label"))
      .filter((row) => row?.getClientRects().length);
    const rowParts = (row) => (row?.innerText ?? row?.textContent ?? "")
      .split(/\n|[|｜]/u).map(normalize).filter(Boolean);
    return items.map((item) => {
      const findRows = (names) => {
        const wanted = names.map(normalize);
        const primary = titles
          .filter((title) => {
            const titleParts = normalize(title.textContent).split(/[|｜]/u).map((part) => part.trim());
            return wanted.some((name) => titleParts.includes(name));
          })
          .map((title) => title.closest("label") ?? title.closest("tr") ?? title.parentElement)
          .filter(Boolean);
        if (primary.length) return primary;
        return checkboxRows
          .filter((row) => wanted.some((name) => rowParts(row).includes(name)))
          .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length);
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
          unavailable: matches.some((match) => match.unavailable),
          permanentlyUnavailable: matches.every((match) => match.permanentlyUnavailable)
        }] : []
      };
    });
  }, requested);
}

async function readAllRows(page, targets) {
  const requested = targets.map((target) => {
    const projected = withPlatformTargetAliases("demae_can", target);
    const tiers = targetNameTiers(projected);
    return {
      targetId: target.targetId,
      kind: target.kind,
      groupKey: target.groupKey ?? "",
      optionKey: target.optionKey ?? "",
     sourceBasePrice: target.sourceBasePrice ?? null,
     label: target.label,
      knownExternalIds: Array.isArray(target.knownExternalIds) ? target.knownExternalIds : [],
     names: [...tiers.exactNames, ...tiers.fallbackNames, ...tiers.aliasNames]
    };
  });
  return page.evaluate((items) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const targetRows = items.map((item) => ({ ...item, normalizedNames: [...new Set(item.names.map(normalize).filter(Boolean))] }));
    const unmappedTargetRows = targetRows.filter((target) => !target.knownExternalIds.length);
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")].filter((title) => title.getClientRects().length);
    const grouped = new Map();
    for (const title of titles) {
      const name = String(title.textContent ?? "").trim();
      const key = normalize(name);
      const row = title.closest("label") ?? title.closest("tr") ?? title.parentElement;
      if (!key || !row) continue;
      const current = grouped.get(key) ?? { name, rows: [] };
      current.rows.push(row);
      grouped.set(key, current);
    }
   const entries = [...grouped.entries()].map(([normalizedName, group]) => {
      const rowIds = [...new Set(group.rows.map((row) => row.querySelector('input[type="checkbox"]')?.id ?? "").filter(Boolean))].sort();
      const externalId = rowIds.join(",") || "unknown:" + normalizedName;
     const parts = normalizedName.split(/[|｜]/u).map((part) => part.trim()).filter(Boolean);
      const mappedCandidates = targetRows.filter((target) => target.knownExternalIds.some((knownId) => knownId === externalId || rowIds.includes(knownId)));
      const candidates = mappedCandidates.length
        ? mappedCandidates
        : unmappedTargetRows.filter((target) => target.normalizedNames.some((name) => parts.includes(name)));
     const target = candidates.length === 1 ? candidates[0] : null;
      const text = group.rows.map((row) => normalize(row.textContent)).join(" ");
      return {
        targetId: target?.targetId ?? "",
        externalId,
        groupKey: target?.groupKey ?? "",
        optionKey: target?.optionKey ?? "",
        name: group.name,
        price: null,
        sourceBasePrice: target?.sourceBasePrice ?? null,
        isActive: !/品切れ|終売/u.test(text),
        observedKind: target?.kind ?? "item",
        metadata: {
         rowIds,
         physicalRowCount: group.rows.length,
          matchBasis: mappedCandidates.length ? "external_id" : "name",
          kindConfidence: target ? "mapped" : "unknown",
         ambiguousTargetIds: candidates.length > 1 ? candidates.map((candidate) => candidate.targetId) : []
        }
      };
    });
    const matchedCounts = Object.fromEntries(targetRows.map((target) => [target.targetId, entries.filter((entry) => entry.targetId === target.targetId).length]));
    return {
      entries,
      missingTargets: targetRows.filter((target) => matchedCounts[target.targetId] !== 1).map((target) => target.label)
    };
  }, requested);
}

async function clickRows(page, items) {
  for (const item of items) {
    const rowIds = (item.matches[0]?.rowMatches ?? item.matches)
      .map((match) => match.rowId).filter(Boolean);
    const clicked = await page.evaluate((ids) => ids.every((id) => {
      const checkbox = document.getElementById(id);
      if (!(checkbox instanceof HTMLInputElement)) return false;
      if (!checkbox.checked) checkbox.click();
      if (!checkbox.checked) {
        const label = checkbox.closest("label");
        if (label instanceof HTMLLabelElement) label.click();
      }
      return checkbox.checked;
    }), rowIds);
    if (!clicked) throw platformUiChanged("demae_can", `row_selection:${item.label}`);
  }
}

async function waitForInventoryActionModal(page) {
  try {
    await page.waitForFunction(() => {
      const visible = (element) => {
        const rect = element?.getBoundingClientRect();
        return Boolean(rect && rect.width > 0 && rect.height > 0);
      };
      const stableControls = [
        document.querySelector('[data-key="stockoutSetting"]'),
        document.querySelector('[data-key="stockoutDelete"]'),
        document.querySelector('form[class*="StockoutSetting_form"]'),
        document.querySelector('form[class*="StockoutDelete_form"]')
      ];
      if (stableControls.some(visible)) return true;
      return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
        .some((dialog) => visible(dialog) && /品切れ|終売|解除|適用/u.test(dialog.textContent ?? ""));
    }, { timeout: 10000 });
  } catch {
    throw new Error("demae_can_inventory_modal_timeout");
  }
}

async function waitForRows(page, items, permanentlyUnavailable) {
  await page.waitForFunction(({ requested, expectedPermanentlyUnavailable }) => {
    const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/【[^】]*】|\[[^\]]*\]/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "").replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
    const titles = [...document.querySelectorAll("[class*=Styles_name__]")];
    const checkboxRows = [...document.querySelectorAll('label input[type="checkbox"]')]
      .map((input) => input.closest("label"))
      .filter((row) => row?.getClientRects().length);
    const rowParts = (row) => (row?.innerText ?? row?.textContent ?? "")
      .split(/\n|[|｜]/u).map(normalize).filter(Boolean);
    return requested.every((item) => {
      const wanted = item.names.map(normalize);
      const matchingTitles = titles.filter((candidate) => {
        const titleParts = normalize(candidate.textContent).split(/[|｜]/u).map((part) => part.trim());
        return wanted.some((name) => titleParts.includes(name));
      });
      const matching = matchingTitles.length
        ? matchingTitles.map((title) => title.closest("label") ?? title.closest("tr") ?? title.parentElement).filter(Boolean)
        : checkboxRows.filter((row) => wanted.some((name) => rowParts(row).includes(name)));
      return matching.length > 0 && matching.every((row) => {
        const rowText = normalize(row.textContent);
        return expectedPermanentlyUnavailable ? /終売|無期限/u.test(rowText) : !/品切れ|終売/u.test(rowText);
      });
    });
  }, { timeout: 15000 }, { requested: items, expectedPermanentlyUnavailable: permanentlyUnavailable });
}

async function waitForVisibleForm(page, selector, errorCode, timeout = 5000) {
  try {
    await page.waitForFunction((formSelector) => {
      const form = document.querySelector(formSelector);
      const rect = form?.getBoundingClientRect();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    }, { timeout }, selector);
  } catch {
    throw new Error(errorCode);
  }
}

async function openInventoryActionForm(page, tabKey, formSelector, missingCode, timeoutCode) {
  const opened = await page.evaluate((key) => {
    const tab = [...document.querySelectorAll(`[data-key="${key}"]`)]
      .find((candidate) => candidate.getClientRects().length);
    if (!(tab instanceof HTMLElement)) return false;
    tab.click();
    return true;
  }, tabKey);
  if (!opened) throw new Error(missingCode);

  try {
    await waitForVisibleForm(page, formSelector, timeoutCode, 750);
    return;
  } catch {
    // Demae's fixed table layer can cover the visible tab. In that state a
    // normal DOM click is ignored even though the React tab is rendered.
  }

  const activated = await page.evaluate((key) => {
    const tab = [...document.querySelectorAll(`[data-key="${key}"]`)]
      .find((candidate) => candidate.getClientRects().length);
    if (!(tab instanceof HTMLElement)) return false;
    const propsKey = Object.keys(tab).find((name) => name.startsWith("__reactProps$"));
    const handler = propsKey ? tab[propsKey]?.onClick : null;
    if (typeof handler !== "function") return false;
    handler({ currentTarget: tab, target: tab, preventDefault() {}, stopPropagation() {} });
    return true;
  }, tabKey);
  if (!activated) throw new Error(missingCode);
  await waitForVisibleForm(page, formSelector, timeoutCode);
}

async function waitForConfirmationButton(page, timeout = 5000) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => {
    const rect = button.getBoundingClientRect();
    return button.textContent?.trim() === "確定" && rect.width > 0 && rect.height > 0;
  }), { timeout });
}

async function submitInventoryActionForm(page, formSelector) {
  const submitted = await page.evaluate((selector) => {
    const form = [...document.querySelectorAll(selector)]
      .find((candidate) => candidate.getClientRects().length);
    const button = [...(form?.querySelectorAll("button") ?? [])]
      .find((candidate) => candidate.textContent?.trim() === "適用");
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  }, formSelector);
  if (!submitted) throw new Error("demae_can_apply_button_missing");

  try {
    await waitForConfirmationButton(page, 1000);
    return;
  } catch {
    // The same fixed layer can swallow the form's synthetic submit event.
  }

  const invoked = await page.evaluate((selector) => {
    const form = [...document.querySelectorAll(selector)]
      .find((candidate) => candidate.getClientRects().length);
    if (!(form instanceof HTMLFormElement)) return false;
    const propsKey = Object.keys(form).find((name) => name.startsWith("__reactProps$"));
    const handler = propsKey ? form[propsKey]?.onSubmit : null;
    if (typeof handler !== "function") return false;
    handler({ currentTarget: form, target: form, preventDefault() {}, stopPropagation() {} });
    return true;
  }, formSelector);
  if (!invoked) throw new Error("demae_can_apply_button_missing");
  try {
    await waitForConfirmationButton(page);
  } catch {
    throw new Error("demae_can_confirmation_timeout");
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
    // Demae leaves the previous selection layer and action modal mounted after
    // some saves. Reusing that DOM makes the next action unable to open its
    // inventory modal. Start every mutation from a freshly rendered page so a
    // previous command cannot poison the next one; refreshInventoryPage also
    // exposes an expired session and runs the normal login recovery.
    await this.refreshInventoryPage(page);
    const desiredUnavailable = payload.isAvailable !== true;
    const fresh = await this.readInventoryRowsWithAuthRecovery(
      page,
      located.map((item) => ({ label: item.label, aliases: item.names }))
    );
    const disappeared = fresh.filter((item) => item.matches.length === 0);
    if (disappeared.length) {
      throw platformUiChanged("demae_can", `target_disappeared:${disappeared.map((item) => item.label).join(",")}`);
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
    await waitForInventoryActionModal(page);
    if (desiredUnavailable) {
      await openInventoryActionForm(
        page,
        "stockoutSetting",
        "form[class*=StockoutSetting_form]",
        "demae_can_stockout_tab_missing",
        "demae_can_stockout_form_timeout"
      );
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
      await openInventoryActionForm(
        page,
        "stockoutDelete",
        "form[class*=StockoutDelete_form]",
        "demae_can_restore_tab_missing",
        "demae_can_restore_form_timeout"
      );
    }
    await submitInventoryActionForm(
      page,
      desiredUnavailable ? "form[class*=StockoutSetting_form]" : "form[class*=StockoutDelete_form]"
    );
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
      // Some option names occur in many menus. Demae may accept the save but
      // leave stale row text in the current DOM, especially after bulk changes.
      // Reload once and verify the server-rendered state before reporting a
      // failure or repeating the mutation.
      try {
        await this.refreshInventoryPage(page);
        await waitForRows(page, changing, desiredUnavailable);
      } catch {
        throw new Error("demae_can_verification_timeout");
      }
    }
    return { outcome: "applied", changed: changing.length, desiredUnavailable };
  }

  async captureMenuSnapshot(payload) {
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    const page = await this.session.goto(STOCKOUT_URL);
    await this.ensureAuthenticated(page);
    const scan = await this.readInventoryRowsWithAuthRecovery(page, targets);
    if (scan.some((item) => item.matches.length === 0)) await this.refreshInventoryPage(page);
    const inventoryResult = await readAllRows(page, targets);
    const catalog = await page.evaluate(async () => {
      const getData = async (path) => {
        const response = await fetch(path, { credentials: "include" });
        if (!response.ok) throw new Error(`demae_can_catalog_api_${response.status}`);
        const body = await response.json();
        if (body?.code !== "MSA0000") throw new Error(`demae_can_catalog_api_${body?.code ?? "unknown"}`);
        return body.data;
      };
      const chains = await getData("/merchant-admin/api/v1/product/search/chain-menu-pattern");
      const chain = chains?.[0];
      const chainId = Number(chain?.chain?.chainId ?? 0);
      const menuPatternCode = String(chain?.menuPatternList?.[0]?.menuPatternCode ?? "");
      if (!chainId || !menuPatternCode) throw new Error("demae_can_catalog_identity_missing");
      const [categories, patternItems, groups] = await Promise.all([
        getData(`/merchant-admin/api/v1/product/search/category?chainId=${chainId}&menuPatternCode=${encodeURIComponent(menuPatternCode)}`),
        getData(`/merchant-admin/api/v1/product/chain/${chainId}/menu-pattern/${encodeURIComponent(menuPatternCode)}/item-list`),
        getData(`/merchant-admin/api/v1/product/suggest/chain/${chainId}/menu-pattern/${encodeURIComponent(menuPatternCode)}/linked-option-group-list`)
      ]);
      const optionGroups = [];
      for (const group of groups ?? []) {
        const optionRows = await getData(`/merchant-admin/api/v1/product/chain/${chainId}/option-group/${encodeURIComponent(group.optionGroupCode)}/option-item-list`);
        optionGroups.push({ ...group, options: optionRows ?? [] });
      }
      return { chainId, menuPatternCode, categories, patternItems, optionGroups };
    });
    const inventoryByExternalId = new Map(inventoryResult.entries.map((entry) => [entry.externalId, entry]));
    const patternItems = new Map((catalog.patternItems?.categoryList ?? [])
      .flatMap((category) => category.itemList ?? [])
      .map((item) => [String(item.itemCode), item]));
    const entries = [];
    for (const category of catalog.categories?.categoryList ?? []) {
      for (const item of category.itemList ?? []) {
        const externalId = `itemList_${catalog.chainId}${item.itemCode}false`;
        const inventory = inventoryByExternalId.get(externalId);
        const patternItem = patternItems.get(String(item.itemCode));
        entries.push({
          targetId: inventory?.targetId ?? "",
          externalId,
          groupKey: inventory?.groupKey ?? "",
          optionKey: inventory?.optionKey ?? "",
          name: String(item.itemName ?? ""),
          price: item.sizeInfoList?.[0]?.price === null || item.sizeInfoList?.[0]?.price === undefined ? null : Number(item.sizeInfoList[0].price),
          sourceBasePrice: inventory?.sourceBasePrice ?? null,
          isActive: inventory ? inventory.isActive : !patternItem?.stockoutType,
          observedKind: "item",
          metadata: { ...(inventory?.metadata ?? {}), itemCode: String(item.itemCode), categoryCode: String(category.categoryCode ?? ""), matchBasis: inventory ? "external_id" : "catalog_api" }
        });
      }
    }
    for (const group of catalog.optionGroups) {
      for (const option of group.options) {
        const externalId = `itemList_${catalog.chainId}${option.optionCode}true`;
        const inventory = inventoryByExternalId.get(externalId);
        entries.push({
          targetId: inventory?.targetId ?? "",
          externalId,
          groupKey: inventory?.groupKey ?? "",
          optionKey: inventory?.optionKey ?? "",
          name: String(option.optionName ?? ""),
          price: option.price === null || option.price === undefined ? null : Number(option.price),
          sourceBasePrice: inventory?.sourceBasePrice ?? null,
          isActive: inventory?.isActive !== false,
          observedKind: "option",
          metadata: { ...(inventory?.metadata ?? {}), optionCode: String(option.optionCode), optionGroupCode: String(group.optionGroupCode), optionGroupName: String(group.optionGroupName ?? ""), matchBasis: inventory ? "external_id" : "catalog_api" }
        });
      }
    }
    const matchedCounts = new Map();
    for (const entry of entries) if (entry.targetId) matchedCounts.set(entry.targetId, (matchedCounts.get(entry.targetId) ?? 0) + 1);
    const missingTargets = targets.filter((target) => matchedCounts.get(target.targetId) !== 1).map((target) => target.label);
    return {
      outcome: "captured",
      snapshot: {
        items: entries.filter((entry) => entry.observedKind === "item"),
        options: entries.filter((entry) => entry.observedKind === "option"),
        complete: missingTargets.length === 0,
        missingTargets,
        scanMode: "full_platform"
      },
      targetCount: targets.length,
      matchedCount: entries.filter((entry) => entry.targetId).length,
      missingTargets
    };
  }

  async publishMenuChanges(payload, reportProgress = async () => undefined) {
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const availabilityChanges = changes.filter((change) => change.kind === "disable"
      || (change.kind === "update" && change.currentState?.isActive === false && change.projectedState?.isActive === true));
    const unsupported = changes.filter((change) => !availabilityChanges.includes(change));
    if (unsupported.length) {
      throw new Error(`menu_action_unsupported:demae_can:${[...new Set(unsupported.map((change) => change.kind))].join(",")}`);
    }
    const targets = changes.map((change) => ({
      kind: change.targetType,
      label: change.targetLabel,
      aliases: [change.currentState?.name, change.projectedState?.name].filter(Boolean)
    }));
    const located = await this.locateTargets(targets);
    if (located.some((item) => item.matches.length !== 1)) {
      throw new Error(`menu_target_verification_failed:demae_can:${located.filter((item) => item.matches.length !== 1).map((item) => item.label).join(",")}`);
    }
    await reportProgress({ phase: "applying", attempt: 1, maxAttempts: 3 });
    const disabling = located.filter((item) => changes.find((change) => change.targetLabel === item.label)?.kind === "disable");
    const enabling = located.filter((item) => changes.find((change) => change.targetLabel === item.label)?.kind === "update");
    if (disabling.length) await this.setInventory({ isAvailable: false, soldOutMode: "indefinite" }, disabling);
    if (enabling.length) await this.setInventory({ isAvailable: true }, enabling);
    await reportProgress({ phase: "verifying", attempt: 1, maxAttempts: 3 });
    const snapshotResult = await this.captureMenuSnapshot({ targets: changes.map((change) => ({
      kind: change.targetType,
      targetId: change.targetId,
      label: change.targetLabel,
      sourceBasePrice: change.projectedState?.sourceBasePrice ?? null
    })) });
    for (const entry of [...snapshotResult.snapshot.items, ...snapshotResult.snapshot.options]) {
      const change = changes.find((candidate) => candidate.targetId === entry.targetId);
      if (!change) continue;
      entry.name = change.projectedState?.name ?? entry.name;
      entry.price = change.projectedState?.price ?? entry.price;
      entry.sourceBasePrice = change.projectedState?.sourceBasePrice ?? entry.sourceBasePrice;
      entry.isActive = change.projectedState?.isActive !== false;
    }
    return { outcome: "applied", changed: changes.length, snapshot: snapshotResult.snapshot };
  }
}
