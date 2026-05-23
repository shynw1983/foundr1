"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";

type Supplier = typeof initialSuppliers[number];

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "仕入れ一覧", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "仕入れ先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

const channelTypes = ["実店舗", "チェーン店", "ネットショップ", "卸売", "その他"];

export default function SuppliersPage() {
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
      window.alert(body.error ?? "仕入れ先を保存できませんでした。");
      return;
    }

    setSuppliers((items) => [
      ...items.filter((item) => item.name !== supplier.name),
      supplier
    ].sort((a, b) => a.name.localeCompare(b.name, "ja")));
    form.reset();
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
      window.alert(body.error ?? "仕入れ先を更新できませんでした。");
      return;
    }

    setSuppliers((items) =>
      items
        .map((item) => (item.name === editingSupplier.name ? supplier : item))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    );
    setEditingSupplier(null);
  }

  function deleteSupplier(supplier: Supplier) {
    if (!window.confirm(`${supplier.name} を削除しますか？`)) return;

    setSuppliers((items) => items.filter((item) => item.name !== supplier.name));
    void fetch("/api/suppliers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: supplier.name })
    })
      .then((response) => {
        if (response.ok) return null;

        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        return response.json().then((body) => {
          window.alert(body.error ?? "仕入れ先を削除できませんでした。");
        });
      })
      .catch(() => {
        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        window.alert("仕入れ先を削除できませんでした。");
      });
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <div className="brand-block">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>仕入れ管理</h1>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map(({ label, href, icon: Icon }) => (
            <a href={href} className="nav-item" key={label}>
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">仕入れ先データベース</p>
            <h2>仕入れ先管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="仕入れ先・分類・区分を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>仕入れ先を追加</h3>
              <p>実店舗、チェーン店、ネットショップを同じマスタで管理</p>
            </div>
          </div>
          <form className="management-form supplier-management-form" onSubmit={createSupplier}>
            <label>
              <span>仕入れ先名</span>
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
              <h3>仕入れ先リスト</h3>
              <p>商品マスタの主要仕入れ先・予備仕入れ先で選択される候補</p>
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
                <h3>仕入れ先を編集</h3>
                <p>{editingSupplier.name}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setEditingSupplier(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>仕入れ先名</span>
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
