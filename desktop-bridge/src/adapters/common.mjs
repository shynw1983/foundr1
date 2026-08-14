export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, " ")
    .trim();
}

export function targetNames(target) {
  return Array.from(new Set([
    target?.label,
    ...(Array.isArray(target?.aliases) ? target.aliases : [])
  ].map(normalizeText).filter(Boolean)));
}

export function targetNameTiers(target) {
  const primaryNames = [normalizeText(target?.label)].filter(Boolean);
  const primary = new Set(primaryNames);
  const aliasNames = targetNames(target).filter((name) => !primary.has(name));
  return { primaryNames, aliasNames };
}

export async function pageSummary(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body?.innerText ?? "").slice(0, 5000)
  }));
}

export function loginState(summary, expectedText) {
  const normalized = normalizeText(summary.text);
  const ok = normalized.includes(normalizeText(expectedText));
  const loginRequired = !ok && (
    /ログイン|sign in|メールアドレス|パスワード|携帯電話番号/i.test(normalized)
    || /auth\.|login/i.test(summary.url)
  );
  return {
    ok,
    loginRequired: loginRequired || !ok,
    url: summary.url,
    title: summary.title
  };
}

export async function exactVisibleMatches(page, names, selector) {
  const wanted = names.map(normalizeText);
  return page.evaluate(({ wantedValues, selectorValue }) => {
    const normalize = (value) => String(value ?? "")
      .normalize("NFKC")
      .replace(/[\s\u200b-\u200d\ufeff]+/g, " ")
      .trim();
    return [...document.querySelectorAll(selectorValue)]
      .map((element) => ({
        text: normalize(element.textContent),
        href: element instanceof HTMLAnchorElement ? element.href : "",
        visible: Boolean(element.getClientRects().length)
      }))
      .filter((item) => item.visible && wantedValues.includes(item.text))
      .slice(0, 20);
  }, { wantedValues: wanted, selectorValue: selector });
}
