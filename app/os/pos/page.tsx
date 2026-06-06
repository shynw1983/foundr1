"use client";

import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Lightbulb,
  LogOut,
  MenuSquare,
  MonitorSmartphone,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  WalletCards,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "POS", href: "/os/pos", icon: ShoppingCart },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

type StoreOption = {
  id: string;
  name: string;
};

type PosSummary = {
  orderCount: number;
  total: number;
  average: number;
  latestOrders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    paymentMethod: string;
    createdTime: string;
  }>;
};

type PosCashSession = {
  id: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  differenceAmount: number | null;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string;
};

type PosCashTotals = {
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number;
  differenceAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
};

type PosReconciliation = {
  businessDate: string;
  activeSession: PosCashSession | null;
  sessions: PosCashSession[];
  totals: PosCashTotals;
};

type PosTaxSettings = {
  storeId: string;
  storeName: string;
  dineInEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  posBrandSettings: PosBrandSetting[];
  updatedAt: string;
};

type PosBrandSetting = {
  brandId: string;
  brandName: string;
  posPricingMode: "fixed" | "weight";
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
};

type PosDiscountPreset = {
  key: string;
  name: string;
  discountType: "percent" | "amount";
  discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand";
  targetValue: string;
  enabled: boolean;
  stampEligible: boolean;
  allowCouponCombination: boolean;
};

