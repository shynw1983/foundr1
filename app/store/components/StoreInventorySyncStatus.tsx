"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Clock3, LoaderCircle, RefreshCw, TimerOff, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { getStoredStoreSelection, setStoredStoreSelection, storeSelectionEventName } from "./store-selection";

type SharedPusher = ReturnType<(typeof import("../../../lib/shared-pusher-client"))["acquireSharedPusher"]>;
type SharedPusherChannel = ReturnType<SharedPusher["subscribe"]>;
type StoreMenuLanguage = "ja" | "zh-Hans" | "zh-Hant";
type InventorySyncStatus = "queued" | "processing" | "retrying" | "timed_out" | "succeeded" | "failed";

type InventorySyncPlatform = {
  commandId: string;
  platform: string;
  status: InventorySyncStatus;
  error: string;
  phase: string;
  attempt: number;
  maxAttempts: number;
  updatedAt: string;
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
      queued: "等待中",
      processing: "执行中",
      retrying: "重试中",
      timed_out: "超时",
      succeeded: "成功",
      failed: "失败",
      title: "平台同步状态",
      login: "需要重新登录该平台。",
      target: "找不到对应的商品或选项。",
      multipleTargets: "找到多个同名商品或选项，Bridge 为避免改错已停止。",
      pageTimeout: "平台页面响应超时。",
      expired: "同步任务已过期。",
      generic: "同步失败。",
      queuedDetail: "等待 Bridge 执行",
      locating: "正在查找商品",
      applying: "正在修改并确认结果",
      retryingDetail: "自动重试",
      retry: "重试",
      retryUnavailable: "无法重试：该商品已有更新的同步任务。",
      retryFailed: "重试请求失败，请再试一次。",
      collapse: "收起",
      expand: "展开",
      siri: "Siri"
    };
  }
  if (language === "zh-Hant") {
    return {
      available: "恢復銷售",
      unavailable: "缺貨",
      queued: "等待中",
      processing: "執行中",
      retrying: "重試中",
      timed_out: "逾時",
      succeeded: "成功",
      failed: "失敗",
      title: "平台同步狀態",
      login: "需要重新登入該平台。",
      target: "找不到對應的商品或選項。",
      multipleTargets: "找到多個同名商品或選項，Bridge 為避免改錯已停止。",
      pageTimeout: "平台頁面回應逾時。",
      expired: "同步工作已過期。",
      generic: "同步失敗。",
      queuedDetail: "等待 Bridge 執行",
      locating: "正在尋找商品",
      applying: "正在修改並確認結果",
      retryingDetail: "自動重試",
      retry: "重試",
      retryUnavailable: "無法重試：該商品已有更新的同步工作。",
      retryFailed: "重試要求失敗，請再試一次。",
      collapse: "收起",
      expand: "展開",
      siri: "Siri"
    };
  }
  return {
    available: "販売再開",
    unavailable: "在庫切れ",
    queued: "待機中",
    processing: "実行中",
    retrying: "再試行中",
    timed_out: "タイムアウト",
    succeeded: "成功",
    failed: "失敗",
    title: "プラットフォーム同期状況",
    login: "このプラットフォームへの再ログインが必要です。",
    target: "対応する商品・オプションが見つかりません。",
    multipleTargets: "同名の商品・オプションが複数あるため、誤操作防止のため停止しました。",
    pageTimeout: "プラットフォーム画面の応答がタイムアウトしました。",
    expired: "同期処理の有効期限が切れました。",
    generic: "同期に失敗しました。",
    queuedDetail: "Bridgeの実行待ち",
    locating: "商品を確認中",
    applying: "変更・結果確認中",
    retryingDetail: "自動再試行",
    retry: "再実行",
    retryUnavailable: "再実行できません。より新しい同期処理があります。",
    retryFailed: "再実行を開始できませんでした。もう一度お試しください。",
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
  if (/multiple target matches|複数の候補|多个候选/i.test(error)) return copy.multipleTargets;
  if (/target verification failed|対応する.*見つかりません/i.test(error)) return copy.target;
  if (/timeout|timed out|waiting failed|waiting for selector|verification_timeout|condition timed out/i.test(error)) return copy.pageTimeout;
  if (/expired|有効期限/i.test(error)) return copy.expired;
  return error.trim() || copy.generic;
}

function normalizeStatus(value: unknown, error = ""): InventorySyncStatus {
  if (value === "succeeded") return "succeeded";
  if (value === "timed_out" || (value === "failed" && /timeout|timed out|waiting failed|waiting for selector|超时/i.test(error))) return "timed_out";
  if (value === "failed") return "failed";
  if (value === "retrying") return "retrying";
  if (value === "processing") return "processing";
  return "queued";
}

