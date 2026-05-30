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
import { OsNavList } from "../components/OsNavList";
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

type ProcedureVariant = {
  variantType: string;
  name: string;
};

type ProcedureAction = {
  variantType: string;
  actionTypeId: string;
  productId: string;
  selectedCategory?: string;
  selectedSubcategory?: string;
  locationId: string;
  equipmentId: string;
  containerId: string;
  quantity: string;
  unit: string;
  targetText: string;
  standardText: string;
  note: string;
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
  actions: ProcedureAction[];
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
  variants: ProcedureVariant[];
  steps: ProcedureStep[];
  versionNumber?: number;
};

type ActionTypeOption = {
  id: string;
  actionKey: string;
  label: string;
  sentenceTemplate: string;
  isActive: boolean;
  sortOrder: number;
};

type ProcedureMasterItem = OptionItem & {
  category: string;
  note: string;
  isActive: boolean;
  sortOrder: number;
};

type SettingKind = "action_types" | "locations" | "equipment" | "containers";
type ActionField = "location" | "product" | "quantity" | "equipment" | "container" | "target" | "standard" | "note";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const emptyStep: ProcedureStep = {
  title: "",
  instruction: "",
  caution: "",
  estimatedMinutes: "",
  mediaUrl: "",
  products: [],
  actions: []
};

const defaultVariants: ProcedureVariant[] = [
  { variantType: "base", name: "共通" },
  { variantType: "dine_in", name: "堂食" },
  { variantType: "takeout", name: "外卖" },
  { variantType: "delivery", name: "配送" }
];

const emptyBook: ProcedureBook = {
  title: "",
  category: "ドリンク",
  summary: "",
  status: "draft",
  brandId: "",
  storeIds: [],
  variants: defaultVariants,
  steps: [{ ...emptyStep, title: "準備", instruction: "" }]
};

const emptyAction: ProcedureAction = {
  variantType: "base",
  actionTypeId: "",
  productId: "",
  locationId: "",
  equipmentId: "",
  containerId: "",
  quantity: "",
  unit: "",
  targetText: "",
  standardText: "",
  note: ""
};

