"use client";

import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Info,
  Lightbulb,
  LogOut,
  MenuSquare,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultMaamaaProductionReferenceSettings,
  type MaamaaProductionReferenceSettings,
  type MaamaaProductionRule,
  type MaamaaSeasoningRule,
  type MaamaaSetRule
} from "../../../lib/maamaa-production-rules";
import { normalizeIntegerInput } from "../../../lib/number-input";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type OptionItem = {
  id: string;
  name: string;
};

type StoreOption = OptionItem & {
  brandIds: string[];
};

type MenuCatalogItemOption = OptionItem & {
  brandId: string;
  storeId: string;
  itemKind: string;
  category: string;
  description: string;
  imageUrl: string;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
  sourceName: string;
  sourceUrl: string;
};

type ProductOption = OptionItem & {
  sourceType: "product" | "material";
  category: string;
  subcategory: string;
  unit: string;
  brandScope: string;
  brandIds: string[];
  japaneseNote: string;
  photoUrl: string;
  materialType?: string;
  usageType?: string;
  note?: string;
  isActive?: boolean;
  sortOrder?: number;
};

type ProcedureVariant = {
  variantType: string;
  name: string;
  conditionJson: string;
};

type ProcedureAction = {
  variantType: string;
  conditionJson?: string;
  actionTypeId: string;
  productId: string;
  materialId: string;
  selectedCategory?: string;
  selectedSubcategory?: string;
  locationId: string;
  equipmentId: string;
  equipmentProductId: string;
  containerId: string;
  containerProductId: string;
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
  procedureType: string;
  menuCatalogItemId: string;
  menuCatalogItemName?: string;
  menuItemKind?: string;
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

type SettingKind = "action_types" | "materials" | "locations" | "equipment" | "containers";
type ActionField = "location" | "product" | "quantity" | "equipment" | "container" | "target" | "standard" | "note";
type SettingItem = ActionTypeOption | ProcedureMasterItem | ProductOption;

const emptySettingDraft = {
  name: "",
  actionKey: "",
  label: "",
  sentenceTemplate: "",
  materialType: "utility",
  category: "",
  subcategory: "",
  unit: "",
  note: "",
  sortOrder: "100",
  isActive: true
};

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
  { variantType: "base", name: "共通", conditionJson: "{}" }
];

const optionalVariants: ProcedureVariant[] = [
  { variantType: "dine_in", name: "店内", conditionJson: "{\"service\":\"dine_in\"}" },
  { variantType: "takeout", name: "テイクアウト", conditionJson: "{\"service\":\"takeout\"}" },
  { variantType: "delivery", name: "デリバリー", conditionJson: "{\"service\":\"delivery\"}" },
  { variantType: "size", name: "サイズ差分", conditionJson: "{\"size\":\"R\"}" },
  { variantType: "temperature", name: "温度差分", conditionJson: "{\"temperature\":\"ICE\"}" },
  { variantType: "spice", name: "辛さ差分", conditionJson: "{\"heat\":\"hot\"}" },
  { variantType: "numb", name: "痺れ差分", conditionJson: "{\"numb\":\"numb\"}" }
];

const procedureTypes = [
  { value: "product", label: "商品制作" },
  { value: "buildable_product", label: "組み立て商品" },
  { value: "prep", label: "仕込み" },
  { value: "cleaning", label: "清掃" },
  { value: "opening", label: "開店" },
  { value: "closing", label: "閉店" },
  { value: "equipment", label: "設備操作" },
  { value: "hr_onboarding", label: "入社手続き" },
  { value: "hr_offboarding", label: "退社手続き" }
];

function getProductUsageTypeLabel(value?: string) {
  const labels: Record<string, string> = {
    ingredient: "原材料",
    packaging: "包材・消耗品",
    durable_supply: "備品・消耗工具",
    equipment: "設備",
    other: "その他"
  };
  return labels[value ?? ""] ?? "原材料";
}

const emptyBook: ProcedureBook = {
  title: "",
  category: "商品制作",
  procedureType: "product",
  menuCatalogItemId: "",
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
  materialId: "",
  locationId: "",
  equipmentId: "",
  equipmentProductId: "",
  containerId: "",
  containerProductId: "",
  quantity: "",
  unit: "",
  targetText: "",
  standardText: "",
  note: ""
};

const productionRuleSections: Array<{ value: MaamaaProductionRule["section"]; label: string }> = [
  { value: "noodles", label: "麺の種類" },
  { value: "base", label: "ベーシック" },
  { value: "standard", label: "スタンダード" },
  { value: "premium", label: "プレミアム" },
  { value: "vip", label: "VIP" },
  { value: "request", label: "リクエスト" },
  { value: "operation", label: "オペレーション" }
];

const productionRulePlacements: Array<{ value: MaamaaProductionRule["placement"] | ""; label: string }> = [
  { value: "", label: "未指定" },
  { value: "pot", label: "鍋" },
  { value: "container", label: "容器" },
  { value: "finish", label: "仕上げ" }
];

