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
  Search,
  ShoppingCart,
  Store,
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
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(body.selectedStoreId ?? "");
    setSummary(body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] });
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load("");
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
              <p className="eyebrow">POS</p>
              <h2>店頭会計</h2>
              <p>店舗のレジ操作、販売メニュー、店頭売上を管理します。</p>
            </div>
            <a className="secondary-button" href="/store/pos" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              店舗 POS を開く
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
                  void load(storeId);
                }}
              >
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <div className="pos-admin-actions">
              <a href="/os/menus"><MenuSquare size={16} />メニュー管理</a>
              <a href="/os/analytics/sales"><BarChart3 size={16} />売上分析</a>
              <a href="/os/stores"><Store size={16} />店舗設定</a>
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
      </div>
    </main>
  );
}
