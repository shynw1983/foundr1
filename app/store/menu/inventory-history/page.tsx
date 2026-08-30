"use client";

import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock3, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useOsTranslation } from "../../../os/components/OsTranslationProvider";
import { StoreNavTabs } from "../../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";

type Language = "ja" | "zh-Hans" | "zh-Hant";
type PlatformReport = {
  platform: string;
  total: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  processing: number;
  queued: number;
};
type InventoryReport = {
  id: string;
  runType: "availability_change" | "full_sync";
  action: string;
  itemLabel: string;
  source: string;
  actorName: string;
  createdAt: string;
  status: "succeeded" | "processing" | "failed";
  details: Record<string, unknown>;
  platforms: PlatformReport[];
  failedCommands: Array<{
    id: string;
    platform: string;
    status: "failed" | "timed_out";
    error: string;
    attempts: number;
    failedItems: string[];
    updatedAt: string;
  }>;
};

function copy(language: Language) {
  if (language === "zh-Hans") return {
    title: "库存同步履历",
    description: "确认谁在什么时候设置了缺货或恢复，以及每天全平台同步的执行结果。",
    back: "返回销售状态",
    refresh: "刷新",
    empty: "该期间内没有库存同步记录。",
    loading: "正在读取履历…",
    operator: "操作人",
    scheduled: "每日自动同步",
    siri: "Siri 语音",
    system: "系统",
    available: "恢复销售",
    unavailable: "缺货",
    lowStock: "即将缺货",
    override: "单独平台设置",
    fullSync: "全平台、全商品同步",
    succeeded: "完成",
    processing: "执行中",
    failed: "需要确认",
    successCount: "成功",
    failureCount: "失败",
    pendingCount: "执行中",
    showDetails: "查看失败详情",
    hideDetails: "收起失败详情",
    reason: "失败原因",
    affectedItems: "未能匹配的商品",
    retryPlatform: "重试该平台失败项",
    retrying: "正在提交重试…",
    retryStarted: "已提交重试，请稍后刷新确认结果。",
    retryPartial: "部分任务无法重试，可能已有更新的库存操作。",
    missingTarget: "平台菜单中找不到这些商品；同批内其他商品已成功同步。",
    duplicateTarget: "平台菜单中存在多个同名商品，为防止改错，系统已安全停止。",
    genericError: "平台同步失败，请查看下方原始信息。",
    originalError: "原始错误信息"
  };
  if (language === "zh-Hant") return {
    title: "庫存同步履歷",
    description: "確認誰在何時設定缺貨或恢復，以及每天全平台同步的執行結果。",
    back: "返回銷售狀態",
    refresh: "重新整理",
    empty: "該期間內沒有庫存同步記錄。",
    loading: "正在讀取履歷…",
    operator: "操作人",
    scheduled: "每日自動同步",
    siri: "Siri 語音",
    system: "系統",
    available: "恢復銷售",
    unavailable: "缺貨",
    lowStock: "即將缺貨",
    override: "單獨平台設定",
    fullSync: "全平台、全商品同步",
    succeeded: "完成",
    processing: "執行中",
    failed: "需要確認",
    successCount: "成功",
    failureCount: "失敗",
    pendingCount: "執行中",
    showDetails: "查看失敗詳情",
    hideDetails: "收起失敗詳情",
    reason: "失敗原因",
    affectedItems: "未能配對的商品",
    retryPlatform: "重試該平台失敗項",
    retrying: "正在提交重試…",
    retryStarted: "已提交重試，請稍後重新整理確認結果。",
    retryPartial: "部分工作無法重試，可能已有較新的庫存操作。",
    missingTarget: "平台選單中找不到這些商品；同批內其他商品已成功同步。",
    duplicateTarget: "平台選單中存在多個同名商品，為避免改錯，系統已安全停止。",
    genericError: "平台同步失敗，請查看下方原始資訊。",
    originalError: "原始錯誤資訊"
  };
  return {
    title: "在庫同期履歴",
    description: "誰がいつ売切・販売再開を設定したか、毎日の全プラットフォーム同期結果を確認します。",
    back: "販売状態へ戻る",
    refresh: "更新",
    empty: "この期間の在庫同期履歴はありません。",
    loading: "履歴を読み込み中…",
    operator: "操作担当",
    scheduled: "毎日自動同期",
    siri: "Siri音声",
    system: "システム",
    available: "販売再開",
    unavailable: "在庫切れ",
    lowStock: "残りわずか",
    override: "個別プラットフォーム設定",
    fullSync: "全プラットフォーム・全商品同期",
    succeeded: "完了",
    processing: "実行中",
    failed: "要確認",
    successCount: "成功",
    failureCount: "失敗",
    pendingCount: "実行中",
    showDetails: "失敗詳細を確認",
    hideDetails: "失敗詳細を閉じる",
    reason: "失敗理由",
    affectedItems: "一致しなかった商品",
    retryPlatform: "このプラットフォームの失敗分を再実行",
    retrying: "再実行を依頼中…",
    retryStarted: "再実行を依頼しました。しばらくしてから更新してください。",
    retryPartial: "一部は再実行できませんでした。新しい在庫操作がある可能性があります。",
    missingTarget: "プラットフォームのメニューで商品が見つかりません。同じバッチの他の商品は同期済みです。",
    duplicateTarget: "同名商品が複数あるため、誤変更を防ぐため安全に停止しました。",
    genericError: "同期に失敗しました。下の原文を確認してください。",
    originalError: "元のエラー情報"
  };
}

