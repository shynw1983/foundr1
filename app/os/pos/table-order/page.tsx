"use client";

import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  Lightbulb,
  LogOut,
  MenuSquare,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCcw,
  Search,
  ShoppingCart,
  Store,
  ToggleLeft,
  ToggleRight,
  Truck,
  UserCog,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  { label: "テーブルQR注文", href: "/os/pos/table-order", icon: QrCode },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

type StoreOption = {
  id: string;
  name: string;
};

type BrandOption = {
  id: string;
  name: string;
};

type StoreTable = {
  id: string;
  storeId: string;
  storeName: string;
  brandId: string;
  brandName: string;
  label: string;
  displayName: string;
  areaName: string;
  seatCount: number;
  qrToken: string;
  qrUrl: string;
  qrCodeDataUrl: string;
  status: string;
  tableOrderingEnabled: boolean;
  checkoutExitPolicy: string;
  sortOrder: number;
  updatedAt: string;
};

type TableOrderResponse = {
  stores: StoreOption[];
  selectedStoreId: string;
  storeBrands: BrandOption[];
  tables: StoreTable[];
  error?: string;
};

const checkoutExitPolicies = [
  { value: "show_staff_screen_required", label: "支払い完了画面をスタッフに見せる" },
  { value: "notify_staff_then_leave", label: "スタッフ通知後に退店可" },
  { value: "direct_leave_allowed", label: "支払い後そのまま退店可" }
];

function emptyForm(defaultBrandId = "") {
  return {
    label: "",
    displayName: "",
    areaName: "",
    seatCount: "0",
    brandId: defaultBrandId,
    checkoutExitPolicy: "show_staff_screen_required"
  };
}