function progressFrom(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, unknown>;
  const result = value as Record<string, unknown>;
  return result.progress && typeof result.progress === "object"
    ? result.progress as Record<string, unknown>
    : result;
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
    const error = String(row.error ?? "");
    const progress = progressFrom(row.result);
    return commandId && platform ? [{
      commandId,
      platform,
      status: normalizeStatus(row.status, error),
      error,
      phase: String(row.phase ?? progress.phase ?? ""),
      attempt: Math.max(1, Number(row.attempt ?? progress.attempt ?? 1)),
      maxAttempts: Math.max(1, Number(row.maxAttempts ?? progress.maxAttempts ?? 3)),
      updatedAt: String(row.updatedAt ?? source.createdAt ?? new Date().toISOString())
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

function platformDetail(platform: InventorySyncPlatform, language: StoreMenuLanguage) {
  const copy = syncCopy(language);
  if (platform.status === "queued") return copy.queuedDetail;
  if (platform.status === "processing") {
    return platform.phase === "locating" ? copy.locating : copy.applying;
  }
  if (platform.status === "retrying") {
    const reason = platform.error ? readableSyncError(platform.error, language) : "";
    return `${copy.retryingDetail} ${platform.attempt}/${platform.maxAttempts}${reason ? ` · ${reason}` : ""}`;
  }
  if (platform.status === "timed_out" || platform.status === "failed") {
    return readableSyncError(platform.error, language);
  }
  return "";
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
  const [retryingCommandIds, setRetryingCommandIds] = useState<Set<string>>(() => new Set());
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});

  const pendingCount = useMemo(() => runs.reduce((count, run) => (
    count + run.platforms.filter((platform) => ["queued", "processing", "retrying"].includes(platform.status)).length
  ), 0), [runs]);
  const failedCount = useMemo(() => runs.reduce((count, run) => (
    count + run.platforms.filter((platform) => ["failed", "timed_out"].includes(platform.status)).length
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
          const error = String(command?.error ?? "");
          const progress = progressFrom(command?.result);
          return {
            ...platform,
            status: normalizeStatus(command?.status, error),
            error,
            phase: String(progress.phase ?? platform.phase),
            attempt: Math.max(1, Number(progress.attempt ?? platform.attempt)),
            maxAttempts: Math.max(1, Number(progress.maxAttempts ?? platform.maxAttempts)),
            updatedAt: new Date().toISOString()
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

  const retryPlatform = async (platform: InventorySyncPlatform) => {
    if (!selectedStoreId || retryingCommandIds.has(platform.commandId)) return;
    const previousPlatform = { ...platform };
    setRetryingCommandIds((current) => new Set(current).add(platform.commandId));
    setRetryErrors((current) => {
      const next = { ...current };
      delete next[platform.commandId];
      return next;
    });
    setRuns((current) => current.map((run) => ({
      ...run,
      platforms: run.platforms.map((entry) => entry.commandId === platform.commandId ? {
        ...entry,
        status: "queued",
        error: "",
        phase: "queued",
        attempt: 1,
        maxAttempts: 3,
        updatedAt: new Date().toISOString()
      } : entry)
    })));

    try {
      const response = await fetch("/api/store/menu-sync-runs/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, commandId: platform.commandId })
      });
      if (!response.ok) {
        throw new Error(response.status === 409 ? "unavailable" : "failed");
      }
    } catch (error) {
      setRuns((current) => current.map((run) => ({
        ...run,
        platforms: run.platforms.map((entry) => entry.commandId === platform.commandId
          ? previousPlatform
          : entry)
      })));
      setRetryErrors((current) => ({
        ...current,
        [platform.commandId]: error instanceof Error && error.message === "unavailable"
          ? syncCopy(language).retryUnavailable
          : syncCopy(language).retryFailed
      }));
    } finally {
      setRetryingCommandIds((current) => {
        const next = new Set(current);
        next.delete(platform.commandId);
        return next;
      });
    }
  };

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
                {run.platforms.map((platform) => {
                  const canRetry = platform.status === "failed" || platform.status === "timed_out";
                  return (
                    <div className={`store-menu-sync-platform is-${platform.status}`} key={platform.commandId}>
                      <span className="store-menu-sync-state">
                        {platform.status === "queued" ? <Clock3 size={15} /> : null}
                        {platform.status === "processing" ? <LoaderCircle size={15} /> : null}
                        {platform.status === "retrying" ? <RefreshCw size={15} /> : null}
                        {platform.status === "timed_out" ? <TimerOff size={15} /> : null}
                        {platform.status === "succeeded" ? <CheckCircle2 size={15} /> : null}
                        {platform.status === "failed" ? <XCircle size={15} /> : null}
                        <strong>{platformName(platform.platform, language)}</strong>
                        <small>{copy[platform.status]}</small>
                      </span>
                      {platformDetail(platform, language) ? (
                        <span className="store-menu-sync-error">{platformDetail(platform, language)}</span>
                      ) : null}
                      {canRetry ? (
                        <button
                          className="store-menu-sync-retry"
                          type="button"
                          disabled={retryingCommandIds.has(platform.commandId)}
                          aria-label={`${platformName(platform.platform, language)} ${copy.retry}`}
                          onClick={() => void retryPlatform(platform)}
                        >
                          <RefreshCw size={13} />
                          {copy.retry}
                        </button>
                      ) : null}
                      {retryErrors[platform.commandId] ? (
                        <span className="store-menu-sync-retry-error" role="alert">{retryErrors[platform.commandId]}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
