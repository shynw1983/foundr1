"use client";

import { Ban, Boxes, CheckCircle, ClipboardList, FileText, Lightbulb, Link2, MessageSquareWarning, PackageCheck, Plus, RefreshCw, Search, Store, TrendingUp, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { useCloseOnOutside } from "../components/useCloseOnOutside";
import { ModalHistoryScope, useModalHistory } from "../components/useModalHistory";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  brands,
  products as initialProducts,
  suppliers as initialSuppliers,
  stores as initialStores
} from "../../../lib/mock-data";
import { normalizeDecimalInput } from "../../../lib/number-input";
import { originCountryOptions } from "../../../lib/origin-countries";

type Product = typeof initialProducts[number];
type ProductWithCategory = Product & {
  id?: string;
  subcategory?: string;
  originCountries?: string[];
  packageQuantity?: number | string;
  packageQuantityUnit?: string;
  productFamilyName?: string;
  variantName?: string;
  isDefaultVariant?: boolean;
  variantSortOrder?: number | string;
  productBrandName?: string;
  manufacturer?: string;
  japaneseNote?: string;
  mainPurchaseUrl?: string;
  backupPurchaseUrl?: string;
  usageType?: string;
  isImported?: boolean;
  importOriginCountry?: string;
  importCurrency?: string;
  importOriginalPrice?: number | string;
  importExchangeRate?: number | string;
  importPriceJpy?: number | string;
  importFreightRateOriginalPerKg?: number | string;
  importFreightRateJpyPerKg?: number | string;
  importWeightStrategy?: string;
  importWeightKg?: number | string;
  importFreightCostJpy?: number | string;
  importTaxCostJpy?: number | string;
  importOtherCostJpy?: number | string;
};
type ProductDraft = Omit<ProductWithCategory, "referencePrice"> & { referencePrice: number | string };
type Supplier = typeof initialSuppliers[number];
type StoreItem = typeof initialStores[number];
type ProductEditTarget = { type: "product"; value: ProductDraft; originalName?: string };
type CategoryItem = { name: string; sortOrder?: number };
type SubcategoryItem = { category: string; name: string; sortOrder?: number };
type EditingCategory = { type: "category"; currentName: string; name: string } | { type: "subcategory"; currentCategory: string; currentName: string; category: string; name: string };
type ProductCandidate = {
  id: string;
  rawName: string;
  suggestedName: string;
  category: string;
  subcategory: string;
  unit: string;
  referencePrice: number;
  supplierName: string;
  vendorName: string;
  purchaseDate: string;
  createdLabel: string;
};
type ProductOption = {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  unit: string;
  productFamilyName?: string;
  variantName?: string;
  packageQuantity?: string;
  packageQuantityUnit?: string;
  mainSupplier?: string;
};
type ProductPriceHistoryRecord = {
  id: string;
  price: number;
  unit: string;
  source: string;
  receiptNote: string;
  recordedAt: string;
  purchaseDate: string;
  supplierName: string;
  vendorName: string;
};
type ProductPriceHistoryState = {
  product: ProductWithCategory;
  records: ProductPriceHistoryRecord[];
  isLoading: boolean;
  error: string;
};
type ProductFamilyGroup = {
  id: string;
  familyName: string;
  products: ProductWithCategory[];
  representative: ProductWithCategory;
};
type ProductCandidatesPayload = {
  candidates: ProductCandidate[];
  products: ProductOption[];
};
type ProductSortKey = "name" | "productFamilyName" | "category" | "subcategory" | "unit" | "storageType" | "referencePrice" | "unitPrice";
type SortDirection = "asc" | "desc";
const productUsageTypeOptions = [
  { value: "ingredient", label: "原材料" },
  { value: "packaging", label: "包材・消耗品" },
  { value: "durable_supply", label: "備品・消耗工具" },
  { value: "equipment", label: "設備" },
  { value: "test_product", label: "テスト品" },
  { value: "temporary_purchase", label: "臨時購入品" },
  { value: "other", label: "その他" }
];
const productPageSizeOptions = [20, 50, 100];
const productSortOptions: Array<{ key: ProductSortKey; direction: SortDirection; label: string }> = [
  { key: "category", direction: "asc", label: "分類順" },
  { key: "productFamilyName", direction: "asc", label: "商品順" },
  { key: "name", direction: "asc", label: "商品名 昇順" },
  { key: "name", direction: "desc", label: "商品名 降順" },
  { key: "category", direction: "desc", label: "分類 降順" },
  { key: "subcategory", direction: "asc", label: "小分類 昇順" },
  { key: "subcategory", direction: "desc", label: "小分類 降順" },
  { key: "unit", direction: "asc", label: "単位 昇順" },
  { key: "unit", direction: "desc", label: "単位 降順" },
  { key: "storageType", direction: "asc", label: "保管 昇順" },
  { key: "storageType", direction: "desc", label: "保管 降順" },
  { key: "referencePrice", direction: "asc", label: "参考価格 安い順" },
  { key: "referencePrice", direction: "desc", label: "参考価格 高い順" },
  { key: "unitPrice", direction: "asc", label: "規格単価 安い順" },
  { key: "unitPrice", direction: "desc", label: "規格単価 高い順" }
];
const sortableProductColumns: Array<{ key: ProductSortKey; label: string }> = [
  { key: "name", label: "商品名" },
  { key: "productFamilyName", label: "商品" },
  { key: "category", label: "分類" },
  { key: "subcategory", label: "小分類" },
  { key: "unit", label: "単位" },
  { key: "storageType", label: "保管" },
  { key: "referencePrice", label: "参考価格" },
  { key: "unitPrice", label: "規格単価" }
];
const commonUnitOptions = ["個", "袋", "箱", "本", "枚", "kg", "g", "L", "ml", "セット", "ケース", "パック", "缶", "瓶", "束", "玉", "ロール", "トレー", "カートン"];
const importWeightStrategyOptions = [
  { value: "standard_1kg", label: "標準1kgで計算" },
  { value: "actual_weight", label: "実重量で計算" }
];
const customUnitOption = "__custom_unit__";
const unsetSupplierFilterValue = "__unset_supplier__";
const addSupplierOption = "__add_supplier__";
const missingProductInfoOptions = [
  { value: "すべて", label: "すべて" },
  { value: "receiptIncomplete", label: "情報未補完" },
  { value: "spec", label: "バリエーション未設定" },
  { value: "supplier", label: "発注先未設定" },
  { value: "mainSupplier", label: "メイン発注先未設定" },
  { value: "backupSupplier", label: "予備発注先未設定" }
];
const defaultProductSummaryFields = ["japaneseNote", "productBrandName"];
const productSummaryFieldOptions = [
  { value: "japaneseNote", label: "日本語メモ" },
  { value: "productBrandName", label: "商品ブランド" },
  { value: "manufacturer", label: "メーカー" },
  { value: "category", label: "大分類" },
  { value: "subcategory", label: "小分類" },
  { value: "unit", label: "単位" },
  { value: "productFamilyName", label: "商品" },
  { value: "variantName", label: "バリエーション名" },
  { value: "storageType", label: "保管" },
  { value: "usageType", label: "用途区分" },
  { value: "brand", label: "適用ブランド" },
  { value: "mainSupplier", label: "メイン発注先" },
  { value: "backupSupplier", label: "予備発注先" },
  { value: "referencePrice", label: "参考価格" },
  { value: "unitPrice", label: "規格単価" },
  { value: "importCost", label: "輸入コスト" }
];

function getProductPhotoSrc(photoUrl?: string) {
  if (!photoUrl) return "";
  if (photoUrl.startsWith("/api/products/photo/view")) return photoUrl;

  try {
    const url = new URL(photoUrl);
    if (url.hostname.endsWith(".private.blob.vercel-storage.com")) {
      return `/api/products/photo/view?pathname=${encodeURIComponent(url.pathname.slice(1))}`;
    }
  } catch {
    return photoUrl;
  }

  return photoUrl;
}

function parseReferencePrice(value: number | string) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const normalizedValue = normalizeDecimalInput(value);
  const price = Number(normalizedValue);

  return Number.isFinite(price) ? price : 0;
}

function parsePositiveDraftNumber(value: number | string | undefined, fallback = 0) {
  const normalizedValue = normalizeDecimalInput(String(value ?? ""));
  const numberValue = Number(normalizedValue);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function formatYenAmount(value: number) {
  return value.toLocaleString("ja-JP", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  });
}

