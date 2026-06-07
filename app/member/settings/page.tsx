"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { ChevronDown, Home, Loader2, LogOut, Save, Settings, ShoppingBag, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";

type MemberProfile = {
  memberNumber: string;
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  phone: string;
  email: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
};

type MemberResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  error?: string;
};

type MemberSettingsForm = {
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  lastNameKana: string;
  firstNameKana: string;
  phone: string;
  phonePart1: string;
  phonePart2: string;
  phonePart3: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const emptyMemberSettings: MemberSettingsForm = {
  displayName: "",
  lastName: "",
  firstName: "",
  fullName: "",
  nameKana: "",
  lastNameKana: "",
  firstNameKana: "",
  phone: "",
  phonePart1: "",
  phonePart2: "",
  phonePart3: "",
  birthday: "",
  preferredLanguage: "ja",
  preferredStoreId: "",
  marketingOptIn: false,
  lineLinked: false
};

const preferredStoreOptions = [
  { value: "", label: "未設定" },
  { value: "nanacha-kiyokawa", label: "nanacha 清川店" },
  { value: "maamaa-shimizu", label: "まぁ麻 清水店" }
];

const languageOptions = [
  { value: "ja", label: "日本語" },
  { value: "zh", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" }
];

function splitJapanesePhone(value: string) {
  const hyphenParts = value.split("-").map((part) => part.replace(/[^\d]/g, "")).filter(Boolean);
  if (hyphenParts.length === 3) return hyphenParts as [string, string, string];

  const digits = value.replace(/[^\d]/g, "");
  if (/^0[789]0\d{8}$/.test(digits)) return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
  if (/^(0120\d{6}|0800\d{7})$/.test(digits)) return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)];
  if (/^0\d{9}$/.test(digits)) return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)];
  if (/^0\d{8}$/.test(digits)) return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5)];
  return [digits, "", ""];
}

function composeJapanesePhone(part1: string, part2: string, part3: string) {
  return [part1, part2, part3].map((part) => part.replace(/[^\d]/g, "")).filter(Boolean).join("-");
}

function toSettingsForm(member?: MemberProfile | null): MemberSettingsForm {
  if (!member) return emptyMemberSettings;
  const [fallbackLastName = "", fallbackFirstName = ""] = (member.fullName || "").trim().split(/\s+/, 2);
  const [fallbackLastNameKana = "", fallbackFirstNameKana = ""] = (member.nameKana || "").trim().split(/\s+/, 2);
  const [phonePart1, phonePart2, phonePart3] = splitJapanesePhone(member.phone || "");
  return {
    displayName: member.displayName || "",
    lastName: member.lastName || fallbackLastName,
    firstName: member.firstName || fallbackFirstName,
    fullName: member.fullName || "",
    nameKana: member.nameKana || "",
    lastNameKana: fallbackLastNameKana,
    firstNameKana: fallbackFirstNameKana,
    phone: member.phone || "",
    phonePart1,
    phonePart2,
    phonePart3,
    birthday: member.birthday || "",
    preferredLanguage: member.preferredLanguage || "ja",
    preferredStoreId: member.preferredStoreId || "",
    marketingOptIn: Boolean(member.marketingOptIn),
    lineLinked: Boolean(member.lineLinked)
  };
}

function safeReturnTo(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return "";
  }
  return "";
}

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }) {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "会員";
}

function settingsReturnUrl(returnTo: string, handoffEnabled: boolean) {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (handoffEnabled) params.set("handoff", "1");
  const query = params.toString();
  return query ? `/member?${query}` : "/member";
}

