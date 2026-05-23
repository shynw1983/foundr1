"use client";

import { Boxes, ClipboardList, MessageSquareWarning, PackageCheck, Plus, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  brands,
  products as initialProducts,
  suppliers as initialSuppliers
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type Supplier = typeof initialSuppliers[number];
type ProductEditTarget = { type: "product"; index: number; value: Product };

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [brandsData, setBrandsData] = useState(brands);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");
  const [editTarget, setEditTarget] = useState<ProductEditTarget | null>(null);

  useEffect(() => {
    async function loadProductData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        brands?: typeof brands;
        products?: Product[];
        suppliers?: Supplier[];
      };

      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.suppliers) setSuppliers(data.suppliers);
      setDataSource("neon");
    }

    void loadProductData();
  }, []);

  const productCategories = Array.from(new Set(products.map((product) => product.category)));
  const filteredProducts = products.filter((product) => {
    const targetText = [
      product.name,
      product.category,
      product.brand,
      product.unit,
      product.mainSupplier,
      product.backupSupplier,
      product.storageType,
      product.specNote
    ].join(" ");

    return targetText.toLowerCase().includes(query.toLowerCase());
  });

  function saveProduct(target: ProductEditTarget) {
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
        category: productCategories[0] ?? "食材",
        brand: brandsData[0]?.name ?? "共通",
        unit: "個",
        referencePrice: 0,
        mainSupplier: suppliers[0]?.name ?? "",
        backupSupplier: "",
        specNote: "",
        photoUrl: "",
        storageType: "常温"
      }
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
            <p className="eyebrow">商品データベース</p>
            <h2>商品マスタ</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "ローカル表示"}</span>
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

        <section className="panel product-master-page-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>商品マスタ</h3>
              <p>カテゴリ、商品名、単位、仕入れ先、規格、写真、保管属性を管理</p>
            </div>
            <span className="source-indicator">{filteredProducts.length} 件</span>
          </div>
          <div className="product-category-strip" aria-label="商品カテゴリ">
            {productCategories.map((category) => (
              <span key={category}>{category}</span>
            ))}
          </div>
          <div className="product-master-table">
            <div className="product-master-head">
              <span>商品名</span>
              <span>分類</span>
              <span>単位</span>
              <span>保管</span>
              <span>参考価格</span>
              <span>操作</span>
            </div>
            {filteredProducts.map((product) => {
              const productIndex = products.findIndex((item) => item.name === product.name);

              return (
                <article className="product-master-row" key={`${product.name}-${productIndex}`}>
                  <div>
                    <strong>{product.name || "未設定の商品"}</strong>
                    <p>{product.brand}</p>
                  </div>
                  <span>{product.category}</span>
                  <span>{product.unit}</span>
                  <span>{product.storageType || "未設定"}</span>
                  <strong>¥{product.referencePrice}</strong>
                  <button
                    className="text-button"
                    onClick={() => setEditTarget({ type: "product", index: productIndex, value: product })}
                  >
                    編集
                  </button>
                  <div className="product-master-detail">
                    <div className="product-photo-thumb">
                      {product.photoUrl ? (
                        <img src={product.photoUrl} alt={`${product.name} の写真`} />
                      ) : (
                        <span>写真</span>
                      )}
                    </div>
                    <dl>
                      <div>
                        <dt>主要仕入れ先</dt>
                        <dd>{product.mainSupplier || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>予備仕入れ先</dt>
                        <dd>{product.backupSupplier || "未設定"}</dd>
                      </div>
                      <div>
                        <dt>規格</dt>
                        <dd>{product.specNote || "未設定"}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      {editTarget ? (
        <ProductEditDialog
          target={editTarget}
          suppliers={suppliers}
          brands={brandsData}
          onChange={setEditTarget}
          onClose={() => setEditTarget(null)}
          onSave={saveProduct}
        />
      ) : null}
    </main>
  );
}

function ProductEditDialog({
  target,
  suppliers,
  brands,
  onChange,
  onClose,
  onSave
}: {
  target: ProductEditTarget;
  suppliers: Supplier[];
  brands: typeof import("../../../lib/mock-data").brands;
  onChange: (target: ProductEditTarget) => void;
  onClose: () => void;
  onSave: (target: ProductEditTarget) => void;
}) {
  const fields = getProductFields(target.value, suppliers, brands);

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
        <div className="edit-fields">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.options ? (
                <select
                  value={String((target.value as Record<string, string | number>)[field.key] ?? "")}
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
                  value={String((target.value as Record<string, string | number>)[field.key] ?? "")}
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
  product: Product,
  suppliers: Supplier[],
  brandsData: typeof brands
): Array<{ key: string; label: string; type?: "number"; options?: string[] }> {
  const supplierNames = suppliers.map((supplier) => supplier.name);
  const brandNames = brandsData.map((brand) => brand.name);

  return [
    { key: "name", label: "商品名" },
    { key: "category", label: "カテゴリ", options: uniqueOptions(["食材", "包材", "消耗品", "清掃備品", "設備消耗品", product.category]) },
    { key: "brand", label: "ブランド", options: uniqueOptions([...brandNames, "奈奈茶 / 熱辣食堂", product.brand]) },
    { key: "unit", label: "単位", options: uniqueOptions(["個", "袋", "箱", "本", "枚", "kg", "g", "L", "ml", "セット", product.unit]) },
    { key: "referencePrice", label: "参考価格", type: "number" },
    { key: "mainSupplier", label: "主要仕入れ先", options: uniqueOptions(["", ...supplierNames, product.mainSupplier]) },
    { key: "backupSupplier", label: "予備仕入れ先", options: uniqueOptions(["", ...supplierNames, product.backupSupplier]) },
    { key: "storageType", label: "保管属性", options: uniqueOptions(["常温", "冷蔵", "冷凍", product.storageType]) },
    { key: "specNote", label: "規格メモ" },
    { key: "photoUrl", label: "写真URL" }
  ];
}

function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.filter(Boolean)));
}
