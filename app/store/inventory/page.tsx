"use client";

import { useMemo, useRef, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { QuickInventoryList } from "../../../components/QuickInventoryList";
import { StoreInventoryCountList, type StoreInventoryItem, type StoreCountSubmission, type StoreCountResult } from "../../../components/StoreInventoryCountList";
import { useInventoryReadModel } from "../../../components/useInventoryOperations";
import type { InventoryQuickCheckSubmission } from "../../../lib/inventory-quick-policy";
import { formatInventoryCountQuantity } from "../../../lib/product-unit-conversions";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { StoreInventoryOperatorPanel } from "../components/StoreInventoryOperatorPanel";
import { useStoreInventoryOperator } from "../components/useStoreInventoryOperator";
import { useStoreInventoryStore } from "../components/useStoreInventoryStore";
import styles from "../components/StoreInventoryExecution.module.css";

type StoreInventoryResponse = { selectedStoreId: string; locations: Array<{ id: string; name: string }>; items: StoreInventoryItem[]; recentChecks: Array<{ id: string; productName: string; locationName: string; quantity: number | null; countUnit: string; recordType?: string; quickStatus?: string; exceptionCode: string; recordedBy: string; createdLabel: string }> };
export default function StoreInventoryPage() {
  const { t, language } = useOsTranslation();
  const store = useStoreInventoryStore(); const operator = useStoreInventoryOperator(store.storeId);
  const scope = `${store.storeId}:${operator.operator?.id ?? "unverified"}`;
  const model = useInventoryReadModel<StoreInventoryResponse>(`/api/store/inventory?storeId=${encodeURIComponent(store.storeId)}`, store.storeId, Boolean(store.storeId), operator.operator?.id);
  const [mode, setMode] = useState<"quick" | "count">("quick"), [query, setQuery] = useState(""), [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const writing = useRef(false), currentScope = useRef(scope); currentScope.current = scope;
  const data = model.data?.selectedStoreId === store.storeId ? model.data : null;
  const items = useMemo(() => data?.items.filter(item => (!location || item.locationId === location) && `${item.productName} ${item.category} ${item.locationName}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => ({ ...item, canQuickCheck: operator.canOperate })) ?? [], [data, location, query, operator.canOperate]);
  async function write(payload: Record<string, unknown>): Promise<StoreCountResult> {
    if (!operator.canOperate || !operator.operator || writing.current) return { ok: false };
    const savedScope = scope; writing.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/store/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, storeId: store.storeId, expectedOperatorId: operator.operator.id }) });
      const body = await response.json().catch(() => ({})); if (currentScope.current !== savedScope) return { ok: false };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || body.code === "operator_changed") operator.invalidate();
        if (response.status === 409) await model.load();
        const message = body.error || "在庫情報を保存できませんでした。"; setError(message); return { ok: false, error: message };
      }
      setNotice("記録を保存しました。"); await model.load(); return { ok: true, reconciliation: body.count?.reconciliation ?? null };
    } catch { if (currentScope.current === savedScope) setError("在庫情報を保存できませんでした。"); return { ok: false, error: "在庫情報を保存できませんでした。" }; }
    finally { writing.current = false; setSaving(false); }
  }
  return <main className="store-workbench-shell">
    <header className="store-workbench-topbar"><a className="brand-block" href="/store/inventory"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>{t("在庫確認")}</h1></div></a><StoreNavTabs active="inventory" storeId={store.storeId} /></header>
    <div className={styles.content} data-store-inventory-page data-i18n-ignore>
      {store.error || model.error || error ? <p role="alert" className={styles.error}>{t(store.error || model.error || error)}</p> : null}
      {store.loading ? <p>{t("読み込み中")}</p> : null}
      {store.storeId ? <>
        <div className={styles.heading}><strong>{store.storeName}</strong><button type="button" className="secondary-button" disabled={saving || model.loading} onClick={() => void model.load()}>{t("更新")}</button></div>
        <StoreInventoryOperatorPanel key={store.storeId} context={operator} />
        <section className={styles.toolbar}><p className={styles.hint}>{t("目視で足りるかを確認し、必要なときだけ数えます。商品や単位の設定は本部で管理します。")}</p><div className={styles.pills} role="group" aria-label={t("在庫確認の方法")}><button type="button" className={mode === "quick" ? styles.selected : "secondary-button"} aria-pressed={mode === "quick"} onClick={() => setMode("quick")}>{t("かんたん確認")}</button><button type="button" className={mode === "count" ? styles.selected : "secondary-button"} aria-pressed={mode === "count"} onClick={() => setMode("count")}>{t("数量で棚卸")}</button></div><input className={styles.search} value={query} placeholder={t("商品・場所を検索")} aria-label={t("商品・場所を検索")} onChange={event => setQuery(event.target.value)} /><div className={styles.pills} role="group" aria-label={t("保管場所")}><button type="button" className={!location ? styles.selected : "secondary-button"} onClick={() => setLocation("")}>{t("すべて")}</button>{data?.locations.map(item => <button key={item.id} type="button" className={location === item.id ? styles.selected : "secondary-button"} onClick={() => setLocation(item.id)}>{item.name}</button>)}</div></section>
        {notice ? <p role="status" className={styles.notice}>{t(notice)}</p> : null}
        {!model.loading && data && !items.length ? <p className={styles.hint}>{t("該当する商品がありません。保管場所の初期設定は本部に確認してください。")}</p> : null}
        {items.length ? (mode === "quick" ? <QuickInventoryList key={scope} storeId={store.storeId} items={items} saving={saving} draftScopeKey={`store:${scope}`} onSave={async (checks: InventoryQuickCheckSubmission[]) => (await write({ action: "batch_quick_check", checks })).ok} /> : <StoreInventoryCountList key={scope} storeId={store.storeId} items={items} canOperate={operator.canOperate} expectedOperatorId={operator.operator?.id ?? ""} draftScopeKey={scope} saving={saving} onSave={(payload: StoreCountSubmission) => write(payload)} onReport={async (item, code, note) => { await write({ action: "exception", itemId: item.id, exceptionCode: code, note, expectedStockRevision: item.stockRevision, expectedQuickRevision: item.quickCheckBasis?.quickRevision }); }} />) : null}
        <details className={styles.history}><summary>{t("最近の確認記録")}</summary><ul>{data?.recentChecks.map(check => <li key={check.id}><strong>{check.productName}</strong><span>{check.locationName}</span><span>{check.recordType === "quick" ? t(({ enough: "足りる", low: "残りわずか", out: "ない" } as Record<string, string>)[check.quickStatus || ""] || "目視") : check.recordType === "exception" ? t(({ damaged: "破損", quality: "品質異常", too_much: "多すぎ" } as Record<string, string>)[check.exceptionCode] || "現場メモ") : check.quantity === null ? t("未確認") : `${formatInventoryCountQuantity(check.quantity, language)}${check.countUnit.startsWith("1/") ? " × " : " "}${check.countUnit}`}</span><small>{check.createdLabel} · {check.recordedBy}</small></li>)}</ul></details>
      </> : null}
    </div>
  </main>;
}
