"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";
import { useVisibleRefresh } from "../../components/useVisibleRefresh";
import { createStoreFallbackPoller, rememberStoreBusinessHours } from "../../../../lib/store-polling-client";
import { playStoreOrderAlertSound } from "../../../../lib/store-order-alert-sounds";
import { defaultStoreModuleSettings, type StoreModuleSettings, type StoreOrderAlertSound } from "../../../../lib/module-setting-defaults";

type KitchenTask = {
  id: string;
  orderId: string;
  brandId: string;
  productionArea: string;
  productionAreaLabel: string;
  status: string;
  printStatus: string;
  itemSummary: string;
  itemCount: number;
  isHistorical: boolean;
  itemGroups: Array<{
    itemName: string;
    quantity: number;
    amount: number;
    options: Array<{
      label: string;
      count: number;
      amount: number;
    }>;
    productionLines: string[];
  }>;
  startedAt: string;
  estimatedPrepMinutes: number;
  estimatedReadyAt: string;
  pickupCode: string;
  scheduledAt: string;
  amount: number;
  currency: string;
  customerName: string;
  tableLabel: string;
  orderSource: string;
  orderType: string;
  note: string;
  noteOriginal: string;
  createdAt: string;
  kitchenLanguage: "ja" | "zh";
  showAmounts: boolean;
};

type InventoryTarget = {
  kind: "item" | "option";
  targetId: string;
  groupKey?: string;
  label: string;
  isAvailable: boolean;
};

type InventoryDialog = {
  lineKey: string;
  ingredientLabel: string;
  inventoryKey: string;
  targets: InventoryTarget[];
  loading: boolean;
  error: string;
  task: KitchenTask;
  targetKind: "item" | "option";
};

type InventorySyncState = {
  commandIds: string[];
  platforms: Record<string, {
    commandId: string;
    status: "pending" | "succeeded" | "failed";
    error?: string;
  }>;
  status: "pending" | "succeeded" | "failed";
  error?: string;
};

type UnavailableInventoryItem = {
  inventoryKey: string;
  ingredientLabel: string;
  targetKind: "item" | "option";
  brandId: string;
  targets: InventoryTarget[];
};

type InventoryAuditState = {
  commandId: string;
  status: "pending" | "succeeded" | "failed";
  targetCount: number;
  checkedCount: number;
  updatedCount: number;
  missingCount: number;
  error: string;
};

type KitchenDisplayMode = "order_only" | "simple" | "detailed";
type KitchenStatusFilter = "active" | "new" | "preparing" | "ready";

type StoreOption = {
  id: string;
  name: string;
};

type BridgeStatus = {
  level?: "healthy" | "attention" | "error";
  problem?: string;
  pendingCount?: number;
  lastOrderCode?: string;
  lastOrderAt?: string;
  lastSeenAt?: string;
  recentlyOnline?: boolean;
  deviceName?: string;
};

type NewOrderNotice = {
  taskId: string;
  pickupCode: string;
  itemCount: number;
  orderCount: number;
};

const statusLabels: Record<"ja" | "zh", Record<string, string>> = {
  ja: { new: "制作待ち", preparing: "制作中", ready: "完成" },
  zh: { new: "待制作", preparing: "制作中", ready: "已完成" }
};

const orderTypeLabels: Record<"ja" | "zh", Record<string, string>> = {
  ja: { eat_in: "店内", takeout: "持ち帰り", delivery: "配達", unknown: "受取方法未判定" },
  zh: { eat_in: "堂食", takeout: "自提", delivery: "外送", unknown: "取餐方式未确认" }
};

const deliveryOrderSources = new Set(["uber_eats", "demae_can", "rocket_now", "wolt"]);
const pickupOrderSources = new Set(["maamaa_web", "nanacha_web", "web_reservation"]);

function isFoundr1NativeShell() {
  if (typeof window === "undefined") return false;
  const nativeWindow = window as typeof window & {
    Foundr1NativeNotifications?: unknown;
    Foundr1Printer?: unknown;
  };
  return Boolean(nativeWindow.Foundr1NativeNotifications || nativeWindow.Foundr1Printer);
}

function getKitchenItemCount(task: KitchenTask) {
  const orderItemCount = Number(task.itemCount);
  if (Number.isFinite(orderItemCount) && orderItemCount >= 0) return orderItemCount;
  return (task.itemGroups ?? []).reduce((total, group) => {
    const quantity = Number(group.quantity);
    return total + (Number.isFinite(quantity) ? Math.max(0, quantity) : 0);
  }, 0);
}

function PlatformLogo({ source }: { source: string }) {
  if (source === "uber_eats") {
    return <span className="store-kitchen-platform-logo is-uber" aria-label="Uber Eats"><b>UBER</b><em>EATS</em></span>;
  }
  if (source === "rocket_now") {
    return <span className="store-kitchen-platform-logo is-rocket" aria-label="Rocket Now"><b>Rocket</b><em>Now</em></span>;
  }
  if (source === "demae_can") {
    return <span className="store-kitchen-platform-logo is-demae" aria-label="出前館"><b>出前館</b></span>;
  }
  if (source === "maamaa_web") {
    return <span className="store-kitchen-platform-logo is-foundr1"><b>まぁ麻</b><em>Web予約</em></span>;
  }
  if (source === "nanacha_web") {
    return <span className="store-kitchen-platform-logo is-foundr1"><b>nanacha</b><em>Web予約</em></span>;
  }
  return <span className="store-kitchen-platform-logo is-foundr1"><b>Foundr1</b><em>POS</em></span>;
}

function getEffectiveOrderType(task: KitchenTask) {
  if (["eat_in", "takeout", "delivery"].includes(task.orderType)) return task.orderType;
  if (deliveryOrderSources.has(task.orderSource)) return "delivery";
  if (pickupOrderSources.has(task.orderSource)) return "takeout";
  return "unknown";
}

function formatOrderAmount(amount: number, currency: string) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: currency || "JPY",
      maximumFractionDigits: currency === "JPY" || !currency ? 0 : 2
    }).format(normalizedAmount);
  } catch {
    return `¥${normalizedAmount.toLocaleString("ja-JP")}`;
  }
}

