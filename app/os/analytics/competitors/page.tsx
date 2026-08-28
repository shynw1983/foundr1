"use client";

import { Download, ExternalLink, Eye, EyeOff, Plus, Radar, RefreshCw, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActionNotice, useActionNotice } from "../../components/ActionNotice";
import { AnalyticsShell } from "../components/AnalyticsShell";

type Source = {
  id: string;
  competitorName: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: string;
  isActive: boolean;
  lastScannedAt: string | null;
  lastSuccessAt: string | null;
  lastRating: number | null;
  lastReviewCountLabel: string;
  lastError: string;
  itemCount: number;
  presentItemCount: number;
  newProductCount: number;
};

type Change = {
  id: string;
  sourceId: string;
  competitorName: string;
  sourceName: string;
  changeType: string;
  title: string;
  summary: string;
  currentValue: { price?: number | null; currency?: string; itemUrl?: string; imageUrl?: string; isAvailable?: boolean };
  detectedAt: string;
};

type ScanRun = {
  id: string;
  sourceId: string;
  competitorName: string;
  triggerType: string;
  status: string;
  itemCount: number;
  newItemCount: number;
  changeCount: number;
  errorDetail: string;
  startedAt: string;
};

type MonitorData = {
  sources: Source[];
  changes: Change[];
  recentRuns: ScanRun[];
  summary: { activeSources: number; newProducts30d: number; lastCompletedAt: string | null };
};

const emptyData: MonitorData = {
  sources: [],
  changes: [],
  recentRuns: [],
  summary: { activeSources: 0, newProducts30d: 0, lastCompletedAt: null }
};

const sourceTypeLabels: Record<string, string> = {
  website: "公式サイト",
  uber_eats: "Uber Eats",
  delivery_platform: "デリバリープラットフォーム",
  json: "公開JSON"
};

const changeTypeLabels: Record<string, string> = {
  new_product: "新商品",
  price_changed: "価格変更",
  renamed: "名称変更",
  category_changed: "分類変更",
  description_changed: "商品説明変更",
  image_changed: "商品画像変更",
  availability_changed: "販売状態変更",
  details_changed: "商品詳細変更",
  store_rating_changed: "店舗評価変更",
  store_review_count_changed: "評価件数変更",
  store_promotion_changed: "店舗キャンペーン変更",
  item_promotion_changed: "商品割引変更",
  returned: "掲載再開",
  removed: "掲載終了"
};

