"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { BadgePercent, Gift, Loader2, QrCode, RefreshCw, Ticket, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MemberProfile = {
  id: string;
  memberNumber: string;
  publicToken: string;
  displayName: string;
  phone: string;
  email: string;
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

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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

function safeReturnTo(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return "";
  }
  return "";
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
  const [returnTo, setReturnTo] = useState("");
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [data, setData] = useState<MemberResponse>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [handoffStarted, setHandoffStarted] = useState(false);

  const qrValue = useMemo(() => {
    if (!data.member?.publicToken) return "";
    return `foundr1:member:${data.member.publicToken}`;
  }, [data.member?.publicToken]);

  const returnWithHandoffUrl = useMemo(() => {
    if (!returnTo || handoffEnabled) return "";
    return `/member?returnTo=${encodeURIComponent(returnTo)}&handoff=1`;
  }, [handoffEnabled, returnTo]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(safeReturnTo(params.get("returnTo") || ""));
    setHandoffEnabled(params.get("handoff") === "1");
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
    if (!isLoaded || !isSignedIn || !returnTo || !handoffEnabled || handoffStarted) return;
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
  }, [handoffEnabled, handoffStarted, isLoaded, isSignedIn, returnTo]);

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
              <SignUpButton mode="modal">
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
              <h2>ログインしてください</h2>
              <p>メール、Google、Apple、LINE のログイン方法は Clerk ダッシュボードで有効化します。</p>
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