export default function MemberSettingsPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [data, setData] = useState<MemberResponse>({});
  const [settingsForm, setSettingsForm] = useState<MemberSettingsForm>(emptyMemberSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [returnTo, setReturnTo] = useState("");
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [completeProfileRequested, setCompleteProfileRequested] = useState(false);

  const afterAuthUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    if (handoffEnabled) params.set("handoff", "1");
    if (completeProfileRequested) params.set("completeProfile", "1");
    const query = params.toString();
    return query ? `/member/settings?${query}` : "/member/settings";
  }, [completeProfileRequested, handoffEnabled, returnTo]);

  async function loadMemberSettings() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) {
        setMessage(body.error || "会員情報を読み込めませんでした。");
        setData({});
        return;
      }
      setData(body);
      setSettingsForm(toSettingsForm(body.member));
    } catch {
      setMessage("通信に失敗しました。時間をおいて再度お試しください。");
      setData({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(safeReturnTo(params.get("returnTo") || ""));
    setHandoffEnabled(params.get("handoff") === "1");
    setCompleteProfileRequested(params.get("completeProfile") === "1");
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadMemberSettings();
  }, [isLoaded, isSignedIn]);

  async function saveSettings() {
    const requiredMissing = [
      !settingsForm.displayName.trim() ? "表示名・ニックネーム" : "",
      !settingsForm.lastName.trim() ? "姓" : "",
      !settingsForm.firstName.trim() ? "名" : "",
      !(settingsForm.phonePart1.trim() && settingsForm.phonePart2.trim() && settingsForm.phonePart3.trim()) ? "電話番号" : ""
    ].filter(Boolean);
    if (requiredMissing.length) {
      setMessage(`${requiredMissing.join("、")}を入力してください。`);
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const nameKana = [settingsForm.lastNameKana, settingsForm.firstNameKana].map((part) => part.trim()).filter(Boolean).join(" ");
      const phone = composeJapanesePhone(settingsForm.phonePart1, settingsForm.phonePart2, settingsForm.phonePart3);
      const response = await fetch("/api/public/members/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settingsForm, nameKana, phone })
      });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) throw new Error(body.error || "会員情報を保存できませんでした。");
      setData((current) => ({ ...current, member: body.member ?? current.member }));
      setSettingsForm(toSettingsForm(body.member));
      if (completeProfileRequested || handoffEnabled) {
        window.location.href = settingsReturnUrl(returnTo, handoffEnabled);
        return;
      }
      setMessage("会員情報を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会員情報を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
            <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
            <strong>Members</strong>
          </a>
        </header>
        <section className="member-portal-config">
          <strong>Clerk の環境変数が未設定です。</strong>
          <p>`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` と `CLERK_SECRET_KEY` を設定してください。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="member-portal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </a>
        {isSignedIn ? (
          <details className="member-account-menu">
            <summary aria-label="会員メニュー">
              <span className="member-account-avatar"><UserRound size={18} /></span>
              <span className="member-account-summary-text">
                <strong>{getAccountDisplayName(data.member, user)}</strong>
                <small>{data.member?.memberNumber || user?.primaryEmailAddress?.emailAddress || "ログイン中"}</small>
              </span>
              <ChevronDown size={16} />
            </summary>
            <div className="member-account-popover">
              <div className="member-account-card">
                <span>ログイン中</span>
                <strong>{getAccountDisplayName(data.member, user)}</strong>
                {data.member?.memberNumber ? <small>会員番号 {data.member.memberNumber}</small> : null}
              </div>
              <a className="member-account-menu-item" href="/member">
                <Home size={16} />
                会員証に戻る
              </a>
              <a className="member-account-menu-item" href="/member/orders">
                <ShoppingBag size={16} />
                購入履歴・領収書
              </a>
              <SignOutButton redirectUrl="/member?loggedOut=1">
                <button className="member-account-menu-item" type="button">
                  <LogOut size={16} />
                  ログアウト
                </button>
              </SignOutButton>
            </div>
          </details>
        ) : null}
      </header>

      <section className="member-portal-hero member-orders-hero">
        <div>
          <p className="eyebrow">Account Settings</p>
          <h1>会員情報</h1>
          <span>店頭での会員確認と予約時の自動入力に使用する情報を設定できます。</span>
        </div>
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title="会員情報にログイン"
          description="メールアドレスに確認コードを送信して、会員情報を編集できます。"
          afterAuthUrl={afterAuthUrl}
        />
      ) : null}

      {isLoaded && isSignedIn ? (
        <section className="member-settings-page-shell">
          <article className="member-portal-panel member-settings-panel is-profile-task">
            <div className="member-settings-summary member-settings-page-title">
              <div className="member-portal-panel-title">
                <Settings size={18} />
                <h3>会員情報</h3>
              </div>
              <a className="secondary-button" href="/member">
                <Home size={16} />
                会員証に戻る
              </a>
            </div>
            <div className="member-settings-body">
              {completeProfileRequested ? (
                <div className="member-settings-required-alert">
                  <strong>会員登録を完了してください</strong>
                  <span>ポイント利用と予約時の自動入力には、表示名・氏名・電話番号が必要です。</span>
                </div>
              ) : null}
              {loading ? <p className="member-settings-inline-message">会員情報を読み込んでいます。</p> : null}
              {message ? <p className="member-settings-inline-message">{message}</p> : null}
              <p className="member-settings-note">表示名、氏名、電話番号は会員確認に必要です。その他の項目は任意で設定できます。</p>
              <div className="member-settings-grid">
                <label className="member-settings-field-wide">
                  <span>表示名・ニックネーム</span>
                  <input value={settingsForm.displayName} onChange={(event) => setSettingsForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="例: Maamaa fan" disabled={loading || saving} />
                </label>
                <label className="member-settings-field-name">
                  <span>姓</span>
                  <input value={settingsForm.lastName} onChange={(event) => setSettingsForm((current) => ({ ...current, lastName: event.target.value, fullName: [event.target.value, current.firstName].filter(Boolean).join(" ") }))} placeholder="例: 山田" autoComplete="family-name" disabled={loading || saving} required />
                </label>
                <label className="member-settings-field-name">
                  <span>名</span>
                  <input value={settingsForm.firstName} onChange={(event) => setSettingsForm((current) => ({ ...current, firstName: event.target.value, fullName: [current.lastName, event.target.value].filter(Boolean).join(" ") }))} placeholder="例: 太郎" autoComplete="given-name" disabled={loading || saving} required />
                </label>
                <label className="member-settings-field-kana">
                  <span>セイ（任意）</span>
                  <input value={settingsForm.lastNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, lastNameKana: event.target.value, nameKana: [event.target.value, current.firstNameKana].filter(Boolean).join(" ") }))} placeholder="例: ヤマダ" autoComplete="section-kana family-name" disabled={loading || saving} />
                </label>
                <label className="member-settings-field-kana">
                  <span>メイ（任意）</span>
                  <input value={settingsForm.firstNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, firstNameKana: event.target.value, nameKana: [current.lastNameKana, event.target.value].filter(Boolean).join(" ") }))} placeholder="例: タロウ" autoComplete="section-kana given-name" disabled={loading || saving} />
                </label>
                <label>
                  <span>電話番号</span>
                  <div className="member-phone-segments">
                    <input value={settingsForm.phonePart1} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart1: event.target.value.replace(/[^\d]/g, "").slice(0, 5), phone: composeJapanesePhone(event.target.value, current.phonePart2, current.phonePart3) }))} placeholder="090" inputMode="numeric" autoComplete="tel-area-code" aria-label="電話番号 1" disabled={loading || saving} required />
                    <span>-</span>
                    <input value={settingsForm.phonePart2} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart2: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, event.target.value, current.phonePart3) }))} placeholder="1234" inputMode="numeric" autoComplete="tel-local-prefix" aria-label="電話番号 2" disabled={loading || saving} required />
                    <span>-</span>
                    <input value={settingsForm.phonePart3} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart3: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, current.phonePart2, event.target.value) }))} placeholder="5678" inputMode="numeric" autoComplete="tel-local-suffix" aria-label="電話番号 3" disabled={loading || saving} required />
                  </div>
                </label>
                <label>
                  <span>生年月日（任意）</span>
                  <input type="date" value={settingsForm.birthday} onChange={(event) => setSettingsForm((current) => ({ ...current, birthday: event.target.value }))} disabled={loading || saving} />
                </label>
                <label>
                  <span>よく利用する店舗（任意）</span>
                  <select value={settingsForm.preferredStoreId} onChange={(event) => setSettingsForm((current) => ({ ...current, preferredStoreId: event.target.value }))} disabled={loading || saving}>
                    {preferredStoreOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>表示言語（任意）</span>
                  <select value={settingsForm.preferredLanguage} onChange={(event) => setSettingsForm((current) => ({ ...current, preferredLanguage: event.target.value }))} disabled={loading || saving}>
                    {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="member-settings-checks">
                <label>
                  <input type="checkbox" checked={settingsForm.marketingOptIn} onChange={(event) => setSettingsForm((current) => ({ ...current, marketingOptIn: event.target.checked }))} disabled={loading || saving} />
                  <span>クーポンやキャンペーンのお知らせを受け取る</span>
                </label>
                <label>
                  <input type="checkbox" checked={settingsForm.lineLinked} onChange={(event) => setSettingsForm((current) => ({ ...current, lineLinked: event.target.checked }))} disabled={loading || saving} />
                  <span>LINE連携済みとして記録する（本連携機能は準備中）</span>
                </label>
              </div>
              <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={loading || saving}>
                {saving ? <Loader2 size={16} /> : <Save size={16} />}
                {saving ? "保存中..." : "会員情報を保存"}
              </button>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
