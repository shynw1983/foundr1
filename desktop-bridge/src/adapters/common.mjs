export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, " ")
    .trim();
}

function nameVariants(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const variants = [normalized];
  const withoutDetails = normalized
    .replace(/\s*[（(][^）)]*[）)]\s*$/u, "")
    .trim();
  if (withoutDetails) variants.push(withoutDetails);
  const weightless = normalized
    .replace(/(?:1人前)?約?\d+(?:\.\d+)?\s*(?:g|kg)\b/giu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (weightless) variants.push(weightless);
  for (const name of [...variants]) {
    if (name.includes("麻辣湯")) variants.push(name.replaceAll("麻辣湯", "マーラータン"));
    if (name.includes("マーラータン")) variants.push(name.replaceAll("マーラータン", "麻辣湯"));
  }
  return Array.from(new Set(variants));
}

export function targetNames(target) {
  return Array.from(new Set([
    target?.label,
    ...(Array.isArray(target?.aliases) ? target.aliases : [])
  ].flatMap(nameVariants).filter(Boolean)));
}

export function targetNameTiers(target) {
  const primaryNames = nameVariants(target?.label);
  const primary = new Set(primaryNames);
  const aliasNames = targetNames(target).filter((name) => !primary.has(name));
  const exactName = normalizeText(target?.label);
  const exactNames = exactName ? [exactName] : [];
  const exact = new Set(exactNames);
  const fallbackNames = primaryNames.filter((name) => !exact.has(name));
  return { exactNames, fallbackNames, primaryNames, aliasNames };
}

export function tieredTargetCandidates(targetRows, nameParts) {
  const matchesTier = (key) => targetRows.filter((target) => (
    target[key].some((name) => nameParts.includes(name))
  ));
  const exactCandidates = matchesTier("normalizedExactNames");
  if (exactCandidates.length) return { candidates: exactCandidates, matchBasis: "exact_name" };
  const fallbackCandidates = matchesTier("normalizedFallbackNames");
  if (fallbackCandidates.length) return { candidates: fallbackCandidates, matchBasis: "fallback_name" };
  return { candidates: matchesTier("normalizedAliasNames"), matchBasis: "alias" };
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

export function platformUiChanged(platform, stage) {
  return new Error(`platform_ui_changed:${platform}:${stage}`);
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
