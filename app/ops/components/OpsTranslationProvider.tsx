"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type OpsLanguage = "ja" | "zh-Hans" | "zh-Hant";
type OpsDictionary = Record<string, string>;
type OpsTranslationContextValue = {
  language: OpsLanguage;
  setLanguage: (language: OpsLanguage) => void;
  t: (value: string) => string;
};

const languageStorageKey = "foundr1-ops-language";
const languagePreferenceStorageKey = "foundr1-ops-language-preference";
const localeCacheVersion = "20260525-ops-i18n-v20";
const languageMeta: Record<OpsLanguage, { htmlLang: string }> = {
  ja: { htmlLang: "ja" },
  "zh-Hans": { htmlLang: "zh-Hans" },
  "zh-Hant": { htmlLang: "zh-Hant" }
};
const originalText = new WeakMap<Text, string>();
const translatedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Record<string, string>>();
const translatableAttributes = ["aria-label", "data-label", "placeholder", "title"];
const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

const OpsTranslationContext = createContext<OpsTranslationContextValue>({
  language: "ja",
  setLanguage: () => {},
  t: (value) => value
});

function getBrowserDefaultLanguage(): OpsLanguage {
  if (typeof navigator === "undefined") return "ja";

  const browserLanguages = [navigator.language, ...(navigator.languages ?? [])];
  const normalizedLanguages = browserLanguages.map((value) => value.toLowerCase());
  if (normalizedLanguages.some((value) => value.startsWith("zh-tw") || value.startsWith("zh-hk") || value.startsWith("zh-mo") || value.includes("hant"))) {
    return "zh-Hant";
  }

  return normalizedLanguages.some((value) => value.startsWith("zh")) ? "zh-Hans" : "ja";
}

function normalizeStoredLanguage(value: string | null): OpsLanguage | null {
  if (value === "ja" || value === "zh-Hans" || value === "zh-Hant") return value;
  if (value === "zh") return "zh-Hans";

  return null;
}

function translateText(value: string, dictionary: OpsDictionary) {
  if (!value || Object.keys(dictionary).length === 0) return value;

  const exact = dictionary[value];
  if (exact) return exact;

  return Object.entries(dictionary)
    .filter(([source, target]) => source.length > 1 && target && value.includes(source))
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((translated, [source, target]) => translated.split(source).join(target), value);
}

function translateTextNode(node: Text, dictionary: OpsDictionary, language: OpsLanguage) {
  if (!node.textContent || !node.textContent.trim()) return;
  if (node.parentElement?.closest("[data-i18n-ignore]")) return;

  const currentText = node.textContent;
  const previousSource = originalText.get(node);
  const previousTranslation = translatedText.get(node);
  let source = previousSource ?? currentText;

  if (!previousSource || (currentText !== previousSource && currentText !== previousTranslation)) {
    source = currentText;
    originalText.set(node, source);
  }

  const leadingWhitespace = source.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = source.match(/\s*$/)?.[0] ?? "";
  const text = source.trim();
  const nextText = language === "ja"
    ? source
    : `${leadingWhitespace}${translateText(text, dictionary)}${trailingWhitespace}`;

  translatedText.set(node, nextText);

  if (node.textContent !== nextText) {
    node.textContent = nextText;
  }
}

function translateElementAttributes(element: Element, dictionary: OpsDictionary, language: OpsLanguage) {
  if (element.closest("[data-i18n-ignore]")) return;

  for (const attr of translatableAttributes) {
    const value = element.getAttribute(attr);
    if (!value) continue;

    const stored = originalAttributes.get(element) ?? {};
    if (!stored[attr]) {
      stored[attr] = value;
      originalAttributes.set(element, stored);
    }

    const nextValue = language === "ja" ? stored[attr] : translateText(stored[attr], dictionary);
    if (value !== nextValue) {
      element.setAttribute(attr, nextValue);
    }
  }
}

function translateNode(root: Node, dictionary: OpsDictionary, language: OpsLanguage) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, dictionary, language);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

  const element = root as Element;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (ignoredTags.has(element.tagName) || element.closest("[data-i18n-ignore]")) return;
    translateElementAttributes(element, dictionary, language);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement?.closest("[data-i18n-ignore]") || ignoredTags.has(node.parentElement?.tagName ?? "")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }

      const nextElement = node as Element;
      return ignoredTags.has(nextElement.tagName) || nextElement.closest("[data-i18n-ignore]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      translateTextNode(current as Text, dictionary, language);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(current as Element, dictionary, language);
    }
    current = walker.nextNode();
  }
}

export function OpsTranslationProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<OpsLanguage>("ja");
  const [dictionary, setDictionary] = useState<OpsDictionary>({});

  useEffect(() => {
    try {
      const hasManualPreference = localStorage.getItem(languagePreferenceStorageKey) === "manual";
      const storedLanguage = normalizeStoredLanguage(localStorage.getItem(languageStorageKey));
      if (hasManualPreference && storedLanguage) {
        setLanguageState(storedLanguage);
        return;
      }

      setLanguageState(getBrowserDefaultLanguage());
    } catch {
      setLanguageState(getBrowserDefaultLanguage());
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = languageMeta[language].htmlLang;

    if (language === "ja") {
      setDictionary({});
      return;
    }

    let active = true;
    const storageKey = `foundr1-ops-dictionary-${localeCacheVersion}-${language}`;

    async function loadDictionary() {
      try {
        const cached = localStorage.getItem(storageKey);
        if (cached && active) setDictionary(JSON.parse(cached) as OpsDictionary);
      } catch {
        // Fetch a fresh copy below.
      }

      try {
        const response = await fetch(`/locales/ops/${language}.json`, {
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) return;

        const nextDictionary = await response.json() as OpsDictionary;
        if (active) setDictionary(nextDictionary);

        try {
          localStorage.setItem(storageKey, JSON.stringify(nextDictionary));
        } catch {
          // Ignore cache failures.
        }
      } catch {
        // Keep the cached dictionary if available.
      }
    }

    void loadDictionary();

    return () => {
      active = false;
    };
  }, [language]);

  useEffect(() => {
    translateNode(document.body, dictionary, language);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => translateNode(node, dictionary, language));
        if (mutation.type === "attributes") translateNode(mutation.target, dictionary, language);
        if (mutation.type === "characterData") translateNode(mutation.target, dictionary, language);
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: translatableAttributes,
      childList: true,
      characterData: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, [dictionary, language]);

  const setLanguage = useCallback((nextLanguage: OpsLanguage) => {
    setLanguageState(nextLanguage);

    try {
      localStorage.setItem(languageStorageKey, nextLanguage);
      localStorage.setItem(languagePreferenceStorageKey, "manual");
    } catch {
      // Continue without persistence.
    }
  }, []);
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (text: string) => language === "ja" ? text : translateText(text, dictionary)
  }), [dictionary, language, setLanguage]);

  return <OpsTranslationContext.Provider value={value}>{children}</OpsTranslationContext.Provider>;
}

export function useOpsTranslation() {
  return useContext(OpsTranslationContext);
}

export function OpsLanguagePicker() {
  const { language, setLanguage, t } = useOpsTranslation();

  return (
    <label className="ops-language-picker" data-i18n-ignore>
      <span>{t("Language")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as OpsLanguage)}
        aria-label="Language"
      >
        <option value="ja">日本語</option>
        <option value="zh-Hans">简体中文</option>
        <option value="zh-Hant">繁體中文</option>
      </select>
    </label>
  );
}