function normalizeBook(book: ProcedureBook): ProcedureBook {
  return {
    ...emptyBook,
    ...book,
    brandId: book.brandId ?? "",
    storeIds: book.stores?.map((store) => store.id) ?? book.storeIds ?? [],
    variants: book.variants?.length ? book.variants : defaultVariants,
    steps: book.steps?.length ? book.steps.map((step) => ({
      ...emptyStep,
      ...step,
      estimatedMinutes: String(step.estimatedMinutes ?? ""),
      actions: step.actions?.map((action) => ({
        ...emptyAction,
        ...action,
        quantity: action.quantity === null || action.quantity === undefined ? "" : String(action.quantity)
      })) ?? [],
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

function renderActionSentence(action: ProcedureAction, actionTypes: ActionTypeOption[], products: ProductOption[], locations: ProcedureMasterItem[], equipment: ProcedureMasterItem[], containers: ProcedureMasterItem[]) {
  const actionType = actionTypes.find((item) => item.id === action.actionTypeId);
  const product = products.find((item) => item.id === action.productId);
  const location = locations.find((item) => item.id === action.locationId);
  const equipmentItem = equipment.find((item) => item.id === action.equipmentId);
  const container = containers.find((item) => item.id === action.containerId);
  const quantity = action.quantity ? `${action.quantity}${action.unit}` : "";
  const template = actionType?.sentenceTemplate || "{action} {product} {quantity}";

  return template
    .replaceAll("{action}", actionType?.label ?? "")
    .replaceAll("{product}", product?.name ?? "")
    .replaceAll("{location}", location?.name ?? "")
    .replaceAll("{equipment}", equipmentItem?.name ?? "")
    .replaceAll("{container}", container?.name ?? "")
    .replaceAll("{quantity}", quantity)
    .replaceAll("{unit}", action.unit)
    .replaceAll("{target}", action.targetText)
    .replaceAll("{standard}", action.standardText)
    .replace(/\s+/g, " ")
    .trim();
}

function getActionKey(action: ProcedureAction, actionTypes: ActionTypeOption[]) {
  return actionTypes.find((item) => item.id === action.actionTypeId)?.actionKey ?? "";
}

function shouldShowActionField(actionKey: string, field: ActionField) {
  const visibleFields: Record<string, ActionField[]> = {
    take: ["location", "product", "quantity", "note"],
    measure: ["product", "quantity", "equipment", "note"],
    add: ["product", "quantity", "container", "note"],
    mix: ["equipment", "container", "target", "note"],
    heat: ["equipment", "container", "target", "note"],
    check: ["standard", "note"],
    wash: ["location", "equipment", "standard", "note"],
    cut: ["product", "target", "equipment", "note"],
    discard: ["location", "product", "quantity", "note"],
    serve: ["container", "standard", "note"]
  };

  if (!actionKey) return false;
  return (visibleFields[actionKey] ?? ["location", "product", "quantity", "equipment", "container", "target", "standard", "note"]).includes(field);
}

export default function ProcedureAdminPage() {
  const [procedures, setProcedures] = useState<ProcedureBook[]>([]);
  const [stores, setStores] = useState<OptionItem[]>([]);
  const [brands, setBrands] = useState<OptionItem[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [actionTypes, setActionTypes] = useState<ActionTypeOption[]>([]);
  const [locations, setLocations] = useState<ProcedureMasterItem[]>([]);
  const [equipment, setEquipment] = useState<ProcedureMasterItem[]>([]);
  const [containers, setContainers] = useState<ProcedureMasterItem[]>([]);
  const [editingBook, setEditingBook] = useState<ProcedureBook>(() => cloneBook(emptyBook));
  const [settingKind, setSettingKind] = useState<SettingKind>("action_types");
  const [settingDraft, setSettingDraft] = useState({ name: "", actionKey: "", label: "", sentenceTemplate: "", category: "", note: "", sortOrder: "100", isActive: true });
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
      actionTypes?: ActionTypeOption[];
      locations?: ProcedureMasterItem[];
      equipment?: ProcedureMasterItem[];
      containers?: ProcedureMasterItem[];
      canEdit?: boolean;
    };

    setProcedures((data.procedures ?? []).map(normalizeBook));
    setStores(data.stores ?? []);
    setBrands(data.brands ?? []);
    setProducts(data.products ?? []);
    setActionTypes(data.actionTypes ?? []);
    setLocations(data.locations ?? []);
    setEquipment(data.equipment ?? []);
    setContainers(data.containers ?? []);
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

  function updateStepAction(stepIndex: number, actionIndex: number, nextAction: Partial<ProcedureAction>) {
    setEditingBook((current) => ({
      ...current,
      steps: current.steps.map((step, currentStepIndex) => currentStepIndex === stepIndex
        ? {
          ...step,
          actions: step.actions.map((action, currentActionIndex) => currentActionIndex === actionIndex ? { ...action, ...nextAction } : action)
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
            : product),
          actions: step.actions.map((action) => action.productId && !nextProductIds.has(action.productId)
            ? { ...action, productId: "", selectedCategory: "", selectedSubcategory: "", unit: "" }
            : action)
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

  function getActionProductForLink(action: ProcedureAction) {
    return products.find((item) => item.id === action.productId);
  }

  function getActionSelectedCategory(action: ProcedureAction) {
    return action.selectedCategory ?? getActionProductForLink(action)?.category ?? "";
  }

  function getActionSelectedSubcategory(action: ProcedureAction) {
    return action.selectedSubcategory ?? getActionProductForLink(action)?.subcategory ?? "";
  }

  function getSettingItems() {
    if (settingKind === "action_types") return actionTypes;
    if (settingKind === "locations") return locations;
    if (settingKind === "equipment") return equipment;
    return containers;
  }

  async function saveSetting() {
    setMessage("");
    const response = await fetch("/api/procedures/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: settingKind, ...settingDraft })
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "設定を保存できませんでした。");
      return;
    }
    setSettingDraft({ name: "", actionKey: "", label: "", sentenceTemplate: "", category: "", note: "", sortOrder: "100", isActive: true });
    setMessage("設定を保存しました。");
    await loadProcedures();
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

      <section className="workspace procedures-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">ブランド・店舗の標準作業</p>
            <h2>手順書管理</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/os/procedures/view">
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

        <section className="panel procedure-settings-panel">
          <div className="panel-title">
            <div>
              <p>現場に合わせて変更可能</p>
              <h3>手順書設定</h3>
            </div>
          </div>
          <div className="procedure-settings-grid">
            <form className="management-form procedure-setting-form" onSubmit={(event) => {
              event.preventDefault();
              void saveSetting();
            }}>
              <label>
                <span>設定種別</span>
                <select value={settingKind} onChange={(event) => setSettingKind(event.target.value as SettingKind)} disabled={!canEdit}>
                  <option value="action_types">動作</option>
                  <option value="locations">位置</option>
                  <option value="equipment">設備・工具</option>
                  <option value="containers">容器</option>
                </select>
              </label>
              {settingKind === "action_types" ? (
                <>
                  <label>
                    <span>アクションキー</span>
                    <input value={settingDraft.actionKey} onChange={(event) => setSettingDraft({ ...settingDraft, actionKey: event.target.value })} placeholder="例: pour" disabled={!canEdit} />
                  </label>
                  <label>
                    <span>表示名</span>
                    <input value={settingDraft.label} onChange={(event) => setSettingDraft({ ...settingDraft, label: event.target.value })} placeholder="例: 注ぐ" disabled={!canEdit} />
                  </label>
                  <label>
                    <span>文生成テンプレート</span>
                    <input value={settingDraft.sentenceTemplate} onChange={(event) => setSettingDraft({ ...settingDraft, sentenceTemplate: event.target.value })} placeholder="{container}に{product}{quantity}を入れる" disabled={!canEdit} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>名称</span>
                    <input value={settingDraft.name} onChange={(event) => setSettingDraft({ ...settingDraft, name: event.target.value })} placeholder="例: 冷蔵庫" disabled={!canEdit} />
                  </label>
                  <label>
                    <span>分類</span>
                    <input value={settingDraft.category} onChange={(event) => setSettingDraft({ ...settingDraft, category: event.target.value })} placeholder="例: 保管 / 調理 / 外卖" disabled={!canEdit} />
                  </label>
                  <label>
                    <span>メモ</span>
                    <input value={settingDraft.note} onChange={(event) => setSettingDraft({ ...settingDraft, note: event.target.value })} disabled={!canEdit} />
                  </label>
                </>
              )}
              <label>
                <span>並び順</span>
                <input value={settingDraft.sortOrder} onChange={(event) => setSettingDraft({ ...settingDraft, sortOrder: event.target.value })} inputMode="numeric" disabled={!canEdit} />
              </label>
              <label className="procedure-setting-toggle">
                <input type="checkbox" checked={settingDraft.isActive} onChange={(event) => setSettingDraft({ ...settingDraft, isActive: event.target.checked })} disabled={!canEdit} />
                <span>有効</span>
              </label>
              <button className="primary-button" type="submit" disabled={!canEdit}>
                <Save size={18} />
                設定を保存
              </button>
            </form>
            <div className="procedure-setting-list">
              {getSettingItems().map((item) => (
                <article className="management-row procedure-setting-row" key={item.id}>
                  <div>
                    <strong>{"label" in item ? item.label : item.name}</strong>
                    <p>{"sentenceTemplate" in item ? item.sentenceTemplate : [item.category, item.note].filter(Boolean).join(" / ") || "メモ未設定"}</p>
                    <small>{item.isActive ? "有効" : "停止中"} / {item.sortOrder}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

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

              <div className="procedure-variant-editor">
                <div className="procedure-step-editor-head">
                  <strong>提供形式</strong>
                  <p>共通手順に堂食・外卖などの差分を追加します。</p>
                </div>
                <div className="procedure-variant-grid">
                  {editingBook.variants.map((variant, variantIndex) => (
                    <label key={variant.variantType}>
                      <span>{variant.variantType}</span>
                      <input
                        value={variant.name}
                        onChange={(event) => setEditingBook({
                          ...editingBook,
                          variants: editingBook.variants.map((item, currentIndex) => currentIndex === variantIndex ? { ...item, name: event.target.value } : item)
                        })}
                        disabled={!canEdit}
                      />
                    </label>
                  ))}
                </div>
              </div>

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

                    <div className="procedure-structured-actions">
                      <div className="procedure-step-editor-head">
                        <div>
                          <strong>構造化アクション</strong>
                          <p>位置・商品・数量・設備を指令として保存します。</p>
                        </div>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => updateStep(stepIndex, { actions: [...step.actions, { ...emptyAction }] })}
                          disabled={!canEdit}
                        >
                          <Plus size={14} />
                          アクションを追加
                        </button>
                      </div>
                      {step.actions.map((action, actionIndex) => {
                        const actionKey = getActionKey(action, actionTypes);

                        return (
                          <div className="procedure-action-card" key={actionIndex}>
                            <div className="procedure-action-card-head">
                              <label>
                                <span>提供形式</span>
                                <select value={action.variantType} onChange={(event) => updateStepAction(stepIndex, actionIndex, { variantType: event.target.value })} disabled={!canEdit}>
                                  {editingBook.variants.map((variant) => <option value={variant.variantType} key={variant.variantType}>{variant.name}</option>)}
                                </select>
                              </label>
                              <label>
                                <span>何をする</span>
                                <select value={action.actionTypeId} onChange={(event) => updateStepAction(stepIndex, actionIndex, { actionTypeId: event.target.value })} disabled={!canEdit}>
                                  <option value="">動作を選択</option>
                                  {actionTypes.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                                </select>
                              </label>
                              <button
                                className="icon-button"
                                type="button"
                                aria-label="アクションを削除"
                                onClick={() => updateStep(stepIndex, { actions: step.actions.filter((_, currentIndex) => currentIndex !== actionIndex) })}
                                disabled={!canEdit}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>

                            {!actionKey ? <p className="procedure-action-help">先に動作を選ぶと、必要な入力だけ表示されます。</p> : null}

                            <div className="procedure-action-fields">
                              {shouldShowActionField(actionKey, "location") ? (
                                <label>
                                  <span>どこから / どこで</span>
                                  <select value={action.locationId} onChange={(event) => updateStepAction(stepIndex, actionIndex, { locationId: event.target.value })} disabled={!canEdit}>
                                    <option value="">位置を選択</option>
                                    {locations.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "product") ? (
                                <>
                                  <label>
                                    <span>商品大分類</span>
                                    <select
                                      value={getActionSelectedCategory(action)}
                                      onChange={(event) => updateStepAction(stepIndex, actionIndex, { selectedCategory: event.target.value, selectedSubcategory: "", productId: "", unit: "" })}
                                      disabled={!canEdit || !brandFilteredProducts.length}
                                    >
                                      <option value="">大分類を選択</option>
                                      {productCategories.map((category) => <option value={category} key={category}>{category}</option>)}
                                    </select>
                                  </label>
                                  <label>
                                    <span>商品小分類</span>
                                    <select
                                      value={getActionSelectedSubcategory(action)}
                                      onChange={(event) => updateStepAction(stepIndex, actionIndex, { selectedSubcategory: event.target.value, productId: "", unit: "" })}
                                      disabled={!canEdit || !getActionSelectedCategory(action)}
                                    >
                                      <option value="">小分類を選択</option>
                                      {getSubcategoriesForCategory(getActionSelectedCategory(action)).map((subcategory) => <option value={subcategory} key={subcategory}>{subcategory}</option>)}
                                    </select>
                                  </label>
                                  <label className="procedure-action-field-wide">
                                    <span>何を使う</span>
                                    <select value={action.productId} onChange={(event) => {
                                      const selectedProduct = products.find((item) => item.id === event.target.value);
                                      updateStepAction(stepIndex, actionIndex, {
                                        productId: event.target.value,
                                        selectedCategory: selectedProduct?.category ?? getActionSelectedCategory(action),
                                        selectedSubcategory: selectedProduct?.subcategory ?? getActionSelectedSubcategory(action),
                                        unit: selectedProduct?.unit ?? action.unit
                                      });
                                    }} disabled={!canEdit || !getActionSelectedCategory(action) || !getActionSelectedSubcategory(action)}>
                                      <option value="">商品を選択</option>
                                      {getProductsForSelection(getActionSelectedCategory(action), getActionSelectedSubcategory(action)).map((item) => <option value={item.id} key={item.id}>{getProductLabel(item)}</option>)}
                                    </select>
                                  </label>
                                </>
                              ) : null}

                              {shouldShowActionField(actionKey, "quantity") ? (
                                <>
                                  <label>
                                    <span>どれだけ</span>
                                    <input value={action.quantity} onChange={(event) => updateStepAction(stepIndex, actionIndex, { quantity: event.target.value })} placeholder="例: 180" disabled={!canEdit} />
                                  </label>
                                  <label>
                                    <span>単位</span>
                                    <input value={action.unit} onChange={(event) => updateStepAction(stepIndex, actionIndex, { unit: event.target.value })} placeholder="g / ml / 個" disabled={!canEdit} />
                                  </label>
                                </>
                              ) : null}

                              {shouldShowActionField(actionKey, "equipment") ? (
                                <label>
                                  <span>何を使って</span>
                                  <select value={action.equipmentId} onChange={(event) => updateStepAction(stepIndex, actionIndex, { equipmentId: event.target.value })} disabled={!canEdit}>
                                    <option value="">設備・工具を選択</option>
                                    {equipment.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "container") ? (
                                <label>
                                  <span>どこに / 何で</span>
                                  <select value={action.containerId} onChange={(event) => updateStepAction(stepIndex, actionIndex, { containerId: event.target.value })} disabled={!canEdit}>
                                    <option value="">容器を選択</option>
                                    {containers.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "target") ? (
                                <label className="procedure-action-field-wide">
                                  <span>どうなったら完了</span>
                                  <input value={action.targetText} onChange={(event) => updateStepAction(stepIndex, actionIndex, { targetText: event.target.value })} placeholder="例: 10秒 / 規定ラインまで / 透明になるまで" disabled={!canEdit} />
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "standard") ? (
                                <label className="procedure-action-field-wide">
                                  <span>確認すること</span>
                                  <input value={action.standardText} onChange={(event) => updateStepAction(stepIndex, actionIndex, { standardText: event.target.value })} placeholder="例: 漏れがない / 75℃以上 / ラベル確認" disabled={!canEdit} />
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "note") ? (
                                <label className="procedure-action-field-wide">
                                  <span>補足</span>
                                  <input value={action.note} onChange={(event) => updateStepAction(stepIndex, actionIndex, { note: event.target.value })} placeholder="現場向けメモ" disabled={!canEdit} />
                                </label>
                              ) : null}
                            </div>
                            <p className="procedure-action-preview">{renderActionSentence(action, actionTypes, products, locations, equipment, containers) || "文生成プレビュー"}</p>
                          </div>
                        );
                      })}
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
          <p>各ステップの商品は構造化アクションから商品マスタを参照します。商品名や日本語メモをコピーせず、将来の配方、原価、在庫、発注量分析に接続できる形で保存します。</p>
        </section>
      </section>
    </main>
  );
}
