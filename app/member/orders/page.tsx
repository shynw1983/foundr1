"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { ChevronDown, Home, Loader2, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";
import { MemberOrderHistoryPanel } from "../../../components/member/MemberOrderHistoryPanel";
import type { MemberOrderHistory } from "../../../components/member/MemberOrderHistoryPanel";

type MemberProfile = {
  memberNumber: string;
  displayName: string;
  email: string;
};

type MemberOrdersResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  orders?: MemberOrderHistory[];
  error?: string;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }) {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "会員";
}

export default function MemberOrdersPage() {
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
        setMessage(body.error || "購入履歴を読み込めませんでした。");
        setData({});
        return;
      }
      setData(body);
    } catch {
      setMessage("通信に失敗しました。時間をおいて再度お試しください。");
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
          <p className="eyebrow">Purchase History</p>
          <h1>購入履歴</h1>
          <span>ネット購入と店舗購入の履歴を確認できます。ネット購入は領収書も表示できます。</span>
        </div>
        {isLoaded && isSignedIn ? (
          <button className="secondary-button" type="button" onClick={() => void loadOrders()} disabled={loading}>
            {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
            更新
          </button>
        ) : null}
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title="購入履歴にログイン"
          description="メールアドレスに確認コードを送信して、購入履歴を確認できます。"
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
                <h2>購入履歴を読み込み中</h2>
                <p>少々お待ちください。</p>
              </section>
            ) : (
              <MemberOrderHistoryPanel orders={data.orders} />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
