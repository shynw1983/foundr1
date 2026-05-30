"use client";

import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Lightbulb,
  LinkIcon,
  LogOut,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Save,
  Search,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import { UserBadge } from "../components/UserBadge";

type OptionItem = {
  id: string;
  name: string;
};

type ProductOption = OptionItem & {
  category: string;
  subcategory: string;
  unit: string;
  brandScope: string;
  brandIds: string[];
  japaneseNote: string;
  photoUrl: string;
};

type ProcedureStepProduct = {
  productId: string;
  productName?: string;
  selectedCategory?: string;
  selectedSubcategory?: string;
  quantity: string;
  unit: string;
  note: string;
};

type ProcedureStep = {
  id?: string;
  title: string;
  instruction: string;
  caution: string;
  estimatedMinutes: string;
  mediaUrl: string;
  products: ProcedureStepProduct[];
};

type ProcedureBook = {
  id?: string;
  title: string;
  category: string;
  summary: string;
  status: "draft" | "published";
  brandId: string;
  brand?: string;
  storeIds: string[];
  stores?: OptionItem[];
  steps: ProcedureStep[];
  versionNumber?: number;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "手順書管理", href: "/ops/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "現場記録", href: "/ops/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/ops/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const emptyStep: ProcedureStep = {
  title: "",
  instruction: "",
  caution: "",
  estimatedMinutes: "",
  mediaUrl: "",
  products: []
};

const emptyBook: ProcedureBook = {
  title: "",
  category: "ドリンク",
  summary: "",
  status: "draft",
  brandId: "",
  storeIds: [],
  steps: [{ ...emptyStep, title: "準備", instruction: "" }]
};

function normalizeBook(book: ProcedureBook): ProcedureBook {
  return {
    ...emptyBook,
    ...book,
    brandId: book.brandId ?? "",
    storeIds: book.stores?.map((store) => store.id) ?? book.storeIds ?? [],
    steps: book.steps?.length ? book.steps.map((step) => ({
      ...emptyStep,
      ...step,
      estimatedMinutes: String(step.estimatedMinutes ?? ""),
      products: step.products?.map((product) => ({
        productId: product.productId,
        productName: product.productName,
        selectedCategory: product.selectedCategory,
        selectedSubcategory: product.selectedSubcategory,
        quantity: product.quantity === null || product.quantity === undefined ? "" : String(product.quantity),
        unit: product.unit ?? "",
        note: product.note ?? ""
      })) ?? []
    })) : [{ ...emptyStep }]
  };
}

function cloneBook(book: ProcedureBook): ProcedureBook {
  return JSON.parse(JSON.stringify(book)) as ProcedureBook;
}

function getProductLabel(product: ProductOption) {
  return product.japaneseNote ? `${product.name} / ${product.japaneseNote}` : product.name;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
}

function canUseProductForBrand(product: ProductOption, brandId: string) {
  if (!brandId) return true;
  if (product.brandScope === "common") return true;
  return Array.isArray(product.brandIds) && product.brandIds.includes(brandId);
}

export default function ProcedureAdminPage() {
  const [procedures, setProcedures] = useState<ProcedureBook[]>([]);
  const [stores, setStores] = useState<OptionItem[]>([]);
  const [brands, setBrands] = useState<OptionItem[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [editingBook, setEditingBook] = useState<ProcedureBook>(() => cloneBook(emptyBook));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  async function loadProcedures() {
    setLoading(true);
    const response = await fetch("/api/procedures?mode=admin");
    if (!response.ok) {
      setMessage("手順書を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const data = await response.json() as {
      procedures?: ProcedureBook[];
      stores?: OptionItem[];
      brands?: OptionItem[];
      products?: ProductOption[];
      canEdit?: boolean;
    };

    setProcedures((data.procedures ?? []).map(normalizeBook));
    setStores(data.stores ?? []);
    setBrands(data.brands ?? []);
    setProducts(data.products ?? []);
    setCanEdit(Boolean(data.canEdit));
    setLoading(false);
  }

  useEffect(() => {
    void loadProcedures();
  }, []);

  const filteredProcedures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return procedures;
    return procedures.filter((procedure) => [
      procedure.title,
      procedure.category,
      procedure.summary,
      procedure.brand ?? ""
    ].join(" ").toLowerCase().includes(normalizedQuery));
  }, [procedures, query]);

  const brandFilteredProducts = useMemo(() => {
    return products.filter((product) => canUseProductForBrand(product, editingBook.brandId));
  }, [editingBook.brandId, products]);

  const productCategories = useMemo(() => {
    return uniqueSorted(brandFilteredProducts.map((product) => product.category || "未分類"));
  }, [brandFilteredProducts]);

  const selectedBrandName = brands.find((brand) => brand.id === editingBook.brandId)?.name ?? "";

  function updateStep(index: number, nextStep: Partial<ProcedureStep>) {
    setEditingBook((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...nextStep } : step)
    }));
  }

  function updateStepProduct(stepIndex: number, productIndex: number, nextProduct: Partial<ProcedureStepProduct>) {
    setEditingBook((current) => ({
      ...current,
      steps: current.steps.map((step, currentStepIndex) => currentStepIndex === stepIndex
        ? {
          ...step,
          products: step.products.map((product, currentProductIndex) => currentProductIndex === productIndex ? { ...product, ...nextProduct } : product)
        }
        : step)
    }));
  }

  function updateBookBrand(brandId: string) {
    setEditingBook((current) => {
      const nextProducts = products.filter((product) => canUseProductForBrand(product, brandId));
      const nextProductIds = new Set(nextProducts.map((product) => product.id));

      return {
        ...current,
        brandId,
        steps: current.steps.map((step) => ({
          ...step,
          products: step.products.map((product) => product.productId && !nextProductIds.has(product.productId)
            ? { ...product, productId: "", productName: "", selectedCategory: "", selectedSubcategory: "", unit: "" }
            : product)
        }))
      };
    });
  }

  function getProductForLink(product: ProcedureStepProduct) {
    return products.find((item) => item.id === product.productId);
  }

  function getSelectedCategory(product: ProcedureStepProduct) {
    return product.selectedCategory ?? getProductForLink(product)?.category ?? "";
  }

  function getSelectedSubcategory(product: ProcedureStepProduct) {
    return product.selectedSubcategory ?? getProductForLink(product)?.subcategory ?? "";
  }

  function getSubcategoriesForCategory(category: string) {
    return uniqueSorted(brandFilteredProducts
      .filter((product) => product.category === category)
      .map((product) => product.subcategory || "未分類"));
  }

  function getProductsForSelection(category: string, subcategory: string) {
    return brandFilteredProducts.filter((product) => (
      product.category === category &&
      product.subcategory === subcategory
    ));
  }

  async function saveProcedure() {
    setSaving(true);
    setMessage("");
    const method = editingBook.id ? "PUT" : "POST";
    const response = await fetch("/api/procedures", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingBook)
    });
    const data = await response.json().catch(() => ({})) as { error?: string };

    if (!response.ok) {
      setMessage(data.error ?? "保存できませんでした。");
      setSaving(false);
      return;
    }

    setMessage("手順書を保存しました。");
    setEditingBook(cloneBook(emptyBook));
    await loadProcedures();
    setSaving(false);
  }

  async function deleteProcedure(id?: string) {
    if (!id || !confirm("この手順書を削除しますか。")) return;
    const response = await fetch("/api/procedures", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) {
      setMessage("削除できませんでした。");
      return;
    }
    setMessage("手順書を削除しました。");
    if (editingBook.id === id) setEditingBook(cloneBook(emptyBook));
    await loadProcedures();
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

      <section className="workspace procedures-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">ブランド・店舗の標準作業</p>
            <h2>手順書管理</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/procedures">
              <BookOpen size={18} />
              閲覧画面
            </a>
            <button className="primary-button" type="button" onClick={() => setEditingBook(cloneBook(emptyBook))}>
              <Plus size={18} />
              新規作成
            </button>
          </div>
        </header>

        {message ? <div className="inline-alert">{message}</div> : null}
        {!canEdit && !loading ? <div className="inline-alert is-warning">手順書の編集権限がありません。</div> : null}

        <div className="procedures-admin-grid">
          <section className="panel">
            <div className="panel-title">
              <div>
                <p>公開・下書きを管理</p>
                <h3>手順書一覧</h3>
              </div>
              <label className="search-box procedures-search">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="手順書を検索" />
              </label>
            </div>

            <div className="management-list">
              {filteredProcedures.map((procedure) => (
                <article className="management-row procedure-admin-row" key={procedure.id}>
                  <div>
                    <strong>{procedure.title}</strong>
                    <p>{procedure.category} / {procedure.brand || "ブランド未設定"} / {procedure.stores?.length ? `${procedure.stores.length}店舗` : "全店共通"}</p>
                    <small>{procedure.status === "published" ? "公開中" : "下書き"} / v{procedure.versionNumber ?? 1} / {procedure.steps.length}ステップ</small>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => setEditingBook(normalizeBook(procedure))}>編集</button>
                    <button className="danger-button" type="button" onClick={() => void deleteProcedure(procedure.id)}>
                      <Trash2 size={14} />
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {!filteredProcedures.length ? <p className="empty-state">手順書はまだありません。</p> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <p>{editingBook.id ? "既存手順書を編集" : "新しい手順書を作成"}</p>
                <h3>編集フォーム</h3>
              </div>
            </div>

            <form className="management-form procedure-form" onSubmit={(event) => {
              event.preventDefault();
              void saveProcedure();
            }}>
              <label>
                <span>手順書名</span>
                <input value={editingBook.title} onChange={(event) => setEditingBook({ ...editingBook, title: event.target.value })} placeholder="例: 抹茶ラテ標準手順" disabled={!canEdit} />
              </label>
              <div className="procedure-form-row">
                <label>
                  <span>分類</span>
                  <input value={editingBook.category} onChange={(event) => setEditingBook({ ...editingBook, category: event.target.value })} placeholder="ドリンク / 仕込み / 清掃" disabled={!canEdit} />
                </label>
                <label>
                  <span>状態</span>
                  <select value={editingBook.status} onChange={(event) => setEditingBook({ ...editingBook, status: event.target.value as ProcedureBook["status"] })} disabled={!canEdit}>
                    <option value="draft">下書き</option>
                    <option value="published">公開中</option>
                  </select>
                </label>
              </div>
              <label>
                <span>概要</span>
                <textarea value={editingBook.summary} onChange={(event) => setEditingBook({ ...editingBook, summary: event.target.value })} placeholder="現場で見る短い説明" disabled={!canEdit} />
              </label>
              <div className="procedure-form-row">
                <label>
                  <span>ブランド</span>
                  <select value={editingBook.brandId} onChange={(event) => updateBookBrand(event.target.value)} disabled={!canEdit}>
                    <option value="">ブランド未設定</option>
                    {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>適用店舗</span>
                  <select
                    multiple
                    value={editingBook.storeIds}
                    onChange={(event) => setEditingBook({
                      ...editingBook,
                      storeIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                    })}
                    disabled={!canEdit}
                  >
                    {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
                  </select>
                </label>
              </div>
              <small className="form-hint">適用店舗を選ばない場合は全店共通として扱います。</small>

              <div className="procedure-step-editor-list">
                {editingBook.steps.map((step, stepIndex) => (
                  <section className="procedure-step-editor" key={stepIndex}>
                    <div className="procedure-step-editor-head">
                      <strong>Step {stepIndex + 1}</strong>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setEditingBook({
                          ...editingBook,
                          steps: editingBook.steps.filter((_, currentIndex) => currentIndex !== stepIndex)
                        })}
                        disabled={!canEdit || editingBook.steps.length <= 1}
                      >
                        削除
                      </button>
                    </div>
                    <label>
                      <span>ステップ名</span>
                      <input value={step.title} onChange={(event) => updateStep(stepIndex, { title: event.target.value })} disabled={!canEdit} />
                    </label>
                    <label>
                      <span>作業内容</span>
                      <textarea value={step.instruction} onChange={(event) => updateStep(stepIndex, { instruction: event.target.value })} disabled={!canEdit} />
                    </label>
                    <label>
                      <span>注意事項</span>
                      <textarea value={step.caution} onChange={(event) => updateStep(stepIndex, { caution: event.target.value })} disabled={!canEdit} />
                    </label>
                    <div className="procedure-form-row">
                      <label>
                        <span>目安分数</span>
                        <input value={step.estimatedMinutes} onChange={(event) => updateStep(stepIndex, { estimatedMinutes: event.target.value })} inputMode="numeric" disabled={!canEdit} />
                      </label>
                      <label>
                        <span>画像 / 動画 URL</span>
                        <input value={step.mediaUrl} onChange={(event) => updateStep(stepIndex, { mediaUrl: event.target.value })} placeholder="https://..." disabled={!canEdit} />
                      </label>
                    </div>

                    <div className="procedure-linked-products">
                      <div className="procedure-step-editor-head">
                        <div>
                          <strong>関連商品</strong>
                          <p>{editingBook.brandId ? <><span>{selectedBrandName}</span><span>の商品だけを表示</span></> : "ブランド未設定時は全商品を表示"}</p>
                        </div>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => updateStep(stepIndex, {
                            products: [...step.products, { productId: "", quantity: "", unit: "", note: "" }]
                          })}
                          disabled={!canEdit}
                        >
                          <Plus size={14} />
                          商品を追加
                        </button>
                      </div>
                      {!brandFilteredProducts.length ? <p className="empty-state">選択中のブランドで使用できる商品がありません。</p> : null}
                      {step.products.map((product, productIndex) => (
                        <div className="procedure-product-link-row" key={productIndex}>
                          <select
                            value={getSelectedCategory(product)}
                            onChange={(event) => updateStepProduct(stepIndex, productIndex, {
                              selectedCategory: event.target.value,
                              selectedSubcategory: "",
                              productId: "",
                              productName: "",
                              unit: ""
                            })}
                            disabled={!canEdit || !brandFilteredProducts.length}
                            aria-label="大分類"
                          >
                            <option value="">大分類</option>
                            {productCategories.map((category) => <option value={category} key={category}>{category}</option>)}
                          </select>
                          <select
                            value={getSelectedSubcategory(product)}
                            onChange={(event) => updateStepProduct(stepIndex, productIndex, {
                              selectedSubcategory: event.target.value,
                              productId: "",
                              productName: "",
                              unit: ""
                            })}
                            disabled={!canEdit || !getSelectedCategory(product)}
                            aria-label="小分類"
                          >
                            <option value="">小分類</option>
                            {getSubcategoriesForCategory(getSelectedCategory(product)).map((subcategory) => <option value={subcategory} key={subcategory}>{subcategory}</option>)}
                          </select>
                          <select value={product.productId} onChange={(event) => {
                            const selectedProduct = products.find((item) => item.id === event.target.value);
                            updateStepProduct(stepIndex, productIndex, {
                              productId: event.target.value,
                              productName: selectedProduct?.name ?? "",
                              selectedCategory: selectedProduct?.category ?? getSelectedCategory(product),
                              selectedSubcategory: selectedProduct?.subcategory ?? getSelectedSubcategory(product),
                              unit: selectedProduct?.unit ?? product.unit
                            });
                          }} disabled={!canEdit || !getSelectedCategory(product) || !getSelectedSubcategory(product)}>
                            <option value="">商品を選択</option>
                            {getProductsForSelection(getSelectedCategory(product), getSelectedSubcategory(product)).map((item) => <option value={item.id} key={item.id}>{getProductLabel(item)}</option>)}
                          </select>
                          <input value={product.quantity} onChange={(event) => updateStepProduct(stepIndex, productIndex, { quantity: event.target.value })} placeholder="数量" disabled={!canEdit} />
                          <input value={product.unit} onChange={(event) => updateStepProduct(stepIndex, productIndex, { unit: event.target.value })} placeholder="単位" disabled={!canEdit} />
                          <input value={product.note} onChange={(event) => updateStepProduct(stepIndex, productIndex, { note: event.target.value })} placeholder="使用メモ" disabled={!canEdit} />
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="関連商品を削除"
                            onClick={() => updateStep(stepIndex, {
                              products: step.products.filter((_, currentIndex) => currentIndex !== productIndex)
                            })}
                            disabled={!canEdit}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <div className="procedure-form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setEditingBook({ ...editingBook, steps: [...editingBook.steps, { ...emptyStep }] })}
                  disabled={!canEdit}
                >
                  <Plus size={18} />
                  ステップを追加
                </button>
                <button className="primary-button" type="submit" disabled={!canEdit || saving}>
                  <Save size={18} />
                  {saving ? "保存中" : "保存"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="panel procedure-admin-note">
          <div className="panel-title">
            <div>
              <p>商品総表と連動</p>
              <h3>運用メモ</h3>
            </div>
            <LinkIcon size={19} />
          </div>
          <p>各ステップの関連商品は商品マスタを参照します。商品名や日本語メモをコピーせず、将来の配方、原価、在庫、発注量分析に接続できる形で保存します。</p>
        </section>
      </section>
    </main>
  );
}
