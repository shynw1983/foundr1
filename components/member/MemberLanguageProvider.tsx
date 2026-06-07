"use client";

import { Globe2 } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

export const memberLanguageOptions = [
  { value: "ja", label: "日本語" },
  { value: "zh", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ne", label: "नेपाली" }
] as const;

export type MemberLanguage = typeof memberLanguageOptions[number]["value"];

type MemberLanguageContextValue = {
  language: MemberLanguage;
  setLanguage: (language: string, options?: { saveRemote?: boolean }) => void;
  syncPreferredLanguage: (language?: string | null) => void;
};

const memberLanguageStorageKey = "foundr1-member-language";
const MemberLanguageContext = createContext<MemberLanguageContextValue | null>(null);

export function normalizeMemberLanguage(value?: string | null): MemberLanguage {
  const language = String(value ?? "").trim();
  return memberLanguageOptions.some((option) => option.value === language) ? language as MemberLanguage : "ja";
}

function browserLanguage(): MemberLanguage {
  if (typeof navigator === "undefined") return "ja";
  const languages = [navigator.language, ...(navigator.languages ?? [])]
    .map((language) => language.toLowerCase())
    .filter(Boolean);
  if (languages.some((language) => language === "zh-hant" || language.startsWith("zh-hant-") || language === "zh-tw" || language.startsWith("zh-tw-") || language === "zh-hk" || language.startsWith("zh-hk-"))) return "zh-Hant";
  if (languages.some((language) => language === "zh" || language.startsWith("zh-"))) return "zh";
  if (languages.some((language) => language === "ko" || language.startsWith("ko-"))) return "ko";
  if (languages.some((language) => language === "vi" || language.startsWith("vi-"))) return "vi";
  if (languages.some((language) => language === "ne" || language.startsWith("ne-"))) return "ne";
  if (languages.some((language) => language === "en" || language.startsWith("en-"))) return "en";
  return "ja";
}

function initialLanguage() {
  if (typeof window === "undefined") return "ja";
  const params = new URLSearchParams(window.location.search);
  return params.get("lang") ? normalizeMemberLanguage(params.get("lang")) : browserLanguage();
}

function savePreferredLanguage(language: MemberLanguage) {
  void fetch("/api/public/members/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "preferred_language", preferredLanguage: language })
  }).catch(() => undefined);
}

export function MemberLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<MemberLanguage>("ja");
  const userSelectedLanguageRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextLanguage = initialLanguage();
    userSelectedLanguageRef.current = Boolean(params.get("lang"));
    setLanguageState(nextLanguage);
    window.localStorage.setItem(memberLanguageStorageKey, nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh-Hant" ? "zh-Hant" : language;
  }, [language]);

  const value = useMemo<MemberLanguageContextValue>(() => ({
    language,
    setLanguage: (nextLanguage, options = {}) => {
      const normalized = normalizeMemberLanguage(nextLanguage);
      userSelectedLanguageRef.current = true;
      setLanguageState(normalized);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(memberLanguageStorageKey, normalized);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("lang", normalized);
        window.history.replaceState(null, "", nextUrl.toString());
      }
      if (options.saveRemote) savePreferredLanguage(normalized);
    },
    syncPreferredLanguage: (preferredLanguage) => {
      if (!preferredLanguage) return;
      if (typeof window !== "undefined" && !new URLSearchParams(window.location.search).get("lang")) return;
      const normalized = normalizeMemberLanguage(preferredLanguage);
      if (userSelectedLanguageRef.current) return;
      setLanguageState(normalized);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(memberLanguageStorageKey, normalized);
      }
    }
  }), [language]);

  return (
    <MemberLanguageContext.Provider value={value}>
      {children}
    </MemberLanguageContext.Provider>
  );
}

export function useMemberLanguage() {
  const value = useContext(MemberLanguageContext);
  if (!value) throw new Error("useMemberLanguage must be used inside MemberLanguageProvider");
  return value;
}

export function MemberLanguageSwitcher() {
  const { language, setLanguage } = useMemberLanguage();
  return (
    <label className="member-language-switcher">
      <Globe2 size={16} />
      <select value={language} onChange={(event) => setLanguage(event.target.value, { saveRemote: true })} aria-label="Language">
        {memberLanguageOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
