"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { Home, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberAccountMenu } from "../../../components/member/MemberAccountMenu";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";
import { MemberLanguageSwitcher, useMemberLanguage } from "../../../components/member/MemberLanguageProvider";
import { MemberOrderHistoryPanel } from "../../../components/member/MemberOrderHistoryPanel";
import type { MemberOrderHistory } from "../../../components/member/MemberOrderHistoryPanel";
import { memberText } from "../../../components/member/memberTranslations";

type MemberProfile = {
  memberNumber: string;
  displayName: string;
  email: string;
  preferredLanguage?: string;
};

type MemberOrdersResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  orders?: MemberOrderHistory[];
  error?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }, fallback = "会員") {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || fallback;
}

export default function MemberOrdersPage() {
  const { language, syncPreferredLanguage } = useMemberLanguage();
  const text = memberText[language];
  const { isLoaded, isSignedIn, user } = useUser();
  const [data, setData] = useState<MemberOrdersResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadOrders() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberOrdersResponse;
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
    if (isLoaded && isSignedIn) void loadOrders();
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
          <p className="eyebrow">{text.purchaseHistory}</p>
          <h1>{text.purchaseHistoryTitle}</h1>
          <span>{text.purchaseHistoryDescription}</span>
        </div>
        {isLoaded && isSignedIn ? (
          <button className="secondary-button" type="button" onClick={() => void loadOrders()} disabled={loading}>
            {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
            {text.refresh}
          </button>
        ) : null}
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title={text.purchaseHistoryLoginTitle}
          description={text.purchaseHistoryLoginDescription}
          afterAuthUrl="/member/orders"
        />
      ) : null}

      {isLoaded && isSignedIn ? (
        <>
          {message ? <p className="member-orders-message">{message}</p> : null}
          <section className="member-orders-shell">
            {loading && !data.orders ? (
              <section className="member-portal-login-panel">
                <Loader2 size={32} />
                <h2>{text.purchaseHistoryLoading}</h2>
                <p>{text.pleaseWait}</p>
              </section>
            ) : (
              <MemberOrderHistoryPanel orders={data.orders} onRefresh={loadOrders} />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