function normalizeBook(book: ProcedureBook): ProcedureBook {
  return {
    ...emptyBook,
    ...book,
    brandId: book.brandId ?? "",
    procedureType: book.procedureType ?? "product",
    menuCatalogItemId: book.menuCatalogItemId ?? "",
    storeIds: book.stores?.map((store) => store.id) ?? book.storeIds ?? [],
    variants: book.variants?.length ? book.variants.map((variant) => ({
      ...variant,
      conditionJson: typeof variant.conditionJson === "string" ? variant.conditionJson : JSON.stringify(variant.conditionJson ?? {}, null, 2)
    })) : defaultVariants,
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
  const suffix = product.sourceType === "material" ? "手順書素材" : product.japaneseNote;
  return suffix ? `${product.name} / ${suffix}` : product.name;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
}

function canUseProductForBrand(product: ProductOption, brandId: string) {
  if (product.sourceType === "material") return product.isActive !== false;
  if (!brandId) return true;
  if (product.brandScope === "common") return true;
  return Array.isArray(product.brandIds) && product.brandIds.includes(brandId);
}

function getActionItem(action: ProcedureAction, products: ProductOption[]) {
  return products.find((item) => (
    (action.productId && item.sourceType === "product" && item.id === action.productId) ||
    (action.materialId && item.sourceType === "material" && item.id === action.materialId)
  ));
}

function getSelectionValue(item: ProductOption) {
  return `${item.sourceType}:${item.id}`;
}

function getChoiceValue(sourceType: "master" | "product", id: string) {
  return id ? `${sourceType}:${id}` : "";
}

function splitChoiceValue(value: string) {
  const [sourceType, id] = value.split(":");
  return { sourceType, id };
}

function renderActionSentence(action: ProcedureAction, actionTypes: ActionTypeOption[], products: ProductOption[], locations: ProcedureMasterItem[], equipment: ProcedureMasterItem[], containers: ProcedureMasterItem[]) {
  const actionType = actionTypes.find((item) => item.id === action.actionTypeId);
  const product = getActionItem(action, products);
  const location = locations.find((item) => item.id === action.locationId);
  const equipmentItem = equipment.find((item) => item.id === action.equipmentId);
  const equipmentProduct = products.find((item) => item.sourceType === "product" && item.id === action.equipmentProductId);
  const container = containers.find((item) => item.id === action.containerId);
  const containerProduct = products.find((item) => item.sourceType === "product" && item.id === action.containerProductId);
  const quantity = action.quantity ? `${action.quantity}${action.unit}` : "";
  const template = actionType?.sentenceTemplate || "{action} {product} {quantity}";

  return template
    .replaceAll("{action}", actionType?.label ?? "")
    .replaceAll("{product}", product?.name ?? "")
    .replaceAll("{location}", location?.name ?? "")
    .replaceAll("{equipment}", equipmentItem?.name ?? equipmentProduct?.name ?? "")
    .replaceAll("{container}", container?.name ?? containerProduct?.name ?? "")
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

function getItemName(items: ProcedureMasterItem[], id: string) {
  return items.find((item) => item.id === id)?.name ?? "";
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
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<OptionItem[]>([]);
  const [menuCatalogItems, setMenuCatalogItems] = useState<MenuCatalogItemOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [materials, setMaterials] = useState<ProductOption[]>([]);
  const [actionTypes, setActionTypes] = useState<ActionTypeOption[]>([]);
  const [locations, setLocations] = useState<ProcedureMasterItem[]>([]);
  const [equipment, setEquipment] = useState<ProcedureMasterItem[]>([]);
  const [containers, setContainers] = useState<ProcedureMasterItem[]>([]);
  const [editingBook, setEditingBook] = useState<ProcedureBook>(() => cloneBook(emptyBook));
  const [settingKind, setSettingKind] = useState<SettingKind>("action_types");
  const [settingDraft, setSettingDraft] = useState(emptySettingDraft);
  const [editingSettingId, setEditingSettingId] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [maamaaReferenceSettings, setMaamaaReferenceSettings] = useState<MaamaaProductionReferenceSettings>(defaultMaamaaProductionReferenceSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [referenceSaving, setReferenceSaving] = useState(false);
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
      stores?: StoreOption[];
      brands?: OptionItem[];
      menuCatalogItems?: MenuCatalogItemOption[];
      products?: ProductOption[];
      materials?: ProductOption[];
      actionTypes?: ActionTypeOption[];
      locations?: ProcedureMasterItem[];
      equipment?: ProcedureMasterItem[];
      containers?: ProcedureMasterItem[];
      canEdit?: boolean;
    };

    setProcedures((data.procedures ?? []).map(normalizeBook));
    setStores(data.stores ?? []);
    setBrands(data.brands ?? []);
    setMenuCatalogItems(data.menuCatalogItems ?? []);
    setProducts((data.products ?? []).map((product) => ({ ...product, sourceType: "product" as const })));
    setMaterials((data.materials ?? []).map((material) => ({
      ...material,
      sourceType: "material" as const,
      brandScope: "common",
      brandIds: [],
      japaneseNote: material.note ?? "",
      photoUrl: ""
    })));
    setActionTypes(data.actionTypes ?? []);
    setLocations(data.locations ?? []);
    setEquipment(data.equipment ?? []);
    setContainers(data.containers ?? []);
    setCanEdit(Boolean(data.canEdit));
    setLoading(false);
  }

  async function loadMaamaaReferenceSettings() {
    try {
      const response = await fetch("/api/procedures/maamaa-reference", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { settings?: MaamaaProductionReferenceSettings };
      if (data.settings) setMaamaaReferenceSettings(data.settings);
    } catch {
      // Keep the bundled default reference if custom settings cannot be loaded.
    }
  }

  useEffect(() => {
    void loadProcedures();
    void loadMaamaaReferenceSettings();
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
    return [...products, ...materials].filter((product) => canUseProductForBrand(product, editingBook.brandId));
  }, [editingBook.brandId, materials, products]);

  const productCategories = useMemo(() => {
    return uniqueSorted(brandFilteredProducts.map((product) => product.category || "未分類"));
  }, [brandFilteredProducts]);

  const selectedBrandName = brands.find((brand) => brand.id === editingBook.brandId)?.name ?? "";
  const brandFilteredStores = useMemo(() => {
    if (!editingBook.brandId) return [];
    return stores.filter((store) => store.brandIds.includes(editingBook.brandId));
  }, [editingBook.brandId, stores]);
  const brandFilteredMenuCatalogItems = useMemo(() => {
    if (!editingBook.brandId) return [];
    const selectedStoreIds = new Set(editingBook.storeIds);
    return menuCatalogItems.filter((item) => (
      item.brandId === editingBook.brandId &&
      (!item.storeId || !selectedStoreIds.size || selectedStoreIds.has(item.storeId))
    ));
  }, [editingBook.brandId, editingBook.storeIds, menuCatalogItems]);
  const selectedMenuCatalogItem = brandFilteredMenuCatalogItems.find((item) => item.id === editingBook.menuCatalogItemId);

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
        storeIds: [],
        menuCatalogItemId: "",
        menuCatalogItemName: "",
        steps: current.steps.map((step) => ({
          ...step,
          products: step.products.map((product) => product.productId && !nextProductIds.has(product.productId)
            ? { ...product, productId: "", productName: "", selectedCategory: "", selectedSubcategory: "", unit: "" }
            : product),
          actions: step.actions.map((action) => action.productId && !nextProductIds.has(action.productId)
            ? { ...action, productId: "", materialId: "", selectedCategory: "", selectedSubcategory: "", unit: "" }
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

  function getEquipmentProductOptions() {
    return brandFilteredProducts.filter((product) => product.sourceType === "product" && ["durable_supply", "equipment"].includes(product.usageType ?? ""));
  }

  function getContainerProductOptions() {
    return brandFilteredProducts.filter((product) => product.sourceType === "product" && ["packaging", "durable_supply"].includes(product.usageType ?? ""));
  }

  function getActionProductForLink(action: ProcedureAction) {
    return getActionItem(action, [...products, ...materials]);
  }

  function getActionSelectedCategory(action: ProcedureAction) {
    return action.selectedCategory ?? getActionProductForLink(action)?.category ?? "";
  }

  function getActionSelectedSubcategory(action: ProcedureAction) {
    return action.selectedSubcategory ?? getActionProductForLink(action)?.subcategory ?? "";
  }

  function getSettingItems() {
    if (settingKind === "action_types") return actionTypes;
    if (settingKind === "materials") return materials;
    if (settingKind === "locations") return locations;
    if (settingKind === "equipment") return equipment;
    return containers;
  }

  function resetSettingDraft() {
    setEditingSettingId("");
    setSettingDraft(emptySettingDraft);
  }

  function editSetting(item: SettingItem) {
    setEditingSettingId(item.id);
    if ("actionKey" in item) {
      setSettingDraft({
        ...emptySettingDraft,
        actionKey: item.actionKey,
        label: item.label,
        sentenceTemplate: item.sentenceTemplate,
        sortOrder: String(item.sortOrder),
        isActive: item.isActive
      });
      return;
    }

    setSettingDraft({
      ...emptySettingDraft,
      name: item.name,
      materialType: "materialType" in item ? item.materialType ?? "utility" : "utility",
      category: item.category,
      subcategory: "subcategory" in item ? item.subcategory : "",
      unit: "unit" in item ? item.unit : "",
      note: item.note ?? "",
      sortOrder: String(item.sortOrder ?? 100),
      isActive: item.isActive !== false
    });
  }

  async function saveSetting() {
    setMessage("");
    const method = editingSettingId ? "PATCH" : "POST";
    const response = await fetch("/api/procedures/settings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: settingKind, id: editingSettingId, ...settingDraft })
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "設定を保存できませんでした。");
      return;
    }
    resetSettingDraft();
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

  async function saveMaamaaReferenceSettings() {
    setReferenceSaving(true);
    setMessage("");
    const response = await fetch("/api/procedures/maamaa-reference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: maamaaReferenceSettings })
    });
    const data = await response.json().catch(() => ({})) as { error?: string; settings?: MaamaaProductionReferenceSettings };
    if (!response.ok) {
      setMessage(data.error ?? "まぁ麻 早見表を保存できませんでした。");
      setReferenceSaving(false);
      return;
    }
    if (data.settings) setMaamaaReferenceSettings(data.settings);
    setMessage("まぁ麻 早見表を保存しました。");
    setReferenceSaving(false);
  }

  function updateMaamaaProductionRule(index: number, patch: Partial<MaamaaProductionRule>) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      productionRules: current.productionRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)
    }));
  }

  function addMaamaaProductionRule() {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      productionRules: [
        ...current.productionRules,
        { section: "standard", customerName: "", kitchenName: "", placement: "pot" }
      ]
    }));
  }

  function removeMaamaaProductionRule(index: number) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      productionRules: current.productionRules.filter((_, ruleIndex) => ruleIndex !== index)
    }));
  }

  function updateMaamaaSeasoningRule(index: number, patch: Partial<MaamaaSeasoningRule>) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      seasoningRules: current.seasoningRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)
    }));
  }

  function addMaamaaSeasoningRule() {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      seasoningRules: [...current.seasoningRules, { name: "", lines: [""] }]
    }));
  }

  function removeMaamaaSeasoningRule(index: number) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      seasoningRules: current.seasoningRules.filter((_, ruleIndex) => ruleIndex !== index)
    }));
  }

  function updateMaamaaSetRule(index: number, patch: Partial<MaamaaSetRule>) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      setRules: current.setRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)
    }));
  }

  function addMaamaaSetRule() {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      setRules: [...current.setRules, { name: "", defaultItems: [""] }]
    }));
  }

  function removeMaamaaSetRule(index: number) {
    setMaamaaReferenceSettings((current) => ({
      ...current,
      setRules: current.setRules.filter((_, ruleIndex) => ruleIndex !== index)
    }));
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
            <a className="secondary-button" href="/store/procedures">
              <BookOpen size={18} />
              閲覧画面
            </a>
            <button className="secondary-button" type="button" onClick={() => document.getElementById("maamaa-reference-editor")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <BookOpen size={18} />
              まぁ麻早見表編集
            </button>
            <button className="primary-button" type="button" onClick={() => setEditingBook(cloneBook(emptyBook))}>
              <Plus size={18} />
              新規作成
            </button>
          </div>
        </header>

        {message ? <div className="inline-alert">{message}</div> : null}
        {!canEdit && !loading ? <div className="inline-alert is-warning">手順書の編集権限がありません。</div> : null}

        <div className="procedure-helper-actions">
          <details className="procedure-reference-disclosure">
            <summary>
              <Info size={17} />
              商品マスタと手順書素材の関係
            </summary>
            <div className="panel procedure-reference-panel">
              <div className="procedure-reference-grid">
                <article>
                  <strong>商品マスタ</strong>
                  <p>発注・補充する物を管理します。原材料、包材・消耗品、shaker などの備品・消耗工具、設備は商品マスタに登録します。</p>
                </article>
                <article>
                  <strong>手順書素材</strong>
                  <p>氷、冷水、お湯、抽出済み茶など、発注商品ではない物や中間製品を管理します。</p>
                </article>
                <article>
                  <strong>設備 / 工具</strong>
                  <p>手順書設定の工具に加えて、商品マスタの「備品・消耗工具」「設備」も選択できます。</p>
                </article>
                <article>
                  <strong>容器</strong>
                  <p>手順書設定の容器に加えて、商品マスタの「包材・消耗品」「備品・消耗工具」も選択できます。</p>
                </article>
              </div>
            </div>
          </details>

          <details className="procedure-settings-disclosure">
          <summary>
            <SlidersHorizontal size={17} />
            手順書設定
          </summary>
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
                  <select value={settingKind} onChange={(event) => {
                    setSettingKind(event.target.value as SettingKind);
                    resetSettingDraft();
                  }} disabled={!canEdit}>
                    <option value="action_types">動作</option>
                    <option value="materials">手順書素材</option>
                    <option value="locations">位置</option>
                    <option value="equipment">設備・工具</option>
                    <option value="containers">容器</option>
                  </select>
                </label>
                {settingKind === "action_types" ? (
                  <>
                    <label>
                      <span>アクションキー</span>
                      <input value={settingDraft.actionKey} onChange={(event) => setSettingDraft({ ...settingDraft, actionKey: event.target.value })} placeholder="例: pour" disabled={!canEdit || Boolean(editingSettingId)} />
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
                      <input value={settingDraft.name} onChange={(event) => setSettingDraft({ ...settingDraft, name: event.target.value })} placeholder={settingKind === "materials" ? "例: 氷 / 冷水 / 抽出済み紅茶" : "例: 冷蔵庫"} disabled={!canEdit} />
                    </label>
                    {settingKind === "materials" ? (
                      <label>
                        <span>素材区分</span>
                        <select value={settingDraft.materialType} onChange={(event) => setSettingDraft({ ...settingDraft, materialType: event.target.value })} disabled={!canEdit}>
                          <option value="utility">店内素材</option>
                          <option value="intermediate">中間製品</option>
                          <option value="prepared">仕込み品</option>
                        </select>
                      </label>
                    ) : null}
                    <label>
                      <span>分類</span>
                      <input value={settingDraft.category} onChange={(event) => setSettingDraft({ ...settingDraft, category: event.target.value })} placeholder={settingKind === "materials" ? "例: ドリンク素材 / 仕込み" : "例: 保管 / 調理 / テイクアウト"} disabled={!canEdit} />
                    </label>
                    {settingKind === "materials" ? (
                      <>
                        <label>
                          <span>小分類</span>
                          <input value={settingDraft.subcategory} onChange={(event) => setSettingDraft({ ...settingDraft, subcategory: event.target.value })} placeholder="例: 水 / 茶湯 / トッピング" disabled={!canEdit} />
                        </label>
                        <label>
                          <span>標準単位</span>
                          <input value={settingDraft.unit} onChange={(event) => setSettingDraft({ ...settingDraft, unit: event.target.value })} placeholder="g / ml / 個" disabled={!canEdit} />
                        </label>
                      </>
                    ) : null}
                    <label>
                      <span>メモ</span>
                      <input value={settingDraft.note} onChange={(event) => setSettingDraft({ ...settingDraft, note: event.target.value })} disabled={!canEdit} />
                    </label>
                  </>
                )}
                <label>
                  <span>並び順</span>
                  <input value={settingDraft.sortOrder} onChange={(event) => setSettingDraft({ ...settingDraft, sortOrder: normalizeIntegerInput(event.target.value) })} inputMode="numeric" disabled={!canEdit} />
                </label>
                <label className="procedure-setting-toggle">
                  <input type="checkbox" checked={settingDraft.isActive} onChange={(event) => setSettingDraft({ ...settingDraft, isActive: event.target.checked })} disabled={!canEdit} />
                  <span>有効</span>
                </label>
                <div className="procedure-setting-actions">
                  {editingSettingId ? (
                    <button className="secondary-button" type="button" onClick={resetSettingDraft} disabled={!canEdit}>
                      新規追加に戻す
                    </button>
                  ) : null}
                  <button className="primary-button" type="submit" disabled={!canEdit}>
                    <Save size={18} />
                    {editingSettingId ? "設定を更新" : "設定を保存"}
                  </button>
                </div>
              </form>
              <div className="procedure-setting-list">
                {getSettingItems().map((item) => (
                  <article className={`management-row procedure-setting-row${editingSettingId === item.id ? " is-editing" : ""}`} key={item.id}>
                    <div>
                      <strong>{"label" in item ? item.label : item.name}</strong>
                      <p>{"sentenceTemplate" in item ? item.sentenceTemplate : [item.category, item.note].filter(Boolean).join(" / ") || "メモ未設定"}</p>
                      <small>{item.isActive ? "有効" : "停止中"} / {item.sortOrder}</small>
                    </div>
                    <button className="text-button" type="button" onClick={() => editSetting(item)} disabled={!canEdit}>
                      編集
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>
          </details>

          <details className="procedure-settings-disclosure" id="maamaa-reference-editor" open>
            <summary>
              <BookOpen size={17} />
              まぁ麻 制作早見表
            </summary>
            <section className="panel procedure-settings-panel">
              <div className="panel-title">
                <div>
                  <p>店舗閲覧画面に反映</p>
                  <h3>早見表編集</h3>
                </div>
                <button className="primary-button" type="button" onClick={() => void saveMaamaaReferenceSettings()} disabled={!canEdit || referenceSaving}>
                  <Save size={18} />
                  {referenceSaving ? "保存中" : "早見表を保存"}
                </button>
              </div>

              <div className="procedure-reference-editor">
                <section className="procedure-reference-editor-section">
                  <div className="procedure-reference-editor-heading">
                    <h4>具材・麺</h4>
                    <button className="secondary-button" type="button" onClick={addMaamaaProductionRule} disabled={!canEdit}>
                      <Plus size={16} />
                      行を追加
                    </button>
                  </div>
                  <div className="procedure-reference-editor-list">
                    {maamaaReferenceSettings.productionRules.map((rule, index) => (
                      <article className="procedure-reference-editor-row" key={`${rule.id ?? rule.customerName}-${index}`}>
                        <div className="procedure-reference-editor-grid">
                          <label>
                            <span>分類</span>
                            <select value={rule.section} onChange={(event) => updateMaamaaProductionRule(index, { section: event.target.value as MaamaaProductionRule["section"] })} disabled={!canEdit}>
                              {productionRuleSections.map((section) => <option value={section.value} key={section.value}>{section.label}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>メニュー表示名</span>
                            <input value={rule.customerName} onChange={(event) => updateMaamaaProductionRule(index, { customerName: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label>
                            <span>厨房名</span>
                            <input value={rule.kitchenName} onChange={(event) => updateMaamaaProductionRule(index, { kitchenName: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label>
                            <span>分量</span>
                            <input value={rule.quantity ?? ""} onChange={(event) => updateMaamaaProductionRule(index, { quantity: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label>
                            <span>下処理</span>
                            <input value={rule.prep ?? ""} onChange={(event) => updateMaamaaProductionRule(index, { prep: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label>
                            <span>作業</span>
                            <input value={rule.action ?? ""} onChange={(event) => updateMaamaaProductionRule(index, { action: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label>
                            <span>最低加熱分</span>
                            <input value={rule.minimumHeatMinutes ? String(rule.minimumHeatMinutes) : ""} onChange={(event) => updateMaamaaProductionRule(index, { minimumHeatMinutes: Number(event.target.value) || undefined })} inputMode="numeric" disabled={!canEdit} />
                          </label>
                          <label>
                            <span>投入先</span>
                            <select value={rule.placement ?? ""} onChange={(event) => updateMaamaaProductionRule(index, { placement: event.target.value ? event.target.value as MaamaaProductionRule["placement"] : undefined })} disabled={!canEdit}>
                              {productionRulePlacements.map((placement) => <option value={placement.value ?? ""} key={placement.value || "none"}>{placement.label}</option>)}
                            </select>
                          </label>
                          <label className="procedure-reference-editor-wide">
                            <span>メモ</span>
                            <input value={rule.notes ?? ""} onChange={(event) => updateMaamaaProductionRule(index, { notes: event.target.value })} disabled={!canEdit} />
                          </label>
                        </div>
                        <button className="danger-button" type="button" onClick={() => removeMaamaaProductionRule(index)} disabled={!canEdit}>
                          <Trash2 size={14} />
                          削除
                        </button>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="procedure-reference-editor-section">
                  <div className="procedure-reference-editor-heading">
                    <h4>辛さ・味変</h4>
                    <button className="secondary-button" type="button" onClick={addMaamaaSeasoningRule} disabled={!canEdit}>
                      <Plus size={16} />
                      行を追加
                    </button>
                  </div>
                  <div className="procedure-reference-editor-list">
                    {maamaaReferenceSettings.seasoningRules.map((rule, index) => (
                      <article className="procedure-reference-editor-row" key={`${rule.name}-${index}`}>
                        <div className="procedure-reference-editor-grid">
                          <label>
                            <span>名称</span>
                            <input value={rule.name} onChange={(event) => updateMaamaaSeasoningRule(index, { name: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label className="procedure-reference-editor-wide">
                            <span>内容（1行ずつ）</span>
                            <textarea value={rule.lines.join("\n")} onChange={(event) => updateMaamaaSeasoningRule(index, { lines: event.target.value.split("\n") })} disabled={!canEdit} />
                          </label>
                        </div>
                        <button className="danger-button" type="button" onClick={() => removeMaamaaSeasoningRule(index)} disabled={!canEdit}>
                          <Trash2 size={14} />
                          削除
                        </button>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="procedure-reference-editor-section">
                  <div className="procedure-reference-editor-heading">
                    <h4>套餐・操作</h4>
                    <button className="secondary-button" type="button" onClick={addMaamaaSetRule} disabled={!canEdit}>
                      <Plus size={16} />
                      行を追加
                    </button>
                  </div>
                  <div className="procedure-reference-editor-list">
                    {maamaaReferenceSettings.setRules.map((rule, index) => (
                      <article className="procedure-reference-editor-row" key={`${rule.name}-${index}`}>
                        <div className="procedure-reference-editor-grid">
                          <label>
                            <span>名称</span>
                            <input value={rule.name} onChange={(event) => updateMaamaaSetRule(index, { name: event.target.value })} disabled={!canEdit} />
                          </label>
                          <label className="procedure-reference-editor-wide">
                            <span>内容（1行ずつ）</span>
                            <textarea value={rule.defaultItems.join("\n")} onChange={(event) => updateMaamaaSetRule(index, { defaultItems: event.target.value.split("\n") })} disabled={!canEdit} />
                          </label>
                          <label className="procedure-reference-editor-wide">
                            <span>メモ</span>
                            <input value={rule.notes ?? ""} onChange={(event) => updateMaamaaSetRule(index, { notes: event.target.value })} disabled={!canEdit} />
                          </label>
                        </div>
                        <button className="danger-button" type="button" onClick={() => removeMaamaaSetRule(index)} disabled={!canEdit}>
                          <Trash2 size={14} />
                          削除
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          </details>
        </div>

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
                    <p>{procedure.category} / {procedure.brand || "ブランド未設定"} / {procedure.menuCatalogItemName || "メニュー未連携"} / {procedure.stores?.length ? `${procedure.stores.length}店舗` : "全店共通"}</p>
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

          <section className="panel procedure-editor-panel">
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
              <div className="procedure-form-row">
                <label>
                  <span>1. ブランド</span>
                  <select value={editingBook.brandId} onChange={(event) => updateBookBrand(event.target.value)} disabled={!canEdit}>
                    <option value="">ブランドを選択</option>
                    {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>2. 適用店舗</span>
                  <select
                    multiple
                    value={editingBook.storeIds}
                    onChange={(event) => setEditingBook({
                      ...editingBook,
                      storeIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                      menuCatalogItemId: ""
                    })}
                    disabled={!canEdit || !editingBook.brandId}
                  >
                    {brandFilteredStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
                  </select>
                </label>
              </div>
              <small className="form-hint">まずブランドを選びます。店舗を選ばない場合は、そのブランドの全店共通として扱います。</small>

              <div className="procedure-form-row">
                <label>
                  <span>3. 手順タイプ</span>
                  <select value={editingBook.procedureType} onChange={(event) => setEditingBook({
                    ...editingBook,
                    procedureType: event.target.value,
                    category: procedureTypes.find((item) => item.value === event.target.value)?.label ?? editingBook.category,
                    menuCatalogItemId: event.target.value === "product" || event.target.value === "buildable_product" ? editingBook.menuCatalogItemId : ""
                  })} disabled={!canEdit}>
                    {procedureTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>4. メニュー対象</span>
                  <select value={editingBook.menuCatalogItemId} onChange={(event) => {
                    const item = brandFilteredMenuCatalogItems.find((candidate) => candidate.id === event.target.value);
                    setEditingBook({
                      ...editingBook,
                      menuCatalogItemId: event.target.value,
                      title: editingBook.title || item?.name || "",
                      category: item?.category || editingBook.category,
                      procedureType: item?.itemKind === "buildable_product" ? "buildable_product" : editingBook.procedureType
                    });
                  }} disabled={!canEdit || !editingBook.brandId || !["product", "buildable_product"].includes(editingBook.procedureType)}>
                    <option value="">メニューを選択</option>
                    {brandFilteredMenuCatalogItems.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.category ? `${item.category} / ` : ""}{item.name}{item.itemKind === "buildable_product" ? " / 組み立て" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <small className="form-hint">
                メニュー対象はブランドサイトや既存メニューから同期する想定です。nanacha はサイズ・温度、maaamaa は辛さ・痺れなどを差分条件として扱います。
              </small>

              <label>
                <span>手順書名</span>
                <input value={editingBook.title} onChange={(event) => setEditingBook({ ...editingBook, title: event.target.value })} placeholder={selectedMenuCatalogItem?.name || "例: 黒糖タピオカミルク"} disabled={!canEdit} />
              </label>
              <label>
                <span>概要</span>
                <textarea value={editingBook.summary} onChange={(event) => setEditingBook({ ...editingBook, summary: event.target.value })} placeholder="現場で見る短い説明" disabled={!canEdit} />
              </label>
              <div className="procedure-form-row">
                <label>
                  <span>管理分類</span>
                  <input value={editingBook.category} onChange={(event) => setEditingBook({ ...editingBook, category: event.target.value })} placeholder="商品制作 / 仕込み / 清掃" disabled={!canEdit} />
                </label>
                <label>
                  <span>状態</span>
                  <select value={editingBook.status} onChange={(event) => setEditingBook({ ...editingBook, status: event.target.value as ProcedureBook["status"] })} disabled={!canEdit}>
                    <option value="draft">下書き</option>
                    <option value="published">公開中</option>
                  </select>
                </label>
              </div>

              <div className="procedure-variant-editor">
                <div className="procedure-step-editor-head">
                  <div>
                    <strong>差分条件</strong>
                    <p>基本は共通手順だけで始めます。サイズ、温度、辛さ、痺れ、提供形式などで作り方が変わる場合だけ差分を追加します。</p>
                  </div>
                  <div className="procedure-variant-actions">
                    {optionalVariants.filter((variant) => !editingBook.variants.some((item) => item.variantType === variant.variantType)).slice(0, 4).map((variant) => (
                      <button className="text-button" type="button" key={variant.variantType} onClick={() => setEditingBook({ ...editingBook, variants: [...editingBook.variants, variant] })} disabled={!canEdit}>
                        <Plus size={14} />
                        {variant.name}
                      </button>
                    ))}
                  </div>
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
                        disabled={!canEdit || variant.variantType === "base"}
                      />
                      <textarea
                        value={variant.conditionJson}
                        onChange={(event) => setEditingBook({
                          ...editingBook,
                          variants: editingBook.variants.map((item, currentIndex) => currentIndex === variantIndex ? { ...item, conditionJson: event.target.value } : item)
                        })}
                        disabled={!canEdit || variant.variantType === "base"}
                        rows={3}
                        placeholder='{"size":"R","temperature":"ICE"}'
                      />
                      {variant.variantType !== "base" ? (
                        <button className="text-button" type="button" onClick={() => setEditingBook({ ...editingBook, variants: editingBook.variants.filter((_, currentIndex) => currentIndex !== variantIndex) })} disabled={!canEdit}>
                          差分を削除
                        </button>
                      ) : null}
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
                        <input value={step.estimatedMinutes} onChange={(event) => updateStep(stepIndex, { estimatedMinutes: normalizeIntegerInput(event.target.value) })} inputMode="numeric" disabled={!canEdit} />
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
                          <p>位置・商品/素材・数量・設備を作業として保存します。</p>
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
                        const actionSentence = renderActionSentence(action, actionTypes, products, locations, equipment, containers);
                        const selectedProduct = getActionItem(action, [...products, ...materials]);

                        return (
                          <div className="procedure-action-card" key={actionIndex}>
                            <div className="procedure-action-card-head">
                              <div>
                                <strong>作業 {actionIndex + 1}</strong>
                                <p>{actionSentence || "動作を選ぶと、現場向けの一文がここに表示されます。"}</p>
                              </div>
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

                            <div className="procedure-action-summary" aria-label="作業の内容">
                              <span>{editingBook.variants.find((variant) => variant.variantType === action.variantType)?.name ?? "共通"}</span>
                              <span>{actionTypes.find((item) => item.id === action.actionTypeId)?.label || "動作未選択"}</span>
                              {getItemName(locations, action.locationId) ? <span>{getItemName(locations, action.locationId)}</span> : null}
                              {selectedProduct ? <span>{selectedProduct.name}</span> : null}
                              {action.quantity ? <span>{action.quantity}{action.unit}</span> : null}
                            </div>

                            {!actionKey ? <p className="procedure-action-help">まず「何をする」を選びます。選んだ動作に合わせて、必要な入力だけ表示します。</p> : null}

                            <div className="procedure-action-fields">
                              <label>
                                <span>差分条件</span>
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

                              {shouldShowActionField(actionKey, "location") ? (
                                <label>
                                  <span>場所</span>
                                  <select value={action.locationId} onChange={(event) => updateStepAction(stepIndex, actionIndex, { locationId: event.target.value })} disabled={!canEdit}>
                                    <option value="">位置を選択</option>
                                    {locations.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "product") ? (
                                <>
                                  <label>
                                    <span>商品・素材 大分類</span>
                                    <select
                                      value={getActionSelectedCategory(action)}
                                      onChange={(event) => updateStepAction(stepIndex, actionIndex, { selectedCategory: event.target.value, selectedSubcategory: "", productId: "", materialId: "", unit: "" })}
                                      disabled={!canEdit || !brandFilteredProducts.length}
                                    >
                                      <option value="">大分類を選択</option>
                                      {productCategories.map((category) => <option value={category} key={category}>{category}</option>)}
                                    </select>
                                  </label>
                                  <label>
                                    <span>商品・素材 小分類</span>
                                    <select
                                      value={getActionSelectedSubcategory(action)}
                                      onChange={(event) => updateStepAction(stepIndex, actionIndex, { selectedSubcategory: event.target.value, productId: "", materialId: "", unit: "" })}
                                      disabled={!canEdit || !getActionSelectedCategory(action)}
                                    >
                                      <option value="">小分類を選択</option>
                                      {getSubcategoriesForCategory(getActionSelectedCategory(action)).map((subcategory) => <option value={subcategory} key={subcategory}>{subcategory}</option>)}
                                    </select>
                                  </label>
                                  <label className="procedure-action-field-wide">
                                    <span>商品・素材</span>
                                    <select value={selectedProduct ? getSelectionValue(selectedProduct) : ""} onChange={(event) => {
                                      const [sourceType, itemId] = event.target.value.split(":");
                                      const selectedProduct = brandFilteredProducts.find((item) => item.sourceType === sourceType && item.id === itemId);
                                      updateStepAction(stepIndex, actionIndex, {
                                        productId: selectedProduct?.sourceType === "product" ? selectedProduct.id : "",
                                        materialId: selectedProduct?.sourceType === "material" ? selectedProduct.id : "",
                                        selectedCategory: selectedProduct?.category ?? getActionSelectedCategory(action),
                                        selectedSubcategory: selectedProduct?.subcategory ?? getActionSelectedSubcategory(action),
                                        unit: selectedProduct?.unit ?? action.unit
                                      });
                                    }} disabled={!canEdit || !getActionSelectedCategory(action) || !getActionSelectedSubcategory(action)}>
                                      <option value="">商品・素材を選択</option>
                                      {getProductsForSelection(getActionSelectedCategory(action), getActionSelectedSubcategory(action)).map((item) => <option value={getSelectionValue(item)} key={getSelectionValue(item)}>{getProductLabel(item)}</option>)}
                                    </select>
                                  </label>
                                </>
                              ) : null}

                              {shouldShowActionField(actionKey, "quantity") ? (
                                <>
                                  <label>
                                    <span>数量</span>
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
                                  <span>設備 / 工具</span>
                                  <select value={action.equipmentId ? getChoiceValue("master", action.equipmentId) : getChoiceValue("product", action.equipmentProductId)} onChange={(event) => {
                                    const choice = splitChoiceValue(event.target.value);
                                    updateStepAction(stepIndex, actionIndex, {
                                      equipmentId: choice.sourceType === "master" ? choice.id : "",
                                      equipmentProductId: choice.sourceType === "product" ? choice.id : ""
                                    });
                                  }} disabled={!canEdit}>
                                    <option value="">設備・工具を選択</option>
                                    <optgroup label="手順書設定">
                                      {equipment.filter((item) => item.isActive).map((item) => <option value={getChoiceValue("master", item.id)} key={`master-${item.id}`}>{item.name}</option>)}
                                    </optgroup>
                                    <optgroup label="商品マスタ">
                                      {getEquipmentProductOptions().map((item) => <option value={getChoiceValue("product", item.id)} key={`product-${item.id}`}>{item.name} / {getProductUsageTypeLabel(item.usageType)}</option>)}
                                    </optgroup>
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "container") ? (
                                <label>
                                  <span>容器</span>
                                  <select value={action.containerId ? getChoiceValue("master", action.containerId) : getChoiceValue("product", action.containerProductId)} onChange={(event) => {
                                    const choice = splitChoiceValue(event.target.value);
                                    updateStepAction(stepIndex, actionIndex, {
                                      containerId: choice.sourceType === "master" ? choice.id : "",
                                      containerProductId: choice.sourceType === "product" ? choice.id : ""
                                    });
                                  }} disabled={!canEdit}>
                                    <option value="">容器を選択</option>
                                    <optgroup label="手順書設定">
                                      {containers.filter((item) => item.isActive).map((item) => <option value={getChoiceValue("master", item.id)} key={`master-${item.id}`}>{item.name}</option>)}
                                    </optgroup>
                                    <optgroup label="商品マスタ">
                                      {getContainerProductOptions().map((item) => <option value={getChoiceValue("product", item.id)} key={`product-${item.id}`}>{item.name} / {getProductUsageTypeLabel(item.usageType)}</option>)}
                                    </optgroup>
                                  </select>
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "target") ? (
                                <label className="procedure-action-field-wide">
                                  <span>完了条件</span>
                                  <input value={action.targetText} onChange={(event) => updateStepAction(stepIndex, actionIndex, { targetText: event.target.value })} placeholder="例: 10秒 / 規定ラインまで / 透明になるまで" disabled={!canEdit} />
                                </label>
                              ) : null}

                              {shouldShowActionField(actionKey, "standard") ? (
                                <label className="procedure-action-field-wide">
                                  <span>確認基準</span>
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
                          </div>
                        );
                      })}
                      {!step.actions.length ? (
                        <div className="procedure-action-empty">
                          <strong>まだ作業がありません</strong>
                          <p>「アクションを追加」から、現場で行う動作を一つずつ登録します。</p>
                        </div>
                      ) : null}
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

      </section>
    </main>
  );
}
