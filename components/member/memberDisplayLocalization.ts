import type { MemberLanguage } from "./MemberLanguageProvider";

const localizedStoreNames: Partial<Record<MemberLanguage, Record<string, string>>> = {
  zh: {
    "nanacha 福岡清川店": "nanacha 福冈清川店",
    "まぁ麻 福岡南店": "まぁ麻 福冈南店"
  },
  "zh-Hant": {
    "nanacha 福岡清川店": "nanacha 福岡清川店",
    "まぁ麻 福岡南店": "まぁ麻 福岡南店"
  },
  en: {
    "nanacha 福岡清川店": "nanacha Fukuoka Kiyokawa",
    "まぁ麻 福岡南店": "maamaa Fukuoka Minami"
  },
  ko: {
    "nanacha 福岡清川店": "nanacha 후쿠오카 기요카와점",
    "まぁ麻 福岡南店": "maamaa 후쿠오카 미나미점"
  },
  vi: {
    "nanacha 福岡清川店": "nanacha Fukuoka Kiyokawa",
    "まぁ麻 福岡南店": "maamaa Fukuoka Minami"
  },
  ne: {
    "nanacha 福岡清川店": "nanacha Fukuoka Kiyokawa",
    "まぁ麻 福岡南店": "maamaa Fukuoka Minami"
  }
};

export function localizedMemberStoreName(value: string, language: MemberLanguage) {
  const name = String(value || "").trim();
  if (!name || language === "ja") return name;
  return localizedStoreNames[language]?.[name] || (language === "zh" ? name.replaceAll("福岡", "福冈") : name);
}
