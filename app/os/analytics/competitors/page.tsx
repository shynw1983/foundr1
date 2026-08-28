"use client";

import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, EyeOff, PackageSearch, Plus, Radar, RefreshCw, Search, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ActionNotice, useActionNotice } from "../../components/ActionNotice";
import { AnalyticsShell } from "../components/AnalyticsShell";
import styles from "./page.module.css";

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
  currentValue: {
    price?: number | null;
    currency?: string;
    itemUrl?: string;
    imageUrl?: string;
    isAvailable?: boolean;
    promotionDetails?: { currentPrice?: string; originalPrice?: string };
  };
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

type ProductOptionGroup = {
  id: string;
  title: string;
  min: number;
  max: number;
  options: Array<{
    id: string;
    title: string;
    price: number;
    isSoldOut: boolean;
    childGroups: ProductOptionGroup[];
  }>;
};

type CompetitorItem = {
  id: string;
  sourceId: string;
  competitorName: string;
  name: string;
  category: string;
  description: string;
  price: number | null;
  currency: string;
  itemUrl: string;
  imageUrl: string;
  isAvailable: boolean;
  lastSeenAt: string;
  promotion: { active: boolean; currentPrice: string; originalPrice: string };
  optionGroups: ProductOptionGroup[];
  groupCount: number;
  optionCount: number;
};

type MonitorData = {
  sources: Source[];
  items: CompetitorItem[];
  changes: Change[];
  recentRuns: ScanRun[];
  summary: { activeSources: number; newProducts30d: number; lastCompletedAt: string | null };
};

