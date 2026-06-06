"use client";

import {
  BadgePercent,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gift,
  Lightbulb,
  LogOut,
  MenuSquare,
  PackageCheck,
  Search,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "会員・ポイント", href: "/os/loyalty", icon: BadgePercent },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "POS", href: "/os/pos", icon: ShoppingCart },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

type LoyaltySummary = {
  memberCount: number;
  pointLiability: number;
  lifetimeSpend: number;
  lifetimeVisits: number;
  availableCoupons: number;
  usedCoupons: number;
};

type LoyaltyMember = {
  id: string;
  memberNumber: string;
  displayName: string;
  phone: string;
  email: string;
  pointBalance: number;
  lifetimeSpendAmount: number;
  lifetimeVisitCount: number;
  currentTierKey: string;
  lastPurchaseAt: string;
  createdAt: string;
};

type LoyaltyLedger = {
  id: string;
  memberNumber: string;
  memberLabel: string;
  brandName: string;
  storeName: string;
  movementType: string;
  points: number;
  eligibleAmount: number;
  createdAt: string;
};

type LoyaltyCoupon = {
  id: string;
  couponCode: string;
  name: string;
  discountType: string;
  discountValue: number;
  status: string;
  expiresAt: string;
  issuedSource: string;
  issuedAt: string;
  memberNumber: string;
  memberLabel: string;
};

type LoyaltyDashboard = {
  summary: LoyaltySummary;
  recentMembers: LoyaltyMember[];
  recentLedger: LoyaltyLedger[];
  recentCoupons: LoyaltyCoupon[];
};

