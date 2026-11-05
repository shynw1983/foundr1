"use client";

import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";
import { bindStoreRealtimeChannels } from "../../../lib/store-realtime-refresh";
import { useReadRequest, readJson } from "../../../components/useReadRequest";
import { ReadStatusNotice } from "../../../components/ReadStatusNotice";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, LoaderCircle, RefreshCw, TimerOff, Volume2, VolumeX, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { InventoryActionBadge } from "./InventoryActionBadge";
import styles from "./StoreInventorySyncStatus.module.css";
import {
  acknowledgeInventorySyncKeys, getScopedInventorySyncNotificationStore, inventorySyncSoundMuted, isInventorySyncNativeShell,
  playInventorySyncChime, setInventorySyncSoundMuted, unacknowledgedInventorySyncKeys, withInventorySyncAlertLock
} from "../../../lib/inventory-sync-alert-client";
import { getStoredStoreSelection, setStoredStoreSelection, storeSelectionEventName } from "./store-selection";

type SharedPusher = ReturnType<(typeof import("../../../lib/shared-pusher-client"))["acquireSharedPusher"]>;
type StoreMenuLanguage = "ja" | "zh-Hans" | "zh-Hant";
type InventorySyncStatus = "queued" | "processing" | "retrying" | "timed_out" | "succeeded" | "failed" | "superseded";

type InventorySyncPlatform = {
  commandId: string;
  platform: string;
  status: InventorySyncStatus;
  error: string;
  phase: string;
  attempt: number;
  maxAttempts: number;
  updatedAt: string;
  needsAttention: boolean;
  overdue: boolean;
  attentionKey: string;
  canRetry: boolean;
  targetLabels: string[];
  retryBlockedReason: string;
  desiredAvailable?: boolean | null;
};