function formatForeignAmount(value: number, currency?: string) {
  const normalizedCurrency = currency === "CNY" ? "CNY" : "JPY";
  return new Intl.NumberFormat(normalizedCurrency === "CNY" ? "zh-CN" : "ja-JP", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function formatHistoryPrice(value: number) {
  return `¥${Number(value || 0).toLocaleString("ja-JP", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  })}`;
}

function formatHistoryDate(value: string) {
  if (!value) return "日付未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "日付未設定";
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatPriceRecordSource(source: string) {
  if (source === "receipt_ocr") return "レシート";
  if (source === "purchase_actual") return "購入実績";
  if (source === "manual") return "手入力";
  return source || "記録";
}

function formatPackageQuantity(product: ProductWithCategory) {
  const quantity = Number(product.packageQuantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return "未設定";
  return `${quantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })} ${product.packageQuantityUnit || product.unit || "個"}`;
}

function isBlankValue(value: unknown) {
  return String(value ?? "").trim().length === 0;
}

function hasPackageQuantity(product: ProductWithCategory) {
  const quantity = Number(product.packageQuantity ?? 0);
  return Number.isFinite(quantity) && quantity > 0;
}

function normalizeSpecNumber(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ",");
}

function parseVariantNameForUnitPrice(variantName?: string) {
  const normalizedSpec = normalizeSpecNumber(String(variantName ?? ""));
  if (!normalizedSpec.trim()) return null;

  const matches = Array.from(normalizedSpec.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(kg|キロ|g|グラム|l|L|リットル|ml|mL|ML|個|枚|本|袋|箱|缶|瓶|束|玉|パック|ケース|セット|ロール|トレー|カートン)/g));
  if (matches.length === 0) return null;

  const preferredMatch =
    matches.find((match) => ["kg", "キロ", "g", "グラム"].includes(match[2])) ??
    matches.find((match) => ["l", "L", "リットル", "ml", "mL", "ML"].includes(match[2])) ??
    matches[0];

  const rawQuantity = Number(preferredMatch[1].replace(/,/g, ""));
  const rawUnit = preferredMatch[2];
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return null;

  if (rawUnit === "kg" || rawUnit === "キロ") return { quantity: rawQuantity * 1000, unit: "g" };
  if (rawUnit === "グラム") return { quantity: rawQuantity, unit: "g" };
  if (rawUnit === "l" || rawUnit === "L" || rawUnit === "リットル") return { quantity: rawQuantity * 1000, unit: "ml" };
  if (rawUnit === "mL" || rawUnit === "ML") return { quantity: rawQuantity, unit: "ml" };

  return { quantity: rawQuantity, unit: rawUnit };
}

function getProductUnitPriceValue(product: ProductWithCategory) {
  const price = parseReferencePrice(product.referencePrice);
  const quantity = Number(product.packageQuantity ?? 0);

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const specQuantity = parseVariantNameForUnitPrice(product.variantName);
    if (!specQuantity) return null;

    return price / specQuantity.quantity;
  }

  return price / quantity;
}

function formatProductUnitPrice(product: ProductWithCategory) {
  const unitPrice = getProductUnitPriceValue(product);
  if (unitPrice === null) return "未設定";

  const specQuantity = hasPackageQuantity(product) ? null : parseVariantNameForUnitPrice(product.variantName);
  return `¥${formatYenAmount(unitPrice)} / ${specQuantity?.unit || product.packageQuantityUnit || product.unit || "単位"}`;
}

function getProductSummaryFieldValue(product: ProductWithCategory, field: string, unitPriceLabel: string) {
  if (field === "japaneseNote") return getDisplayJapaneseNote(product);
  if (field === "productBrandName") return product.productBrandName || "";
  if (field === "manufacturer") return product.manufacturer || "";
  if (field === "category") return product.category || "";
  if (field === "subcategory") return product.subcategory || "未分類";
  if (field === "unit") return product.unit || "";
  if (field === "productFamilyName") return getProductFamilyName(product);
  if (field === "variantName") return getProductVariantName(product);
  if (field === "storageType") return product.storageType || "未設定";
  if (field === "usageType") return getProductUsageTypeLabel(product.usageType);
  if (field === "brand") return product.brand || "共通";
  if (field === "mainSupplier") return product.mainSupplier || "未設定";
  if (field === "backupSupplier") return product.backupSupplier || "無";
  if (field === "referencePrice") return `¥${formatYenAmount(parseReferencePrice(product.referencePrice))}`;
  if (field === "unitPrice") return unitPriceLabel;
  if (field === "importCost") return product.isImported ? formatProductImportCost(product) : "";

  return "";
}

function getProductLandedImportCost(product: ProductWithCategory) {
  if (!product.isImported) return 0;

  return (
    parsePositiveDraftNumber(product.importPriceJpy) +
    parsePositiveDraftNumber(product.importFreightCostJpy) +
    parsePositiveDraftNumber(product.importTaxCostJpy) +
    parsePositiveDraftNumber(product.importOtherCostJpy)
  );
}

function formatProductImportCost(product: ProductWithCategory) {
  if (!product.isImported) return "対象外";

  const landedCost = getProductLandedImportCost(product);
  const freightCost = parsePositiveDraftNumber(product.importFreightCostJpy);
  const source = product.importOriginCountry || "中国";
  return `¥${formatYenAmount(landedCost)} / ${source} / 運賃 ¥${formatYenAmount(freightCost)}`;
}

function getProductUsageTypeLabel(value?: string) {
  return productUsageTypeOptions.find((option) => option.value === value)?.label ?? "原材料";
}

function isProductSpecMissing(product: ProductWithCategory) {
  return isBlankValue(product.variantName) && !hasPackageQuantity(product);
}

function isReceiptIncompleteProduct(product: ProductWithCategory) {
  return String(product.japaneseNote ?? "").includes("[情報未補完]");
}

function getDisplayJapaneseNote(product: ProductWithCategory) {
  return String(product.japaneseNote ?? "").replace("[情報未補完]", "").trim();
}

function getProductTitleJapaneseNote(product: ProductWithCategory, title: string) {
  const japaneseNote = getDisplayJapaneseNote(product);
  if (!japaneseNote) return "";

  const normalizedNote = normalizeProductFamilyKey(japaneseNote);
  const normalizedTitle = normalizeProductFamilyKey(title);
  const normalizedProductName = normalizeProductFamilyKey(product.name);
  if (normalizedNote === normalizedTitle || normalizedNote === normalizedProductName) return "";

  return japaneseNote;
}

function hasAnySupplier(product: ProductWithCategory) {
  return !isBlankValue(product.mainSupplier) || !isBlankValue(product.backupSupplier);
}

function getProductDisplaySpec(product: ProductWithCategory) {
  const variantName = String(product.variantName ?? "").trim();
  if (variantName) return variantName;

  const quantitySpec = formatPackageQuantity(product);
  return quantitySpec === "未設定" ? "" : quantitySpec;
}

function getProductFamilyName(product: ProductWithCategory) {
  return String(product.productFamilyName ?? "").trim() || product.name || "未設定";
}

function normalizeProductFamilyKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function getProductVariantName(product: ProductWithCategory) {
  return String(product.variantName ?? "").trim() || getProductDisplaySpec(product) || "単一バリエーション";
}

function formatReceiptProductOptionLabel(product: ProductOption) {
  const familyName = String(product.productFamilyName ?? "").trim();
  const variantName = String(product.variantName ?? "").trim();
  const packageQuantity = String(product.packageQuantity ?? "").trim();
  const packageQuantityUnit = String(product.packageQuantityUnit ?? product.unit ?? "").trim();
  const specLabel = variantName || (packageQuantity ? `${packageQuantity}${packageQuantityUnit ? ` ${packageQuantityUnit}` : ""}` : "");
  const supplierLabel = String(product.mainSupplier ?? "").trim();
  return [
    familyName || product.name,
    specLabel && specLabel !== product.name ? specLabel : "",
    supplierLabel ? `メイン: ${supplierLabel}` : "",
    product.subcategory || product.category
  ].filter(Boolean).join(" / ");
}

function buildProductNameFromVariant(product: Pick<ProductDraft, "productFamilyName" | "variantName">) {
  const familyName = String(product.productFamilyName ?? "").trim();
  const variantName = String(product.variantName ?? "").trim();
  return [familyName, variantName].filter(Boolean).join(" ");
}

function groupProductsForMaster(productList: ProductWithCategory[]) {
  const groups = new Map<string, ProductFamilyGroup>();

  for (const product of productList) {
    const rawFamilyName = String(product.productFamilyName ?? "").trim();
    const normalizedFamilyName = normalizeProductFamilyKey(rawFamilyName);
    const groupId = normalizedFamilyName ? `family:${normalizedFamilyName}` : `product:${getProductIdentity(product)}`;
    const familyName = rawFamilyName || product.name || "未設定の商品";
    const existing = groups.get(groupId);

    if (existing) {
      existing.products.push(product);
    } else {
      groups.set(groupId, {
        id: groupId,
        familyName,
        products: [product],
        representative: product
      });
    }
  }

  return Array.from(groups.values()).map((group) => {
    const products = [...group.products].sort(compareProductVariants);
    return {
      ...group,
      products,
      representative: products.find((product) => product.isDefaultVariant) ?? products[0] ?? group.representative
    };
  });
}

function compareProductVariants(a: ProductWithCategory, b: ProductWithCategory) {
  if (a.isDefaultVariant !== b.isDefaultVariant) return a.isDefaultVariant ? -1 : 1;
  return (
    Number(a.variantSortOrder ?? 0) - Number(b.variantSortOrder ?? 0) ||
    compareText(getProductVariantName(a), getProductVariantName(b)) ||
    compareText(a.name, b.name)
  );
}

function compareText(a: string | undefined, b: string | undefined) {
  return String(a ?? "").localeCompare(String(b ?? ""), "ja", { numeric: true, sensitivity: "base" });
}

function compareProducts(a: ProductWithCategory, b: ProductWithCategory, key: ProductSortKey, direction: SortDirection) {
  const directionMultiplier = direction === "asc" ? 1 : -1;
  let result = 0;

  if (key === "referencePrice") {
    result = Number(a.referencePrice ?? 0) - Number(b.referencePrice ?? 0);
  } else if (key === "unitPrice") {
    result = (getProductUnitPriceValue(a) ?? Number.POSITIVE_INFINITY) - (getProductUnitPriceValue(b) ?? Number.POSITIVE_INFINITY);
  } else if (key === "subcategory") {
    result = compareText(a.subcategory ?? "未分類", b.subcategory ?? "未分類");
  } else if (key === "productFamilyName") {
    result = compareText(getProductFamilyName(a), getProductFamilyName(b)) || Number(a.variantSortOrder ?? 0) - Number(b.variantSortOrder ?? 0);
  } else {
    result = compareText(String(a[key] ?? ""), String(b[key] ?? ""));
  }

  if (result !== 0) return result * directionMultiplier;

  return (
    compareText(a.category, b.category) ||
    compareText(a.subcategory ?? "未分類", b.subcategory ?? "未分類") ||
    compareText(a.name, b.name)
  );
}

function getProductIdentity(product: { id?: string; name: string }) {
  return product.id ?? product.name;
}

function getProductBrands(product: ProductWithCategory) {
  return String(product.brand ?? "未設定")
    .split("/")
    .map((brand) => brand.trim())
    .filter(Boolean);
}

function productMatchesBrand(product: ProductWithCategory, brandName: string) {
  if (brandName === "すべて") return true;
  return getProductBrands(product).includes(brandName);
}

function productMatchesStore(product: ProductWithCategory, store: StoreItem | undefined) {
  if (!store) return true;

  const storeBrands = store.brands ?? [];
  if (storeBrands.length === 0) return true;

  const productBrands = getProductBrands(product);

  return productBrands.includes("共通") || storeBrands.some((brandName) => productBrands.includes(brandName));
}

function productMatchesMissingInfo(product: ProductWithCategory, missingInfoFilter: string) {
  if (missingInfoFilter === "すべて") return true;
  if (missingInfoFilter === "receiptIncomplete") return isReceiptIncompleteProduct(product);
  if (missingInfoFilter === "spec") return isProductSpecMissing(product);
  if (missingInfoFilter === "supplier") return !hasAnySupplier(product);
  if (missingInfoFilter === "mainSupplier") return isBlankValue(product.mainSupplier);
  if (missingInfoFilter === "backupSupplier") return isBlankValue(product.backupSupplier);
  return true;
}

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

export default function ProductsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [returnToOrdersAfterProduct, setReturnToOrdersAfterProduct] = useState(false);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [storesData, setStoresData] = useState<StoreItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [brandsData, setBrandsData] = useState<typeof brands>([]);
  const [categoryMaster, setCategoryMaster] = useState<CategoryItem[]>([]);
  const [subcategoryMaster, setSubcategoryMaster] = useState<SubcategoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("すべて");
  const [brandFilter, setBrandFilter] = useState("すべて");
  const [productBrandFilter, setProductBrandFilter] = useState("すべて");
  const [productFamilyFilter, setProductFamilyFilter] = useState("すべて");
  const [supplierFilter, setSupplierFilter] = useState("すべて");
  const [missingInfoFilter, setMissingInfoFilter] = useState("すべて");
  const [categoryFilter, setCategoryFilter] = useState("すべて");
  const [subcategoryFilter, setSubcategoryFilter] = useState("すべて");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(20);
  const [productSortKey, setProductSortKey] = useState<ProductSortKey>("category");
  const [productSortDirection, setProductSortDirection] = useState<SortDirection>("asc");
  const [productSummaryFields, setProductSummaryFields] = useState(defaultProductSummaryFields);
  const [draftProductSummaryFields, setDraftProductSummaryFields] = useState(defaultProductSummaryFields);
  const [productSummarySaveStatus, setProductSummarySaveStatus] = useState("");
  const [isSavingProductSummaryFields, setIsSavingProductSummaryFields] = useState(false);
  const [isProductSummaryPickerOpen, setIsProductSummaryPickerOpen] = useState(false);
  const [isProductFilterOpen, setIsProductFilterOpen] = useState(false);
  const productSummaryPickerRef = useRef<HTMLDetailsElement | null>(null);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editTarget, setEditTarget] = useState<ProductEditTarget | null>(null);
  const [editingCategory, setEditingCategory] = useState<EditingCategory | null>(null);
  const [isProductCandidatePanelOpen, setIsProductCandidatePanelOpen] = useState(false);
  const [productCandidates, setProductCandidates] = useState<ProductCandidate[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [candidateProductIds, setCandidateProductIds] = useState<Record<string, string>>({});
  const [candidateEdits, setCandidateEdits] = useState<Record<string, Partial<ProductCandidate>>>({});
  const [priceHistory, setPriceHistory] = useState<ProductPriceHistoryState | null>(null);
  const [canManageProducts, setCanManageProducts] = useState(false);

  useCloseOnOutside(productSummaryPickerRef, () => setIsProductSummaryPickerOpen(false), isProductSummaryPickerOpen);

  async function loadProductData() {
    const [response, meResponse] = await Promise.all([
      fetch("/api/dashboard", { cache: "no-store" }),
      fetch("/api/auth/me", { cache: "no-store" })
    ]);

    if (meResponse.ok) {
      const body = await meResponse.json().catch(() => ({})) as {
        employee?: {
          role?: string;
          permissions?: string[];
          uiPreferences?: {
            productMasterSummaryFields?: string[];
          };
        };
      };
      setCanManageProducts(body.employee?.permissions?.includes("products.manage") === true);
      const savedSummaryFields = body.employee?.uiPreferences?.productMasterSummaryFields;
      if (Array.isArray(savedSummaryFields) && savedSummaryFields.length > 0) {
        const validFields = savedSummaryFields.filter((field) =>
          productSummaryFieldOptions.some((option) => option.value === field)
        );
        if (validFields.length > 0) {
          setProductSummaryFields(validFields);
          setDraftProductSummaryFields(validFields);
        }
      }
    }

    if (!response.ok) return;

    const data = await response.json() as {
      brands?: typeof brands;
      stores?: StoreItem[];
      products?: ProductWithCategory[];
      suppliers?: Supplier[];
      productCategories?: CategoryItem[];
      productSubcategories?: SubcategoryItem[];
    };

    if (data.brands) setBrandsData(data.brands);
    if (data.stores) setStoresData(data.stores);
    if (data.products) setProducts(data.products);
    if (data.suppliers) setSuppliers(data.suppliers);
    if (data.productCategories) setCategoryMaster(data.productCategories);
    if (data.productSubcategories) setSubcategoryMaster(data.productSubcategories);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadProductData();
  }, []);

  useEffect(() => {
    if (!canManageProducts) return;
    void loadProductCandidates();
  }, [canManageProducts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shouldCreateFromOrders = params.get("from") === "orders" && params.get("new") === "1";

    setReturnToOrdersAfterProduct(params.get("from") === "orders");
    if (shouldCreateFromOrders && dataSource === "neon" && canManageProducts && !editTarget) {
      openNewProductEditor();
      window.history.replaceState(null, "", "/os/products?from=orders");
    }
  }, [canManageProducts, dataSource, editTarget]);

  const productCategories = categoryMaster.length > 0
    ? categoryMaster.map((category) => category.name)
    : Array.from(new Set(products.map((product) => product.category)));
  const storeOptions = storesData.map((store) => store.name);
  const brandOptions = uniqueOptions([
    "未設定",
    "共通",
    ...brandsData.map((brand) => brand.name),
    ...products.flatMap((product) => getProductBrands(product))
  ]);
  const productBrandOptions = uniqueOptions([
    "未設定",
    ...products.map((product) => product.productBrandName?.trim() || "未設定")
  ]);
  const productFamilyOptions = uniqueOptions([
    "未設定",
    ...products.map((product) => product.productFamilyName?.trim() || "未設定")
  ]);
  const supplierOptions = uniqueOptions([
    ...suppliers.map((supplier) => supplier.name),
    ...products.flatMap((product) => [product.mainSupplier, product.backupSupplier])
  ]);
  const hasUnsetSupplierProducts = products.some((product) => !hasAnySupplier(product));
  const selectedStore = storesData.find((store) => store.name === storeFilter);
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
      product.packageQuantity,
      product.packageQuantityUnit,
      product.productFamilyName,
      product.variantName,
      product.mainSupplier,
      product.backupSupplier,
      product.storageType,
      product.isImported ? "海外輸入 中国 CNY 进口 海外进口" : "",
      product.importOriginCountry,
      product.importCurrency,
      getDisplayJapaneseNote(product),
      product.specNote
    ].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      productMatchesStore(product, selectedStore) &&
      productMatchesBrand(product, brandFilter) &&
      (productBrandFilter === "すべて" || (product.productBrandName?.trim() || "未設定") === productBrandFilter) &&
      (productFamilyFilter === "すべて" || (product.productFamilyName?.trim() || "未設定") === productFamilyFilter) &&
      (
        supplierFilter === "すべて" ||
        (supplierFilter === unsetSupplierFilterValue ? !hasAnySupplier(product) : product.mainSupplier === supplierFilter || product.backupSupplier === supplierFilter)
      ) &&
      productMatchesMissingInfo(product, missingInfoFilter) &&
      (categoryFilter === "すべて" || product.category === categoryFilter) &&
      (subcategoryFilter === "すべて" || (product.subcategory ?? "未分類") === subcategoryFilter)
    );
  });
  const sortedProducts = [...filteredProducts].sort((a, b) => compareProducts(a, b, productSortKey, productSortDirection));
  const productFamilyGroups = groupProductsForMaster(sortedProducts);
  const productPageCount = Math.max(1, Math.ceil(productFamilyGroups.length / productPageSize));
  const currentProductPage = Math.min(productPage, productPageCount);
  const pagedProductGroups = productFamilyGroups.slice(
    (currentProductPage - 1) * productPageSize,
    currentProductPage * productPageSize
  );
  const productSortValue = `${productSortKey}:${productSortDirection}`;

  function updateProductSort(key: ProductSortKey, direction?: SortDirection) {
    setProductSortKey(key);
    setProductSortDirection((currentDirection) =>
      direction ?? (productSortKey === key && currentDirection === "asc" ? "desc" : "asc")
    );
  }

  useEffect(() => {
    setProductPage(1);
  }, [query, storeFilter, brandFilter, productBrandFilter, productFamilyFilter, supplierFilter, missingInfoFilter, categoryFilter, subcategoryFilter, productPageSize, productSortKey, productSortDirection]);

  async function saveProduct(target: ProductEditTarget) {
    const generatedName = buildProductNameFromVariant(target.value) || String(target.value.name ?? "").trim();
    if (!generatedName) {
      window.alert("商品名を入力してください。");
      return;
    }
    const normalizedProduct = {
      ...target.value,
      name: generatedName,
      productFamilyName: String(target.value.productFamilyName ?? "").trim() || generatedName,
      variantName: String(target.value.variantName ?? "").trim()
    };
    const matchingProducts = products.filter((product) =>
      getProductIdentity(product) !== getProductIdentity(normalizedProduct) &&
      product.name.trim() === normalizedProduct.name
    );
    const sameCategoryMatches = matchingProducts.filter((product) =>
      product.category === normalizedProduct.category &&
      (product.subcategory ?? "未分類") === (normalizedProduct.subcategory ?? "未分類")
    );

    if (sameCategoryMatches.length > 0 || matchingProducts.length > 0) {
      const message = sameCategoryMatches.length > 0
        ? "同じ大分類・小分類に同名の商品があります。バリエーション・発注先が違う場合はそのまま保存できます。保存しますか？"
        : "同じ商品名が別分類にあります。分類が正しいか確認してください。保存しますか？";

      if (!window.confirm(message)) return;
    }

    const response = await fetch("/api/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: target.value.id ?? "",
        currentName: target.originalName ?? "",
        ...normalizedProduct,
        referencePrice: parseReferencePrice(normalizedProduct.referencePrice)
      })
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "商品を保存できませんでした。");
      return;
    }

    await loadProductData();
    setEditTarget(null);
    showNotice(returnToOrdersAfterProduct ? "商品を保存しました。発注依頼に戻ると作成中の内容を続けられます。" : "商品を保存しました。");
  }

  async function loadProductCandidates() {
    const response = await fetch("/api/product-candidates", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as ProductCandidatesPayload;
    setProductCandidates(body.candidates);
    setProductOptions(body.products);
    setCandidateEdits(Object.fromEntries(body.candidates.map((candidate) => [candidate.id, {
      suggestedName: candidate.suggestedName,
      category: candidate.category,
      subcategory: candidate.subcategory,
      unit: candidate.unit,
      referencePrice: candidate.referencePrice
    }])));
    if (body.candidates.length > 0) setIsProductCandidatePanelOpen(true);
  }

  async function reviewCandidate(candidate: ProductCandidate, action: "create_product" | "link_product" | "ignore") {
    const edit = candidateEdits[candidate.id] ?? {};
    const productId = candidateProductIds[candidate.id] ?? "";
    if (action === "link_product" && !productId) {
      window.alert("紐付ける既存商品を選択してください。");
      return;
    }

    const response = await fetch("/api/product-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: candidate.id,
        action,
        productId,
        name: edit.suggestedName ?? candidate.suggestedName,
        category: edit.category ?? candidate.category,
        subcategory: edit.subcategory ?? candidate.subcategory,
        unit: edit.unit ?? candidate.unit,
        referencePrice: edit.referencePrice ?? candidate.referencePrice
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "候補を更新できませんでした。");
      return;
    }

    await Promise.all([loadProductData(), loadProductCandidates()]);
    showNotice(action === "create_product" ? "候補から商品を追加しました。" : action === "link_product" ? "候補を既存商品に紐付けました。" : "候補を無視しました。");
  }

  function openNewProductEditor() {
    const defaultCategory = productCategories.includes("食材") ? "食材" : productCategories[0] ?? "食材";

    setEditTarget({
      type: "product",
      value: {
        name: "",
        productBrandName: "",
        manufacturer: "",
        category: defaultCategory,
        subcategory: "未分類",
        brand: "未設定",
        unit: "個",
        referencePrice: 0,
        originCountries: [],
        packageQuantity: "",
        packageQuantityUnit: "個",
        productFamilyName: "",
        variantName: "",
        isDefaultVariant: false,
        variantSortOrder: 0,
        mainSupplier: suppliers[0]?.name ?? "",
        backupSupplier: "",
        mainPurchaseUrl: "",
        backupPurchaseUrl: "",
        specNote: "",
        japaneseNote: "",
        photoUrl: "",
        storageType: "常温",
        usageType: "ingredient",
        isImported: false,
        importOriginCountry: "中国",
        importCurrency: "CNY",
        importOriginalPrice: "",
        importExchangeRate: 1,
        importPriceJpy: "",
        importFreightRateOriginalPerKg: 20,
        importFreightRateJpyPerKg: "",
        importWeightStrategy: "standard_1kg",
        importWeightKg: 1,
        importFreightCostJpy: "",
        importTaxCostJpy: "",
        importOtherCostJpy: ""
      }
    });
  }

  function updateDraftProductSummaryFields(field: string, checked: boolean) {
    const nextFields = checked
      ? [...draftProductSummaryFields, field]
      : draftProductSummaryFields.filter((item) => item !== field);
    const normalizedFields = nextFields.length > 0 ? nextFields.slice(0, 6) : defaultProductSummaryFields;
    setDraftProductSummaryFields(normalizedFields);
    setProductSummarySaveStatus("");
  }

  async function saveProductSummaryFields() {
    setIsSavingProductSummaryFields(true);
    setProductSummarySaveStatus("保存中");

    try {
      const response = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productMasterSummaryFields: draftProductSummaryFields })
      });

      if (!response.ok) {
        setProductSummarySaveStatus("保存できませんでした。");
        return;
      }

      setProductSummaryFields(draftProductSummaryFields);
      setProductSummarySaveStatus("保存しました。");
      window.setTimeout(() => {
        setIsProductSummaryPickerOpen(false);
      }, 450);
    } catch {
      setProductSummarySaveStatus("保存できませんでした。");
    } finally {
      setIsSavingProductSummaryFields(false);
    }
  }

  function copyProductToNewDraft(product: ProductWithCategory) {
    setEditTarget({
      type: "product",
      value: {
        ...product,
        id: undefined,
        photoUrl: ""
      }
    });

    showNotice("商品情報をコピーしました。必要な項目を変更して保存してください。", "info");
  }

  function addVariantToFamily(product: ProductWithCategory) {
    const familyName = getProductFamilyName(product);
    const nextSortOrder = Math.max(0, Number(product.variantSortOrder ?? 0)) + 10;

    setEditTarget({
      type: "product",
      value: {
        ...product,
        id: undefined,
        name: familyName,
        productFamilyName: familyName,
        variantName: "",
        isDefaultVariant: false,
        variantSortOrder: nextSortOrder,
        packageQuantity: "",
        referencePrice: "",
        photoUrl: ""
      }
    });

    showNotice("同じ商品に新しいバリエーションを追加します。バリエーション名、数量、発注先、価格を確認してください。", "info");
  }

  async function openProductPriceHistory(product: ProductWithCategory) {
    if (!product.id) {
      window.alert("保存済みの商品だけ価格履歴を確認できます。");
      return;
    }

    setPriceHistory({ product, records: [], isLoading: true, error: "" });
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/price-history`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { records?: ProductPriceHistoryRecord[]; error?: string };
      if (!response.ok) {
        setPriceHistory({ product, records: [], isLoading: false, error: body.error ?? "価格履歴を読み込めませんでした。" });
        return;
      }
      setPriceHistory({ product, records: body.records ?? [], isLoading: false, error: "" });
    } catch {
      setPriceHistory({ product, records: [], isLoading: false, error: "価格履歴を読み込めませんでした。通信状態を確認してください。" });
    }
  }

  function deleteProduct(product: ProductWithCategory) {
    if (!window.confirm(`${product.name} を削除しますか？`)) return;
    const productIdentity = getProductIdentity(product);

    setProducts((items) => items.filter((item) => getProductIdentity(item) !== productIdentity));

    void fetch("/api/products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: product.id, productName: product.name })
    })
      .then((response) => {
        if (!response.ok) {
          setProducts((items) => (items.some((item) => getProductIdentity(item) === productIdentity) ? items : [...items, product]));
          return response.json().then((body) => {
            window.alert(body.error ?? "商品を削除できませんでした。");
          });
        }

        showNotice("商品を削除しました。");
        return null;
      })
      .catch(() => {
        setProducts((items) => (items.some((item) => getProductIdentity(item) === productIdentity) ? items : [...items, product]));
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
    showNotice("大分類を追加しました。");
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
    showNotice("小分類を追加しました。");
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
    showNotice("分類を更新しました。");
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
    showNotice("大分類を削除しました。");
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
    showNotice("小分類を削除しました。");
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
            <p className="eyebrow">商品データベース</p>
            <h2>商品マスタ</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            {returnToOrdersAfterProduct ? (
              <a className="secondary-button" href="/os/orders#create-order-panel">
                発注依頼に戻る
              </a>
            ) : null}
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="商品・分類・発注先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {canManageProducts ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setIsProductCandidatePanelOpen((current) => !current);
                    void loadProductCandidates();
                  }}
                >
                  <RefreshCw size={18} />
                  レシート候補{productCandidates.length ? ` ${productCandidates.length}` : ""}
                </button>
                <button type="button" className="primary-button" onClick={openNewProductEditor}>
                  <Plus size={18} />
                  商品を追加
                </button>
              </>
            ) : null}
          </div>
        </header>

        {canManageProducts && isProductCandidatePanelOpen ? (
          <section className="panel product-master-page-panel">
            <div className="panel-title product-master-title">
              <div>
                <h3>レシート候補から補登</h3>
                <p>購入管理でアップロードしたレシート明細から、商品マスタ未登録の候補だけを確認します。経費レシートはここには入りません。</p>
              </div>
              <span className="source-indicator">{productCandidates.length} 件</span>
            </div>
            <div className="product-candidate-list">
              {productCandidates.map((candidate) => {
                const edit = candidateEdits[candidate.id] ?? {};
                return (
                  <article className="product-candidate-row" key={candidate.id}>
                    <div className="product-candidate-source">
                      <span>{candidate.supplierName || candidate.vendorName || "発注先未読取"}</span>
                      <strong>{candidate.rawName}</strong>
                      <p>{candidate.purchaseDate || candidate.createdLabel}</p>
                    </div>
                    <div className="product-candidate-fields">
                      <input
                        aria-label="商品名"
                        value={String(edit.suggestedName ?? candidate.suggestedName)}
                        onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], suggestedName: event.target.value } }))}
                      />
                      <input
                        aria-label="分類"
                        value={String(edit.category ?? candidate.category)}
                        onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], category: event.target.value } }))}
                      />
                      <input
                        aria-label="単位"
                        value={String(edit.unit ?? candidate.unit)}
                        onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], unit: event.target.value } }))}
                      />
                      <input
                        aria-label="参考価格"
                        type="number"
                        min="0"
                        step="1"
                        value={Number(edit.referencePrice ?? candidate.referencePrice)}
                        onChange={(event) => setCandidateEdits((current) => ({ ...current, [candidate.id]: { ...current[candidate.id], referencePrice: Number(event.target.value) } }))}
                      />
                    </div>
                    <div className="product-candidate-link">
                      <select value={candidateProductIds[candidate.id] ?? ""} onChange={(event) => setCandidateProductIds((current) => ({ ...current, [candidate.id]: event.target.value }))}>
                        <option value="">既存商品を選択</option>
                        {productOptions.map((product) => (
                          <option value={product.id} key={product.id}>{formatReceiptProductOptionLabel(product)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="product-candidate-actions">
                      <button className="secondary-button" type="button" onClick={() => void reviewCandidate(candidate, "link_product")}><Link2 size={15} />紐付け</button>
                      <button className="primary-button" type="button" onClick={() => void reviewCandidate(candidate, "create_product")}><CheckCircle size={15} />新規追加</button>
                      <button className="text-button" type="button" onClick={() => void reviewCandidate(candidate, "ignore")}><Ban size={15} />無視</button>
                    </div>
                  </article>
                );
              })}
              {!productCandidates.length ? <p className="empty-state-text">購入レシート由来の未登録商品候補はありません。</p> : null}
            </div>
          </section>
        ) : null}

        <section className="panel product-master-page-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>商品マスタ</h3>
              <p>大分類、小分類、商品、単位、発注先、バリエーション、写真、保管属性を管理</p>
            </div>
            <div className="product-list-controls">
              <label>
                <span>並び順</span>
                <select
                  value={productSortValue}
                  onChange={(event) => {
                    const [nextKey, nextDirection] = event.target.value.split(":") as [ProductSortKey, SortDirection];
                    updateProductSort(nextKey, nextDirection);
                  }}
                >
                  {productSortOptions.map((option) => (
                    <option value={`${option.key}:${option.direction}`} key={`${option.key}-${option.direction}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>表示件数</span>
                <select value={productPageSize} onChange={(event) => setProductPageSize(Number(event.target.value))}>
                  {productPageSizeOptions.map((size) => (
                    <option value={size} key={size}>{size} 件</option>
                  ))}
                </select>
              </label>
              <span className="source-indicator">{productFamilyGroups.length} 商品 / {filteredProducts.length} バリエーション</span>
              <details
                className="product-summary-picker"
                open={isProductSummaryPickerOpen}
                onToggle={(event) => setIsProductSummaryPickerOpen(event.currentTarget.open)}
                ref={productSummaryPickerRef}
              >
                <summary>基本情報表示</summary>
                <div>
                  {productSummaryFieldOptions.map((option) => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        checked={draftProductSummaryFields.includes(option.value)}
                        onChange={(event) => updateDraftProductSummaryFields(option.value, event.target.checked)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  <div className="product-summary-picker-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={isSavingProductSummaryFields}
                      onClick={() => void saveProductSummaryFields()}
                    >
                      {isSavingProductSummaryFields ? "保存中" : "保存"}
                    </button>
                    {productSummarySaveStatus ? <small>{productSummarySaveStatus}</small> : null}
                  </div>
                </div>
              </details>
            </div>
          </div>
          <button
            type="button"
            className="product-filter-toggle"
            onClick={() => setIsProductFilterOpen((current) => !current)}
          >
            {isProductFilterOpen ? "絞り込みを閉じる" : "絞り込み"}
          </button>
          <div className={isProductFilterOpen ? "product-filter-stack is-open" : "product-filter-stack"}>
            <div className="product-structured-filters" aria-label="商品マスタ詳細フィルター">
              <label>
                <span>対象店舗</span>
                <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
                  <option value="すべて">すべて</option>
                  {storeOptions.map((storeName) => (
                    <option value={storeName} key={storeName}>{storeName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>適用ブランド</span>
                <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                  <option value="すべて">すべて</option>
                  {brandOptions.map((brandName) => (
                    <option value={brandName} key={brandName}>{brandName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>商品ブランド</span>
                <select value={productBrandFilter} onChange={(event) => setProductBrandFilter(event.target.value)}>
                  <option value="すべて">すべて</option>
                  {productBrandOptions.map((brandName) => (
                    <option value={brandName} key={brandName}>{brandName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>商品</span>
                <select value={productFamilyFilter} onChange={(event) => setProductFamilyFilter(event.target.value)}>
                  <option value="すべて">すべて</option>
                  {productFamilyOptions.map((familyName) => (
                    <option value={familyName} key={familyName}>{familyName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>発注先</span>
                <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
                  <option value="すべて">すべて</option>
                  {hasUnsetSupplierProducts ? <option value={unsetSupplierFilterValue}>未設定</option> : null}
                  {supplierOptions.map((supplierName) => (
                    <option value={supplierName} key={supplierName}>{supplierName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>未入力項目</span>
                <select value={missingInfoFilter} onChange={(event) => setMissingInfoFilter(event.target.value)}>
                  {missingProductInfoOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
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
              <span>商品</span>
              <span>バリエーション</span>
              <span>{canManageProducts ? "操作" : "権限"}</span>
            </div>
            {pagedProductGroups.map((group) => {
              const representative = group.representative;
              const photoProduct = group.products.find((product) => product.photoUrl) ?? representative;
              const titleJapaneseNote = getProductTitleJapaneseNote(representative, group.familyName);
              const groupSummaryItems = productSummaryFields
                .filter((field) => !(field === "japaneseNote" && titleJapaneseNote))
                .map((field) => {
                  const option = productSummaryFieldOptions.find((item) => item.value === field);
                  const value = getProductSummaryFieldValue(representative, field, formatProductUnitPrice(representative));
                  return option && value ? { label: option.label, value } : null;
                })
                .filter(Boolean) as Array<{ label: string; value: string }>;

              return (
                <article className="product-family-card" key={group.id}>
                  <div className="product-family-card-head">
                    <div className="product-family-identity">
                      <div className="product-family-photo">
                        {photoProduct.photoUrl ? (
                          <img src={getProductPhotoSrc(photoProduct.photoUrl)} alt={`${group.familyName} の写真`} />
                        ) : (
                          <span>写真</span>
                        )}
                      </div>
                      <div className="product-family-copy">
                        <small>商品</small>
                        <div className="product-family-name-line">
                          <strong>
                            {group.familyName}
                            {titleJapaneseNote ? <em className="product-family-title-note">（{titleJapaneseNote}）</em> : null}
                          </strong>
                          <span>{group.products.length} バリエーション</span>
                          {representative.isDefaultVariant ? <span className="status-pill">標準バリエーションあり</span> : null}
                        </div>
                        <p>{representative.category} / {representative.subcategory ?? "未分類"} / {representative.brand || "共通"}</p>
                      </div>
                    </div>
                    <div className="product-master-info-grid" aria-label="商品情報">
                      {groupSummaryItems.slice(0, 4).map((item) => (
                        <span key={`${group.id}-summary-${item.label}`}>
                          <small>{item.label}</small>
                          <strong>{item.value}</strong>
                        </span>
                      ))}
                    </div>
                    <div className="row-actions">
                      {canManageProducts ? (
                        <button className="secondary-button" type="button" onClick={() => addVariantToFamily(representative)}>
                          <Plus size={15} />
                          バリエーションを追加
                        </button>
                      ) : (
                        <span className="product-readonly-badge">閲覧のみ</span>
                      )}
                    </div>
                  </div>
                  <details className="product-family-variants">
                    <summary>
                      <span>{group.products.length} バリエーション</span>
                    </summary>
                    <div className="product-variant-list">
                      {group.products.map((product) => {
                        const displaySpec = getProductDisplaySpec(product);
                        const unitPriceLabel = formatProductUnitPrice(product);
                        const summaryItems = productSummaryFields
                          .map((field) => {
                            const option = productSummaryFieldOptions.find((item) => item.value === field);
                            const value = getProductSummaryFieldValue(product, field, unitPriceLabel);
                            return option && value ? { label: option.label, value } : null;
                          })
                          .filter(Boolean) as Array<{ label: string; value: string }>;
                        const shownSummaryLabels = new Set(summaryItems.slice(0, 6).map((item) => item.label));

                        return (
                          <article className="product-variant-row" key={getProductIdentity(product)}>
                            <div className="product-variant-identity">
                              <div className="product-variant-photo">
                                {product.photoUrl ? (
                                  <img src={getProductPhotoSrc(product.photoUrl)} alt={`${product.name} の写真`} />
                                ) : (
                                  <span>写真</span>
                                )}
                              </div>
                              <div className="product-variant-title">
                                <strong>{displaySpec || product.name || "単一バリエーション"}</strong>
                                <span>{product.name || "未設定の商品"}</span>
                                <div className="product-variant-badges">
                                  {product.isDefaultVariant ? <span className="status-pill">標準バリエーション</span> : null}
                                  {product.isImported ? <span className="status-pill is-watch">海外輸入</span> : null}
                                  {isReceiptIncompleteProduct(product) ? <span className="status-pill is-warning">情報未補完</span> : null}
                                </div>
                              </div>
                            </div>
                            <div className="product-master-info-grid" aria-label="バリエーション情報">
                              {summaryItems.slice(0, 6).map((item) => (
                                <span key={`${product.name}-summary-${item.label}`}>
                                  <small>{item.label}</small>
                                  <strong>{item.value}</strong>
                                </span>
                              ))}
                              {!shownSummaryLabels.has("メイン発注先") ? (
                                <span>
                                  <small>メイン発注先</small>
                                  <strong>{product.mainSupplier || "未設定"}</strong>
                                </span>
                              ) : null}
                              {!shownSummaryLabels.has("規格単価") ? (
                                <span>
                                  <small>規格単価</small>
                                  <strong>{unitPriceLabel}</strong>
                                </span>
                              ) : null}
                            </div>
                            <div className="row-actions">
                              <button className="text-button" type="button" onClick={() => void openProductPriceHistory(product)}>
                                価格推移
                              </button>
                              {canManageProducts ? (
                                <>
                                  <button
                                    className="text-button"
                                    onClick={() => setEditTarget({ type: "product", value: product, originalName: product.name })}
                                  >
                                    編集
                                  </button>
                                  <button className="text-button" onClick={() => copyProductToNewDraft(product)}>
                                    複製
                                  </button>
                                  <button className="text-button danger-button" onClick={() => deleteProduct(product)}>
                                    削除
                                  </button>
                                </>
                              ) : null}
                            </div>
                            <details className="product-master-detail">
                            <summary>詳細</summary>
                            <div className="product-master-detail-body">
                              <dl>
                                <div>
                                  <dt>商品</dt>
                                  <dd>{group.familyName}</dd>
                                </div>
                                <div>
                                  <dt>バリエーション名</dt>
                                  <dd>{product.variantName || "未設定"}</dd>
                                </div>
                                <div>
                                  <dt>標準バリエーション</dt>
                                  <dd>{product.isDefaultVariant ? "はい" : "いいえ"}</dd>
                                </div>
                                <div>
                                  <dt>バリエーション表示順</dt>
                                  <dd>{Number(product.variantSortOrder ?? 0)}</dd>
                                </div>
                                <div>
                                  <dt>適用ブランド</dt>
                                  <dd>{product.brand || "共通"}</dd>
                                </div>
                                <div>
                                  <dt>メーカー</dt>
                                  <dd>{product.manufacturer || "未設定"}</dd>
                                </div>
                                <div>
                                  <dt>日本語メモ</dt>
                                  <dd>{getDisplayJapaneseNote(product) || "未設定"}</dd>
                                </div>
                                <div>
                                  <dt>メイン発注先</dt>
                                  <dd>
                                    {product.mainSupplier || "未設定"}
                                    {product.mainPurchaseUrl ? (
                                      <a className="purchase-link-button" href={product.mainPurchaseUrl} target="_blank" rel="noreferrer">
                                        購入ページ
                                      </a>
                                    ) : null}
                                  </dd>
                                </div>
                                <div>
                                  <dt>予備発注先</dt>
                                  <dd>
                                    {product.backupSupplier || "未設定"}
                                    {product.backupPurchaseUrl ? (
                                      <a className="purchase-link-button" href={product.backupPurchaseUrl} target="_blank" rel="noreferrer">
                                        購入ページ
                                      </a>
                                    ) : null}
                                  </dd>
                                </div>
                                <div>
                                  <dt>原産地</dt>
                                  <dd>{product.originCountries?.length ? product.originCountries.join(" / ") : "未設定"}</dd>
                                </div>
                                <div>
                                  <dt>数量</dt>
                                  <dd>{formatPackageQuantity(product)}</dd>
                                </div>
                                <div>
                                  <dt>海外輸入</dt>
                                  <dd>{product.isImported ? formatProductImportCost(product) : "対象外"}</dd>
                                </div>
                                {product.isImported ? (
                                  <>
                                    <div>
                                      <dt>輸入元・通貨</dt>
                                      <dd>{product.importOriginCountry || "中国"} / {product.importCurrency || "CNY"}</dd>
                                    </div>
                                    <div>
                                      <dt>輸入価格</dt>
                                      <dd>
                                        {formatForeignAmount(parsePositiveDraftNumber(product.importOriginalPrice), product.importCurrency)}
                                        {" / "}
                                        1 {product.importCurrency || "CNY"} = ¥{formatYenAmount(parsePositiveDraftNumber(product.importExchangeRate, 1))}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>運賃・税費</dt>
                                      <dd>
                                        運賃 ¥{formatYenAmount(parsePositiveDraftNumber(product.importFreightCostJpy))}
                                        {" / "}
                                        税費 ¥{formatYenAmount(parsePositiveDraftNumber(product.importTaxCostJpy))}
                                        {" / "}
                                        その他 ¥{formatYenAmount(parsePositiveDraftNumber(product.importOtherCostJpy))}
                                      </dd>
                                    </div>
                                  </>
                                ) : null}
                                <div>
                                  <dt>メモ</dt>
                                  <dd>{product.specNote || "未設定"}</dd>
                                </div>
                              </dl>
                            </div>
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                </article>
              );
            })}
            {filteredProducts.length === 0 ? (
              <div className="empty-state">登録済みの商品はありません</div>
            ) : null}
          </div>
          {productFamilyGroups.length > productPageSize ? (
            <div className="pagination-bar">
              <button
                type="button"
                className="text-button"
                onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                disabled={currentProductPage === 1}
              >
                前へ
              </button>
              <span>{currentProductPage} / {productPageCount}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
                disabled={currentProductPage === productPageCount}
              >
                次へ
              </button>
            </div>
          ) : null}
        </section>

        {canManageProducts ? (
          <section className="panel product-category-admin-panel">
            <details className="category-maintenance">
              <summary>
                <span>分類管理</span>
                <small>大分類・小分類の追加、編集、削除</small>
              </summary>
              <div className="category-maintenance-body">
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
                              <button className="danger-button" type="button" onClick={() => void deleteSubcategory(category, subcategory.name)}>
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
              </div>
            </details>
          </section>
        ) : null}
      </section>

      {priceHistory ? (
        <ProductPriceHistoryDialog
          history={priceHistory}
          onClose={() => setPriceHistory(null)}
        />
      ) : null}
      {canManageProducts && editTarget ? (
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
          onSupplierCreated={(supplier) =>
            setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]))
          }
        />
      ) : null}
      {canManageProducts && editingCategory ? (
        <ModalHistoryScope historyKey="products-category-edit" onClose={() => setEditingCategory(null)}>
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
        </ModalHistoryScope>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function ProductPriceHistoryDialog({
  history,
  onClose
}: {
  history: ProductPriceHistoryState;
  onClose: () => void;
}) {
  useModalHistory(true, onClose, "products-price-history");

  const chronologicalRecords = [...history.records].reverse();
  const prices = history.records.map((record) => Number(record.price)).filter((price) => Number.isFinite(price) && price > 0);
  const latestRecord = history.records[0];
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const averagePrice = prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : 0;
  const referencePrice = parseReferencePrice(history.product.referencePrice ?? 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-price-history-title">
      <section className="edit-modal product-price-history-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Price Trend</p>
            <h3 id="product-price-history-title">{history.product.name} の価格推移</h3>
            <p>レシート紐付けと購入実績から記録された税込単価です。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            <span>×</span>
          </button>
        </div>
        {history.isLoading ? (
          <p className="empty-state">価格履歴を読み込み中...</p>
        ) : history.error ? (
          <p className="empty-state">{history.error}</p>
        ) : history.records.length ? (
          <>
            <div className="product-price-history-stats">
              <span>
                <small>最新</small>
                <strong>{formatHistoryPrice(latestRecord?.price ?? 0)}</strong>
              </span>
              <span>
                <small>平均</small>
                <strong>{formatHistoryPrice(averagePrice)}</strong>
              </span>
              <span>
                <small>最低</small>
                <strong>{formatHistoryPrice(minPrice)}</strong>
              </span>
              <span>
                <small>最高</small>
                <strong>{formatHistoryPrice(maxPrice)}</strong>
              </span>
              <span>
                <small>参考価格</small>
                <strong>{referencePrice > 0 ? formatHistoryPrice(referencePrice) : "未設定"}</strong>
              </span>
            </div>
            <ProductPriceTrendChart records={chronologicalRecords} referencePrice={referencePrice} />
            <div className="product-price-history-list">
              {history.records.map((record) => (
                <div className="product-price-history-row" key={record.id}>
                  <div>
                    <strong>{formatHistoryPrice(record.price)}</strong>
                    <span>{record.unit || history.product.unit || "個"} / {formatPriceRecordSource(record.source)}</span>
                  </div>
                  <div>
                    <span>{record.vendorName || record.supplierName || "取引先未設定"}</span>
                    <small>{record.purchaseDate || formatHistoryDate(record.recordedAt)}</small>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-state">この商品の購入価格記録はまだありません。レシート明細を商品マスタに紐付けると、税込単価がここに蓄積されます。</p>
        )}
      </section>
    </div>
  );
}

function ProductPriceTrendChart({ records, referencePrice }: { records: ProductPriceHistoryRecord[]; referencePrice: number }) {
  const prices = records.map((record) => Number(record.price)).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;
  const values = referencePrice > 0 ? [...prices, referencePrice] : prices;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 640;
  const height = 180;
  const paddingX = 24;
  const paddingY = 22;
  const points = prices.map((price, index) => {
    const x = prices.length === 1
      ? width / 2
      : paddingX + (index / (prices.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - ((price - min) / range) * (height - paddingY * 2);
    return `${x},${y}`;
  }).join(" ");
  const referenceY = referencePrice > 0
    ? height - paddingY - ((referencePrice - min) / range) * (height - paddingY * 2)
    : null;

  return (
    <div className="product-price-chart" aria-label="価格推移チャート">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} />
        {referenceY !== null ? <line className="reference-line" x1={paddingX} y1={referenceY} x2={width - paddingX} y2={referenceY} /> : null}
        <polyline points={points} />
        {prices.map((price, index) => {
          const [x, y] = points.split(" ")[index].split(",").map(Number);
          return <circle cx={x} cy={y} r="4" key={`${price}-${index}`} />;
        })}
      </svg>
      <div className="product-price-chart-labels">
        <span>{formatHistoryPrice(min)}</span>
        {referencePrice > 0 ? <span>参考価格 {formatHistoryPrice(referencePrice)}</span> : null}
        <span>{formatHistoryPrice(max)}</span>
      </div>
    </div>
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
  onSave,
  onSupplierCreated
}: {
  target: ProductEditTarget;
  suppliers: Supplier[];
  brands: typeof import("../../../lib/mock-data").brands;
  categoryOptions: string[];
  subcategoryOptions: string[];
  onChange: (target: ProductEditTarget) => void;
  onClose: () => void;
  onSave: (target: ProductEditTarget) => void;
  onSupplierCreated: (supplier: Supplier) => void;
}) {
  useModalHistory(true, onClose, "products-edit");

  const fields = getProductFields(target.value, suppliers, brands, categoryOptions, subcategoryOptions);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const originOptions = getOriginCountryOptions(target.value.originCountries ?? []);
  const [originSearch, setOriginSearch] = useState("");
  const selectedOriginCountries = target.value.originCountries ?? [];
  const filteredOriginOptions = originOptions.filter((option) => option.includes(originSearch.trim()));
  const currentUnit = String(target.value.unit ?? "");
  const [supplierCreateTarget, setSupplierCreateTarget] = useState<"mainSupplier" | "backupSupplier" | null>(null);
  const [supplierSaveStatus, setSupplierSaveStatus] = useState("");
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [isCustomUnitMode, setIsCustomUnitMode] = useState(() =>
    Boolean(currentUnit && !commonUnitOptions.includes(currentUnit))
  );
  const generatedProductName = buildProductNameFromVariant(target.value) || String(target.value.name ?? "").trim();
  const importCurrency = target.value.importCurrency === "CNY" ? "CNY" : "JPY";
  const importExchangeRate = importCurrency === "JPY" ? 1 : parsePositiveDraftNumber(target.value.importExchangeRate, 1);
  const importOriginalPrice = parsePositiveDraftNumber(target.value.importOriginalPrice);
  const importPriceJpy = parsePositiveDraftNumber(target.value.importPriceJpy, importOriginalPrice * importExchangeRate);
  const importFreightRateOriginal = parsePositiveDraftNumber(target.value.importFreightRateOriginalPerKg, 20);
  const importFreightRateJpy = parsePositiveDraftNumber(target.value.importFreightRateJpyPerKg, importFreightRateOriginal * importExchangeRate);
  const importWeightKg = parsePositiveDraftNumber(target.value.importWeightKg, target.value.importWeightStrategy === "actual_weight" ? 0 : 1);
  const importFreightCostJpy = parsePositiveDraftNumber(target.value.importFreightCostJpy, importFreightRateJpy * importWeightKg);
  const importTaxCostJpy = parsePositiveDraftNumber(target.value.importTaxCostJpy);
  const importOtherCostJpy = parsePositiveDraftNumber(target.value.importOtherCostJpy);
  const importLandedCostJpy = importPriceJpy + importFreightCostJpy + importTaxCostJpy + importOtherCostJpy;
  const [exchangeRateStatus, setExchangeRateStatus] = useState("");
  useModalHistory(Boolean(supplierCreateTarget), () => setSupplierCreateTarget(null), "products-supplier-quick-create");

  useEffect(() => {
    if (currentUnit && !commonUnitOptions.includes(currentUnit)) {
      setIsCustomUnitMode(true);
    }
  }, [currentUnit]);

  useEffect(() => {
    if (!target.value.name || target.value.productFamilyName || target.value.variantName) return;

    const legacyName = String(target.value.name).trim();
    if (!legacyName) return;

    onChange({
      ...target,
      value: {
        ...target.value,
        productFamilyName: legacyName
      }
    });
  }, [target.value.name, target.value.productFamilyName, target.value.variantName]);

  useEffect(() => {
    if (!target.value.isImported) return;
    if (target.value.importCurrency && target.value.importCurrency !== "CNY") return;
    if (parsePositiveDraftNumber(target.value.importExchangeRate) > 1) return;

    void loadImportExchangeRate("CNY");
  }, [target.value.isImported]);

  function setProductValue(key: string, value: string) {
    const nextValue = {
      ...target.value,
      [key]: value
    };

    if (key === "productFamilyName" || key === "variantName") {
      const generatedName = buildProductNameFromVariant(nextValue);
      if (generatedName) nextValue.name = generatedName;
    }

    onChange({
      ...target,
      value: nextValue
    });
  }

  function updateProductValue(values: Partial<ProductDraft>) {
    onChange({
      ...target,
      value: {
        ...target.value,
        ...values
      }
    });
  }

  async function loadImportExchangeRate(currency: string) {
    if (currency === "JPY") {
      updateProductValue({
        importCurrency: "JPY",
        importExchangeRate: 1,
        importFreightRateJpyPerKg: parsePositiveDraftNumber(target.value.importFreightRateOriginalPerKg, 20)
      });
      setExchangeRateStatus("");
      return;
    }

    setExchangeRateStatus("為替レートを取得中...");
    try {
      const response = await fetch(`/api/exchange-rates?base=${currency}&target=JPY`);
      if (!response.ok) throw new Error("rate fetch failed");
      const data = await response.json() as { rate?: number; date?: string };
      if (!Number.isFinite(data.rate) || !data.rate) throw new Error("invalid rate");
      const nextFreightRate = parsePositiveDraftNumber(target.value.importFreightRateOriginalPerKg, 20) * data.rate;
      updateProductValue({
        importCurrency: currency,
        importExchangeRate: data.rate,
        importFreightRateJpyPerKg: nextFreightRate,
        importFreightCostJpy: nextFreightRate * parsePositiveDraftNumber(target.value.importWeightKg, 1)
      });
      setExchangeRateStatus(data.date ? `為替取得済み: ${data.date}` : "為替取得済み");
    } catch {
      setExchangeRateStatus("為替レートを取得できませんでした。手入力してください。");
    }
  }

  function setImportCalculationValue(values: Partial<ProductDraft>) {
    const nextValue = {
      ...target.value,
      ...values
    };
    const nextCurrency = nextValue.importCurrency === "CNY" ? "CNY" : "JPY";
    const nextRate = nextCurrency === "JPY" ? 1 : parsePositiveDraftNumber(nextValue.importExchangeRate, 1);
    const nextOriginalPrice = parsePositiveDraftNumber(nextValue.importOriginalPrice);
    const nextPriceJpy = nextOriginalPrice * nextRate;
    const nextFreightOriginal = parsePositiveDraftNumber(nextValue.importFreightRateOriginalPerKg, 20);
    const nextFreightJpy = nextFreightOriginal * nextRate;
    const nextWeightKg = parsePositiveDraftNumber(nextValue.importWeightKg, nextValue.importWeightStrategy === "actual_weight" ? 0 : 1);
    const nextFreightCost = nextFreightJpy * nextWeightKg;

    onChange({
      ...target,
      value: {
        ...nextValue,
        importExchangeRate: nextRate,
        importPriceJpy: nextPriceJpy || "",
        importFreightRateJpyPerKg: nextFreightJpy,
        importFreightCostJpy: nextFreightCost || ""
      }
    });
  }

  function setOriginCountry(country: string, checked: boolean) {
    const nextCountries = checked
      ? uniqueOptions([...selectedOriginCountries, country])
      : selectedOriginCountries.filter((item) => item !== country);
    onChange({
      ...target,
      value: {
        ...target.value,
        originCountries: nextCountries
      }
    });
  }

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setUploadStatus("画像ファイルを選択してください。");
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      setUploadStatus("写真は4MB以下にしてください。");
      return;
    }

    setUploadStatus("アップロード中...");
    setIsUploading(true);

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
      const formData = new FormData();
      if (target.value.id) formData.set("productId", target.value.id);
      formData.set("productName", generatedProductName || "new-product");
      formData.set("file", file);

      const response = await fetch("/api/products/photo", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
      const body = await response.json().catch(() => ({}));

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
      setUploadStatus("アップロード済み。最後に保存してください。");
    } catch (error) {
      setUploadStatus(error instanceof DOMException && error.name === "AbortError"
        ? "アップロードがタイムアウトしました。通信環境を確認してください。"
        : "アップロードできませんでした。");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierCreateTarget) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim();
    const channelType = String(formData.get("channelType") ?? "実店舗").trim();
    const address = String(formData.get("address") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const contactPerson = String(formData.get("contactPerson") ?? "").trim();
    const orderUrl = String(formData.get("orderUrl") ?? "").trim();

    if (!name) {
      setSupplierSaveStatus("発注先名を入力してください。");
      return;
    }

    setIsSavingSupplier(true);
    setSupplierSaveStatus("保存中");

    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSupplierSaveStatus(body.error ?? "発注先を保存できませんでした。");
        return;
      }

      const supplier = {
        name,
        category,
        reliability: "",
        channelType: channelType || "実店舗",
        address,
        phone,
        contactPerson,
        businessHours: "",
        orderUrl
      } satisfies Supplier;
      onSupplierCreated(supplier);
      setProductValue(supplierCreateTarget, name);
      setSupplierCreateTarget(null);
      setSupplierSaveStatus("");
      form.reset();
    } catch {
      setSupplierSaveStatus("発注先を保存できませんでした。");
    } finally {
      setIsSavingSupplier(false);
    }
  }

  return (
    <>
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
              <img src={getProductPhotoSrc(target.value.photoUrl)} alt={`${target.value.name || "商品"} の写真`} />
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
                {isUploading ? "アップロード中..." : "写真をアップロード"}
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
          <div className="product-generated-name-preview">
            <span>自動生成名</span>
            <strong>{generatedProductName || "商品名とバリエーション名から自動生成"}</strong>
            <small>保存時は「商品名 + バリエーション名」で登録されます。</small>
          </div>
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.key === "unit" ? (
                <div className="unit-picker">
                  <select
                    value={isCustomUnitMode ? customUnitOption : currentUnit}
                    onChange={(event) => {
                      if (event.target.value === customUnitOption) {
                        setIsCustomUnitMode(true);
                        if (commonUnitOptions.includes(currentUnit)) setProductValue("unit", "");
                        return;
                      }

                      setIsCustomUnitMode(false);
                      setProductValue("unit", event.target.value);
                    }}
                  >
                    <option value="">選択してください</option>
                    {commonUnitOptions.map((option) => (
                      <option value={option} key={option}>{option}</option>
                    ))}
                    <option value={customUnitOption}>その他（自由入力）</option>
                  </select>
                  {isCustomUnitMode ? (
                    <input
                      value={currentUnit}
                      placeholder="例: ケース、パック、束"
                      onChange={(event) => setProductValue("unit", event.target.value)}
                    />
                  ) : null}
                </div>
              ) : field.options ? (
                <select
                  value={String((target.value as unknown as Record<string, string | number>)[field.key] ?? "")}
                  onChange={(event) => {
                    if (event.target.value === addSupplierOption && (field.key === "mainSupplier" || field.key === "backupSupplier")) {
                      setSupplierCreateTarget(field.key);
                      setSupplierSaveStatus("");
                      return;
                    }

                    setProductValue(field.key, event.target.value);
                  }}
                >
                  {field.options.map((option) => (
                    <option value={option} key={option}>{field.key === "usageType" ? getProductUsageTypeLabel(option) : option || field.emptyLabel || ""}</option>
                  ))}
                  {field.key === "mainSupplier" || field.key === "backupSupplier" ? (
                    <option value={addSupplierOption}>発注先を追加...</option>
                  ) : null}
                </select>
              ) : (
                <input
                  value={String((target.value as unknown as Record<string, string | number>)[field.key] ?? "")}
                  type={field.type ?? "text"}
                  inputMode={field.inputMode}
                  onChange={(event) => {
                    setProductValue(field.key, event.target.value);
                  }}
                />
              )}
            </label>
          ))}
          <div className="product-spec-grid">
            <fieldset className="origin-country-picker product-spec-origin">
              <span>原産地</span>
              <input
                value={originSearch}
                placeholder="国名で検索"
                onChange={(event) => setOriginSearch(event.target.value)}
              />
              {selectedOriginCountries.length ? (
                <div className="selected-origin-list">
                  {selectedOriginCountries.map((country) => (
                    <button type="button" key={country} onClick={() => setOriginCountry(country, false)}>
                      {country} ×
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="origin-country-list">
                {filteredOriginOptions.map((option) => (
                  <label key={option}>
                    <input
                      type="checkbox"
                      checked={selectedOriginCountries.includes(option)}
                      onChange={(event) => setOriginCountry(option, event.target.checked)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
                {filteredOriginOptions.length === 0 ? <small>該当する国・地域はありません。</small> : null}
              </div>
            </fieldset>
            <div className="product-quantity-fields">
              <label>
                <span>数量</span>
                <input
                  value={target.value.packageQuantity ?? ""}
                  inputMode="decimal"
                  placeholder="例: 200"
                  onChange={(event) =>
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        packageQuantity: normalizeDecimalInput(event.target.value)
                      }
                    })
                  }
                />
              </label>
              <label>
                <span>数量単位</span>
                <select
                  value={target.value.packageQuantityUnit || target.value.unit || "個"}
                  onChange={(event) =>
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        packageQuantityUnit: event.target.value
                      }
                    })
                  }
                >
                  {commonUnitOptions.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="product-default-variant-toggle">
              <input
                type="checkbox"
                checked={target.value.isDefaultVariant === true}
                onChange={(event) =>
                  onChange({
                    ...target,
                    value: {
                      ...target.value,
                      isDefaultVariant: event.target.checked
                    }
                  })
                }
              />
              <span>この商品の標準バリエーションにする</span>
            </label>
            <label className="product-default-variant-toggle">
              <input
                type="checkbox"
                checked={target.value.isImported === true}
                onChange={(event) => {
                  if (event.target.checked) {
                    setImportCalculationValue({
                      isImported: true,
                      importOriginCountry: target.value.importOriginCountry || "中国",
                      importCurrency: target.value.importCurrency || "CNY",
                      importFreightRateOriginalPerKg: target.value.importFreightRateOriginalPerKg || 20,
                      importWeightStrategy: target.value.importWeightStrategy || "standard_1kg",
                      importWeightKg: target.value.importWeightKg || 1
                    });
                    return;
                  }

                  updateProductValue({
                    isImported: false,
                    importPriceJpy: "",
                    importFreightCostJpy: "",
                    importTaxCostJpy: "",
                    importOtherCostJpy: ""
                  });
                }}
              />
              <span>海外輸入品として管理する</span>
            </label>
            {target.value.isImported ? (
              <div className="product-import-fields">
                <div className="product-import-heading">
                  <strong>海外輸入コスト</strong>
                  <span>標準1kgで計算すると、拼箱でも SKU ごとの原価を安定して見られます。</span>
                </div>
                <label>
                  <span>輸入元</span>
                  <select
                    value={target.value.importOriginCountry || "中国"}
                    onChange={(event) => updateProductValue({ importOriginCountry: event.target.value })}
                  >
                    <option value="中国">中国</option>
                    <option value="台湾">台湾</option>
                    <option value="韓国">韓国</option>
                    <option value="その他">その他</option>
                  </select>
                </label>
                <label>
                  <span>通貨</span>
                  <select
                    value={importCurrency}
                    onChange={(event) => {
                      const nextCurrency = event.target.value;
                      setImportCalculationValue({ importCurrency: nextCurrency });
                      void loadImportExchangeRate(nextCurrency);
                    }}
                  >
                    <option value="CNY">人民元</option>
                    <option value="JPY">日本円</option>
                  </select>
                </label>
                <label>
                  <span>現地価格</span>
                  <input
                    value={target.value.importOriginalPrice ?? ""}
                    inputMode="decimal"
                    placeholder="例: 38"
                    onChange={(event) => setImportCalculationValue({ importOriginalPrice: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>為替レート</span>
                  <input
                    value={target.value.importExchangeRate ?? 1}
                    inputMode="decimal"
                    onChange={(event) => setImportCalculationValue({ importExchangeRate: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>運賃単価 / kg</span>
                  <input
                    value={target.value.importFreightRateOriginalPerKg ?? 20}
                    inputMode="decimal"
                    placeholder="例: 20"
                    onChange={(event) => setImportCalculationValue({ importFreightRateOriginalPerKg: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>計算方式</span>
                  <select
                    value={target.value.importWeightStrategy || "standard_1kg"}
                    onChange={(event) => {
                      const strategy = event.target.value;
                      setImportCalculationValue({
                        importWeightStrategy: strategy,
                        importWeightKg: strategy === "standard_1kg" ? 1 : target.value.importWeightKg || ""
                      });
                    }}
                  >
                    {importWeightStrategyOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>輸入計算重量 kg</span>
                  <input
                    value={target.value.importWeightKg ?? 1}
                    inputMode="decimal"
                    disabled={(target.value.importWeightStrategy || "standard_1kg") === "standard_1kg"}
                    onChange={(event) => setImportCalculationValue({ importWeightKg: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>輸入税費 JPY</span>
                  <input
                    value={target.value.importTaxCostJpy ?? ""}
                    inputMode="decimal"
                    placeholder="任意"
                    onChange={(event) => updateProductValue({ importTaxCostJpy: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>その他費用 JPY</span>
                  <input
                    value={target.value.importOtherCostJpy ?? ""}
                    inputMode="decimal"
                    placeholder="任意"
                    onChange={(event) => updateProductValue({ importOtherCostJpy: normalizeDecimalInput(event.target.value) })}
                  />
                </label>
                <div className="product-import-cost-preview">
                  <span>換算価格 {formatForeignAmount(importOriginalPrice, importCurrency)} = ¥{formatYenAmount(importPriceJpy)}</span>
                  <span>運賃 {formatForeignAmount(importFreightRateOriginal, importCurrency)}/kg = ¥{formatYenAmount(importFreightCostJpy)}</span>
                  <strong>着地原価 ¥{formatYenAmount(importLandedCostJpy)}</strong>
                  {exchangeRateStatus ? <small>{exchangeRateStatus}</small> : null}
                </div>
              </div>
            ) : null}
            <label className="product-spec-note">
              <span>日本語メモ</span>
              <textarea
                value={String(target.value.japaneseNote ?? "").replace("[情報未補完]", "").trim()}
                placeholder="例: 日本スタッフ向けの商品説明、読み方、用途"
                onChange={(event) =>
                  onChange({
                    ...target,
                    value: {
                      ...target.value,
                      japaneseNote: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="product-spec-note">
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
      {supplierCreateTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="supplier-quick-create-title">
          <form className="edit-modal compact-modal" onSubmit={createSupplier}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Quick Add</p>
                <h3 id="supplier-quick-create-title">発注先を追加</h3>
                <p>{supplierCreateTarget === "mainSupplier" ? "メイン発注先" : "予備発注先"}に設定します</p>
              </div>
              <button type="button" className="text-button" onClick={() => setSupplierCreateTarget(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>発注先名</span>
                <input name="name" placeholder="例: 業務スーパー" autoFocus />
              </label>
              <label>
                <span>分類</span>
                <input name="category" placeholder="例: 冷凍野菜 / 包材" />
              </label>
              <label>
                <span>区分</span>
                <select name="channelType" defaultValue="実店舗">
                  <option value="実店舗">実店舗</option>
                  <option value="チェーン店">チェーン店</option>
                  <option value="卸売">卸売</option>
                  <option value="ネットショップ">ネットショップ</option>
                </select>
              </label>
              <label>
                <span>住所</span>
                <input name="address" placeholder="任意" />
              </label>
              <label>
                <span>電話番号</span>
                <input name="phone" placeholder="任意" />
              </label>
              <label>
                <span>担当者</span>
                <input name="contactPerson" placeholder="任意" />
              </label>
              <label className="full-span">
                <span>注文・購入リンク</span>
                <input name="orderUrl" placeholder="任意" />
              </label>
            </div>
            {supplierSaveStatus ? <small className="form-hint">{supplierSaveStatus}</small> : null}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setSupplierCreateTarget(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary-button" disabled={isSavingSupplier}>
                {isSavingSupplier ? "保存中" : "保存して選択"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function getProductFields(
  product: ProductDraft,
  suppliers: Supplier[],
  brandsData: typeof brands,
  categoryOptions: string[],
  subcategoryOptions: string[]
): Array<{ key: string; label: string; type?: "text"; inputMode?: "decimal"; options?: string[]; emptyLabel?: string }> {
  const supplierNames = suppliers.map((supplier) => supplier.name);
  const brandNames = brandsData.map((brand) => brand.name);

  return [
    { key: "productFamilyName", label: "商品名" },
    { key: "variantName", label: "バリエーション名" },
    { key: "productBrandName", label: "商品ブランド" },
    { key: "manufacturer", label: "メーカー" },
    { key: "category", label: "大分類", options: uniqueOptions([...categoryOptions, product.category]) },
    {
      key: "subcategory",
      label: "小分類",
      options: uniqueOptions([...subcategoryOptions, product.subcategory ?? ""])
    },
    { key: "brand", label: "適用ブランド", options: uniqueOptions(["未設定", "共通", ...brandNames, product.brand]) },
    { key: "unit", label: "単位" },
    { key: "referencePrice", label: "参考価格", type: "text", inputMode: "decimal" },
    { key: "variantSortOrder", label: "バリエーション表示順", type: "text", inputMode: "decimal" },
    { key: "mainSupplier", label: "メイン発注先", options: uniqueOptionsWithEmpty(["", ...supplierNames, product.mainSupplier]), emptyLabel: "未設定" },
    { key: "mainPurchaseUrl", label: "メイン購入リンク" },
    { key: "backupSupplier", label: "予備発注先", options: uniqueOptionsWithEmpty(["", ...supplierNames, product.backupSupplier]), emptyLabel: "無" },
    { key: "backupPurchaseUrl", label: "予備購入リンク" },
    { key: "usageType", label: "用途区分", options: uniqueOptions([...productUsageTypeOptions.map((option) => option.value), product.usageType ?? "ingredient"]) },
    { key: "storageType", label: "保管属性", options: uniqueOptions(["常温", "冷蔵", "冷凍", product.storageType]) },
    { key: "photoUrl", label: "写真URL" }
  ];
}

function getOriginCountryOptions(selectedCountries: string[]) {
  return uniqueOptions([...originCountryOptions, ...selectedCountries]);
}

function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.filter(Boolean)));
}

function uniqueOptionsWithEmpty(options: string[]) {
  return Array.from(new Set(options.filter((option) => option === "" || Boolean(option))));
}
