"use client";

import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { getStoredStoreSelection, setStoredStoreSelection, storeSelectionEventName } from "./store-selection";

type SharedPusher = ReturnType<(typeof import("../../../lib/shared-pusher-client"))["acquireSharedPusher"]>;
type SharedPusherChannel = ReturnType<SharedPusher["subscribe"]>;
type StoreMenuLanguage = "ja" | "zh-Hans" | "zh-Hant";
type InventorySyncStatus = "pending" | "succeeded" | "failed";

type InventorySyncPlatform = {
  commandId: string;
  platform: string;
  status: InventorySyncStatus;
  error: string;
};

export type StoreInventorySyncRun = {
  id: string;
  itemLabel: string;
  isAvailable: boolean;
  source: "siri" | "store";
  createdAt: string;
  platforms: InventorySyncPlatform[];
};

export const storeInventorySyncEventName = "foundr1-store-inventory-sync";

export function announceStoreInventorySync(run: StoreInventorySyncRun) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(storeInventorySyncEventName, { detail: { run } }));
}

function platformName(platform: string, language: StoreMenuLanguage) {
  if (platform === "foundr1") return language === "ja" ? "Web予約" : language === "zh-Hant" ? "網站預約" : "网站预约";
  if (platform === "uber_eats") return "Uber";
  if (platform === "rocket_now") return language === "ja" ? "ロケットナウ" : "火箭";
  if (platform === "demae_can") return language === "zh-Hans" ? "出前馆" : "出前館";
  return platform;
}

function syncCopy(language: StoreMenuLanguage) {
  if (language === "zh-Hans") {
    return {
      available: "恢复销售",
      unavailable: "缺货",
      pending: "执行中",
      succeeded: "成功",
      failed: "失败",
      title: "平台同步状态",
      login: "需要重新登录该平台。",
      target: "找不到对应的商品或选项。",
      pageTimeout: "平台页面响应超时。",
      expired: "同步任务已过期。",
      generic: "同步失败。",
      collapse: "收起",
      expand: "展开",
      siri: "Siri"
    };
  }
  if (language === "zh-Hant") {
    return {
      available: "恢復銷售",
      unavailable: "缺貨",
      pending: "執行中",
      succeeded: "成功",
      failed: "失敗",
      title: "平台同步狀態",
      login: "需要重新登入該平台。",
      target: "找不到對應的商品或選項。",
      pageTimeout: "平台頁面回應逾時。",
      expired: "同步工作已過期。",
      generic: "同步失敗。",
      collapse: "收起",
      expand: "展開",
      siri: "Siri"
    };
  }
  return {
    available: "販売再開",
    unavailable: "在庫切れ",
    pending: "実行中",
    succeeded: "成功",
    failed: "失敗",
    title: "プラットフォーム同期状況",
    login: "このプラットフォームへの再ログインが必要です。",
    target: "対応する商品・オプションが見つかりません。",
    pageTimeout: "プラットフォーム画面の応答がタイムアウトしました。",
    expired: "同期処理の有効期限が切れました。",
    generic: "同期に失敗しました。",
    collapse: "折りたたむ",
    expand: "開く",
    siri: "Siri"
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

function normalizeStatus(value: unknown): InventorySyncStatus {
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  return "pending";
}

function normalizeRun(value: unknown): StoreInventorySyncRun | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id = String(source.id ?? "");
  const itemLabel = String(source.itemLabel ?? "");
  if (!id || !itemLabel || !Array.isArray(source.platforms)) return null;
  const platforms = source.platforms.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const commandId = String(row.commandId ?? "");
    const platform = String(row.platform ?? "");
    return commandId && platform ? [{
      commandId,
      platform,
      status: normalizeStatus(row.status),
      error: String(row.error ?? "")
    }] : [];
  });
  if (!platforms.length) return null;
  return {
    id,
    itemLabel,
    isAvailable: source.isAvailable === true,
    source: source.source === "siri" ? "siri" : "store",
    createdAt: String(source.createdAt ?? new Date().toISOString()),
    platforms
  };
}

