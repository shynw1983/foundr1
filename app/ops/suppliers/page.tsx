"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";

type Supplier = typeof initialSuppliers[number];

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const channelTypes = ["実店舗", "チェーン店", "ネットショップ", "卸売", "その他"];

export default function SuppliersPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  useEffect(() => {
    async function loadData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;
      const data = await response.json() as { suppliers?: Supplier[] };

      if (data.suppliers) setSuppliers(data.suppliers);
      setDataSource("neon");
    }

    void loadData();
  }, []);

  const filteredSuppliers = suppliers.filter((supplier) =>
    [supplier.name, supplier.category, supplier.channelType, supplier.reliability]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );

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
        <a className="brand-block" href="/ops" aria-label="ダッシュボードへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>発注管理</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OpsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">発注先データベース</p>
            <h2>発注先管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
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
    reliability: String(formData.get("reliability") ?? "").trim()
  };
}
