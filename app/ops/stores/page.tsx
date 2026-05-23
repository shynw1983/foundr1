"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Store, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { brands, stores } from "../../../lib/mock-data";

type StoreItem = typeof stores[number];
type BrandItem = typeof brands[number];

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

export default function StoresPage() {
  const [storesData, setStoresData] = useState<StoreItem[]>([]);
  const [brandsData, setBrandsData] = useState<BrandItem[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editingStore, setEditingStore] = useState<StoreItem | null>(null);
  const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
  const [selectedStoreBrands, setSelectedStoreBrands] = useState<string[]>([]);
  const [editingStoreBrands, setEditingStoreBrands] = useState<string[]>([]);

  useEffect(() => {
    async function loadData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;
      const data = await response.json() as {
        stores?: StoreItem[];
        brands?: BrandItem[];
      };

      if (data.stores) setStoresData(data.stores);
      if (data.brands) setBrandsData(data.brands);
      setDataSource("neon");
    }

    void loadData();
  }, []);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const owner = String(formData.get("owner") ?? "");
    const selectedBrands = formData.getAll("brand").map((value) => String(value));

    if (!name.trim()) return;

    const response = await fetch("/api/stores", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "店舗を保存できませんでした。");
      return;
    }

    setStoresData((items) => [
      ...items.filter((item) => item.name !== name),
      { name, owner, brands: selectedBrands }
    ]);
    setSelectedStoreBrands([]);
    form.reset();
  }

  async function createBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const type = String(formData.get("type") ?? "");

    if (!name.trim()) return;

    const response = await fetch("/api/brands", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "ブランドを保存できませんでした。");
      return;
    }

    setBrandsData((items) => [
      ...items.filter((item) => item.name !== name),
      { name, type: type || "未設定" }
    ]);
    form.reset();
  }

  function deleteStore(store: StoreItem) {
    if (!window.confirm(`${store.name} を削除しますか？`)) return;

    setStoresData((items) => items.filter((item) => item.name !== store.name));
    void fetch("/api/stores", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: store.name })
    }).then(async (response) => {
      if (response.ok) return;
      const body = await response.json();
      setStoresData((items) => (items.some((item) => item.name === store.name) ? items : [...items, store]));
      window.alert(body.error ?? "店舗を削除できませんでした。");
    });
  }

  function deleteBrand(brand: BrandItem) {
    if (!window.confirm(`${brand.name} を削除しますか？`)) return;

    setBrandsData((items) => items.filter((item) => item.name !== brand.name));
    void fetch("/api/brands", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: brand.name })
    }).then(async (response) => {
      if (response.ok) return;
      const body = await response.json();
      setBrandsData((items) => (items.some((item) => item.name === brand.name) ? items : [...items, brand]));
      window.alert(body.error ?? "ブランドを削除できませんでした。");
    });
  }

  async function saveBrandEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBrand) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextName = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "").trim() || "未設定";

    if (!nextName) return;

    formData.set("currentName", editingBrand.name);

    const response = await fetch("/api/brands", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "ブランドを更新できませんでした。");
      return;
    }

    setBrandsData((items) =>
      items.map((item) => item.name === editingBrand.name ? { name: nextName, type } : item)
    );
    setStoresData((items) =>
      items.map((store) => ({
        ...store,
        brands: store.brands.map((brandName) => brandName === editingBrand.name ? nextName : brandName)
      }))
    );
    setEditingBrand(null);
  }

  async function saveStoreEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStore) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextName = String(formData.get("name") ?? "").trim();
    const owner = String(formData.get("owner") ?? "").trim();

    if (!nextName) return;

    formData.set("currentName", editingStore.name);
    editingStoreBrands.forEach((brandName) => formData.append("brand", brandName));

    const response = await fetch("/api/stores", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "店舗を更新できませんでした。");
      return;
    }

    setStoresData((items) =>
      items.map((item) => item.name === editingStore.name ? { name: nextName, owner, brands: editingStoreBrands } : item)
    );
    setEditingStore(null);
    setEditingStoreBrands([]);
  }

  function startEditingStore(store: StoreItem) {
    setEditingStore(store);
    setEditingStoreBrands(store.brands);
  }

  function toggleBrandSelection(
    current: string[],
    brandName: string,
    checked: boolean
  ) {
    const allBrandNames = brandsData.map((brand) => brand.name);
    const concreteBrandNames = allBrandNames.filter((name) => name !== "共通");

    if (brandName === "共通") {
      return checked ? allBrandNames : [];
    }

    const nextConcrete = checked
      ? Array.from(new Set([...current.filter((name) => name !== "共通"), brandName]))
      : current.filter((name) => name !== "共通" && name !== brandName);
    const hasAllConcreteBrands = concreteBrandNames.every((name) => nextConcrete.includes(name));

    return hasAllConcreteBrands && concreteBrandNames.length > 0
      ? ["共通", ...nextConcrete]
      : nextConcrete;
  }

  function toggleStoreBrand(brandName: string, checked: boolean) {
    setSelectedStoreBrands((current) => toggleBrandSelection(current, brandName, checked));
  }

  function toggleEditingStoreBrand(brandName: string, checked: boolean) {
    setEditingStoreBrands((current) => toggleBrandSelection(current, brandName, checked));
  }

  function formatStoreBrands(brandNames: string[]) {
    const concreteBrandNames = brandsData.map((brand) => brand.name).filter((name) => name !== "共通");
    const hasAllConcreteBrands = concreteBrandNames.length > 0 && concreteBrandNames.every((name) => brandNames.includes(name));

    if (brandNames.includes("共通") || hasAllConcreteBrands) {
      return "共通（全ブランド）";
    }

    return brandNames.length > 0 ? brandNames.join(" / ") : "ブランド未設定";
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
        <label className="mobile-nav-menu">
          <span>メニュー</span>
          <select defaultValue="" onChange={(event) => { if (event.target.value) window.location.href = event.target.value; }}>
            <option value="" disabled>移動先を選択</option>
            {navItems.map(({ label, href }) => (
              <option value={href} key={label}>{label}</option>
            ))}
          </select>
        </label>
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
            <p className="eyebrow">店舗とブランドの基本情報</p>
            <h2>店舗・ブランド</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
        </header>

        <section className="management-grid">
          <section className="panel">
            <PanelTitle title="店舗管理" subtitle="配達先店舗と取り扱いブランドを管理。担当者は現在メモ扱いで、社員アカウント連携は次の権限設計で対応" />
            <form className="management-form" onSubmit={createStore}>
              <label>
                <span>店舗名</span>
                <input name="name" placeholder="例: 天神店" />
              </label>
              <label>
                <span>担当者メモ</span>
                <input name="owner" placeholder="例: 店長名・担当者名" />
              </label>
              <div className="checkbox-group">
                <span>取り扱いブランド</span>
                {brandsData.map((brand) => (
                  <label key={brand.name}>
                    <input
                      type="checkbox"
                      name="brand"
                      value={brand.name}
                      checked={selectedStoreBrands.includes(brand.name)}
                      onChange={(event) => toggleStoreBrand(brand.name, event.target.checked)}
                    />
                    {brand.name === "共通" ? "共通（全ブランド）" : brand.name}
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit">店舗を追加</button>
            </form>
            <div className="management-list">
              {storesData.map((store) => (
                <article className="management-row" key={store.name}>
                  <div>
                    <strong>{store.name}</strong>
                    <p>{store.owner || "担当者未設定"}</p>
                    <small>{formatStoreBrands(store.brands)}</small>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => startEditingStore(store)}>
                      編集
                    </button>
                    <button className="text-button danger-button" type="button" onClick={() => deleteStore(store)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {storesData.length === 0 ? (
                <div className="empty-state">登録済みの店舗はありません</div>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <PanelTitle title="ブランド管理" subtitle="商品用途として使うブランドを管理" />
            <form className="management-form" onSubmit={createBrand}>
              <label>
                <span>ブランド名</span>
                <input name="name" placeholder="例: nanacha" />
              </label>
              <label>
                <span>種類</span>
                <input name="type" placeholder="例: ミルクティー" />
              </label>
              <button className="primary-button" type="submit">ブランドを追加</button>
            </form>
            <div className="management-list">
              {brandsData.map((brand) => (
                <article className="management-row" key={brand.name}>
                  <div>
                    <strong>{brand.name}</strong>
                    <p>{brand.type}</p>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => setEditingBrand(brand)}>
                      編集
                    </button>
                    <button className="text-button danger-button" type="button" onClick={() => deleteBrand(brand)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {brandsData.length === 0 ? (
                <div className="empty-state">ブランドを読み込み中です</div>
              ) : null}
            </div>
          </section>
        </section>
      </section>

      {editingStore ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-edit-title">
          <form className="edit-modal" onSubmit={saveStoreEdit}>
            <div className="modal-heading">
              <div>
                <h3 id="store-edit-title">店舗を編集</h3>
                <p>{editingStore.name}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingStore(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>店舗名</span>
                <input name="name" defaultValue={editingStore.name} />
              </label>
              <label>
                <span>担当者メモ</span>
                <input name="owner" defaultValue={editingStore.owner} placeholder="例: 店長名・担当者名" />
              </label>
              <div className="checkbox-group">
                <span>取り扱いブランド</span>
                {brandsData.map((brand) => (
                  <label key={brand.name}>
                    <input
                      type="checkbox"
                      value={brand.name}
                      checked={editingStoreBrands.includes(brand.name)}
                      onChange={(event) => toggleEditingStoreBrand(brand.name, event.target.checked)}
                    />
                    {brand.name === "共通" ? "共通（全ブランド）" : brand.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingStore(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary-button">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingBrand ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="brand-edit-title">
          <form className="edit-modal" onSubmit={saveBrandEdit}>
            <div className="modal-heading">
              <div>
                <h3 id="brand-edit-title">ブランドを編集</h3>
                <p>{editingBrand.name}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingBrand(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>ブランド名</span>
                <input name="name" defaultValue={editingBrand.name} />
              </label>
              <label>
                <span>種類</span>
                <input name="type" defaultValue={editingBrand.type} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingBrand(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary-button">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
