"use client";

import { useRef, useState } from "react";
import { StockReceiptPanel } from "../../../components/StockReceiptPanel";
import { useInventoryReadModel } from "../../../components/useInventoryOperations";
import { formatInventoryCountQuantity } from "../../../lib/product-unit-conversions";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { StoreInventoryOperatorPanel } from "../components/StoreInventoryOperatorPanel";
import { useStoreInventoryOperator } from "../components/useStoreInventoryOperator";
import { useStoreInventoryStore } from "../components/useStoreInventoryStore";
import styles from "../components/StoreInventoryExecution.module.css";

type ReceivingItem = { id: string; name: string; actualQuantity: number | null; actualUnit: string | null; requestedQuantity: number | null; requestedUnit: string; status: string; stockRecordStatus: string; note?: string };
type ReceivingGroup = { id: string; type: "batch" | "items"; batchId?: string; orderId: string; storeName: string; label: string; status: string; items: ReceivingItem[] };
type ReceivingResponse = { confirmations: ReceivingGroup[]; canConfirmReceiving: boolean };
export default function StoreReceivingPage() {
  const { t, language } = useOsTranslation();
  const store = useStoreInventoryStore(), operator = useStoreInventoryOperator(store.storeId);
  const scope = `${store.storeId}:${operator.operator?.id ?? "unverified"}`;
  const model = useInventoryReadModel<ReceivingResponse>(`/api/store/procurement-receiving?storeId=${encodeURIComponent(store.storeId)}`, store.storeId, Boolean(store.storeId), operator.operator?.id);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reviews, setReviewed] = useState<{ scope: string; values: Record<string, boolean> }>({ scope: "", values: {} });
  const reviewed = reviews.scope === scope ? reviews.values : {};
  const saving = useRef(false), activeScope = useRef(scope); activeScope.current = scope;
  const quantity = (value: number | null, unit: string | null) => value === null || !unit ? t("数量・単位は未確認") : `${formatInventoryCountQuantity(value, language)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
  async function confirmArrival(group: ReceivingGroup) {
    if (!operator.canOperate || !operator.operator || !model.data?.canConfirmReceiving || !reviewed[group.id] || saving.current) return;
    const itemIds = group.items.filter(item => (item.stockRecordStatus === "unsupported" || item.actualQuantity === null || !item.actualUnit) && (item.actualQuantity === null || item.actualQuantity > 0) && item.status !== "received").map(item => item.id);
    if (!itemIds.length) return;
    const savedScope = scope; saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/store/procurement-receiving", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.storeId, type: "items", itemIds, confirmArrivalOnly: true, expectedOperatorId: operator.operator.id }) });
      const body = await response.json().catch(() => ({})); if (activeScope.current !== savedScope) return;
      if (!response.ok) { if (response.status === 401 || response.status === 403 || body.code === "operator_changed") operator.invalidate(); throw new Error(body.error || "店舗確認を保存できませんでした。"); }
      setNotice("到着の確認だけを保存しました。在庫数量は増えていません。"); setReviewed({ scope, values: {} }); await model.load();
    } catch (failure) { if (activeScope.current === savedScope) setError(failure instanceof Error ? failure.message : "店舗確認を保存できませんでした。"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <main className="store-workbench-shell"><header className="store-workbench-topbar"><a className="brand-block" href="/store/receiving"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>{t("納品・入庫")}</h1></div></a><StoreNavTabs active="receiving" storeId={store.storeId} /></header>
    <div className={styles.content} data-store-receiving-page data-i18n-ignore>
      {store.error || model.error || error ? <p role="alert" className={styles.error}>{t(store.error || model.error || error)}</p> : null}{notice ? <p role="status" className={styles.notice}>{t(notice)}</p> : null}
      {store.loading ? <p>{t("読み込み中")}</p> : null}
      {store.storeId ? <><StoreInventoryOperatorPanel key={store.storeId} context={operator} />
        <StockReceiptPanel key={scope} surface="store" storeId={store.storeId} expectedOperatorId={operator.operator?.id} draftScopeKey={`store:${scope}`} canOperate={operator.canOperate} onAuthorizationRequired={operator.invalidate} onRecorded={() => void model.load()} />
        <details className={styles.history}><summary>{t("納品履歴・情報確認が必要な到着")}</summary><p className={styles.hint}>{t("数量・単位や商品情報の確認が必要な到着は、到着だけを確認できます。在庫には反映せず、担当者に確認を依頼してください。")}</p><button type="button" className="text-button" disabled={busy || model.loading} onClick={() => void model.load()}>{t("更新")}</button>
          {model.data?.confirmations.map(group => { const unknown = group.items.some(item => (item.stockRecordStatus === "unsupported" || item.actualQuantity === null || !item.actualUnit) && (item.actualQuantity === null || item.actualQuantity > 0) && item.status !== "received"); return <article className={styles.card} key={group.id}><div className={styles.heading}><strong>{group.label}</strong><span>{t(group.status === "received" ? "店舗確認済み" : "納品済み")}</span></div><ul>{group.items.map(item => <li key={item.id}><strong>{item.name}</strong><span>{t("記録購入量")} {quantity(item.actualQuantity, item.actualUnit)}</span><small>{t(({ needs_review: "要確認", complete: "入庫済み", partial: "一部入庫", pending: "未入庫", unsupported: "要確認" } as Record<string, string>)[item.stockRecordStatus] || "要確認")}</small>{item.note ? <span>{item.note}</span> : null}</li>)}</ul>
            {unknown ? <><label className={styles.check}><input type="checkbox" checked={reviewed[group.id] ?? false} disabled={!operator.canOperate || busy} onChange={event => setReviewed(current => ({ scope, values: { ...(current.scope === scope ? current.values : {}), [group.id]: event.target.checked } }))} /><span>{t("商品が実際に届いたことだけを確認しました")}</span></label><button type="button" className="secondary-button" disabled={!operator.canOperate || !model.data?.canConfirmReceiving || busy || !reviewed[group.id]} onClick={() => void confirmArrival(group)}>{t("到着だけを確認（在庫には未反映）")}</button></> : null}
          </article>; })}
        </details>
      </> : null}
    </div>
  </main>;
}