function mergeRun(current: StoreInventorySyncRun[], next: StoreInventorySyncRun) {
  const existing = current.find((run) => run.id === next.id);
  const mergedPlatforms = existing
    ? [...new Map([...existing.platforms, ...next.platforms].map((platform) => [platform.commandId, platform])).values()]
    : next.platforms;
  return [{ ...existing, ...next, platforms: mergedPlatforms }, ...current.filter((run) => run.id !== next.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
}

export function StoreInventorySyncStatus() {
  const { language } = useOsTranslation();
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [runs, setRuns] = useState<StoreInventorySyncRun[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const pendingCount = useMemo(() => runs.reduce((count, run) => (
    count + run.platforms.filter((platform) => platform.status === "pending").length
  ), 0), [runs]);
  const failedCount = useMemo(() => runs.reduce((count, run) => (
    count + run.platforms.filter((platform) => platform.status === "failed").length
  ), 0), [runs]);

  useEffect(() => {
    const storedStoreId = getStoredStoreSelection();
    if (storedStoreId) {
      setSelectedStoreId(storedStoreId);
      return;
    }
    fetch("/api/store/context", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        const storeId = String(body?.selectedStoreId ?? "");
        if (!storeId) return;
        setStoredStoreSelection(storeId);
        setSelectedStoreId(storeId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleStoreSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ storeId?: string }>).detail;
      setSelectedStoreId(String(detail?.storeId ?? ""));
    };
    window.addEventListener(storeSelectionEventName, handleStoreSelection);
    return () => window.removeEventListener(storeSelectionEventName, handleStoreSelection);
  }, []);

  useEffect(() => {
    const handleLocalRun = (event: Event) => {
      const detail = (event as CustomEvent<{ run?: unknown }>).detail;
      const run = normalizeRun(detail?.run);
      if (!run) return;
      setRuns((current) => mergeRun(current, run));
      setIsOpen(true);
    };
    window.addEventListener(storeInventorySyncEventName, handleLocalRun);
    return () => window.removeEventListener(storeInventorySyncEventName, handleLocalRun);
  }, []);

  useEffect(() => {
    if (!selectedStoreId) {
      setRuns([]);
      return;
    }
    let active = true;
    let pusher: SharedPusher | null = null;
    let channel: SharedPusherChannel | null = null;

    const refreshRuns = async () => {
      try {
        const response = await fetch(`/api/store/menu-sync-runs?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { runs?: unknown[] };
        if (!active) return;
        const nextRuns = (body.runs ?? []).map(normalizeRun).filter((run): run is StoreInventorySyncRun => Boolean(run));
        setRuns(nextRuns);
      } catch {
        // Realtime updates remain active if a recovery poll temporarily fails.
      }
    };

    const handleSyncStarted = (event: { run?: unknown }) => {
      const run = normalizeRun(event?.run);
      if (!active || !run) return;
      setRuns((current) => mergeRun(current, run));
      setIsOpen(true);
    };
    const handleCommandUpdated = (event: { command?: Record<string, unknown> }) => {
      const command = event?.command;
      const commandId = String(command?.id ?? "");
      if (!active || !commandId) return;
      setRuns((current) => current.map((run) => ({
        ...run,
        platforms: run.platforms.map((platform) => {
          if (platform.commandId !== commandId) return platform;
          return {
            ...platform,
            status: normalizeStatus(command?.status),
            error: String(command?.error ?? "")
          };
        })
      })));
      // Refresh once as well so events received before their start event, or
      // after a brief reconnect, are recovered from the command history.
      void refreshRuns();
    };

    setRuns([]);
    void refreshRuns();
    const pollingTimer = window.setInterval(() => void refreshRuns(), 10000);
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.bridgeChannel) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        channel = pusher.subscribe(config.bridgeChannel);
        channel.bind("bridge.inventory.sync.started", handleSyncStarted);
        channel.bind("bridge.command.updated", handleCommandUpdated);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      window.clearInterval(pollingTimer);
      channel?.unbind("bridge.inventory.sync.started", handleSyncStarted);
      channel?.unbind("bridge.command.updated", handleCommandUpdated);
      pusher?.disconnect();
    };
  }, [selectedStoreId]);

  if (!runs.length) return null;
  const copy = syncCopy(language);
  return (
    <aside
      className={`store-menu-sync-feedback${isOpen ? " is-open" : " is-collapsed"}`}
      aria-live="polite"
      data-i18n-ignore
    >
      <button
        className="store-menu-sync-dock-head"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={`store-menu-sync-dock-dot${pendingCount ? " is-pending" : failedCount ? " is-failed" : " is-complete"}`} />
        <span className="store-menu-sync-dock-title">
          <strong>{copy.title}</strong>
          <small>{syncSummaryText(language, pendingCount, failedCount, runs.length)}</small>
        </span>
        <span className="store-menu-sync-dock-toggle">
          {isOpen ? copy.collapse : copy.expand}
          {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>
      {isOpen ? (
        <div className="store-menu-sync-dock-body">
          {runs.map((run) => (
            <article className="store-menu-sync-run" key={run.id}>
              <div className="store-menu-sync-heading">
                <strong>{run.itemLabel}</strong>
                <span>{run.source === "siri" ? `${copy.siri} · ` : ""}{run.isAvailable ? copy.available : copy.unavailable}</span>
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
                    {platform.error ? <span className="store-menu-sync-error">{readableSyncError(platform.error, language)}</span> : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
