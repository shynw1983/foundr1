"use client";

import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { clearStoredStoreSelection, getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type SharedPusher = ReturnType<(typeof import("../../../lib/shared-pusher-client"))["acquireSharedPusher"]>;
type SharedPusherChannel = ReturnType<SharedPusher["subscribe"]>;

type StoreOption = {
  id: string;
  name: string;
};

type StoreMenuAccess = {
  canUseAllStoreView: boolean;
  stores: StoreOption[];
};

type StoreMenuSettings = {
  availability: {
    targets: {
      items: boolean;
      options: boolean;
    };
    optionDisplayMode: "separate_category" | "mixed" | "hidden";
    allowStorePriceEdit: boolean;
    allowChannelToggle: boolean;
  };
};

type BrandOption = {
  id: string;
  name: string;
};

type StoreMenuCategory = {
  id: string;
  brandId: string;
  name: string;
  sortOrder: number;
};

type StoreMenuItem = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  displayNames: Record<string, string>;
  promotionPrefix: string;
  promotionPrefixDisplayNames: Record<string, string>;
  category: string;
  websitePresentation: {
    nameOverride?: string;
    promotionPrefixOverride?: string;
    categoryOverride?: string;
    showPromotionPrefix?: boolean;
    showEmoji?: boolean;
  };
  imageUrl: string;
  basePrice: number | null;
  websiteEnabled: boolean;
  posEnabled: boolean;
  deliveryEnabled: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
  statusNote: string;
};

type StoreMenuOption = {
  id: string;
  brandId: string;
  brandName: string;
  groupId: string;
  groupName: string;
  groupDisplayNames: Record<string, string>;
  groupKey: string;
  name: string;
  displayNames: Record<string, string>;
  priceDelta: number | null;
  isAvailable: boolean;
  statusNote: string;
};

type StoreMenuCategorySummary = {
  name: string;
  sortOrder: number;
  count: number;
};

type StoreMenuOptionGroup = {
  id: string;
  brandName: string;
  name: string;
  displayNames: Record<string, string>;
  options: StoreMenuOption[];
};

type InventorySyncStatus = "pending" | "succeeded" | "failed";

type InventorySyncPlatform = {
  commandId: string;
  platform: string;
  status: InventorySyncStatus;
  error: string;
};

type InventorySyncRun = {
  id: string;
  itemLabel: string;
  isAvailable: boolean;
  platforms: InventorySyncPlatform[];
};

const optionCategoryKey = "__store_menu_options__";

