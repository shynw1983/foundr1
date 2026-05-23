"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  brands,
  products as initialProducts,
  suppliers as initialSuppliers
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductWithCategory = Product & {
  subcategory?: string;
  originCountries?: string[];
  packageSpec?: string;
  productBrandName?: string;
  manufacturer?: string;
};
type Supplier = typeof initialSuppliers[number];
type ProductEditTarget = { type: "product"; index: number; value: ProductWithCategory; originalName?: string };
type CategoryItem = { name: string; sortOrder?: number };
type SubcategoryItem = { category: string; name: string; sortOrder?: number };
type EditingCategory = { type: "category"; currentName: string; name: string } | { type: "subcategory"; currentCategory: string; currentName: string; category: string; name: string };

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

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [brandsData, setBrandsData] = useState<typeof brands>([]);
  const [categoryMaster, setCategoryMaster] = useState<CategoryItem[]>([]);
  const [subcategoryMaster, setSubcategoryMaster] = useState<SubcategoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("すべて");
  const [subcategoryFilter, setSubcategoryFilter] = useState("すべて");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editTarget, setEditTarget] = useState<ProductEditTarget | null>(null);
  const [editingCategory, setEditingCategory] = useState<EditingCategory | null>(null);

  useEffect(() => {
    async function loadProductData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        brands?: typeof brands;
        products?: ProductWithCategory[];
        suppliers?: Supplier[];
        productCategories?: CategoryItem[];
        productSubcategories?: SubcategoryItem[];
      };

      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.suppliers) setSuppliers(data.suppliers);
      if (data.productCategories) setCategoryMaster(data.productCategories);
      if (data.productSubcategories) setSubcategoryMaster(data.productSubcategories);
      setDataSource("neon");
    }

    void loadProductData();
  }, []);

  const productCategories = categoryMaster.length > 0
    ? categoryMaster.map((category) => category.name)
    : Array.from(new Set(products.map((product) => product.category)));
  const visibleSubcategories = Array.from(new Set(
    subcategoryMaster.length > 0
      ? subcategoryMaster
          .filter((subcategory) => categoryFilter === "すべて" || subcategory.category === categoryFilter)
          .map((subcategory) => subcategory.name)
      : products
          .filter((product) => categoryFilter === "すべて" || product.category === categoryFilter)
          .map((product) => product.subcategory ?? "未分類")
  ));
  const filteredProducts = products.filter((product) => {
    const targetText = [
      product.name,
      product.productBrandName,
      product.manufacturer,
      product.category,
      product.subcategory,
      product.brand,
      product.unit,
      product.mainSupplier,
      product.backupSupplier,
      product.storageType,
      product.specNote
    ].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      (categoryFilter === "すべて" || product.category === categoryFilter) &&
      (subcategoryFilter === "すべて" || (product.subcategory ?? "未分類") === subcategoryFilter)
    );
  });

  async function saveProduct(target: ProductEditTarget) {
    const response = await fetch("/api/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentName: target.originalName ?? "",
        ...target.value
      })
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "商品を保存できませんでした。");
      return;
    }

    setProducts((items) =>
      target.index >= items.length
        ? [...items, target.value]
        : items.map((item, index) => (index === target.index ? target.value : item))
    );
    setEditTarget(null);
  }

  function openNewProductEditor() {
    setEditTarget({
      type: "product",
      index: products.length,
      value: {
        name: "",
        productBrandName: "",
        manufacturer: "",
        category: productCategories[0] ?? "食材",
        subcategory: "未分類",
        brand: brandsData[0]?.name ?? "共通",
        unit: "個",
        referencePrice: 0,
        originCountries: [],
        packageSpec: "",
        mainSupplier: suppliers[0]?.name ?? "",
        backupSupplier: "",
        specNote: "",
        photoUrl: "",
        storageType: "常温"
      }
    });
  }

  function deleteProduct(product: Product) {
    if (!window.confirm(`${product.name} を削除しますか？`)) return;

    setProducts((items) => items.filter((item) => item.name !== product.name));

    void fetch("/api/products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: product.name })
    })
      .then((response) => {
        if (!response.ok) {
          setProducts((items) => (items.some((item) => item.name === product.name) ? items : [...items, product]));
          return response.json().then((body) => {
            window.alert(body.error ?? "商品を削除できませんでした。");
          });
        }

        return null;
      })
      .catch(() => {
        setProducts((items) => (items.some((item) => item.name === product.name) ? items : [...items, product]));
        window.alert("商品を削除できませんでした。");
      });
  }

  async function createCategory(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;

    const response = await fetch("/api/product-categories", {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "大分類を保存できませんでした。");
      return;
    }

    setCategoryMaster((items) => items.some((item) => item.name === name) ? items : [...items, { name }]);
  }

  async function createSubcategory(formData: FormData) {
    const category = String(formData.get("category") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    if (!category || !name) return;

    const response = await fetch("/api/product-subcategories", {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "小分類を保存できませんでした。");
      return;
    }

    setSubcategoryMaster((items) => items.some((item) => item.category === category && item.name === name) ? items : [...items, { category, name }]);
  }

  async function saveCategoryEdit() {
    if (!editingCategory) return;

    const formData = new FormData();
    if (editingCategory.type === "category") {
      formData.set("currentName", editingCategory.currentName);
      formData.set("name", editingCategory.name);
      const response = await fetch("/api/product-categories", { method: "PUT", body: formData });
      if (!response.ok) {
        const body = await response.json();
        window.alert(body.error ?? "大分類を更新できませんでした。");
        return;
      }
      setCategoryMaster((items) => items.map((item) => item.name === editingCategory.currentName ? { ...item, name: editingCategory.name } : item));
      setSubcategoryMaster((items) => items.map((item) => item.category === editingCategory.currentName ? { ...item, category: editingCategory.name } : item));
      setProducts((items) => items.map((item) => item.category === editingCategory.currentName ? { ...item, category: editingCategory.name } : item));
    } else {
      formData.set("currentCategory", editingCategory.currentCategory);
      formData.set("currentName", editingCategory.currentName);
      formData.set("category", editingCategory.category);
      formData.set("name", editingCategory.name);
      const response = await fetch("/api/product-subcategories", { method: "PUT", body: formData });
      if (!response.ok) {
        const body = await response.json();
        window.alert(body.error ?? "小分類を更新できませんでした。");
        return;
      }
      setSubcategoryMaster((items) =>
        items.map((item) =>
          item.category === editingCategory.currentCategory && item.name === editingCategory.currentName
            ? { ...item, category: editingCategory.category, name: editingCategory.name }
            : item
        )
      );
      setProducts((items) =>
        items.map((item) =>
          item.category === editingCategory.currentCategory && (item.subcategory ?? "未分類") === editingCategory.currentName
            ? { ...item, category: editingCategory.category, subcategory: editingCategory.name }
            : item
        )
      );
    }

    setEditingCategory(null);
  }

  async function deleteCategory(name: string) {
    if (!window.confirm(`${name} を削除しますか？`)) return;
    const response = await fetch("/api/product-categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "大分類を削除できませんでした。");
      return;
    }
    setCategoryMaster((items) => items.filter((item) => item.name !== name));
  }

  async function deleteSubcategory(category: string, name: string) {
    if (!window.confirm(`${category} / ${name} を削除しますか？`)) return;
    const response = await fetch("/api/product-subcategories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, name })
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "小分類を削除できませんでした。");
      return;
    }
    setSubcategoryMaster((items) => items.filter((item) => !(item.category === category && item.name === name)));
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
        <details className="mobile-nav-menu">
          <summary>メニュー</summary>
          <div className="mobile-nav-list">
            {navItems.map(({ label, href }) => (
              <a href={href} key={label}>{label}</a>
            ))}
          </div>
        </details>
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
            <p className="eyebrow">商品データベース</p>
            <h2>商品マスタ</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="商品・分類・仕入れ先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" className="primary-button" onClick={openNewProductEditor}>
              <Plus size={18} />
              商品を追加
            </button>
          </div>
        </header>

        <section className="panel product-category-admin-panel">
          <div className="panel-title">
            <div>
              <h3>分類管理</h3>
              <p>商品マスタで使う大分類と小分類を管理</p>
            </div>
          </div>
          <div className="category-admin-grid">
            <form
              className="management-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void createCategory(new FormData(form)).then(() => form.reset());
              }}
            >
              <label>
                <span>大分類を追加</span>
                <input name="name" placeholder="例: 食材" />
              </label>
              <button className="primary-button" type="submit">追加</button>
            </form>
            <form
              className="management-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void createSubcategory(new FormData(form)).then(() => form.reset());
              }}
            >
              <label>
                <span>大分類</span>
                <select name="category" defaultValue={productCategories[0] ?? ""}>
                  {productCategories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>小分類を追加</span>
                <input name="name" placeholder="例: 新鮮野菜" />
              </label>
              <button className="primary-button" type="submit">追加</button>
            </form>
          </div>
          <div className="category-master-list">
            {productCategories.map((category) => {
              const subcategories = subcategoryMaster.filter((subcategory) => subcategory.category === category);

              return (
                <article className="category-master-row" key={category}>
                  <div className="category-master-heading">
                    <strong>{category}</strong>
                    <div className="row-actions">
                      <button className="text-button" type="button" onClick={() => setEditingCategory({ type: "category", currentName: category, name: category })}>
                        編集
                      </button>
                      <button className="text-button danger-button" type="button" onClick={() => void deleteCategory(category)}>
                        削除
                      </button>
                    </div>
                  </div>
                  <div className="category-chip-list">
                    {subcategories.map((subcategory) => (
                      <span key={`${category}-${subcategory.name}`}>
                        {subcategory.name}
                        <button type="button" onClick={() => setEditingCategory({ type: "subcategory", currentCategory: category, currentName: subcategory.name, category, name: subcategory.name })}>
                          編集
                        </button>
                        <button type="button" onClick={() => void deleteSubcategory(category, subcategory.name)}>
                          削除
                        </button>
                      </span>
                    ))}
                    {subcategories.length === 0 ? <small>小分類未設定</small> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel product-master-page-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>商品マスタ</h3>
              <p>大分類、小分類、商品名、単位、仕入れ先、規格、写真、保管属性を管理</p>
            </div>
            <span className="source-indicator">{filteredProducts.length} 件</span>
          </div>
          <div className="product-filter-stack">
            <div className="product-category-strip" aria-label="大分類">
              {["すべて", ...productCategories].map((category) => (
                <button
                  type="button"
                  className={categoryFilter === category ? "filter-chip is-active" : "filter-chip"}
                  onClick={() => {
                    setCategoryFilter(category);
                    setSubcategoryFilter("すべて");
                  }}
                  key={category}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="product-category-strip" aria-label="小分類">
              {["すべて", ...visibleSubcategories].map((subcategory) => (
                <button
                  type="button"
                  className={subcategoryFilter === subcategory ? "filter-chip is-active" : "filter-chip"}
                  onClick={() => setSubcategoryFilter(subcategory)}
                  key={subcategory}
                >
                  {subcategory}
                </button>
              ))}
            </div>
          </div>
          <div className="product-master-table">
            <div className="product-master-head">
              <span>商品名</span>
              <span>分類</span>
              <span>小分類</span>
              <span>単位</span>
              <span>保管</span>
              <span>参考価格</span>
              <span>操作</span>
            </div>
            {filteredProducts.map((product) => {
              const productIndex = products.findIndex((item) => item.name === product.name);

              return (
                <article className="product-master-row" key={`${product.name}-${productIndex}`}>
                  <div className="product-title-block">
                    <strong>{product.name || "未設定の商品"}</strong>
                    <p>{product.productBrandName || "商品ブランド未設定"}</p>
                  </div>
                  <div className="mobile-product-head">
                    <div className="mobile-product-photo">
                      {product.photoUrl ? (
                        <img src={product.photoUrl} alt={`${product.name} の写真`} />
                      ) : (
                        <span>写真</span>
                      )}
                    </div>
                    <div>
                      <strong>{product.name || "未設定の商品"}</strong>
                      <p>{product.productBrandName || "商品ブランド未設定"}</p>
                      <small>写真・基本情報</small>
                    </div>
                  </div>
                  <span className="product-master-cell" data-label="大分類">{product.category}</span>
                  <span className="product-master-cell" data-label="小分類">{product.subcategory || "未分類"}</span>
                  <span className="product-master-cell" data-label="単位">{product.unit}</span>
                  <span className="product-master-cell" data-label="保管">{product.storageType || "未設定"}</span>
                  <strong className="product-master-cell" data-label="参考価格">¥{product.referencePrice}</strong>
                  <div className="mobile-product-summary" aria-label="商品概要">
                    <span><small>大分類</small><strong>{product.category}</strong></span>
                    <span><small>小分類</small><strong>{product.subcategory || "未分類"}</strong></span>
                    <span><small>単位</small><strong>{product.unit}</strong></span>
                    <span><small>保管</small><strong>{product.storageType || "未設定"}</strong></span>
                    <span><small>参考価格</small><strong>¥{product.referencePrice}</strong></span>
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => setEditTarget({ type: "product", index: productIndex, value: product, originalName: product.name })}
                    >
                      編集
                    </button>
                    <button className="text-button danger-button" onClick={() => deleteProduct(product)}>
                      削除
                    </button>
                  </div>
                  <details className="product-master-detail">
                    <summary>詳細</summary>
                    <div className="product-photo-thumb">
                      {product.photoUrl ? (
                        <img src={product.photoUrl} alt={`${product.name} の写真`} />
                      ) : (
                        <span>写真</span>
                      )}
                    </div>
                    <dl>
                      <div>
                        <dt>用途ブランド</dt>
                        <dd>{product.brand || "共通"}</dd>
                      </div>
                      <div>
                        <dt>メーカー</dt>
                        <dd>{product.manufacturer || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>主要仕入れ先</dt>
                        <dd>{product.mainSupplier || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>予備仕入れ先</dt>
                        <dd>{product.backupSupplier || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>原産地</dt>
                        <dd>{product.originCountries?.length ? product.originCountries.join(" / ") : "未設定"}</dd>
                      </div>
                      <div>
                        <dt>規格</dt>
                        <dd>{product.packageSpec || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>メモ</dt>
                        <dd>{product.specNote || "未設定"}</dd>
                      </div>
                    </dl>
                  </details>
                </article>
              );
            })}
            {filteredProducts.length === 0 ? (
              <div className="empty-state">登録済みの商品はありません</div>
            ) : null}
          </div>
        </section>
      </section>

      {editTarget ? (
        <ProductEditDialog
          target={editTarget}
          suppliers={suppliers}
          brands={brandsData}
          categoryOptions={productCategories}
          subcategoryOptions={subcategoryMaster
            .filter((subcategory) => subcategory.category === editTarget.value.category)
            .map((subcategory) => subcategory.name)}
          onChange={setEditTarget}
          onClose={() => setEditTarget(null)}
          onSave={(target) => void saveProduct(target)}
        />
      ) : null}
      {editingCategory ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="category-edit-title">
          <section className="edit-modal">
            <div className="modal-heading">
              <div>
                <h3 id="category-edit-title">{editingCategory.type === "category" ? "大分類を編集" : "小分類を編集"}</h3>
                <p>{editingCategory.type === "category" ? editingCategory.currentName : `${editingCategory.currentCategory} / ${editingCategory.currentName}`}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingCategory(null)}>閉じる</button>
            </div>
            <div className="edit-fields">
              {editingCategory.type === "subcategory" ? (
                <label>
                  <span>大分類</span>
                  <select
                    value={editingCategory.category}
                    onChange={(event) => setEditingCategory({ ...editingCategory, category: event.target.value })}
                  >
                    {productCategories.map((category) => (
                      <option value={category} key={category}>{category}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>{editingCategory.type === "category" ? "大分類名" : "小分類名"}</span>
                <input
                  value={editingCategory.name}
                  onChange={(event) => setEditingCategory({ ...editingCategory, name: event.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingCategory(null)}>キャンセル</button>
              <button type="button" className="primary-button" onClick={() => void saveCategoryEdit()}>保存</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ProductEditDialog({
  target,
  suppliers,
  brands,
  categoryOptions,
  subcategoryOptions,
  onChange,
  onClose,
  onSave
}: {
  target: ProductEditTarget;
  suppliers: Supplier[];
  brands: typeof import("../../../lib/mock-data").brands;
  categoryOptions: string[];
  subcategoryOptions: string[];
  onChange: (target: ProductEditTarget) => void;
  onClose: () => void;
  onSave: (target: ProductEditTarget) => void;
}) {
  const fields = getProductFields(target.value, suppliers, brands, categoryOptions, subcategoryOptions);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const originOptions = getOriginCountryOptions(target.value.originCountries ?? []);

  async function uploadPhoto(file: File) {
    if (!target.value.name) {
      setUploadStatus("先に商品名を入力してください。");
      return;
    }

    setUploadStatus("アップロード中...");
    const formData = new FormData();
    formData.set("productName", target.value.name);
    formData.set("file", file);

    const response = await fetch("/api/products/photo", {
      method: "POST",
      body: formData
    });
    const body = await response.json();

    if (!response.ok) {
      setUploadStatus(body.error ?? "アップロードできませんでした。");
      return;
    }

    onChange({
      ...target,
      value: {
        ...target.value,
        photoUrl: body.url
      }
    });
    setUploadStatus("アップロード済み");
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-edit-title">
      <form
        className="edit-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(target);
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Product Data</p>
            <h3 id="product-edit-title">{target.value.name ? "商品マスタを編集" : "商品マスタを追加"}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="photo-upload-box">
          <div className="product-photo-preview">
            {target.value.photoUrl ? (
              <img src={target.value.photoUrl} alt={`${target.value.name || "商品"} の写真`} />
            ) : (
              <span>写真</span>
            )}
          </div>
          <div>
            <strong>商品写真</strong>
            <p>写真は Vercel Blob に保存され、商品マスタに URL が記録されます。</p>
            <div className="photo-upload-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPhoto(file);
                }}
              />
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                写真をアップロード
              </button>
              {target.value.photoUrl ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        photoUrl: ""
                      }
                    })
                  }
                >
                  写真URLをクリア
                </button>
              ) : null}
            </div>
            {uploadStatus ? <small>{uploadStatus}</small> : null}
          </div>
        </div>
        <div className="edit-fields">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.options ? (
                <select
                  value={String((target.value as unknown as Record<string, string | number>)[field.key] ?? "")}
                  onChange={(event) =>
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        [field.key]: event.target.value
                      }
                    })
                  }
                >
                  {field.options.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={String((target.value as unknown as Record<string, string | number>)[field.key] ?? "")}
                  type={field.type ?? "text"}
                  onChange={(event) => {
                    const nextValue = field.type === "number" ? Number(event.target.value) : event.target.value;
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        [field.key]: nextValue
                      }
                    });
                  }}
                />
              )}
            </label>
          ))}
          <div className="product-spec-grid">
            <label>
              <span>原産地</span>
              <select
                multiple
                value={target.value.originCountries ?? []}
                onChange={(event) => {
                  const nextCountries = Array.from(event.target.selectedOptions).map((option) => option.value);
                  onChange({
                    ...target,
                    value: {
                      ...target.value,
                      originCountries: nextCountries
                    }
                  });
                }}
              >
                {originOptions.map((option) => (
                  <option value={option} key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              <span>規格</span>
              <input
                value={target.value.packageSpec ?? ""}
                placeholder="例: 1kg入、500g×20袋"
                onChange={(event) =>
                  onChange({
                    ...target,
                    value: {
                      ...target.value,
                      packageSpec: event.target.value
                    }
                  })
                }
              />
            </label>
            <label>
              <span>メモ</span>
              <textarea
                value={target.value.specNote ?? ""}
                placeholder="例: 冷凍庫の位置、代替条件など"
                onChange={(event) =>
                  onChange({
                    ...target,
                    value: {
                      ...target.value,
                      specNote: event.target.value
                    }
                  })
                }
              />
            </label>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="primary-button">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function getProductFields(
  product: ProductWithCategory,
  suppliers: Supplier[],
  brandsData: typeof brands,
  categoryOptions: string[],
  subcategoryOptions: string[]
): Array<{ key: string; label: string; type?: "number"; options?: string[] }> {
  const supplierNames = suppliers.map((supplier) => supplier.name);
  const brandNames = brandsData.map((brand) => brand.name);

  return [
    { key: "name", label: "商品名" },
    { key: "productBrandName", label: "商品ブランド" },
    { key: "manufacturer", label: "メーカー" },
    { key: "category", label: "大分類", options: uniqueOptions([...categoryOptions, product.category]) },
    {
      key: "subcategory",
      label: "小分類",
      options: uniqueOptions([...subcategoryOptions, product.subcategory ?? ""])
    },
    { key: "brand", label: "ブランド", options: uniqueOptions([...brandNames, product.brand]) },
    { key: "unit", label: "単位", options: uniqueOptions(["個", "袋", "箱", "本", "枚", "kg", "g", "L", "ml", "セット", product.unit]) },
    { key: "referencePrice", label: "参考価格", type: "number" },
    { key: "mainSupplier", label: "主要仕入れ先", options: uniqueOptions(["", ...supplierNames, product.mainSupplier]) },
    { key: "backupSupplier", label: "予備仕入れ先", options: uniqueOptions(["", ...supplierNames, product.backupSupplier]) },
    { key: "storageType", label: "保管属性", options: uniqueOptions(["常温", "冷蔵", "冷凍", product.storageType]) },
    { key: "photoUrl", label: "写真URL" }
  ];
}

function getOriginCountryOptions(selectedCountries: string[]) {
  return uniqueOptions([
    "日本",
    "中国",
    "韓国",
    "台湾",
    "ベトナム",
    "タイ",
    "インドネシア",
    "マレーシア",
    "フィリピン",
    "アメリカ",
    "カナダ",
    "オーストラリア",
    "ニュージーランド",
    "ブラジル",
    "チリ",
    "スペイン",
    "イタリア",
    "フランス",
    ...selectedCountries
  ]);
}

function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.filter(Boolean)));
}
