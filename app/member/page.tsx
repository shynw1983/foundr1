"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { BadgePercent, Gift, Loader2, QrCode, RefreshCw, Settings, Ticket, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type MemberProfile = {
  id: string;
  memberNumber: string;
  publicToken: string;
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
  pointBalance: number;
  lifetimeSpendAmount: number;
  lifetimeVisitCount: number;
  currentTierKey: string;
};

type MemberCoupon = {
  id: string;
  couponCode: string;
  name: string;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  expiresAt: string;
};

type PointHistory = {
  id: string;
  brandName: string;
  storeName: string;
  movementType: string;
  points: number;
  eligibleAmount: number;
  createdAt: string;
};

type MemberResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  coupons?: MemberCoupon[];
  pointHistory?: PointHistory[];
  error?: string;
};

type MemberSettingsForm = {
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  phone: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const memberReturnStorageKey = "foundr1-member-return-to";

const emptyMemberSettings: MemberSettingsForm = {
  displayName: "",
  lastName: "",
  firstName: "",
  fullName: "",
  nameKana: "",
  phone: "",
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

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatDate(value: string) {
  if (!value) return "期限なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限なし";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function movementLabel(value: string) {
  if (value === "earn") return "付与";
  if (value === "refund_reversal") return "取消";
  if (value === "redeem") return "利用";
  return value || "-";
}

function formatJapanesePhoneInput(value: string) {
  const digits = value.replace(/[^\d]/g, "").slice(0, 11);
  if (/^0[789]0/.test(digits)) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (/^(0120|0800)/.test(digits)) {
    if (digits.length <= 4) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
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

function withSignedOutMarker(value: string) {
  try {
    const url = new URL(value);
    url.searchParams.delete("memberHandoff");
    url.searchParams.set("memberSignedOut", "1");
    return url.toString();
  } catch {
    return "/member?loggedOut=1";
  }
}

function toSettingsForm(member?: MemberProfile | null): MemberSettingsForm {
  if (!member) return emptyMemberSettings;
  const [fallbackLastName = "", fallbackFirstName = ""] = (member.fullName || "").trim().split(/\s+/, 2);
  return {
    displayName: member.displayName || "",
    lastName: member.lastName || fallbackLastName,
    firstName: member.firstName || fallbackFirstName,
    fullName: member.fullName || "",
    nameKana: member.nameKana || "",
    phone: member.phone || "",
    birthday: member.birthday || "",
    preferredLanguage: member.preferredLanguage || "ja",
    preferredStoreId: member.preferredStoreId || "",
    marketingOptIn: Boolean(member.marketingOptIn),
    lineLinked: Boolean(member.lineLinked)
  };
}

function hasRequiredProfileDetails(member?: MemberProfile | null) {
  return Boolean((member?.fullName?.trim() || (member?.lastName?.trim() && member?.firstName?.trim())) && member?.phone?.trim());
}

export default function MemberPage() {
  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <a className="member-portal-brand" href="/">
            <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
            <strong>Members</strong>
          </a>
        </header>

        <section className="member-portal-hero">
          <div>
            <p className="eyebrow">Member Card</p>
            <h1>会員証</h1>
            <span>ポイント、クーポン、ブランド共通の会員番号を確認できます。</span>
          </div>
        </section>

        <section className="member-portal-config">
          <strong>Clerk の環境変数が未設定です。</strong>
          <p>`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` と `CLERK_SECRET_KEY` を設定すると、メール・Google・Apple・LINE ログインを有効化できます。</p>
        </section>
      </main>
    );
  }

  return <ConfiguredMemberPortal />;
}

function ConfiguredMemberPortal() {
  const { isLoaded, isSignedIn } = useUser();
  const settingsPanelRef = useRef<HTMLDetailsElement | null>(null);
  const profilePromptShownRef = useRef(false);
  const [returnTo, setReturnTo] = useState("");
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [completeProfileRequested, setCompleteProfileRequested] = useState(false);
  const [data, setData] = useState<MemberResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [settingsForm, setSettingsForm] = useState<MemberSettingsForm>(emptyMemberSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  const qrValue = useMemo(() => {
    if (!data.member?.publicToken) return "";
    return `foundr1:member:${data.member.publicToken}`;
  }, [data.member?.publicToken]);

  const returnWithHandoffUrl = useMemo(() => {
    if (!returnTo || handoffEnabled) return "";
    return `/member?returnTo=${encodeURIComponent(returnTo)}&handoff=1`;
  }, [handoffEnabled, returnTo]);

  const profileCompletionUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    if (handoffEnabled) params.set("handoff", "1");
    params.set("completeProfile", "1");
    return `/member?${params.toString()}`;
  }, [handoffEnabled, returnTo]);

  const missingRequiredProfile = Boolean(data.member && !hasRequiredProfileDetails(data.member));
  const profileStatusLabel = missingRequiredProfile ? "必須項目が未入力です" : "必須項目は入力済みです";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextReturnTo = safeReturnTo(params.get("returnTo") || "");
    const nextLoggedOut = params.get("loggedOut") === "1";
    setReturnTo(nextReturnTo);
    setHandoffEnabled(params.get("handoff") === "1");
    setLoggedOut(nextLoggedOut);
    setCompleteProfileRequested(params.get("completeProfile") === "1");

    if (nextReturnTo) {
      window.localStorage.setItem(memberReturnStorageKey, nextReturnTo);
      return;
    }

    if (nextLoggedOut) {
      const storedReturnTo = safeReturnTo(window.localStorage.getItem(memberReturnStorageKey) || "");
      if (storedReturnTo) {
        window.localStorage.removeItem(memberReturnStorageKey);
        window.location.replace(withSignedOutMarker(storedReturnTo));
      }
      return;
    }

    window.localStorage.removeItem(memberReturnStorageKey);
  }, []);

  async function loadMember() {
    if (!isSignedIn) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) throw new Error(body.error || "会員情報を読み込めませんでした。");
      setData(body);
      setSettingsForm(toSettingsForm(body.member));
      setSettingsMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会員情報を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadMember();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !data.member || !missingRequiredProfile || profilePromptShownRef.current) return;
    profilePromptShownRef.current = true;
    window.setTimeout(() => {
      settingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, [data.member, isLoaded, isSignedIn, missingRequiredProfile]);

  async function saveSettings() {
    const requiredMissing = [
      !settingsForm.lastName.trim() ? "姓" : "",
      !settingsForm.firstName.trim() ? "名" : "",
      !settingsForm.phone.trim() ? "電話番号" : ""
    ].filter(Boolean);
    if (requiredMissing.length) {
      setSettingsOpen(true);
      setSettingsMessage(`${requiredMissing.join("、")}を入力してください。`);
      window.setTimeout(() => {
        settingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return;
    }

    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const response = await fetch("/api/public/members/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm)
      });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) throw new Error(body.error || "会員情報を保存できませんでした。");
      setData((current) => ({ ...current, member: body.member ?? current.member }));
      setSettingsForm(toSettingsForm(body.member));
      if (hasRequiredProfileDetails(body.member)) setCompleteProfileRequested(false);
      setSettingsMessage("会員情報を保存しました。");
      if (hasRequiredProfileDetails(body.member)) setSettingsOpen(false);
    } catch (error) {
      setSettingsOpen(true);
      setSettingsMessage(error instanceof Error ? error.message : "会員情報を保存できませんでした。");
    } finally {
      setSettingsSaving(false);
    }
  }

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !returnTo || !handoffEnabled || handoffStarted) return;
    if (!data.member || !hasRequiredProfileDetails(data.member)) return;
    setHandoffStarted(true);
    void fetch("/api/public/members/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo })
    })
      .then((response) => response.json().catch(() => ({})))
      .then((body) => {
        if (body?.redirectUrl) {
          window.location.href = body.redirectUrl;
          return;
        }
        setMessage(body?.error || "ログイン後の戻り先を準備できませんでした。");
      })
      .catch(() => setMessage("ログイン後の戻り先を準備できませんでした。"));
  }, [data.member, handoffEnabled, handoffStarted, isLoaded, isSignedIn, returnTo]);

  useEffect(() => {
    let active = true;
    if (!qrValue) {
      setQrDataUrl("");
      return () => {
        active = false;
      };
    }

    void import("qrcode")
      .then((qr) => qr.toDataURL(qrValue, { margin: 1, width: 192, errorCorrectionLevel: "M" }))
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });

    return () => {
      active = false;
    };
  }, [qrValue]);

  return (
    <main className="member-portal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/">
          <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </a>
        {clerkConfigured && isSignedIn ? <UserButton /> : null}
      </header>

      <section className="member-portal-hero">
        <div>
          <p className="eyebrow">Member Card</p>
          <h1>会員証</h1>
          <span>ポイント、クーポン、ブランド共通の会員番号を確認できます。</span>
        </div>
        {clerkConfigured && isLoaded && !isSignedIn ? (
            <div className="member-portal-auth-actions">
              <SignInButton mode="modal">
                <button className="primary-button" type="button">ログイン</button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl={profileCompletionUrl} fallbackRedirectUrl={profileCompletionUrl}>
                <button className="secondary-button" type="button">会員登録</button>
              </SignUpButton>
            </div>
        ) : null}
      </section>

      {
        <>
          {returnTo && handoffEnabled && isLoaded && isSignedIn ? (
            <section className="member-portal-login-panel">
              <Loader2 size={32} />
              <h2>ログイン済みです</h2>
              <p>予約ページへ戻っています。</p>
            </section>
          ) : null}

          {isLoaded && !isSignedIn ? (
            <section className="member-portal-login-panel">
              <UserRound size={32} />
              <h2>{loggedOut ? "ログアウトしました" : "ログインしてください"}</h2>
              <p>{loggedOut ? "もう一度ログインするか、会員登録をしてください。" : "メール、Google、Apple、LINE のログイン方法は Clerk ダッシュボードで有効化します。"}</p>
            </section>
          ) : null}

          {isLoaded && isSignedIn ? (
            <>
            <section className="member-portal-toolbar">
              {returnWithHandoffUrl ? (
                <a className="secondary-button" href={returnWithHandoffUrl}>サイトへ戻る</a>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => void loadMember()} disabled={loading}>
                {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
                更新
              </button>
              {message ? <span>{message}</span> : null}
            </section>

            {data.member ? (
              <section className="member-portal-grid">
                <article className="member-card-main">
                  <div>
                    <p className="eyebrow">Member No.</p>
                    <h2>{data.member.memberNumber}</h2>
                    <span>{data.member.displayName || data.member.email || "会員"}</span>
                  </div>
                  <div className="member-qr-placeholder" aria-label="会員 QR">
                    {qrDataUrl ? <img src={qrDataUrl} alt="会員 QR" /> : <QrCode size={64} />}
                    <small>店頭で提示してください</small>
                  </div>
                </article>

                <article className="member-stat-card">
                  <BadgePercent size={22} />
                  <span>ポイント</span>
                  <strong>{data.member.pointBalance.toLocaleString("ja-JP")} pt</strong>
                  <p>1 pt = 1 円</p>
                </article>

                <article className="member-stat-card">
                  <UserRound size={22} />
                  <span>ランク</span>
                  <strong>{data.member.currentTierKey}</strong>
                  <p>{data.member.lifetimeVisitCount.toLocaleString("ja-JP")} 回来店</p>
                </article>

                <article className="member-stat-card">
                  <Ticket size={22} />
                  <span>累計購入</span>
                  <strong>{formatYen(data.member.lifetimeSpendAmount)}</strong>
                  <p>Web / POS 共通</p>
                </article>
              </section>
            ) : (
              <section className="member-portal-login-panel">
                <Loader2 size={32} />
                <h2>会員情報を同期中</h2>
                <p>ログイン情報から Foundr1 会員を作成しています。</p>
              </section>
            )}

            <section className="member-portal-content-grid">
              <details
                ref={settingsPanelRef}
                className={`member-portal-panel member-settings-panel${missingRequiredProfile || completeProfileRequested ? " is-profile-task" : ""}`}
                open={settingsOpen}
                onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
              >
                <summary className="member-settings-summary">
                  <div className="member-portal-panel-title">
                    <Settings size={18} />
                    <h3>会員情報</h3>
                  </div>
                  <div className="member-settings-summary-status">
                    <span className={missingRequiredProfile ? "is-required" : "is-complete"}>{profileStatusLabel}</span>
                    <b>{settingsOpen ? "閉じる" : "編集"}</b>
                  </div>
                </summary>
                <div className="member-settings-body">
                  {missingRequiredProfile ? (
                    <div className="member-settings-required-alert">
                      <strong>会員登録を完了してください</strong>
                      <span>ポイント利用と予約時の自動入力には、氏名と電話番号が必要です。</span>
                    </div>
                  ) : null}
                  {settingsMessage ? <p className="member-settings-inline-message">{settingsMessage}</p> : null}
                  <p className="member-settings-note">氏名と電話番号は会員確認に必要です。その他の項目は任意で設定できます。</p>
                  <div className="member-settings-grid">
                    <label>
                      <span>表示名・ニックネーム</span>
                      <input value={settingsForm.displayName} onChange={(event) => setSettingsForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="例: Maamaa fan" />
                    </label>
                    <label>
                      <span>姓</span>
                      <input value={settingsForm.lastName} onChange={(event) => setSettingsForm((current) => ({ ...current, lastName: event.target.value, fullName: [event.target.value, current.firstName].filter(Boolean).join(" ") }))} placeholder="例: 山田" autoComplete="family-name" required />
                    </label>
                    <label>
                      <span>名</span>
                      <input value={settingsForm.firstName} onChange={(event) => setSettingsForm((current) => ({ ...current, firstName: event.target.value, fullName: [current.lastName, event.target.value].filter(Boolean).join(" ") }))} placeholder="例: 太郎" autoComplete="given-name" required />
                    </label>
                    <label>
                      <span>フリガナ（任意）</span>
                      <input value={settingsForm.nameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, nameKana: event.target.value }))} placeholder="例: ヤマダ タロウ" />
                    </label>
                    <label>
                      <span>電話番号</span>
                      <input value={settingsForm.phone} onChange={(event) => setSettingsForm((current) => ({ ...current, phone: formatJapanesePhoneInput(event.target.value) }))} placeholder="090-1234-5678" inputMode="tel" autoComplete="tel" required />
                    </label>
                    <label>
                      <span>生年月日（任意）</span>
                      <input type="date" value={settingsForm.birthday} onChange={(event) => setSettingsForm((current) => ({ ...current, birthday: event.target.value }))} />
                    </label>
                    <label>
                      <span>常用店（任意）</span>
                      <select value={settingsForm.preferredStoreId} onChange={(event) => setSettingsForm((current) => ({ ...current, preferredStoreId: event.target.value }))}>
                        {preferredStoreOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>表示言語（任意）</span>
                      <select value={settingsForm.preferredLanguage} onChange={(event) => setSettingsForm((current) => ({ ...current, preferredLanguage: event.target.value }))}>
                        {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="member-settings-checks">
                    <label>
                      <input type="checkbox" checked={settingsForm.marketingOptIn} onChange={(event) => setSettingsForm((current) => ({ ...current, marketingOptIn: event.target.checked }))} />
                      <span>クーポンやキャンペーンのお知らせを受け取る</span>
                    </label>
                    <label>
                      <input type="checkbox" checked={settingsForm.lineLinked} onChange={(event) => setSettingsForm((current) => ({ ...current, lineLinked: event.target.checked }))} />
                      <span>LINE連携済みとして記録する（本連携機能は準備中）</span>
                    </label>
                  </div>
                  <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={settingsSaving}>
                    {settingsSaving ? "保存中..." : "会員情報を保存"}
                  </button>
                </div>
              </details>

              <article className="member-portal-panel">
                <div className="member-portal-panel-title">
                  <Gift size={18} />
                  <h3>クーポン</h3>
                </div>
                <div className="member-portal-list">
                  {data.coupons?.length ? data.coupons.map((coupon) => (
                    <div key={coupon.id} className="member-portal-list-row">
                      <div>
                        <strong>{coupon.name}</strong>
                        <span>{coupon.couponCode} / {formatDate(coupon.expiresAt)}</span>
                      </div>
                      <b>{coupon.discountType === "amount" ? formatYen(coupon.discountValue) : `${coupon.discountValue}%`}</b>
                    </div>
                  )) : <p>利用できるクーポンはありません。</p>}
                </div>
              </article>

              <article className="member-portal-panel">
                <div className="member-portal-panel-title">
                  <BadgePercent size={18} />
                  <h3>ポイント履歴</h3>
                </div>
                <div className="member-portal-list">
                  {data.pointHistory?.length ? data.pointHistory.map((entry) => (
                    <div key={entry.id} className="member-portal-list-row">
                      <div>
                        <strong>{movementLabel(entry.movementType)} / {entry.storeName || entry.brandName || "-"}</strong>
                        <span>{formatDate(entry.createdAt)} / {formatYen(entry.eligibleAmount)}</span>
                      </div>
                      <b className={entry.points < 0 ? "is-negative" : ""}>{entry.points.toLocaleString("ja-JP")} pt</b>
                    </div>
                  )) : <p>ポイント履歴はまだありません。</p>}
                </div>
              </article>
            </section>
            </>
          ) : null}
        </>
      }
    </main>
  );
}
