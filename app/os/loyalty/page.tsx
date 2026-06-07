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
  Mail,
  MenuSquare,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingCart,
  Stamp,
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
  brandName: string;
  discountType: string;
  discountValue: number;
  status: string;
  expiresAt: string;
  issuedSource: string;
  issuedAt: string;
  memberNumber: string;
  memberLabel: string;
  memberEmail: string;
  marketingOptIn: boolean;
  emailStatus: string;
  emailMessageId: string;
  emailError: string;
  emailSentAt: string;
  emailCheckedAt: string;
};

type LoyaltyStampCampaign = {
  id: string;
  campaignKey: string;
  name: string;
  brandName: string;
  stampsRequired: number;
  rewardCouponName: string;
  rewardValueAmount: number;
};

type LoyaltyRewardSettings = {
  basePointRateBasis: number;
  birthdayCouponEnabled: boolean;
  birthdayCouponName: string;
  birthdayCouponDiscountType: string;
  birthdayCouponDiscountValue: number;
  birthdayCouponMaxDiscountAmount: number | null;
  birthdayCouponExpiresInDays: number;
  dormantCouponEnabled: boolean;
  dormantDays: number;
  dormantCouponName: string;
  dormantCouponDiscountType: string;
  dormantCouponDiscountValue: number;
  dormantCouponMaxDiscountAmount: number | null;
  dormantCouponExpiresInDays: number;
};

type LoyaltyTierSetting = {
  id: string;
  tierKey: string;
  name: string;
  rank: number;
  evaluationWindowDays: number;
  requiredSpendAmount: number;
  requiredVisitCount: number;
  pointMultiplier: number;
  isActive: boolean;
};

type LoyaltyDashboard = {
  summary: LoyaltySummary;
  recentMembers: LoyaltyMember[];
  recentLedger: LoyaltyLedger[];
  recentCoupons: LoyaltyCoupon[];
  stampCampaigns: LoyaltyStampCampaign[];
  rewardSettings: LoyaltyRewardSettings;
  tierSettings: LoyaltyTierSetting[];
};

const emptySummary: LoyaltySummary = {
  memberCount: 0,
  pointLiability: 0,
  lifetimeSpend: 0,
  lifetimeVisits: 0,
  availableCoupons: 0,
  usedCoupons: 0
};

const defaultRewardSettings: LoyaltyRewardSettings = {
  basePointRateBasis: 100,
  birthdayCouponEnabled: true,
  birthdayCouponName: "誕生日特典 500円OFF",
  birthdayCouponDiscountType: "amount",
  birthdayCouponDiscountValue: 500,
  birthdayCouponMaxDiscountAmount: null,
  birthdayCouponExpiresInDays: 45,
  dormantCouponEnabled: true,
  dormantDays: 45,
  dormantCouponName: "お久しぶり 300円OFF",
  dormantCouponDiscountType: "amount",
  dormantCouponDiscountValue: 300,
  dormantCouponMaxDiscountAmount: null,
  dormantCouponExpiresInDays: 30
};

const defaultTierSettings: LoyaltyTierSetting[] = [
  { id: "regular", tierKey: "regular", name: "Regular", rank: 10, evaluationWindowDays: 180, requiredSpendAmount: 0, requiredVisitCount: 0, pointMultiplier: 1, isActive: true },
  { id: "gold", tierKey: "gold", name: "Gold", rank: 20, evaluationWindowDays: 180, requiredSpendAmount: 20000, requiredVisitCount: 20, pointMultiplier: 1, isActive: true },
  { id: "vip", tierKey: "vip", name: "VIP", rank: 30, evaluationWindowDays: 180, requiredSpendAmount: 50000, requiredVisitCount: 45, pointMultiplier: 1, isActive: true }
];

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

function getCouponScopeLabel(coupon: { brandName?: string }) {
  return coupon.brandName ? `${coupon.brandName} 適用` : "全店舗適用";
}

function isExchangeCoupon(coupon: { issuedSource?: string; name?: string }) {
  return coupon.issuedSource === "stamp_campaign" || Boolean(coupon.name?.includes("無料券"));
}

function getCouponValueLabel(coupon: LoyaltyCoupon) {
  return isExchangeCoupon(coupon) ? "1杯交換" : formatYen(coupon.discountValue);
}

function getCouponEmailStatusLabel(coupon: LoyaltyCoupon) {
  if (coupon.emailStatus === "sent") return "送信済み";
  if (coupon.emailStatus === "failed") return "送信失敗";
  if (coupon.emailStatus === "skipped") return "未送信";
  if (coupon.emailStatus === "disabled") return "送信対象外";
  if (!coupon.memberEmail) return "メールなし";
  if (!coupon.marketingOptIn) return "通知未同意";
  return "未送信";
}