export type StoreInventorySyncRun = {
  id: string;
  itemLabel: string;
  isAvailable: boolean;
  source: "siri" | "store";
  createdAt: string;
  storeId?: string;
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
      unavailable: "设为缺货",
      queued: "等待中",
      processing: "执行中",
      retrying: "重试中",
      timed_out: "超时",
      succeeded: "成功",
      failed: "失败",
      superseded: "已被新操作替代",
      title: "平台同步状态",
      login: "需要重新登录该平台。",
      target: "找不到对应的商品或选项。",
      multipleTargets: "找到多个同名商品或选项，Bridge 为避免改错已停止。",
      pageChanged: "平台页面结构已更新，Bridge 已安全停止，未继续盲目点击。",
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
      siri: "Siri",
      attention: "同步异常",
      targetAvailable: "目标：上架",
      targetUnavailable: "目标：下架",
      unconfirmed: "尚未确认",
      stopRisk: "下架尚未确认，可能继续接单",
      attentionDetail: "仅提醒当前营业日操作的同步异常；24 小时营业日显示最近 24 小时的操作。以前的操作可在同步履历中查看。已读不会解除异常。",
      acknowledge: "已读 / 停止声音",
      soundOn: "提示音已启用",
      soundOff: "启用提示音",
      soundBlocked: "声音未启用，请点击重试",
      retryAll: "重试失败项",
      rechecking: "重新确认中",
      refreshingFailed: "状态更新失败，正在重新获取",
      retryIdentity: "平台商品身份尚未核实。请重新读取最新平台菜单并核对对应商品。",
      retryMapping: "平台商品对应关系尚未核实。请重新读取菜单，并由管理者确认对应关系。",
      retryInProgress: "该平台正在读取或同步中。请等待完成，状态会自动更新。",
      retryStaleDemae: "出前馆商品数据版本已变化。请重新读取最新菜单并核对后再操作。",
      retryBlocked: "暂时无法重试。请重新读取状态并核对平台商品对应关系。"
    };
  }
  if (language === "zh-Hant") {
    return {
      available: "恢復銷售",
      unavailable: "設為缺貨",
      queued: "等待中",
      processing: "執行中",
      retrying: "重試中",
      timed_out: "逾時",
      succeeded: "成功",
      failed: "失敗",
      superseded: "已被新操作取代",
      title: "平台同步狀態",
      login: "需要重新登入該平台。",
      target: "找不到對應的商品或選項。",
      multipleTargets: "找到多個同名商品或選項，Bridge 為避免改錯已停止。",
      pageChanged: "平台頁面結構已更新，Bridge 已安全停止，未繼續盲目點擊。",
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
      siri: "Siri",
      attention: "同步異常",
      targetAvailable: "目標：上架",
      targetUnavailable: "目標：下架",
      unconfirmed: "尚未確認",
      stopRisk: "下架尚未確認，可能繼續接單",
      attentionDetail: "僅提醒目前營業日操作的同步異常；24 小時營業日顯示最近 24 小時的操作。先前的操作可在同步履歷中查看。已讀不會解除異常。",
      acknowledge: "已讀 / 停止聲音",
      soundOn: "提示音已啟用",
      soundOff: "啟用提示音",
      soundBlocked: "聲音未啟用，請點擊重試",
      retryAll: "重試失敗項",
      rechecking: "重新確認中",
      refreshingFailed: "狀態更新失敗，正在重新取得",
      retryIdentity: "平台商品身分尚未核實。請重新讀取最新平台菜單並核對對應商品。",
      retryMapping: "平台商品對應關係尚未核實。請重新讀取菜單，並由管理者確認對應關係。",
      retryInProgress: "該平台正在讀取或同步中。請等待完成，狀態會自動更新。",
      retryStaleDemae: "出前館商品資料版本已變更。請重新讀取最新菜單並核對後再操作。",
      retryBlocked: "暫時無法重試。請重新讀取狀態並核對平台商品對應關係。"
    };
  }
  return {
    available: "販売再開",
    unavailable: "在庫切れに設定",
    queued: "待機中",
    processing: "実行中",
    retrying: "再試行中",
    timed_out: "タイムアウト",
    succeeded: "成功",
    failed: "失敗",
    superseded: "新しい操作に置換済み",
    title: "プラットフォーム同期状況",
    login: "このプラットフォームへの再ログインが必要です。",
    target: "対応する商品・オプションが見つかりません。",
    multipleTargets: "同名の商品・オプションが複数あるため、誤操作防止のため停止しました。",
    pageChanged: "プラットフォーム画面の構造が更新されたため、Bridgeは安全に停止しました。",
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
    siri: "Siri",
    attention: "同期の要確認",
    targetAvailable: "目標：販売再開",
    targetUnavailable: "目標：販売停止",
    unconfirmed: "未確認",
    stopRisk: "販売停止が未確認です。受注が続く可能性があります",
    attentionDetail: "現在の営業日の操作に対する同期異常を表示します。24時間営業の日は直近24時間の操作が対象です。以前の操作は同期履歴で確認できます。既読にしても異常は解消されません。",
    acknowledge: "既読・音を止める",
    soundOn: "通知音 ON",
    soundOff: "通知音を有効にする",
    soundBlocked: "音を有効にできません。もう一度お試しください",
    retryAll: "失敗分を再実行",
    rechecking: "再確認中",
    refreshingFailed: "状態の更新に失敗しました。再取得中です",
    retryIdentity: "対象商品の確認が取れていません。最新のプラットフォームメニューを再取得し、対象を確認してください。",
    retryMapping: "商品の対応関係を確認できていません。メニューを再取得し、管理者に対応関係の確認を依頼してください。",
    retryInProgress: "同じプラットフォームで読み込み・同期が進行中です。完了までお待ちください。状態は自動で更新されます。",
    retryStaleDemae: "出前館の商品データの版が変わりました。最新メニューを再取得し、対象を確認してから操作してください。",
    retryBlocked: "現在は再実行できません。状態を再取得し、商品の対応関係を確認してください。"
  };
}