function readableError(error: string, labels: ReturnType<typeof copy>) {
  if (/multiple target matches|複数の候補|多个候选/i.test(error)) return labels.duplicateTarget;
  if (/部分商品未找到|target verification failed|見つかりません/i.test(error)) return labels.missingTarget;
  return error.trim() || labels.genericError;
}

function platformName(platform: string, language: Language) {
  if (platform === "foundr1") return language === "ja" ? "Web予約" : language === "zh-Hant" ? "網站預約" : "网站预约";
  if (platform === "uber_eats") return "Uber";
  if (platform === "rocket_now") return language === "ja" ? "ロケットナウ" : "火箭";
  if (platform === "demae_can") return language === "zh-Hans" ? "出前馆" : "出前館";
  return platform;
}

function actionLabel(report: InventoryReport, labels: ReturnType<typeof copy>) {
  if (report.runType === "full_sync") return labels.fullSync;
  if (report.action === "available") return labels.available;
  if (report.action === "unavailable") return labels.unavailable;
  if (report.action === "low_stock") return labels.lowStock;
  return labels.override;
}

function actorLabel(report: InventoryReport, labels: ReturnType<typeof copy>) {
  if (report.actorName) return report.actorName;
  if (report.source === "scheduled") return labels.scheduled;
  if (report.source === "siri") return labels.siri;
  return labels.system;
}

