"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { BadgePercent, ExternalLink, Gift, Loader2, LogIn, LogOut, Megaphone, QrCode, RefreshCw, Settings, ShoppingBag, Sparkles, Stamp, Ticket, UserPlus, UserRound, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemberAccountMenu } from "../../components/member/MemberAccountMenu";
import { MemberAuthPanel } from "../../components/member/MemberAuthPanel";
import { MemberLanguageSwitcher, useMemberLanguage } from "../../components/member/MemberLanguageProvider";
import type { MemberOrderHistory } from "../../components/member/MemberOrderHistoryPanel";
import { memberText } from "../../components/member/memberTranslations";

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
  brandName: string;
  couponCode: string;
  name: string;
  displayNames?: Record<string, string>;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  expiresAt: string;
  issuedSource: string;
};

type MemberStampCard = {
  id: string;
  campaignKey: string;
  name: string;
  displayNames?: Record<string, string>;
  brandName: string;
  stampsRequired: number;
  rewardCouponName: string;
  rewardCouponDisplayNames?: Record<string, string>;
  rewardValueAmount: number;
  totalStamps: number;
  currentStamps: number;
  availableRewards: number;
  issuedRewards: number;
  lastStampedAt: string;
  validUntil: string;
};

type MemberAppAnnouncement = {
  id: string;
  title: string;
  body: string;
  displayTitles?: Record<string, string>;
  displayBodies?: Record<string, string>;
  kind: string;
  ctaLabel: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
  status: string;
  createdAt: string;
};

type MemberResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  coupons?: MemberCoupon[];
  orders?: MemberOrderHistory[];
  stampCards?: MemberStampCard[];
  appAnnouncements?: MemberAppAnnouncement[];
  error?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const memberReturnStorageKey = "foundr1-member-return-to";
const memberPopupDismissedStorageKey = "foundr1-member-popup-dismissed";

const memberPopupText = {
  ja: {
    eyebrow: "お知らせ",
    title: "新しいお知らせがあります",
    couponTitle: "利用できるクーポンがあります",
    couponBody: "店頭で会員証を提示すると、対象クーポンを利用できます。",
    couponAction: "クーポンを見る",
    close: "閉じる"
  },
  zh: {
    eyebrow: "通知",
    title: "你有新的通知",
    couponTitle: "有可用优惠券",
    couponBody: "到店出示会员证即可使用适用优惠券。",
    couponAction: "查看优惠券",
    close: "关闭"
  },
  "zh-Hant": {
    eyebrow: "通知",
    title: "你有新的通知",
    couponTitle: "有可用優惠券",
    couponBody: "到店出示會員證即可使用適用優惠券。",
    couponAction: "查看優惠券",
    close: "關閉"
  },
  en: {
    eyebrow: "Notice",
    title: "You have a new update",
    couponTitle: "You have available coupons",
    couponBody: "Show your member card in store to use eligible coupons.",
    couponAction: "View coupons",
    close: "Close"
  },
  ko: {
    eyebrow: "알림",
    title: "새로운 알림이 있습니다",
    couponTitle: "사용 가능한 쿠폰이 있습니다",
    couponBody: "매장에서 회원증을 제시하면 대상 쿠폰을 사용할 수 있습니다.",
    couponAction: "쿠폰 보기",
    close: "닫기"
  },
  vi: {
    eyebrow: "Thông báo",
    title: "Bạn có thông báo mới",
    couponTitle: "Bạn có phiếu giảm giá có thể dùng",
    couponBody: "Xuất trình thẻ thành viên tại cửa hàng để dùng phiếu phù hợp.",
    couponAction: "Xem phiếu",
    close: "Đóng"
  },
  ne: {
    eyebrow: "सूचना",
    title: "नयाँ सूचना छ",
    couponTitle: "प्रयोग गर्न मिल्ने कुपन छ",
    couponBody: "पसलमा सदस्य कार्ड देखाएर योग्य कुपन प्रयोग गर्न सक्नुहुन्छ।",
    couponAction: "कुपन हेर्नुहोस्",
    close: "बन्द गर्नुहोस्"
  }
};

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