function getCouponEmailStatusClass(coupon: LoyaltyCoupon) {
  if (coupon.emailStatus === "sent") return "is-sent";
  if (coupon.emailStatus === "failed") return "is-failed";
  if (coupon.emailStatus === "disabled" || coupon.emailStatus === "skipped" || !coupon.memberEmail || !coupon.marketingOptIn) return "is-muted";
  return "is-pending";
}

function getCouponEmailNote(coupon: LoyaltyCoupon) {
  if (coupon.emailStatus === "sent") return coupon.emailSentAt ? `${formatDateTime(coupon.emailSentAt)} 送信` : "メール送信済み";
  if (coupon.emailError) return coupon.emailError;
  if (!coupon.memberEmail) return "会員メール未登録";
  if (!coupon.marketingOptIn) return "通知受信の同意なし";
  return "再送できます";
}

export default function LoyaltyPage() {
  const [dashboard, setDashboard] = useState<LoyaltyDashboard>({
    summary: emptySummary,
    recentMembers: [],
    recentLedger: [],
    recentCoupons: [],
    stampCampaigns: [],
    rewardSettings: defaultRewardSettings,
    tierSettings: defaultTierSettings
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [couponSaving, setCouponSaving] = useState(false);
  const [stampSaving, setStampSaving] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [tierSaving, setTierSaving] = useState(false);
  const [resendingCouponId, setResendingCouponId] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ displayName: "", phone: "", email: "" });
  const [couponForm, setCouponForm] = useState({
    memberId: "",
    name: "会員登録特典 500円OFF",
    discountValue: "500",
    expiresAt: "",
    note: ""
  });
  const [stampForm, setStampForm] = useState({
    memberId: "",
    campaignId: "",
    stamps: "0",
    note: ""
  });
  const [rewardSettings, setRewardSettings] = useState<LoyaltyRewardSettings>(defaultRewardSettings);
  const [tierSettings, setTierSettings] = useState<LoyaltyTierSetting[]>(defaultTierSettings);

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
    syncDashboard(body);
    setMessage("");
    setLoading(false);
  }

  function syncDashboard(body: Partial<LoyaltyDashboard>) {
    const nextRewardSettings = body.rewardSettings
      ? { ...defaultRewardSettings, ...body.rewardSettings }
      : rewardSettings;
    const nextTierSettings = body.tierSettings?.length ? body.tierSettings : tierSettings;
    setDashboard({
      summary: { ...emptySummary, ...(body.summary ?? {}) },
      recentMembers: body.recentMembers ?? [],
      recentLedger: body.recentLedger ?? [],
      recentCoupons: body.recentCoupons ?? [],
      stampCampaigns: body.stampCampaigns ?? [],
      rewardSettings: nextRewardSettings,
      tierSettings: nextTierSettings
    });
    setRewardSettings(nextRewardSettings);
    setTierSettings(nextTierSettings);
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
      syncDashboard(body);
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
      syncDashboard(body);
      setCouponForm((current) => ({ ...current, name: "会員登録特典 500円OFF", discountValue: "500", expiresAt: "", note: "" }));
      setMessage("クーポンを発行しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "クーポンを発行できませんでした。");
    } finally {
      setCouponSaving(false);
    }
  }

  async function adjustStamps() {
    if (stampSaving || !stampForm.memberId || !stampForm.campaignId || Number(stampForm.stamps) <= 0) {
      setMessage("会員、スタンプカード、紙レシート分の杯数を入力してください。");
      return;
    }
    setStampSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust_stamps",
          memberId: stampForm.memberId,
          campaignId: stampForm.campaignId,
          stamps: Number(stampForm.stamps),
          note: stampForm.note
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "スタンプを補録できませんでした。");
      syncDashboard(body);
      setStampForm((current) => ({ ...current, stamps: "0", note: "" }));
      const issuedRewards = Number(body.adjustment?.issuedRewards ?? 0);
      setMessage(issuedRewards > 0 ? `スタンプを補録し、特典クーポンを${formatNumber(issuedRewards)}件発行しました。` : "スタンプを補録しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スタンプを補録できませんでした。");
    } finally {
      setStampSaving(false);
    }
  }

  async function saveRewardSettings() {
    if (ruleSaving) return;
    setRuleSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_reward_settings",
          rewardSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員ルールを保存できませんでした。");
      syncDashboard(body);
      setMessage("会員ルールを保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会員ルールを保存できませんでした。");
    } finally {
      setRuleSaving(false);
    }
  }

  async function saveTierSettings() {
    if (tierSaving) return;
    setTierSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_tier_settings",
          tierSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員ランクを保存できませんでした。");
      syncDashboard(body);
      setMessage("会員ランクを保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会員ランクを保存できませんでした。");
    } finally {
      setTierSaving(false);
    }
  }

  async function resendCouponEmail(coupon: LoyaltyCoupon) {
    if (resendingCouponId) return;
    setResendingCouponId(coupon.id);
    setMessage("");
    try {
      const response = await fetch("/api/os/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resend_coupon_email",
          couponId: coupon.id
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "メールを送信できませんでした。");
      syncDashboard(body);
      const status = String(body.emailResult?.status ?? "");
      if (status === "sent") setMessage("クーポン通知メールを送信しました。");
      else setMessage(body.emailResult?.error || "メール通知は送信されませんでした。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "メールを送信できませんでした。");
    } finally {
      setResendingCouponId("");
    }
  }

  function updateTier(index: number, patch: Partial<LoyaltyTierSetting>) {
    setTierSettings((current) => current.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier));
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
            <h3>会員ルール設定</h3>
          </div>
          <div className="loyalty-rule-grid">
            <span><BadgePercent size={18} /> {formatNumber(rewardSettings.basePointRateBasis)}円で1ポイント</span>
            <span><WalletCards size={18} /> ランク倍率を自動反映</span>
            <span><Users size={18} /> ブランド共通会員</span>
            <span><Gift size={18} /> 誕生日・再来店クーポンを自動発行</span>
          </div>
          <div className="loyalty-settings-grid">
            <label>
              <span>ポイント基準</span>
              <input value={rewardSettings.basePointRateBasis} onChange={(event) => setRewardSettings((current) => ({ ...current, basePointRateBasis: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
            <label className="loyalty-toggle-row">
              <input type="checkbox" checked={rewardSettings.birthdayCouponEnabled} onChange={(event) => setRewardSettings((current) => ({ ...current, birthdayCouponEnabled: event.target.checked }))} />
              <span>誕生日月クーポン</span>
            </label>
            <label>
              <span>誕生日クーポン名</span>
              <input value={rewardSettings.birthdayCouponName} onChange={(event) => setRewardSettings((current) => ({ ...current, birthdayCouponName: event.target.value }))} />
            </label>
            <label>
              <span>誕生日割引</span>
              <input value={rewardSettings.birthdayCouponDiscountValue} onChange={(event) => setRewardSettings((current) => ({ ...current, birthdayCouponDiscountValue: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
            <label>
              <span>誕生日有効日数</span>
              <input value={rewardSettings.birthdayCouponExpiresInDays} onChange={(event) => setRewardSettings((current) => ({ ...current, birthdayCouponExpiresInDays: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
            <label className="loyalty-toggle-row">
              <input type="checkbox" checked={rewardSettings.dormantCouponEnabled} onChange={(event) => setRewardSettings((current) => ({ ...current, dormantCouponEnabled: event.target.checked }))} />
              <span>再来店クーポン</span>
            </label>
            <label>
              <span>未購入日数</span>
              <input value={rewardSettings.dormantDays} onChange={(event) => setRewardSettings((current) => ({ ...current, dormantDays: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
            <label>
              <span>再来店クーポン名</span>
              <input value={rewardSettings.dormantCouponName} onChange={(event) => setRewardSettings((current) => ({ ...current, dormantCouponName: event.target.value }))} />
            </label>
            <label>
              <span>再来店割引</span>
              <input value={rewardSettings.dormantCouponDiscountValue} onChange={(event) => setRewardSettings((current) => ({ ...current, dormantCouponDiscountValue: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
            <label>
              <span>再来店有効日数</span>
              <input value={rewardSettings.dormantCouponExpiresInDays} onChange={(event) => setRewardSettings((current) => ({ ...current, dormantCouponExpiresInDays: Number(event.target.value.replace(/[^\d]/g, "")) || 0 }))} inputMode="numeric" />
            </label>
          </div>
          <button className="primary-button" type="button" onClick={() => void saveRewardSettings()} disabled={ruleSaving}>
            {ruleSaving ? "保存中..." : "会員ルールを保存"}
          </button>
        </section>

        <section className="panel loyalty-tier-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Tier</p>
              <h3>ランク設定</h3>
            </div>
          </div>
          <div className="loyalty-tier-grid">
            {tierSettings.map((tier, index) => (
              <article className="loyalty-tier-card" key={tier.tierKey || index}>
                <label>
                  <span>ランクキー</span>
                  <input value={tier.tierKey} onChange={(event) => updateTier(index, { tierKey: event.target.value.trim() })} />
                </label>
                <label>
                  <span>表示名</span>
                  <input value={tier.name} onChange={(event) => updateTier(index, { name: event.target.value })} />
                </label>
                <label>
                  <span>順位</span>
                  <input value={tier.rank} onChange={(event) => updateTier(index, { rank: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} inputMode="numeric" />
                </label>
                <label>
                  <span>判定日数</span>
                  <input value={tier.evaluationWindowDays} onChange={(event) => updateTier(index, { evaluationWindowDays: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} inputMode="numeric" />
                </label>
                <label>
                  <span>必要購入額</span>
                  <input value={tier.requiredSpendAmount} onChange={(event) => updateTier(index, { requiredSpendAmount: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} inputMode="numeric" />
                </label>
                <label>
                  <span>必要来店数</span>
                  <input value={tier.requiredVisitCount} onChange={(event) => updateTier(index, { requiredVisitCount: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} inputMode="numeric" />
                </label>
                <label>
                  <span>ポイント倍率</span>
                  <input value={tier.pointMultiplier} onChange={(event) => updateTier(index, { pointMultiplier: Number(event.target.value.replace(/[^\d.]/g, "")) || 0 })} inputMode="decimal" />
                </label>
                <label className="loyalty-toggle-row">
                  <input type="checkbox" checked={tier.isActive} onChange={(event) => updateTier(index, { isActive: event.target.checked })} />
                  <span>有効</span>
                </label>
              </article>
            ))}
          </div>
          <div className="loyalty-settings-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setTierSettings((current) => [...current, { id: `new-${Date.now()}`, tierKey: "", name: "", rank: 40, evaluationWindowDays: 180, requiredSpendAmount: 0, requiredVisitCount: 0, pointMultiplier: 1, isActive: true }])}
            >
              ランクを追加
            </button>
            <button className="primary-button" type="button" onClick={() => void saveTierSettings()} disabled={tierSaving}>
              {tierSaving ? "保存中..." : "ランクを保存"}
            </button>
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

          <article className="panel loyalty-member-form">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Stamp</p>
                <h3>紙レシート分を補録</h3>
              </div>
            </div>
            <div className="loyalty-stamp-note">
              <Stamp size={18} />
              <span>紙レシートを確認し、下部の5杯で1杯無料部分を切り取った後に杯数を補録します。</span>
            </div>
            <label>
              <span>会員</span>
              <select value={stampForm.memberId} onChange={(event) => setStampForm((current) => ({ ...current, memberId: event.target.value }))}>
                <option value="">選択してください</option>
                {dashboard.recentMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName || member.phone || member.email || member.memberNumber} / {member.memberNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>スタンプカード</span>
              <select value={stampForm.campaignId} onChange={(event) => setStampForm((current) => ({ ...current, campaignId: event.target.value }))}>
                <option value="">選択してください</option>
                {dashboard.stampCampaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.brandName ? `${campaign.brandName} / ` : ""}{campaign.name} / {campaign.stampsRequired}杯で特典
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>紙レシート分の杯数</span>
              <input value={stampForm.stamps} onChange={(event) => setStampForm((current) => ({ ...current, stamps: event.target.value.replace(/[^\d]/g, "").slice(0, 3) }))} placeholder="例: 3" inputMode="numeric" />
            </label>
            <label>
              <span>メモ</span>
              <input value={stampForm.note} onChange={(event) => setStampForm((current) => ({ ...current, note: event.target.value }))} placeholder="例: レシート2枚確認" />
            </label>
            <button className="primary-button" type="button" onClick={() => void adjustStamps()} disabled={stampSaving}>
              {stampSaving ? "補録中..." : "スタンプを補録"}
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
                  <th>メール通知</th>
                  <th>操作</th>
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
                      <small>{getCouponScopeLabel(coupon)} / {coupon.couponCode} / {getCouponValueLabel(coupon)}</small>
                    </td>
                    <td>{coupon.expiresAt ? formatDateTime(coupon.expiresAt) : "期限なし"}</td>
                    <td>{coupon.status === "available" ? "利用可" : coupon.status === "used" ? "使用済み" : coupon.status}</td>
                    <td>
                      <span className={`loyalty-email-pill ${getCouponEmailStatusClass(coupon)}`}>
                        <Mail size={13} />
                        {getCouponEmailStatusLabel(coupon)}
                      </span>
                      <small>{getCouponEmailNote(coupon)}</small>
                    </td>
                    <td>
                      <button
                        className="secondary-button loyalty-email-resend-button"
                        type="button"
                        onClick={() => void resendCouponEmail(coupon)}
                        disabled={Boolean(resendingCouponId) || !coupon.memberEmail || !coupon.marketingOptIn}
                      >
                        <RefreshCw size={14} />
                        {resendingCouponId === coupon.id ? "送信中" : "再送"}
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7}>クーポン履歴はまだありません。</td>
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