function formatDate(value: string | null) {
  if (!value) return "未実行";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function priceLabel(value: Change["currentValue"]) {
  if (typeof value?.price !== "number") return "";
  if ((value.currency || "JPY") === "JPY") return `¥${new Intl.NumberFormat("ja-JP").format(value.price)}`;
  return `${value.currency} ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value.price)}`;
}

export default function CompetitorMenuMonitorPage() {
  const [data, setData] = useState<MonitorData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [scanningId, setScanningId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("all");
  const { notice, showNotice, clearNotice } = useActionNotice();

  async function loadData() {
    const response = await fetch("/api/competitor-menus", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as MonitorData & { error?: string };
    if (!response.ok) throw new Error(body.error || "競合メニュー監視を読み込めませんでした。");
    setData(body);
  }

  useEffect(() => {
    void loadData().catch((error) => showNotice(error instanceof Error ? error.message : "読取に失敗しました。", "info")).finally(() => setIsLoading(false));
  }, []);

  const visibleChanges = useMemo(() => selectedSourceId === "all"
    ? data.changes
    : data.changes.filter((change) => change.sourceId === selectedSourceId), [data.changes, selectedSourceId]);
  const reportHref = selectedSourceId === "all"
    ? "/api/competitor-menus/report"
    : `/api/competitor-menus/report?sourceId=${encodeURIComponent(selectedSourceId)}`;

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSaving(true);
    try {
      const response = await fetch("/api/competitor-menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorName: formData.get("competitorName"),
          sourceName: formData.get("sourceName"),
          sourceUrl: formData.get("sourceUrl"),
          sourceType: formData.get("sourceType")
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "監視先を保存できませんでした。");
      form.reset();
      showNotice("監視先を追加しました。最初の読取では現在のメニューを基準として保存します。");
      await loadData();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "監視先を保存できませんでした。", "info");
    } finally {
      setIsSaving(false);
    }
  }

  async function scanSource(source: Source) {
    setScanningId(source.id);
    try {
      const response = await fetch("/api/competitor-menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", id: source.id })
      });
      const body = await response.json().catch(() => ({})) as { error?: string; baseline?: boolean; itemCount?: number; newItemCount?: number };
      if (!response.ok) throw new Error(body.error || "メニューを読み取れませんでした。");
      showNotice(body.baseline
        ? `${body.itemCount ?? 0}商品を基準として保存しました。次回から新商品を通知します。`
        : `読取が完了しました。新商品 ${body.newItemCount ?? 0}件。`);
      await loadData();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "メニューを読み取れませんでした。", "info");
      await loadData().catch(() => undefined);
    } finally {
      setScanningId("");
    }
  }

  async function toggleSource(source: Source) {
    const response = await fetch("/api/competitor-menus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, isActive: !source.isActive })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return showNotice(body.error || "監視状態を変更できませんでした。", "info");
    showNotice(source.isActive ? "毎日の監視を停止しました。" : "毎日の監視を再開しました。");
    await loadData();
  }

  async function deleteSource(source: Source) {
    if (!window.confirm(`「${source.competitorName}」の監視履歴をすべて削除しますか？`)) return;
    const response = await fetch(`/api/competitor-menus?id=${encodeURIComponent(source.id)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return showNotice(body.error || "監視先を削除できませんでした。", "info");
    showNotice("監視先と履歴を削除しました。");
    if (selectedSourceId === source.id) setSelectedSourceId("all");
    await loadData();
  }

  return (
    <AnalyticsShell
      eyebrow="Market intelligence"
      title="競合メニュー監視"
      sourceLabel="毎日 16:00（日本時間）に全店を自動確認"
      workspaceClassName="competitor-monitor-workspace"
    >
      <ActionNotice notice={notice} onClose={clearNotice} />

      <section className="competitor-monitor-strip" aria-label="監視状況">
        <div><span>監視中</span><strong>{data.summary.activeSources}</strong><small>メニュー</small></div>
        <div><span>30日間の新商品</span><strong>{data.summary.newProducts30d}</strong><small>件</small></div>
        <div><span>最終確認</span><strong className="is-date">{formatDate(data.summary.lastCompletedAt)}</strong><small>次回 16:00</small></div>
        <div className="competitor-monitor-pulse" aria-hidden="true"><Radar size={24} /><span /></div>
      </section>

      <section className="competitor-monitor-layout">
        <div className="competitor-monitor-main">
          <section className="panel competitor-monitor-panel">
            <div className="panel-heading competitor-monitor-heading">
              <div><p className="eyebrow">Watch list</p><h3>監視先</h3></div>
              <span>{isLoading ? "読込中" : `${data.sources.length}件`}</span>
            </div>
            {!data.sources.length && !isLoading ? (
              <div className="competitor-monitor-empty"><Radar size={28} /><strong>監視先を追加してください</strong><span>右のフォームに競合店名と公開メニューURLを入力します。</span></div>
            ) : (
              <div className="competitor-source-list">
                {data.sources.map((source) => (
                  <article className={`competitor-source-row${source.isActive ? "" : " is-paused"}`} key={source.id}>
                    <div className="competitor-source-state" aria-label={source.isActive ? "監視中" : "停止中"}><span /></div>
                    <div className="competitor-source-copy">
                      <div><strong>{source.competitorName}</strong><span>{source.sourceName || sourceTypeLabels[source.sourceType] || source.sourceType}</span></div>
                      <a href={source.sourceUrl} target="_blank" rel="noreferrer">{new URL(source.sourceUrl).hostname}<ExternalLink size={12} /></a>
                      <p className={source.lastError ? "is-error" : ""}>{source.lastError || `評価 ${source.lastRating ?? "—"}・評価件数 ${source.lastReviewCountLabel || "—"}・商品 ${source.presentItemCount}件・最終確認 ${formatDate(source.lastSuccessAt)}`}</p>
                    </div>
                    <div className="competitor-source-actions">
                      <button className="secondary-button" type="button" disabled={Boolean(scanningId)} onClick={() => void scanSource(source)}>
                        <RefreshCw size={15} className={scanningId === source.id ? "is-spinning" : ""} />{scanningId === source.id ? "確認中" : "今すぐ確認"}
                      </button>
                      <button className="icon-button" type="button" title={source.isActive ? "毎日の監視を停止" : "毎日の監視を再開"} onClick={() => void toggleSource(source)}>{source.isActive ? <Eye size={17} /> : <EyeOff size={17} />}</button>
                      <button className="icon-button is-danger" type="button" title="監視先を削除" onClick={() => void deleteSource(source)}><Trash2 size={17} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel competitor-monitor-panel">
            <div className="panel-heading competitor-monitor-heading">
              <div><p className="eyebrow">Detected changes</p><h3>変更タイムライン</h3></div>
              <div className="competitor-monitor-heading-actions">
                <select value={selectedSourceId} onChange={(event) => setSelectedSourceId(event.target.value)} aria-label="監視先で絞り込み">
                  <option value="all">すべての競合店</option>
                  {data.sources.map((source) => <option value={source.id} key={source.id}>{source.competitorName}</option>)}
                </select>
                <a className="secondary-button" href={reportHref}><Download size={15} />30日分CSV</a>
              </div>
            </div>
            {!visibleChanges.length ? (
              <div className="competitor-monitor-empty is-compact"><strong>まだ変更はありません</strong><span>初回読取で基準を作成した後、新商品や価格変更をここに記録します。</span></div>
            ) : (
              <div className="competitor-change-timeline">
                {visibleChanges.map((change) => (
                  <article className={`competitor-change-row is-${change.changeType}`} key={change.id}>
                    <span className="competitor-change-dot" />
                    <time>{formatDate(change.detectedAt)}</time>
                    <div>
                      <p><span>{changeTypeLabels[change.changeType] || change.changeType}</span><small>{change.competitorName}</small></p>
                      <strong>{change.title}</strong>
                      <em>{priceLabel(change.currentValue)}</em>
                      <div>{change.summary}{change.currentValue?.itemUrl ? <a href={change.currentValue.itemUrl} target="_blank" rel="noreferrer">商品を見る<ExternalLink size={11} /></a> : null}</div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="competitor-monitor-side">
          <form className="panel competitor-source-form" onSubmit={createSource}>
            <div className="panel-heading competitor-monitor-heading"><div><p className="eyebrow">New source</p><h3>監視先を追加</h3></div><Plus size={18} /></div>
            <label>競合店名<input name="competitorName" required maxLength={160} placeholder="例：○○ティー 渋谷店" /></label>
            <label>メニューの場所<select name="sourceType" defaultValue="website"><option value="website">公式サイト</option><option value="uber_eats">Uber Eats</option><option value="delivery_platform">その他デリバリー</option><option value="json">公開JSON</option></select></label>
            <label>表示名（任意）<input name="sourceName" maxLength={160} placeholder="例：テイクアウトメニュー" /></label>
            <label>公開メニューURL<input name="sourceUrl" type="url" required inputMode="url" placeholder="https://..." /></label>
            <p>初回は現在の商品を基準として保存し、通知しません。次回以降に追加された商品を通知します。</p>
            <button className="primary-button" type="submit" disabled={isSaving}><Plus size={16} />{isSaving ? "保存中" : "監視先を追加"}</button>
          </form>

          <section className="panel competitor-run-panel">
            <div className="panel-heading competitor-monitor-heading"><div><p className="eyebrow">Scan log</p><h3>最近の読取</h3></div></div>
            <div className="competitor-run-list">
              {data.recentRuns.slice(0, 8).map((run) => (
                <div key={run.id}><span className={`is-${run.status}`} /> <div><strong>{run.competitorName}</strong><small>{formatDate(run.startedAt)}・{run.status === "succeeded" ? `${run.itemCount}商品` : run.errorDetail}</small></div></div>
              ))}
              {!data.recentRuns.length ? <p>読取履歴はまだありません。</p> : null}
            </div>
          </section>
        </aside>
      </section>
    </AnalyticsShell>
  );
}
