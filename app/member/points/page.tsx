"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { BadgePercent, Home, Loader2, LogOut, RefreshCw, Settings, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberAccountMenu } from "../../../components/member/MemberAccountMenu";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";
import { MemberLanguageSwitcher, useMemberLanguage } from "../../../components/member/MemberLanguageProvider";
import { memberText } from "../../../components/member/memberTranslations";

type MemberProfile = {
  memberNumber: string;
  displayName: string;
  email: string;
  preferredLanguage?: string;
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

type MemberPointsResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  pointHistory?: PointHistory[];
  error?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatDate(value: string, noExpiryLabel = "期限なし") {
  if (!value) return noExpiryLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return noExpiryLabel;
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function movementLabel(value: string, text: typeof memberText[keyof typeof memberText]) {
  if (value === "earn") return text.movementEarn;
  if (value === "refund_reversal") return text.movementReversal;
  if (value === "redeem") return text.movementRedeem;
  return value || "-";
}

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }, fallback = "会員") {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || fallback;
}

export default function MemberPointsPage() {
  const { language, syncPreferredLanguage } = useMemberLanguage();
  const text = memberText[language];
  const { isLoaded, isSignedIn, user } = useUser();
  const [data, setData] = useState<MemberPointsResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPoints() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberPointsResponse;
      if (!response.ok) {
        setMessage(body.error || text.loadMemberError);
        setData({});
        return;
      }
      setData(body);
      syncPreferredLanguage(body.member?.preferredLanguage);
    } catch {
      setMessage(text.networkError);
      setData({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadPoints();
  }, [isLoaded, isSignedIn]);

  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
            <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
            <strong>Members</strong>
          </a>
          <MemberLanguageSwitcher />
        </header>
        <section className="member-portal-config">
          <strong>{text.notConfiguredTitle}</strong>
          <p>{text.memberNotConfiguredBody}</p>
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
        <div className="member-topbar-actions">
          <MemberLanguageSwitcher />
        {isSignedIn ? (
          <MemberAccountMenu
            label={text.memberMenu}
            signedInLabel={text.signedIn}
            displayName={getAccountDisplayName(data.member, user, text.member)}
            detail={data.member?.memberNumber || user?.primaryEmailAddress?.emailAddress || text.signedIn}
            memberNumberLabel={text.memberNumber}
            memberNumber={data.member?.memberNumber}
          >
              <a className="member-account-menu-item" href="/member">
                <Home size={16} />
                {text.backToCard}
              </a>
              <a className="member-account-menu-item" href="/member/settings">
                <Settings size={16} />
                {text.editMemberInfo}
              </a>
              <a className="member-account-menu-item" href="/member/orders">
                <ShoppingBag size={16} />
                {text.ordersAndReceipts}
              </a>
              <SignOutButton redirectUrl="/member?loggedOut=1">
                <button className="member-account-menu-item" type="button">
                  <LogOut size={16} />
                  {text.signOut}
                </button>
              </SignOutButton>
          </MemberAccountMenu>
        ) : null}
        </div>
      </header>

      <section className="member-portal-hero member-orders-hero">
        <div>
          <p className="eyebrow">{text.pointHistory}</p>
          <h1>{text.pointHistory}</h1>
          <span>{text.pointsCouponsNumber}</span>
        </div>
        {isLoaded && isSignedIn ? (
          <button className="secondary-button" type="button" onClick={() => void loadPoints()} disabled={loading}>
            {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
            {text.refresh}
          </button>
        ) : null}
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title={text.pointHistory}
          description={text.loginDescription}
          afterAuthUrl="/member/points"
        />
      ) : null}

      {isLoaded && isSignedIn ? (
        <>
          {message ? <p className="member-orders-message">{message}</p> : null}
          <section className="member-orders-shell">
            {loading && !data.pointHistory ? (
              <section className="member-portal-login-panel">
                <Loader2 size={32} />
                <h2>{text.purchaseHistoryLoading}</h2>
                <p>{text.pleaseWait}</p>
              </section>
            ) : (
              <article className="member-portal-panel">
                <div className="member-portal-panel-title">
                  <BadgePercent size={18} />
                  <h3>{text.pointHistory}</h3>
                </div>
                <div className="member-portal-list">
                  {data.pointHistory?.length ? data.pointHistory.map((entry) => (
                    <div key={entry.id} className="member-portal-list-row">
                      <div>
                        <strong>{movementLabel(entry.movementType, text)} / {entry.storeName || entry.brandName || "-"}</strong>
                        <span>{formatDate(entry.createdAt, text.dateNoExpiry)} / {formatYen(entry.eligibleAmount)}</span>
                      </div>
                      <b className={entry.points < 0 ? "is-negative" : ""}>{entry.points.toLocaleString("ja-JP")} pt</b>
                    </div>
                  )) : <p>{text.noPointHistory}</p>}
                </div>
              </article>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
