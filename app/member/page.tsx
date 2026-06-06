"use client";

import { SignInButton, SignOutButton, SignUpButton, useUser } from "@clerk/nextjs";
import { BadgePercent, ChevronDown, ExternalLink, Gift, Loader2, LogIn, LogOut, QrCode, RefreshCw, Settings, Stamp, Ticket, UserPlus, UserRound } from "lucide-react";
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

type MemberStampCard = {
  id: string;
  campaignKey: string;
  name: string;
  brandName: string;
  stampsRequired: number;
  rewardCouponName: string;
  rewardValueAmount: number;
  totalStamps: number;
  currentStamps: number;
  availableRewards: number;
  issuedRewards: number;
  lastStampedAt: string;
  validUntil: string;
};

type MemberResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  coupons?: MemberCoupon[];
  pointHistory?: PointHistory[];
  stampCards?: MemberStampCard[];
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
const memberReturnStorageKey = "foundr1-member-return-to";

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

const memberBrandLinks = [
  {
    name: "nanacha",
    description: "タピオカ、ミルクティー、フルーツティーを気軽に楽しめるティースタンド。",
    href: "https://www.nanacha.jp/",
    image: "/brands/nanacha-logo.png",
    imageClassName: "is-wide"
  },
  {
    name: "まぁ麻",
    description: "出来立てで楽しむ、辛さと痺れを選べる麻辣湯。",
    href: "https://maamaa.jp/",
    image: "/brands/maamaa-logo.png",
    imageClassName: "is-mark"
  }
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

function stampCardProgressLabel(card: MemberStampCard) {
  const required = Math.max(1, Number(card.stampsRequired) || 1);
  const current = Math.max(0, Math.min(required, Number(card.currentStamps) || 0));
  return `${current} / ${required}`;
}

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

function hasRequiredProfileDetails(member?: MemberProfile | null) {
  return Boolean(member?.displayName?.trim() && (member?.fullName?.trim() || (member?.lastName?.trim() && member?.firstName?.trim())) && member?.phone?.trim());
}

function getFormalMemberName(member?: MemberProfile | null) {
  return (member?.fullName || [member?.lastName, member?.firstName].map((part) => part?.trim()).filter(Boolean).join(" ")).trim();
}

function getMemberCardDisplayName(member?: MemberProfile | null) {
  const formalName = getFormalMemberName(member);
  if (formalName) return `${formalName} 様`;
  return member?.displayName?.trim() || member?.email?.trim() || "会員";
}

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }) {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "会員";
}

