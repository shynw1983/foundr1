"use client";

import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Info,
  Languages,
  Lightbulb,
  Link2,
  LogOut,
  MenuSquare,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Store,
  Trash2,
  Truck,
  Upload,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { ModalHistoryScope } from "../components/useModalHistory";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type OptionItem = {
  id: string;
  name: string;
};

type StoreOption = OptionItem & {
  brandIds: string[];
};

type MenuActionNotice = {
  tone: "success" | "error" | "info";
  text: string;
};

type MenuSource = {
  id: string;
  brandId: string;
  storeId: string;
  name: string;
  sourceType: string;
  sourceUrl: string;
  status: string;
};

type MenuCategory = {
  id: string;
  brandId: string;
  storeId: string;
  externalId: string;
  name: string;
  note: string;
  isTapiocaFree: boolean;
  hasWhipByDefault: boolean;
  sortOrder: number;
};

type MenuCategorySummary = MenuCategory & {
  count: number;
};

type MenuItem = {
  id: string;
  brandId: string;
  storeId: string;
  menuSourceId: string;
  externalId: string;
  itemKind: string;
  promotionPrefix: string;
  promotionPrefixDisplayNames?: Record<string, string>;
  name: string;
  displayNames?: Record<string, string>;
  category: string;
  description: string;
  descriptionDisplayNames?: Record<string, string>;
  imageUrl: string;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
};

type WebsitePresentation = {
  nameOverride?: string;
  promotionPrefixOverride?: string;
  categoryOverride?: string;
  descriptionOverride?: string;
  descriptionDisplayNamesOverride?: Record<string, string>;
  showPromotionPrefix?: boolean;
  showEmoji?: boolean;
};

type MenuGroup = {
  id: string;
  brandId: string;
  menuCatalogItemId: string;
  applicableCategories: string[];
  externalId: string;
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  selectionType: string;
  affectsProcedure: boolean;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
};

type MenuOption = {
  id: string;
  optionGroupId: string;
  applicableCategories: string[];
  externalId: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  imageUrl: string;
  priceDelta: number | null;
  affectsProcedure: boolean;
  sortOrder: number;
  isActive: boolean;
};

type MenuItemOptionGroup = {
  menuCatalogItemId: string;
  optionGroupId: string;
  sortOrder: number;
  isActive: boolean;
};

type MenuExternalPlatform = {
  id: string;
  brandId: string;
  storeId: string;
  platformKey: string;
  name: string;
  managementUrl: string;
  ruleVersion: string;
  ruleConfig: Record<string, unknown>;
  isActive: boolean;
};

type MenuSyncTask = {
  id: string;
  brandId: string;
  storeId: string;
  externalPlatformId: string;
  platformName: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  changeKind: string;
  changeSummary: string;
  status: "pending" | "queued" | "processing" | "retrying" | "failed" | "succeeded" | "completed";
  phase: string;
  attempts: number;
  maxAttempts: number;
  errorCode: string;
  errorDetail: string;
  isRetryable: boolean;
  commandId: string;
  publishBatchId: string;
  verifiedAt: string | null;
  createdByName: string;
  completedByName: string;
  completionNote: string;
  createdAt: string;
  completedAt: string | null;
};

type MenuPlatformTargetSetting = {
  id: string;
  brandId: string;
  storeId: string;
  externalPlatformId: string;
  targetType: "item" | "option" | "category" | "option_group";
  targetId: string;
  isEnabled: boolean;
  nameOverride: string;
  descriptionOverride: string;
  priceOverride: number | null;
  emojiMode: "follow" | "show" | "hide";
  placementConfig: Record<string, unknown>;
};

type MenuPublishBatch = {
  id: string;
  brandId: string;
  storeId: string;
  status: string;
  requestedPlatforms: string[];
  createdAt: string;
  completedAt: string | null;
  createdByName: string;
};

type MenuPlatformImportCandidate = {
  id: string;
  brandId: string;
  storeId: string;
  externalPlatformId: string;
  platformKey: string;
  platformName: string;
  targetType: "item" | "option";
  externalId: string;
  externalParentId: string;
  observedName: string;
  observedPayload: Record<string, unknown>;
  status: "pending" | "ignored";
  adoptedTargetId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

type MenuAvailabilityLink = {
  id: string;
  brandId: string;
  sourceKind: "item" | "option";
  sourceId: string;
  dependentKind: "item" | "option";
  dependentId: string;
  isBidirectional: boolean;
};

type MenuAdminData = {
  selectedStoreId: string;
  brands: OptionItem[];
  stores: StoreOption[];
  sources: MenuSource[];
  categories: MenuCategory[];
  items: MenuItem[];
  groups: MenuGroup[];
  options: MenuOption[];
  itemOptionGroups: MenuItemOptionGroup[];
  externalPlatforms: MenuExternalPlatform[];
  syncTasks: MenuSyncTask[];
  availabilityLinks: MenuAvailabilityLink[];
  platformTargetSettings: MenuPlatformTargetSetting[];
  publishBatches: MenuPublishBatch[];
  platformImportCandidates: MenuPlatformImportCandidate[];
};

type MenuPublishPreviewChange = {
  id: string;
  targetType: "item" | "option" | "category" | "option_group" | "other";
  targetId?: string;
  targetLabel: string;
  locationLabel?: string;
  kind: "create" | "rename" | "reprice" | "update" | "move" | "disable" | "delete";
  summary: string;
  currentValue?: string;
  projectedValue?: string;
  currentState?: Record<string, unknown>;
  projectedState?: Record<string, unknown>;
  confidence: "confirmed" | "provisional";
  requiresExplicitConfirmation?: boolean;
};

type MenuPlatformReconciliationIssue = {
  id: string;
  targetType: "item" | "option";
  targetId: string;
  targetLabel: string;
  locationLabel: string;
  issueKind: "missing" | "multiple";
  candidates: Array<{ externalId: string; name: string; price: number | null }>;
};

type MenuPublishPreviewPlatform = {
  platformKey: "uber_eats" | "rocket_now" | "demae_can";
  platformName: string;
  ruleVersion: string;
  baselineStatus: "ready" | "confirmed" | "missing";
  baselineCapturedAt: string | null;
  changes: MenuPublishPreviewChange[];
  reconciliationIssues: MenuPlatformReconciliationIssue[];
  warnings: string[];
  blockers: string[];
};

type MenuPublishPreview = {
  generatedAt: string;
  mode: "read_only";
  brandId: string;
  brandName: string;
  platforms: MenuPublishPreviewPlatform[];
  externalPlatforms: Array<{ id: string; platformKey: string; ruleVersion: string }>;
};

type MenuTranslationDraftEntry = {
  key: string;
  targetType: "item" | "item_description" | "group" | "option";
  targetId: string;
  field: "displayNames" | "descriptionDisplayNames";
  language: string;
  sourceText: string;
  currentText: string;
  suggestedText: string;
  targetLabel: string;
};

type MenuTranslationPreview = {
  entries: MenuTranslationDraftEntry[];
  model: string;
  generatedAt: string;
  targetCount: number;
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
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const emptyItem: MenuItem = {
  id: "",
  brandId: "",
  storeId: "",
  menuSourceId: "",
  externalId: "",
  itemKind: "fixed_product",
  promotionPrefix: "",
  promotionPrefixDisplayNames: {},
  name: "",
  displayNames: {},
  category: "",
  description: "",
  descriptionDisplayNames: {},
  imageUrl: "",
  basePrice: null,
  variableSchema: {},
  sortOrder: 100,
  isActive: true
};

const emptyCategory: MenuCategory = {
  id: "",
  brandId: "",
  storeId: "",
  externalId: "",
  name: "",
  note: "",
  isTapiocaFree: false,
  hasWhipByDefault: false,
  sortOrder: 100
};

const emptyGroup: MenuGroup = {
  id: "",
  brandId: "",
  menuCatalogItemId: "",
  applicableCategories: [],
  externalId: "",
  groupKey: "",
  name: "",
  displayNames: {},
  selectionType: "single",
  affectsProcedure: true,
  ruleJson: {},
  sortOrder: 100,
  isActive: true
};

const emptyOption: MenuOption = {
  id: "",
  optionGroupId: "",
  applicableCategories: [],
  externalId: "",
  optionKey: "",
  name: "",
  displayNames: {},
  imageUrl: "",
  priceDelta: null,
  affectsProcedure: true,
  sortOrder: 100,
  isActive: true
};

const itemKindOptions = [
  { value: "fixed_product", label: "通常商品" },
  { value: "buildable_product", label: "組み立て商品" },
  { value: "modifier", label: "追加・変更" },
  { value: "option", label: "単独オプション" }
];

const selectionTypeOptions = [
  { value: "single", label: "1つ選ぶ" },
  { value: "multiple", label: "複数選べる" },
  { value: "quantity", label: "数量で選ぶ" }
];

const customerMenuLanguageOptions = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ko", label: "한국어" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ne", label: "नेपाली" }
];

const choiceSettingsCategory = "__choice_settings__";
const uberImportDraftCategory = "__uber_import_drafts__";
const supportedDeliveryPlatformKeys = new Set(["uber_eats", "rocket_now", "demae_can"]);

const schemaRuleKeys: Record<string, string> = {
  size: "allowedSizes",
  temperature: "temperatures",
  sweetness: "allowedSweetness",
  ice: "allowedIce",
  option: "allowedOptions",
  topping: "allowedToppings"
};

function cloneItem(item: MenuItem): MenuItem {
  return JSON.parse(JSON.stringify(item)) as MenuItem;
}

