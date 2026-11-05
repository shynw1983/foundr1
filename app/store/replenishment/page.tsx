"use client";

import { useEffect, useMemo, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { useInventoryReadModel } from "../../../components/useInventoryOperations";
import type { ReplenishmentDemand, ReplenishmentDemandResponse } from "../../../lib/replenishment-demand-types";
import { formatInventoryCountQuantity } from "../../../lib/product-unit-conversions";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { StoreInventoryOperatorPanel } from "../components/StoreInventoryOperatorPanel";
import { useStoreInventoryOperator } from "../components/useStoreInventoryOperator";
import { useStoreInventoryStore } from "../components/useStoreInventoryStore";
import { StoreReplenishmentReport } from "./StoreReplenishmentReport";
import base from "../components/StoreInventoryExecution.module.css";
import styles from "./replenishment.module.css";

const progressLabels: Record<ReplenishmentDemand["progress"], string> = {
  reported: "報告済み", reviewing: "担当者確認中", deferred: "保留中", purchasing: "購入手配中",
  awaiting_receipt: "納品待ち", partial_received: "一部納品", received: "入庫済み・補充確認待ち", needs_review: "再確認が必要", resolved: "補充完了", dismissed: "対応見送り"
};
const orderLabels: Record<string, string> = { requested: "発注済み", purchased: "購入済み", in_delivery: "配送中", delivered: "店舗確認待ち", received: "店舗確認済み", unavailable: "購入不可" };
const eventLabels: Record<string, string> = { report: "スタッフ報告", reported: "スタッフ報告", manual: "スタッフ報告", automatic: "在庫・メニューの不足", review: "担当者確認", ordered: "発注", create_order: "発注", resolved: "補充完了", dismissed: "対応見送り" };

export default function StoreReplenishmentPage() {
  const { t, language } = useOsTranslation();
  const store = useStoreInventoryStore(), operator = useStoreInventoryOperator(store.storeId);
  const scope = `${store.storeId}:${operator.operator?.id ?? "unverified"}`;
  const model = useInventoryReadModel<ReplenishmentDemandResponse>(`/api/store/replenishment?storeId=${encodeURIComponent(store.storeId)}`, scope, Boolean(store.storeId), operator.operator?.id);
  const [query, setQuery] = useState(""), [showHistory, setShowHistory] = useState(false);
  const [initialProductId, setInitialProductId] = useState("");
  useEffect(() => { setInitialProductId(new URLSearchParams(window.location.search).get("productId")?.trim() ?? ""); }, []);
  const data = model.data?.storeId === store.storeId ? model.data : null;
  const demands = useMemo(() => data?.demands.filter(demand =>
    (showHistory || !["resolved", "dismissed"].includes(demand.status)) &&
    `${demand.product.name} ${demand.note} ${demand.orders.map(order => order.orderNo).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())
  ) ?? [], [data, showHistory, query]);
  const amount = (quantity: number | null, unit: string, unknown = "未定") => quantity === null ? t(unknown) : `${formatInventoryCountQuantity(quantity, language)} ${unit}`;
  const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const canReport = Boolean(data?.canReport && operator.canOperate && operator.operator && data.operator?.id === operator.operator.id);

  return <main className="store-workbench-shell">
    <header className="store-workbench-topbar"><a className="brand-block" href="/store/replenishment"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>{t("補充依頼")}</h1></div></a><StoreNavTabs active="replenishment" storeId={store.storeId} /></header>
    <div className={styles.content} data-store-replenishment-page data-i18n-ignore>
      {store.error || model.error ? <p className={styles.error} role="alert">{t(store.error || model.error)}</p> : null}
      {store.loading || (model.loading && !data) ? <p role="status">{t("読み込み中")}</p> : null}
      {store.storeId ? <>
        <div className={base.heading}><strong>{store.storeName}</strong><button type="button" className="secondary-button" disabled={model.loading} onClick={() => void model.load()}>{t("更新")}</button></div>
        <StoreInventoryOperatorPanel key={store.storeId} context={operator} />
        <p className={styles.hint}>{t("在庫の不足とスタッフの報告を担当者がまとめて確認します。購入・納品の進み具合もここで確認できます。")}</p>
        {operator.operator && data ? <StoreReplenishmentReport key={scope} storeId={store.storeId} expectedOperatorId={operator.operator.id} canOperate={canReport} products={data.products} initialProductId={initialProductId} onRecorded={() => void model.load()} onAuthorizationRequired={operator.invalidate} /> : null}
        <section className={styles.section} aria-label={t("補充の進捗")}>
          <div className={styles.listHeading}><h2>{t("補充の進捗")}</h2><a className="text-button" href={`/store/receiving?storeId=${encodeURIComponent(store.storeId)}`}>{t("納品・入庫登録へ")}</a></div>
          <div className={styles.filters}><input name="demandSearch" type="search" value={query} placeholder={t("商品・発注番号で検索")} aria-label={t("商品・発注番号で検索")} onChange={event => setQuery(event.target.value)} /><label className={styles.checkbox}><input type="checkbox" checked={showHistory} onChange={event => setShowHistory(event.target.checked)} />{t("完了・見送りも表示")}</label></div>
          {!model.loading && data && !demands.length ? <p className={styles.empty}>{t("該当する補充依頼はありません。")}</p> : null}
          <ul className={styles.demands}>{demands.map(demand => <li key={demand.id} className={styles.demand}>
            <div className={styles.listHeading}><div><strong>{demand.product.name}</strong><small className={styles.sku}>SKU {demand.product.id.slice(-8)}</small></div><span className={styles.status} data-status={demand.progress}>{t(progressLabels[demand.progress])}</span></div>
            <div className={styles.facts}><span>{t("確認中の数量")} <strong>{amount(demand.quantity, demand.unit)}</strong></span>{demand.deferredUntil ? <span>{t("再確認予定")} {date(demand.deferredUntil)}</span> : null}<small>{t("更新")} {date(demand.updatedAt)}</small></div>
            {demand.note ? <p className={styles.note}>{demand.note}</p> : null}
            {demand.sources.length ? <ul className={styles.sources}>{demand.sources.map(source => <li key={`${source.kind}:${source.id}`}>
              <span>{t(source.kind === "inventory" ? "在庫確認" : "メニューの不足")} · {source.locationName || source.name}</span><span>{t(source.stockStatus === "unavailable" ? "ない" : "残りわずか")}</span>
              {source.quantity !== null && source.quantity !== undefined && source.countUnit ? <span>{t("帳簿在庫")} {source.quantity < 0 ? "−" : ""}{amount(Math.abs(source.quantity), source.countUnit)}</span> : null}
              {source.lastCountedAt ? <span>{t("最終棚卸")} {date(source.lastCountedAt)}</span> : null}
              {source.note ? <span>{source.note}</span> : null}
            </li>)}</ul> : null}
            {demand.orders.length ? <ul className={styles.orders}>{demand.orders.map(order => <li key={order.itemId}><strong>{order.orderNo}</strong><span>{t(orderLabels[order.status] || "確認中")}</span><span>{t("発注")} {amount(order.requestedQuantity, order.unit)}</span><span>{t("実際の購入")} {amount(order.actualQuantity, order.actualUnit || t("単位未確認"), "未確認")}</span><span>{t("納品・入庫済み")} {amount(order.receivedQuantity, order.actualUnit || t("単位未確認"))}</span></li>)}</ul> : null}
            {demand.openOrders.some(order => !demand.orders.some(linked => linked.itemId === order.itemId)) ? <div className={styles.otherOrders}><p className={styles.hint}>{t("ほかの未受領発注")}</p><ul className={styles.orders}>{demand.openOrders.filter(order => !demand.orders.some(linked => linked.itemId === order.itemId)).map(order => <li key={order.itemId}><strong>{order.orderNo}</strong><span>{t(orderLabels[order.status] || "確認中")}</span><span>{t("発注")} {amount(order.requestedQuantity, order.unit)}</span></li>)}</ul></div> : null}
            {demand.events.length ? <details className={styles.history}><summary>{t("報告・対応の履歴")} ({demand.events.length})</summary><ol>{demand.events.map(event => <li key={event.id}><div><span>{t(eventLabels[event.kind] || "対応記録")}</span>{event.actorName ? <strong>{event.actorName}</strong> : null}<small>{date(event.createdAt)}</small></div>{event.shortageStatus ? <span>{t(event.shortageStatus === "unavailable" ? "ない" : "残りわずか")} · </span> : null}{event.quantity !== null ? <span>{t(event.kind === "create_order" ? "発注数量" : event.kind === "review" ? "確認数量" : "希望数量")} {amount(event.quantity, event.unit || t("単位未確認"))}</span> : null}{event.note ? <p>{event.note}</p> : null}</li>)}</ol></details> : null}
          </li>)}</ul>
        </section>
      </> : null}
    </div>
  </main>;
}