function syncSummaryText(language: StoreMenuLanguage, pendingCount: number, failedCount: number, runCount: number) {
  if (language === "zh-Hans") {
    if (failedCount) return `${failedCount} 个平台修改失败`;
    if (pendingCount) return `${pendingCount} 个平台执行中`;
    return `最近 ${runCount} 个商品`;
  }
  if (language === "zh-Hant") {
    if (failedCount) return `${failedCount} 個平台修改失敗`;
    if (pendingCount) return `${pendingCount} 個平台執行中`;
    return `最近 ${runCount} 個商品`;
  }
  if (failedCount) return `${failedCount}プラットフォーム失敗`;
  if (pendingCount) return `${pendingCount}プラットフォーム実行中`;
  return `直近${runCount}商品`;
}

function readableSyncError(error: string, language: StoreMenuLanguage) {
  const copy = syncCopy(language);
  if (/login required|ログイン|merchant_menu_request_failed:401:|MWA0007|demae_can_.*(?:login|credentials|keychain|manual_verification|account_locked|password_expired)/i.test(error)) return copy.login;
  if (/multiple target matches|複数の候補|多个候选/i.test(error)) return copy.multipleTargets;
  if (/target verification failed|対応する.*見つかりません/i.test(error)) return copy.target;
  if (/platform_ui_changed/i.test(error)) return copy.pageChanged;
  if (/timeout|timed out|waiting failed|waiting for selector|verification_timeout|condition timed out/i.test(error)) return copy.pageTimeout;
  if (/expired|有効期限/i.test(error)) return copy.expired;
  return error.trim() || copy.generic;
}

function normalizeStatus(value: unknown, error = ""): InventorySyncStatus {
  if (value === "cancelled" || value === "superseded") return "superseded";
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
    const status = normalizeStatus(row.status, error);
    const failed = status === "failed" || status === "timed_out";
    return commandId && platform ? [{
      commandId,
      platform,
      status,
      error,
      phase: String(row.phase ?? progress.phase ?? ""),
      attempt: Math.max(1, Number(row.attempt ?? progress.attempt ?? 1)),
      maxAttempts: Math.max(1, Number(row.maxAttempts ?? progress.maxAttempts ?? 3)),
      updatedAt: String(row.updatedAt ?? source.createdAt ?? new Date().toISOString()),
      needsAttention: row.needsAttention === true || (row.needsAttention === undefined && failed),
      overdue: row.overdue === true,
      attentionKey: String(row.attentionKey ?? (failed ? commandId : "")),
      canRetry: row.canRetry === true && failed,
      targetLabels: Array.isArray(row.targetLabels) ? row.targetLabels.filter((label): label is string => typeof label === "string") : [],
      retryBlockedReason: String(row.retryBlockedReason ?? ""),
      desiredAvailable: typeof row.desiredAvailable === "boolean" ? row.desiredAvailable : row.desiredAvailable === null ? null : source.isAvailable === true
    }] : [];
  });
  if (!platforms.length) return null;
  return {
    id,
    storeId: typeof source.storeId === "string" ? source.storeId : undefined,
    itemLabel,
    isAvailable: source.isAvailable === true,
    source: source.source === "siri" ? "siri" : "store",
    createdAt: String(source.createdAt ?? new Date().toISOString()),
    platforms
  };
}

