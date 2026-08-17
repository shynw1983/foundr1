"use client";

import { ArrowLeft, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
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
    pendingCount: "执行中"
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
    pendingCount: "執行中"
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
    pendingCount: "実行中"
  };
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
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