function formatDate(value: string, noExpiryLabel = "期限なし") {
  if (!value) return noExpiryLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return noExpiryLabel;
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function stampCardProgressLabel(card: MemberStampCard) {
  const required = Math.max(1, Number(card.stampsRequired) || 1);
  const current = Math.max(0, Math.min(required, Number(card.currentStamps) || 0));
  return `${current} / ${required}`;
}

function couponScopeLabel(coupon: { brandName?: string }, text: typeof memberText[keyof typeof memberText]) {
  return coupon.brandName ? `${coupon.brandName}` : text.allStores;
}

function isExchangeCoupon(coupon: { issuedSource?: string; name?: string }) {
  return coupon.issuedSource === "stamp_campaign" || Boolean(coupon.name?.includes("無料券"));
}

function couponValueLabel(coupon: MemberCoupon, text: typeof memberText[keyof typeof memberText]) {
  if (isExchangeCoupon(coupon)) return text.oneCupExchange;
  return coupon.discountType === "amount" ? formatYen(coupon.discountValue) : `${coupon.discountValue}%`;
}

function localizedMemberBenefitName(name: string, displayNames: Record<string, string> | undefined, language: string) {
  if (language === "ja") return name;
  return displayNames?.[language] || name;
}

function localizedAnnouncementText(source: string, displayValues: Record<string, string> | undefined, language: string) {
  if (language === "ja") return source;
  return displayValues?.[language] || source;
}

type MemberPopupItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  detail: string;
  ctaLabel: string;
  ctaUrl?: string;
  couponId?: string;
};

function getMemberPopupSignature(memberId: string, items: MemberPopupItem[]) {
  if (!memberId || !items.length) return "";
  return `${memberId}:${items.map((item) => item.id).join("|")}`;
}

function getMemberPopupItems(input: {
  announcements?: MemberAppAnnouncement[];
  coupons?: MemberCoupon[];
  language: string;
  labels: typeof memberPopupText[keyof typeof memberPopupText];
  text: typeof memberText[keyof typeof memberText];
}) {
  const announcementItems = (input.announcements ?? []).map((announcement) => ({
    id: `announcement:${announcement.id}`,
    kind: announcement.kind || "campaign",
    title: localizedAnnouncementText(announcement.title, announcement.displayTitles, input.language),
    body: localizedAnnouncementText(announcement.body, announcement.displayBodies, input.language),
    detail: announcement.endsAt ? `${input.text.dateTime}: ${formatDate(announcement.endsAt, input.text.dateNoExpiry)}` : "",
    ctaLabel: announcement.ctaLabel || "",
    ctaUrl: announcement.ctaUrl || ""
  }));
  const couponItems = (input.coupons ?? []).slice(0, 3).map((coupon) => ({
    id: `coupon:${coupon.id}`,
    kind: "coupon",
    title: localizedMemberBenefitName(coupon.name, coupon.displayNames, input.language) || input.labels.couponTitle,
    body: input.labels.couponBody,
    detail: `${couponScopeLabel(coupon, input.text)} / ${couponValueLabel(coupon, input.text)} / ${formatDate(coupon.expiresAt, input.text.dateNoExpiry)}`,
    ctaLabel: input.labels.couponAction,
    couponId: coupon.id
  }));
  return [...announcementItems, ...couponItems].filter((item) => item.title.trim() && item.body.trim()).slice(0, 5);
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

function hasRequiredProfileDetails(member?: MemberProfile | null) {
  return Boolean(member?.displayName?.trim() && (member?.fullName?.trim() || (member?.lastName?.trim() && member?.firstName?.trim())) && member?.phone?.trim());
}

function getFormalMemberName(member?: MemberProfile | null) {
  return (member?.fullName || [member?.lastName, member?.firstName].map((part) => part?.trim()).filter(Boolean).join(" ")).trim();
}

function withJapaneseHonorific(value: string, language: string) {
  const name = value.trim();
  if (!name) return name;
  if (language !== "ja") return name;
  return name.endsWith("様") ? name : `${name} 様`;
}

function getMemberCardDisplayName(member?: MemberProfile | null, fallback = "会員", language = "ja") {
  const formalName = getFormalMemberName(member);
  const displayName = formalName || member?.displayName?.trim() || member?.email?.trim() || fallback;
  return withJapaneseHonorific(displayName, language);
}

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }, fallback = "会員") {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || fallback;
}

