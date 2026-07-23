"use client";

import { BadgePercent, CalendarDays, Home, Loader2, LogOut, RefreshCw, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberAccountMenu } from "../../../components/member/MemberAccountMenu";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";
import { MemberLanguageSwitcher, useMemberLanguage } from "../../../components/member/MemberLanguageProvider";
import { MemberOrderHistoryPanel } from "../../../components/member/MemberOrderHistoryPanel";
import { MemberSignOutButton, useMemberSession } from "../../../components/member/MemberSessionProvider";
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

type OrderHistoryRange = "latest" | "30d" | "90d" | "1y" | "custom";

function getAccountDisplayName(member?: MemberProfile | null, user?: { displayName?: string; email?: string } | null, fallback = "会員") {
  return member?.displayName?.trim() || user?.displayName || user?.email || fallback;
}

export default function MemberOrdersPage() {
  const { language, syncPreferredLanguage } = useMemberLanguage();
  const text = memberText[language];
  const { isLoaded, isSignedIn, user } = useMemberSession();
  const [data, setData] = useState<MemberOrdersResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [periodRange, setPeriodRange] = useState<OrderHistoryRange>("latest");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function loadOrders(range = periodRange, from = fromDate, to = toDate) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ orderHistoryRange: range });
      if (range !== "latest") params.set("orderHistoryLimit", "100");
      if (range === "custom") {
        if (from) params.set("orderHistoryFrom", from);
        if (to) params.set("orderHistoryTo", to);
      }
      const response = await fetch(`/api/public/members/me?${params.toString()}`, { cache: "no-store" });
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

  function changePeriodRange(value: string) {
    const nextRange = ["latest", "30d", "90d", "1y", "custom"].includes(value) ? value as OrderHistoryRange : "latest";
    setPeriodRange(nextRange);
    if (nextRange !== "custom" && isLoaded && isSignedIn) void loadOrders(nextRange, fromDate, toDate);
  }

  function clearFilter() {
    setPeriodRange("latest");
    setFromDate("");
    setToDate("");
    if (isLoaded && isSignedIn) void loadOrders("latest", "", "");
  }

  return (
    <main className="member-portal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-member-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </a>
        <div className="member-topbar-actions">
          <MemberLanguageSwitcher />
        {isSignedIn ? (
          <MemberAccountMenu
            label={text.memberMenu}
            signedInLabel={text.signedIn}
            displayName={getAccountDisplayName(data.member, user, text.member)}
            detail={data.member?.memberNumber || user?.email || text.signedIn}
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
              <a className="member-account-menu-item" href="/member/points">
                <BadgePercent size={16} />
                {text.pointHistory}
              </a>
              <MemberSignOutButton className="member-account-menu-item">
                <LogOut size={16} />
                {text.signOut}
              </MemberSignOutButton>
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
          <div className="member-history-hero-controls">
            <label className="member-history-period-select">
              <CalendarDays size={16} />
              <select value={periodRange} onChange={(event) => changePeriodRange(event.target.value)} aria-label={text.pointHistoryPeriod}>
                <option value="latest">{text.pointHistoryLatest}</option>
                <option value="30d">{text.pointHistoryLast30Days}</option>
                <option value="90d">{text.pointHistoryLast90Days}</option>
                <option value="1y">{text.pointHistoryLastYear}</option>
                <option value="custom">{text.pointHistoryCustom}</option>
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => void loadOrders()} disabled={loading}>
              {loading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
              {text.refresh}
            </button>
          </div>
        ) : null}
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title={text.purchaseHistoryLoginTitle}
          afterAuthUrl="/member/orders"
        />
      ) : null}

      {isLoaded && isSignedIn ? (
        <>
          {message ? <p className="member-orders-message">{message}</p> : null}
          <section className="member-orders-shell">
            {periodRange === "custom" ? (
              <article className="member-portal-panel">
                <div className="member-settings-grid">
                  <label>
                    <span>{text.pointHistoryStartDate}</span>
                    <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                  </label>
                  <label>
                    <span>{text.pointHistoryEndDate}</span>
                    <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                  </label>
                  <div className="member-portal-toolbar member-settings-field-wide">
                    <button className="secondary-button" type="button" onClick={() => void loadOrders("custom", fromDate, toDate)} disabled={loading}>
                      {loading ? <Loader2 size={16} /> : <CalendarDays size={16} />}
                      {text.applyFilter}
                    </button>
                    <button className="secondary-button" type="button" onClick={clearFilter} disabled={loading}>
                      {text.clearFilter}
                    </button>
                  </div>
                </div>
              </article>
            ) : null}
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