export default function OsTableOrderPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeBrands, setStoreBrands] = useState<BrandOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [tables, setTables] = useState<StoreTable[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedStoreName = useMemo(
    () => stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗未選択",
    [stores, selectedStoreId]
  );

  async function load(storeId = selectedStoreId) {
    setLoading(true);
    setMessage("");
    try {
      const searchParams = new URLSearchParams({ includeQrCodes: "1" });
      if (storeId) searchParams.set("storeId", storeId);
      const response = await fetch(`/api/os/table-order/tables?${searchParams.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as TableOrderResponse;
      if (!response.ok) throw new Error(body.error || "テーブルQRを読み込めませんでした。");
      const brands = body.storeBrands ?? [];
      setStores(body.stores ?? []);
      setSelectedStoreId(body.selectedStoreId ?? "");
      setStoreBrands(brands);
      setTables(body.tables ?? []);
      setForm((current) => ({
        ...current,
        brandId: current.brandId || (brands.length === 1 ? brands[0].id : "")
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テーブルQRを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  async function createTable() {
    if (!selectedStoreId || !form.label.trim()) {
      setMessage("店舗とテーブル番号を入力してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/os/table-order/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          brandId: form.brandId,
          label: form.label,
          displayName: form.displayName,
          areaName: form.areaName,
          seatCount: form.seatCount,
          checkoutExitPolicy: form.checkoutExitPolicy
        })
      });
      const body = await response.json().catch(() => ({})) as { tables?: StoreTable[]; error?: string };
      if (!response.ok) throw new Error(body.error || "テーブルQRを作成できませんでした。");
      setTables(body.tables ?? []);
      setForm(emptyForm(storeBrands.length === 1 ? storeBrands[0].id : ""));
      setMessage("テーブルQRを作成しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テーブルQRを作成できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function patchTable(table: StoreTable, payload: Record<string, unknown>, successMessage: string) {
    setMessage("");
    try {
      const response = await fetch(`/api/os/table-order/tables/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { table?: StoreTable; error?: string };
      if (!response.ok || !body.table) throw new Error(body.error || "テーブルQRを更新できませんでした。");
      setTables((current) => current.map((candidate) => candidate.id === table.id ? body.table as StoreTable : candidate));
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テーブルQRを更新できませんでした。");
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("QRリンクをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。リンクを手動で選択してください。");
    }
  }

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

      <section className="workspace table-order-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">Table QR</p>
            <h2>テーブルQR注文</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/os/pos">
              <ArrowLeft size={16} />
              POS に戻る
            </a>
          </div>
        </header>

        {message ? <div className="action-notice">{message}</div> : null}

        <section className="panel pos-admin-toolbar">
          <label className="store-context-selector is-os">
            <span>管理対象店舗</span>
            <strong>{selectedStoreName}</strong>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                const storeId = event.target.value;
                setSelectedStoreId(storeId);
                setForm(emptyForm());
                void load(storeId);
              }}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <small>この店舗のテーブルQRを管理</small>
          </label>
          <div className="pos-admin-actions">
            <a href="/os/pos"><ShoppingCart size={16} />POS 設定</a>
            <a href="/os/pos/reconciliation"><WalletCards size={16} />日次レジ締め</a>
            <a href="/os/menus"><MenuSquare size={16} />メニュー管理</a>
          </div>
        </section>

        <section className="panel table-order-create-panel">
          <div className="panel-title">
            <QrCode />
            <div>
              <h3>テーブルQRを作成</h3>
              <p>各テーブルに固有のQRリンクを発行します。QRを読み取ると店舗とテーブルが自動で確定します。</p>
            </div>
          </div>
          <div className="table-order-form-grid">
            <label>
              <span>テーブル番号</span>
              <input value={form.label} placeholder="例: 12 / A3 / カウンター1" onChange={(event) => setForm({ ...form, label: event.target.value })} />
            </label>
            <label>
              <span>表示名</span>
              <input value={form.displayName} placeholder="空欄ならテーブル番号を表示" onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            </label>
            <label>
              <span>エリア</span>
              <input value={form.areaName} placeholder="例: 1階 / テラス" onChange={(event) => setForm({ ...form, areaName: event.target.value })} />
            </label>
            <label>
              <span>席数</span>
              <input inputMode="numeric" value={form.seatCount} onChange={(event) => setForm({ ...form, seatCount: event.target.value })} />
            </label>
            <label>
              <span>ブランド</span>
              <select value={form.brandId} onChange={(event) => setForm({ ...form, brandId: event.target.value })}>
                <option value="">未指定</option>
                {storeBrands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label>
              <span>オンライン決済後</span>
              <select value={form.checkoutExitPolicy} onChange={(event) => setForm({ ...form, checkoutExitPolicy: event.target.value })}>
                {checkoutExitPolicies.map((policy) => <option key={policy.value} value={policy.value}>{policy.label}</option>)}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="button" onClick={() => void createTable()} disabled={saving || !selectedStoreId}>
              <Plus size={16} />
              {saving ? "作成中..." : "QRを作成"}
            </button>
          </div>
        </section>

        <section className="table-order-card-grid">
          {tables.map((table) => (
            <article className="table-order-card" key={table.id}>
              <div className="table-order-card-heading">
                <div>
                  <span>{table.areaName || "テーブル"}</span>
                  <h3>{table.displayName || table.label}</h3>
                  <p>{table.brandName || "ブランド未指定"} / {table.seatCount > 0 ? `${table.seatCount}席` : "席数未設定"}</p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title={table.tableOrderingEnabled ? "注文を停止" : "注文を有効化"}
                  onClick={() => void patchTable(table, { tableOrderingEnabled: !table.tableOrderingEnabled }, table.tableOrderingEnabled ? "テーブル注文を停止しました。" : "テーブル注文を有効化しました。")}
                >
                  {table.tableOrderingEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
              <div className="table-order-qr-frame">
                {table.qrCodeDataUrl ? <img src={table.qrCodeDataUrl} alt={`${table.label} QR`} /> : <QrCode size={80} />}
              </div>
              <div className="table-order-url">{table.qrUrl}</div>
              <div className="table-order-card-actions">
                <button type="button" className="secondary-button" onClick={() => void copyUrl(table.qrUrl)}><Copy size={16} />コピー</button>
                <a className="secondary-button" href={table.qrUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />開く</a>
                <button type="button" className="secondary-button" onClick={() => void patchTable(table, { action: "regenerate_qr" }, "QRを再発行しました。古いQRは無効です。")}><RefreshCcw size={16} />再発行</button>
              </div>
              <div className="table-order-card-meta">
                <span className={table.tableOrderingEnabled ? "status-pill success" : "status-pill"}>{table.tableOrderingEnabled ? "注文受付中" : "停止中"}</span>
                <span>{checkoutExitPolicies.find((policy) => policy.value === table.checkoutExitPolicy)?.label ?? table.checkoutExitPolicy}</span>
              </div>
            </article>
          ))}
          {!loading && tables.length === 0 ? (
            <section className="panel empty-state">
              <QrCode size={36} />
              <h3>テーブルQRはまだありません</h3>
              <p>最初のテーブル番号を入力してQRを作成してください。</p>
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