function formatOrderDateTime(createdAt: string, language: "ja" | "zh") {
  const date = new Date(createdAt);
  if (!createdAt || Number.isNaN(date.getTime())) return language === "zh" ? "时间未记录" : "時刻未記録";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function splitQuantityLabel(text: string) {
  const multiplierMatch = text.match(/^(.*?)( x\d+)(（.*）)?$/);
  if (multiplierMatch) {
    return {
      label: `${multiplierMatch[1]}${multiplierMatch[3] ?? ""}`,
      quantity: multiplierMatch[2].trim()
    };
  }
  return { label: text, quantity: "" };
}

function formatInventorySyncLabel(sync: InventorySyncState, language: "ja" | "zh") {
  const labels: Record<string, string> = { uber_eats: "Uber", rocket_now: "Rocket" };
  const statusMarks = language === "zh"
    ? { pending: "同步中", succeeded: "完成", failed: "失败" }
    : { pending: "同期中", succeeded: "完了", failed: "失敗" };
  return Object.entries(sync.platforms)
    .map(([platform, state]) => `${labels[platform] ?? platform} ${statusMarks[state.status]}`)
    .join(" · ");
}

function simplifyKitchenLine(text: string, isModifier: boolean) {
  if (!isModifier) return text;
  const withoutDetails = text.replace(/（.*$/u, "").trim();
  const customerCount = withoutDetails.match(/\s+x(\d+)$/u)?.[1] ?? "";
  const withoutCustomerCount = withoutDetails.replace(/\s+x\d+$/u, "").trim();
  const withoutRecipeQuantity = withoutCustomerCount
    .replace(/\s+(?:追加)?(?:約)?\d+(?:\.\d+)?\s*(?:g|kg|個|枚|本|袋|パック|杯|人前|ヶ|个|张|根|包|份)(?:くらい)?$/u, "")
    .trim();
  return customerCount && Number(customerCount) > 1
    ? `${withoutRecipeQuantity} x${customerCount}`
    : withoutRecipeQuantity;
}

function getCountdownLabel(estimatedReadyAt: string, now: number, language: "ja" | "zh") {
  const target = new Date(estimatedReadyAt).getTime();
  if (!estimatedReadyAt || Number.isNaN(target)) return "";
  const remainingMs = target - now;
  if (remainingMs <= 0) return language === "zh" ? "即将完成" : "まもなく完成";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return language === "zh" ? `还剩${minutes}分钟` : `あと${minutes}分`;
}

export default function StoreKitchenPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [tasks, setTasks] = useState<KitchenTask[]>([]);
  const [areas, setAreas] = useState<Array<{ value: string; label: string }>>([]);
  const [displayLanguage, setDisplayLanguage] = useState<"ja" | "zh">("ja");
  const [kitchenDisplayMode, setKitchenDisplayMode] = useState<KitchenDisplayMode>("detailed");
  const [statusFilter, setStatusFilter] = useState<KitchenStatusFilter>("active");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [businessDayOffset, setBusinessDayOffset] = useState<0 | -1>(0);
  const [displayedBusinessDate, setDisplayedBusinessDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [reprintQueuedId, setReprintQueuedId] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [bridgePresence, setBridgePresence] = useState<"connecting" | "online" | "offline">("connecting");
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkedLineKeys, setCheckedLineKeys] = useState<Set<string>>(() => new Set());
  const [revealedInventoryLineKey, setRevealedInventoryLineKey] = useState("");
  const [inventoryDialog, setInventoryDialog] = useState<InventoryDialog | null>(null);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [inventorySyncByKey, setInventorySyncByKey] = useState<Record<string, InventorySyncState>>({});
  const [inventoryKeyByLineKey, setInventoryKeyByLineKey] = useState<Record<string, string>>({});
  const [inventoryManagerOpen, setInventoryManagerOpen] = useState(false);
  const [unavailableInventory, setUnavailableInventory] = useState<UnavailableInventoryItem[]>([]);
  const [inventoryListLoading, setInventoryListLoading] = useState(false);
  const [inventoryListError, setInventoryListError] = useState("");
  const [inventoryRestoringKey, setInventoryRestoringKey] = useState("");
  const [inventoryAudit, setInventoryAudit] = useState<InventoryAuditState | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [newOrderNotice, setNewOrderNotice] = useState<NewOrderNotice | null>(null);
  const [newArrivalOrderIds, setNewArrivalOrderIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const selectedStoreIdRef = useRef(selectedStoreId);
  const serverOffsetRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const autoStartingTaskIdsRef = useRef<Set<string>>(new Set());
  const bridgeMemberIdsRef = useRef<Set<string>>(new Set());
  const inventoryPointerRef = useRef<{ lineKey: string; x: number; y: number; handled: boolean } | null>(null);
  const inventoryCommandByIdRef = useRef<Record<string, { inventoryKey: string; platform: string }>>({});
  const suppressIngredientClickUntilRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const orderAlertSoundRef = useRef<StoreOrderAlertSound>(defaultStoreModuleSettings.orderAlerts.sound);
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const hasNewOrderBaselineRef = useRef(false);
  const newOrderNoticeTimerRef = useRef<number | null>(null);
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + serverOffsetRef.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function syncServerTime(serverNow: unknown) {
    const timestamp = new Date(String(serverNow ?? "")).getTime();
    if (!Number.isFinite(timestamp)) return;
    serverOffsetRef.current = timestamp - Date.now();
    setNow(timestamp);
  }

  async function ensureAudioReady() {
    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      setSoundReady(false);
      return false;
    }
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
    const ready = audioContextRef.current.state === "running";
    setSoundReady(ready);
    return ready;
  }

  async function playNewOrderAlert() {
    if (!soundEnabledRef.current) return;
    try {
      if (!await ensureAudioReady() || !audioContextRef.current) return;
      playStoreOrderAlertSound(audioContextRef.current, orderAlertSoundRef.current);
    } catch {
      setSoundReady(false);
    }
  }

  function resetNewOrderBaseline() {
    seenOrderIdsRef.current = new Set();
    hasNewOrderBaselineRef.current = false;
    setNewOrderNotice(null);
    setNewArrivalOrderIds([]);
    if (newOrderNoticeTimerRef.current) window.clearTimeout(newOrderNoticeTimerRef.current);
    newOrderNoticeTimerRef.current = null;
  }

  function announceNewOrders(nextTasks: KitchenTask[]) {
    const nextOrderIds = new Set(nextTasks.map((task) => task.orderId).filter(Boolean));
    if (!hasNewOrderBaselineRef.current) {
      seenOrderIdsRef.current = nextOrderIds;
      hasNewOrderBaselineRef.current = true;
      return;
    }
    const newOrders = nextTasks.filter((task, index, all) => (
      task.status === "new"
      && !seenOrderIdsRef.current.has(task.orderId)
      && all.findIndex((candidate) => candidate.orderId === task.orderId) === index
    ));
    nextOrderIds.forEach((orderId) => seenOrderIdsRef.current.add(orderId));
    if (!newOrders.length) return;

    const first = newOrders[0];
    setNewOrderNotice({
      taskId: first.id,
      pickupCode: first.pickupCode,
      itemCount: getKitchenItemCount(first),
      orderCount: newOrders.length
    });
    setNewArrivalOrderIds(newOrders.map((task) => task.orderId));
    if (newOrderNoticeTimerRef.current) window.clearTimeout(newOrderNoticeTimerRef.current);
    newOrderNoticeTimerRef.current = window.setTimeout(() => {
      setNewOrderNotice(null);
      setNewArrivalOrderIds([]);
      newOrderNoticeTimerRef.current = null;
    }, 15_000);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([180, 80, 180]);
    void playNewOrderAlert();
  }

  async function load(storeId = selectedStoreIdRef.current, area = selectedArea, dayOffset = businessDayOffset) {
    const loadSequence = ++loadSequenceRef.current;
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (area) params.set("area", area);
    if (dayOffset === -1) params.set("dayOffset", "-1");
    params.set("ts", String(Date.now()));
    const response = await fetch(`/api/store/display/kitchen?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      if (loadSequence === loadSequenceRef.current) setLoading(false);
      return;
    }
    const body = await response.json();
    if (loadSequence !== loadSequenceRef.current) return;
    syncServerTime(body.serverNow);
    const nextStoreId = String(body.selectedStoreId || storeId || "");
    setStores(body.access?.stores ?? []);
    rememberStoreBusinessHours(body.access?.stores);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    const nextTasks = (body.tasks ?? []) as KitchenTask[];
    announceNewOrders(nextTasks);
    setTasks(nextTasks);
    setAreas(body.areas ?? []);
    setDisplayedBusinessDate(String(body.businessDay?.businessDate ?? ""));
    setDisplayLanguage(body.displayLanguage === "zh" ? "zh" : "ja");
    setKitchenDisplayMode(
      body.kitchenDisplayMode === "order_only" || body.kitchenDisplayMode === "simple"
        ? body.kitchenDisplayMode
        : "detailed"
    );
    setBridgeStatus(body.bridgeStatus ?? null);
    setCheckedLineKeys((current) => {
      const validKeys = new Set<string>();
      for (const task of (body.tasks ?? []) as KitchenTask[]) {
        task.itemGroups?.forEach((group, groupIndex) => {
          validKeys.add(`${task.id}:order:${groupIndex}:product`);
          group.options.forEach((_, optionIndex) => {
            validKeys.add(`${task.id}:order:${groupIndex}:option:${optionIndex}`);
          });
          group.productionLines.forEach((_, lineIndex) => {
            validKeys.add(`${task.id}:${groupIndex}:${lineIndex}`);
          });
        });
      }
      return new Set(Array.from(current).filter((key) => validKeys.has(key)));
    });
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    setLoading(false);
  }

  useVisibleRefresh(() => {
    void load();
  });

  useEffect(() => {
    let active = true;
    fetch("/api/settings?module=store", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { settings?: StoreModuleSettings } | null) => {
        if (active && body?.settings?.orderAlerts?.sound) {
          orderAlertSoundRef.current = body.settings.orderAlerts.sound;
        }
      })
      .catch(() => {
        // Kitchen alerts keep the default bell if settings are unavailable.
      });
    if (isFoundr1NativeShell()) {
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      void ensureAudioReady();
    }
    return () => {
      active = false;
      if (newOrderNoticeTimerRef.current) window.clearTimeout(newOrderNoticeTimerRef.current);
      void audioContextRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleLineCheck(task: KitchenTask, key: string, isIngredient: boolean) {
    if (Date.now() < suppressIngredientClickUntilRef.current) return;
    const wasChecked = checkedLineKeys.has(key);
    setCheckedLineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (
      wasChecked
      || !isIngredient
      || task.status !== "new"
      || autoStartingTaskIdsRef.current.has(task.id)
    ) return;
    autoStartingTaskIdsRef.current.add(task.id);
    void updateTask(task, "preparing").finally(() => {
      autoStartingTaskIdsRef.current.delete(task.id);
    });
  }

  function startInventorySwipe(lineKey: string, clientX: number, clientY: number) {
    inventoryPointerRef.current = { lineKey, x: clientX, y: clientY, handled: false };
  }

  function moveInventorySwipe(lineKey: string, clientX: number, clientY: number) {
    const start = inventoryPointerRef.current;
    if (!start || start.lineKey !== lineKey || start.handled) return;
    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;
    if (deltaX < -38 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
      start.handled = true;
      suppressIngredientClickUntilRef.current = Date.now() + 700;
      setRevealedInventoryLineKey(lineKey);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(24);
    } else if (deltaX > 32 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1 && revealedInventoryLineKey === lineKey) {
      start.handled = true;
      suppressIngredientClickUntilRef.current = Date.now() + 500;
      setRevealedInventoryLineKey("");
    }
  }

  function finishInventorySwipe(lineKey: string, clientX: number, clientY: number) {
    moveInventorySwipe(lineKey, clientX, clientY);
    inventoryPointerRef.current = null;
  }

  function registerInventoryCommands(body: Record<string, unknown>, inventoryKey: string) {
    const rawCommands = Array.isArray(body.commands) ? body.commands : [];
    const commands = rawCommands.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const command = value as Record<string, unknown>;
      const commandId = String(command.id ?? "");
      const platform = String(command.platform ?? "");
      return commandId && platform ? [{ commandId, platform }] : [];
    });
    if (!commands.length && body.commandId) {
      commands.push({ commandId: String(body.commandId), platform: "uber_eats" });
    }
    const platforms = Object.fromEntries(commands.map(({ commandId, platform }) => {
      inventoryCommandByIdRef.current[commandId] = { inventoryKey, platform };
      return [platform, { commandId, status: "pending" as const }];
    }));
    return {
      commandIds: commands.map((command) => command.commandId),
      platforms,
      status: "pending" as const
    } satisfies InventorySyncState;
  }

  async function previewInventoryChange(
    task: KitchenTask,
    lineKey: string,
    ingredientLabel: string,
    targetKind: "item" | "option" = "option"
  ) {
    setRevealedInventoryLineKey("");
    setInventoryDialog({
      task,
      lineKey,
      ingredientLabel,
      inventoryKey: "",
      targets: [],
      loading: true,
      error: "",
      targetKind
    });
    const response = await fetch("/api/store/display/kitchen/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "preview",
        storeId: selectedStoreId,
        brandId: task.brandId,
        ingredientLabel,
        targetKind
      })
    });
    const body = await response.json().catch(() => ({}));
    setInventoryDialog((current) => current?.lineKey === lineKey ? {
      ...current,
      loading: false,
      inventoryKey: String(body.inventoryKey ?? ""),
      ingredientLabel: String(body.ingredientLabel ?? ingredientLabel),
      targets: Array.isArray(body.targets) ? body.targets : [],
      error: response.ok ? "" : String(body.error ?? "Uber Eats の対象を確認できませんでした。")
    } : current);
  }

  async function applyInventoryChange() {
    const dialog = inventoryDialog;
    if (!dialog || dialog.loading || dialog.error) return;
    setInventorySaving(true);
    const response = await fetch("/api/store/display/kitchen/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "apply",
        storeId: selectedStoreId,
        brandId: dialog.task.brandId,
        ingredientLabel: dialog.ingredientLabel,
        targetKind: dialog.targetKind,
        isAvailable: false
      })
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.commandId) {
      const inventoryKey = String(body.inventoryKey || dialog.inventoryKey);
      setInventorySyncByKey((current) => ({
        ...current,
        [inventoryKey]: registerInventoryCommands(body, inventoryKey)
      }));
      setInventoryKeyByLineKey((current) => ({ ...current, [dialog.lineKey]: inventoryKey }));
      setInventoryDialog(null);
    } else {
      setInventoryDialog((current) => current ? {
        ...current,
        error: String(body.error ?? "缺貨設定を送信できませんでした。")
      } : current);
    }
    setInventorySaving(false);
  }

  async function loadUnavailableInventory(storeId = selectedStoreIdRef.current) {
    if (!storeId) return;
    setInventoryListLoading(true);
    setInventoryListError("");
    const params = new URLSearchParams({ storeId, ts: String(Date.now()) });
    const response = await fetch(`/api/store/display/kitchen/inventory?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setUnavailableInventory(Array.isArray(body.items) ? body.items : []);
    } else {
      setInventoryListError(String(body.error ?? (displayLanguage === "zh" ? "无法读取缺货项目。" : "売り切れ項目を読み込めませんでした。")));
    }
    setInventoryListLoading(false);
  }

  async function restoreInventoryItem(item: UnavailableInventoryItem) {
    if (inventoryRestoringKey) return;
    setInventoryRestoringKey(item.inventoryKey);
    setInventoryListError("");
    const response = await fetch("/api/store/display/kitchen/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "apply",
        storeId: selectedStoreId,
        brandId: item.brandId,
        ingredientLabel: item.ingredientLabel,
        targetKind: item.targetKind,
        isAvailable: true
      })
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.commandId) {
      const inventoryKey = String(body.inventoryKey || item.inventoryKey);
      setInventorySyncByKey((current) => ({
        ...current,
        [inventoryKey]: registerInventoryCommands(body, inventoryKey)
      }));
    } else {
      setInventoryListError(String(body.error ?? (isChinese ? "无法发送恢复销售操作。" : "販売再開を送信できませんでした。")));
    }
    setInventoryRestoringKey("");
  }

  async function startInventoryAudit() {
    if (inventoryAudit?.status === "pending") return;
    const confirmed = window.confirm(isChinese
      ? "开始完整检查后，Bridge 会逐项打开 Uber 菜单读取库存。检查期间请不要操作 Uber 平板。是否开始？"
      : "完全チェック中は Bridge が Uber メニューを順番に開きます。完了まで Uber タブレットを操作しないでください。開始しますか？");
    if (!confirmed) return;
    setInventoryListError("");
    const response = await fetch("/api/store/display/kitchen/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "audit", storeId: selectedStoreId })
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.commandId) {
      setInventoryAudit({
        commandId: String(body.commandId),
        status: "pending",
        targetCount: Number(body.targetCount ?? 0),
        checkedCount: 0,
        updatedCount: 0,
        missingCount: 0,
        error: ""
      });
    } else {
      setInventoryListError(String(body.error ?? (isChinese ? "无法开始完整检查。" : "完全チェックを開始できませんでした。")));
    }
  }

  async function updateTask(task: KitchenTask, status: "new" | "preparing" | "ready") {
    setSavingId(task.id);
    const response = await fetch("/api/store/display/kitchen", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, taskId: task.id, status, area: selectedArea })
    });
    if (response.ok) {
      const body = await response.json();
      syncServerTime(body.serverNow);
      setTasks(body.tasks ?? []);
      setAreas(body.areas ?? areas);
      setDisplayLanguage(body.displayLanguage === "zh" ? "zh" : "ja");
    } else {
      await load();
    }
    setSavingId("");
  }

  async function rollbackTask(task: KitchenTask, status: "new" | "preparing") {
    const language = task.kitchenLanguage;
    const confirmed = window.confirm(
      status === "new"
        ? (language === "zh"
          ? `将订单 ${task.pickupCode} 返回“待制作”并重置倒计时吗？`
          : `注文 ${task.pickupCode} を「制作待ち」に戻し、カウントダウンをリセットしますか？`)
        : (language === "zh"
          ? `将订单 ${task.pickupCode} 返回“制作中”吗？`
          : `注文 ${task.pickupCode} を「制作中」に戻しますか？`)
    );
    if (!confirmed) return;
    await updateTask(task, status);
  }

  async function completeHandoff(task: KitchenTask) {
    setSavingId(task.id);
    const response = await fetch("/api/store/display/kitchen", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, orderId: task.orderId, status: "completed", area: selectedArea })
    });
    if (response.ok) {
      const body = await response.json();
      syncServerTime(body.serverNow);
      setTasks(body.tasks ?? []);
      setAreas(body.areas ?? areas);
      setDisplayLanguage(body.displayLanguage === "zh" ? "zh" : "ja");
    } else {
      await load();
    }
    setSavingId("");
  }

  async function adjustPreparationTime(task: KitchenTask, minutes: -5 | 5 | 10 | 15) {
    setSavingId(task.id);
    const response = await fetch("/api/store/display/kitchen", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        orderId: task.orderId,
        addMinutes: minutes,
        area: selectedArea
      })
    });
    if (response.ok) {
      const body = await response.json();
      syncServerTime(body.serverNow);
      setTasks(body.tasks ?? []);
      setAreas(body.areas ?? areas);
      setDisplayLanguage(body.displayLanguage === "zh" ? "zh" : "ja");
    } else {
      await load();
    }
    setSavingId("");
  }

  async function requestReprint(task: KitchenTask) {
    const language = task.kitchenLanguage;
    if (!window.confirm(language === "zh"
      ? `补打订单 ${task.pickupCode} 的厨房单吗？`
      : `注文 ${task.pickupCode} の厨房伝票を再印刷しますか？`)) return;
    setSavingId(task.id);
    const response = await fetch("/api/store/print-station", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        taskId: task.id,
        printStatus: "reprint_pending"
      })
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      setTasks((current) => current.map((item) => (
        item.id === task.id ? { ...item, printStatus: "reprint_pending" } : item
      )));
      setReprintQueuedId(task.id);
      window.setTimeout(() => setReprintQueuedId((current) => current === task.id ? "" : current), 4000);
    } else {
      window.alert(language === "zh"
        ? "无法加入补打队列。请确认该订单当前没有正在打印。"
        : "再印刷を予約できませんでした。現在印刷中でないか確認してください。");
    }
    setSavingId("");
  }

  async function saveKitchenDisplayMode(mode: KitchenDisplayMode) {
    const previous = kitchenDisplayMode;
    setKitchenDisplayMode(mode);
    const response = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kitchenDisplayMode: mode })
    });
    if (!response.ok) setKitchenDisplayMode(previous);
  }

  useEffect(() => {
    void load();
    if (businessDayOffset === -1) return;
    if (realtimeStatus === "connected") return;
    const poller = createStoreFallbackPoller(
      () => load(selectedStoreIdRef.current, selectedArea),
      { baseIntervalMs: 60_000, storeIds: () => [selectedStoreIdRef.current].filter(Boolean) }
    );
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDayOffset, realtimeStatus, selectedArea]);

  useEffect(() => {
    if (selectedStoreId) void loadUnavailableInventory(selectedStoreId);
    // The sold-out list is intentionally loaded only when the store changes, not on the kitchen refresh loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    const storeId = selectedStoreIdRef.current;
    if (businessDayOffset === -1) {
      setRealtimeStatus("history");
      return () => {
        active = false;
      };
    }
    if (!storeId) {
      setRealtimeStatus("polling");
      return () => {
        active = false;
      };
    }
    const refreshFromEvent = () => {
      void load(selectedStoreIdRef.current, selectedArea);
    };
    setRealtimeStatus("connecting");
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active) return;
        if (!config?.key || !config?.cluster || !config?.channels?.length) {
          setRealtimeStatus("polling");
          return;
        }
        const { acquireSharedPusher } = await import("../../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
    pusher.connection.bind("unavailable", () => {
          if (active) {
            setRealtimeStatus("polling");
            setBridgePresence("connecting");
          }
        });
        pusher.connection.bind("failed", () => {
          if (active) {
            setRealtimeStatus("polling");
            setBridgePresence("connecting");
          }
        });
        pusher.connection.bind("disconnected", () => {
          if (active) {
            setRealtimeStatus("polling");
            setBridgePresence("connecting");
          }
        });
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", () => {
            if (active) setRealtimeStatus("connected");
          });
          channel.bind("pusher:subscription_error", () => {
            if (active) setRealtimeStatus("polling");
          });
          channel.bind("order.created", refreshFromEvent);
          channel.bind("order.updated", refreshFromEvent);
          return channel;
        });
        if (config.bridgeChannel) {
          const bridgeChannel = pusher.subscribe(config.bridgeChannel);
          bridgeChannel.bind("pusher:subscription_succeeded", (members: any) => {
            if (!active) return;
            const bridgeIds = new Set<string>();
            if (members?.each) {
              members.each((member: any) => {
                if (member?.info?.role === "bridge") bridgeIds.add(String(member.id));
              });
            }
            bridgeMemberIdsRef.current = bridgeIds;
            setBridgePresence(bridgeIds.size > 0 ? "online" : "offline");
          });
          bridgeChannel.bind("pusher:member_added", (member: any) => {
            if (!active || member?.info?.role !== "bridge") return;
            bridgeMemberIdsRef.current.add(String(member.id));
            setBridgePresence("online");
          });
          bridgeChannel.bind("pusher:member_removed", (member: any) => {
            if (!active || member?.info?.role !== "bridge") return;
            bridgeMemberIdsRef.current.delete(String(member.id));
            setBridgePresence(bridgeMemberIdsRef.current.size > 0 ? "online" : "offline");
          });
          bridgeChannel.bind("bridge.status.updated", (event: any) => {
            if (active && event?.status) setBridgeStatus((current) => ({ ...current, ...event.status }));
          });
          bridgeChannel.bind("bridge.command.updated", (event: any) => {
            const command = event?.command;
            if (!active || !command?.id) return;
            const commandId = String(command.id);
            const binding = inventoryCommandByIdRef.current[commandId];
            const inventoryKey = binding?.inventoryKey ?? "";
            if (binding) {
              setInventorySyncByKey((current) => {
                const value = current[inventoryKey];
                if (!value) return current;
                const nextCommandStatus: "pending" | "succeeded" | "failed" = command.status === "succeeded"
                  ? "succeeded"
                  : command.status === "pending" || command.status === "processing"
                    ? "pending"
                    : "failed";
                const platforms = {
                  ...value.platforms,
                  [binding.platform]: {
                    commandId,
                    status: nextCommandStatus,
                    error: String(command.error ?? "")
                  }
                };
                const platformStates = Object.values(platforms);
                const status = platformStates.some((state) => state.status === "pending")
                  ? "pending"
                  : platformStates.some((state) => state.status === "failed")
                    ? "failed"
                    : "succeeded";
                return {
                  ...current,
                  [inventoryKey]: {
                    ...value,
                    platforms,
                    status,
                    error: platformStates.map((state) => state.error).filter(Boolean).join(" / ")
                  }
                };
              });
              if (command.status === "succeeded") {
                delete inventoryCommandByIdRef.current[commandId];
                void loadUnavailableInventory(selectedStoreIdRef.current);
              }
            }
            setInventoryAudit((current) => {
              if (!current || current.commandId !== commandId) return current;
              const result = command.result && typeof command.result === "object" ? command.result : {};
              return {
                ...current,
                status: command.status === "succeeded"
                  ? "succeeded"
                  : command.status === "pending" || command.status === "processing"
                    ? "pending"
                    : "failed",
                checkedCount: Number(result.checkedCount ?? current.checkedCount),
                updatedCount: Number(result.updatedCount ?? current.updatedCount),
                missingCount: Number(result.missingCount ?? current.missingCount),
                error: String(command.error ?? "")
              };
            });
          });
          bridgeChannel.bind("bridge.inventory.updated", () => {
            if (active) void loadUnavailableInventory(selectedStoreIdRef.current);
          });
          channels.push(bridgeChannel);
        }
      })
      .catch(() => {
        if (active) setRealtimeStatus("polling");
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("order.created", refreshFromEvent);
        channel.unbind("order.updated", refreshFromEvent);
        channel.unbind("pusher:member_added");
        channel.unbind("pusher:member_removed");
        channel.unbind("bridge.status.updated");
        channel.unbind("bridge.command.updated");
        channel.unbind("bridge.inventory.updated");
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDayOffset, selectedArea, selectedStoreId]);

  const taskCounts = useMemo(() => ({
    active: businessDayOffset === -1 ? tasks.length : tasks.filter((task) => task.status !== "ready").length,
    new: tasks.filter((task) => task.status === "new").length,
    preparing: tasks.filter((task) => task.status === "preparing").length,
    ready: tasks.filter((task) => task.status === "ready").length
  }), [businessDayOffset, tasks]);
  const filteredTasks = useMemo(() => tasks.filter((task) => (
    statusFilter === "active"
      ? (businessDayOffset === -1 || task.status !== "ready")
      : task.status === statusFilter
  )), [businessDayOffset, statusFilter, tasks]);
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;
  const isChinese = displayLanguage === "zh";
  const bridgeOnline = bridgePresence === "online"
    || (bridgePresence === "connecting" && bridgeStatus?.recentlyOnline === true);
  const bridgeLevel = !bridgeOnline
    ? "error"
    : bridgeStatus?.level === "error"
      ? "error"
      : bridgeStatus?.level === "attention" || bridgePresence === "connecting"
        ? "attention"
        : "healthy";
  const bridgeLabel = bridgeLevel === "healthy"
    ? (isChinese ? "Bridge 正常" : "Bridge 正常")
    : bridgeLevel === "attention"
      ? (isChinese ? "Bridge 检查中" : "Bridge 確認中")
      : (isChinese ? "Bridge 异常" : "Bridge 異常");

  return (
    <main className="store-kitchen-display store-kitchen-page">
      <button
        className="store-display-menu-button"
        type="button"
        aria-label="メニュー"
        onClick={() => {
          if (!menuOpen) void activateDisplayMode();
          setMenuOpen((current) => !current);
        }}
      />
      {menuOpen ? (
        <div className="store-display-menu">
          <strong>{isChinese ? "厨房" : "キッチン"}</strong>
          {stores.length > 1 ? (
            <label className="store-context-selector is-store is-compact">
              <span>{isChinese ? "显示门店" : "表示店舗"}</span>
              <select value={selectedStoreId} onChange={(event) => {
                const storeId = event.target.value;
                resetNewOrderBaseline();
                setSelectedStoreId(storeId);
                selectedStoreIdRef.current = storeId;
                setStoredStoreSelection(storeId);
                void load(storeId, selectedArea);
              }}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          ) : null}
          <select value={selectedArea} onChange={(event) => {
            resetNewOrderBaseline();
            setSelectedArea(event.target.value);
          }} aria-label="制作区">
            <option value="">{isChinese ? "全部" : "全部"}</option>
            {areas.map((area) => <option key={area.value} value={area.value}>{isChinese && area.label === "調理" ? "烹饪" : area.label}</option>)}
          </select>
          <label className="store-context-selector is-compact">
            <span>{isChinese ? "营业日" : "営業日"}</span>
            <select value={businessDayOffset} onChange={(event) => {
              const nextOffset = event.target.value === "-1" ? -1 : 0;
              resetNewOrderBaseline();
              setStatusFilter("active");
              setBusinessDayOffset(nextOffset);
            }}>
              <option value="0">{isChinese ? "当前营业日" : "現在の営業日"}</option>
              <option value="-1">{isChinese ? "上一个营业日（只读）" : "前の営業日（閲覧のみ）"}</option>
            </select>
          </label>
          <label className="store-context-selector is-compact">
            <span>{isChinese ? "内容显示" : "内容表示"}</span>
            <select
              value={kitchenDisplayMode}
              onChange={(event) => {
                const mode = event.target.value;
                void saveKitchenDisplayMode(
                  mode === "order_only" || mode === "simple" ? mode : "detailed"
                );
              }}
            >
              <option value="order_only">{isChinese ? "仅下单内容（熟练员工）" : "注文内容のみ（熟練者向け）"}</option>
              <option value="simple">{isChinese ? "下单内容＋食材名称" : "注文内容＋食材名"}</option>
              <option value="detailed">{isChinese ? "下单内容＋食材・操作说明" : "注文内容＋食材・作業説明"}</option>
            </select>
          </label>
          <button className="secondary-button" type="button" onClick={() => void load()}>{loading ? (isChinese ? "加载中" : "読み込み中") : (isChinese ? "刷新" : "更新")}</button>
          <button className="store-kitchen-inventory-manager-button" type="button" onClick={() => {
            setMenuOpen(false);
            setInventoryManagerOpen(true);
            void loadUnavailableInventory();
          }}>
            <span>{isChinese ? "缺货管理" : "売切管理"}</span>
            {unavailableInventory.length ? <b>{unavailableInventory.length}</b> : null}
          </button>
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            {isChinese ? "全屏・保持亮屏 ON" : "全画面・常時点灯 ON"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={async () => {
              const next = !soundEnabledRef.current;
              soundEnabledRef.current = next;
              setSoundEnabled(next);
              if (next && await ensureAudioReady() && audioContextRef.current) {
                playStoreOrderAlertSound(audioContextRef.current, orderAlertSoundRef.current);
              }
            }}
          >
            {soundEnabled && soundReady
              ? (isChinese ? "新订单提示音 ON" : "新規注文音 ON")
              : (isChinese ? "开启新订单提示音" : "新規注文音を有効にする")}
          </button>
          <small>{businessDayOffset === -1
            ? (isChinese ? "历史查看模式" : "履歴表示モード")
            : realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"}</small>
          <a className="secondary-button" href="/store/orders">注文ワーク台</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
        </div>
      ) : null}

      <div className={`store-kitchen-bridge-status is-${bridgeLevel}`} title={bridgeStatus?.problem || bridgeLabel}>
        <span aria-hidden="true" />
        <b>{bridgeLabel}</b>
        {Number(bridgeStatus?.pendingCount ?? 0) > 0 ? (
          <small>{isChinese ? `待发送 ${bridgeStatus?.pendingCount}` : `未送信 ${bridgeStatus?.pendingCount}`}</small>
        ) : null}
      </div>

      {newOrderNotice ? (
        <button
          className="store-kitchen-new-order-alert"
          type="button"
          role="alert"
          aria-live="assertive"
          onClick={() => {
            setStatusFilter("active");
            setSelectedTaskId(newOrderNotice.taskId);
            setNewOrderNotice(null);
            setNewArrivalOrderIds([]);
          }}
        >
          <span aria-hidden="true">!</span>
          <strong>{isChinese ? "新订单" : "新規注文"}</strong>
          <b>{newOrderNotice.orderCount > 1
            ? (isChinese ? `${newOrderNotice.orderCount} 单` : `${newOrderNotice.orderCount}件`)
            : `#${newOrderNotice.pickupCode}`}</b>
          {newOrderNotice.orderCount === 1 ? (
            <small>{isChinese ? `共 ${newOrderNotice.itemCount} 件商品` : `商品 合計${newOrderNotice.itemCount}点`}</small>
          ) : null}
        </button>
      ) : null}

      <section className="store-kitchen-board">
        <nav className="store-kitchen-status-tabs" aria-label={isChinese ? "按状态筛选" : "状態で絞り込み"}>
          {([
            ["active", businessDayOffset === -1 ? (isChinese ? "全部" : "すべて") : (isChinese ? "进行中" : "進行中")],
            ["new", isChinese ? "待制作" : "制作待ち"],
            ["preparing", isChinese ? "制作中" : "制作中"],
            ["ready", isChinese ? "已完成" : "完成"]
          ] as Array<[KitchenStatusFilter, string]>).map(([value, label]) => (
            <button
              className={statusFilter === value ? "is-active" : ""}
              type="button"
              key={value}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              <span>{label}</span>
              <b>{taskCounts[value]}</b>
            </button>
          ))}
        </nav>

        <div className="store-kitchen-workspace">
          <aside className="store-kitchen-queue" aria-label={isChinese ? "订单队列" : "注文キュー"}>
            <header>
              <div>
                <small>{displayedBusinessDate ? `${displayedBusinessDate} · ` : ""}{isChinese ? "按时间排序" : "時刻順"}</small>
                <strong>{isChinese ? "订单队列" : "注文キュー"}</strong>
              </div>
              <b>{filteredTasks.length}</b>
            </header>
            <div className="store-kitchen-queue-list">
              {filteredTasks.map((task, index) => (
                <button
                  className={`store-kitchen-queue-item is-${task.status}${selectedTask?.id === task.id ? " is-selected" : ""}${newArrivalOrderIds.includes(task.orderId) ? " is-arriving" : ""}`}
                  type="button"
                  key={task.id}
                  aria-pressed={selectedTask?.id === task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span className="store-kitchen-queue-position">{String(index + 1).padStart(2, "0")}</span>
                  <span className="store-kitchen-queue-main">
                    <span className="store-kitchen-queue-code">{task.pickupCode}</span>
                    <span className="store-kitchen-queue-meta">
                      {formatOrderDateTime(task.scheduledAt || task.createdAt, task.kitchenLanguage)}
                      <em>{statusLabels[task.kitchenLanguage][task.status]}</em>
                    </span>
                    <span className="store-kitchen-queue-items">
                      {(task.itemGroups ?? []).map((group) => group.itemName).filter(Boolean).join(" / ") || (isChinese ? "内容未登记" : "内容未登録")}
                    </span>
                  </span>
                  <span className="store-kitchen-queue-side">
                    <span className="store-kitchen-platform-block">
                      <PlatformLogo source={task.orderSource} />
                      <span className="store-kitchen-item-count">
                        {task.kitchenLanguage === "zh" ? `共 ${getKitchenItemCount(task)} 件` : `合計 ${getKitchenItemCount(task)}点`}
                      </span>
                    </span>
                    <strong>{formatOrderAmount(task.amount, task.currency)}</strong>
                  </span>
                </button>
              ))}
              {!filteredTasks.length ? (
                <p className="store-kitchen-empty">
                  {isChinese ? "当前筛选条件下没有订单。" : "この状態の注文はありません。"}
                </p>
              ) : null}
            </div>
          </aside>

          <div className="store-kitchen-detail">
            {selectedTask ? (() => {
              const task = selectedTask;
              return (
              <article className={`store-kitchen-task is-${task.status}${task.isHistorical ? " is-historical" : ""}`} key={task.id}>
                {task.isHistorical ? (
                  <p className="store-kitchen-note">
                    {task.kitchenLanguage === "zh" ? "历史订单 · 仅供查看，不会更改制作状态" : "過去の注文 · 閲覧のみ（制作状態は変更されません）"}
                  </p>
                ) : null}
                <div className="store-kitchen-platform-row">
                  <PlatformLogo source={task.orderSource} />
                  <span className={`store-kitchen-status is-${task.status}`}>
                    {task.kitchenLanguage === "zh" && task.productionAreaLabel === "調理" ? "烹饪" : task.productionAreaLabel} / {statusLabels[task.kitchenLanguage][task.status]}
                  </span>
                </div>
                <div className="store-kitchen-order-identity">
                  <div>
                    <small>{task.kitchenLanguage === "zh" ? "客户" : "お客様"}</small>
                    <strong>{task.customerName || (task.kitchenLanguage === "zh" ? "姓名未登记" : "お名前未登録")}</strong>
                  </div>
                  <div className="store-kitchen-order-item-total">
                    <small>{task.kitchenLanguage === "zh" ? "商品数量" : "商品点数"}</small>
                    <strong>{task.kitchenLanguage === "zh" ? `${getKitchenItemCount(task)} 件` : `${getKitchenItemCount(task)}点`}</strong>
                  </div>
                  <div>
                    <small>{task.kitchenLanguage === "zh" ? "订单编号" : "注文番号"}</small>
                    <b>{task.pickupCode}</b>
                  </div>
                </div>
                <div className="store-kitchen-order-facts">
                  <div className="store-kitchen-fulfillment">
                    <small>{task.kitchenLanguage === "zh" ? "配送方式" : "受取方法"}</small>
                    <strong>{orderTypeLabels[task.kitchenLanguage][getEffectiveOrderType(task)]}</strong>
                  </div>
                  <div className="store-kitchen-order-amount">
                    <small>{task.kitchenLanguage === "zh" ? "订单金额" : "注文金額"}</small>
                    <strong>{formatOrderAmount(task.amount, task.currency)}</strong>
                  </div>
                  <div>
                    <small>
                      {pickupOrderSources.has(task.orderSource)
                        ? (task.kitchenLanguage === "zh" ? "取餐时间" : "受取日時")
                        : (task.kitchenLanguage === "zh" ? "下单时间" : "注文日時")}
                    </small>
                    <strong>{formatOrderDateTime(task.scheduledAt || task.createdAt, task.kitchenLanguage)}</strong>
                  </div>
                </div>
                {task.tableLabel ? <p className="store-kitchen-table-label">{task.kitchenLanguage === "zh" ? "座位" : "座席"} {task.tableLabel}</p> : null}
                <div className={`store-kitchen-timing is-${task.status}`}>
                  <strong>
                    {task.status === "preparing"
                      ? (getCountdownLabel(task.estimatedReadyAt, now, task.kitchenLanguage) || (task.kitchenLanguage === "zh" ? "制作中" : "制作中"))
                      : task.status === "ready"
                        ? (task.kitchenLanguage === "zh" ? "已完成" : "完成")
                        : (task.kitchenLanguage === "zh"
                          ? `开始后 ${task.estimatedPrepMinutes || 10} 分钟`
                          : `開始後 ${task.estimatedPrepMinutes || 10}分`)}
                  </strong>
                  {task.status === "preparing" ? (
                    <div className="store-kitchen-delay-actions" aria-label={task.kitchenLanguage === "zh" ? "调整制作时间" : "調理時間を調整"}>
                      <span>{task.kitchenLanguage === "zh" ? "时间调整" : "時間調整"}</span>
                      {([-5, 5, 10, 15] as const).map((minutes) => (
                        <button
                          className="secondary-button"
                          type="button"
                          key={minutes}
                          disabled={savingId === task.id}
                          onClick={() => void adjustPreparationTime(task, minutes)}
                        >
                          {minutes > 0 ? `+${minutes}` : minutes}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={`store-kitchen-order-summary${kitchenDisplayMode === "order_only" ? " is-order-only" : ""}${task.isHistorical ? " is-read-only" : ""}`}>
                  <small>{task.kitchenLanguage === "zh" ? "客人下单内容" : "注文内容"}</small>
                  {(task.itemGroups ?? []).map((group, groupIndex) => {
                    const productLineKey = `${task.id}:order:${groupIndex}:product`;
                    const productInventoryKey = inventoryKeyByLineKey[productLineKey] ?? "";
                    const productInventorySync = productInventoryKey
                      ? inventorySyncByKey[productInventoryKey]
                      : undefined;
                    return (
                      <section className="store-kitchen-order-group" key={`${task.id}:group:${groupIndex}`}>
                        <div className={`store-kitchen-inventory-swipe${revealedInventoryLineKey === productLineKey ? " is-revealed" : ""}`}>
                          <button
                            className="store-kitchen-inventory-action"
                            type="button"
                            onClick={() => void previewInventoryChange(task, productLineKey, group.itemName, "item")}
                          >
                            <span>{task.kitchenLanguage === "zh" ? "商品缺货" : "商品売切れ"}</span>
                            <small>Bridge</small>
                          </button>
                          {kitchenDisplayMode === "order_only" ? (
                            <button
                              className={`store-kitchen-order-product store-kitchen-order-action${checkedLineKeys.has(productLineKey) ? " is-checked" : ""}`}
                              type="button"
                              aria-pressed={checkedLineKeys.has(productLineKey)}
                              onPointerDown={(event) => {
                                event.currentTarget.setPointerCapture?.(event.pointerId);
                                startInventorySwipe(productLineKey, event.clientX, event.clientY);
                              }}
                              onPointerMove={(event) => moveInventorySwipe(productLineKey, event.clientX, event.clientY)}
                              onPointerUp={(event) => finishInventorySwipe(productLineKey, event.clientX, event.clientY)}
                              onPointerCancel={() => { inventoryPointerRef.current = null; }}
                              onClick={() => toggleLineCheck(task, productLineKey, true)}
                            >
                              <span>{group.itemName}</span>
                              {task.showAmounts ? <em className="store-kitchen-line-amount">{formatOrderAmount(group.amount, task.currency)}</em> : null}
                              {group.quantity > 1 ? <b>× {group.quantity}</b> : null}
                              {productInventorySync ? (
                                <em className={`store-kitchen-inventory-sync is-${productInventorySync.status}`}>
                                  {formatInventorySyncLabel(productInventorySync, task.kitchenLanguage)}
                                </em>
                              ) : null}
                            </button>
                          ) : (
                            <div
                              className="store-kitchen-order-product store-kitchen-product-swipe-foreground"
                              onPointerDown={(event) => {
                                event.currentTarget.setPointerCapture?.(event.pointerId);
                                startInventorySwipe(productLineKey, event.clientX, event.clientY);
                              }}
                              onPointerMove={(event) => moveInventorySwipe(productLineKey, event.clientX, event.clientY)}
                              onPointerUp={(event) => finishInventorySwipe(productLineKey, event.clientX, event.clientY)}
                              onPointerCancel={() => { inventoryPointerRef.current = null; }}
                            >
                              <span>{group.itemName}</span>
                              {task.showAmounts ? <em className="store-kitchen-line-amount">{formatOrderAmount(group.amount, task.currency)}</em> : null}
                              {group.quantity > 1 ? <b>× {group.quantity}</b> : null}
                              {productInventorySync ? (
                                <em className={`store-kitchen-inventory-sync is-${productInventorySync.status}`}>
                                  {formatInventorySyncLabel(productInventorySync, task.kitchenLanguage)}
                                </em>
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div className="store-kitchen-order-options">
                          {group.options.map((option, optionIndex) => {
                            const optionLineKey = `${task.id}:order:${groupIndex}:option:${optionIndex}`;
                            const optionInventoryKey = inventoryKeyByLineKey[optionLineKey] ?? "";
                            const optionInventorySync = optionInventoryKey
                              ? inventorySyncByKey[optionInventoryKey]
                              : undefined;
                            return (
                              <div
                                className={`store-kitchen-inventory-swipe${revealedInventoryLineKey === optionLineKey ? " is-revealed" : ""}`}
                                key={`${task.id}:customer:${groupIndex}:${optionIndex}`}
                              >
                                <button
                                  className="store-kitchen-inventory-action"
                                  type="button"
                                  onClick={() => void previewInventoryChange(task, optionLineKey, option.label, "option")}
                                >
                                  <span>{task.kitchenLanguage === "zh" ? "加料缺货" : "選択肢売切れ"}</span>
                                  <small>Bridge</small>
                                </button>
                                {kitchenDisplayMode === "order_only" ? (
                                  <button
                                    className={`store-kitchen-order-option store-kitchen-order-action${checkedLineKeys.has(optionLineKey) ? " is-checked" : ""}`}
                                    type="button"
                                    aria-pressed={checkedLineKeys.has(optionLineKey)}
                                    onPointerDown={(event) => {
                                      event.currentTarget.setPointerCapture?.(event.pointerId);
                                      startInventorySwipe(optionLineKey, event.clientX, event.clientY);
                                    }}
                                    onPointerMove={(event) => moveInventorySwipe(optionLineKey, event.clientX, event.clientY)}
                                    onPointerUp={(event) => finishInventorySwipe(optionLineKey, event.clientX, event.clientY)}
                                    onPointerCancel={() => { inventoryPointerRef.current = null; }}
                                    onClick={() => toggleLineCheck(task, optionLineKey, true)}
                                  >
                                    <span>{option.label}</span>
                                    {task.showAmounts ? <em className="store-kitchen-line-amount">{formatOrderAmount(option.amount, task.currency)}</em> : null}
                                    {option.count > 1 ? <b>× {option.count}</b> : null}
                                    {optionInventorySync ? (
                                      <em className={`store-kitchen-inventory-sync is-${optionInventorySync.status}`}>
                                        {formatInventorySyncLabel(optionInventorySync, task.kitchenLanguage)}
                                      </em>
                                    ) : null}
                                  </button>
                                ) : (
                                  <div
                                    className="store-kitchen-order-option store-kitchen-option-swipe-foreground"
                                    onPointerDown={(event) => {
                                      event.currentTarget.setPointerCapture?.(event.pointerId);
                                      startInventorySwipe(optionLineKey, event.clientX, event.clientY);
                                    }}
                                    onPointerMove={(event) => moveInventorySwipe(optionLineKey, event.clientX, event.clientY)}
                                    onPointerUp={(event) => finishInventorySwipe(optionLineKey, event.clientX, event.clientY)}
                                    onPointerCancel={() => { inventoryPointerRef.current = null; }}
                                  >
                                    <span>{option.label}</span>
                                    {task.showAmounts ? <em className="store-kitchen-line-amount">{formatOrderAmount(option.amount, task.currency)}</em> : null}
                                    {option.count > 1 ? <b>× {option.count}</b> : null}
                                    {optionInventorySync ? (
                                      <em className={`store-kitchen-inventory-sync is-${optionInventorySync.status}`}>
                                        {formatInventorySyncLabel(optionInventorySync, task.kitchenLanguage)}
                                      </em>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {kitchenDisplayMode !== "order_only" && group.productionLines.length ? (
                          <div className="store-kitchen-items">
                            <small className="store-kitchen-content-label">
                              {task.kitchenLanguage === "zh"
                                ? (kitchenDisplayMode === "simple" ? "对应食材" : "对应食材・操作说明")
                                : (kitchenDisplayMode === "simple" ? "使用食材" : "使用食材・作業説明")}
                            </small>
                            {group.productionLines.map((line, lineIndex) => {
                              const lineKey = `${task.id}:${groupIndex}:${lineIndex}`;
                              const displayText = kitchenDisplayMode === "simple"
                                ? simplifyKitchenLine(line, true)
                                : line;
                              const quantityParts = splitQuantityLabel(displayText);
                              const inventoryKey = inventoryKeyByLineKey[lineKey] ?? "";
                              const inventorySync = inventoryKey ? inventorySyncByKey[inventoryKey] : undefined;
                              return (
                                <div
                                  className={`store-kitchen-inventory-swipe${revealedInventoryLineKey === lineKey ? " is-revealed" : ""}`}
                                  key={lineKey}
                                >
                                  <button
                                    className="store-kitchen-inventory-action"
                                    type="button"
                                    onClick={() => void previewInventoryChange(task, lineKey, displayText)}
                                  >
                                    <span>{task.kitchenLanguage === "zh" ? "库存不足" : "在庫不足"}</span>
                                    <small>Bridge</small>
                                  </button>
                                  <button
                                    className={[
                                      "store-kitchen-item-line",
                                      "store-kitchen-item-modifier",
                                      checkedLineKeys.has(lineKey) ? "is-checked" : ""
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    aria-pressed={checkedLineKeys.has(lineKey)}
                                    onPointerDown={(event) => {
                                      event.currentTarget.setPointerCapture?.(event.pointerId);
                                      startInventorySwipe(lineKey, event.clientX, event.clientY);
                                    }}
                                    onPointerMove={(event) => moveInventorySwipe(lineKey, event.clientX, event.clientY)}
                                    onPointerUp={(event) => finishInventorySwipe(lineKey, event.clientX, event.clientY)}
                                    onPointerCancel={() => { inventoryPointerRef.current = null; }}
                                    onClick={() => toggleLineCheck(task, lineKey, true)}
                                  >
                                    <span>{quantityParts.label}</span>
                                    {quantityParts.quantity ? <b>{quantityParts.quantity}</b> : null}
                                    {inventorySync ? (
                                      <em className={`store-kitchen-inventory-sync is-${inventorySync.status}`}>
                                      {formatInventorySyncLabel(inventorySync, task.kitchenLanguage)}
                                      </em>
                                    ) : null}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
                {task.note ? (
                  <div className="store-kitchen-customer-note">
                    <strong>{task.kitchenLanguage === "zh" ? "客人备注" : "お客様のご要望"}</strong>
                    <p>{task.note}</p>
                    {task.noteOriginal ? <small>日语原文：{task.noteOriginal}</small> : null}
                  </div>
                ) : null}
                {!task.isHistorical ? <div className="store-kitchen-actions">
                  <button className="secondary-button store-kitchen-reprint-button" type="button" disabled={savingId === task.id} onClick={() => void requestReprint(task)}>
                    {reprintQueuedId === task.id
                      ? (task.kitchenLanguage === "zh" ? "已加入补打队列" : "再印刷を予約しました")
                      : (task.kitchenLanguage === "zh" ? "补打一张" : "再印刷")}
                  </button>
                  {task.status === "new" ? (
                    <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "preparing")}>{task.kitchenLanguage === "zh" ? "开始制作" : "制作開始"}</button>
                  ) : null}
                  {task.status === "preparing" ? (
                    <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => void rollbackTask(task, "new")}>
                      {task.kitchenLanguage === "zh" ? "撤销开始" : "開始を取り消す"}
                    </button>
                  ) : null}
                  {task.status === "ready" ? (
                    <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => void rollbackTask(task, "preparing")}>
                      {task.kitchenLanguage === "zh" ? "返回制作中" : "制作中に戻す"}
                    </button>
                  ) : (
                    <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "ready")}>{task.kitchenLanguage === "zh" ? (task.orderType === "eat_in" ? "出餐完成" : "完成") : (task.orderType === "eat_in" ? "提供完了" : "完成")}</button>
                  )}
                  {task.status === "ready" && tasks.every((candidate) => candidate.orderId !== task.orderId || candidate.status === "ready") ? (
                    <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => void completeHandoff(task)}>
                      {task.kitchenLanguage === "zh" ? "交付完成" : "受渡完了"}
                    </button>
                  ) : null}
                </div> : null}
              </article>
              );
            })() : (
              <div className="store-kitchen-detail-empty">
                <strong>{isChinese ? "请选择订单" : "注文を選択してください"}</strong>
                <p>{isChinese ? "当前筛选条件下没有可显示的订单。" : "この状態の注文はありません。"}</p>
              </div>
            )}
          </div>
        </div>
      </section>
      {inventoryDialog ? (
        <div className="store-kitchen-inventory-modal-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget && !inventorySaving) setInventoryDialog(null);
        }}>
          <section className="store-kitchen-inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title">
            <header>
              <span>Uber Eats</span>
              <button type="button" aria-label="閉じる" disabled={inventorySaving} onClick={() => setInventoryDialog(null)}>×</button>
            </header>
            <h2 id="inventory-dialog-title">
              {inventoryDialog.task.kitchenLanguage === "zh" ? "设为缺货？" : "売り切れにしますか？"}
            </h2>
            <strong>{inventoryDialog.ingredientLabel}</strong>
            {inventoryDialog.loading ? (
              <p>{inventoryDialog.task.kitchenLanguage === "zh" ? "正在确认关联商品…" : "連動対象を確認しています…"}</p>
            ) : inventoryDialog.error ? (
              <p className="is-error">{inventoryDialog.error}</p>
            ) : (
              <>
                <p>
                  {inventoryDialog.task.kitchenLanguage === "zh"
                    ? "以下项目会永久停售，直到你在 Uber 手动恢复。当前订单不会受到影响。"
                    : "次の項目を、Uber で手動再開するまで売り切れにします。現在の注文には影響しません。"}
                </p>
                <ul>
                  {inventoryDialog.targets.map((target) => (
                    <li key={target.targetId}>
                      <span>{target.label}</span>
                      <small>{target.kind === "item"
                        ? (inventoryDialog.task.kitchenLanguage === "zh" ? "商品" : "商品")
                        : /replacement/i.test(target.groupKey ?? "")
                        ? (inventoryDialog.task.kitchenLanguage === "zh" ? "变更面" : "変更麺")
                        : /noodle/i.test(target.groupKey ?? "")
                          ? (inventoryDialog.task.kitchenLanguage === "zh" ? "选择面" : "選択麺")
                          : "Uber Eats"}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <footer>
              <button className="secondary-button" type="button" disabled={inventorySaving} onClick={() => setInventoryDialog(null)}>
                {inventoryDialog.task.kitchenLanguage === "zh" ? "取消" : "キャンセル"}
              </button>
              <button className="danger-button" type="button" disabled={inventorySaving || inventoryDialog.loading || Boolean(inventoryDialog.error)} onClick={() => void applyInventoryChange()}>
                {inventorySaving
                  ? (inventoryDialog.task.kitchenLanguage === "zh" ? "正在发送…" : "送信中…")
                  : (inventoryDialog.task.kitchenLanguage === "zh" ? "全部设为缺货" : "すべて売り切れにする")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {inventoryManagerOpen ? (
        <div className="store-kitchen-inventory-modal-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget && !inventoryRestoringKey) setInventoryManagerOpen(false);
        }}>
          <section className="store-kitchen-inventory-modal store-kitchen-inventory-manager" role="dialog" aria-modal="true" aria-labelledby="inventory-manager-title">
            <header>
              <span>Foundr1 × Delivery Bridge</span>
              <button type="button" aria-label={isChinese ? "关闭" : "閉じる"} disabled={Boolean(inventoryRestoringKey)} onClick={() => setInventoryManagerOpen(false)}>×</button>
            </header>
            <div className="store-kitchen-inventory-manager-heading">
              <div>
                <h2 id="inventory-manager-title">{isChinese ? "缺货管理" : "売切管理"}</h2>
                <p>{isChinese ? "补充库存后，在这里恢复销售。Uber 与 Rocket 会分别同步。" : "補充後はここから販売を再開します。Uber と Rocket へ個別に同期します。"}</p>
              </div>
              <div className="store-kitchen-inventory-manager-heading-actions">
                <button className="secondary-button" type="button" disabled={inventoryAudit?.status === "pending"} onClick={() => void startInventoryAudit()}>
                  {inventoryAudit?.status === "pending"
                    ? (isChinese ? `完整检查中 · ${inventoryAudit.targetCount}项` : `完全チェック中 · ${inventoryAudit.targetCount}件`)
                    : (isChinese ? "手动完整检查" : "手動完全チェック")}
                </button>
                <strong>{unavailableInventory.length}</strong>
              </div>
            </div>
            {inventoryAudit?.status === "succeeded" ? (
              <p className="store-kitchen-inventory-audit-result">
                {isChinese
                  ? `完整检查完成：已读取 ${inventoryAudit.checkedCount} 项，未识别 ${inventoryAudit.missingCount} 项。`
                  : `完全チェック完了：${inventoryAudit.checkedCount}件を確認、未識別 ${inventoryAudit.missingCount}件。`}
              </p>
            ) : inventoryAudit?.status === "failed" ? (
              <p className="is-error">{inventoryAudit.error || (isChinese ? "完整检查失败，请重试。" : "完全チェックに失敗しました。再実行してください。")}</p>
            ) : null}
            {!bridgeOnline ? (
              <p className="store-kitchen-inventory-manager-warning">
                {isChinese ? "Bridge 当前离线。恢复操作可以发送，但会在 Bridge 重新在线后执行。" : "Bridge は現在オフラインです。再開操作は送信され、オンライン復帰後に実行されます。"}
              </p>
            ) : null}
            {inventoryListError ? <p className="is-error">{inventoryListError}</p> : null}
            {inventoryListLoading ? (
              <div className="store-kitchen-inventory-manager-empty">{isChinese ? "正在读取缺货项目…" : "売り切れ項目を読み込み中…"}</div>
            ) : unavailableInventory.length ? (
              <div className="store-kitchen-inventory-manager-list">
                {unavailableInventory.map((item) => {
                  const sync = inventorySyncByKey[item.inventoryKey];
                  const pending = sync?.status === "pending";
                  return (
                    <article key={`${item.brandId}:${item.targetKind}:${item.inventoryKey}`}>
                      <div className="store-kitchen-inventory-manager-copy">
                        <small>{item.targetKind === "item" ? (isChinese ? "商品" : "商品") : (isChinese ? "选项" : "選択肢")}</small>
                        <strong>{item.ingredientLabel}</strong>
                        <div>
                          {item.targets.map((target) => (
                            <span key={target.targetId}>{target.label}</span>
                          ))}
                        </div>
                        {sync?.status === "failed" ? <em>{sync.error || (isChinese ? "Uber 恢复失败，请重试。" : "Uber の再開に失敗しました。再試行してください。")}</em> : null}
                      </div>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={Boolean(inventoryRestoringKey) || pending}
                        onClick={() => void restoreInventoryItem(item)}
                      >
                        {pending
                          ? (isChinese ? "正在同步…" : "同期中…")
                          : inventoryRestoringKey === item.inventoryKey
                            ? (isChinese ? "正在发送…" : "送信中…")
                            : (isChinese ? "恢复销售" : "販売を再開")}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="store-kitchen-inventory-manager-empty">
                <strong>{isChinese ? "目前没有缺货项目" : "現在、売り切れはありません"}</strong>
                <span>{isChinese ? "所有商品和选项都可以销售。" : "すべての商品・選択肢を販売できます。"}</span>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