function createDiscountPreset(): PosDiscountPreset {
  return {
    key: `discount_${Date.now()}`,
    name: "",
    discountType: "percent",
    discountValue: 10,
    targetScope: "all",
    targetValue: "",
    enabled: true,
    stampEligible: false,
    allowCouponCombination: false
  };
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function getPaymentLabel(value: string) {
  if (value === "cash") return "現金";
  if (value === "card") return "カード";
  if (value === "other") return "その他";
  return value || "-";
}

export default function PosPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [taxSettings, setTaxSettings] = useState<PosTaxSettings | null>(null);
  const [taxForm, setTaxForm] = useState<{ dineInEnabled: boolean; dineInTaxRate: string; takeoutTaxRate: string; externalPaymentTerminalBrand: string; priceTaxMode: string; discountPresets: PosDiscountPreset[]; posBrandSettings: PosBrandSetting[] }>({
    dineInEnabled: true,
    dineInTaxRate: "10",
    takeoutTaxRate: "8",
    externalPaymentTerminalBrand: "PayCAS",
    priceTaxMode: "tax_included",
    discountPresets: [],
    posBrandSettings: []
  });
  const [canManagePosSettings, setCanManagePosSettings] = useState(false);
  const [taxSaving, setTaxSaving] = useState(false);
  const [reconciliation, setReconciliation] = useState<PosReconciliation>({
    businessDate: "",
    activeSession: null,
    sessions: [],
    totals: { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load(storeId = selectedStoreId) {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/pos${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("POS データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    const selectedId = body.selectedStoreId ?? "";
    const cashParams = new URLSearchParams();
    if (selectedId) cashParams.set("storeId", selectedId);
    const cashResponse = selectedId
      ? await fetch(`/api/store/pos/reconciliation?${cashParams.toString()}`, { cache: "no-store" })
      : null;
    const settingsResponse = selectedId
      ? await fetch(`/api/os/pos/settings?${cashParams.toString()}`, { cache: "no-store" })
      : null;
    const cashBody = cashResponse?.ok ? await cashResponse.json() : null;
    const settingsBody = settingsResponse?.ok ? await settingsResponse.json() : null;
    const nextSettings = settingsBody?.settings ?? body.posSettings ?? null;
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(selectedId);
    setSummary(body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] });
    setTaxSettings(nextSettings);
    setCanManagePosSettings(Boolean(settingsBody?.access?.canManagePosSettings));
    setTaxForm({
      dineInEnabled: nextSettings?.dineInEnabled !== false,
      dineInTaxRate: String(nextSettings?.dineInTaxRate ?? 10),
      takeoutTaxRate: String(nextSettings?.takeoutTaxRate ?? 8),
      externalPaymentTerminalBrand: nextSettings?.externalPaymentTerminalBrand ?? "PayCAS",
      priceTaxMode: nextSettings?.priceTaxMode ?? "tax_included",
      discountPresets: Array.isArray(nextSettings?.discountPresets) ? nextSettings.discountPresets : [],
      posBrandSettings: Array.isArray(nextSettings?.posBrandSettings) ? nextSettings.posBrandSettings : []
    });
    setReconciliation({
      businessDate: cashBody?.businessDate ?? "",
      activeSession: cashBody?.activeSession ?? null,
      sessions: cashBody?.sessions ?? [],
      totals: cashBody?.totals ?? { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 }
    });
    setMessage("");
    setLoading(false);
  }

  async function saveTaxSettings() {
    if (!selectedStoreId || taxSaving) return;
    setTaxSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/pos/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          dineInEnabled: taxForm.dineInEnabled,
          dineInTaxRate: taxForm.dineInTaxRate,
          takeoutTaxRate: taxForm.takeoutTaxRate,
          externalPaymentTerminalBrand: taxForm.externalPaymentTerminalBrand,
          priceTaxMode: taxForm.priceTaxMode,
          discountPresets: taxForm.discountPresets,
          posBrandSettings: taxForm.posBrandSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "POS 税設定を保存できませんでした。");
      setTaxSettings(body.settings ?? null);
      setTaxForm({
        dineInEnabled: body.settings?.dineInEnabled !== false,
        dineInTaxRate: String(body.settings?.dineInTaxRate ?? taxForm.dineInTaxRate),
        takeoutTaxRate: String(body.settings?.takeoutTaxRate ?? taxForm.takeoutTaxRate),
        externalPaymentTerminalBrand: body.settings?.externalPaymentTerminalBrand ?? taxForm.externalPaymentTerminalBrand,
        priceTaxMode: body.settings?.priceTaxMode ?? taxForm.priceTaxMode,
        discountPresets: Array.isArray(body.settings?.discountPresets) ? body.settings.discountPresets : taxForm.discountPresets,
        posBrandSettings: Array.isArray(body.settings?.posBrandSettings) ? body.settings.posBrandSettings : taxForm.posBrandSettings
      });
      setMessage("POS 税設定を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "POS 税設定を保存できませんでした。");
    } finally {
      setTaxSaving(false);
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      <section className="workspace pos-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS</p>
            <h2>店頭会計</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/store/pos" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              店舗 POS を開く
            </a>
          </div>
        </header>

        {message ? <div className="action-notice">{message}</div> : null}

        <section className="panel pos-admin-toolbar">
          <label>
            <span>店舗</span>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                const storeId = event.target.value;
                setSelectedStoreId(storeId);
                void load(storeId);
              }}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <div className="pos-admin-actions">
            <a href="/os/menus"><MenuSquare size={16} />メニュー管理</a>
            <a href="/os/pos/reconciliation"><WalletCards size={16} />日次レジ締め</a>
            <a href="/os/analytics/sales"><BarChart3 size={16} />売上分析</a>
            <a href="/os/stores"><Store size={16} />店舗設定</a>
          </div>
        </section>

        <section className="panel pos-admin-tax-settings">
          <div className="panel-title">
            <WalletCards />
            <div>
              <h3>POS 基本設定</h3>
              <p>税率、価格表示、外部決済端末の表示名を店舗ごとに管理します。</p>
            </div>
          </div>
          <div className="pos-admin-tax-grid">
            <label className="pos-admin-tax-toggle">
              <span>店内飲食</span>
              <div>
                <input
                  type="checkbox"
                  checked={taxForm.dineInEnabled}
                  onChange={(event) => setTaxForm((current) => ({ ...current, dineInEnabled: event.target.checked }))}
                  disabled={!canManagePosSettings}
                />
                <strong>店内飲食を POS に表示する</strong>
              </div>
            </label>
            <label>
              <span>店内飲食 税率（%）</span>
              <input
                inputMode="decimal"
                value={taxForm.dineInTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, dineInTaxRate: event.target.value.replace(/[^\d.]/g, "") }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>持ち帰り 税率（%）</span>
              <input
                inputMode="decimal"
                value={taxForm.takeoutTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, takeoutTaxRate: event.target.value.replace(/[^\d.]/g, "") }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>外部決済端末</span>
              <select
                value={taxForm.externalPaymentTerminalBrand}
                onChange={(event) => setTaxForm((current) => ({ ...current, externalPaymentTerminalBrand: event.target.value }))}
                disabled={!canManagePosSettings}
              >
                <option value="PayCAS">PayCAS</option>
                <option value="KOMOJU">KOMOJU</option>
                <option value="Square">Square</option>
                <option value="stera terminal">stera terminal</option>
                <option value="Airペイ">Airペイ</option>
                <option value="その他決済端末">その他決済端末</option>
              </select>
            </label>
            <label>
              <span>商品価格の税区分</span>
              <select
                value={taxForm.priceTaxMode}
                onChange={(event) => setTaxForm((current) => ({ ...current, priceTaxMode: event.target.value }))}
                disabled={!canManagePosSettings}
              >
                <option value="tax_included">税込価格</option>
                <option value="tax_excluded">税抜価格</option>
              </select>
            </label>
          </div>
          <div className="pos-admin-brand-pricing-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>ブランド別 POS 販売方式</h4>
                <p>称重販売を行うブランドだけ、重量単価を設定します。通常商品は固定価格のままです。</p>
              </div>
            </div>
            <div className="pos-admin-brand-pricing-list">
              {taxForm.posBrandSettings.length ? taxForm.posBrandSettings.map((setting, index) => (
                <div className="pos-admin-brand-pricing-row" key={setting.brandId}>
                  <strong>{setting.brandName}</strong>
                  <label>
                    <span>販売方式</span>
                    <select
                      value={setting.posPricingMode}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posPricingMode: event.target.value as PosBrandSetting["posPricingMode"] } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="fixed">固定価格</option>
                      <option value="weight">称重販売</option>
                    </select>
                  </label>
                  <label>
                    <span>重量単位</span>
                    <input
                      value={setting.posWeightUnit}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posWeightUnit: event.target.value } : item)
                      }))}
                      disabled={!canManagePosSettings || setting.posPricingMode !== "weight"}
                    />
                  </label>
                  <label>
                    <span>重量単価</span>
                    <input
                      inputMode="decimal"
                      value={setting.posWeightUnitPrice == null ? "" : String(setting.posWeightUnitPrice)}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posWeightUnitPrice: Number(event.target.value.replace(/[^\d.]/g, "")) || null } : item)
                      }))}
                      placeholder="4"
                      disabled={!canManagePosSettings || setting.posPricingMode !== "weight"}
                    />
                  </label>
                </div>
              )) : <p className="pos-admin-discount-empty">この店舗に紐づくブランドはありません。</p>}
            </div>
          </div>
          <div className="pos-admin-discount-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>割引プリセット</h4>
                <p>店舗 POS に表示する割引ボタン、割引率、対象範囲を管理します。</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTaxForm((current) => ({ ...current, discountPresets: [...current.discountPresets, createDiscountPreset()] }))}
                disabled={!canManagePosSettings}
              >
                <Plus size={15} />
                追加
              </button>
            </div>
            <div className="pos-admin-discount-list">
              {taxForm.discountPresets.length ? taxForm.discountPresets.map((preset, index) => (
                <div className="pos-admin-discount-row" key={preset.key || index}>
                  <label className="pos-admin-discount-enabled">
                    <span>有効</span>
                    <input
                      type="checkbox"
                      checked={preset.enabled}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>名称</span>
                    <input
                      value={preset.name}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                      }))}
                      placeholder="学割 20%OFF"
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>方式</span>
                    <select
                      value={preset.discountType}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, discountType: event.target.value as PosDiscountPreset["discountType"] } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="percent">％割引</option>
                      <option value="amount">金額割引</option>
                    </select>
                  </label>
                  <label>
                    <span>{preset.discountType === "percent" ? "割引率（%）" : "割引額"}</span>
                    <input
                      inputMode="numeric"
                      value={String(preset.discountValue)}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: Number(event.target.value.replace(/[^\d]/g, "")) || 0 } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>対象</span>
                    <select
                      value={preset.targetScope}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, targetScope: event.target.value as PosDiscountPreset["targetScope"], targetValue: event.target.value === "all" ? "" : item.targetValue } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="all">全商品</option>
                      <option value="category">カテゴリ</option>
                      <option value="item_kind">商品種別</option>
                      <option value="brand">ブランドID</option>
                    </select>
                  </label>
                  <label>
                    <span>対象値</span>
                    <input
                      value={preset.targetValue}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, targetValue: event.target.value } : item)
                      }))}
                      placeholder={preset.targetScope === "category" ? "ドリンク" : preset.targetScope === "item_kind" ? "drink" : preset.targetScope === "brand" ? "brand id" : "不要"}
                      disabled={!canManagePosSettings || preset.targetScope === "all"}
                    />
                  </label>
                  <label className="pos-admin-discount-check">
                    <input
                      type="checkbox"
                      checked={preset.allowCouponCombination}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, allowCouponCombination: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                    <span>クーポン併用可</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input
                      type="checkbox"
                      checked={preset.stampEligible}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, stampEligible: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                    <span>スタンプ対象</span>
                  </label>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="割引を削除"
                    onClick={() => setTaxForm((current) => ({ ...current, discountPresets: current.discountPresets.filter((_, itemIndex) => itemIndex !== index) }))}
                    disabled={!canManagePosSettings}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )) : <p className="pos-admin-discount-empty">割引プリセットは未設定です。</p>}
            </div>
          </div>
          <div className="pos-admin-tax-footer">
            <span>
              現在: {taxSettings?.dineInEnabled === false ? "持ち帰りのみ" : `店内 ${taxSettings?.dineInTaxRate ?? 10}%`} / 持ち帰り {taxSettings?.takeoutTaxRate ?? 8}% / 外部決済 {taxSettings?.externalPaymentTerminalBrand ?? "PayCAS"} / {taxSettings?.priceTaxMode === "tax_excluded" ? "税抜価格" : "税込価格"}
            </span>
            <button className="primary-button" type="button" onClick={() => void saveTaxSettings()} disabled={!canManagePosSettings || taxSaving}>
              {taxSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </section>

        <section className="metric-grid pos-admin-metrics">
          <article className="metric-card">
            <span>本日 POS 件数</span>
            <strong>{loading ? "-" : `${summary.orderCount} 件`}</strong>
            <p>店頭会計のみ</p>
          </article>
          <article className="metric-card">
            <span>本日 POS 売上</span>
            <strong>{loading ? "-" : formatYen(summary.total)}</strong>
            <p>キャンセル除外</p>
          </article>
          <article className="metric-card">
            <span>平均会計</span>
            <strong>{loading ? "-" : formatYen(summary.average)}</strong>
            <p>客単価の目安</p>
          </article>
          <article className="metric-card">
            <span>現金差額</span>
            <strong>{loading ? "-" : formatYen(reconciliation.totals.differenceAmount)}</strong>
            <p>{reconciliation.activeSession ? "開いているレジ締めあり" : "締め済みセッション合計"}</p>
          </article>
        </section>

        <section className="panel pos-admin-reconciliation">
          <div className="panel-title">
            <WalletCards />
            <div>
              <h3>日次レジ締め</h3>
              <p>釣銭準備金、現金売上、入出金、点検金額の差額を確認します。</p>
            </div>
            <a className="text-button" href="/os/pos/reconciliation">明細を見る</a>
          </div>
          <div className="pos-admin-cash-grid">
            <div>
              <span>開始金額</span>
              <strong>{formatYen(reconciliation.totals.openingAmount)}</strong>
            </div>
            <div>
              <span>現金売上</span>
              <strong>{formatYen(reconciliation.totals.cashSales)}</strong>
            </div>
            <div>
              <span>入金 / 出金</span>
              <strong>{formatYen(reconciliation.totals.cashIn)} / {formatYen(reconciliation.totals.cashOut)}</strong>
            </div>
            <div>
              <span>システム上の現金</span>
              <strong>{formatYen(reconciliation.totals.expectedCashAmount)}</strong>
            </div>
            <div>
              <span>実際の現金</span>
              <strong>{formatYen(reconciliation.totals.countedCashAmount)}</strong>
            </div>
            <div>
              <span>差額</span>
              <strong>{formatYen(reconciliation.totals.differenceAmount)}</strong>
            </div>
          </div>
          {reconciliation.sessions.length === 0 ? (
            <div className="empty-state">
              <WalletCards />
              <p>今日のレジ締めはまだありません。</p>
            </div>
          ) : (
            <div className="pos-admin-order-list">
              {reconciliation.sessions.map((session) => (
                <div key={session.id} className="pos-admin-order-row">
                  <div>
                    <strong>{session.registerName} / {session.status === "open" ? "進行中" : "締め済み"}</strong>
                    <span>
                      現金売上 {formatYen(session.cashSales)} / 予定 {formatYen(session.expectedCashAmount)}
                      {session.countedCashAmount !== null ? ` / 実際 ${formatYen(session.countedCashAmount)}` : ""}
                    </span>
                  </div>
                  <b>{session.differenceAmount === null ? "-" : formatYen(session.differenceAmount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel pos-admin-history">
          <div className="panel-title">
            <ShoppingCart />
            <div>
              <h3>直近の POS 会計</h3>
              <p>店舗 POS で確定した注文が表示されます。</p>
            </div>
          </div>
          {summary.latestOrders.length === 0 ? (
            <div className="empty-state">
              <MonitorSmartphone />
              <p>今日の POS 会計はまだありません。</p>
            </div>
          ) : (
            <div className="pos-admin-order-list">
              {summary.latestOrders.map((order) => (
                <div key={order.id} className="pos-admin-order-row">
                  <div>
                    <strong>{order.pickupCode}</strong>
                    <span>{order.createdTime} / {getPaymentLabel(order.paymentMethod)}</span>
                  </div>
                  <b>{formatYen(order.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
