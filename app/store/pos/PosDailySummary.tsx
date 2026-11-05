"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import type { PosProductSummary } from "../../../lib/pos-daily-summary";
import styles from "./daily-summary.module.css";

type Preference = { mode: "payment" | "product"; productKey: string };
type Props = { onRefresh?: () => void; refreshing?: boolean; refreshError?: string; storeId: string; summary: { orderCount: number; total: number; average: number; products?: PosProductSummary[]; pendingSync?: boolean } };
const yen = (n: number) => `¥${Math.round(n || 0).toLocaleString("ja-JP")}`;
const initial: Preference = { mode: "payment", productKey: "" };

export default function PosDailySummary({ storeId, summary, onRefresh, refreshing, refreshError }: Props) {
  const { t } = useOsTranslation();
  const storageKey = `foundr1-pos-daily-summary:${storeId}`;
  const [saved, setSaved] = useState<{ storeId: string; value: Preference }>({ storeId: "", value: initial });
  const value = saved.storeId === storeId ? saved.value : initial;
  useEffect(() => {
    let value = initial;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (parsed?.mode === "payment" || parsed?.mode === "product") value = { mode: parsed.mode, productKey: typeof parsed.productKey === "string" ? parsed.productKey : "" };
    } catch { /* Storage may be unavailable on shared/private devices. */ }
    setSaved({ storeId, value });
  }, [storageKey, storeId]);
  function update(patch: Partial<Preference>) {
    const next = { ...value, ...patch };
    setSaved({ storeId, value: next });
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The switch still works without persistence. */ }
  }
  const products = summary.products || [];
  const product = products.find(p => p.key === value.productKey) || products[0];
  const byProduct = value.mode === "product";
  const unavailable = byProduct && summary.products === undefined;
  const count = byProduct ? product?.quantity || 0 : summary.orderCount;
  const total = byProduct ? product?.total || 0 : summary.total;
  const average = byProduct ? product?.average || 0 : summary.average;
  const unit = byProduct ? product?.isBowl ? "杯" : "点" : "件";
  return <div className={styles.card} data-pos-daily-summary>
    <div className={styles.top}>
      <span className={styles.label}>{t("本日")}{onRefresh ? <button className={styles.refresh} type="button" data-pos-summary-refresh title={t("売上集計を更新")} aria-label={t("売上集計を更新")} disabled={refreshing || summary.pendingSync} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></button> : null}</span>
      <div className={styles.toggle} role="group" aria-label={t("売上集計の切り替え")}>
        <button type="button" aria-pressed={!byProduct} onClick={() => update({ mode: "payment" })}>{t("会計別")}</button>
        <button type="button" aria-pressed={byProduct} onClick={() => update({ mode: "product" })}>{t("商品別")}</button>
      </div>
    </div>
    {byProduct && products.length ? <select className={styles.select} aria-label={t("集計する商品")} value={product.key} onChange={e => update({ productKey: e.target.value })}>
      {products.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
    </select> : null}
    {unavailable ? <small className={styles.note}>{t("商品別集計はオンラインで更新してください。")}</small> : <div className={styles.metrics} title={byProduct ? t("有料オプション込み・割引と返金を反映") : undefined}>
      <span data-summary-count>{count} {t(unit)}</span><strong data-summary-total>{yen(total)}</strong>
      <small data-summary-average>{t(byProduct ? product?.isBowl ? "1杯平均" : "1点平均" : "平均")} {yen(average)}</small>
    </div>}
    {byProduct && !unavailable && !products.length ? <small className={styles.note}>{t("本日の販売商品はありません。")}</small> : null}
    {refreshError ? <small className={styles.note} role="status">{t(refreshError)}</small> : null}
    {summary.pendingSync ? <small className={styles.note}>{t("未同期の会計を含む概算")}</small> : null}
  </div>;
}
