"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";
import { useVisibleRefresh } from "../../components/useVisibleRefresh";

type KitchenTask = {
  id: string;
  orderId: string;
  brandId: string;
  productionArea: string;
  productionAreaLabel: string;
  status: string;
  printStatus: string;
  itemSummary: string;
  itemGroups: Array<{
    itemName: string;
    quantity: number;
    options: Array<{
      label: string;
      count: number;
    }>;
    productionLines: string[];
  }>;
  startedAt: string;
  estimatedPrepMinutes: number;
  estimatedReadyAt: string;
  pickupCode: string;
  tableLabel: string;
  orderSource: string;
  orderType: string;
  note: string;
  createdTime: string;
  kitchenLanguage: "ja" | "zh";
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
  commandId: string;
  status: "pending" | "succeeded" | "failed";
  error?: string;
};

type KitchenDisplayMode = "order_only" | "simple" | "detailed";

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

const statusLabels: Record<"ja" | "zh", Record<string, string>> = {
  ja: { new: "制作待ち", preparing: "制作中", ready: "完成" },
  zh: { new: "待制作", preparing: "制作中", ready: "已完成" }
};

const orderTypeLabels: Record<"ja" | "zh", Record<string, string>> = {
  ja: { eat_in: "店内", takeout: "持ち帰り", delivery: "配達", unknown: "受取方法未判定" },
  zh: { eat_in: "堂食", takeout: "自提", delivery: "外送", unknown: "取餐方式未确认" }
};

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
  const [selectedArea, setSelectedArea] = useState("");
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
  const [now, setNow] = useState(() => Date.now());
  const selectedStoreIdRef = useRef(selectedStoreId);
  const serverOffsetRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const autoStartingTaskIdsRef = useRef<Set<string>>(new Set());
  const bridgeMemberIdsRef = useRef<Set<string>>(new Set());
  const inventoryPointerRef = useRef<{ lineKey: string; x: number; y: number; handled: boolean } | null>(null);
  const suppressIngredientClickUntilRef = useRef(0);
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

  async function load(storeId = selectedStoreIdRef.current, area = selectedArea) {
    const loadSequence = ++loadSequenceRef.current;
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (area) params.set("area", area);
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
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setTasks(body.tasks ?? []);
    setAreas(body.areas ?? []);
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
        [inventoryKey]: { commandId: String(body.commandId), status: "pending" }
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
    if (realtimeStatus === "connected") return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void load(selectedStoreIdRef.current, selectedArea);
      },
      8000
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus, selectedArea]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    const storeId = selectedStoreIdRef.current;
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
            setInventorySyncByKey((current) => Object.fromEntries(
              Object.entries(current).map(([key, value]) => value.commandId === String(command.id)
                ? [key, {
                  ...value,
                  status: command.status === "succeeded"
                    ? "succeeded"
                    : command.status === "pending" || command.status === "processing"
                      ? "pending"
                      : "failed",
                  error: String(command.error ?? "")
                } satisfies InventorySyncState]
                : [key, value])
            ));
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
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea, selectedStoreId]);

  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== "ready"), [tasks]);
  const readyTasks = useMemo(() => tasks.filter((task) => task.status === "ready"), [tasks]);
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
                setSelectedStoreId(storeId);
                selectedStoreIdRef.current = storeId;
                setStoredStoreSelection(storeId);
                void load(storeId, selectedArea);
              }}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          ) : null}
          <select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)} aria-label="制作区">
            <option value="">{isChinese ? "全部" : "全部"}</option>
            {areas.map((area) => <option key={area.value} value={area.value}>{isChinese && area.label === "調理" ? "烹饪" : area.label}</option>)}
          </select>
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
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            {isChinese ? "全屏・保持亮屏 ON" : "全画面・常時点灯 ON"}
          </button>
          <small>{realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"}</small>
          <a className="secondary-button" href="/store/orders">注文ワーク台</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
        </div>
      ) : null}

      <div className={`store-kitchen-bridge-status is-${bridgeLevel}`} title={bridgeStatus?.problem || bridgeLabel}>
        <span aria-hidden="true" />
        <strong>Uber</strong>
        <b>{bridgeLabel}</b>
        {Number(bridgeStatus?.pendingCount ?? 0) > 0 ? (
          <small>{isChinese ? `待发送 ${bridgeStatus?.pendingCount}` : `未送信 ${bridgeStatus?.pendingCount}`}</small>
        ) : null}
      </div>

      <section className="store-kitchen-board">
        <div>
          <h2>{isChinese ? "待制作 / 制作中" : "制作待ち / 制作中"}</h2>
          <div className="store-kitchen-task-grid">
            {visibleTasks.map((task) => (
              <article className={`store-kitchen-task is-${task.status}`} key={task.id}>
                <div className="store-kitchen-task-head">
                  <strong>{task.pickupCode}</strong>
                  <span>
                    {task.kitchenLanguage === "zh" && task.productionAreaLabel === "調理" ? "烹饪" : task.productionAreaLabel} / {statusLabels[task.kitchenLanguage][task.status]}
                  </span>
                </div>
                <p>{(orderTypeLabels[task.kitchenLanguage][task.orderType] ?? task.orderType) || (task.kitchenLanguage === "zh" ? "取餐" : "受け取り")}{task.tableLabel ? ` / ${task.kitchenLanguage === "zh" ? "座位" : "座席"} ${task.tableLabel}` : ""} / {task.createdTime}</p>
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
                <div className={`store-kitchen-order-summary${kitchenDisplayMode === "order_only" ? " is-order-only" : ""}`}>
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
                            <small>Uber</small>
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
                              {group.quantity > 1 ? <b>× {group.quantity}</b> : null}
                              {productInventorySync ? (
                                <em className={`store-kitchen-inventory-sync is-${productInventorySync.status}`}>
                                  {productInventorySync.status === "pending"
                                    ? (task.kitchenLanguage === "zh" ? "Uber 待同步" : "Uber 同期待ち")
                                    : productInventorySync.status === "succeeded"
                                      ? (task.kitchenLanguage === "zh" ? "Uber 已缺货" : "Uber 売切れ済み")
                                      : (task.kitchenLanguage === "zh" ? "同步失败" : "同期失敗")}
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
                              {group.quantity > 1 ? <b>× {group.quantity}</b> : null}
                              {productInventorySync ? (
                                <em className={`store-kitchen-inventory-sync is-${productInventorySync.status}`}>
                                  {productInventorySync.status === "pending"
                                    ? (task.kitchenLanguage === "zh" ? "Uber 待同步" : "Uber 同期待ち")
                                    : productInventorySync.status === "succeeded"
                                      ? (task.kitchenLanguage === "zh" ? "Uber 已缺货" : "Uber 売切れ済み")
                                      : (task.kitchenLanguage === "zh" ? "同步失败" : "同期失敗")}
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
                                  <small>Uber</small>
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
                                    {option.count > 1 ? <b>× {option.count}</b> : null}
                                    {optionInventorySync ? (
                                      <em className={`store-kitchen-inventory-sync is-${optionInventorySync.status}`}>
                                        {optionInventorySync.status === "pending"
                                          ? (task.kitchenLanguage === "zh" ? "Uber 待同步" : "Uber 同期待ち")
                                          : optionInventorySync.status === "succeeded"
                                            ? (task.kitchenLanguage === "zh" ? "Uber 已缺货" : "Uber 売切れ済み")
                                            : (task.kitchenLanguage === "zh" ? "同步失败" : "同期失敗")}
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
                                    {option.count > 1 ? <b>× {option.count}</b> : null}
                                    {optionInventorySync ? (
                                      <em className={`store-kitchen-inventory-sync is-${optionInventorySync.status}`}>
                                        {optionInventorySync.status === "pending"
                                          ? (task.kitchenLanguage === "zh" ? "Uber 待同步" : "Uber 同期待ち")
                                          : optionInventorySync.status === "succeeded"
                                            ? (task.kitchenLanguage === "zh" ? "Uber 已缺货" : "Uber 売切れ済み")
                                            : (task.kitchenLanguage === "zh" ? "同步失败" : "同期失敗")}
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
                                    <small>Uber</small>
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
                                        {inventorySync.status === "pending"
                                          ? (task.kitchenLanguage === "zh" ? "Uber 待同步" : "Uber 同期待ち")
                                          : inventorySync.status === "succeeded"
                                            ? (task.kitchenLanguage === "zh" ? "Uber 已缺货" : "Uber 売切れ済み")
                                            : (task.kitchenLanguage === "zh" ? "同步失败" : "同期失敗")}
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
                {task.note ? <p className="store-kitchen-note">{task.note}</p> : null}
                <div className="store-kitchen-actions">
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
                  <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "ready")}>{task.kitchenLanguage === "zh" ? (task.orderType === "eat_in" ? "出餐完成" : "完成") : (task.orderType === "eat_in" ? "提供完了" : "完成")}</button>
                </div>
              </article>
            ))}
            {!visibleTasks.length ? <p className="store-kitchen-empty">{isChinese ? "当前没有待制作任务。" : "制作待ちの制作タスクはありません。"}</p> : null}
          </div>
        </div>

        <aside>
          <h2>{isChinese ? "已完成" : "完成"}</h2>
          <div className="store-kitchen-ready-list">
            {readyTasks.map((task, taskIndex) => (
              <div key={task.id}>
                <strong>{task.pickupCode}</strong>
                <span>{task.productionAreaLabel}</span>
                <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => void requestReprint(task)}>
                  {reprintQueuedId === task.id
                    ? (task.kitchenLanguage === "zh" ? "已排队" : "予約済み")
                    : (task.kitchenLanguage === "zh" ? "补打一张" : "再印刷")}
                </button>
                <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => void rollbackTask(task, "preparing")}>
                  {task.kitchenLanguage === "zh" ? "返回制作中" : "制作中に戻す"}
                </button>
                {readyTasks.findIndex((candidate) => candidate.orderId === task.orderId) === taskIndex && tasks.every((candidate) => candidate.orderId !== task.orderId || candidate.status === "ready") ? (
                  <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => void completeHandoff(task)}>{task.kitchenLanguage === "zh" ? "交付完成" : "受渡完了"}</button>
                ) : null}
              </div>
            ))}
            {!readyTasks.length ? <p>{isChinese ? "暂无已完成订单。" : "完成待ちです。"}</p> : null}
          </div>
        </aside>
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
    </main>
  );
}