export default function MemberPage() {
  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <div className="member-portal-brand" aria-label="Foundr1 Members">
            <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
            <strong>Members</strong>
          </div>
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
  const { isLoaded, isSignedIn, user } = useUser();
  const settingsPanelRef = useRef<HTMLDetailsElement | null>(null);
  const couponPanelRef = useRef<HTMLElement | null>(null);
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
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [settingsForm, setSettingsForm] = useState<MemberSettingsForm>(emptyMemberSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [selectedCouponId, setSelectedCouponId] = useState("");

  const qrValue = useMemo(() => {
    if (!data.member?.publicToken) return "";
    return selectedCouponId ? `foundr1:member:${data.member.publicToken}:coupon:${selectedCouponId}` : `foundr1:member:${data.member.publicToken}`;
  }, [data.member?.publicToken, selectedCouponId]);

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
  const returningToSite = Boolean(returnTo && handoffEnabled && isLoaded && isSignedIn && !handoffFailed && (!data.member || hasRequiredProfileDetails(data.member)));
  const readyToReturnToSite = Boolean(returningToSite && data.member && hasRequiredProfileDetails(data.member));
  const selectedCoupon = data.coupons?.find((coupon) => coupon.id === selectedCouponId) ?? null;
  const couponBadgeLabel = selectedCoupon
    ? "クーポン選択済み"
    : data.coupons?.length
      ? `利用可能クーポン ${data.coupons.length}件`
      : "";

  const scrollToCoupons = () => {
    window.requestAnimationFrame(() => {
      const target = selectedCouponId
        ? document.getElementById(`member-coupon-${selectedCouponId}`)
        : null;
      (target ?? couponPanelRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

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
      setSelectedCouponId((current) => body.coupons?.some((coupon) => coupon.id === current) ? current : "");
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
      !settingsForm.displayName.trim() ? "表示名・ニックネーム" : "",
      !settingsForm.lastName.trim() ? "姓" : "",
      !settingsForm.firstName.trim() ? "名" : "",
      !(settingsForm.phonePart1.trim() && settingsForm.phonePart2.trim() && settingsForm.phonePart3.trim()) ? "電話番号" : ""
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
    setHandoffFailed(false);
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
        setHandoffFailed(true);
        setMessage(body?.error || "ログイン後の戻り先を準備できませんでした。");
      })
      .catch(() => {
        setHandoffFailed(true);
        setMessage("ログイン後の戻り先を準備できませんでした。");
      });
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
        <div className="member-portal-brand" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </div>
        {clerkConfigured && isSignedIn ? (
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
              <button
                className="member-account-menu-item"
                type="button"
                onClick={() => {
                  setSettingsOpen(true);
                  window.setTimeout(() => {
                    settingsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 80);
                }}
              >
                <Settings size={16} />
                会員情報を編集
              </button>
              {returnWithHandoffUrl ? (
                <a className="member-account-menu-item" href={returnWithHandoffUrl}>
                  <LogIn size={16} />
                  サイトへ戻る
                </a>
              ) : null}
              <SignOutButton redirectUrl="/member?loggedOut=1">
                <button className="member-account-menu-item" type="button">
                  <LogOut size={16} />
                  ログアウト
                </button>
              </SignOutButton>
              <SignOutButton redirectUrl="/member?loggedOut=1&switchAccount=1">
                <button className="member-account-menu-item is-muted" type="button">
                  <UserPlus size={16} />
                  別のアカウントでログイン
                </button>
              </SignOutButton>
            </div>
          </details>
        ) : null}
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
                <button className="primary-button" type="button"><LogIn size={16} />ログイン</button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl={profileCompletionUrl} fallbackRedirectUrl={profileCompletionUrl}>
                <button className="secondary-button" type="button"><UserPlus size={16} />会員登録</button>
              </SignUpButton>
            </div>
        ) : null}
      </section>

      {
        <>
          {returningToSite ? (
            <section className="member-portal-login-panel member-return-panel" aria-live="polite">
              <Loader2 size={34} />
              <h2>{readyToReturnToSite ? "サイトへ戻っています" : "会員情報を確認中です"}</h2>
              <p>{readyToReturnToSite ? "予約ページへ自動で戻ります。" : "戻り先のサイトへ連携する準備をしています。"}</p>
            </section>
          ) : null}

          {isLoaded && !isSignedIn ? (
            <section className="member-portal-login-panel">
              <UserRound size={32} />
              <h2>{loggedOut ? "ログアウトしました" : "ログインしてください"}</h2>
              <p>{loggedOut ? "もう一度ログインするか、会員登録をしてください。" : "メール、Google、Apple、LINE のログイン方法は Clerk ダッシュボードで有効化します。"}</p>
            </section>
          ) : null}

          {isLoaded && isSignedIn && !returningToSite ? (
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
                    <span>{getMemberCardDisplayName(data.member)}</span>
                  </div>
                  <div className="member-qr-placeholder" aria-label="会員 QR">
                    {qrDataUrl ? <img src={qrDataUrl} alt="会員 QR" /> : <QrCode size={64} />}
                    <small>店頭で提示してください</small>
                    {data.coupons?.length ? (
                      <button className="member-card-coupon-badge" type="button" onClick={scrollToCoupons}>
                        <Gift size={13} />
                        {couponBadgeLabel}
                      </button>
                    ) : null}
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

            {data.stampCards?.length ? (
              <section className="member-stamp-card-grid" aria-label="スタンプカード">
                {data.stampCards.map((card) => {
                  const required = Math.max(1, Number(card.stampsRequired) || 1);
                  const current = Math.max(0, Math.min(required, Number(card.currentStamps) || 0));
                  return (
                    <article key={card.id} className="member-stamp-card">
                      <div className="member-stamp-card-head">
                        <div>
                          <p className="eyebrow">Stamp Card</p>
                          <h2>{card.name}</h2>
                          <span>{card.brandName || "Foundr1"} / {card.rewardCouponName || "特典クーポン"}</span>
                        </div>
                        <div className="member-stamp-card-count">
                          <Stamp size={18} />
                          <strong>{stampCardProgressLabel(card)}</strong>
                        </div>
                      </div>
                      <div className="member-stamp-slots" aria-label={`${card.name} ${stampCardProgressLabel(card)}`}>
                        {Array.from({ length: required }).map((_, index) => (
                          <span key={`${card.id}-${index}`} className={index < current ? "is-filled" : ""}>
                            <Stamp size={18} />
                          </span>
                        ))}
                      </div>
                      <div className="member-stamp-card-foot">
                        <span>累計 {card.totalStamps.toLocaleString("ja-JP")} stamp</span>
                        {card.availableRewards > 0 ? <b>特典 {card.availableRewards.toLocaleString("ja-JP")}件 利用可</b> : <b>あと {Math.max(0, required - current).toLocaleString("ja-JP")} stamp</b>}
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : null}

            <section className="member-portal-content-grid">
              <article className="member-portal-panel" id="member-coupons" ref={couponPanelRef}>
                <div className="member-portal-panel-title">
                  <Gift size={18} />
                  <h3>クーポン</h3>
                </div>
                <div className="member-portal-list">
                  {data.coupons?.length ? data.coupons.map((coupon) => (
                    <div key={coupon.id} id={`member-coupon-${coupon.id}`} className="member-portal-list-row">
                      <div>
                        <strong>{coupon.name}</strong>
                        <span>{coupon.couponCode} / {formatDate(coupon.expiresAt)}{selectedCouponId === coupon.id ? " / 使用予定" : ""}</span>
                      </div>
                      <b>{coupon.discountType === "amount" ? formatYen(coupon.discountValue) : `${coupon.discountValue}%`}</b>
                      <button
                        className={selectedCouponId === coupon.id ? "member-coupon-use-button is-selected" : "member-coupon-use-button"}
                        type="button"
                        onClick={() => setSelectedCouponId((current) => current === coupon.id ? "" : coupon.id)}
                      >
                        {selectedCouponId === coupon.id ? "選択解除" : "使う"}
                      </button>
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
                      <span>ポイント利用と予約時の自動入力には、表示名・氏名・電話番号が必要です。</span>
                    </div>
                  ) : null}
                  {settingsMessage ? <p className="member-settings-inline-message">{settingsMessage}</p> : null}
                  <p className="member-settings-note">表示名、氏名、電話番号は会員確認に必要です。その他の項目は任意で設定できます。</p>
                  <div className="member-settings-grid">
                    <label className="member-settings-field-wide">
                      <span>表示名・ニックネーム</span>
                      <input value={settingsForm.displayName} onChange={(event) => setSettingsForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="例: Maamaa fan" />
                    </label>
                    <label className="member-settings-field-name">
                      <span>姓</span>
                      <input value={settingsForm.lastName} onChange={(event) => setSettingsForm((current) => ({ ...current, lastName: event.target.value, fullName: [event.target.value, current.firstName].filter(Boolean).join(" ") }))} placeholder="例: 山田" autoComplete="family-name" required />
                    </label>
                    <label className="member-settings-field-name">
                      <span>名</span>
                      <input value={settingsForm.firstName} onChange={(event) => setSettingsForm((current) => ({ ...current, firstName: event.target.value, fullName: [current.lastName, event.target.value].filter(Boolean).join(" ") }))} placeholder="例: 太郎" autoComplete="given-name" required />
                    </label>
                    <label className="member-settings-field-kana">
                      <span>セイ（任意）</span>
                      <input value={settingsForm.lastNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, lastNameKana: event.target.value, nameKana: [event.target.value, current.firstNameKana].filter(Boolean).join(" ") }))} placeholder="例: ヤマダ" autoComplete="section-kana family-name" />
                    </label>
                    <label className="member-settings-field-kana">
                      <span>メイ（任意）</span>
                      <input value={settingsForm.firstNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, firstNameKana: event.target.value, nameKana: [current.lastNameKana, event.target.value].filter(Boolean).join(" ") }))} placeholder="例: タロウ" autoComplete="section-kana given-name" />
                    </label>
                    <label>
                      <span>電話番号</span>
                      <div className="member-phone-segments">
                        <input value={settingsForm.phonePart1} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart1: event.target.value.replace(/[^\d]/g, "").slice(0, 5), phone: composeJapanesePhone(event.target.value, current.phonePart2, current.phonePart3) }))} placeholder="090" inputMode="numeric" autoComplete="tel-area-code" aria-label="電話番号 1" required />
                        <span>-</span>
                        <input value={settingsForm.phonePart2} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart2: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, event.target.value, current.phonePart3) }))} placeholder="1234" inputMode="numeric" autoComplete="tel-local-prefix" aria-label="電話番号 2" required />
                        <span>-</span>
                        <input value={settingsForm.phonePart3} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart3: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, current.phonePart2, event.target.value) }))} placeholder="5678" inputMode="numeric" autoComplete="tel-local-suffix" aria-label="電話番号 3" required />
                      </div>
                    </label>
                    <label>
                      <span>生年月日（任意）</span>
                      <input type="date" value={settingsForm.birthday} onChange={(event) => setSettingsForm((current) => ({ ...current, birthday: event.target.value }))} />
                    </label>
                    <label>
                      <span>よく利用する店舗（任意）</span>
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

              <article className="member-portal-panel member-brand-panel">
                <div className="member-portal-panel-title">
                  <ExternalLink size={18} />
                  <h3>ブランド</h3>
                </div>
                <div className="member-brand-grid" aria-label="Foundr1 会員ブランド">
                  {memberBrandLinks.map((brand) => (
                    <a key={brand.name} className="member-brand-card" href={brand.href} target="_blank" rel="noreferrer">
                      <span className="member-brand-logo">
                        <img className={brand.imageClassName} src={brand.image} alt={`${brand.name} ロゴ`} />
                      </span>
                      <span className="member-brand-copy">
                        <strong>{brand.name}</strong>
                        <small>{brand.description}</small>
                      </span>
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  ))}
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