function MemberAppPopup({
  labels,
  items,
  onClose,
  onCouponSelect
}: {
  labels: typeof memberPopupText[keyof typeof memberPopupText];
  items: MemberPopupItem[];
  onClose: () => void;
  onCouponSelect: (couponId: string) => void;
}) {
  return (
    <div className="member-app-popup-backdrop" role="presentation">
      <section className="member-app-popup" role="dialog" aria-modal="true" aria-labelledby="member-app-popup-title">
        <button className="member-app-popup-close" type="button" onClick={onClose} aria-label={labels.close}>
          <X size={20} />
        </button>
        <div className="member-app-popup-heading">
          <span><Megaphone size={18} /></span>
          <div>
            <p className="eyebrow">{labels.eyebrow}</p>
            <h2 id="member-app-popup-title">{labels.title}</h2>
          </div>
        </div>
        <div className="member-app-popup-list">
          {items.map((item) => (
            <article key={item.id} className="member-app-popup-item">
              <span className="member-app-popup-item-icon">
                {item.kind === "coupon" ? <Gift size={18} /> : <Sparkles size={18} />}
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                {item.detail ? <small>{item.detail}</small> : null}
                {item.couponId ? (
                  <button type="button" onClick={() => onCouponSelect(item.couponId)}>
                    {item.ctaLabel}
                  </button>
                ) : item.ctaUrl && item.ctaLabel ? (
                  <a href={item.ctaUrl} target="_blank" rel="noreferrer">
                    {item.ctaLabel}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function MemberPage() {
  const { language } = useMemberLanguage();
  const text = memberText[language];
  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <div className="member-portal-brand" aria-label="Foundr1 Members">
            <span><img src="/icons/foundr1-member-512.png" alt="Foundr1" /></span>
            <strong>Members</strong>
          </div>
          <MemberLanguageSwitcher />
        </header>

        <section className="member-portal-hero">
          <div>
            <p className="eyebrow">{text.memberCard}</p>
            <h1>{text.memberCardTitle}</h1>
            <span>{text.memberCardDescription}</span>
          </div>
        </section>

        <section className="member-portal-config">
          <strong>{text.notConfiguredTitle}</strong>
          <p>{text.memberNotConfiguredBody}</p>
        </section>
      </main>
    );
  }

  return <ConfiguredMemberPortal />;
}

function ConfiguredMemberPortal() {
  const { language, syncPreferredLanguage } = useMemberLanguage();
  const text = memberText[language];
  const { isLoaded, isSignedIn, user } = useUser();
  const couponPanelRef = useRef<HTMLElement | null>(null);
  const [returnTo, setReturnTo] = useState("");
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [data, setData] = useState<MemberResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [selectedCouponId, setSelectedCouponId] = useState("");
  const [dismissedPopupSignature, setDismissedPopupSignature] = useState("");
  const [memberPopupOpen, setMemberPopupOpen] = useState(false);

  const qrValue = useMemo(() => {
    if (!data.member?.publicToken) return "";
    const languageSegment = language ? `:lang:${language}` : "";
    return selectedCouponId
      ? `foundr1:member:${data.member.publicToken}${languageSegment}:coupon:${selectedCouponId}`
      : `foundr1:member:${data.member.publicToken}${languageSegment}`;
  }, [data.member?.publicToken, language, selectedCouponId]);

  const returnWithHandoffUrl = useMemo(() => {
    if (!returnTo || handoffEnabled) return "";
    return `/member?returnTo=${encodeURIComponent(returnTo)}&handoff=1`;
  }, [handoffEnabled, returnTo]);

  const profileCompletionUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    if (handoffEnabled) params.set("handoff", "1");
    const query = params.toString();
    return query ? `/member?${query}` : "/member";
  }, [handoffEnabled, returnTo]);

  const missingRequiredProfile = Boolean(data.member && !hasRequiredProfileDetails(data.member));
  const returningToSite = Boolean(returnTo && handoffEnabled && isLoaded && isSignedIn && !handoffFailed && (!data.member || hasRequiredProfileDetails(data.member)));
  const readyToReturnToSite = Boolean(returningToSite && data.member && hasRequiredProfileDetails(data.member));
  const selectedCoupon = data.coupons?.find((coupon) => coupon.id === selectedCouponId) ?? null;
  const couponBadgeLabel = selectedCoupon
    ? text.couponSelected
    : data.coupons?.length
      ? text.availableCoupons(data.coupons.length)
      : "";
  const popupLabels = memberPopupText[language];
  const memberPopupItems = useMemo(() => getMemberPopupItems({
    announcements: data.appAnnouncements,
    coupons: data.coupons,
    language,
    labels: popupLabels,
    text
  }), [data.appAnnouncements, data.coupons, language, popupLabels, text]);
  const memberPopupSignature = useMemo(
    () => getMemberPopupSignature(data.member?.id ?? "", memberPopupItems),
    [data.member?.id, memberPopupItems]
  );

  const scrollToCoupons = () => {
    window.requestAnimationFrame(() => {
      const target = selectedCouponId
        ? document.getElementById(`member-coupon-${selectedCouponId}`)
        : null;
      (target ?? couponPanelRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const dismissMemberPopup = () => {
    setMemberPopupOpen(false);
    if (!memberPopupSignature) return;
    window.localStorage.setItem(memberPopupDismissedStorageKey, memberPopupSignature);
    setDismissedPopupSignature(memberPopupSignature);
  };

  const selectPopupCoupon = (couponId: string) => {
    setSelectedCouponId(couponId);
    dismissMemberPopup();
    window.requestAnimationFrame(scrollToCoupons);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextReturnTo = safeReturnTo(params.get("returnTo") || "");
    const nextLoggedOut = params.get("loggedOut") === "1";
    setReturnTo(nextReturnTo);
    setHandoffEnabled(params.get("handoff") === "1");
    setLoggedOut(nextLoggedOut);

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
    setDismissedPopupSignature(window.localStorage.getItem(memberPopupDismissedStorageKey) || "");
  }, []);

  async function loadMember() {
    if (!isSignedIn) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) throw new Error(body.error || text.loadMemberError);
      setData(body);
      syncPreferredLanguage(body.member?.preferredLanguage);
      setSelectedCouponId((current) => body.coupons?.some((coupon) => coupon.id === current) ? current : "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.loadMemberError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadMember();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !missingRequiredProfile) return;
    const params = new URLSearchParams();
    params.set("completeProfile", "1");
    if (returnTo) params.set("returnTo", returnTo);
    if (handoffEnabled) params.set("handoff", "1");
    window.location.replace(`/member/settings?${params.toString()}`);
  }, [handoffEnabled, isLoaded, isSignedIn, missingRequiredProfile, returnTo]);

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
        setMessage(body?.error || text.returnPrepareError);
      })
      .catch(() => {
        setHandoffFailed(true);
        setMessage(text.returnPrepareError);
      });
  }, [data.member, handoffEnabled, handoffStarted, isLoaded, isSignedIn, returnTo]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || returningToSite || missingRequiredProfile || !memberPopupSignature) {
      setMemberPopupOpen(false);
      return;
    }
    setMemberPopupOpen(memberPopupSignature !== dismissedPopupSignature);
  }, [dismissedPopupSignature, isLoaded, isSignedIn, memberPopupSignature, missingRequiredProfile, returningToSite]);

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
      {memberPopupOpen && memberPopupItems.length ? (
        <MemberAppPopup
          labels={popupLabels}
          items={memberPopupItems}
          onClose={dismissMemberPopup}
          onCouponSelect={selectPopupCoupon}
        />
      ) : null}
      <header className="member-portal-topbar">
        <div className="member-portal-brand" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-member-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </div>
        <div className="member-topbar-actions">
          <MemberLanguageSwitcher />
        {clerkConfigured && isSignedIn ? (
          <MemberAccountMenu
            label={text.memberMenu}
            signedInLabel={text.signedIn}
            displayName={getAccountDisplayName(data.member, user, text.member)}
            detail={data.member?.memberNumber || user?.primaryEmailAddress?.emailAddress || text.signedIn}
            memberNumberLabel={text.memberNumber}
            memberNumber={data.member?.memberNumber}
          >
              <a className="member-account-menu-item" href="/member/settings">
                <Settings size={16} />
                {text.editMemberInfo}
              </a>
              <a className="member-account-menu-item" href="/member/orders">
                <ShoppingBag size={16} />
                {text.ordersAndReceipts}
              </a>
              <a className="member-account-menu-item" href="/member/points">
                <BadgePercent size={16} />
                {text.pointHistory}
              </a>
              {returnWithHandoffUrl ? (
                <a className="member-account-menu-item" href={returnWithHandoffUrl}>
                  <LogIn size={16} />
                  {text.returnToSite}
                </a>
              ) : null}
              <SignOutButton redirectUrl="/member?loggedOut=1">
                <button className="member-account-menu-item" type="button">
                  <LogOut size={16} />
                  {text.signOut}
                </button>
              </SignOutButton>
              <SignOutButton redirectUrl="/member?loggedOut=1&switchAccount=1">
                <button className="member-account-menu-item is-muted" type="button">
                  <UserPlus size={16} />
                  {text.switchAccount}
                </button>
              </SignOutButton>
          </MemberAccountMenu>
        ) : null}
        </div>
      </header>

      <section className="member-portal-hero">
        <div>
          <p className="eyebrow">{text.memberCard}</p>
          <h1>{text.memberCardTitle}</h1>
          <span>{text.memberCardDescription}</span>
        </div>
      </section>

      {
        <>
          {returningToSite ? (
            <section className="member-portal-login-panel member-return-panel" aria-live="polite">
              <Loader2 size={34} />
              <h2>{readyToReturnToSite ? text.returningTitle : text.checkingMemberTitle}</h2>
              <p>{readyToReturnToSite ? text.returningBody : text.preparingReturnBody}</p>
            </section>
          ) : null}

          {clerkConfigured && !isLoaded ? (
            <section className="member-portal-login-panel member-return-panel" aria-live="polite">
              <Loader2 size={34} />
              <h2>{text.loadingAuth}</h2>
              <p>{text.preparingAuth}</p>
            </section>
          ) : null}

          {isLoaded && !isSignedIn ? (
            <MemberAuthPanel
              title={loggedOut ? text.signedOutTitle : text.loginOrRegister}
              description={loggedOut ? text.signedOutDescription : text.loginDescription}
              afterAuthUrl={profileCompletionUrl}
            />
          ) : null}

          {isLoaded && isSignedIn && !returningToSite ? (
            <>
            <section className="member-portal-toolbar">
              {returnWithHandoffUrl ? (
                <a className="secondary-button" href={returnWithHandoffUrl}>{text.returnToSite}</a>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => void loadMember()} disabled={loading}>
                {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
                {text.refresh}
              </button>
              {message ? <span>{message}</span> : null}
            </section>

            {data.member ? (
              <section className="member-portal-grid">
                <article className="member-card-main">
                  <div>
                    <p className="eyebrow">{text.memberNo}</p>
                    <h2>{data.member.memberNumber}</h2>
                    <span>{getMemberCardDisplayName(data.member, text.member, language)}</span>
                  </div>
                  <div className="member-qr-placeholder" aria-label="会員 QR">
                    {qrDataUrl ? <img src={qrDataUrl} alt="会員 QR" /> : <QrCode size={64} />}
                    <small>{text.presentAtStore}</small>
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
                  <span>{text.points}</span>
                  <strong>{data.member.pointBalance.toLocaleString("ja-JP")} pt</strong>
                  <p>{text.pointRate}</p>
                </article>

                <article className="member-stat-card">
                  <UserRound size={22} />
                  <span>{text.rank}</span>
                  <strong>{data.member.currentTierKey}</strong>
                  <p>{text.visits(data.member.lifetimeVisitCount)}</p>
                </article>

                <article className="member-stat-card">
                  <Ticket size={22} />
                  <span>{text.lifetimeSpend}</span>
                  <strong>{formatYen(data.member.lifetimeSpendAmount)}</strong>
                  <p>{text.webPosShared}</p>
                </article>
              </section>
            ) : (
              <section className="member-portal-login-panel">
                <Loader2 size={32} />
                <h2>{text.syncMemberTitle}</h2>
                <p>{text.syncMemberBody}</p>
              </section>
            )}

            {data.stampCards?.length ? (
              <section className="member-stamp-card-grid" aria-label="スタンプカード">
                {data.stampCards.map((card) => {
                  const required = Math.max(1, Number(card.stampsRequired) || 1);
                  const current = Math.max(0, Math.min(required, Number(card.currentStamps) || 0));
                  const cardName = localizedMemberBenefitName(card.name, card.displayNames, language);
                  const rewardCouponName = localizedMemberBenefitName(card.rewardCouponName || "特典クーポン", card.rewardCouponDisplayNames, language);
                  return (
                    <article key={card.id} className="member-stamp-card">
                      <div className="member-stamp-card-head">
                        <div>
                          <p className="eyebrow">{text.stampCard}</p>
                          <h2>{cardName}</h2>
                          <span>{card.brandName || "Foundr1"} / {rewardCouponName}</span>
                        </div>
                        <div className="member-stamp-card-count">
                          <Stamp size={18} />
                          <strong>{stampCardProgressLabel(card)}</strong>
                        </div>
                      </div>
                      <div className="member-stamp-slots" style={{ "--member-stamp-count": required } as CSSProperties} aria-label={`${cardName} ${stampCardProgressLabel(card)}`}>
                        {Array.from({ length: required }).map((_, index) => (
                          <span key={`${card.id}-${index}`} className={index < current ? "is-filled" : ""}>
                            <i className="member-stamp-mark" aria-hidden="true" />
                          </span>
                        ))}
                      </div>
                      <div className="member-stamp-card-foot">
                        <span>{text.totalStamps(card.totalStamps)}</span>
                        {card.availableRewards > 0 ? <b>{text.rewardsAvailable(card.availableRewards)}</b> : <b>{text.stampsRemaining(Math.max(0, required - current))}</b>}
                      </div>
                    </article>
                  );
                })}
                {data.stampCards.length === 1 ? (
                  <article className="member-stamp-card member-stamp-card-placeholder" aria-label="Coming Soon">
                    <div>
                      <p className="eyebrow">{text.stampCard}</p>
                      <h2>Coming Soon</h2>
                      <span>{text.nextStampPreparing}</span>
                    </div>
                    <div className="member-stamp-card-placeholder-mark" aria-hidden="true">
                      <Stamp size={28} />
                    </div>
                  </article>
                ) : null}
              </section>
            ) : null}

            <section className="member-portal-content-grid">
              <article className="member-portal-panel" id="member-coupons" ref={couponPanelRef}>
                <div className="member-portal-panel-title">
                  <Gift size={18} />
                  <h3>{text.coupons}</h3>
                </div>
                <div className="member-portal-list">
                  {data.coupons?.length ? data.coupons.map((coupon) => {
                    const couponName = localizedMemberBenefitName(coupon.name, coupon.displayNames, language);
                    return (
                      <div key={coupon.id} id={`member-coupon-${coupon.id}`} className="member-portal-list-row">
                        <div>
                          <strong>{couponName}</strong>
                          <span>{couponScopeLabel(coupon, text)} / {coupon.couponCode} / {formatDate(coupon.expiresAt, text.dateNoExpiry)}{selectedCouponId === coupon.id ? ` / ${text.selectedForUse}` : ""}</span>
                        </div>
                        <b>{couponValueLabel(coupon, text)}</b>
                        <button
                          className={selectedCouponId === coupon.id ? "member-coupon-use-button is-selected" : "member-coupon-use-button"}
                          type="button"
                          onClick={() => setSelectedCouponId((current) => current === coupon.id ? "" : coupon.id)}
                        >
                          {selectedCouponId === coupon.id ? text.clearSelection : text.use}
                        </button>
                      </div>
                    );
                  }) : <p>{text.noCoupons}</p>}
                </div>
              </article>

              <article className="member-portal-panel member-brand-panel">
                <div className="member-portal-panel-title">
                  <ExternalLink size={18} />
                  <h3>{text.brand}</h3>
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