function stripEmoji(value: string) {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type StoreMenuLanguage = "ja" | "zh-Hans" | "zh-Hant";

function localizedMenuName(name: string, displayNames: Record<string, string> | undefined, language: StoreMenuLanguage) {
  if (language === "ja") return name;
  const languageKey = language === "zh-Hans" ? "zh" : "zh-Hant";
  return String(displayNames?.[languageKey] || displayNames?.en || name).trim();
}

function itemName(item: StoreMenuItem, language: StoreMenuLanguage) {
  const presentation = item.websitePresentation ?? {};
  const name = language === "ja"
    ? presentation.nameOverride?.trim() || item.name
    : localizedMenuName(item.name, item.displayNames, language);
  const prefix = presentation.showPromotionPrefix === false
    ? ""
    : language === "ja"
      ? presentation.promotionPrefixOverride?.trim() || item.promotionPrefix
      : localizedMenuName(item.promotionPrefix, item.promotionPrefixDisplayNames, language);
  const value = `${prefix}${name}`;
  return presentation.showEmoji === false ? stripEmoji(value) : value;
}

function itemCategory(item: StoreMenuItem) {
  const value = item.websitePresentation?.categoryOverride?.trim() || item.category || "未分類";
  return item.websitePresentation?.showEmoji === false ? stripEmoji(value) : value;
}

function platformName(platform: string, language: StoreMenuLanguage) {
  if (platform === "foundr1") return language === "ja" ? "Web予約" : language === "zh-Hant" ? "網站預約" : "网站预约";
  if (platform === "uber_eats") return "Uber";
  if (platform === "rocket_now") return language === "ja" ? "ロケットナウ" : "火箭";
  if (platform === "demae_can") return language === "zh-Hans" ? "出前馆" : "出前館";
  return platform;
}

function storeMenuDescription(language: StoreMenuLanguage) {
  if (language === "zh-Hans") return "缺货和恢复销售会同步到网站预约、Uber、火箭、出前馆。商品名称、价格和选项请在 OS 的菜单管理中编辑。";
  if (language === "zh-Hant") return "缺貨和恢復銷售會同步到網站預約、Uber、火箭、出前館。商品名稱、價格和選項請在 OS 的選單管理中編輯。";
  return "売切や販売再開は Web予約、Uber、ロケットナウ、出前館へ同期します。メニュー名、価格、選択肢は OS のメニュー管理で編集します。";
}

function syncCopy(language: StoreMenuLanguage) {
  if (language === "zh-Hans") {
    return {
      available: "恢复销售",
      unavailable: "缺货",
      pending: "执行中",
      succeeded: "成功",
      failed: "失败",
      title: "平台同步结果",
      timeout: "结果确认超时，请检查 Bridge 状态。",
      login: "需要重新登录该平台。",
      target: "找不到对应的商品或选项。",
      pageTimeout: "平台页面响应超时。",
      expired: "同步任务已过期。",
      generic: "同步失败。",
      collapse: "收起",
      expand: "展开"
    };
  }
  if (language === "zh-Hant") {
    return {
      available: "恢復銷售",
      unavailable: "缺貨",
      pending: "執行中",
      succeeded: "成功",
      failed: "失敗",
      title: "平台同步結果",
      timeout: "結果確認逾時，請檢查 Bridge 狀態。",
      login: "需要重新登入該平台。",
      target: "找不到對應的商品或選項。",
      pageTimeout: "平台頁面回應逾時。",
      expired: "同步工作已過期。",
      generic: "同步失敗。",
      collapse: "收起",
      expand: "展開"
    };
  }
  return {
    available: "販売再開",
    unavailable: "在庫切れ",
    pending: "実行中",
    succeeded: "成功",
    failed: "失敗",
    title: "プラットフォーム同期結果",
    timeout: "結果確認がタイムアウトしました。Bridge の状態を確認してください。",
    login: "このプラットフォームへの再ログインが必要です。",
    target: "対応する商品・オプションが見つかりません。",
    pageTimeout: "プラットフォーム画面の応答がタイムアウトしました。",
    expired: "同期処理の有効期限が切れました。",
    generic: "同期に失敗しました。",
    collapse: "折りたたむ",
    expand: "開く"
  };
}

function syncSummaryText(language: StoreMenuLanguage, pendingCount: number, failedCount: number, runCount: number) {
  if (language === "zh-Hans") {
    if (pendingCount) return `${pendingCount} 个平台执行中`;
    if (failedCount) return `${failedCount} 个平台修改失败`;
    return `最近 ${runCount} 个商品`;
  }
  if (language === "zh-Hant") {
    if (pendingCount) return `${pendingCount} 個平台執行中`;
    if (failedCount) return `${failedCount} 個平台修改失敗`;
    return `最近 ${runCount} 個商品`;
  }
  if (pendingCount) return `${pendingCount}プラットフォーム実行中`;
  if (failedCount) return `${failedCount}プラットフォーム失敗`;
  return `直近${runCount}商品`;
}

function readableSyncError(error: string, language: StoreMenuLanguage) {
  const copy = syncCopy(language);
  if (/login required|ログイン/i.test(error)) return copy.login;
  if (/target verification failed|対応する.*見つかりません/i.test(error)) return copy.target;
  if (/cdp.*timed out|page.*timeout|condition timed out/i.test(error)) return copy.pageTimeout;
  if (/expired|有効期限/i.test(error)) return copy.expired;
  return error.trim() || copy.generic;
}

function getCategories(items: StoreMenuItem[], categories: StoreMenuCategory[], brandId: string): StoreMenuCategorySummary[] {
  const counts = new Map<string, number>();
  const masters = new Map<string, StoreMenuCategory>();

  for (const item of items) {
    const name = itemCategory(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  for (const category of categories) {
    if (brandId && category.brandId !== brandId) continue;
    masters.set(category.name, category);
    if (!counts.has(category.name)) counts.set(category.name, 0);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      sortOrder: masters.get(name)?.sortOrder ?? 9999
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

function groupMenuOptions(options: StoreMenuOption[]): StoreMenuOptionGroup[] {
  const groups = new Map<string, StoreMenuOptionGroup>();

  for (const option of options) {
    const id = option.groupId || `${option.brandId}:${option.groupKey || option.groupName}`;
    const group = groups.get(id);
    if (group) {
      group.options.push(option);
      continue;
    }
    groups.set(id, {
      id,
      brandName: option.brandName,
      name: option.groupName,
      displayNames: option.groupDisplayNames,
      options: [option]
    });
  }

  return Array.from(groups.values());
}

export default function StoreMenuPage() {
  const { language } = useOsTranslation();
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<StoreMenuCategory[]>([]);
  const [items, setItems] = useState<StoreMenuItem[]>([]);
  const [options, setOptions] = useState<StoreMenuOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [settings, setSettings] = useState<StoreMenuSettings>({
    availability: {
      targets: { items: true, options: true },
      optionDisplayMode: "separate_category",
      allowStorePriceEdit: false,
      allowChannelToggle: false
    }
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [syncRuns, setSyncRuns] = useState<InventorySyncRun[]>([]);
  const [syncFeedbackOpen, setSyncFeedbackOpen] = useState(true);
  const syncMonitorActive = useRef(true);

  useEffect(() => {
    syncMonitorActive.current = true;
    return () => {
      syncMonitorActive.current = false;
    };
  }, []);

  async function load(nextStoreId = selectedStoreId, resetFilters = false) {
    setLoading(true);
    const params = new URLSearchParams();
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/store/menu-settings${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 403 && nextStoreId) {
        clearStoredStoreSelection();
        setSelectedStoreId("");
        void load("", true);
        return;
      }
      setMessage("販売状態を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const body = await response.json();
    const nextAccess = body.access as StoreMenuAccess;
    const nextBrands = body.brands as BrandOption[];
    const nextCategories = body.categories as StoreMenuCategory[];
    const nextItems = body.items as StoreMenuItem[];
    const nextOptions = body.options as StoreMenuOption[];
    if (body.settings) setSettings(body.settings as StoreMenuSettings);
    setBrands(nextBrands ?? []);
    setCategories(nextCategories ?? []);
    setItems(nextItems ?? []);
    setOptions(nextOptions ?? []);
    const responseStoreId = body.selectedStoreId || nextAccess.stores?.[0]?.id || "";
    setSelectedStoreId(responseStoreId);
    if (responseStoreId) setStoredStoreSelection(responseStoreId);
    setSelectedBrandId((current) => resetFilters ? (nextBrands?.[0]?.id || "") : (current || nextBrands?.[0]?.id || ""));
    setSelectedCategory((current) => resetFilters ? (nextItems?.[0] ? itemCategory(nextItems[0]) : "未分類") : (current ?? (nextItems?.[0] ? itemCategory(nextItems[0]) : "未分類")));
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load(getStoredStoreSelection());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedStoreId) return;
    let active = true;
    let pusher: SharedPusher | null = null;
    let channel: SharedPusherChannel | null = null;
    const refreshAvailability = () => {
      if (active) void load(selectedStoreId);
    };

    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.menuChannel) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        channel = pusher.subscribe(config.menuChannel);
        channel.bind("menu.updated", refreshAvailability);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      channel?.unbind("menu.updated", refreshAvailability);
      pusher?.disconnect();
    };
    // The selected store is the subscription identity. `load` intentionally
    // remains outside the dependency list so local state updates do not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const visibleItems = useMemo(() => {
    if (selectedCategory === optionCategoryKey) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedBrandId && item.brandId !== selectedBrandId) return false;
      if (selectedCategory !== null && itemCategory(item) !== selectedCategory) return false;
      if (normalizedQuery && ![
        itemName(item, language),
        item.name,
        ...Object.values(item.displayNames ?? {})
      ].some((value) => value.toLowerCase().includes(normalizedQuery))) return false;
      return true;
    });
  }, [items, language, query, selectedBrandId, selectedCategory]);

  const categoryItems = useMemo(() => items.filter((item) => !selectedBrandId || item.brandId === selectedBrandId), [items, selectedBrandId]);
  const categorySummaries = useMemo(() => getCategories(categoryItems, categories, selectedBrandId), [categories, categoryItems, selectedBrandId]);
  const optionItems = useMemo(() => {
    if (!settings.availability.targets.options) return [];
    return options.filter((option) => !selectedBrandId || option.brandId === selectedBrandId);
  }, [options, selectedBrandId, settings.availability.targets.options]);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return optionItems.filter((option) => (
      !normalizedQuery ||
      [
        localizedMenuName(option.name, option.displayNames, language),
        localizedMenuName(option.groupName, option.groupDisplayNames, language),
        option.name,
        option.groupName,
        ...Object.values(option.displayNames ?? {}),
        ...Object.values(option.groupDisplayNames ?? {})
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    ));
  }, [language, optionItems, query]);
  const visibleOptionGroups = useMemo(() => groupMenuOptions(visibleOptions), [visibleOptions]);
  const isOptionCategory = selectedCategory === optionCategoryKey;
  const showOptionCategory = settings.availability.targets.options && settings.availability.optionDisplayMode === "separate_category";
  const showMixedOptions = settings.availability.targets.options && settings.availability.optionDisplayMode === "mixed";

  useEffect(() => {
    if (selectedCategory === optionCategoryKey && !showOptionCategory) {
      setSelectedCategory(null);
    }
  }, [selectedCategory, showOptionCategory]);

  function updateSyncPlatform(runId: string, commandId: string, patch: Partial<InventorySyncPlatform>) {
    if (!syncMonitorActive.current) return;
    setSyncRuns((current) => current.map((run) => run.id === runId
      ? {
          ...run,
          platforms: run.platforms.map((platform) => platform.commandId === commandId
            ? { ...platform, ...patch }
            : platform)
        }
      : run));
  }

  async function monitorInventoryCommand(
    runId: string,
    command: { id: string; platform: string },
    storeId: string
  ) {
    const attempts = 60;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!syncMonitorActive.current) return;
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const params = new URLSearchParams({ storeId, commandId: command.id });
        const response = await fetch(`/api/store/display/kitchen/inventory?${params.toString()}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
          updateSyncPlatform(runId, command.id, {
            status: "failed",
            error: readableSyncError(String(body.error || ""), language)
          });
          return;
        }
        const status = String(body.status || "pending");
        if (status === "succeeded") {
          updateSyncPlatform(runId, command.id, { status: "succeeded", error: "" });
          return;
        }
        if (status === "failed") {
          updateSyncPlatform(runId, command.id, {
            status: "failed",
            error: readableSyncError(String(body.lastError || ""), language)
          });
          return;
        }
      } catch {
        // A temporary network error should not turn a running Bridge command into
        // a false failure. Continue polling until the confirmation window ends.
      }
    }
    updateSyncPlatform(runId, command.id, { status: "failed", error: syncCopy(language).timeout });
  }

  async function applyDeliveryAvailability(input: {
    brandId: string;
    ingredientLabel: string;
    feedbackLabel: string;
    targetKind: "item" | "option";
    isAvailable: boolean;
  }) {
    const storeId = selectedStoreId;
    const { feedbackLabel, ...requestInput } = input;
    const response = await fetch("/api/store/display/kitchen/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestInput,
        action: "apply",
        source: "sales_status",
        storeId
      })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(body.error || "Bridge sync failed"));
    const targetIds = new Set(
      (Array.isArray(body.targets) ? body.targets : []).map((target) => (
        target && typeof target === "object" ? String((target as Record<string, unknown>).targetId ?? "") : ""
      )).filter(Boolean)
    );
    const commands = (Array.isArray(body.commands) ? body.commands : []).flatMap((command) => {
      if (!command || typeof command !== "object") return [];
      const row = command as Record<string, unknown>;
      const id = String(row.id ?? "");
      const platform = String(row.platform ?? "");
      return id && platform ? [{ id, platform }] : [];
    });
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSyncFeedbackOpen(true);
    setSyncRuns((current) => [{
      id: runId,
      itemLabel: feedbackLabel,
      isAvailable: input.isAvailable,
      platforms: [
        { commandId: `${runId}-foundr1`, platform: "foundr1", status: "succeeded" as const, error: "" },
        ...commands.map((command) => ({
          commandId: command.id,
          platform: command.platform,
          status: "pending" as const,
          error: ""
        }))
      ]
    }, ...current].slice(0, 4));
    for (const command of commands) void monitorInventoryCommand(runId, command, storeId);
    return { targetIds };
  }

  async function saveItem(item: StoreMenuItem, patch: Partial<StoreMenuItem>) {
    const nextItem = { ...item, ...patch };
    setItems((current) => current.map((entry) => entry.id === item.id ? nextItem : entry));
    setSavingId(item.id);
    setMessage("");
    try {
      if (typeof patch.isAvailable === "boolean") {
        const result = await applyDeliveryAvailability({
          brandId: item.brandId,
          ingredientLabel: item.name,
          feedbackLabel: itemName(item, language),
          targetKind: "item",
          isAvailable: patch.isAvailable
        });
        setItems((current) => current.map((entry) => (
          entry.id === item.id || result.targetIds.has(entry.id)
            ? { ...entry, isAvailable: patch.isAvailable as boolean }
            : entry
        )));
        return;
      }
      const response = await fetch("/api/store/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          menuCatalogItemId: item.id,
          websiteEnabled: nextItem.websiteEnabled,
          isAvailable: nextItem.isAvailable,
          statusNote: nextItem.statusNote
        })
      });
      if (!response.ok) throw new Error("save failed");
      setMessage("更新しました。");
    } catch (error) {
      setItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
      setMessage(error instanceof Error && error.message !== "save failed"
        ? error.message
        : "保存できませんでした。");
    } finally {
      setSavingId("");
    }
  }

  async function saveOption(option: StoreMenuOption, patch: Partial<StoreMenuOption>) {
    const nextOption = { ...option, ...patch };
    setOptions((current) => current.map((entry) => entry.id === option.id ? nextOption : entry));
    setSavingId(option.id);
    setMessage("");
    try {
      if (typeof patch.isAvailable === "boolean") {
        const result = await applyDeliveryAvailability({
          brandId: option.brandId,
          ingredientLabel: option.name,
          feedbackLabel: localizedMenuName(option.name, option.displayNames, language),
          targetKind: "option",
          isAvailable: patch.isAvailable
        });
        setOptions((current) => current.map((entry) => (
          entry.id === option.id || result.targetIds.has(entry.id)
            ? { ...entry, isAvailable: patch.isAvailable as boolean }
            : entry
        )));
        return;
      }
      const response = await fetch("/api/store/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "option",
          storeId: selectedStoreId,
          menuOptionId: option.id,
          isAvailable: nextOption.isAvailable,
          statusNote: nextOption.statusNote
        })
      });
      if (!response.ok) throw new Error("save failed");
      setMessage("更新しました。");
    } catch (error) {
      setOptions((current) => current.map((entry) => entry.id === option.id ? option : entry));
      setMessage(error instanceof Error && error.message !== "save failed"
        ? error.message
        : "保存できませんでした。");
    } finally {
      setSavingId("");
    }
  }

  const pendingSyncCount = syncRuns.reduce((count, run) => (
    count + run.platforms.filter((platform) => platform.status === "pending").length
  ), 0);
  const failedSyncCount = syncRuns.reduce((count, run) => (
    count + run.platforms.filter((platform) => platform.status === "failed").length
  ), 0);

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>販売状態</h1>
          </div>
        </a>
        <StoreNavTabs active="menu" />
      </header>

      <section className="store-menu-page">
        <div className="store-menu-head panel">
          <div>
            <p className="eyebrow">Daily Availability</p>
            <h2>本日の販売状態</h2>
            <p data-i18n-ignore>{storeMenuDescription(language)}</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedStoreId)}>
            <RotateCcw size={16} />
            更新
          </button>
        </div>

        <div className="store-menu-controls panel">
          <label>
            <span>ブランド</span>
            <select value={selectedBrandId} onChange={(event) => {
              setSelectedBrandId(event.target.value);
              setSelectedCategory(null);
            }}>
              <option value="">すべて</option>
              {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label className="store-menu-search">
            <span>検索</span>
            <div>
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名" />
            </div>
          </label>
        </div>

        {message ? <div className="inline-alert">{message}</div> : null}

        <div className="store-menu-layout">
          <aside className="panel store-menu-category-panel">
            <button
              className={selectedCategory === null ? "menu-category-button is-active" : "menu-category-button"}
              type="button"
              onClick={() => setSelectedCategory(null)}
            >
              <span>すべて</span>
              <strong>{categoryItems.length}</strong>
            </button>
            {categorySummaries.map((category) => {
              return (
                <button
                  className={selectedCategory === category.name ? "menu-category-button is-active" : "menu-category-button"}
                  type="button"
                  onClick={() => setSelectedCategory(category.name)}
                  key={category.name}
                >
                  <span>{category.name}</span>
                  <strong>{category.count}</strong>
                </button>
              );
            })}
            {showOptionCategory ? (
              <button
                className={isOptionCategory ? "menu-category-button is-active is-settings" : "menu-category-button is-settings"}
                type="button"
                onClick={() => setSelectedCategory(optionCategoryKey)}
              >
                <span>オプション・トッピング</span>
                <strong>{optionItems.length}</strong>
              </button>
            ) : null}
          </aside>

          <section className="panel store-menu-items-panel">
            <div className="store-menu-list-head">
              <h2>{isOptionCategory ? "オプション・トッピング" : selectedCategory ?? "すべて"}</h2>
              <span className="status-pill">{isOptionCategory ? visibleOptions.length : visibleItems.length}件</span>
            </div>
            {isOptionCategory && showOptionCategory ? (
              <section className="store-menu-option-section store-menu-option-section-flat">
                <div className="store-menu-option-groups">
                  {visibleOptionGroups.map((group) => (
                    <StoreOptionGroup
                      group={group}
                      language={language}
                      savingId={savingId}
                      onSave={saveOption}
                      onStatusNoteChange={(optionId, statusNote) => setOptions((current) => current.map((entry) => (
                        entry.id === optionId ? { ...entry, statusNote } : entry
                      )))}
                      key={group.id}
                    />
                  ))}
                  {!visibleOptions.length ? <p className="empty-state">{loading ? "読み込み中..." : "オプション・トッピングがありません。"}</p> : null}
                </div>
              </section>
            ) : (
              <>
                {showMixedOptions && visibleOptions.length ? (
                  <section className="store-menu-option-section">
                    <div className="store-menu-list-head">
                      <h3>オプション・トッピング</h3>
                      <span className="status-pill">{visibleOptions.length}件</span>
                    </div>
                    <div className="store-menu-option-groups">
                      {visibleOptionGroups.map((group) => (
                        <StoreOptionGroup
                          group={group}
                          language={language}
                          savingId={savingId}
                          onSave={saveOption}
                          onStatusNoteChange={(optionId, statusNote) => setOptions((current) => current.map((entry) => (
                            entry.id === optionId ? { ...entry, statusNote } : entry
                          )))}
                          key={group.id}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                <div className="store-menu-item-list">
                  {visibleItems.map((item) => (
                    <article className="store-menu-item-row" key={item.id}>
                      <div className="store-menu-item-main">
                        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="store-menu-image-empty">No image</div>}
                        <div>
                          <strong data-i18n-ignore>{itemName(item, language)}</strong>
                          <span>{item.brandName} / {itemCategory(item)}</span>
                          <small>
                            {item.priceOverride == null ? `${item.basePrice ?? 0}円` : `${item.priceOverride}円 店舗価格`}
                            {" / "}
                            Web {item.websiteEnabled ? "可" : "停止"} / POS {item.posEnabled ? "可" : "停止"}
                          </small>
                        </div>
                      </div>
                      <div className="store-menu-status-actions">
                        <button
                          className={item.isAvailable ? "store-status-button is-on" : "store-status-button"}
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void saveItem(item, { isAvailable: true })}
                        >
                          <CheckCircle2 size={17} />
                          販売中
                        </button>
                        <button
                          className={!item.isAvailable ? "store-status-button is-off" : "store-status-button"}
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void saveItem(item, { isAvailable: false })}
                        >
                          <XCircle size={17} />
                          売切
                        </button>
                        <button
                          className={item.websiteEnabled ? "store-status-button is-on" : "store-status-button"}
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void saveItem(item, { websiteEnabled: true })}
                        >
                          Web表示
                        </button>
                        <button
                          className={!item.websiteEnabled ? "store-status-button is-off" : "store-status-button"}
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void saveItem(item, { websiteEnabled: false })}
                        >
                          Web非表示
                        </button>
                      </div>
                      <div className="store-menu-note">
                        <input
                          value={item.statusNote}
                          onChange={(event) => setItems((current) => current.map((entry) => (
                            entry.id === item.id ? { ...entry, statusNote: event.target.value } : entry
                          )))}
                          placeholder="例: 15分後に再開予定"
                        />
                        <button className="secondary-button" type="button" disabled={savingId === item.id} onClick={() => void saveItem(item, {})}>
                          メモ保存
                        </button>
                      </div>
                    </article>
                  ))}
                  {!visibleItems.length ? <p className="empty-state">{loading ? "読み込み中..." : "商品がありません。"}</p> : null}
                </div>
              </>
            )}
          </section>
        </div>

        {syncRuns.length ? (() => {
          const copy = syncCopy(language);
          return (
            <aside
              className={`store-menu-sync-feedback${syncFeedbackOpen ? " is-open" : " is-collapsed"}`}
              aria-live="polite"
              data-i18n-ignore
            >
              <button
                className="store-menu-sync-dock-head"
                type="button"
                aria-expanded={syncFeedbackOpen}
                onClick={() => setSyncFeedbackOpen((current) => !current)}
              >
                <span className={`store-menu-sync-dock-dot${pendingSyncCount ? " is-pending" : failedSyncCount ? " is-failed" : " is-complete"}`} />
                <span className="store-menu-sync-dock-title">
                  <strong>{copy.title}</strong>
                  <small>{syncSummaryText(language, pendingSyncCount, failedSyncCount, syncRuns.length)}</small>
                </span>
                <span className="store-menu-sync-dock-toggle">
                  {syncFeedbackOpen ? copy.collapse : copy.expand}
                  {syncFeedbackOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </span>
              </button>
              {syncFeedbackOpen ? (
                <div className="store-menu-sync-dock-body">
                  {syncRuns.map((run) => (
                    <article className="store-menu-sync-run" key={run.id}>
                      <div className="store-menu-sync-heading">
                        <strong>{run.itemLabel}</strong>
                        <span>{run.isAvailable ? copy.available : copy.unavailable}</span>
                      </div>
                      <div className="store-menu-sync-platforms">
                        {run.platforms.map((platform) => (
                          <div className={`store-menu-sync-platform is-${platform.status}`} key={platform.commandId}>
                            <span className="store-menu-sync-state">
                              {platform.status === "pending" ? <LoaderCircle size={15} /> : null}
                              {platform.status === "succeeded" ? <CheckCircle2 size={15} /> : null}
                              {platform.status === "failed" ? <XCircle size={15} /> : null}
                              <strong>{platformName(platform.platform, language)}</strong>
                              <small>{copy[platform.status]}</small>
                            </span>
                            {platform.error ? <span className="store-menu-sync-error">{platform.error}</span> : null}
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </aside>
          );
        })() : null}
      </section>
    </main>
  );
}

function StoreOptionGroup({
  group,
  language,
  savingId,
  onSave,
  onStatusNoteChange
}: {
  group: StoreMenuOptionGroup;
  language: StoreMenuLanguage;
  savingId: string;
  onSave: (option: StoreMenuOption, patch: Partial<StoreMenuOption>) => Promise<void>;
  onStatusNoteChange: (optionId: string, statusNote: string) => void;
}) {
  const unavailableCount = group.options.filter((option) => !option.isAvailable).length;
  return (
    <details className="store-menu-option-group">
      <summary>
        <span className="store-menu-option-group-title">
          <strong data-i18n-ignore>{localizedMenuName(group.name, group.displayNames, language)}</strong>
          <small>{group.brandName}</small>
        </span>
        <span className="store-menu-option-group-meta">
          {unavailableCount ? <span className="store-menu-option-group-alert">{unavailableCount}件 売切</span> : null}
          <span>{group.options.length}件</span>
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </summary>
      <div className="store-menu-item-list">
        {group.options.map((option) => (
          <StoreOptionRow
            option={option}
            language={language}
            savingId={savingId}
            onSave={onSave}
            onStatusNoteChange={onStatusNoteChange}
            key={option.id}
          />
        ))}
      </div>
    </details>
  );
}

function StoreOptionRow({
  option,
  language,
  savingId,
  onSave,
  onStatusNoteChange
}: {
  option: StoreMenuOption;
  language: StoreMenuLanguage;
  savingId: string;
  onSave: (option: StoreMenuOption, patch: Partial<StoreMenuOption>) => Promise<void>;
  onStatusNoteChange: (optionId: string, statusNote: string) => void;
}) {
  return (
    <article className="store-menu-item-row store-menu-option-row">
      <div className="store-menu-item-main">
        <div className="store-menu-image-empty">OP</div>
        <div>
          <strong data-i18n-ignore>{localizedMenuName(option.name, option.displayNames, language)}</strong>
          <span>{option.brandName} / <span data-i18n-ignore>{localizedMenuName(option.groupName, option.groupDisplayNames, language)}</span></span>
          <small>{option.priceDelta ? `${option.priceDelta > 0 ? "+" : ""}${option.priceDelta}円` : "追加料金なし"}</small>
        </div>
      </div>
      <div className="store-menu-status-actions">
        <button
          className={option.isAvailable ? "store-status-button is-on" : "store-status-button"}
          type="button"
          disabled={savingId === option.id}
          onClick={() => void onSave(option, { isAvailable: true })}
        >
          <CheckCircle2 size={17} />
          販売中
        </button>
        <button
          className={!option.isAvailable ? "store-status-button is-off" : "store-status-button"}
          type="button"
          disabled={savingId === option.id}
          onClick={() => void onSave(option, { isAvailable: false })}
        >
          <XCircle size={17} />
          売切
        </button>
      </div>
      <div className="store-menu-note">
        <input
          value={option.statusNote}
          onChange={(event) => onStatusNoteChange(option.id, event.target.value)}
          placeholder="例: 豆乳在庫切れ"
        />
        <button className="secondary-button" type="button" disabled={savingId === option.id} onClick={() => void onSave(option, {})}>
          メモ保存
        </button>
      </div>
    </article>
  );
}
