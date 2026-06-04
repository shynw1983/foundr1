"use client";

import {
  ArrowLeft,
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Lightbulb,
  LogOut,
  MenuSquare,
  PackageCheck,
  Search,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";

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

type PosCashAccess = {
  stores: StoreOption[];
  canManageCashReconciliation: boolean;
};

type PosCashSession = {
  id: string;
  storeName: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  differenceAmount: number | null;
  closingNote: string;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string;
};

type PosCashMovement = {
  id: string;
  sessionId: string;
  movementType: string;
  amount: number;
  reason: string;
  source: string;
  createdByName: string;
  createdTime: string;
};

type PosOrder = {
  id: string;
  pickupCode: string;
  amount: number;
  paymentMethod: string;
  cashierName: string;
  createdTime: string;
};

type PaymentTotal = {
  paymentMethod: string;
  count: number;
  amount: number;
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

function getToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
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

function getMovementLabel(value: string) {
  if (value === "cash_in") return "入金";
  if (value === "cash_out") return "出金";
  return value || "-";
}

function getTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function PosReconciliationPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [access, setAccess] = useState<PosCashAccess | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [businessDate, setBusinessDate] = useState(getToday());
  const [sessions, setSessions] = useState<PosCashSession[]>([]);
  const [movements, setMovements] = useState<PosCashMovement[]>([]);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [paymentTotals, setPaymentTotals] = useState<PaymentTotal[]>([]);
  const [totals, setTotals] = useState<PosCashTotals>({ openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load(storeId = selectedStoreId, date = businessDate) {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (date) params.set("date", date);
    const response = await fetch(`/api/store/pos/reconciliation?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("日次レジ締めを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    setAccess(body.access ?? null);
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(body.selectedStoreId ?? "");
    setBusinessDate(body.businessDate ?? date);
    setSessions(body.sessions ?? []);
    setMovements(body.movements ?? []);
    setOrders(body.orders ?? []);
    setPaymentTotals(body.paymentTotals ?? []);
    setTotals(body.totals ?? { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 });
    setMessage("");
    setLoading(false);
  }

  async function runCorrection(payload: { action: "delete_movement" | "delete_session" | "clear_date" | "recalculate"; movementId?: string; sessionId?: string }, confirmMessage: string, successMessage: string) {
    if (!selectedStoreId || saving) return;
    if (!window.confirm(confirmMessage)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          storeId: selectedStoreId,
          businessDate
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "修正を保存できませんでした。");
      setSessions(body.sessions ?? []);
      setMovements(body.movements ?? []);
      setOrders(body.orders ?? []);
      setPaymentTotals(body.paymentTotals ?? []);
      setMessage(successMessage);
      await load(selectedStoreId, businessDate);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修正を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load("", getToday());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="os-home-shell pos-admin-page">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>POS</h1>
          </div>
        </a>
        <div className="topbar-actions">
          <UserBadge />
          <MobileNavMenu navItems={navItems} />
        </div>
      </header>

      <div className="os-layout">
        <aside className="sidebar">
          <OsNavList navItems={navItems} />
        </aside>

        <section className="os-main-content">
          <div className="management-header">
            <div>
              <p className="eyebrow">POS Cash</p>
              <h2>日次レジ締め</h2>
              <p>店舗ごとの現金残高、入出金、点検金額、差額理由を確認します。</p>
            </div>
            <a className="secondary-button" href="/os/pos">
              <ArrowLeft size={16} />
              POS に戻る
            </a>
          </div>

          {message ? <div className="action-notice">{message}</div> : null}

          <section className="panel pos-admin-toolbar">
            <label>
              <span>店舗</span>
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  const storeId = event.target.value;
                  setSelectedStoreId(storeId);
                  void load(storeId, businessDate);
                }}
              >
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              <span>日付</span>
              <input
                type="date"
                value={businessDate}
                onChange={(event) => {
                  const date = event.target.value;
                  setBusinessDate(date);
                  void load(selectedStoreId, date);
                }}
              />
            </label>
            <div className="pos-admin-actions">
              <a href="/os/analytics/sales"><BarChart3 size={16} />売上分析</a>
              <a href="/store/pos" target="_blank" rel="noreferrer"><ShoppingCart size={16} />店舗 POS</a>
            </div>
          </section>

          <section className="metric-grid pos-admin-metrics">
            <article className="metric-card">
              <span>現在/精算時の現金</span>
              <strong>{loading ? "-" : formatYen(totals.expectedCashAmount)}</strong>
              <p>開始金額 + 現金売上 + 入金 - 出金</p>
            </article>
            <article className="metric-card">
              <span>実際の現金</span>
              <strong>{loading ? "-" : formatYen(totals.countedCashAmount)}</strong>
              <p>締め済みの点検金額</p>
            </article>
            <article className="metric-card">
              <span>差額</span>
              <strong>{loading ? "-" : formatYen(totals.differenceAmount)}</strong>
              <p>実際の現金 - システム上の現金</p>
            </article>
            <article className="metric-card">
              <span>現金売上</span>
              <strong>{loading ? "-" : formatYen(totals.cashSales)}</strong>
              <p>現金会計のみ</p>
            </article>
          </section>

          <section className="panel pos-admin-reconciliation">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>精算サマリー</h3>
                <p>支払方法別売上と現金の入出金をまとめて確認します。</p>
              </div>
            </div>
            <div className="pos-admin-cash-grid">
              <div><span>開始金額</span><strong>{formatYen(totals.openingAmount)}</strong></div>
              <div><span>現金売上</span><strong>{formatYen(totals.cashSales)}</strong></div>
              <div><span>入金</span><strong>{formatYen(totals.cashIn)}</strong></div>
              <div><span>出金</span><strong>{formatYen(totals.cashOut)}</strong></div>
              {paymentTotals.map((payment) => (
                <div key={payment.paymentMethod}>
                  <span>{getPaymentLabel(payment.paymentMethod)} / {payment.count} 件</span>
                  <strong>{formatYen(payment.amount)}</strong>
                </div>
              ))}
            </div>
          </section>

          {access?.canManageCashReconciliation ? (
            <section className="panel pos-admin-correction-panel">
              <div className="panel-title">
                <WalletCards />
                <div>
                  <h3>テストデータ修正</h3>
                  <p>テスト中の誤入力を消すための管理者操作です。通常営業後は慎重に使ってください。</p>
                </div>
              </div>
              <div className="pos-admin-correction-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => runCorrection({ action: "recalculate" }, "この日のレジ締め金額を再計算しますか？", "この日のレジ締めを再計算しました。")}
                >
                  再計算
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={saving}
                  onClick={() => runCorrection({ action: "clear_date" }, "この日のレジ締め記録をすべて削除しますか？ POS 会計自体は削除されません。", "この日のレジ締め記録を削除しました。")}
                >
                  この日のレジ締めをクリア
                </button>
              </div>
            </section>
          ) : null}

          <section className="panel pos-admin-history">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>レジ締め記録</h3>
                <p>開始金額、点検金額、差額理由を確認します。</p>
              </div>
            </div>
            {sessions.length === 0 ? (
              <div className="empty-state">
                <WalletCards />
                <p>この日のレジ締め記録はありません。</p>
              </div>
            ) : (
              <div className="pos-reconciliation-table">
                <div className="pos-reconciliation-head">
                  <span>状態</span>
                  <span>開始</span>
                  <span>現金売上</span>
                  <span>システム</span>
                  <span>実際</span>
                  <span>差額</span>
                </div>
                {sessions.map((session) => (
                  <div className="pos-reconciliation-row" key={session.id}>
                    <div>
                      <strong>{session.status === "open" ? "進行中" : "締め済み"}</strong>
                      <small>{session.registerName} / {session.openedByName || "-"} / {getTime(session.openedAt)}</small>
                      {session.closingNote ? <em>{session.closingNote}</em> : null}
                      {access?.canManageCashReconciliation ? (
                        <button
                          className="text-button danger-text-button"
                          type="button"
                          disabled={saving}
                          onClick={() => runCorrection({ action: "delete_session", sessionId: session.id }, "このレジ締め記録を削除しますか？ POS 会計自体は削除されません。", "レジ締め記録を削除しました。")}
                        >
                          記録を削除
                        </button>
                      ) : null}
                    </div>
                    <span>{formatYen(session.openingAmount)}</span>
                    <span>{formatYen(session.cashSales)}</span>
                    <span>{formatYen(session.expectedCashAmount)}</span>
                    <span>{session.countedCashAmount === null ? "-" : formatYen(session.countedCashAmount)}</span>
                    <b>{session.differenceAmount === null ? "-" : formatYen(session.differenceAmount)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel pos-admin-history">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>入出金明細</h3>
                <p>両替、備品購入など現金を動かした記録です。</p>
              </div>
            </div>
            {movements.length === 0 ? (
              <div className="empty-state">
                <WalletCards />
                <p>この日の入出金はありません。</p>
              </div>
            ) : (
              <div className="pos-admin-order-list">
                {movements.map((movement) => (
                  <div key={movement.id} className="pos-admin-order-row">
                    <div>
                      <strong>{getMovementLabel(movement.movementType)} / {movement.createdTime}</strong>
                      <span>{movement.reason} / {movement.createdByName || "-"}</span>
                      {access?.canManageCashReconciliation ? (
                        <button
                          className="text-button danger-text-button"
                          type="button"
                          disabled={saving}
                          onClick={() => runCorrection({ action: "delete_movement", movementId: movement.id }, "この入出金記録を削除しますか？", "入出金記録を削除しました。")}
                        >
                          削除
                        </button>
                      ) : null}
                    </div>
                    <b>{movement.movementType === "cash_out" ? "-" : "+"}{formatYen(movement.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel pos-admin-history">
            <div className="panel-title">
              <ShoppingCart />
              <div>
                <h3>POS 会計明細</h3>
                <p>この日の POS 会計を支払方法別に確認します。</p>
              </div>
            </div>
            {orders.length === 0 ? (
              <div className="empty-state">
                <ShoppingCart />
                <p>この日の POS 会計はありません。</p>
              </div>
            ) : (
              <div className="pos-admin-order-list">
                {orders.map((order) => (
                  <div key={order.id} className="pos-admin-order-row">
                    <div>
                      <strong>{order.pickupCode} / {order.createdTime}</strong>
                      <span>{getPaymentLabel(order.paymentMethod)} / {order.cashierName || "-"}</span>
                    </div>
                    <b>{formatYen(order.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