function getLabel(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function getBrandName(brands: OptionItem[], id: string) {
  return brands.find((brand) => brand.id === id)?.name ?? "";
}

function getMenuItemName(items: MenuItem[], id: string) {
  return items.find((item) => item.id === id)?.name ?? "";
}

function getGroupScopeLabel(group: MenuGroup, items: MenuItem[]) {
  if (group.menuCatalogItemId) return `商品専用: ${getMenuItemName(items, group.menuCatalogItemId) || "未設定"}`;
  if (group.applicableCategories.length) return `分類: ${group.applicableCategories.join("、")}`;
  return "ブランド全商品";
}

function getRuleKey(groupKey: string) {
  return schemaRuleKeys[groupKey] ?? `allowed_${groupKey}`;
}

function getOptionKey(option: MenuOption) {
  return option.optionKey || option.externalId || option.id;
}

function getAllowedKeys(item: MenuItem, group: MenuGroup, options: MenuOption[]) {
  const ruleKey = getRuleKey(group.groupKey);
  const rawValue = item.variableSchema?.[ruleKey];
  if (Array.isArray(rawValue)) return new Set(rawValue.map(String));
  return new Set(options.map(getOptionKey));
}

function groupUsesFallbackAll(group: MenuGroup) {
  return group.ruleJson?.defaultBehavior === "all_when_missing_or_empty";
}

function getCategoryDefaultOptionKey(group: Pick<MenuGroup, "ruleJson">, categoryName: string) {
  const categoryDefaults = group.ruleJson?.defaultOptionKeysByCategory;
  if (categoryName && categoryDefaults && typeof categoryDefaults === "object" && !Array.isArray(categoryDefaults)) {
    return String((categoryDefaults as Record<string, unknown>)[categoryName] ?? "").trim();
  }
  return "";
}

function getDefaultOptionKey(group: Pick<MenuGroup, "ruleJson">, categoryName = "") {
  const categoryDefault = categoryName ? getCategoryDefaultOptionKey(group, categoryName) : "";
  if (categoryDefault) return categoryDefault;
  return String(group.ruleJson?.defaultOptionKey ?? "").trim();
}

function updateGroupDefaultOption(group: MenuGroup, defaultOptionKey: string): MenuGroup {
  const nextRuleJson = { ...(group.ruleJson ?? {}) };
  if (defaultOptionKey) {
    nextRuleJson.defaultOptionKey = defaultOptionKey;
  } else {
    delete nextRuleJson.defaultOptionKey;
  }
  return { ...group, ruleJson: nextRuleJson };
}

function updateGroupCategoryDefaultOption(group: MenuGroup, categoryName: string, defaultOptionKey: string): MenuGroup {
  const current = group.ruleJson?.defaultOptionKeysByCategory;
  const categoryDefaults = current && typeof current === "object" && !Array.isArray(current)
    ? { ...current as Record<string, unknown> }
    : {};
  if (defaultOptionKey) categoryDefaults[categoryName] = defaultOptionKey;
  else delete categoryDefaults[categoryName];
  const nextRuleJson = { ...(group.ruleJson ?? {}) };
  if (Object.keys(categoryDefaults).length) nextRuleJson.defaultOptionKeysByCategory = categoryDefaults;
  else delete nextRuleJson.defaultOptionKeysByCategory;
  return { ...group, ruleJson: nextRuleJson };
}

function buildPublicMenuUrl(brandId: string) {
  const params = new URLSearchParams();
  if (brandId) params.set("brand", brandId);
  return `/api/public/menus${params.size ? `?${params.toString()}` : ""}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getPublishChangeLabel(kind: MenuPublishPreviewChange["kind"]) {
  return ({
    create: "追加",
    rename: "名称変更",
    reprice: "価格変更",
    update: "更新",
    move: "移動",
    disable: "停止",
    delete: "削除候補"
  } as const)[kind];
}

function getMenuTaskStatus(task: MenuSyncTask) {
  if (task.status === "queued") return "待機中";
  if (task.status === "processing") {
    if (task.phase === "capturing") return "メニュー読取中";
    if (task.phase === "verifying") return "回読確認中";
    if (task.phase === "applying") return "反映中";
    if (task.phase === "locating") return "対象確認中";
    return "処理中";
  }
  if (task.status === "retrying") return `再試行中 ${task.attempts}/${task.maxAttempts}`;
  if (task.status === "failed") {
    if (/login|credentials|account_locked|password_expired/u.test(`${task.errorCode} ${task.errorDetail}`)) return "ログイン要確認";
    if (/timeout/u.test(`${task.errorCode} ${task.errorDetail}`)) return "タイムアウト";
    if (/verification|mismatch/u.test(`${task.errorCode} ${task.errorDetail}`)) return "回読不一致";
    return "失敗";
  }
  if (task.status === "succeeded") return "確認済み";
  if (task.status === "completed") return "手動反映済み";
  return "未反映";
}

function getBaselineQuality(platform?: MenuPublishPreviewPlatform) {
  if (!platform?.baselineCapturedAt) return "基準データなし";
  if (platform.baselineStatus === "ready") return "全件一致";
  if (platform.baselineStatus === "confirmed") return "対応確認済み";
  return platform.reconciliationIssues?.length
    ? `${platform.reconciliationIssues.length}件の対応確認を開く`
    : "取込結果の確認が必要";
}

const menuCaptureTaskLabels = new Set(["プラットフォーム基準取込", "毎日プラットフォーム全量回読"]);
const runningMenuTaskStatuses = new Set(["queued", "processing", "retrying"]);
const terminalMenuTaskStatuses = new Set(["failed", "succeeded", "completed"]);

function getPlatformRuleSummary(platformKey: MenuPublishPreviewPlatform["platformKey"]) {
  if (platformKey === "uber_eats") return "日本語＋中・韓・英 / Emoji可 / OS価格×1.25";
  if (platformKey === "rocket_now") return "日本語のみ / Emojiなし / OS価格×1.25 / 選択肢上限で分割";
  return "日本語＋中・韓・英 / Emojiなし / OS基本価格";
}

function getCategoryCounts(items: MenuItem[], categories: MenuCategory[], brandId: string): MenuCategorySummary[] {
  const counts = new Map<string, number>();
  const categoryMasters = new Map<string, MenuCategory>();
  for (const item of items) {
    const category = item.category || "未分類";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  for (const category of categories) {
    if (category.brandId !== brandId || category.storeId) continue;
    categoryMasters.set(category.name, category);
    if (!counts.has(category.name)) counts.set(category.name, 0);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => {
      const master = categoryMasters.get(name);
      return {
        ...(master ?? {
          ...emptyCategory,
          brandId,
          name,
          sortOrder: 9999
        }),
        count
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const nextItems = [...items];
  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
}

function updateDisplayName<T extends { displayNames?: Record<string, string> }>(draft: T, language: string, value: string): T {
  return {
    ...draft,
    displayNames: {
      ...(draft.displayNames ?? {}),
      [language]: value
    }
  };
}

function updateDescriptionDisplayName<T extends { descriptionDisplayNames?: Record<string, string> }>(draft: T, language: string, value: string): T {
  return {
    ...draft,
    descriptionDisplayNames: {
      ...(draft.descriptionDisplayNames ?? {}),
      [language]: value
    }
  };
}

function updatePromotionPrefixDisplayName<T extends { promotionPrefixDisplayNames?: Record<string, string> }>(draft: T, language: string, value: string): T {
  return {
    ...draft,
    promotionPrefixDisplayNames: {
      ...(draft.promotionPrefixDisplayNames ?? {}),
      [language]: value
    }
  };
}

function getWebsitePresentation(item: MenuItem): WebsitePresentation {
  const value = item.variableSchema?.websitePresentation;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as WebsitePresentation
    : {};
}

function updateWebsitePresentation(item: MenuItem, patch: Partial<WebsitePresentation>): MenuItem {
  return {
    ...item,
    variableSchema: {
      ...item.variableSchema,
      websitePresentation: {
        ...getWebsitePresentation(item),
        ...patch
      }
    }
  };
}

function updateWebsiteDescriptionDisplayName(item: MenuItem, language: string, value: string): MenuItem {
  const presentation = getWebsitePresentation(item);
  return updateWebsitePresentation(item, {
    descriptionDisplayNamesOverride: {
      ...(presentation.descriptionDisplayNamesOverride ?? {}),
      [language]: value
    }
  });
}

function stripMenuEmoji(value: string) {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getWebsiteItemPreview(item: MenuItem) {
  const presentation = getWebsitePresentation(item);
  const name = presentation.nameOverride?.trim() || item.name;
  const prefix = presentation.showPromotionPrefix === false
    ? ""
    : presentation.promotionPrefixOverride?.trim() || item.promotionPrefix;
  const value = `${prefix}${name}`;
  return presentation.showEmoji === false ? stripMenuEmoji(value) : value;
}

function getWebsiteCategoryPreview(item: MenuItem) {
  const presentation = getWebsitePresentation(item);
  const value = presentation.categoryOverride?.trim() || item.category || "未分類";
  return presentation.showEmoji === false ? stripMenuEmoji(value) : value;
}

function isUberImportDraft(item: MenuItem) {
  const externalRefs = item.variableSchema?.externalRefs;
  const uberEats = externalRefs && typeof externalRefs === "object" && !Array.isArray(externalRefs)
    ? (externalRefs as Record<string, unknown>).uberEats
    : null;
  const uberItemId = uberEats && typeof uberEats === "object" && !Array.isArray(uberEats)
    ? String((uberEats as Record<string, unknown>).itemId ?? "").trim()
    : "";
  return !item.isActive && Boolean(uberItemId);
}

export default function MenuAdminPage() {
  const [data, setData] = useState<MenuAdminData>({
    selectedStoreId: "",
    brands: [],
    stores: [],
    sources: [],
    categories: [],
    items: [],
    groups: [],
    options: [],
    itemOptionGroups: [],
    externalPlatforms: [],
    syncTasks: [],
    availabilityLinks: [],
    platformTargetSettings: [],
    publishBatches: [],
    platformImportCandidates: []
  });
  const [activeBrandId, setActiveBrandId] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"item" | "category">("item");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemDraft, setItemDraft] = useState<MenuItem>(emptyItem);
  const [categoryDraft, setCategoryDraft] = useState<MenuCategory>(emptyCategory);
  const [groupDraft, setGroupDraft] = useState<MenuGroup>(emptyGroup);
  const [optionDraft, setOptionDraft] = useState<MenuOption>(emptyOption);
  const [activeOptionGroupId, setActiveOptionGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const [optionPhotoStatus, setOptionPhotoStatus] = useState("");
  const [savingKind, setSavingKind] = useState<"item" | "category" | "group" | "option" | "">("");
  const [draggingCategory, setDraggingCategory] = useState("");
  const [draggingItemId, setDraggingItemId] = useState("");
  const [syncCompletionNotes, setSyncCompletionNotes] = useState<Record<string, string>>({});
  const [translationLanguages, setTranslationLanguages] = useState<string[]>(customerMenuLanguageOptions.map((language) => language.value));
  const [translationOverwriteExisting, setTranslationOverwriteExisting] = useState(false);
  const [translationPreview, setTranslationPreview] = useState<MenuTranslationPreview | null>(null);
  const [translationStatus, setTranslationStatus] = useState("");
  const [translationBusy, setTranslationBusy] = useState<"preview" | "apply" | "">("");
  const [publishPreview, setPublishPreview] = useState<MenuPublishPreview | null>(null);
  const [publishPreviewStatus, setPublishPreviewStatus] = useState<"loading" | "error" | "">("");
  const [publishStoreId, setPublishStoreId] = useState("");
  const [selectedPublishPlatforms, setSelectedPublishPlatforms] = useState<string[]>([]);
  const [publishAction, setPublishAction] = useState<"publishing" | "capturing" | "">("");
  const [reconciliationAction, setReconciliationAction] = useState("");
  const [actionNotice, setActionNotice] = useState<MenuActionNotice | null>(null);
  const [availabilityLinkDraft, setAvailabilityLinkDraft] = useState({
    sourceKey: "",
    dependentKey: "",
    isBidirectional: false
  });
  const [availabilityLinkSaving, setAvailabilityLinkSaving] = useState(false);

  async function loadPublishPreview(brandId: string) {
    if (!brandId) {
      setPublishPreview(null);
      return;
    }
    setPublishPreviewStatus("loading");
    try {
      const response = await fetch(`/api/menus/publish-preview?brandId=${encodeURIComponent(brandId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as MenuPublishPreview & { error?: string };
      if (!response.ok) {
        setPublishPreviewStatus("error");
        return;
      }
      setPublishPreview(result);
      setPublishPreviewStatus("");
    } catch {
      setPublishPreviewStatus("error");
    }
  }

  async function startMenuPublish(confirmDestructive = false) {
    if (captureRunActive) {
      setMessage("現在メニューの取込完了後に差分を配信してください。");
      return;
    }
    if (!activeBrandId || !publishStoreId || !selectedPublishPlatforms.length) {
      setMessage("店舗と配信先を選択してください。");
      return;
    }
    setPublishAction("publishing");
    setMessage("");
    try {
      const response = await fetch("/api/menus/publish-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          brandId: activeBrandId,
          storeId: publishStoreId,
          platformKeys: selectedPublishPlatforms,
          confirmDestructive
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; requiresDestructiveConfirmation?: boolean; totalChanges?: number };
      if (!response.ok && result.requiresDestructiveConfirmation && !confirmDestructive) {
        if (confirm(`${result.error}\n停止・削除を含めて配信しますか。`)) await startMenuPublish(true);
        return;
      }
      if (!response.ok) {
        setMessage(result.error || "メニュー配信を開始できませんでした。");
        return;
      }
      setMessage(`メニュー配信を開始しました（差分 ${result.totalChanges ?? 0}件）。`);
      await loadMenus(selectedItemId);
    } catch {
      setMessage("通信エラーでメニュー配信を開始できませんでした。");
    } finally {
      setPublishAction("");
    }
  }

  async function capturePlatformBaseline() {
    if (!activeBrandId || !publishStoreId || !selectedPublishPlatforms.length) {
      setMessage("店舗と取込先を選択してください。");
      return;
    }
    setPublishAction("capturing");
    setMessage("");
    try {
      const response = await fetch("/api/menus/publish-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "capture",
          brandId: activeBrandId,
          storeId: publishStoreId,
          platformKeys: selectedPublishPlatforms
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(result.error || "プラットフォーム基準取込を開始できませんでした。");
        return;
      }
      setMessage("プラットフォームの現在メニューを Bridge で取込中です。");
      await loadMenus(selectedItemId);
    } catch {
      setMessage("通信エラーで基準取込を開始できませんでした。");
    } finally {
      setPublishAction("");
    }
  }

  async function retryPublishTask(task: MenuSyncTask) {
    const response = await fetch("/api/menus/publish-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", taskId: task.id })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setMessage(response.ok ? `${task.platformName} の失敗タスクを再試行します。` : result.error || "再試行できませんでした。");
    if (response.ok) await loadMenus(selectedItemId);
  }

  async function adoptPlatformDifference(platform: MenuPublishPreviewPlatform, change: MenuPublishPreviewChange) {
    if (!change.targetId) return;
    const externalPlatform = brandExternalPlatforms.find((entry) => entry.platformKey === platform.platformKey);
    if (!externalPlatform) return;
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "adoptPlatformState",
        brandId: activeBrandId,
        externalPlatformId: externalPlatform.id,
        targetType: change.targetType,
        targetId: change.targetId,
        adoptName: change.kind === "rename",
        adoptPrice: change.kind === "reprice",
        adoptAvailability: change.kind === "update" || change.kind === "disable"
      })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setMessage(response.ok ? `${platform.platformName} の現在値を OS の個別設定に取り込みました。` : result.error || "プラットフォームの現在値を取り込めませんでした。");
    if (response.ok) await loadMenus(selectedItemId);
  }

  function openPlatformReconciliation(platformKey: MenuPublishPreviewPlatform["platformKey"]) {
    const details = document.getElementById(`menu-reconciliation-${platformKey}`) as HTMLDetailsElement | null;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusMenuSettingPanel() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const panel = document.getElementById("menu-os-setting-panel");
        if (!panel) return;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        panel.focus({ preventScroll: true });
      });
    });
  }

  function openReconciliationTarget(issue: MenuPlatformReconciliationIssue) {
    if (issue.targetType === "item") {
      const item = data.items.find((entry) => entry.id === issue.targetId);
      if (!item) {
        setActionNotice({ tone: "error", text: `${issue.targetLabel} の商品設定が見つかりません。メニューを再読み込みしてください。` });
        return;
      }
      selectItem(item);
    } else {
      const option = data.options.find((entry) => entry.id === issue.targetId);
      const group = option ? data.groups.find((entry) => entry.id === option.optionGroupId) : undefined;
      if (!option || !group) {
        setActionNotice({ tone: "error", text: `${issue.targetLabel} の選択肢設定が見つかりません。メニューを再読み込みしてください。` });
        return;
      }
      openChoiceSettings(group);
      editOption(option);
    }
    setMessage(`${issue.targetLabel} の OS 設定を開きました。`);
    setActionNotice({ tone: "info", text: `${issue.targetLabel} の OS 設定へ移動します。` });
    focusMenuSettingPanel();
  }

  async function recaptureReconciliationPlatform(platformKey: MenuPublishPreviewPlatform["platformKey"]) {
    if (!publishStoreId) throw new Error("対象店舗を選択してください。");
    const response = await fetch("/api/menus/publish-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "capture", brandId: activeBrandId, storeId: publishStoreId, platformKeys: [platformKey] })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || "再取込を開始できませんでした。");
  }

  async function disableReconciliationTarget(platform: MenuPublishPreviewPlatform, issue: MenuPlatformReconciliationIssue) {
    const externalPlatform = brandExternalPlatforms.find((entry) => entry.platformKey === platform.platformKey);
    if (!externalPlatform) {
      setActionNotice({ tone: "error", text: `${platform.platformName} の設定が見つかりません。ページを再読み込みしてください。` });
      return;
    }
    const actionKey = `${issue.id}:disable`;
    setReconciliationAction(actionKey);
    setMessage("");
    let settingSaved = false;
    try {
      const current = data.platformTargetSettings.find((setting) => (
        setting.externalPlatformId === externalPlatform.id && setting.targetType === issue.targetType && setting.targetId === issue.targetId
      ));
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "platformTargetSetting",
          brandId: activeBrandId,
          storeId: "",
          externalPlatformId: externalPlatform.id,
          targetType: issue.targetType,
          targetId: issue.targetId,
          isEnabled: false,
          nameOverride: current?.nameOverride ?? "",
          descriptionOverride: current?.descriptionOverride ?? "",
          priceOverride: current?.priceOverride ?? null,
          emojiMode: current?.emojiMode ?? "follow",
          placementConfig: { ...(current?.placementConfig ?? {}), confirmedPlatformCreate: false }
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "販売対象から除外できませんでした。");
      settingSaved = true;
      setActionNotice({ tone: "success", text: `${issue.targetLabel}を${platform.platformName}の販売対象から外しました。` });
      await recaptureReconciliationPlatform(platform.platformKey);
      setMessage(`${issue.targetLabel}を${platform.platformName}の販売対象から外し、再取込を開始しました。`);
      await loadMenus(selectedItemId);
    } catch (error) {
      const cause = error instanceof Error ? error.message : "対応を保存できませんでした。";
      const errorMessage = settingSaved
        ? `${issue.targetLabel}の販売除外は保存しましたが、再取込を開始できませんでした：${cause}`
        : cause;
      setMessage(errorMessage);
      setActionNotice({ tone: "error", text: errorMessage });
    } finally {
      setReconciliationAction("");
    }
  }

  async function confirmReconciliationCreate(platform: MenuPublishPreviewPlatform, issue: MenuPlatformReconciliationIssue) {
    const externalPlatform = brandExternalPlatforms.find((entry) => entry.platformKey === platform.platformKey);
    if (!externalPlatform) {
      setActionNotice({ tone: "error", text: `${platform.platformName} の設定が見つかりません。ページを再読み込みしてください。` });
      return;
    }
    const actionKey = `${issue.id}:create`;
    setReconciliationAction(actionKey);
    setMessage("");
    try {
      const current = data.platformTargetSettings.find((setting) => (
        setting.externalPlatformId === externalPlatform.id && setting.targetType === issue.targetType && setting.targetId === issue.targetId
      ));
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "platformTargetSetting",
          brandId: activeBrandId,
          storeId: "",
          externalPlatformId: externalPlatform.id,
          targetType: issue.targetType,
          targetId: issue.targetId,
          isEnabled: true,
          nameOverride: current?.nameOverride ?? "",
          descriptionOverride: current?.descriptionOverride ?? "",
          priceOverride: current?.priceOverride ?? null,
          emojiMode: current?.emojiMode ?? "follow",
          placementConfig: { ...(current?.placementConfig ?? {}), confirmedPlatformCreate: true }
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `${platform.platformName}への新規追加を確認できませんでした。`);
      const successMessage = `${issue.targetLabel}を${platform.platformName}に新規追加する対象として確認しました。`;
      setMessage(successMessage);
      setActionNotice({ tone: "success", text: successMessage });
      await loadMenus(selectedItemId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `${platform.platformName}への新規追加を確認できませんでした。`;
      setMessage(errorMessage);
      setActionNotice({ tone: "error", text: errorMessage });
    } finally {
      setReconciliationAction("");
    }
  }

  async function adoptReconciliationCandidate(
    platform: MenuPublishPreviewPlatform,
    issue: MenuPlatformReconciliationIssue,
    candidate: MenuPlatformReconciliationIssue["candidates"][number]
  ) {
    const externalPlatform = brandExternalPlatforms.find((entry) => entry.platformKey === platform.platformKey);
    if (!externalPlatform) {
      setActionNotice({ tone: "error", text: `${platform.platformName} の設定が見つかりません。ページを再読み込みしてください。` });
      return;
    }
    const actionKey = `${issue.id}:${candidate.externalId}`;
    setReconciliationAction(actionKey);
    setMessage("");
    let mappingSaved = false;
    try {
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "platformObjectMapping",
          brandId: activeBrandId,
          externalPlatformId: externalPlatform.id,
          targetType: issue.targetType,
          targetId: issue.targetId,
          externalId: candidate.externalId
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "候補を固定できませんでした。");
      mappingSaved = true;
      setActionNotice({ tone: "success", text: `${candidate.name}を対応先に固定しました。現在メニューを再取込します。` });
      await recaptureReconciliationPlatform(platform.platformKey);
      setMessage(`${candidate.name}を対応先に固定し、再取込を開始しました。`);
      await loadMenus(selectedItemId);
    } catch (error) {
      const cause = error instanceof Error ? error.message : "候補を固定できませんでした。";
      const errorMessage = mappingSaved
        ? `${candidate.name}の固定は保存しましたが、再取込を開始できませんでした：${cause}`
        : cause;
      setMessage(errorMessage);
      setActionNotice({ tone: "error", text: errorMessage });
    } finally {
      setReconciliationAction("");
    }
  }

  async function resolvePlatformCandidate(candidate: MenuPlatformImportCandidate, action: "ignore" | "restore" | "create_draft") {
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "platformImportCandidate", id: candidate.id, action })
    });
    const result = await response.json().catch(() => ({})) as { error?: string; itemId?: string };
    if (!response.ok) {
      setMessage(result.error || "プラットフォーム独自データを処理できませんでした。");
      return;
    }
    setMessage(action === "create_draft" ? "OS に未公開の商品下書きを作成しました。" : action === "ignore" ? "プラットフォーム専用として保持します。" : "確認待ちに戻しました。");
    await loadMenus(result.itemId || selectedItemId);
  }

  async function savePlatformTargetSetting(platform: MenuExternalPlatform, targetType: "item" | "option", targetId: string, patch: Partial<MenuPlatformTargetSetting>) {
    if (!targetId) return;
    const current = data.platformTargetSettings.find((setting) => (
      setting.externalPlatformId === platform.id && setting.targetType === targetType && setting.targetId === targetId
    ));
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "platformTargetSetting",
        brandId: activeBrandId,
        storeId: "",
        externalPlatformId: platform.id,
        targetType,
        targetId,
        isEnabled: current?.isEnabled ?? true,
        nameOverride: current?.nameOverride ?? "",
        descriptionOverride: current?.descriptionOverride ?? "",
        priceOverride: current?.priceOverride ?? null,
        emojiMode: current?.emojiMode ?? "follow",
        placementConfig: current?.placementConfig ?? {},
        ...patch
      })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(result.error || "プラットフォーム個別設定を保存できませんでした。");
      return;
    }
    setMessage(`${platform.name} の個別設定を保存しました。`);
    await loadMenus(selectedItemId);
  }

  async function loadMenus(nextSelectedItemId = selectedItemId) {
    setLoading(true);
    const response = await fetch("/api/menus");
    if (!response.ok) {
      setMessage("メニュー情報を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const nextData = await response.json() as MenuAdminData;
    const contextStore = nextData.stores.find((store) => store.id === nextData.selectedStoreId);
    const nextBrandId = activeBrandId || contextStore?.brandIds[0] || nextData.brands[0]?.id || "";
    const brandItems = nextData.items.filter((item) => item.brandId === nextBrandId && !item.storeId);
    const nextItem = brandItems.find((item) => item.id === nextSelectedItemId) ?? brandItems[0];

    setData(nextData);
    setActiveBrandId(nextBrandId);
    const eligibleStores = nextData.stores.filter((store) => store.brandIds.includes(nextBrandId));
    setPublishStoreId((current) => eligibleStores.some((store) => store.id === current)
      ? current
      : eligibleStores.find((store) => store.id === nextData.selectedStoreId)?.id ?? eligibleStores[0]?.id ?? "");
    setSelectedPublishPlatforms((current) => current.length ? current : nextData.externalPlatforms
      .filter((platform) => platform.brandId === nextBrandId && !platform.storeId && platform.isActive)
      .map((platform) => platform.platformKey));
    setSelectedItemId(nextItem?.id ?? "");
    setItemDraft(nextItem ? cloneItem(nextItem) : { ...emptyItem, brandId: nextBrandId, storeId: "" });
    setDetailMode("item");
    setActiveCategory((current) => current ?? nextItem?.category ?? null);
    setLoading(false);
    void loadPublishPreview(nextBrandId);
  }

  useEffect(() => {
    void loadMenus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    const hasRunningMenuTask = data.syncTasks.some((task) => (
      task.brandId === activeBrandId
      && (!publishStoreId || !task.storeId || task.storeId === publishStoreId)
      && ["queued", "processing", "retrying"].includes(task.status)
    ));
    if (!hasRunningMenuTask) return;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/menus", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const nextData = await response.json() as MenuAdminData;
      setData((current) => ({
        ...current,
        externalPlatforms: nextData.externalPlatforms,
        syncTasks: nextData.syncTasks,
        platformTargetSettings: nextData.platformTargetSettings,
        publishBatches: nextData.publishBatches,
        platformImportCandidates: nextData.platformImportCandidates
      }));
      const stillRunning = nextData.syncTasks.some((task) => (
        task.brandId === activeBrandId
        && (!publishStoreId || !task.storeId || task.storeId === publishStoreId)
        && ["queued", "processing", "retrying"].includes(task.status)
      ));
      if (!stillRunning) void loadPublishPreview(activeBrandId);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeBrandId, data.syncTasks, publishStoreId]);

  const filteredItems = useMemo(() => {
    const categoryOrders = new Map(
      data.categories
        .filter((category) => category.brandId === activeBrandId && !category.storeId)
        .map((category) => [category.name, category.sortOrder])
    );
    return data.items
      .filter((item) => {
        if (activeBrandId && item.brandId !== activeBrandId) return false;
        if (item.storeId) return false;
        return true;
      })
      .sort((a, b) => {
        const categoryA = a.category || "未分類";
        const categoryB = b.category || "未分類";
        return (
          (categoryOrders.get(categoryA) ?? 9999) - (categoryOrders.get(categoryB) ?? 9999) ||
          categoryA.localeCompare(categoryB, "ja") ||
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name, "ja")
        );
      });
  }, [activeBrandId, data.categories, data.items]);

  const categoryCounts = useMemo(() => getCategoryCounts(filteredItems, data.categories, activeBrandId), [activeBrandId, data.categories, filteredItems]);
  const currentCategory = activeCategory;
  const isChoiceSettingsView = currentCategory === choiceSettingsCategory;
  const isUberImportDraftView = currentCategory === uberImportDraftCategory;
  const uberImportDraftItems = useMemo(() => filteredItems.filter(isUberImportDraft), [filteredItems]);
  const categoryItems = useMemo(() => filteredItems.filter((item) => {
    if (isChoiceSettingsView) return false;
    if (isUberImportDraftView) return isUberImportDraft(item);
    if (currentCategory === null) return true;
    return (item.category || "未分類") === currentCategory;
  }), [currentCategory, filteredItems, isChoiceSettingsView, isUberImportDraftView]);

  const selectedSource = data.sources.find((source) => source.id === itemDraft.menuSourceId);
  const publicMenuUrl = buildPublicMenuUrl(activeBrandId);
  const brandExternalPlatforms = useMemo(() => data.externalPlatforms.filter((platform) => (
    platform.brandId === activeBrandId && !platform.storeId && supportedDeliveryPlatformKeys.has(platform.platformKey)
  )), [activeBrandId, data.externalPlatforms]);
  const publishStores = useMemo(() => data.stores.filter((store) => store.brandIds.includes(activeBrandId)), [activeBrandId, data.stores]);
  const brandSyncTasks = useMemo(() => data.syncTasks.filter((task) => (
    task.brandId === activeBrandId
      && (!task.storeId || !publishStoreId || task.storeId === publishStoreId)
      && supportedDeliveryPlatformKeys.has(data.externalPlatforms.find((platform) => platform.id === task.externalPlatformId)?.platformKey ?? "")
  )), [activeBrandId, data.externalPlatforms, data.syncTasks, publishStoreId]);
  const capturePlatformRows = useMemo(() => selectedPublishPlatforms.map((platformKey) => {
    const platform = brandExternalPlatforms.find((entry) => entry.platformKey === platformKey);
    const tasks = platform ? brandSyncTasks.filter((task) => (
      task.externalPlatformId === platform.id && menuCaptureTaskLabels.has(task.targetLabel)
    )) : [];
    const task = tasks.reduce<MenuSyncTask | undefined>((latest, candidate) => (
      !latest || new Date(candidate.createdAt).getTime() > new Date(latest.createdAt).getTime() ? candidate : latest
    ), undefined);
    return {
      platformKey,
      platformName: platform?.name ?? platformKey,
      task,
      preview: publishPreview?.platforms.find((entry) => entry.platformKey === platformKey)
    };
  }), [brandExternalPlatforms, brandSyncTasks, publishPreview, selectedPublishPlatforms]);
  const captureRunActive = publishAction === "capturing" || capturePlatformRows.some((row) => (
    row.task && runningMenuTaskStatuses.has(row.task.status)
  ));
  const captureFinishedCount = capturePlatformRows.filter((row) => row.task && terminalMenuTaskStatuses.has(row.task.status)).length;
  const captureDisplayedFinishedCount = publishAction === "capturing" ? 0 : captureFinishedCount;
  const captureFailedCount = capturePlatformRows.filter((row) => row.task?.status === "failed").length;
  const captureSucceededCount = capturePlatformRows.filter((row) => row.task && ["succeeded", "completed"].includes(row.task.status)).length;
  const pendingSyncTasks = brandSyncTasks.filter((task) => ["pending", "queued", "processing", "retrying", "failed"].includes(task.status));
  const completedSyncTasks = brandSyncTasks.filter((task) => ["completed", "succeeded"].includes(task.status)).slice(0, 8);
  const brandPublishBatches = data.publishBatches.filter((batch) => (
    batch.brandId === activeBrandId && (!publishStoreId || batch.storeId === publishStoreId)
  )).slice(0, 6);
  const brandPlatformCandidates = data.platformImportCandidates.filter((candidate) => (
    candidate.brandId === activeBrandId && (!publishStoreId || !candidate.storeId || candidate.storeId === publishStoreId)
  ));
  const availabilityTargetOptions = useMemo(() => {
    const itemOptions = data.items
      .filter((item) => item.brandId === activeBrandId && !item.storeId && item.isActive)
      .map((item) => ({ key: `item:${item.id}`, label: `商品 / ${item.name}` }));
    const groupsById = new Map(data.groups.map((group) => [group.id, group]));
    const optionOptions = data.options
      .filter((option) => {
        const group = groupsById.get(option.optionGroupId);
        return option.isActive && group?.isActive && group.brandId === activeBrandId;
      })
      .map((option) => {
        const group = groupsById.get(option.optionGroupId)!;
        return { key: `option:${option.id}`, label: `選択肢 / ${group.name} / ${option.name}` };
      });
    return [...itemOptions, ...optionOptions].sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [activeBrandId, data.groups, data.items, data.options]);
  const availabilityTargetLabels = useMemo(() => new Map(
    availabilityTargetOptions.map((option) => [option.key, option.label])
  ), [availabilityTargetOptions]);
  const brandAvailabilityLinks = data.availabilityLinks.filter((link) => link.brandId === activeBrandId);

  const visibleGroups = useMemo(() => {
    const explicitLinks = data.itemOptionGroups
      .filter((link) => link.isActive && link.menuCatalogItemId === itemDraft.id)
      .sort((left, right) => left.sortOrder - right.sortOrder);
    if (explicitLinks.length) {
      const groupById = new Map(data.groups.map((group) => [group.id, group]));
      return explicitLinks
        .map((link) => groupById.get(link.optionGroupId))
        .filter((group): group is MenuGroup => Boolean(group && group.brandId === activeBrandId));
    }
    return data.groups.filter((group) => {
      if (!activeBrandId || group.brandId !== activeBrandId) return false;
      if (group.menuCatalogItemId) return group.menuCatalogItemId === itemDraft.id;
      return !group.applicableCategories.length || group.applicableCategories.includes(itemDraft.category || "未分類");
    });
  }, [activeBrandId, data.groups, data.itemOptionGroups, itemDraft.category, itemDraft.id]);
  const brandGroups = useMemo(() => data.groups.filter((group) => {
    if (!activeBrandId || group.brandId !== activeBrandId) return false;
    if (!group.menuCatalogItemId) return true;
    return filteredItems.some((item) => item.id === group.menuCatalogItemId);
  }), [activeBrandId, data.groups, filteredItems]);
  const activeOptionGroup = activeOptionGroupId
    ? brandGroups.find((group) => group.id === activeOptionGroupId)
    : groupDraft.id
      ? brandGroups.find((group) => group.id === groupDraft.id)
      : undefined;
  const activeGroupOptions = activeOptionGroup ? data.options.filter((option) => option.optionGroupId === activeOptionGroup.id) : [];
  const groupDefaultCategories = useMemo(() => {
    if (groupDraft.menuCatalogItemId) {
      const targetItem = filteredItems.find((item) => item.id === groupDraft.menuCatalogItemId);
      return targetItem ? [targetItem.category || "未分類"] : [];
    }
    const applicable = new Set(groupDraft.applicableCategories);
    return categoryCounts
      .map((category) => category.name)
      .filter((categoryName) => !applicable.size || applicable.has(categoryName));
  }, [categoryCounts, filteredItems, groupDraft.applicableCategories, groupDraft.menuCatalogItemId]);

  function selectBrand(brandId: string) {
    const brandItems = data.items.filter((item) => item.brandId === brandId && !item.storeId);
    const nextItem = brandItems[0];
    setActiveBrandId(brandId);
    setActiveCategory(nextItem?.category || null);
    setSelectedItemId(nextItem?.id ?? "");
    setItemDraft(nextItem ? cloneItem(nextItem) : { ...emptyItem, brandId });
    setDetailMode("item");
    setCategoryDraft(emptyCategory);
    setGroupDraft({ ...emptyGroup, brandId });
    setOptionDraft(emptyOption);
    setActiveOptionGroupId("");
    const eligibleStores = data.stores.filter((store) => store.brandIds.includes(brandId));
    setPublishStoreId(eligibleStores.find((store) => store.id === data.selectedStoreId)?.id ?? eligibleStores[0]?.id ?? "");
    setSelectedPublishPlatforms(data.externalPlatforms
      .filter((platform) => platform.brandId === brandId && !platform.storeId && platform.isActive)
      .map((platform) => platform.platformKey));
    setAvailabilityLinkDraft({ sourceKey: "", dependentKey: "", isBidirectional: false });
    void loadPublishPreview(brandId);
  }

  function selectItem(item: MenuItem) {
    setSelectedItemId(item.id);
    setActiveCategory(currentCategory === uberImportDraftCategory ? uberImportDraftCategory : item.category || "未分類");
    setItemDraft(cloneItem(item));
    setDetailMode("item");
    setCategoryDraft(emptyCategory);
    setGroupDraft({ ...emptyGroup, brandId: item.brandId, menuCatalogItemId: item.id });
    setOptionDraft(emptyOption);
    setActiveOptionGroupId("");
  }

  function startNewItem() {
    const categoryForNewItem = currentCategory === null ? "" : currentCategory;
    const nextItem = {
      ...emptyItem,
      brandId: activeBrandId,
      storeId: "",
      category: categoryForNewItem === "未分類"
        || categoryForNewItem === choiceSettingsCategory
        || categoryForNewItem === uberImportDraftCategory
        ? ""
        : categoryForNewItem
    };
    setSelectedItemId("");
    setActiveCategory(null);
    setItemDraft(nextItem);
    setDetailMode("item");
    setCategoryDraft(emptyCategory);
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId });
    setOptionDraft(emptyOption);
    setActiveOptionGroupId("");
    setMessage("新しい商品を入力できます。");
  }

  function selectCategory(category: MenuCategorySummary) {
    setActiveCategory(category.name);
    setSelectedItemId("");
    setItemDraft({ ...emptyItem, brandId: activeBrandId, storeId: "", category: category.name === "未分類" ? "" : category.name });
    setDetailMode("category");
    setCategoryDraft({
      id: category.id,
      brandId: category.brandId || activeBrandId,
      storeId: category.storeId || "",
      externalId: category.externalId || "",
      name: category.name,
      note: category.note || "",
      isTapiocaFree: category.isTapiocaFree === true,
      hasWhipByDefault: category.hasWhipByDefault === true,
      sortOrder: category.sortOrder === 9999 ? (categoryCounts.length + 1) * 10 : category.sortOrder
    });
  }

  function startNewCategory() {
    setActiveCategory(null);
    setSelectedItemId("");
    setItemDraft({ ...emptyItem, brandId: activeBrandId, storeId: "" });
    setDetailMode("category");
    setCategoryDraft({
      ...emptyCategory,
      brandId: activeBrandId,
      sortOrder: (categoryCounts.length + 1) * 10
    });
    setMessage("新しい分類を入力できます。");
  }

  async function save(kind: "item" | "category" | "group" | "option", payload: Record<string, unknown>) {
    setMessage("");
    setSavingKind(kind);
    try {
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...payload })
      });
      const result = await response.json().catch(() => ({})) as { id?: string; externalId?: string; error?: string };
      if (!response.ok) {
        setMessage(result.error || "保存できませんでした。");
        return;
      }

      setMessage("保存しました。");
      if (kind === "category") {
        const nextName = String(payload.name ?? "").trim();
        setCategoryDraft((current) => ({
          ...current,
          id: result.id || current.id,
          externalId: result.externalId || current.externalId,
          name: nextName
        }));
        setActiveCategory(nextName || null);
        await loadMenus("");
        setSelectedItemId("");
        setDetailMode("category");
        return;
      }
      if (kind === "item") {
        await loadMenus(result.id || itemDraft.id);
        return;
      }
      if (kind === "group") {
        setActiveOptionGroupId(result.id || groupDraft.id);
        setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: itemDraft.id });
      }
      if (kind === "option") setOptionDraft({ ...emptyOption, optionGroupId: optionDraft.optionGroupId });
      await loadMenus(itemDraft.id);
    } catch {
      setMessage("通信エラーで保存できませんでした。");
    } finally {
      setSavingKind("");
    }
  }

  async function deleteEntry(kind: "item" | "category" | "group" | "option", id: string) {
    if (!confirm("削除しますか。")) return;
    const response = await fetch("/api/menus", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id })
    });
    if (!response.ok) {
      setMessage("削除できませんでした。関連データを確認してください。");
      return;
    }
    setMessage("削除しました。");
    if (kind === "category") {
      setActiveCategory(null);
      setCategoryDraft(emptyCategory);
      await loadMenus("");
      return;
    }
    if (kind === "item") {
      await loadMenus("");
      return;
    }
    await loadMenus(selectedItemId);
  }

  async function saveSortOrder(payload: Record<string, unknown>) {
    setMessage("");
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sortOrder", brandId: activeBrandId, storeId: "", ...payload })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      setMessage(result.error || "並び順を保存できませんでした。");
      await loadMenus(selectedItemId);
      return;
    }
    setMessage("並び順を保存しました。");
  }

  async function saveExternalPlatform(platform: MenuExternalPlatform, patch: Partial<MenuExternalPlatform>) {
    setMessage("");
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "externalPlatform",
        ...platform,
        ...patch,
        brandId: platform.brandId || activeBrandId,
        storeId: ""
      })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      setMessage(result.error || "外部プラットフォーム設定を保存できませんでした。");
      return;
    }
    await loadMenus(selectedItemId);
  }

  async function completeSyncTask(task: MenuSyncTask) {
    setMessage("");
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "completeSyncTask",
        id: task.id,
        completionNote: syncCompletionNotes[task.id] || ""
      })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      setMessage(result.error || "同期履歴を更新できませんでした。");
      return;
    }
    setSyncCompletionNotes((current) => {
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    setMessage("外部プラットフォーム反映済みにしました。");
    await loadMenus(selectedItemId);
  }

  async function saveAvailabilityLink() {
    const [sourceKind, sourceId] = availabilityLinkDraft.sourceKey.split(":") as ["item" | "option", string];
    const [dependentKind, dependentId] = availabilityLinkDraft.dependentKey.split(":") as ["item" | "option", string];
    if (!sourceId || !dependentId) {
      setMessage("起点と連動先を選択してください。");
      return;
    }
    if (availabilityLinkDraft.sourceKey === availabilityLinkDraft.dependentKey) {
      setMessage("同じメニュー同士は連動できません。");
      return;
    }
    setAvailabilityLinkSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "availabilityLink",
          sourceKind,
          sourceId,
          dependentKind,
          dependentId,
          isBidirectional: availabilityLinkDraft.isBidirectional
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(result.error || "販売状態の連動を保存できませんでした。");
        return;
      }
      setAvailabilityLinkDraft({ sourceKey: "", dependentKey: "", isBidirectional: false });
      setMessage("販売状態の連動を保存しました。");
      await loadMenus(selectedItemId);
    } catch {
      setMessage("通信エラーで販売状態の連動を保存できませんでした。");
    } finally {
      setAvailabilityLinkSaving(false);
    }
  }

  async function deleteAvailabilityLink(id: string) {
    const response = await fetch("/api/menus", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "availabilityLink", id })
    });
    if (!response.ok) {
      setMessage("販売状態の連動を削除できませんでした。");
      return;
    }
    setMessage("販売状態の連動を削除しました。");
    await loadMenus(selectedItemId);
  }

  function toggleTranslationLanguage(language: string, checked: boolean) {
    setTranslationLanguages((current) => (
      checked
        ? Array.from(new Set([...current, language]))
        : current.filter((entry) => entry !== language)
    ));
  }

  async function createTranslationPreview() {
    if (!activeBrandId) {
      setTranslationStatus("ブランドを選択してください。");
      return;
    }
    if (!translationLanguages.length) {
      setTranslationStatus("翻訳対象の言語を選択してください。");
      return;
    }

    setTranslationBusy("preview");
    setTranslationStatus("");
    setTranslationPreview(null);
    try {
      const response = await fetch("/api/menus/auto-translate/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: activeBrandId,
          languages: translationLanguages,
          overwriteExisting: translationOverwriteExisting
        })
      });
      const result = await response.json().catch(() => ({})) as MenuTranslationPreview & { error?: string };
      if (!response.ok) {
        setTranslationStatus(result.error || "翻訳プレビューを作成できませんでした。");
        return;
      }
      setTranslationPreview(result);
      setTranslationStatus(result.entries.length ? `${result.entries.length}件の翻訳候補を作成しました。` : "翻訳が必要な空欄・日本語混入はありません。");
    } catch {
      setTranslationStatus("通信エラーで翻訳プレビューを作成できませんでした。");
    } finally {
      setTranslationBusy("");
    }
  }

  function updateTranslationSuggestion(key: string, value: string) {
    setTranslationPreview((current) => current ? {
      ...current,
      entries: current.entries.map((entry) => entry.key === key ? { ...entry, suggestedText: value } : entry)
    } : current);
  }

  function removeTranslationSuggestion(key: string) {
    setTranslationPreview((current) => current ? {
      ...current,
      entries: current.entries.filter((entry) => entry.key !== key)
    } : current);
  }

  async function applyTranslationPreview() {
    if (!translationPreview || !activeBrandId) return;
    const entries = translationPreview.entries.filter((entry) => entry.suggestedText.trim());
    if (!entries.length) {
      setTranslationStatus("書き込む翻訳がありません。");
      return;
    }
    if (!confirm(`${entries.length}件の翻訳をメニューに書き込みますか。`)) return;

    setTranslationBusy("apply");
    setTranslationStatus("");
    try {
      const response = await fetch("/api/menus/auto-translate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: activeBrandId, entries })
      });
      const result = await response.json().catch(() => ({})) as { updated?: number; error?: string };
      if (!response.ok) {
        setTranslationStatus(result.error || "翻訳を書き込めませんでした。");
        return;
      }
      setTranslationStatus(`${result.updated ?? entries.length}件の翻訳を書き込みました。`);
      setTranslationPreview(null);
      await loadMenus(selectedItemId);
    } catch {
      setTranslationStatus("通信エラーで翻訳を書き込めませんでした。");
    } finally {
      setTranslationBusy("");
    }
  }

  function reorderCategories(targetCategory: string) {
    if (!draggingCategory || draggingCategory === targetCategory) return;
    const categoryNames = moveItem(
      categoryCounts.map((category) => category.name),
      categoryCounts.findIndex((category) => category.name === draggingCategory),
      categoryCounts.findIndex((category) => category.name === targetCategory)
    );
    setData((current) => {
      const existing = new Map(current.categories.map((category) => [`${category.brandId}:${category.storeId}:${category.name}`, category]));
      const nextCategories = categoryNames.map((name, index) => existing.get(`${activeBrandId}::${name}`) ?? {
        id: `local-${name}`,
        brandId: activeBrandId,
        storeId: "",
        externalId: "",
        name,
        note: "",
        isTapiocaFree: false,
        hasWhipByDefault: false,
        sortOrder: (index + 1) * 10
      });
      return {
        ...current,
        categories: [
          ...current.categories.filter((category) => category.brandId !== activeBrandId || category.storeId),
          ...nextCategories.map((category, index) => ({ ...category, sortOrder: (index + 1) * 10 }))
        ]
      };
    });
    void saveSortOrder({ categoryNames });
  }

  function reorderItems(targetItemId: string) {
    if (!draggingItemId || draggingItemId === targetItemId) return;
    const itemIds = moveItem(
      categoryItems.map((item) => item.id),
      categoryItems.findIndex((item) => item.id === draggingItemId),
      categoryItems.findIndex((item) => item.id === targetItemId)
    );
    setData((current) => ({
      ...current,
      items: current.items.map((item) => {
        const index = itemIds.indexOf(item.id);
        return index === -1 ? item : { ...item, sortOrder: (index + 1) * 10 };
      })
    }));
    void saveSortOrder({ itemIds, categoryName: currentCategory ?? "" });
  }

  async function uploadMenuPhoto(file: File) {
    setPhotoStatus("写真を処理中...");
    setMessage("");
    const uploadFile = await prepareMenuPhoto(file);
    setPhotoStatus("アップロード中...");
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("itemName", itemDraft.name || "menu-item");

    try {
      const response = await fetch("/api/menus/photo", {
        method: "POST",
        body: formData
      });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        setPhotoStatus(result.error || "写真をアップロードできませんでした。");
        return;
      }

      setItemDraft((current) => ({ ...current, imageUrl: result.url ?? "" }));
      setPhotoStatus("アップロードしました。商品を保存すると公開メニューに反映されます。");
    } catch {
      setPhotoStatus("通信エラーで写真をアップロードできませんでした。");
      setMessage("写真をアップロードできませんでした。");
    }
  }

  async function uploadMenuOptionPhoto(file: File) {
    setOptionPhotoStatus("写真を処理中...");
    setMessage("");
    const uploadFile = await prepareMenuPhoto(file);
    setOptionPhotoStatus("アップロード中...");
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("itemName", optionDraft.name || "menu-option");

    try {
      const response = await fetch("/api/menus/photo", {
        method: "POST",
        body: formData
      });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        setOptionPhotoStatus(result.error || "写真をアップロードできませんでした。");
        return;
      }

      setOptionDraft((current) => ({ ...current, imageUrl: result.url ?? "" }));
      setOptionPhotoStatus("アップロードしました。選択肢を保存すると公開メニューに反映されます。");
    } catch {
      setOptionPhotoStatus("通信エラーで写真をアップロードできませんでした。");
      setMessage("写真をアップロードできませんでした。");
    }
  }

  async function prepareMenuPhoto(file: File) {
    if (!file.type.startsWith("image/") || file.type.includes("heic") || file.type.includes("heif")) return file;
    if (file.size <= 1.5 * 1024 * 1024) return file;

    try {
      const compressed = await compressImageFile(file);
      return compressed.size < file.size ? compressed : file;
    } catch {
      return file;
    }
  }

  async function compressImageFile(file: File) {
    const image = await loadImageForCompression(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.72, 0.62]) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (blob.size <= 1.5 * 1024 * 1024 || quality === 0.62) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "menu-item"}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now()
        });
      }
    }

    return file;
  }

  function loadImageForCompression(file: File) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image load failed"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }

  function selectMenuPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setPhotoStatus("");
      setMessage("画像ファイルを選択してください。");
      return;
    }
    void uploadMenuPhoto(file);
  }

  function selectMenuOptionPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setOptionPhotoStatus("");
      setMessage("画像ファイルを選択してください。");
      return;
    }
    void uploadMenuOptionPhoto(file);
  }

  function updateAllowedOption(group: MenuGroup, option: MenuOption, checked: boolean) {
    const groupOptions = data.options.filter((entry) => entry.optionGroupId === group.id);
    const currentAllowed = getAllowedKeys(itemDraft, group, groupOptions);
    const optionKey = getOptionKey(option);
    if (checked) currentAllowed.add(optionKey);
    else currentAllowed.delete(optionKey);

    if (!checked && groupUsesFallbackAll(group) && currentAllowed.size === 0) {
      setMessage("元サイトとの互換性のため、最後の選択肢は外せません。");
      return;
    }

    const ruleKey = getRuleKey(group.groupKey);
    const allKeys = groupOptions.map(getOptionKey);
    const normalizedAllowed = Array.from(currentAllowed);
    const nextSchema = {
      ...itemDraft.variableSchema,
      [ruleKey]: normalizedAllowed.length === allKeys.length && groupUsesFallbackAll(group)
        ? undefined
        : normalizedAllowed
    };
    if (nextSchema[ruleKey] === undefined) delete nextSchema[ruleKey];
    setItemDraft({ ...itemDraft, variableSchema: nextSchema });
  }

  function updateItemWeightPricing(key: "mode" | "unit" | "unitPrice", value: string) {
    const currentPricing = typeof itemDraft.variableSchema.posWeightPricing === "object" && itemDraft.variableSchema.posWeightPricing !== null
      ? itemDraft.variableSchema.posWeightPricing as Record<string, unknown>
      : {};
    const nextPricing = {
      ...currentPricing,
      mode: String(currentPricing.mode ?? "weight"),
      unit: String(currentPricing.unit ?? "g"),
      [key]: key === "unitPrice"
        ? value.trim() ? Number(value) : null
        : value
    };
    setItemDraft({
      ...itemDraft,
      variableSchema: {
        ...itemDraft.variableSchema,
        posWeightPricing: nextPricing
      }
    });
  }

  function resetGroupDraftForItem() {
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: selectedItemId || "" });
    setActiveOptionGroupId("");
    setOptionDraft(emptyOption);
  }

  function startCommonGroup() {
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: "" });
    setActiveOptionGroupId("");
    setOptionDraft(emptyOption);
  }

  function toggleGroupCategory(categoryName: string, checked: boolean) {
    const next = new Set(groupDraft.applicableCategories);
    if (checked) next.add(categoryName);
    else next.delete(categoryName);
    setGroupDraft({ ...groupDraft, menuCatalogItemId: "", applicableCategories: Array.from(next) });
  }

  function toggleOptionCategory(categoryName: string, checked: boolean) {
    const next = new Set(optionDraft.applicableCategories);
    if (checked) next.add(categoryName);
    else next.delete(categoryName);
    setOptionDraft({ ...optionDraft, applicableCategories: Array.from(next) });
  }

  function editGroup(group: MenuGroup) {
    setActiveOptionGroupId(group.id);
    setGroupDraft(group);
    setOptionDraft({ ...emptyOption, optionGroupId: group.id });
  }

  function editOption(option: MenuOption) {
    setOptionDraft(option);
    setOptionPhotoStatus("");
    setActiveOptionGroupId(option.optionGroupId);
  }

  function openChoiceSettings(group?: MenuGroup) {
    setActiveCategory(choiceSettingsCategory);
    setCategoryDraft(emptyCategory);
    if (group) editGroup(group);
  }

  function openUberImportDrafts() {
    const nextItem = uberImportDraftItems[0];
    setActiveCategory(uberImportDraftCategory);
    setSelectedItemId(nextItem?.id ?? "");
    setItemDraft(nextItem ? cloneItem(nextItem) : { ...emptyItem, brandId: activeBrandId, storeId: "" });
    setDetailMode("item");
    setCategoryDraft(emptyCategory);
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: nextItem?.id ?? "" });
    setOptionDraft(emptyOption);
    setActiveOptionGroupId("");
  }

  function editGroupFromRule(group: MenuGroup) {
    openChoiceSettings(group);
    setMessage("選択グループを編集できます。");
  }

  function startOptionFromRule(group: MenuGroup) {
    openChoiceSettings(group);
    setOptionDraft({ ...emptyOption, optionGroupId: group.id });
    setMessage("新しい選択肢を入力できます。");
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>メニュー管理</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace menu-admin-page">
        {actionNotice ? (
          <div className={`menu-action-toast is-${actionNotice.tone}`} role={actionNotice.tone === "error" ? "alert" : "status"} aria-live="polite">
            {actionNotice.tone === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : actionNotice.tone === "error" ? <AlertTriangle size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
            <span>{actionNotice.text}</span>
            <button type="button" aria-label="通知を閉じる" onClick={() => setActionNotice(null)}>×</button>
          </div>
        ) : null}
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Menu Master</p>
            <h2>メニュー管理</h2>
            <p>分類、商品、サイズ・温度・辛さなどの選択肢を人が編集しやすい単位で管理します。</p>
          </div>
          <a className="secondary-button" href={publicMenuUrl} target="_blank" rel="noreferrer">
            公開 API を確認
          </a>
        </div>

        <section className="info-panel">
          <strong>編集の考え方</strong>
          <p>
            OS ではブランドの標準メニューを管理します。店舗ごとの販売可否は店舗画面で切り替え、
            ここでは分類、商品名、価格、公開状態、選択可否を中心に編集します。
          </p>
        </section>

        <section className="menu-auto-translation-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AI Translation</p>
              <h3>一括自動翻訳</h3>
            </div>
            <button
              className="primary-button compact-button"
              type="button"
              disabled={translationBusy === "preview" || !activeBrandId}
              onClick={() => void createTranslationPreview()}
            >
              <Sparkles size={15} />
              {translationBusy === "preview" ? "作成中" : "翻訳プレビュー"}
            </button>
          </div>
          <div className="menu-auto-translation-body">
            <div>
              <strong>対象</strong>
              <span>商品名、商品説明、選択グループ、選択肢の未翻訳欄と日本語混入を AI で候補作成します。確認するまで書き込みません。</span>
            </div>
            <div className="menu-auto-translation-controls">
              {customerMenuLanguageOptions.map((language) => (
                <label className="checkbox-group menu-inline-check" key={language.value}>
                  <input
                    type="checkbox"
                    checked={translationLanguages.includes(language.value)}
                    onChange={(event) => toggleTranslationLanguage(language.value, event.target.checked)}
                  />
                  <span>{language.label}</span>
                </label>
              ))}
              <label className="checkbox-group menu-inline-check">
                <input
                  type="checkbox"
                  checked={translationOverwriteExisting}
                  onChange={(event) => setTranslationOverwriteExisting(event.target.checked)}
                />
                <span>入力済みも候補作成</span>
              </label>
            </div>
          </div>
          {translationStatus ? <p className="menu-auto-translation-status">{translationStatus}</p> : null}
        </section>

        <details className="menu-sync-panel menu-availability-link-panel">
          <summary className="section-heading menu-sync-summary">
            <span className="menu-sync-summary-title">
              <span className="eyebrow">Availability Links</span>
              <span className="menu-sync-summary-heading">販売状態の連動</span>
            </span>
            <span className="menu-sync-summary-actions">
              <span className="menu-sync-count">設定 {brandAvailabilityLinks.length}件</span>
              <ChevronDown className="menu-sync-chevron" size={20} aria-hidden="true" />
            </span>
          </summary>
          <div className="menu-sync-body">
            <p className="menu-availability-link-help">
              メニュー商品・選択肢の名前どうしを直接つなぎます。商品マスタ、食材 SKU、操作手順からは自動判定しません。
            </p>
            <div className="menu-availability-link-form">
              <label>
                <span>起点</span>
                <select
                  value={availabilityLinkDraft.sourceKey}
                  onChange={(event) => setAvailabilityLinkDraft((current) => ({ ...current, sourceKey: event.target.value }))}
                >
                  <option value="">メニュー名を選択</option>
                  {availabilityTargetOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
                </select>
              </label>
              <span className="menu-availability-link-arrow" aria-hidden="true">
                {availabilityLinkDraft.isBidirectional ? "⇄" : "→"}
              </span>
              <label>
                <span>連動先</span>
                <select
                  value={availabilityLinkDraft.dependentKey}
                  onChange={(event) => setAvailabilityLinkDraft((current) => ({ ...current, dependentKey: event.target.value }))}
                >
                  <option value="">メニュー名を選択</option>
                  {availabilityTargetOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
                </select>
              </label>
              <label className="checkbox-group menu-inline-check">
                <input
                  type="checkbox"
                  checked={availabilityLinkDraft.isBidirectional}
                  onChange={(event) => setAvailabilityLinkDraft((current) => ({ ...current, isBidirectional: event.target.checked }))}
                />
                <span>相互連動</span>
              </label>
              <button
                className="primary-button compact-button"
                type="button"
                disabled={availabilityLinkSaving || !availabilityLinkDraft.sourceKey || !availabilityLinkDraft.dependentKey}
                onClick={() => void saveAvailabilityLink()}
              >
                <Link2 size={15} />
                {availabilityLinkSaving ? "保存中" : "追加"}
              </button>
            </div>
            <div className="menu-availability-link-list">
              {brandAvailabilityLinks.map((link) => {
                const sourceKey = `${link.sourceKind}:${link.sourceId}`;
                const dependentKey = `${link.dependentKind}:${link.dependentId}`;
                return (
                  <div className="menu-availability-link-row" key={link.id}>
                    <span>{availabilityTargetLabels.get(sourceKey) || "削除済みメニュー"}</span>
                    <b aria-label={link.isBidirectional ? "相互連動" : "片方向"}>{link.isBidirectional ? "⇄" : "→"}</b>
                    <span>{availabilityTargetLabels.get(dependentKey) || "削除済みメニュー"}</span>
                    <button className="danger-button compact-button" type="button" onClick={() => void deleteAvailabilityLink(link.id)}>
                      <Trash2 size={14} />
                      削除
                    </button>
                  </div>
                );
              })}
              {!brandAvailabilityLinks.length ? <p className="empty-state">まだ連動はありません。必要な組み合わせだけ追加してください。</p> : null}
            </div>
          </div>
        </details>

        <details className="menu-sync-panel" open>
          <summary className="section-heading menu-sync-summary">
            <span className="menu-sync-summary-title">
              <span className="eyebrow">External Platforms</span>
              <span className="menu-sync-summary-heading">外部プラットフォーム反映</span>
            </span>
            <span className="menu-sync-summary-actions">
              <span className={pendingSyncTasks.length ? "menu-sync-count is-pending" : "menu-sync-count"}>
                未反映 {pendingSyncTasks.length}件
              </span>
              <ChevronDown className="menu-sync-chevron" size={20} aria-hidden="true" />
            </span>
          </summary>
          <div className="menu-sync-body">
            <section className="menu-publish-preview" aria-live="polite">
              <div className="menu-publish-preview-head">
                <div>
                  <strong>配信前差分プレビュー</strong>
                  <span>OS を正として、基準取込 → 差分確認 → Bridge 反映 → 回読検証の順に実行します。</span>
                </div>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  disabled={!activeBrandId || publishPreviewStatus === "loading" || captureRunActive}
                  onClick={() => void loadPublishPreview(activeBrandId)}
                >
                  <RefreshCw className={publishPreviewStatus === "loading" ? "is-spinning" : ""} size={15} />
                  {publishPreviewStatus === "loading" ? "比較中" : "再比較"}
                </button>
              </div>
              <div className="menu-publish-controls">
                <div className="menu-publish-scope-fields">
                  <label>
                    <span>対象ブランド</span>
                    <select value={activeBrandId} onChange={(event) => selectBrand(event.target.value)}>
                      <option value="">ブランドを選択</option>
                      {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>対象店舗</span>
                    <select value={publishStoreId} onChange={(event) => setPublishStoreId(event.target.value)}>
                      <option value="">店舗を選択</option>
                      {publishStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>配信先</legend>
                  {brandExternalPlatforms.filter((platform) => platform.isActive).map((platform) => (
                    <label className="checkbox-group menu-inline-check" key={platform.id}>
                      <input
                        type="checkbox"
                        checked={selectedPublishPlatforms.includes(platform.platformKey)}
                        onChange={(event) => setSelectedPublishPlatforms((current) => event.target.checked
                          ? Array.from(new Set([...current, platform.platformKey]))
                          : current.filter((key) => key !== platform.platformKey))}
                      />
                      <span>{platform.name}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="menu-publish-control-actions">
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    disabled={Boolean(publishAction) || captureRunActive || !publishStoreId || !selectedPublishPlatforms.length}
                    onClick={() => void capturePlatformBaseline()}
                  >
                    <RefreshCw className={captureRunActive ? "is-spinning" : ""} size={15} />
                    {publishAction === "capturing"
                      ? "取込開始中"
                      : captureRunActive
                        ? `取込中 ${captureDisplayedFinishedCount}/${capturePlatformRows.length}`
                        : "現在メニューを取込"}
                  </button>
                  <button
                    className="primary-button compact-button"
                    type="button"
                    disabled={Boolean(publishAction) || captureRunActive || !publishStoreId || !selectedPublishPlatforms.length}
                    onClick={() => void startMenuPublish()}
                  >
                    <Upload size={15} />
                    {publishAction === "publishing" ? "配信開始中" : captureRunActive ? "取込完了待ち" : "差分を配信"}
                  </button>
                </div>
              </div>
              {capturePlatformRows.length ? (
                <section className={`menu-capture-progress${captureRunActive ? " is-running" : ""}${captureFailedCount ? " has-failure" : ""}`} aria-live="polite">
                  <div className="menu-capture-progress-head">
                    <div>
                      <strong>{captureRunActive ? "現在メニューを取込中" : "最新の取込結果"}</strong>
                      <span>{captureRunActive ? "Mac Bridge が各プラットフォームを順番に読み取っています。" : "取込完了と全件一致は別々に確認します。"}</span>
                    </div>
                    <b>{captureRunActive
                      ? `${captureDisplayedFinishedCount}/${capturePlatformRows.length}`
                      : captureFailedCount
                        ? `${captureSucceededCount}/${capturePlatformRows.length} 成功`
                        : `${captureSucceededCount}/${capturePlatformRows.length}`}</b>
                  </div>
                  <div className="menu-capture-progress-track" aria-hidden="true">
                    <span style={{ width: `${capturePlatformRows.length ? Math.round(captureDisplayedFinishedCount / capturePlatformRows.length * 100) : 0}%` }} />
                  </div>
                  <div className="menu-capture-progress-list">
                    {capturePlatformRows.map((row) => {
                      const task = row.task;
                      const isRunning = Boolean(task && runningMenuTaskStatuses.has(task.status));
                      const isFailed = task?.status === "failed";
                      const isComplete = Boolean(task && ["succeeded", "completed"].includes(task.status));
                      const needsReview = isComplete && row.preview?.baselineStatus === "missing";
                      return (
                        <div className={`menu-capture-progress-row${isRunning ? " is-running" : isFailed ? " is-failed" : needsReview ? " is-warning" : isComplete ? " is-complete" : ""}`} key={row.platformKey}>
                          <span className="menu-capture-progress-icon" aria-hidden="true">
                            {isRunning ? <RefreshCw className="is-spinning" size={15} /> : isFailed || needsReview ? <AlertTriangle size={15} /> : isComplete ? <CheckCircle2 size={15} /> : <span />}
                          </span>
                          <div>
                            <strong>{row.platformName}</strong>
                            <small>{task?.status === "succeeded" ? "取込完了" : task ? getMenuTaskStatus(task) : "まだ取込していません"}</small>
                          </div>
                          <div>
                            {needsReview && row.preview ? (
                              <button className="menu-capture-review-link" type="button" onClick={() => openPlatformReconciliation(row.platformKey as MenuPublishPreviewPlatform["platformKey"])}>
                                {getBaselineQuality(row.preview)}
                              </button>
                            ) : (
                              <span>{isComplete ? getBaselineQuality(row.preview) : isFailed ? task?.errorDetail || "再試行してください" : isRunning ? "Bridge 処理中" : "未実行"}</span>
                            )}
                            {task ? <small>{formatDateTime(task.completedAt || task.createdAt)}</small> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {publishPreviewStatus === "error" ? (
                <p className="menu-publish-preview-error">差分を読み込めませんでした。再比較してください。</p>
              ) : null}
              {publishPreview ? (
                <div className="menu-publish-platform-grid">
                  {publishPreview.platforms.map((platform) => {
                    const counts = platform.changes.reduce<Record<string, number>>((result, change) => {
                      result[change.kind] = (result[change.kind] ?? 0) + 1;
                      return result;
                    }, {});
                    return (
                      <article className="menu-publish-platform-card" key={platform.platformKey}>
                        <div className="menu-publish-platform-head">
                          <div>
                            <strong>{platform.platformName}</strong>
                            <small>{platform.ruleVersion}</small>
                          </div>
                          <span className={platform.baselineStatus === "missing" ? "is-blocked" : "is-ready"}>
                            {platform.baselineStatus === "ready" ? "基準取込済み" : platform.baselineStatus === "confirmed" ? "対応確認済み" : platform.baselineCapturedAt ? "取込済み・要確認" : "基準未取込"}
                          </span>
                        </div>
                        <p className="menu-publish-rule-summary">{getPlatformRuleSummary(platform.platformKey)}</p>
                        <div className="menu-publish-counts">
                          {(["create", "rename", "reprice", "update", "move", "disable", "delete"] as const).map((kind) => (
                            counts[kind] ? <span key={kind}><b>{counts[kind]}</b>{getPublishChangeLabel(kind)}</span> : null
                          ))}
                          {!platform.changes.length ? <span className="is-empty">確定差分なし</span> : null}
                        </div>
                        {platform.blockers.map((blocker) => platform.reconciliationIssues?.length && blocker.includes("取込結果") ? (
                          <button className="menu-publish-notice is-blocker is-actionable" type="button" key={blocker} onClick={() => openPlatformReconciliation(platform.platformKey)}>
                            <AlertTriangle size={14} />
                            <span>{blocker}</span>
                          </button>
                        ) : (
                          <p className="menu-publish-notice is-blocker" key={blocker}>
                            <AlertTriangle size={14} />
                            <span>{blocker}</span>
                          </p>
                        ))}
                        {platform.warnings.map((warning) => (
                          <p className="menu-publish-notice is-warning" key={warning}>
                            <AlertTriangle size={14} />
                            <span>{warning}</span>
                          </p>
                        ))}
                        {platform.reconciliationIssues?.length ? (
                          <details className="menu-reconciliation-details" id={`menu-reconciliation-${platform.platformKey}`}>
                            <summary>
                              <span>対応確認 {platform.reconciliationIssues.length}件</span>
                              <small>所属先を見て、その場で処理</small>
                            </summary>
                            <div className="menu-reconciliation-list">
                              {platform.reconciliationIssues.map((issue) => (
                                <article className={`menu-reconciliation-row is-${issue.issueKind}`} key={issue.id}>
                                  <div className="menu-reconciliation-heading">
                                    <span>{issue.issueKind === "multiple" ? "候補重複" : "未検出"}</span>
                                    <div>
                                      <strong>{issue.targetLabel}</strong>
                                      <small>{issue.targetType === "item" ? "商品" : "選択肢"} / {issue.locationLabel}</small>
                                    </div>
                                  </div>
                                  {issue.issueKind === "multiple" ? (
                                    <div className="menu-reconciliation-candidates">
                                      <p>{platform.platformName} に複数候補があります。正しい1件を固定してください。</p>
                                      {issue.candidates.map((candidate) => (
                                        <div className="menu-reconciliation-candidate" key={candidate.externalId}>
                                          <div>
                                            <strong>{candidate.name}</strong>
                                            <small>{candidate.price === null ? "価格未取得" : `¥${candidate.price.toLocaleString("ja-JP")}`}</small>
                                          </div>
                                          <button
                                            className="secondary-button compact-button"
                                            type="button"
                                            disabled={Boolean(reconciliationAction)}
                                            onClick={() => void adoptReconciliationCandidate(platform, issue, candidate)}
                                          >
                                            {reconciliationAction === `${issue.id}:${candidate.externalId}` ? "固定中" : "この候補に固定"}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p>{platform.platformName} の最新メニューに対応先がありません。次回の配信で追加するか、この配信先では販売しないかを選択してください。</p>
                                  )}
                                  <div className="menu-reconciliation-actions">
                                    {issue.issueKind === "missing" ? (
                                      <button
                                        className="primary-button compact-button"
                                        type="button"
                                        disabled={Boolean(reconciliationAction)}
                                        onClick={() => void confirmReconciliationCreate(platform, issue)}
                                      >
                                        {reconciliationAction === `${issue.id}:create` ? "確認中" : "追加を配信対象にする"}
                                      </button>
                                    ) : null}
                                    {issue.issueKind === "missing" ? (
                                      <button
                                        className="secondary-button compact-button"
                                        type="button"
                                        disabled={Boolean(reconciliationAction)}
                                        onClick={() => void disableReconciliationTarget(platform, issue)}
                                      >
                                        {reconciliationAction === `${issue.id}:disable` ? "保存中" : `${platform.platformName}では販売しない`}
                                      </button>
                                    ) : null}
                                    <button className="secondary-button compact-button" type="button" onClick={() => openReconciliationTarget(issue)}>
                                      OS 設定を編集
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {platform.changes.length ? (
                          <details className="menu-publish-change-details">
                            <summary>差分 {platform.changes.length}件を見る</summary>
                            <div className="menu-publish-change-list">
                              {platform.changes.map((change) => (
                                <div className="menu-publish-change-row" key={change.id}>
                                  <span className={`menu-publish-change-kind is-${change.kind}`}>{getPublishChangeLabel(change.kind)}</span>
                                  <div>
                                    <strong>{change.targetLabel}</strong>
                                    {change.locationLabel ? <span className="menu-publish-change-location">{change.targetType === "item" ? "商品" : change.targetType === "option" ? "選択肢" : "対象"} / {change.locationLabel}</span> : null}
                                    <p>{change.summary}</p>
                                    {change.currentValue || change.projectedValue ? (
                                      <small>
                                        {change.currentValue ? `現在: ${change.currentValue}` : ""}
                                        {change.currentValue && change.projectedValue ? " → " : ""}
                                        {change.projectedValue ? `予定: ${change.projectedValue}` : ""}
                                      </small>
                                    ) : null}
                                    {change.targetId && ["rename", "reprice", "update", "disable"].includes(change.kind) ? (
                                      <button
                                        className="menu-publish-adopt-button"
                                        type="button"
                                        onClick={() => void adoptPlatformDifference(platform, change)}
                                      >
                                        プラットフォーム現在値を採用
                                      </button>
                                    ) : null}
                                  </div>
                                  {change.confidence === "provisional" ? <em>要確認</em> : null}
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : publishPreviewStatus === "loading" ? <p className="empty-state">プラットフォーム別の差分を比較しています。</p> : null}
            </section>
            {brandPlatformCandidates.length ? (
              <details className="menu-platform-candidate-panel">
                <summary>
                  <span>プラットフォームで見つかった OS 未登録データ</span>
                  <b>{brandPlatformCandidates.filter((candidate) => candidate.status === "pending").length}件確認待ち</b>
                </summary>
                <p>スタッフがプラットフォーム側で追加した可能性があります。自動削除・自動上書きはしません。</p>
                <div className="menu-platform-candidate-list">
                  {brandPlatformCandidates.map((candidate) => (
                    <div className={`menu-platform-candidate-row is-${candidate.status}`} key={candidate.id}>
                      <div>
                        <strong>{candidate.observedName || "名称不明"}</strong>
                        <span>{candidate.platformName} / {candidate.targetType === "item" ? "商品" : "選択肢"}</span>
                        <small>最終確認 {formatDateTime(candidate.lastSeenAt)} / ID {candidate.externalId}</small>
                      </div>
                      <span>{candidate.status === "ignored" ? "プラットフォーム専用" : "確認待ち"}</span>
                      <div className="menu-platform-candidate-actions">
                        {candidate.status === "ignored" ? (
                          <button className="secondary-button compact-button" type="button" onClick={() => void resolvePlatformCandidate(candidate, "restore")}>再確認する</button>
                        ) : (
                          <>
                            {candidate.targetType === "item" && (candidate.observedPayload.metadata as Record<string, unknown> | undefined)?.kindConfidence !== "unknown" ? (
                              <button className="primary-button compact-button" type="button" onClick={() => void resolvePlatformCandidate(candidate, "create_draft")}>OS に下書き作成</button>
                            ) : null}
                            <button className="secondary-button compact-button" type="button" onClick={() => void resolvePlatformCandidate(candidate, "ignore")}>プラットフォーム専用</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <div className="menu-platform-list">
              {brandExternalPlatforms.map((platform) => (
                <div className="menu-platform-row" key={platform.id}>
                  <label className="checkbox-group menu-inline-check">
                    <input
                      type="checkbox"
                      checked={platform.isActive}
                      onChange={(event) => void saveExternalPlatform(platform, { isActive: event.target.checked })}
                    />
                    <span>{platform.name}<small>{platform.ruleVersion}</small></span>
                  </label>
                  <input
                    value={platform.managementUrl}
                    onChange={(event) => {
                      const value = event.target.value;
                      setData((current) => ({
                        ...current,
                        externalPlatforms: current.externalPlatforms.map((entry) => (
                          entry.id === platform.id ? { ...entry, managementUrl: value } : entry
                        ))
                      }));
                    }}
                    onBlur={(event) => void saveExternalPlatform(platform, { managementUrl: event.target.value })}
                    placeholder="管理画面 URL"
                  />
                  {platform.managementUrl ? (
                    <a className="secondary-button compact-button" href={platform.managementUrl} target="_blank" rel="noreferrer">
                      開く
                    </a>
                  ) : null}
                </div>
              ))}
              {!brandExternalPlatforms.length ? <p className="empty-state">ブランドを選ぶと Uber Eats などの反映先が表示されます。</p> : null}
            </div>
            {brandPublishBatches.length ? (
              <div className="menu-publish-batch-list">
                {brandPublishBatches.map((batch) => (
                  <div className="menu-publish-batch-row" key={batch.id}>
                    <div>
                      <strong>{formatDateTime(batch.createdAt)} のメニュー配信</strong>
                      <small>{batch.requestedPlatforms.map((key) => brandExternalPlatforms.find((platform) => platform.platformKey === key)?.name || key).join(" / ")}</small>
                    </div>
                    <span className={`is-${batch.status}`}>{({
                      queued: "待機中",
                      processing: "同期中",
                      succeeded: "全平台確認済み",
                      partially_succeeded: "一部失敗",
                      failed: "失敗"
                    } as Record<string, string>)[batch.status] || batch.status}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="menu-sync-task-list">
              {pendingSyncTasks.map((task) => (
                <div className={`menu-sync-task-row is-${task.status}`} key={task.id}>
                  <div>
                    <strong>{task.platformName} / {task.targetLabel}</strong>
                    <span>{task.changeSummary}</span>
                    <small>{formatDateTime(task.createdAt)} {task.createdByName ? ` / ${task.createdByName}` : ""}</small>
                    {task.errorDetail ? <small className="menu-sync-task-error">{task.errorDetail}</small> : null}
                  </div>
                  <span className={`menu-sync-task-status is-${task.status}`}>{getMenuTaskStatus(task)}</span>
                  {task.status === "pending" ? (
                    <div className="menu-sync-manual-actions">
                      <input
                        value={syncCompletionNotes[task.id] || ""}
                        onChange={(event) => setSyncCompletionNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                        placeholder="反映メモ"
                      />
                      <button className="primary-button compact-button" type="button" onClick={() => void completeSyncTask(task)}>
                        <CheckCircle2 size={15} />
                        手動反映済み
                      </button>
                    </div>
                  ) : task.status === "failed" && task.isRetryable ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => void retryPublishTask(task)}>
                      <RefreshCw size={15} />
                      再試行
                    </button>
                  ) : <span />}
                </div>
              ))}
              {!pendingSyncTasks.length ? <p className="empty-state">現在、外部プラットフォームへ反映待ちの変更はありません。</p> : null}
            </div>
            {completedSyncTasks.length ? (
              <details className="menu-sync-history">
                <summary>最近の反映履歴</summary>
                <div>
                  {completedSyncTasks.map((task) => (
                    <p key={task.id}>
                      <strong>{task.platformName}</strong>
                      <span>{task.targetLabel} / {formatDateTime(task.completedAt)} {task.completedByName ? ` / ${task.completedByName}` : ""}</span>
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </details>

        <div className="filter-bar">
          <label>
            <span>ブランド</span>
            <select value={activeBrandId} onChange={(event) => selectBrand(event.target.value)}>
              <option value="">選択</option>
              {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <code>{publicMenuUrl}</code>
        </div>

        {message ? <div className="inline-alert">{message}</div> : null}

        <div className="menu-editor-layout">
          <aside className="menu-category-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Categories</p>
                <h3>分類</h3>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={startNewCategory}>
                <Plus size={15} />
                追加
              </button>
            </div>
            <button
              className={currentCategory === null ? "menu-category-button is-active" : "menu-category-button"}
              type="button"
              onClick={() => {
                setActiveCategory(null);
                setSelectedItemId("");
                setItemDraft({ ...emptyItem, brandId: activeBrandId, storeId: "" });
                setDetailMode("item");
                setCategoryDraft(emptyCategory);
              }}
            >
              <span>すべて</span>
              <strong>{filteredItems.length}</strong>
            </button>
            <button
              className={isUberImportDraftView ? "menu-category-button is-active is-import-draft" : "menu-category-button is-import-draft"}
              type="button"
              onClick={openUberImportDrafts}
            >
              <span>
                Uber取り込み下書き
                <small>未公開</small>
              </span>
              <strong>{uberImportDraftItems.length}</strong>
            </button>
            {categoryCounts.map((category) => (
              <button
                className={currentCategory === category.name ? "menu-category-button is-active" : "menu-category-button"}
                type="button"
                draggable
                onDragStart={() => setDraggingCategory(category.name)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderCategories(category.name)}
                onDragEnd={() => setDraggingCategory("")}
                onClick={() => selectCategory(category)}
                key={category.name}
                title="ドラッグして分類順を変更"
              >
                <span>
                  {category.name}
                  {category.note ? <small>説明あり</small> : null}
                </span>
                <strong>{category.count}</strong>
              </button>
            ))}
            <button
              className={isChoiceSettingsView ? "menu-category-button is-active is-settings" : "menu-category-button is-settings"}
              type="button"
              onClick={() => openChoiceSettings()}
            >
              <span>選択肢設定</span>
              <strong>{brandGroups.length}</strong>
            </button>
          </aside>

          <aside className="menu-item-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{isChoiceSettingsView ? "Choice Groups" : isUberImportDraftView ? "Uber Import" : "Items"}</p>
                <h3>{isChoiceSettingsView ? "選択グループ" : isUberImportDraftView ? "Uber取り込み下書き" : "商品"}</h3>
              </div>
              {isChoiceSettingsView ? (
                <button className="secondary-button" type="button" onClick={startCommonGroup}>
                  <Plus size={16} />
                  共通追加
                </button>
              ) : isUberImportDraftView ? (
                <span className="menu-draft-count">未公開 {uberImportDraftItems.length}件</span>
              ) : (
                <button className="secondary-button" type="button" onClick={startNewItem}>
                  <Plus size={16} />
                  商品追加
                </button>
              )}
            </div>
            <div className="menu-item-list">
              {isChoiceSettingsView ? (
                <>
                  {brandGroups.map((group) => (
                    <button
                      className={activeOptionGroup?.id === group.id ? "menu-item-button is-active" : "menu-item-button"}
                      type="button"
                      onClick={() => editGroup(group)}
                      key={group.id}
                    >
                      <strong>{group.name}</strong>
                      <span>
                        {getGroupScopeLabel(group, filteredItems)}
                        {" / "}
                        {group.groupKey}
                      </span>
                    </button>
                  ))}
                  {!brandGroups.length ? <p className="empty-state">選択グループがありません。</p> : null}
                </>
              ) : (
                <>
                  {categoryItems.map((item) => (
                    <button
                      className={selectedItemId === item.id ? "menu-item-button is-active" : "menu-item-button"}
                      type="button"
                      draggable={!isUberImportDraftView}
                      onDragStart={() => setDraggingItemId(item.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (!isUberImportDraftView) reorderItems(item.id);
                      }}
                      onDragEnd={() => setDraggingItemId("")}
                      onClick={() => selectItem(item)}
                      key={item.id}
                      title="ドラッグして商品順を変更"
                    >
                      {item.promotionPrefix ? <small className="menu-item-promotion-prefix">{item.promotionPrefix}</small> : null}
                      <strong>{item.name}</strong>
                      <span>
                        {item.category || "未分類"} / {item.basePrice == null ? "価格未設定" : `${item.basePrice.toLocaleString()}円`}
                        {!item.isActive ? " / 未公開" : ""}
                      </span>
                    </button>
                  ))}
                  {!categoryItems.length ? <p className="empty-state">{loading ? "読み込み中..." : "商品がありません。"}</p> : null}
                </>
              )}
            </div>
          </aside>

          <section className="menu-detail-panel" id="menu-os-setting-panel" tabIndex={-1}>
            {isChoiceSettingsView ? (
              <section className="menu-edit-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Choice Settings</p>
                    <h3>選択グループと選択肢</h3>
                  </div>
                  <div className="row-actions">
                    <button className="secondary-button" type="button" onClick={startCommonGroup}>
                      <Plus size={16} />
                      共通グループ
                    </button>
                    <button className="secondary-button" type="button" onClick={resetGroupDraftForItem}>
                      <Plus size={16} />
                      商品専用グループ
                    </button>
                  </div>
                </div>

                <div className="menu-choice-editor menu-choice-editor-single">
                  <aside className="menu-choice-group-list">
                    {brandGroups.map((group) => (
                      <button
                        className={activeOptionGroup?.id === group.id ? "menu-choice-group-button is-active" : "menu-choice-group-button"}
                        type="button"
                        onClick={() => editGroup(group)}
                        key={group.id}
                      >
                        <strong>{group.name}</strong>
                        <span>
                          {getGroupScopeLabel(group, filteredItems)}
                          {" / "}
                          {group.groupKey}
                          {!group.isActive ? " / 停止中" : ""}
                        </span>
                      </button>
                    ))}
                    {!brandGroups.length ? <p className="empty-state">選択グループがありません。共通グループまたは商品専用グループを追加してください。</p> : null}
                  </aside>

                  <div className="menu-choice-detail">
                    <div className="menu-option-form">
                      <div className="section-heading compact-heading">
                        <div>
                          <p className="eyebrow">Group</p>
                          <h4>{groupDraft.id ? groupDraft.name || "選択グループ" : "新しい選択グループ"}</h4>
                        </div>
                        {groupDraft.id ? (
                          <button className="danger-button" type="button" onClick={() => void deleteEntry("group", groupDraft.id)}>
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                      </div>
                      <label>
                        <span>対象</span>
                        <select value={groupDraft.menuCatalogItemId} onChange={(event) => setGroupDraft({ ...groupDraft, menuCatalogItemId: event.target.value, applicableCategories: event.target.value ? [] : groupDraft.applicableCategories })}>
                          <option value="">分類またはブランド全体で指定</option>
                          {filteredItems.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                      {!groupDraft.menuCatalogItemId ? (
                        <fieldset className="menu-category-scope">
                          <legend>適用する商品分類</legend>
                          <p>未選択の場合は、このブランドの全商品に表示されます。</p>
                          <div className="menu-category-scope-grid">
                            {categoryCounts.map((category) => (
                              <label className="checkbox-group menu-inline-check" key={category.name}>
                                <input
                                  type="checkbox"
                                  checked={groupDraft.applicableCategories.includes(category.name)}
                                  onChange={(event) => toggleGroupCategory(category.name, event.target.checked)}
                                />
                                <span>{category.name}（{category.count}商品）</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      ) : null}
                      <div className="menu-form-grid">
                        <label>
                          <span>表示名</span>
                          <input value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} placeholder="例: サイズ" />
                        </label>
                        <label>
                          <span>内部キー</span>
                          <input value={groupDraft.groupKey} onChange={(event) => setGroupDraft({ ...groupDraft, groupKey: event.target.value })} placeholder="例: size" />
                          <small>未入力なら表示名から自動生成します。</small>
                        </label>
                        <label>
                          <span>選択方式</span>
                          <select value={groupDraft.selectionType} onChange={(event) => setGroupDraft({ ...groupDraft, selectionType: event.target.value })}>
                            {selectionTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>全分類のデフォルト</span>
                          <select
                            value={getDefaultOptionKey(groupDraft)}
                            onChange={(event) => setGroupDraft(updateGroupDefaultOption(groupDraft, event.target.value))}
                            disabled={!groupDraft.id || !activeGroupOptions.length}
                          >
                            <option value="">指定なし</option>
                            {activeGroupOptions.map((option) => (
                              <option value={getOptionKey(option)} key={option.id}>{option.name}</option>
                            ))}
                          </select>
                          <small>分類別の指定がない場合に使う共通の初期値です。</small>
                        </label>
	                        <label>
	                          <span>並び順</span>
	                          <input value={groupDraft.sortOrder} onChange={(event) => setGroupDraft({ ...groupDraft, sortOrder: Number(normalizeIntegerInput(event.target.value) || 0) })} inputMode="numeric" />
	                        </label>
	                      </div>
                      <fieldset className="menu-category-defaults">
                        <legend>商品分類ごとのデフォルト</legend>
                        <p>POS・テーブル注文で商品を選んだ時の初期値です。「全分類に従う」で上の共通値を使います。</p>
                        <div className="menu-category-default-list">
                          {groupDefaultCategories.map((categoryName) => {
                            const categoryOptions = activeGroupOptions.filter((option) => (
                              !option.applicableCategories.length || option.applicableCategories.includes(categoryName)
                            ));
                            return (
                              <label key={categoryName}>
                                <span>{categoryName}</span>
                                <select
                                  value={getCategoryDefaultOptionKey(groupDraft, categoryName)}
                                  onChange={(event) => setGroupDraft(updateGroupCategoryDefaultOption(groupDraft, categoryName, event.target.value))}
                                  disabled={!groupDraft.id || !categoryOptions.length}
                                >
                                  <option value="">全分類に従う</option>
                                  {categoryOptions.map((option) => (
                                    <option value={getOptionKey(option)} key={option.id}>{option.name}</option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                      <div className="menu-translation-panel">
                        <div>
                          <strong>客表示・会員・ブランドサイト用表示名</strong>
                          <span>選択グループ名も多言語表示時に使います。</span>
                        </div>
                        <div className="menu-translation-grid">
                          {customerMenuLanguageOptions.map((language) => (
                            <label key={language.value}>
                              <span>{language.label}</span>
                              <input
                                value={groupDraft.displayNames?.[language.value] ?? ""}
                                onChange={(event) => setGroupDraft(updateDisplayName(groupDraft, language.value, event.target.value))}
                                placeholder={groupDraft.name || "表示名"}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
	                      <label className="checkbox-group menu-inline-check">
	                        <input type="checkbox" checked={groupDraft.affectsProcedure} onChange={(event) => setGroupDraft({ ...groupDraft, affectsProcedure: event.target.checked })} />
	                        <span>手順に影響する</span>
                      </label>
                      <label className="checkbox-group menu-inline-check">
                        <input type="checkbox" checked={groupDraft.isActive} onChange={(event) => setGroupDraft({ ...groupDraft, isActive: event.target.checked })} />
                        <span>メニューに表示する</span>
                      </label>
                      <button className="primary-button" type="button" disabled={savingKind === "group"} onClick={() => void save("group", { ...groupDraft, brandId: groupDraft.brandId || activeBrandId })}>
                        <Save size={16} />
                        {savingKind === "group" ? "保存中" : "グループを保存"}
                      </button>
                    </div>

                    <div className="menu-option-form">
                      <div className="section-heading compact-heading">
                        <div>
                          <p className="eyebrow">Options</p>
                          <h4>{activeOptionGroup ? `${activeOptionGroup.name} の選択肢` : "選択肢"}</h4>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!activeOptionGroup}
                          onClick={() => setOptionDraft({ ...emptyOption, optionGroupId: activeOptionGroup?.id ?? "" })}
                        >
                          <Plus size={16} />
                          選択肢追加
                        </button>
                      </div>
                      <div className="menu-option-tags menu-option-edit-tags">
                        {activeGroupOptions.map((option) => (
                          <button
                            className={optionDraft.id === option.id ? "menu-option-tag is-active" : "menu-option-tag"}
                            type="button"
                            onClick={() => editOption(option)}
                            key={option.id}
                          >
                            {option.name}
                            {!option.isActive ? " / 停止中" : ""}
                          </button>
                        ))}
                        {activeOptionGroup && !activeGroupOptions.length ? <p className="empty-state">このグループには選択肢がありません。</p> : null}
                        {!activeOptionGroup ? <p className="empty-state">左側でグループを選ぶか、新しいグループを追加してください。</p> : null}
                      </div>
                      <div className="menu-form-grid">
                        <label>
                          <span>表示名</span>
                          <input value={optionDraft.name} onChange={(event) => setOptionDraft({ ...optionDraft, name: event.target.value })} placeholder="例: HOT" />
                        </label>
                        <label>
                          <span>内部キー</span>
                          <input value={optionDraft.optionKey} onChange={(event) => setOptionDraft({ ...optionDraft, optionKey: event.target.value })} placeholder="例: hot" />
                          <small>未入力なら表示名から自動生成します。</small>
                        </label>
                        <label>
                          <span>価格差額</span>
                          <input value={optionDraft.priceDelta ?? ""} onChange={(event) => {
                            const value = normalizeDecimalInput(event.target.value);
                            setOptionDraft({ ...optionDraft, priceDelta: value ? Number(value) : null });
                          }} inputMode="decimal" />
                        </label>
	                        <label>
	                          <span>並び順</span>
	                          <input value={optionDraft.sortOrder} onChange={(event) => setOptionDraft({ ...optionDraft, sortOrder: Number(normalizeIntegerInput(event.target.value) || 0) })} inputMode="numeric" />
	                        </label>
	                      </div>
                      <fieldset className="menu-category-scope">
                        <legend>この選択肢を表示する商品分類</legend>
                        <p>未選択の場合は、上の選択グループが適用される全商品に表示されます。</p>
                        <div className="menu-category-scope-grid">
                          {categoryCounts.map((category) => (
                            <label className="checkbox-group menu-inline-check" key={category.name}>
                              <input
                                type="checkbox"
                                checked={optionDraft.applicableCategories.includes(category.name)}
                                onChange={(event) => toggleOptionCategory(category.name, event.target.checked)}
                              />
                              <span>{category.name}（{category.count}商品）</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="menu-translation-panel">
                        <div>
                          <strong>客表示・会員・ブランドサイト用表示名</strong>
                          <span>サイズ、温度、辛さ、追加オプション名にも使います。</span>
                        </div>
                        <div className="menu-translation-grid">
                          {customerMenuLanguageOptions.map((language) => (
                            <label key={language.value}>
                              <span>{language.label}</span>
                              <input
                                value={optionDraft.displayNames?.[language.value] ?? ""}
                                onChange={(event) => setOptionDraft(updateDisplayName(optionDraft, language.value, event.target.value))}
                                placeholder={optionDraft.name || "表示名"}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      {optionDraft.id ? (
                        <details className="menu-option-platform-settings">
                          <summary>外部プラットフォーム個別設定</summary>
                          <div className="menu-platform-target-grid">
                            {brandExternalPlatforms.map((platform) => {
                              const setting = data.platformTargetSettings.find((entry) => (
                                entry.externalPlatformId === platform.id && entry.targetType === "option" && entry.targetId === optionDraft.id
                              ));
                              return (
                                <fieldset key={platform.id}>
                                  <legend>{platform.name}</legend>
                                  <label className="checkbox-group menu-inline-check">
                                    <input
                                      type="checkbox"
                                      checked={setting?.isEnabled ?? true}
                                      onChange={(event) => void savePlatformTargetSetting(platform, "option", optionDraft.id, { isEnabled: event.target.checked })}
                                    />
                                    <span>このプラットフォームで販売</span>
                                  </label>
                                  <label>
                                    <span>名称上書き</span>
                                    <input
                                      key={`${setting?.id ?? platform.id}:option-name`}
                                      defaultValue={setting?.nameOverride ?? ""}
                                      onBlur={(event) => void savePlatformTargetSetting(platform, "option", optionDraft.id, { nameOverride: event.target.value })}
                                      placeholder="共通ルールに従う"
                                    />
                                  </label>
                                  <label>
                                    <span>価格上書き</span>
                                    <input
                                      key={`${setting?.id ?? platform.id}:option-price`}
                                      defaultValue={setting?.priceOverride ?? ""}
                                      inputMode="decimal"
                                      onBlur={(event) => void savePlatformTargetSetting(platform, "option", optionDraft.id, {
                                        priceOverride: event.target.value.trim() ? Number(event.target.value) : null
                                      })}
                                      placeholder="自動計算"
                                    />
                                  </label>
                                </fieldset>
                              );
                            })}
                          </div>
                        </details>
                      ) : null}
                      <div className="photo-upload-box menu-photo-upload">
                        <div className="product-photo-preview">
                          {optionDraft.imageUrl ? <img src={optionDraft.imageUrl} alt="" /> : <span>No image</span>}
                        </div>
                        <div>
                          <label className="menu-full-field">
                            <span>選択肢画像 URL</span>
                            <input
                              value={optionDraft.imageUrl}
                              onChange={(event) => setOptionDraft({ ...optionDraft, imageUrl: event.target.value })}
                              placeholder="https://..."
                            />
                          </label>
                          <p>ブランドサイトで麺・トッピングなどの選択肢に表示する写真です。</p>
                          <div className="photo-upload-actions">
                            <label className="secondary-button">
                              <Upload size={16} />
                              写真を選択
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.currentTarget.value = "";
                                  if (file) selectMenuOptionPhoto(file);
                                }}
                              />
                            </label>
                          </div>
                          {optionPhotoStatus ? <small>{optionPhotoStatus}</small> : null}
                        </div>
                      </div>
	                      <label className="checkbox-group menu-inline-check">
	                        <input type="checkbox" checked={optionDraft.affectsProcedure} onChange={(event) => setOptionDraft({ ...optionDraft, affectsProcedure: event.target.checked })} />
	                        <span>手順に影響する</span>
                      </label>
                      <label className="checkbox-group menu-inline-check">
                        <input type="checkbox" checked={optionDraft.isActive} onChange={(event) => setOptionDraft({ ...optionDraft, isActive: event.target.checked })} />
                        <span>メニューに表示する</span>
                      </label>
                      <div className="row-actions">
                        {optionDraft.id ? (
                          <button className="danger-button" type="button" onClick={() => void deleteEntry("option", optionDraft.id)}>
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                        <button
                          className="primary-button"
                          type="button"
                          disabled={savingKind === "option" || !activeOptionGroup}
                          onClick={() => void save("option", { ...optionDraft, optionGroupId: optionDraft.optionGroupId || activeOptionGroup?.id || "" })}
                        >
                          <Save size={16} />
                          {savingKind === "option" ? "保存中" : "選択肢を保存"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <>
            {detailMode === "category" ? (
              <section className="menu-edit-card category-edit-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Category</p>
                    <h3>{categoryDraft.id ? "分類編集" : "新規分類"}</h3>
                  </div>
                  <div className="row-actions">
                    {categoryDraft.id ? (
                      <button className="danger-button" type="button" onClick={() => void deleteEntry("category", categoryDraft.id)}>
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                    <button
                      className="primary-button"
                      type="button"
                      disabled={savingKind === "category"}
                      onClick={() => void save("category", { ...categoryDraft, brandId: categoryDraft.brandId || activeBrandId, storeId: "" })}
                    >
                      <Save size={16} />
                      {savingKind === "category" ? "保存中" : "分類を保存"}
                    </button>
                  </div>
                </div>
                <div className="menu-form-grid">
                  <label>
                    <span>分類名</span>
                    <input value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} placeholder="例: タピオカドリンク" />
                  </label>
                  <label>
                    <span>公開 ID</span>
                    <input value={categoryDraft.externalId} onChange={(event) => setCategoryDraft({ ...categoryDraft, externalId: event.target.value })} placeholder="例: tapioca" />
                    <small>未入力なら分類名から自動生成します。同じブランド内では重複できません。</small>
                  </label>
                  <label>
                    <span>並び順</span>
                    <input value={categoryDraft.sortOrder} onChange={(event) => setCategoryDraft({ ...categoryDraft, sortOrder: Number(normalizeIntegerInput(event.target.value) || 0) })} inputMode="numeric" />
                  </label>
                  <div className="menu-category-flags">
                    <label className="checkbox-group menu-inline-check">
                      <input type="checkbox" checked={categoryDraft.isTapiocaFree} onChange={(event) => setCategoryDraft({ ...categoryDraft, isTapiocaFree: event.target.checked })} />
                      <span>タピオカなし分類</span>
                    </label>
                    <label className="checkbox-group menu-inline-check">
                      <input type="checkbox" checked={categoryDraft.hasWhipByDefault} onChange={(event) => setCategoryDraft({ ...categoryDraft, hasWhipByDefault: event.target.checked })} />
                      <span>ホイップ標準分類</span>
                    </label>
                  </div>
                </div>
                <label className="menu-full-field">
                  <span>分類紹介文</span>
                  <textarea value={categoryDraft.note} onChange={(event) => setCategoryDraft({ ...categoryDraft, note: event.target.value })} rows={3} placeholder="ブランドサイトで分類見出しの下に表示する説明文" />
                </label>
                <p className="category-edit-note">
                  分類名を変更すると、この分類に入っている商品も新しい分類名へ移動します。削除した場合、商品は未分類に戻ります。
                </p>
              </section>
            ) : null}

            {detailMode === "item" ? (
              <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">{getBrandName(data.brands, itemDraft.brandId) || "Menu Item"}</p>
                <h3>{itemDraft.id ? "商品編集" : "新規商品"}</h3>
              </div>
              <div className="row-actions">
                {itemDraft.id ? (
                  <button className="danger-button" type="button" onClick={() => void deleteEntry("item", itemDraft.id)}>
                    <Trash2 size={15} />
                  </button>
                ) : null}
                <button className="primary-button" type="button" disabled={savingKind === "item"} onClick={() => void save("item", { ...itemDraft, storeId: "" })}>
                  <Save size={16} />
                  {savingKind === "item" ? "保存中" : "商品を保存"}
                </button>
              </div>
            </div>

            <div className="menu-edit-card">
              <div className="menu-form-grid">
                <label className="menu-prefix-field">
                  <span>販促プレフィックス</span>
                  <input
                    value={itemDraft.promotionPrefix}
                    onChange={(event) => setItemDraft({ ...itemDraft, promotionPrefix: event.target.value })}
                    placeholder="例: Limited Summer Edition / 累計2万杯超え"
                  />
                  <small>商品名の上に別表示します。括弧は表示側で付けるため入力不要です。</small>
                </label>
                <label>
                  <span>商品名</span>
                  <input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder="商品名" />
                </label>
                <label>
                  <span>分類</span>
                  <input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} placeholder="例: タピオカフラッペ" />
                </label>
                <label>
                  <span>基本価格</span>
                  <input value={itemDraft.basePrice ?? ""} onChange={(event) => {
                    const value = normalizeDecimalInput(event.target.value);
                    setItemDraft({ ...itemDraft, basePrice: value ? Number(value) : null });
                  }} inputMode="decimal" />
                </label>
	                <label className="checkbox-group menu-inline-check">
	                  <input type="checkbox" checked={itemDraft.isActive} onChange={(event) => setItemDraft({ ...itemDraft, isActive: event.target.checked })} />
	                  <span>公開中</span>
	                </label>
	              </div>
              <section className="menu-presentation-panel">
                <div>
                  <strong>ブランドサイト表示</strong>
                  <p>商品名・Catchphrase・分類・Emoji の表示は OS で一元管理します。空欄の場合は上のメニュー基本情報をそのまま使用します。</p>
                </div>
                <div className="menu-presentation-grid">
                  <label>
                    <span>ウェブ専用の商品名</span>
                    <input
                      value={getWebsitePresentation(itemDraft).nameOverride ?? ""}
                      onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { nameOverride: event.target.value }))}
                      placeholder={itemDraft.name || "商品名をそのまま使用"}
                    />
                  </label>
                  <label>
                    <span>ウェブ専用 Catchphrase</span>
                    <input
                      value={getWebsitePresentation(itemDraft).promotionPrefixOverride ?? ""}
                      onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { promotionPrefixOverride: event.target.value }))}
                      placeholder={itemDraft.promotionPrefix || "Catchphrase なし"}
                    />
                  </label>
                  <label>
                    <span>ウェブ専用の分類名</span>
                    <input
                      value={getWebsitePresentation(itemDraft).categoryOverride ?? ""}
                      onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { categoryOverride: event.target.value }))}
                      placeholder={itemDraft.category || "未分類"}
                    />
                  </label>
                  <label className="menu-presentation-check">
                    <input
                      type="checkbox"
                      checked={getWebsitePresentation(itemDraft).showPromotionPrefix !== false}
                      onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { showPromotionPrefix: event.target.checked }))}
                    />
                    <span>Catchphraseを表示</span>
                  </label>
                  <label className="menu-presentation-check">
                    <input
                      type="checkbox"
                      checked={getWebsitePresentation(itemDraft).showEmoji !== false}
                      onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { showEmoji: event.target.checked }))}
                    />
                    <span>Emojiを表示</span>
                  </label>
                  <div className="menu-presentation-preview">
                    <span>ウェブ表示プレビュー</span>
                    <strong>{getWebsiteItemPreview(itemDraft)}</strong>
                    <small>{getWebsiteCategoryPreview(itemDraft)}</small>
                  </div>
                </div>
              </section>
              {itemDraft.id ? (
                <section className="menu-platform-target-panel">
                  <div>
                    <strong>外部プラットフォーム個別設定</strong>
                    <p>通常は共通ルールに従います。市場都合で販売有無・名称・価格・Emoji だけ個別に上書きできます。</p>
                  </div>
                  <div className="menu-platform-target-grid">
                    {brandExternalPlatforms.map((platform) => {
                      const setting = data.platformTargetSettings.find((entry) => (
                        entry.externalPlatformId === platform.id && entry.targetType === "item" && entry.targetId === itemDraft.id
                      ));
                      return (
                        <fieldset key={platform.id}>
                          <legend>{platform.name}</legend>
                          <label className="checkbox-group menu-inline-check">
                            <input
                              type="checkbox"
                              checked={setting?.isEnabled ?? true}
                              onChange={(event) => void savePlatformTargetSetting(platform, "item", itemDraft.id, { isEnabled: event.target.checked })}
                            />
                            <span>このプラットフォームで販売</span>
                          </label>
                          <label>
                            <span>名称上書き</span>
                            <input
                              key={`${setting?.id ?? platform.id}:name`}
                              defaultValue={setting?.nameOverride ?? ""}
                              onBlur={(event) => void savePlatformTargetSetting(platform, "item", itemDraft.id, { nameOverride: event.target.value })}
                              placeholder="共通ルールに従う"
                            />
                          </label>
                          <label>
                            <span>価格上書き</span>
                            <input
                              key={`${setting?.id ?? platform.id}:price`}
                              defaultValue={setting?.priceOverride ?? ""}
                              inputMode="decimal"
                              onBlur={(event) => void savePlatformTargetSetting(platform, "item", itemDraft.id, {
                                priceOverride: event.target.value.trim() ? Number(event.target.value) : null
                              })}
                              placeholder="自動計算"
                            />
                          </label>
                          <label>
                            <span>Emoji</span>
                            <select
                              value={setting?.emojiMode ?? "follow"}
                              onChange={(event) => void savePlatformTargetSetting(platform, "item", itemDraft.id, { emojiMode: event.target.value as MenuPlatformTargetSetting["emojiMode"] })}
                            >
                              <option value="follow">プラットフォーム規則</option>
                              <option value="show">表示</option>
                              <option value="hide">非表示</option>
                            </select>
                          </label>
                        </fieldset>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <div className="menu-translation-panel">
                <div>
                  <strong>販促プレフィックスの多言語表示</strong>
                  <span>未入力の言語は English、最後に原文プレフィックスへフォールバックします。</span>
                </div>
                <div className="menu-translation-grid">
                  {customerMenuLanguageOptions.map((language) => (
                    <label key={language.value}>
                      <span>{language.label}</span>
                      <input
                        value={itemDraft.promotionPrefixDisplayNames?.[language.value] ?? ""}
                        onChange={(event) => setItemDraft(updatePromotionPrefixDisplayName(itemDraft, language.value, event.target.value))}
                        placeholder={itemDraft.promotionPrefix || "販促プレフィックス"}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="menu-translation-panel">
                <div>
                  <strong>客表示・会員・ブランドサイト用表示名</strong>
                  <span>未入力の言語は English、最後に日本語名へフォールバックします。</span>
                </div>
                <div className="menu-translation-grid">
                  {customerMenuLanguageOptions.map((language) => (
                    <label key={language.value}>
                      <span>{language.label}</span>
                      <input
                        value={itemDraft.displayNames?.[language.value] ?? ""}
                        onChange={(event) => setItemDraft(updateDisplayName(itemDraft, language.value, event.target.value))}
                        placeholder={itemDraft.name || "商品名"}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <label className="menu-full-field">
                <span>共通の商品紹介（日本語）</span>
                <textarea
                  value={itemDraft.description}
                  onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })}
                  rows={3}
                  placeholder="Uber Eats など各チャネルで共通利用する商品紹介"
                />
                <small>Uber Eats から取り込んだ原文など、共通の商品紹介を保管します。</small>
              </label>
              <div className="menu-translation-panel">
                <div>
                  <strong>共通の商品紹介（多言語）</strong>
                  <span>日本語（原文）説明から翻訳します。未入力の言語は English、最後に日本語説明へフォールバックします。</span>
                </div>
                <div className="menu-translation-grid">
                  {customerMenuLanguageOptions.map((language) => (
                    <label key={language.value}>
                      <span>{language.label}</span>
                      <textarea
                        value={itemDraft.descriptionDisplayNames?.[language.value] ?? ""}
                        onChange={(event) => setItemDraft(updateDescriptionDisplayName(itemDraft, language.value, event.target.value))}
                        placeholder={itemDraft.description || "説明"}
                        rows={2}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <label className="menu-full-field">
                <span>Web予約用の商品紹介（日本語）</span>
                <textarea
                  value={getWebsitePresentation(itemDraft).descriptionOverride ?? ""}
                  onChange={(event) => setItemDraft(updateWebsitePresentation(itemDraft, { descriptionOverride: event.target.value }))}
                  rows={5}
                  placeholder={itemDraft.description || "未入力の場合は共通の商品紹介を表示"}
                />
                <small>ブランドサイトのWeb予約ではこちらを優先表示します。未入力の場合は共通の商品紹介を表示し、Uber Eats 用の原文は変更しません。</small>
              </label>
              <div className="menu-translation-panel">
                <div>
                  <strong>Web予約用の商品紹介（多言語）</strong>
                  <span>未入力の言語は Web予約用 English、最後に Web予約用の日本語へフォールバックします。</span>
                </div>
                <div className="menu-translation-grid">
                  {customerMenuLanguageOptions.map((language) => (
                    <label key={language.value}>
                      <span>{language.label}</span>
                      <textarea
                        value={getWebsitePresentation(itemDraft).descriptionDisplayNamesOverride?.[language.value] ?? ""}
                        onChange={(event) => setItemDraft(updateWebsiteDescriptionDisplayName(itemDraft, language.value, event.target.value))}
                        placeholder={getWebsitePresentation(itemDraft).descriptionOverride || itemDraft.description || "Web予約用の商品紹介"}
                        rows={2}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="photo-upload-box menu-photo-upload">
                <div className="product-photo-preview">
                  {itemDraft.imageUrl ? <img src={itemDraft.imageUrl} alt="" /> : <span>No image</span>}
                </div>
                <div>
                  <label className="menu-full-field">
                    <span>商品画像 URL</span>
                    <input value={itemDraft.imageUrl} onChange={(event) => setItemDraft({ ...itemDraft, imageUrl: event.target.value })} placeholder="https://..." />
                  </label>
                  <p>ブランドサイトに表示する成品写真です。OS にアップロードした公開 URL がメニュー API に出力されます。</p>
                  <div className="photo-upload-actions">
                    <label className="secondary-button">
                      <Upload size={16} />
                      写真を選択
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) selectMenuPhoto(file);
                        }}
                      />
                    </label>
                  </div>
                  {photoStatus ? <small>{photoStatus}</small> : null}
                </div>
              </div>
              {itemDraft.itemKind === "buildable_product" ? (
                <div className="menu-pos-pricing-panel">
                  <div className="section-heading compact-heading">
                    <div>
                      <p className="eyebrow">POS</p>
                      <h3>店内 POS 計価</h3>
                    </div>
                  </div>
                  <div className="menu-form-grid">
                    <label>
                      <span>計価方式</span>
                      <select
                        value={String((itemDraft.variableSchema.posWeightPricing as Record<string, unknown> | undefined)?.mode ?? "weight")}
                        onChange={(event) => updateItemWeightPricing("mode", event.target.value)}
                      >
                        <option value="weight">重量</option>
                        <option value="fixed">固定価格</option>
                      </select>
                    </label>
                    <label>
                      <span>重量単位</span>
                      <input
                        value={String((itemDraft.variableSchema.posWeightPricing as Record<string, unknown> | undefined)?.unit ?? "g")}
                        onChange={(event) => updateItemWeightPricing("unit", event.target.value)}
                        placeholder="g"
                      />
                    </label>
                    <label>
                      <span>1単位あたり価格</span>
                      <input
                        value={String((itemDraft.variableSchema.posWeightPricing as Record<string, unknown> | undefined)?.unitPrice ?? "")}
                        onChange={(event) => updateItemWeightPricing("unitPrice", normalizeDecimalInput(event.target.value))}
                        inputMode="decimal"
                        placeholder="例: 3.8"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
              <details className="menu-source-details menu-advanced-details">
                <summary>高度な設定</summary>
                <div className="menu-form-grid">
                  <label>
                    <span>商品タイプ</span>
                    <select value={itemDraft.itemKind} onChange={(event) => setItemDraft({ ...itemDraft, itemKind: event.target.value })}>
                      {itemKindOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>外部 ID</span>
                    <input value={itemDraft.externalId} onChange={(event) => setItemDraft({ ...itemDraft, externalId: event.target.value })} />
                  </label>
                </div>
              </details>
            </div>

            <section className="menu-edit-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Rules</p>
                  <h3>この商品で選べる内容</h3>
                </div>
                <button className="primary-button" type="button" disabled={savingKind === "item"} onClick={() => void save("item", { ...itemDraft, storeId: "" })}>
                  <Save size={16} />
                  {savingKind === "item" ? "保存中" : "選択可否を保存"}
                </button>
              </div>
              <div className="menu-rule-list">
                {visibleGroups.map((group) => {
                  const itemCategory = itemDraft.category || "未分類";
                  const groupOptions = data.options.filter((option) => (
                    option.optionGroupId === group.id
                    && (!option.applicableCategories.length || option.applicableCategories.includes(itemCategory))
                  ));
                  const allowedKeys = getAllowedKeys(itemDraft, group, groupOptions);
                  return (
                    <article className="menu-rule-card" key={group.id}>
                      <div className="menu-rule-card-head">
                        <div>
                          <strong>{group.name}</strong>
                          <span>{getLabel(selectionTypeOptions, group.selectionType)} / {group.affectsProcedure ? "手順に影響" : "表示のみ"}</span>
                        </div>
                        <div className="row-actions menu-rule-actions">
                          <button className="secondary-button compact-button" type="button" onClick={() => editGroupFromRule(group)}>
                            編集
                          </button>
                          <button className="secondary-button compact-button" type="button" onClick={() => startOptionFromRule(group)}>
                            <Plus size={15} />
                            選択肢追加
                          </button>
                        </div>
                      </div>
                      <div className="menu-choice-grid">
                        {groupOptions.map((option) => (
                          <div className={allowedKeys.has(getOptionKey(option)) ? "menu-choice-chip is-allowed" : "menu-choice-chip"} key={option.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={allowedKeys.has(getOptionKey(option))}
                                onChange={(event) => updateAllowedOption(group, option, event.target.checked)}
                              />
                              <span>{option.name}</span>
                              {option.priceDelta ? <small>{option.priceDelta > 0 ? "+" : ""}{option.priceDelta}円</small> : null}
                            </label>
                            <button className="menu-choice-delete-button" type="button" onClick={() => void deleteEntry("option", option.id)} aria-label={`${option.name}を削除`}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        {!groupOptions.length ? <p className="empty-state">選択肢がありません。</p> : null}
                      </div>
                    </article>
                  );
                })}
                {!visibleGroups.length ? <p className="empty-state">このブランドの選択グループはまだありません。</p> : null}
              </div>
            </section>

            <details className="menu-source-details">
              <summary>取込元・内部情報</summary>
              <div>
                <p>取込元: {selectedSource?.name || "未指定"}</p>
                <p>外部 ID: {itemDraft.externalId || "未設定"}</p>
                <p>Source URL: {selectedSource?.sourceUrl || "未設定"}</p>
              </div>
            </details>
              </>
            ) : null}
              </>
            )}
          </section>
        </div>
      </section>
      {translationPreview ? (
        <ModalHistoryScope historyKey="menus-translation-preview" onClose={() => setTranslationPreview(null)}>
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="AI翻訳プレビュー">
            <section className="edit-modal menu-translation-preview-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">AI Translation Preview</p>
                <h3>翻訳候補を確認</h3>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={() => setTranslationPreview(null)}>
                閉じる
              </button>
            </div>
            <div className="menu-translation-preview-summary">
              <span><Languages size={15} /> {translationPreview.entries.length}件</span>
              <span>Model: {translationPreview.model}</span>
              <span>確認後にのみ書き込みます</span>
            </div>
            <div className="menu-translation-preview-list">
              {translationPreview.entries.map((entry) => (
                <article className="menu-translation-preview-row" key={entry.key}>
                  <div className="menu-translation-preview-meta">
                    <strong>{entry.targetLabel}</strong>
                    <span>
                      {entry.targetType === "item" ? "商品名" : entry.targetType === "item_description" ? "商品説明" : entry.targetType === "group" ? "選択グループ" : "選択肢"}
                      {" / "}
                      {customerMenuLanguageOptions.find((language) => language.value === entry.language)?.label ?? entry.language}
                    </span>
                  </div>
                  <div className="menu-translation-preview-source">
                    <span>日本語</span>
                    <p>{entry.sourceText}</p>
                    {entry.currentText ? <small>現在: {entry.currentText}</small> : null}
                  </div>
                  <label className="menu-translation-preview-edit">
                    <span>AI 候補・手修正</span>
                    <textarea
                      value={entry.suggestedText}
                      onChange={(event) => updateTranslationSuggestion(entry.key, event.target.value)}
                      rows={entry.field === "descriptionDisplayNames" ? 4 : 2}
                    />
                  </label>
                  <button className="secondary-button compact-button" type="button" onClick={() => removeTranslationSuggestion(entry.key)}>
                    除外
                  </button>
                </article>
              ))}
              {!translationPreview.entries.length ? <p className="empty-state">書き込む候補はありません。</p> : null}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setTranslationPreview(null)}>
                キャンセル
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={translationBusy === "apply" || !translationPreview.entries.some((entry) => entry.suggestedText.trim())}
                onClick={() => void applyTranslationPreview()}
              >
                <Save size={16} />
                {translationBusy === "apply" ? "書き込み中" : "確認して書き込む"}
              </button>
            </div>
            </section>
          </div>
        </ModalHistoryScope>
      ) : null}
    </main>
  );
}
