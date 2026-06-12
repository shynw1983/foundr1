"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";

type Supplier = typeof initialSuppliers[number];
type SupplierLocation = {
  supplier: string;
  locationName: string;
  type: string;
  area: string;
  hours: string;
  purchaseMethod: string;
  note: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const channelTypes = ["実店舗", "チェーン店", "ネットショップ", "卸売", "その他"];

export default function SuppliersPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierLocations, setSupplierLocations] = useState<SupplierLocation[]>([]);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  useEffect(() => {
    async function loadData() {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { suppliers?: Supplier[]; supplierLocations?: SupplierLocation[] };

      if (data.suppliers) setSuppliers(data.suppliers);
      if (data.supplierLocations) setSupplierLocations(data.supplierLocations);
      setDataSource("neon");
    }

    void loadData();
  }, []);

  const filteredSuppliers = suppliers.filter((supplier) =>
    [
      supplier.name,
      supplier.category,
      supplier.channelType,
      supplier.reliability,
      supplier.address,
      supplier.phone,
      supplier.contactPerson,
      supplier.businessHours,
      supplier.orderUrl
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const supplierLocationsByName = supplierLocations.reduce<Record<string, SupplierLocation[]>>((grouped, location) => {
    const key = location.supplier;
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(location);
    return grouped;
  }, {});

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const supplier = readSupplierForm(formData);

    if (!supplier.name.trim()) return;

    const response = await fetch("/api/suppliers", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "発注先を保存できませんでした。");
      return;
    }

    setSuppliers((items) => [
      ...items.filter((item) => item.name !== supplier.name),
      supplier
    ].sort((a, b) => a.name.localeCompare(b.name, "ja")));
    form.reset();
    showNotice("発注先を追加しました。");
  }

  async function saveSupplierEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSupplier) return;

    const formData = new FormData(event.currentTarget);
    formData.set("currentName", editingSupplier.name);
    const supplier = readSupplierForm(formData);

    const response = await fetch("/api/suppliers", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "発注先を更新できませんでした。");
      return;
    }

    setSuppliers((items) =>
      items
        .map((item) => (item.name === editingSupplier.name ? supplier : item))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    );
    setEditingSupplier(null);
    showNotice("発注先を更新しました。");
  }

  function deleteSupplier(supplier: Supplier) {
    if (!window.confirm(`${supplier.name} を削除しますか？\n商品・発注記録・価格記録との紐づけも解除されます。`)) return;

    setSuppliers((items) => items.filter((item) => item.name !== supplier.name));
    void fetch("/api/suppliers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: supplier.name })
    })
      .then((response) => {
        if (response.ok) {
          showNotice("発注先を削除しました。");
          return null;
        }

        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        return response.json().then((body) => {
          window.alert(body.error ?? "発注先を削除できませんでした。");
        });
      })
      .catch(() => {
        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        window.alert("発注先を削除できませんでした。");
      });
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

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">発注先データベース</p>
            <h2>発注先管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="発注先・分類・区分を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>発注先を追加</h3>
              <p>実店舗、チェーン店、ネットショップを同じマスタで管理</p>
            </div>
          </div>
          <form className="management-form supplier-management-form" onSubmit={createSupplier}>
            <label>
              <span>発注先名</span>
              <input name="name" placeholder="例: 業務スーパー" />
            </label>
            <label>
              <span>取扱内容</span>
              <input name="category" placeholder="例: 冷凍食品 / 消耗品" />
            </label>
            <label>
              <span>区分</span>
              <select name="channelType" defaultValue="実店舗">
                {channelTypes.map((channelType) => (
                  <option value={channelType} key={channelType}>{channelType}</option>
                ))}
              </select>
            </label>
            <label>
              <span>住所</span>
              <input name="address" placeholder="例: 福岡市中央区..." />
            </label>
            <label>
              <span>電話番号</span>
              <input name="phone" placeholder="例: 092-000-0000" />
            </label>
            <label>
              <span>連絡先担当者</span>
              <input name="contactPerson" placeholder="例: 山田さん" />
            </label>
            <label>
              <span>営業時間</span>
              <input name="businessHours" placeholder="例: 9:00-18:00 / 日曜休み" />
            </label>
            <label>
              <span>注文URL</span>
              <input name="orderUrl" placeholder="例: https://example.com/order" />
            </label>
            <label>
              <span>メモ</span>
              <input name="reliability" placeholder="例: 即日対応 / 欠品あり / 配送 1-2 日" />
            </label>
            <button className="primary-button" type="submit">
              <Plus size={18} />
              追加
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>発注先リスト</h3>
              <p>商品マスタのメイン発注先・予備発注先で選択される候補</p>
            </div>
            <span className="source-indicator">{filteredSuppliers.length} 件</span>
          </div>
          <div className="supplier-list">
            {filteredSuppliers.map((supplier) => (
              <article className="supplier-row supplier-admin-row" key={supplier.name}>
                <div>
                  <strong>{supplier.name}</strong>
                  <p>{supplier.category || "取扱内容未設定"}</p>
                  <small>{supplier.reliability || "メモ未設定"}</small>
                  <div className="supplier-detail-list">
                    {supplier.address ? <span>住所: {supplier.address}</span> : null}
                    {supplier.phone ? <span>電話: {supplier.phone}</span> : null}
                    {supplier.contactPerson ? <span>担当: {supplier.contactPerson}</span> : null}
                    {supplier.businessHours ? <span>営業時間: {supplier.businessHours}</span> : null}
                    {supplier.orderUrl ? (
                      <a href={supplier.orderUrl} target="_blank" rel="noreferrer">注文URL</a>
                    ) : null}
                  </div>
                  {supplierLocationsByName[supplier.name]?.length ? (
                    <div className="supplier-location-tags" aria-label={`${supplier.name} の分店・OCR表示名`}>
                      {supplierLocationsByName[supplier.name].map((location) => (
                        <span key={`${supplier.name}-${location.locationName}`}>{location.locationName}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="supplier-type">{supplier.channelType}</span>
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => setEditingSupplier(supplier)}>
                    編集
                  </button>
                  <button className="text-button danger-button" type="button" onClick={() => deleteSupplier(supplier)}>
                    削除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      {editingSupplier ? (
        <div className="modal-backdrop">
          <form className="edit-modal" onSubmit={saveSupplierEdit}>
            <div className="modal-heading">
              <div>
                <h3>発注先を編集</h3>
                <p>{editingSupplier.name}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setEditingSupplier(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>発注先名</span>
                <input name="name" defaultValue={editingSupplier.name} />
              </label>
              <label>
                <span>取扱内容</span>
                <input name="category" defaultValue={editingSupplier.category} />
              </label>
              <label>
                <span>区分</span>
                <select name="channelType" defaultValue={editingSupplier.channelType || "実店舗"}>
                  {channelTypes.map((channelType) => (
                    <option value={channelType} key={channelType}>{channelType}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>住所</span>
                <input name="address" defaultValue={editingSupplier.address} />
              </label>
              <label>
                <span>電話番号</span>
                <input name="phone" defaultValue={editingSupplier.phone} />
              </label>
              <label>
                <span>連絡先担当者</span>
                <input name="contactPerson" defaultValue={editingSupplier.contactPerson} />
              </label>
              <label>
                <span>営業時間</span>
                <input name="businessHours" defaultValue={editingSupplier.businessHours} />
              </label>
              <label>
                <span>注文URL</span>
                <input name="orderUrl" defaultValue={editingSupplier.orderUrl} />
              </label>
              <label>
                <span>メモ</span>
                <input name="reliability" defaultValue={editingSupplier.reliability} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="text-button" type="button" onClick={() => setEditingSupplier(null)}>
                キャンセル
              </button>
              <button className="primary-button" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function readSupplierForm(formData: FormData): Supplier {
  return {
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    channelType: String(formData.get("channelType") ?? "実店舗").trim() || "実店舗",
    reliability: String(formData.get("reliability") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    contactPerson: String(formData.get("contactPerson") ?? "").trim(),
    businessHours: String(formData.get("businessHours") ?? "").trim(),
    orderUrl: String(formData.get("orderUrl") ?? "").trim()
  };
}