const emptySummary: LoyaltySummary = {
  memberCount: 0,
  pointLiability: 0,
  lifetimeSpend: 0,
  lifetimeVisits: 0,
  availableCoupons: 0,
  usedCoupons: 0
};

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatNumber(value: number) {
  return Math.round(value || 0).toLocaleString("ja-JP");
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getMovementLabel(value: string) {
  if (value === "earn") return "付与";
  if (value === "refund_reversal") return "取消";
  if (value === "redeem") return "利用";
  if (value === "manual_adjustment") return "調整";
  return value || "-";
}

export default function LoyaltyPage() {
  const [dashboard, setDashboard] = useState<LoyaltyDashboard>({ summary: emptySummary, recentMembers: [], recentLedger: [], recentCoupons: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [couponSaving, setCouponSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ displayName: "", phone: "", email: "" });
  const [couponForm, setCouponForm] = useState({
    memberId: "",
    name: "会員登録特典 500円OFF",
    discountValue: "500",
    expiresAt: "",
    note: ""
  });

  const averageSpend = useMemo(() => {
    const visits = dashboard.summary.lifetimeVisits || 0;
    return visits ? Math.round(dashboard.summary.lifetimeSpend / visits) : 0;
  }, [dashboard.summary.lifetimeSpend, dashboard.summary.lifetimeVisits]);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/os/loyalty", { cache: "no-store" });
    if (!response.ok) {
      setMessage("会員データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    setDashboard({
      summary: { ...emptySummary, ...(body.summary ?? {}) },
      recentMembers: body.recentMembers ?? [],
      recentLedger: body.recentLedger ?? [],
      recentCoupons: body.recentCoupons ?? []
    });
    setMessage("");
    setLoading(false);
  }

  async function saveMember() {
    if (saving || (!form.phone.trim() && !form.email.trim())) {
      setMessage("電話番号またはメールを入力してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員を保存できませんでした。");
      setDashboard({
        summary: { ...emptySummary, ...(body.summary ?? {}) },
        recentMembers: body.recentMembers ?? [],
        recentLedger: body.recentLedger ?? [],
        recentCoupons: body.recentCoupons ?? []
      });
      setForm({ displayName: "", phone: "", email: "" });
      setMessage("会員を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会員を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function issueCoupon() {
    if (couponSaving || !couponForm.memberId || !couponForm.name.trim() || Number(couponForm.discountValue) <= 0) {
      setMessage("会員、クーポン名、割引金額を入力してください。");
      return;
    }
    setCouponSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue_coupon",
          memberId: couponForm.memberId,
          name: couponForm.name,
          discountType: "amount",
          discountValue: Number(couponForm.discountValue),
          maxDiscountAmount: Number(couponForm.discountValue),
          expiresAt: couponForm.expiresAt,
          note: couponForm.note
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "クーポンを発行できませんでした。");
      setDashboard({
        summary: { ...emptySummary, ...(body.summary ?? {}) },
        recentMembers: body.recentMembers ?? [],
        recentLedger: body.recentLedger ?? [],
        recentCoupons: body.recentCoupons ?? []
      });
      setCouponForm((current) => ({ ...current, name: "会員登録特典 500円OFF", discountValue: "500", expiresAt: "", note: "" }));
      setMessage("クーポンを発行しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クーポンを発行できませんでした。");
    } finally {
      setCouponSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace loyalty-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">Members</p>
            <h2>会員・ポイント</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
              更新
            </button>
          </div>
        </header>

        {message ? <div className="action-notice">{message}</div> : null}

        <section className="metric-grid loyalty-metric-grid">
          <article className="metric-card">
            <span>会員数</span>
            <strong>{formatNumber(dashboard.summary.memberCount)}</strong>
            <p>有効会員</p>
          </article>
          <article className="metric-card">
            <span>ポイント負債</span>
            <strong>{formatNumber(dashboard.summary.pointLiability)} pt</strong>
            <p>1 pt = 1 円想定</p>
          </article>
          <article className="metric-card">
            <span>累計購入</span>
            <strong>{formatYen(dashboard.summary.lifetimeSpend)}</strong>
            <p>{formatNumber(dashboard.summary.lifetimeVisits)} 回 / 平均 {formatYen(averageSpend)}</p>
          </article>
          <article className="metric-card">
            <span>クーポン</span>
            <strong>{formatNumber(dashboard.summary.availableCoupons)}</strong>
            <p>使用済み {formatNumber(dashboard.summary.usedCoupons)}</p>
          </article>
        </section>

        <section className="panel loyalty-rule-panel">
          <div>
            <p className="eyebrow">Rule</p>
            <h3>初期ルール</h3>
          </div>
          <div className="loyalty-rule-grid">
            <span><BadgePercent size={18} /> 100円で1ポイント</span>
            <span><WalletCards size={18} /> 1ポイント=1円</span>
            <span><Users size={18} /> ブランド共通会員</span>
            <span><Gift size={18} /> スタンプ・クーポンはブランド別に拡張</span>
          </div>
        </section>

        <section className="loyalty-workspace-grid">
          <article className="panel loyalty-member-form">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Manual</p>
                <h3>会員を登録</h3>
              </div>
            </div>
            <label>
              <span>名前</span>
              <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="任意" />
            </label>
            <label>
              <span>電話番号</span>
              <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="090..." inputMode="tel" />
            </label>
            <label>
              <span>メール</span>
              <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="member@example.com" inputMode="email" />
            </label>
            <button className="primary-button" type="button" onClick={() => void saveMember()} disabled={saving}>
              {saving ? "保存中..." : "会員を保存"}
            </button>
          </article>

          <article className="panel loyalty-member-form">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Coupon</p>
                <h3>クーポンを発行</h3>
              </div>
            </div>
            <label>
              <span>会員</span>
              <select value={couponForm.memberId} onChange={(event) => setCouponForm((current) => ({ ...current, memberId: event.target.value }))}>
                <option value="">選択してください</option>
                {dashboard.recentMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName || member.phone || member.email || member.memberNumber} / {member.memberNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>クーポン名</span>
              <input value={couponForm.name} onChange={(event) => setCouponForm((current) => ({ ...current, name: event.target.value }))} placeholder="例: 会員登録特典 500円OFF" />
            </label>
            <label>
              <span>割引金額</span>
              <input value={couponForm.discountValue} onChange={(event) => setCouponForm((current) => ({ ...current, discountValue: event.target.value.replace(/[^\d]/g, "") }))} placeholder="500" inputMode="numeric" />
            </label>
            <label>
              <span>有効期限</span>
              <input type="date" value={couponForm.expiresAt} onChange={(event) => setCouponForm((current) => ({ ...current, expiresAt: event.target.value }))} />
            </label>
            <label>
              <span>メモ</span>
              <input value={couponForm.note} onChange={(event) => setCouponForm((current) => ({ ...current, note: event.target.value }))} placeholder="任意" />
            </label>
            <button className="primary-button" type="button" onClick={() => void issueCoupon()} disabled={couponSaving}>
              {couponSaving ? "発行中..." : "クーポンを発行"}
            </button>
          </article>

          <article className="panel loyalty-member-list">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Recent</p>
                <h3>最近の会員</h3>
              </div>
            </div>
            <div className="loyalty-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>会員</th>
                    <th>ランク</th>
                    <th>ポイント</th>
                    <th>累計</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentMembers.length ? dashboard.recentMembers.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.displayName || member.phone || member.email || member.memberNumber}</strong>
                        <small>{member.memberNumber} / {member.lastPurchaseAt ? formatDateTime(member.lastPurchaseAt) : "購入なし"}</small>
                      </td>
                      <td>{member.currentTierKey}</td>
                      <td>{formatNumber(member.pointBalance)} pt</td>
                      <td>{formatYen(member.lifetimeSpendAmount)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4}>会員データはまだありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="panel loyalty-ledger-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Coupon</p>
              <h3>最近のクーポン</h3>
            </div>
          </div>
          <div className="loyalty-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>発行日</th>
                  <th>会員</th>
                  <th>クーポン</th>
                  <th>期限</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentCoupons.length ? dashboard.recentCoupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td>{formatDateTime(coupon.issuedAt)}</td>
                    <td>
                      <strong>{coupon.memberLabel}</strong>
                      <small>{coupon.memberNumber}</small>
                    </td>
                    <td>
                      <strong>{coupon.name}</strong>
                      <small>{coupon.couponCode} / {formatYen(coupon.discountValue)}</small>
                    </td>
                    <td>{coupon.expiresAt ? formatDateTime(coupon.expiresAt) : "期限なし"}</td>
                    <td>{coupon.status === "available" ? "利用可" : coupon.status === "used" ? "使用済み" : coupon.status}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>クーポン履歴はまだありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel loyalty-ledger-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Ledger</p>
              <h3>ポイント流水</h3>
            </div>
          </div>
          <div className="loyalty-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>会員</th>
                  <th>店舗</th>
                  <th>区分</th>
                  <th>金額</th>
                  <th>ポイント</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentLedger.length ? dashboard.recentLedger.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <strong>{entry.memberLabel}</strong>
                      <small>{entry.memberNumber}</small>
                    </td>
                    <td>
                      <strong>{entry.storeName || "-"}</strong>
                      <small>{entry.brandName || "-"}</small>
                    </td>
                    <td>{getMovementLabel(entry.movementType)}</td>
                    <td>{formatYen(entry.eligibleAmount)}</td>
                    <td className={entry.points < 0 ? "is-negative" : ""}>{formatNumber(entry.points)} pt</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>ポイント流水はまだありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