function platformDetail(platform: InventorySyncPlatform, language: StoreMenuLanguage) {
  const copy = syncCopy(language);
  if (platform.overdue && ["queued", "processing", "retrying"].includes(platform.status)) {
    return `${copy.unconfirmed} · ${platform.status === "queued" ? copy.queuedDetail : platform.status === "retrying" ? copy.retryingDetail : copy.applying}`;
  }
  if (platform.status === "queued") return platform.needsAttention ? copy.rechecking : copy.queuedDetail;
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

function retryBlockedDetail(platform: InventorySyncPlatform, language: StoreMenuLanguage) {
  if (platform.canRetry || !platform.needsAttention || !["failed", "timed_out"].includes(platform.status)) return "";
  const copy = syncCopy(language);
  if (platform.retryBlockedReason === "identity_unverified") return copy.retryIdentity;
  if (platform.retryBlockedReason === "mapping_unverified") return copy.retryMapping;
  if (platform.retryBlockedReason === "operation_in_progress") return copy.retryInProgress;
  if (platform.retryBlockedReason === "stale_demae_release") return copy.retryStaleDemae;
  return copy.retryBlocked;
}

function attentionSummary(language: StoreMenuLanguage, items: number, platforms: number) {
  if (language === "zh-Hans") return `${items} 个商品 · ${platforms} 项平台同步异常`;
  if (language === "zh-Hant") return `${items} 個商品 · ${platforms} 項平台同步異常`;
  return `${items}商品・${platforms}件の同期を確認してください`;
}

export function StoreInventorySyncStatus() {
  const { language } = useOsTranslation();
  const pathname = usePathname();
  const publicDisplay = pathname === "/store/display/pickup" || pathname === "/store/display/courier" || pathname === "/store/pos/customer-display";
  const compactDisplay = pathname === "/store/display/kitchen";
  const bannerRef = useRef<HTMLElement | null>(null);
  const copy = syncCopy(language);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const selectedStoreRef = useRef("");
  const [runs, setRuns] = useState<StoreInventorySyncRun[]>([]);
  const readState = useReadRequest(15000, 0, true);
  const refreshRunsRef = useRef<(force?: boolean) => void>(() => {});
  const [isOpen, setIsOpen] = useState(false);
  const [retryingCommandIds, setRetryingCommandIds] = useState<Set<string>>(() => new Set());
  const retryingRef = useRef(new Set<string>());
  const [batchRetrying, setBatchRetrying] = useState(false);
  const batchRetryActiveRef = useRef(false);
  const batchRetryGenerationRef = useRef(0);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const seenAttentionRef = useRef(new Set<string>());
  const [acknowledged, setAcknowledged] = useState(false);
  const [foregroundRevision, setForegroundRevision] = useState(0);

  const attentionRuns = useMemo(() => runs.filter(run => run.platforms.some(platform => platform.needsAttention)), [runs]);
  const attentionPlatforms = useMemo(() => attentionRuns.flatMap(run => run.platforms.filter(platform => platform.needsAttention)), [attentionRuns]);
  const attentionKeys = useMemo(() => [...new Set(attentionPlatforms.map(platform => platform.attentionKey).filter(Boolean))], [attentionPlatforms]);
  const attentionSignature = attentionKeys.join("\n");
  const pendingCount = runs.reduce((count, run) => count + run.platforms.filter(platform => ["queued", "processing", "retrying"].includes(platform.status)).length, 0);
  const failedCount = runs.reduce((count, run) => count + run.platforms.filter(platform => ["failed", "timed_out"].includes(platform.status)).length, 0);
  const stopRisk = attentionRuns.some(run => run.platforms.some(platform => platform.needsAttention && platform.desiredAvailable === false));
  const retryablePlatforms = attentionPlatforms.filter(platform => platform.canRetry && !retryingCommandIds.has(platform.commandId));
  const orderedRuns = useMemo(() => [...runs].sort((a, b) => {
    const priority = (run: StoreInventorySyncRun) => run.platforms.some(platform => platform.needsAttention && platform.desiredAvailable === false) ? 2 : run.platforms.some(platform => platform.needsAttention) ? 1 : 0;
    return priority(b) - priority(a) || b.createdAt.localeCompare(a.createdAt);
  }), [runs]);

  useEffect(() => {
    let active = true;
    let manualSelectionVersion = 0;
    const selectStore = (storeId: string) => {
      if (selectedStoreRef.current !== storeId) {
        setRuns([]);
        batchRetryGenerationRef.current += 1;
        batchRetryActiveRef.current = false;
        setBatchRetrying(false);
      }
      selectedStoreRef.current = storeId;
      setSelectedStoreId(storeId);
    };
    const handleStoreSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ storeId?: string }>).detail;
      manualSelectionVersion += 1;
      selectStore(String(detail?.storeId ?? ""));
    };
    window.addEventListener(storeSelectionEventName, handleStoreSelection);
    const storedStoreId = getStoredStoreSelection();
    if (storedStoreId) selectStore(storedStoreId);
    const query = new URLSearchParams(window.location.search);
    const notificationStoreId = query.get("syncAttention") === "1" ? query.get("storeId") || "" : "";
    if (notificationStoreId) void getScopedInventorySyncNotificationStore().then(storeId => {
      if (!active || manualSelectionVersion !== 0 || !storeId) return;
      if (storeId !== selectedStoreRef.current) setStoredStoreSelection(storeId);
    });
    else if (!storedStoreId) void fetch("/api/store/context", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (!active || manualSelectionVersion !== 0) return;
        const storeId = String(body?.selectedStoreId ?? "");
        if (storeId && !selectedStoreRef.current) setStoredStoreSelection(storeId);
      }).catch(() => undefined);
    return () => {
      active = false;
      batchRetryGenerationRef.current += 1;
      batchRetryActiveRef.current = false;
      window.removeEventListener(storeSelectionEventName, handleStoreSelection);
    };
  }, []);

  useEffect(() => {
    setSoundEnabled(isInventorySyncNativeShell() && !inventorySyncSoundMuted());
    return () => { void audioContextRef.current?.close(); audioContextRef.current = null; };
  }, []);

  useEffect(() => {
    if (!selectedStoreId) return;
    if (attentionKeys.some(key => !seenAttentionRef.current.has(key))) {
      // Keep the employee's work visible. Details open only after a tap or a
      // deliberate notification URL; a new incident resets sound acknowledgement.
      setAcknowledged(false);
    }
    for (const key of attentionKeys) seenAttentionRef.current.add(key);
    if (publicDisplay || !soundEnabled || inventorySyncSoundMuted() || document.visibilityState !== "visible") return;
    const unseen = unacknowledgedInventorySyncKeys(selectedStoreId, attentionKeys);
    if (!unseen.length) return;
    let active = true;
    const storeId = selectedStoreId;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) { setSoundBlocked(true); return; }
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
      const context = audioContextRef.current;
      void context.resume().then(async () => {
        await withInventorySyncAlertLock(() => {
          if (!active || selectedStoreRef.current !== storeId || inventorySyncSoundMuted() || document.visibilityState !== "visible") return;
          // Another tab or acknowledgement may have handled the same alert.
          const remaining = unacknowledgedInventorySyncKeys(storeId, unseen);
          if (context.state !== "running") { setSoundBlocked(true); return; }
          if (remaining.length) {
            playInventorySyncChime(context);
            acknowledgeInventorySyncKeys(storeId, remaining);
          }
          setSoundBlocked(false);
        });
      }).catch(() => { if (active) setSoundBlocked(true); });
    } catch { setSoundBlocked(true); }
    return () => { active = false; };
  }, [selectedStoreId, attentionSignature, soundEnabled, foregroundRevision, publicDisplay, compactDisplay]); // Keys identify incidents, not polling objects.

  useEffect(() => {
    setRuns([]);
    setRetryErrors({});
    setRetryingCommandIds(new Set());
    retryingRef.current.clear();
    seenAttentionRef.current.clear();
    const query = new URLSearchParams(window.location.search);
    setIsOpen(query.get("syncAttention") === "1" && (!query.get("storeId") || query.get("storeId") === selectedStoreId));
    setAcknowledged(false);
    if (!selectedStoreId || publicDisplay) return;
    let active = true;
    let pusher: SharedPusher | null = null;
    let unbindRealtime: (() => void) | undefined;
    let pending = false;
    const denyAccess = (status?: number) => {
      if (!active) return;
      active = false;
      coordinator.stop();
      if (status) readState.reportFailure(status);
      setRuns([]);
      unbindRealtime?.();
      pusher?.disconnect();
    };
    const coordinator = createStoreRefreshCoordinator(async signal => {
      await readState.run(selectedStoreId,
        requestSignal => readJson<{ runs?: unknown[] }>(`/api/store/menu-sync-runs?storeId=${encodeURIComponent(selectedStoreId)}`, requestSignal),
        body => {
          if (!active || signal.aborted || selectedStoreRef.current !== selectedStoreId) return;
          const next = (body.runs ?? []).map(normalizeRun).filter((run): run is StoreInventorySyncRun => Boolean(run));
          // Fast confirmation is bounded to fresh, unfinished commands. Stalled
          // commands remain visible with the existing overdue/attention status.
          pending = next.some(run => Date.now() - Date.parse(run.createdAt) < 15 * 60_000 && run.platforms.some(platform =>
            !platform.overdue && ["queued", "processing", "retrying"].includes(platform.status)));
          setRuns(next);
        }, signal);
    }, {
      healthyIntervalMs: () => pending ? 10_000 : 300_000,
      fallbackIntervalMs: () => pending ? 10_000 : 60_000,
      onUnauthorized: () => denyAccess()
    });
    const refreshRuns = (force = false) => { void coordinator.refresh({ force }); };
    refreshRunsRef.current = refreshRuns;
    const handleLocalRun = (event: Event) => {
      const storeId = (event as CustomEvent<{ run?: { storeId?: string } }>).detail?.run?.storeId;
      if (!storeId || storeId === selectedStoreId) refreshRuns();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") setForegroundRevision(current => current + 1);
    };
    window.addEventListener(storeInventorySyncEventName, handleLocalRun);
    document.addEventListener("visibilitychange", handleVisible);
    coordinator.start({ immediate: true });
    const configController = new AbortController();
    const configTimeout = window.setTimeout(() => configController.abort(), 15_000);
    void fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store", signal: configController.signal })
      .then(response => {
        if (response.status === 401 || response.status === 403) denyAccess(response.status);
        return response.ok ? response.json() : null;
      })
      .then(async config => {
        if (!active || !config?.key || !config?.cluster || !config?.bridgeChannel) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        unbindRealtime = bindStoreRealtimeChannels(pusher, {
          channels: [config.bridgeChannel],
          events: ["bridge.inventory.sync.started", "bridge.command.updated"],
          onEvent: () => refreshRuns(),
          onUnauthorized: denyAccess,
          onHealthChange: healthy => {
            coordinator.setRealtimeHealthy(healthy);
            if (healthy) void coordinator.refresh({ force: true });
          }
        });
      }).catch(() => undefined).finally(() => window.clearTimeout(configTimeout));
    return () => {
      active = false;
      coordinator.stop();
      configController.abort();
      window.clearTimeout(configTimeout);
      readState.cancel();
      refreshRunsRef.current = () => {};
      window.removeEventListener(storeInventorySyncEventName, handleLocalRun);
      document.removeEventListener("visibilitychange", handleVisible);
      unbindRealtime?.();
      pusher?.disconnect();
    };
  }, [selectedStoreId, readState.run, readState.cancel, readState.reportFailure, publicDisplay]);

  const hasAttention = attentionPlatforms.length > 0;
  useLayoutEffect(() => {
    const banner = bannerRef.current;
    if (!banner || !hasAttention || publicDisplay) return;
    const root = document.documentElement;
    const measure = () => {
      const style = window.getComputedStyle(banner);
      const space = banner.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      root.style.setProperty("--store-inventory-sync-attention-space", `${Math.ceil(space)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(banner);
    return () => { observer.disconnect(); root.style.removeProperty("--store-inventory-sync-attention-space"); };
  }, [hasAttention, publicDisplay, compactDisplay]);

  const retryPlatform = async (platform: InventorySyncPlatform, batchGeneration?: number) => {
    const storeId = selectedStoreId;
    if (batchRetryActiveRef.current && batchGeneration !== batchRetryGenerationRef.current) return;
    if (!storeId || selectedStoreRef.current !== storeId || !platform.canRetry || !["failed", "timed_out"].includes(platform.status) || retryingRef.current.has(platform.commandId)) return;
    retryingRef.current.add(platform.commandId);
    setRetryingCommandIds(new Set(retryingRef.current));
    setRetryErrors(current => { const next = { ...current }; delete next[platform.commandId]; return next; });
    try {
      const response = await fetch("/api/store/menu-sync-runs/retry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, commandId: platform.commandId })
      });
      if (!response.ok) throw new Error(response.status === 409 ? "unavailable" : "failed");
      if (selectedStoreRef.current !== storeId) return;
      // Keep the warning while queued; only the server's verified result clears it.
      setRuns(current => current.map(run => ({ ...run, platforms: run.platforms.map(entry => entry.commandId === platform.commandId
        ? { ...entry, status: "queued", phase: "queued", canRetry: false, overdue: false }
        : entry) })));
    } catch (error) {
      if (selectedStoreRef.current !== storeId) return;
      setRetryErrors(current => ({ ...current, [platform.commandId]: error instanceof Error && error.message === "unavailable" ? copy.retryUnavailable : copy.retryFailed }));
    } finally {
      if (selectedStoreRef.current === storeId) {
        retryingRef.current.delete(platform.commandId);
        setRetryingCommandIds(new Set(retryingRef.current));
        refreshRunsRef.current(true);
      }
    }
  };

  const retryFailedPlatforms = async () => {
    const storeId = selectedStoreId;
    if (!storeId || selectedStoreRef.current !== storeId || batchRetryActiveRef.current || retryingRef.current.size) return;
    const generation = ++batchRetryGenerationRef.current;
    batchRetryActiveRef.current = true;
    setBatchRetrying(true);
    try {
      // The API serializes inventory operations per store. Await each retry so
      // independent failed platforms do not contend for the same store lock.
      for (const platform of retryablePlatforms) {
        if (generation !== batchRetryGenerationRef.current || selectedStoreRef.current !== storeId) break;
        await retryPlatform(platform, generation);
      }
    } finally {
      if (generation === batchRetryGenerationRef.current) {
        batchRetryActiveRef.current = false;
        setBatchRetrying(false);
      }
    }
  };

  const toggleSound = async () => {
    if (soundEnabled && !soundBlocked) {
      setInventorySyncSoundMuted(true);
      setSoundEnabled(false);
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("audio_unavailable");
      if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
      await audioContextRef.current.resume();
      if (audioContextRef.current.state !== "running") throw new Error("audio_blocked");
      setInventorySyncSoundMuted(false);
      setSoundBlocked(false);
      setSoundEnabled(true);
    } catch { setSoundBlocked(true); }
  };

  if (publicDisplay || (!runs.length && !readState.failed)) return null;
  return <>
    {attentionPlatforms.length ? <section
      ref={bannerRef} className={`${styles.banner} ${stopRisk ? styles.stopRisk : ""} ${compactDisplay ? styles.compactBanner : ""}`}
      data-i18n-ignore data-inventory-sync-attention data-store-id={selectedStoreId}
    >
      <button type="button" className={styles.bannerOpen} aria-expanded={isOpen} aria-controls="store-inventory-sync-details" onClick={() => setIsOpen(current => !current)}>
        <AlertTriangle size={19} aria-hidden="true" />
        <span role="status" aria-live="polite"><strong>{attentionSummary(language, attentionRuns.length, attentionPlatforms.length)}</strong>
          {stopRisk ? <small>{copy.stopRisk}</small> : null}
        </span>
        {isOpen ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>
      <div className={styles.bannerActions}>
        <button type="button" onClick={() => { acknowledgeInventorySyncKeys(selectedStoreId, attentionKeys); setAcknowledged(true); }} disabled={acknowledged}>{copy.acknowledge}</button>
        <button type="button" onClick={() => void toggleSound()} aria-pressed={soundEnabled && !soundBlocked} title={soundBlocked ? copy.soundBlocked : undefined}>
          {soundEnabled && !soundBlocked ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundEnabled && !soundBlocked ? copy.soundOn : copy.soundOff}
        </button>
      </div>
      {readState.failed || soundBlocked ? <small className={styles.bannerNotice}>{readState.failed ? copy.refreshingFailed : copy.soundBlocked}</small> : null}
    </section> : null}
    <aside className={`store-menu-sync-feedback ${styles.dock}${compactDisplay && !isOpen ? ` ${styles.compactDock}` : ""}${isOpen ? " is-open" : " is-collapsed"}`} data-i18n-ignore>
      <button className="store-menu-sync-dock-head" type="button" aria-expanded={isOpen} aria-controls="store-inventory-sync-details" onClick={() => setIsOpen(current => !current)}>
        <span className={`store-menu-sync-dock-dot${attentionPlatforms.length || failedCount ? " is-failed" : pendingCount ? " is-pending" : " is-complete"}`} />
        <span className="store-menu-sync-dock-title"><strong>{copy.title}</strong><small>{attentionPlatforms.length ? attentionSummary(language, attentionRuns.length, attentionPlatforms.length) : readState.failed ? copy.refreshingFailed : syncSummaryText(language, pendingCount, failedCount, runs.length)}</small></span>
        <span className="store-menu-sync-dock-toggle">{isOpen ? copy.collapse : copy.expand}{isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
      </button>
      <ReadStatusNotice state={readState} onRetry={() => refreshRunsRef.current(true)} language={language} />
      {isOpen ? <div className="store-menu-sync-dock-body" id="store-inventory-sync-details">
        {attentionPlatforms.length ? <div className={styles.detailToolbar}><p>{copy.attentionDetail}</p>{retryablePlatforms.length ? <button type="button" className="store-menu-sync-retry" disabled={batchRetrying || retryingCommandIds.size > 0} onClick={() => void retryFailedPlatforms()}><RefreshCw size={13} />{copy.retryAll} ({retryablePlatforms.length})</button> : null}</div> : null}
        {orderedRuns.map(run => <article className="store-menu-sync-run" key={run.id} data-sync-run-id={run.id}>
          <div className={`store-menu-sync-heading ${styles.runHeading}`}><InventoryActionBadge available={run.isAvailable} label={run.isAvailable ? copy.available : copy.unavailable} /><strong>{run.itemLabel}</strong><span>{run.source === "siri" ? `${copy.siri} · ` : ""}{run.isAvailable ? copy.available : copy.unavailable}</span></div>
          <div className={`store-menu-sync-platforms ${styles.platforms}`}>
            {run.platforms.map(platform => {
              const canRetry = platform.canRetry && ["failed", "timed_out"].includes(platform.status);
              return <div className={`store-menu-sync-platform is-${platform.status}${platform.needsAttention ? ` ${styles.needsAttention}` : ""}`} key={platform.commandId} data-sync-command-id={platform.commandId}>
                <span className={`store-menu-sync-state ${styles.platformState}`}>
                  {platform.overdue ? <AlertTriangle size={15} /> : platform.status === "queued" ? <Clock3 size={15} /> : platform.status === "processing" ? <LoaderCircle size={15} /> : platform.status === "retrying" ? <RefreshCw size={15} /> : platform.status === "timed_out" ? <TimerOff size={15} /> : platform.status === "succeeded" ? <CheckCircle2 size={15} /> : platform.status === "failed" ? <XCircle size={15} /> : null}
                  <strong>{platformName(platform.platform, language)}</strong><small>{platform.overdue ? copy.unconfirmed : copy[platform.status]}</small>
                </span>
                {platform.needsAttention && typeof platform.desiredAvailable === "boolean" ? <span className={styles.targetLabels}>{platform.desiredAvailable ? copy.targetAvailable : copy.targetUnavailable}</span> : null}
                {platform.targetLabels.length ? <span className={styles.targetLabels}>{platform.targetLabels.join(" · ")}</span> : null}
                {platformDetail(platform, language) ? <span className="store-menu-sync-error">{platformDetail(platform, language)}</span> : null}
                {retryBlockedDetail(platform, language) ? <span className={styles.blockedReason}>{retryBlockedDetail(platform, language)}</span> : null}
                {canRetry ? <button className="store-menu-sync-retry" type="button" disabled={batchRetrying || retryingCommandIds.has(platform.commandId)} aria-label={`${run.itemLabel} ${platformName(platform.platform, language)} ${copy.retry}`} onClick={() => void retryPlatform(platform)}><RefreshCw size={13} />{copy.retry}</button> : null}
                {retryErrors[platform.commandId] ? <span className="store-menu-sync-retry-error" role="alert">{retryErrors[platform.commandId]}</span> : null}
              </div>;
            })}
          </div>
        </article>)}
      </div> : null}
    </aside>
  </>;
}
