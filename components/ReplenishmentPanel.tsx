"use client";

import { AlertTriangle, ChevronDown, MapPin, PackageSearch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import type { ReplenishmentResponse, ReplenishmentSource } from "../lib/replenishment-policy";

export type ReplenishmentFocus = { kind: "item" | "option" | "inventory"; id: string };

export function ReplenishmentPanel({ storeId, refreshKey = 0, open, onOpenChange, focus, onClearFocus }: {
  storeId: string; refreshKey?: number; open: boolean; onOpenChange: (open: boolean) => void;
  focus?: ReplenishmentFocus | null; onClearFocus?: () => void;
}) {
  const { t, language } = useOsTranslation();
  const [data, setData] = useState<ReplenishmentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const loadedStore = useRef("");
  const activeStore = useRef(storeId);
  activeStore.current = storeId;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!storeId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/replenishment?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal });
      const body = await response.json();
      if (sequence !== requestSequence.current || activeStore.current !== storeId || signal?.aborted) return;
      if (!response.ok) throw new Error(body.error || "補充確認を読み込めませんでした。更新して再試行してください。");
      setData(body);
      loadedStore.current = storeId;
    } catch (failure) {
      if (sequence === requestSequence.current && activeStore.current === storeId && !signal?.aborted) {
        setError(failure instanceof Error ? failure.message : "補充確認を読み込めませんでした。更新して再試行してください。");
      }
    } finally { if (sequence === requestSequence.current && !signal?.aborted) setLoading(false); }
  }, [storeId]);

  useEffect(() => {
    const controller = new AbortController();
    if (loadedStore.current !== storeId) setData(null);
    void load(controller.signal);
    return () => { controller.abort(); ++requestSequence.current; };
  }, [load, refreshKey]);
  useEffect(() => {
    if (!open || !storeId) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [open, storeId, load]);

  if (!storeId) return null;
  const visibleData = data?.store.id === storeId ? data : null;
  const matchesFocus = (source: { kind: string; id: string }) => !focus || source.kind === focus.kind && source.id === focus.id;
  const risks = visibleData?.risks.filter(risk => risk.sources.some(matchesFocus)) ?? [];
  const unmapped = visibleData?.unmapped.filter(matchesFocus) ?? [];
  const total = visibleData ? visibleData.risks.length + visibleData.unmapped.length + visibleData.restrictedSourceCount : 0;
  const displayName = (source: { name: string; displayNames?: Record<string, string> }) => language === "ja" ? source.name : source.displayNames?.[language] || source.displayNames?.en || source.name;
  const orderHref = (productId: string) => `/os/orders?${new URLSearchParams({ replenishStoreId: storeId, replenishProductId: productId })}`;
  const mappingHref = (kind: string, id: string) => `/os/menus?${new URLSearchParams({ menuStockKind: kind, menuStockTargetId: id })}`;
  const number = (value: number | null | undefined) => value === null || value === undefined ? t("未記録") : new Intl.NumberFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { maximumFractionDigits: 6 }).format(value);
  const status = (value: string) => t(({ requested: "未購入", purchased: "購入済み", in_delivery: "配送中", delivered: "納品済み" } as Record<string, string>)[value] || value);

  function sourceLine(source: ReplenishmentSource) {
    const hasBookFacts = source.kind === "inventory" && Object.hasOwn(source, "lastCountedQuantity");
    const legacyRecord = hasBookFacts && source.stockRevision === 0;
    return <li key={`${source.kind}:${source.id}`}>
      <span className="replenishment-source-kind">{t(source.kind === "inventory" ? "保管場所" : source.kind === "option" ? "選択肢" : "メニュー")}</span>
      <span className="replenishment-source-content"><strong>{source.kind === "inventory" ? source.locationName || t("保管場所未設定") : displayName(source)}</strong>
        {source.kind === "inventory" ? <small>{t(legacyRecord ? "元の記録数量" : hasBookFacts ? "現在庫（棚卸＋入庫）" : "記録数量")} · {number(source.quantity)}{source.countUnit?.startsWith("1/") ? " × " : " "}{source.countUnit || t("単位未記録")}{!hasBookFacts ? <> · {t(source.countConfidence === "confirmed" ? "実数確認済み" : source.countConfidence === "stale" ? "再確認が必要" : "実数未確認")}</> : null}</small> : null}
        {legacyRecord ? <small>{t("入庫の前に実数を棚卸で確認してください。")}</small> : null}
        {hasBookFacts && !legacyRecord ? <small>{t("最終棚卸数量")} · {number(source.lastCountedQuantity)}{source.countUnit?.startsWith("1/") ? " × " : " "}{source.countUnit || t("単位未記録")} · {t(source.countConfidence === "confirmed" ? "実数確認済み" : source.countConfidence === "stale" ? "再確認が必要" : "実数未確認")}</small> : null}
        {source.kind === "inventory" && source.currentConversion ? <small>{t("1 {purchaseUnit} = {quantity} {countUnit}", { purchaseUnit: source.currentConversion.purchaseUnit, quantity: new Intl.NumberFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { maximumSignificantDigits: 12 }).format(source.currentConversion.unitsPerPurchase) + (source.currentConversion.countUnit.startsWith("1/") ? " ×" : ""), countUnit: source.currentConversion.countUnit })}</small> : null}
        {source.kind === "inventory" && source.purchaseEquivalent ? <small>{t("記録時の購入単位換算：約 {quantity} {unit}", { quantity: new Intl.NumberFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { maximumSignificantDigits: 8 }).format(source.purchaseEquivalent.quantity), unit: source.purchaseEquivalent.unit })}</small> : null}
        {source.kind === "inventory" && source.conversionChanged ? <small className="inventory-unit-warning">{t("換算設定が変更されています。数量を再確認してください。")}</small> : null}
        {source.note ? <small>{source.note}</small> : null}
      {source.kind === "inventory" && source.quickCheck && source.quickCheck.state !== "superseded" ? <><small>{t("目視")} · {t(({ enough: "足りる", low: "残りわずか", out: "ない" } as Record<string, string>)[source.quickCheck.status])} · {new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(source.quickCheck.checkedAt))} · {source.quickCheck.checkedBy}</small>
        {source.quickCheck.estimate ? <small>{source.quickCheck.estimate.kind === "small" ? t("少量（目安）") : t("約 {quantity} {unit}（目安）", { quantity: number(source.quickCheck.estimate.quantity), unit: source.quickCheck.estimate.purchaseUnit })}</small> : null}
        {source.quickCheck.state === "recheck" ? <small className="inventory-unit-warning">{t("到着・時間経過などのため再確認")}</small> : null}</> : null}</span>
      <span className={`replenishment-status is-${source.stockStatus}`}>{t(source.stockStatus === "unavailable" ? "欠品の報告" : "不足の確認")}</span>
    </li>;
  }

  return <details className="panel replenishment-panel" open={open} onToggle={event => onOpenChange(event.currentTarget.open)} data-i18n-ignore>
    <summary><PackageSearch size={19} /><strong>{t("補充確認")}</strong><span className="replenishment-count">{loading && !visibleData ? "…" : total}</span><small>{t("販売状態・庫位から発注を確認")}</small><ChevronDown size={16} /></summary>
    <div className="replenishment-body">
      <div className="replenishment-toolbar"><p>{t("現在の報告と未受領の発注を確認して、必要な数量を入力してください。")}</p><button className="secondary-button compact-button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} />{t("更新")}</button></div>
      {focus ? <button className="replenishment-clear-focus" type="button" onClick={onClearFocus}>{t("店舗のすべての補充確認を表示")}</button> : null}
      {error ? <p className="inline-alert" role="alert">{t(error)}</p> : null}
      {loading && !visibleData ? <p role="status">{t("読み込み中")}</p> : null}
      {visibleData?.restrictedSourceCount ? <p className="inline-alert"><AlertTriangle size={16} />{t("商品関連付け・公開範囲の確認が必要な報告 {count} 件があります。本部に確認してください。", { count: visibleData.restrictedSourceCount })}</p> : null}
      {risks.map(risk => <article className="replenishment-row" key={risk.key}>
        <div className="replenishment-row-head"><div><strong>{risk.product.name}</strong><small>{t("発注単位")} · {risk.product.unit}</small></div>
          {risk.blockedReason ? <span className="replenishment-blocked">{t(risk.blockedReason === "not_orderable" ? "発注停止中" : "本部確認が必要")}</span> : visibleData?.canCreateOrder ? <a className="primary-button compact-button" href={orderHref(risk.product.id)}>{t(risk.openOrders.length ? "追加の発注を確認" : "発注依頼を作成")}</a> : <small>{t("発注できる担当者に確認してください。")}</small>}
        </div>
        <ul className="replenishment-sources">{risk.sources.map(sourceLine)}</ul>
        {risk.openOrders.length ? <div className="replenishment-open-orders"><strong>{t("未受領の発注 {count} 件", { count: risk.openOrders.length })}</strong>
          <ul>{risk.openOrders.map(order => <li key={order.itemId}>{visibleData?.canCreateOrder ? <a href={`/os/orders?order=${encodeURIComponent(order.orderNo)}#発注依頼`}>{order.orderNo}</a> : <span>{order.orderNo}</span>}<span>{status(order.status)}</span><small>{t("依頼")} {number(order.requestedQuantity)} {order.unit} / {t("記載購入量")} {number(order.actualQuantity)} {order.actualQuantity === null ? "" : order.actualUnit || t("単位未記録")}</small></li>)}</ul>
        </div> : null}
        {risk.pendingReceipts?.length ? <div className="replenishment-open-orders" data-pending-stock-receipts><strong>{t("到着済み・未入庫 {count} 件", { count: risk.pendingReceipts.length })}</strong>
          <p>{t("到着した商品を先に確認して入庫してください。棚卸に含まれる場合は重複加算しない登録を選びます。")}</p>
          <ul>{risk.pendingReceipts.map(receipt => <li key={receipt.itemId}>{visibleData?.canCreateOrder ? <a href={`/os/orders?order=${encodeURIComponent(receipt.orderNo)}#発注依頼`}>{receipt.orderNo}</a> : <span>{receipt.orderNo}</span>}<small>{t("未入庫")} {number(receipt.remainingPurchaseQuantity)} {receipt.remainingPurchaseQuantity === null ? "" : receipt.actualUnit || t("単位未記録")}</small></li>)}</ul>
        </div> : null}
      </article>)}
      {unmapped.length ? <section className="replenishment-unmapped"><h3>{t("発注商品が未設定のメニュー")}</h3><ul>{unmapped.map(source => <li key={`${source.kind}:${source.id}`}><span><strong>{displayName(source)}</strong><small>{t(source.stockStatus === "unavailable" ? "欠品の報告" : "不足の確認")}</small></span>{visibleData?.canManageMenuLinks ? <a className="secondary-button compact-button" href={mappingHref(source.kind, source.id)}>{t("発注商品を関連付ける")}</a> : <small>{t("本部で発注商品を関連付けてください。")}</small>}</li>)}</ul></section> : null}
      {visibleData && !loading && !risks.length && !unmapped.length && !visibleData.restrictedSourceCount ? <p className="replenishment-empty"><MapPin size={17} />{t(focus ? "この対象の不足報告はありません。必要に応じて店舗のすべての報告を確認してください。" : "現在、補充確認が必要な報告はありません。")}</p> : null}
    </div>
  </details>;
}