const emptyData: MonitorData = {
  sources: [],
  items: [],
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
  options_changed: "商品選択内容変更",
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

function priceLabel(value: Change["currentValue"], changeType: string) {
  if (changeType === "item_promotion_changed" && value?.promotionDetails?.currentPrice) {
    const original = value.promotionDetails.originalPrice;
    return original ? `${value.promotionDetails.currentPrice}（通常 ${original}）` : value.promotionDetails.currentPrice;
  }
  if (typeof value?.price !== "number") return "";
  if ((value.currency || "JPY") === "JPY") return `¥${new Intl.NumberFormat("ja-JP").format(value.price)}`;
  return `${value.currency} ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value.price)}`;
}

function productPriceLabel(price: number | null, currency: string) {
  if (price === null) return "—";
  if ((currency || "JPY") === "JPY") return `¥${new Intl.NumberFormat("ja-JP").format(price)}`;
  return `${currency} ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(price)}`;
}

function OptionGroups({ groups, depth = 0 }: { groups: ProductOptionGroup[]; depth?: number }) {
  return (
    <div className={styles.optionGroups} data-depth={depth}>
      {groups.map((group) => (
        <section className={styles.optionGroup} key={`${depth}-${group.id}`}>
          <header>
            <strong>{group.title}</strong>
            <span>{group.min > 0 ? `必須 ${group.min}${group.max > group.min ? `〜${group.max}` : ""}点` : group.max > 0 ? `最大 ${group.max}点` : "任意"}</span>
          </header>
          <div className={styles.optionList}>
            {group.options.map((option) => (
              <div className={`${styles.optionItem}${option.isSoldOut ? ` ${styles.optionSoldOut}` : ""}`} key={option.id}>
                <div><span>{option.title}</span>{option.price > 0 ? <small>+{productPriceLabel(option.price, "JPY")}</small> : <small>無料</small>}{option.isSoldOut ? <em>売り切れ</em> : null}</div>
                {option.childGroups.length ? <OptionGroups groups={option.childGroups} depth={depth + 1} /> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function CompetitorMenuMonitorPage() {
  const [data, setData] = useState<MonitorData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [scanningId, setScanningId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("all");
  const [activeView, setActiveView] = useState<"products" | "timeline">("products");
  const [productQuery, setProductQuery] = useState("");
  const [productStatus, setProductStatus] = useState("all");
  const [productCategory, setProductCategory] = useState("all");
  const [expandedItemId, setExpandedItemId] = useState("");
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
  const sourceItems = useMemo(() => selectedSourceId === "all"
    ? data.items
    : data.items.filter((item) => item.sourceId === selectedSourceId), [data.items, selectedSourceId]);
  const categories = useMemo(() => [...new Set(sourceItems.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")), [sourceItems]);
  const visibleItems = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase("ja-JP");
    return sourceItems.filter((item) => {
      if (productCategory !== "all" && item.category !== productCategory) return false;
      if (productStatus === "promotion" && !item.promotion.active) return false;
      if (productStatus === "available" && !item.isAvailable) return false;
      if (productStatus === "soldout" && item.isAvailable) return false;
      if (productStatus === "options" && item.optionCount === 0) return false;
      return !query || `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase("ja-JP").includes(query);
    });
  }, [productCategory, productQuery, productStatus, sourceItems]);
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

          <section className={`panel competitor-monitor-panel ${styles.intelligencePanel}`}>
            <div className="panel-heading competitor-monitor-heading">
              <div><p className="eyebrow">Menu intelligence</p><h3>{activeView === "products" ? "現在の商品一覧" : "変更タイムライン"}</h3></div>
              <div className="competitor-monitor-heading-actions">
                <div className={styles.viewTabs} role="tablist" aria-label="表示内容">
                  <button className={activeView === "products" ? styles.activeTab : ""} type="button" role="tab" aria-selected={activeView === "products"} onClick={() => setActiveView("products")}>商品一覧</button>
                  <button className={activeView === "timeline" ? styles.activeTab : ""} type="button" role="tab" aria-selected={activeView === "timeline"} onClick={() => setActiveView("timeline")}>変更履歴</button>
                </div>
                <select value={selectedSourceId} onChange={(event) => { setSelectedSourceId(event.target.value); setProductCategory("all"); setExpandedItemId(""); }} aria-label="監視先で絞り込み">
                  <option value="all">すべての競合店</option>
                  {data.sources.map((source) => <option value={source.id} key={source.id}>{source.competitorName}</option>)}
                </select>
                {activeView === "timeline" ? <a className="secondary-button" href={reportHref}><Download size={15} />30日分CSV</a> : null}
              </div>
            </div>
            {activeView === "products" ? (
              <>
                <div className={styles.productTools}>
                  <label className={styles.searchBox}><Search size={15} /><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="商品名・説明を検索" aria-label="商品を検索" /></label>
                  <select value={productStatus} onChange={(event) => setProductStatus(event.target.value)} aria-label="商品状態で絞り込み">
                    <option value="all">すべての状態</option>
                    <option value="promotion">割引中</option>
                    <option value="available">販売中</option>
                    <option value="soldout">売り切れ</option>
                    <option value="options">選択内容あり</option>
                  </select>
                  <select value={productCategory} onChange={(event) => setProductCategory(event.target.value)} aria-label="分類で絞り込み">
                    <option value="all">すべての分類</option>
                    {categories.map((category) => <option value={category} key={category}>{category}</option>)}
                  </select>
                  <span>{visibleItems.length}商品</span>
                </div>
                {!visibleItems.length ? (
                  <div className="competitor-monitor-empty is-compact"><PackageSearch size={24} /><strong>条件に合う商品はありません</strong><span>店、状態、分類、検索語を変更してください。</span></div>
                ) : (
                  <div className={styles.productTableWrap}>
                    <table className={styles.productTable}>
                      <thead><tr><th>商品</th><th>分類</th><th>通常価格</th><th>割引</th><th>販売状態</th><th>商品選択内容</th></tr></thead>
                      <tbody>
                        {visibleItems.map((item) => {
                          const expanded = expandedItemId === item.id;
                          return (
                            <Fragment key={item.id}>
                              <tr className={expanded ? styles.expandedRow : ""}>
                                <td>
                                  <button className={styles.productNameButton} type="button" aria-expanded={expanded} onClick={() => setExpandedItemId(expanded ? "" : item.id)}>
                                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                    <span><strong>{item.name}</strong><small>{item.competitorName}</small></span>
                                  </button>
                                </td>
                                <td><span className={styles.categoryLabel}>{item.category || "未分類"}</span></td>
                                <td><strong className={styles.basePrice}>{productPriceLabel(item.price, item.currency)}</strong></td>
                                <td>{item.promotion.active ? <span className={styles.promotionPrice}><strong>{item.promotion.currentPrice || "実施中"}</strong><small>割引中</small></span> : <span className={styles.mutedCell}>なし</span>}</td>
                                <td><span className={item.isAvailable ? styles.available : styles.soldOut}>{item.isAvailable ? "販売中" : "売り切れ"}</span></td>
                                <td><button className={styles.optionCountButton} type="button" onClick={() => setExpandedItemId(expanded ? "" : item.id)} disabled={!item.optionCount}>{item.optionCount ? `${item.groupCount}組・${item.optionCount}項目` : "なし"}</button></td>
                              </tr>
                              {expanded ? (
                                <tr className={styles.detailRow}><td colSpan={6}>
                                  <div className={styles.productDetail}>
                                    <div className={styles.productDetailHead}>
                                      <div><strong>商品説明</strong><p>{item.description || "商品説明はありません。"}</p></div>
                                      {item.itemUrl ? <a href={item.itemUrl} target="_blank" rel="noreferrer">元メニューで見る<ExternalLink size={12} /></a> : null}
                                    </div>
                                    {item.optionGroups.length ? <OptionGroups groups={item.optionGroups} /> : <p className={styles.noOptions}>この商品に選択内容はありません。</p>}
                                  </div>
                                </td></tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : !visibleChanges.length ? (
              <div className="competitor-monitor-empty is-compact"><strong>まだ変更はありません</strong><span>初回読取で基準を作成した後、新商品・価格・割引・商品選択内容などの変更をここに記録します。</span></div>
            ) : (
              <div className="competitor-change-timeline">
                {visibleChanges.map((change) => (
                  <article className={`competitor-change-row is-${change.changeType}`} key={change.id}>
                    <span className="competitor-change-dot" />
                    <time>{formatDate(change.detectedAt)}</time>
                    <div>
                      <p><span>{changeTypeLabels[change.changeType] || change.changeType}</span><small>{change.competitorName}</small></p>
                      <strong>{change.title}</strong>
                      <em>{priceLabel(change.currentValue, change.changeType)}</em>
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