export default function InventoryHistoryPage() {
  const { language } = useOsTranslation();
  const labels = copy(language);
  const [storeId, setStoreId] = useState("");
  const [days, setDays] = useState(30);
  const [reports, setReports] = useState<InventoryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedReports, setExpandedReports] = useState<Set<string>>(() => new Set());
  const [retryingPlatforms, setRetryingPlatforms] = useState<Set<string>>(() => new Set());
  const [retryMessages, setRetryMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const stored = getStoredStoreSelection();
    if (stored) {
      setStoreId(stored);
      return;
    }
    fetch("/api/store/context", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        const selected = String(body?.selectedStoreId ?? "");
        if (!selected) return;
        setStoredStoreSelection(selected);
        setStoreId(selected);
      })
      .catch(() => setError(labels.empty));
  }, [labels.empty]);

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/store/inventory-history?storeId=${encodeURIComponent(storeId)}&days=${days}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.error ?? labels.empty));
      setReports(Array.isArray(body?.reports) ? body.reports : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : labels.empty);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [storeId, days]);

  const retryPlatform = async (report: InventoryReport, platform: string) => {
    const key = `${report.id}:${platform}`;
    if (!storeId || retryingPlatforms.has(key)) return;
    const commands = report.failedCommands.filter((command) => command.platform === platform);
    setRetryingPlatforms((current) => new Set(current).add(key));
    setRetryMessages((current) => ({ ...current, [key]: "" }));
    let failures = 0;
    for (const command of commands) {
      try {
        const response = await fetch("/api/store/menu-sync-runs/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeId, commandId: command.id })
        });
        if (!response.ok) failures += 1;
      } catch {
        failures += 1;
      }
    }
    setRetryMessages((current) => ({
      ...current,
      [key]: failures ? labels.retryPartial : labels.retryStarted
    }));
    setRetryingPlatforms((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    await load();
  };

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div><p className="eyebrow">Foundr1 STORE</p><h1 data-i18n-ignore>{labels.title}</h1></div>
        </a>
        <StoreNavTabs active="menu" />
      </header>

      <section className="store-inventory-history-page">
        <div className="store-inventory-history-head panel">
          <div>
            <a href="/store/menu" className="store-inventory-history-back" data-i18n-ignore><ArrowLeft size={15} />{labels.back}</a>
            <h2 data-i18n-ignore>{labels.title}</h2>
            <p data-i18n-ignore>{labels.description}</p>
          </div>
          <div className="store-inventory-history-actions">
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="期間">
              <option value={7}>7日</option>
              <option value={30}>30日</option>
              <option value={90}>90日</option>
            </select>
            <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} />
              <span data-i18n-ignore>{labels.refresh}</span>
            </button>
          </div>
        </div>

        <section className="panel store-inventory-history-list" aria-live="polite">
          {loading && !reports.length ? <p className="empty-state" data-i18n-ignore>{labels.loading}</p> : null}
          {error ? <div className="inline-alert" role="alert">{error}</div> : null}
          {!loading && !error && !reports.length ? <p className="empty-state" data-i18n-ignore>{labels.empty}</p> : null}
          {reports.map((report) => {
            const stateLabel = labels[report.status];
            const expanded = expandedReports.has(report.id);
            return (
              <article className="store-inventory-history-row" key={report.id}>
                <div className="store-inventory-history-time">
                  <strong>{new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(report.createdAt))}</strong>
                  <span data-i18n-ignore>{labels.operator}: {actorLabel(report, labels)}</span>
                </div>
                <div className="store-inventory-history-operation">
                  <strong data-i18n-ignore>{report.runType === "full_sync" ? actionLabel(report, labels) : report.itemLabel}</strong>
                  <span data-i18n-ignore>{report.runType === "full_sync" ? "Store → Bridge" : actionLabel(report, labels)}</span>
                </div>
                <div className="store-inventory-history-platforms">
                  {report.platforms.map((platform) => {
                    const failed = platform.failed + platform.timedOut;
                    const pending = platform.processing + platform.queued;
                    return (
                      <span className={failed ? "is-failed" : pending ? "is-processing" : "is-succeeded"} key={platform.platform}>
                        <strong>{platformName(platform.platform, language)}</strong>
                        <small>{failed ? `${labels.failureCount} ${failed}/${platform.total}` : pending ? `${labels.pendingCount} ${pending}/${platform.total}` : `${labels.successCount} ${platform.succeeded}/${platform.total}`}</small>
                      </span>
                    );
                  })}
                </div>
                <span className={`store-inventory-history-status is-${report.status}`} data-i18n-ignore>
                  {report.status === "succeeded" ? <CheckCircle2 size={15} /> : report.status === "processing" ? <Clock3 size={15} /> : <XCircle size={15} />}
                  {stateLabel}
                </span>
                {report.status === "failed" ? (
                  <button
                    className="store-inventory-history-detail-toggle"
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedReports((current) => {
                      const next = new Set(current);
                      if (next.has(report.id)) next.delete(report.id);
                      else next.add(report.id);
                      return next;
                    })}
                  >
                    {expanded ? labels.hideDetails : labels.showDetails}
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                ) : null}
                {expanded ? (
                  <div className="store-inventory-history-details">
                    {report.platforms.filter((platform) => platform.failed || platform.timedOut).map((platform) => {
                      const key = `${report.id}:${platform.platform}`;
                      const commands = report.failedCommands.filter((command) => command.platform === platform.platform);
                      return (
                        <section className="store-inventory-history-platform-detail" key={platform.platform}>
                          <div className="store-inventory-history-detail-head">
                            <strong>{platformName(platform.platform, language)} · {labels.failureCount} {commands.length}</strong>
                            <button type="button" onClick={() => void retryPlatform(report, platform.platform)} disabled={retryingPlatforms.has(key)}>
                              <RefreshCw size={14} />
                              {retryingPlatforms.has(key) ? labels.retrying : labels.retryPlatform}
                            </button>
                          </div>
                          {commands.map((command, index) => (
                            <div className="store-inventory-history-error" key={command.id}>
                              <strong>{labels.reason} {index + 1}</strong>
                              <p>{readableError(command.error, labels)}</p>
                              {command.failedItems.length ? (
                                <div><span>{labels.affectedItems}</span><ul>{command.failedItems.map((item) => <li key={item}>{item}</li>)}</ul></div>
                              ) : null}
                              {command.error && readableError(command.error, labels) !== command.error ? <details><summary>{labels.originalError}</summary><code>{command.error}</code></details> : null}
                            </div>
                          ))}
                          {retryMessages[key] ? <p className="store-inventory-history-retry-message" role="status">{retryMessages[key]}</p> : null}
                        </section>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
