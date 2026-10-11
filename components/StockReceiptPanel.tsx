"use client";

import { PackagePlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import { loadCurrentEmployee } from "../app/os/components/currentEmployeeStore";
import { formatInventoryCountQuantity, parseInventoryCountQuantity } from "../lib/product-unit-conversions";
import { addInventoryReceiptQuantities, exactInventoryReceiptCountQuantity, inventoryReceiptSourceBlockedReason } from "../lib/inventory-receipt-policy";
import type { InventoryReceiptResponse, InventoryReceiptMode, InventoryReceiptSourceSnapshot, InventoryReceiptSource, InventoryReceiptInventoryItem } from "../lib/inventory-receipt-policy";
import type { ProductUnitConversionSnapshot } from "../lib/product-unit-conversions";
import { normalizeProductBatchPackaging, type ProductBatchPackaging } from "../lib/product-packaging-policy";
import { BatchPackagingTemplateSaver } from "./BatchPackagingTemplateSaver";
import styles from "./StockReceiptPanel.module.css";

type ReceiptPayload = {
  requestId: string; purchaseOrderItemId: string; inventoryItemId: string; purchaseQuantity: number;
  mode: InventoryReceiptMode; expectedSource: InventoryReceiptSourceSnapshot;
  expectedStockRevision: number; expectedConversion: ProductUnitConversionSnapshot | null;
  batchPackaging?: ProductBatchPackaging; expectedOperatorId?: string; confirmStoreReceiving?: true;
};
type ReceiptPreview = { before: number | null; after: number | null; quantity: number | null; countUnit: string; purchaseUnit: string };
type PendingReceipt = { payload: ReceiptPayload; preview: ReceiptPreview };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey = (storeId: string) => `foundr1-os:pending-stock-receipt:${storeId}`;

function readPendingReceipt(storeId: string, scope: string): PendingReceipt | null {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const record = JSON.parse(raw) as PendingReceipt;
    if (!uuidPattern.test(record.payload?.requestId ?? "") || record.payload.expectedSource?.storeId !== storeId || !record.preview) return null;
    return record;
  } catch { return null; }
}

const blockedMessages: Record<string, string> = {
  actual_quantity_unknown: "実際の購入数量が未記録です。購入管理で確認してください。",
  actual_quantity_zero: "実際の購入数量が0のため、入庫できません。",
  actual_unit_unknown: "購入実績の単位が未記録です。購入管理で確認してください。",
  purchase_unit_changed: "購入時と現在の発注・購入単位が異なります。購入管理と商品設定を確認してください。",
  fully_received: "この購入明細はすべて入庫済みです。",
  stock_unknown: "帳簿在庫が未確認です。先に棚卸で実際の在庫を確認してください。",
  conversion_unknown: "購入・棚卸単位の換算が未設定です。商品設定を確認してください。",
  stock_conversion_changed: "帳簿在庫の換算設定が変わっています。先に棚卸で確認してください。",
  count_unknown: "実際の棚卸数量が未確認です。先に棚卸で確認してください。",
  count_conversion_changed: "棚卸時と現在の換算設定が異なります。先に棚卸で確認してください。"
  ,batch_unit_mismatch: "今回の包装は、保管先の内容単位に合わせてください。同じ袋・箱の単位で異なる内容量を混ぜて数えません。"
};

export function StockReceiptPanel({ storeId, orderId, sourceItemId, onRecorded, heading = "納品・入庫登録", surface = "os", expectedOperatorId, draftScopeKey, canOperate = true, onAuthorizationRequired }: {
  storeId: string; orderId?: string; sourceItemId?: string; onRecorded?: () => void; heading?: string; surface?: "os" | "store"; expectedOperatorId?: string; draftScopeKey?: string; canOperate?: boolean; onAuthorizationRequired?: () => void;
}) {
  const { t, language } = useOsTranslation();
  const storageScope = draftScopeKey ?? storeId;
  const endpoint = surface === "store" ? "/api/store/inventory/receipts" : "/api/inventory/receipts";
  const executionAllowed = surface !== "store" || Boolean(expectedOperatorId && canOperate);
  const activeScope = useRef(storageScope); activeScope.current = storageScope;
  const [data, setData] = useState<InventoryReceiptResponse | null>(null);
  const [renderedScope, setRenderedScope] = useState(storageScope);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sourceId, setSourceId] = useState(sourceItemId ?? "");
  const [targetId, setTargetId] = useState("");
  const [quantityText, setQuantityText] = useState("");
  const [mode, setMode] = useState<InventoryReceiptMode | "">("");
  const [detailed, setDetailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingReceipt | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [canViewProducts, setCanViewProducts] = useState(false);
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [batchConfirmed, setBatchConfirmed] = useState(false);
  const [batchDraft, setBatchDraft] = useState<{ purchaseUnit: string; countUnit: string; contentQuantity: string; contentUnit: string; stockQuantityPerPurchase: string; templateId?: string } | null>(null);
  const pendingRef = useRef<PendingReceipt | null>(null);
  const submittingRef = useRef(false);
  const requestSequence = useRef(0);
  const activeStore = useRef(storeId);
  const onRecordedRef = useRef(onRecorded);
  activeStore.current = storeId;
  onRecordedRef.current = onRecorded;
  useEffect(() => {
    let active = true;
    if (surface === "store") { setCanViewProducts(false); return; }
    void loadCurrentEmployee().then((employee) => {
      if (active) setCanViewProducts(Boolean(employee?.permissions?.includes("module.products") || employee?.permittedNavPaths?.includes("/os/products")));
    });
    return () => { active = false; };
  }, [surface]);

  function clearPending() {
    pendingRef.current = null;
    setPending(null);
    try { window.localStorage.removeItem(storageKey(storageScope)); } catch { /* A saved nonce can still be checked against the receipt history. */ }
  }
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!storeId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ storeId });
      if (orderId) params.set("orderId", orderId);
      const savedScope = storageScope;
      const response = await fetch(`${endpoint}?${params}`, { cache: "no-store", signal });
      const body = await response.json();
      if (signal?.aborted || sequence !== requestSequence.current || activeStore.current !== storeId || activeScope.current !== savedScope) return;
      if (!response.ok) throw new Error(body.error ?? "入庫候補を読み込めませんでした。更新して再確認してください。");
      setData(body as InventoryReceiptResponse);
      const unresolved = pendingRef.current;
      if (unresolved && body.recentReceipts?.some((receipt: { requestId: string }) => receipt.requestId === unresolved.payload.requestId)) {
        pendingRef.current = null;
        setPending(null);
        try { window.localStorage.removeItem(storageKey(storageScope)); } catch { /* Keep the verified result usable if storage is unavailable. */ }
        setQuantityText("");
        setNotice("この入庫は登録済みです。重複して加算しません。");
        setError("");
        onRecordedRef.current?.();
      }
    } catch (failure) {
      if (!signal?.aborted && sequence === requestSequence.current && activeStore.current === storeId) {
        setError(failure instanceof Error ? failure.message : "入庫候補を読み込めませんでした。更新して再確認してください。");
      }
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current && activeStore.current === storeId) setLoading(false);
    }
  }, [storeId, orderId, endpoint, storageScope]);

  useEffect(() => {
    const controller = new AbortController();
    setRenderedScope(storageScope); setData(null); setError(""); setNotice(""); setNeedsReview(false); setReviewed(false); setSubmitting(false); setDetailed(false); setBatchEnabled(false); setBatchConfirmed(false); setBatchDraft(null);
    const saved = readPendingReceipt(storeId, storageScope);
    pendingRef.current = saved;
    setPending(saved);
    setSourceId(saved?.payload.purchaseOrderItemId ?? sourceItemId ?? "");
    setTargetId(saved?.payload.inventoryItemId ?? "");
    setQuantityText(saved ? String(saved.payload.purchaseQuantity) : "");
    setMode(saved?.payload.mode ?? "");
    void load(controller.signal);
    return () => { controller.abort(); ++requestSequence.current; };
  }, [storeId, orderId, sourceItemId, storageScope, load]);

  const visibleData = renderedScope === storageScope && data?.store.id === storeId ? data : null;
  const sources = visibleData?.sources.filter((source) => !orderId || source.orderNo === orderId || source.purchaseOrderItemId === pending?.payload.purchaseOrderItemId) ?? [];
  const source = sources.find((candidate) => candidate.purchaseOrderItemId === sourceId) ?? (!sourceId && sources.length === 1 ? sources[0] : undefined);
  const targets = visibleData?.inventoryItems.filter((item) => item.storeId === storeId && item.productId === source?.productId) ?? [];
  const target = targets.find((item) => item.id === targetId) ?? (!targetId && targets.length === 1 ? targets[0] : undefined);
  let batchPackaging = source?.actualPackaging ?? undefined;
  if (!batchPackaging && batchEnabled && batchDraft && source?.actualUnit && target) {
    try { batchPackaging = normalizeProductBatchPackaging({ purchaseUnit: batchDraft.purchaseUnit, countUnit: batchDraft.countUnit, contentQuantity: parseInventoryCountQuantity(batchDraft.contentQuantity), contentUnit: batchDraft.contentUnit, stockQuantityPerPurchase: parseInventoryCountQuantity(batchDraft.stockQuantityPerPurchase), ...(batchDraft.templateId ? { templateId: batchDraft.templateId } : {}) }); } catch { /* Invalid drafts are visible and cannot be submitted. */ }
  }
  const batchBasisChanged = Boolean(batchPackaging && (batchPackaging.purchaseUnit !== source?.actualUnit || batchPackaging.countUnit !== target?.countUnit || batchPackaging.countUnit === source?.actualUnit));
  const batchReady = Boolean(!batchBasisChanged && (source?.actualPackaging || !batchEnabled || (batchPackaging && batchConfirmed)));
  const remainingQuantity = source?.unverifiedRemainingPurchaseQuantity ?? source?.remainingPurchaseQuantity;
  const quantity = parseInventoryCountQuantity(quantityText);
  const conversion = target?.currentConversion;
  const locked = submitting || Boolean(pending) || !executionAllowed;
  const inputInvalid = quantity === null || quantity <= 0 || (remainingQuantity !== null && remainingQuantity !== undefined && quantity > remainingQuantity);
  const reviewReady = !needsReview || reviewed;
  function canRecord(nextMode: InventoryReceiptMode) {
    return Boolean(visibleData?.canReceive && executionAllowed && !loading && !locked && reviewReady && source && target && !inputInvalid &&
      batchReady && !receiptModeBlockedReason(source, target, nextMode, batchPackaging) && receiptPreview(source, target, quantity, nextMode, batchPackaging));
  }
  const preview = pending?.preview ?? (source && target && mode ? receiptPreview(source, target, quantity, mode, batchPackaging) : null);
  const canRetry = Boolean(visibleData?.canReceive && executionAllowed && !loading && !submitting && pending && (surface !== "store" || pending.payload.expectedOperatorId === expectedOperatorId));
  const arrivalBlocked = source ? inventoryReceiptSourceBlockedReason(source, "unverified") : null;
  const inventoryHref = `${surface === "store" ? "/store/inventory" : "/os/inventory"}?storeId=${encodeURIComponent(storeId)}`;
  const number = (value: number | null | undefined) => value === null || value === undefined ? t("未確認") : `${value < 0 ? "−" : ""}${formatInventoryCountQuantity(Math.abs(value), language)}`;
  const withUnit = (value: number | null | undefined, unit: string) => `${number(value)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
  function inputChanged() { setError(""); setNotice(""); setReviewed(false); }
  function resetBatch() { setBatchEnabled(false); setBatchConfirmed(false); setBatchDraft(null); }

  async function submit(nextMode: InventoryReceiptMode | "" = mode) {
    if (submittingRef.current || (pendingRef.current ? !canRetry : (!nextMode || !canRecord(nextMode)))) return;
    const nextPreview = source && target && nextMode ? receiptPreview(source, target, quantity, nextMode, batchPackaging) : null;
    const selected = pendingRef.current ?? (source && target && quantity !== null && nextMode && nextPreview ? {
      payload: {
        requestId: crypto.randomUUID(), purchaseOrderItemId: source.purchaseOrderItemId, inventoryItemId: target.id,
        purchaseQuantity: quantity, mode: nextMode, expectedSource: source.expectedSource, expectedStockRevision: target.stockRevision,
        expectedConversion: nextMode === "unverified" || batchPackaging ? null : conversion!,
        ...(batchPackaging ? { batchPackaging } : {}),
        ...(surface === "store" ? { expectedOperatorId, confirmStoreReceiving: true as const } : {})
      }, preview: nextPreview
    } : null);
    if (!selected) return;
    setMode(selected.payload.mode);
    const submittedStore = storeId, submittedScope = storageScope;
    submittingRef.current = true; setSubmitting(true); setError(""); setNotice("");
    pendingRef.current = selected; setPending(selected);
    try { window.localStorage.setItem(storageKey(storageScope), JSON.stringify(selected)); } catch {
      setError("入庫を保存できませんでした。"); submittingRef.current = false; setSubmitting(false); return;
    }
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected.payload) });
      const body = await response.json().catch(() => ({}));
      if (activeStore.current !== submittedStore || activeScope.current !== submittedScope) return;
      if (response.ok) {
        clearPending(); setQuantityText(""); setNeedsReview(false); setReviewed(false); resetBatch();
        setNotice(body.replayed ? "この入庫は登録済みです。重複して加算しません。" : "入庫を登録しました。");
        await load();
        onRecordedRef.current?.();
        return;
      }
      if (surface === "store" && (response.status === 401 || response.status === 403 || body.code === "operator_changed")) {
        setError(body.error ?? "操作担当者を再確認してください。同じ担当者で未送信の入庫を確認できます。");
        onAuthorizationRequired?.();
        return;
      }
      if (response.status < 500) {
        clearPending();
        setError(body.error ?? "入庫内容を確認してください。");
        if (response.status === 409) {
          setNeedsReview(true); setReviewed(false);
          await load();
        }
      } else {
        setError(body.error ?? "送信結果を確認できません。同じ内容で再送してください。");
      }
    } catch {
      if (activeStore.current === submittedStore && activeScope.current === submittedScope) setError("送信結果を確認できません。同じ内容で再送してください。");
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  return <section className={styles.panel} data-stock-receipt-panel="" data-i18n-ignore aria-label={t(heading)}>
    <div className={styles.heading}><div><PackagePlus size={18} /><strong>{t(heading)}</strong>{visibleData?.store ? <span>{visibleData.store.name}</span> : null}</div>
      <button className="text-button" type="button" disabled={loading || submitting} onClick={() => void load()}><RefreshCw size={14} />{t("更新")}</button></div>
    <p className={styles.description}>{t("店舗確認と入庫は別の記録です。実際に届いた商品を保管場所に登録してください。")}</p>
    {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
    {notice ? <p className={styles.notice} role="status">{t(notice)}</p> : null}
    {loading && !visibleData ? <p role="status">{t("読み込み中")}</p> : null}
    {visibleData && (!visibleData.canReceive || !executionAllowed) ? <p>{t("このアカウントでは入庫登録できません。担当者に確認してください。")}</p> : null}
    {visibleData?.canReceive ? <>
      <form onSubmit={(event) => { event.preventDefault(); if (pending) void submit(); }}>
      {pending ? <p className={styles.warning}>{t("送信結果を確認中です。商品・数量・保管場所を変えず、同じ内容で再送してください。")}</p> : null}
      <div className={styles.fields}>
        <label className={styles.wide}><span>{t("到着した購入明細")}</span>
          <select name="purchaseOrderItemId" value={source?.purchaseOrderItemId ?? sourceId} disabled={locked} onChange={(event) => { inputChanged(); resetBatch(); setSourceId(event.target.value); setTargetId(""); setQuantityText(""); setMode(""); }}>
            <option value="">{t("選択してください")}</option>
            {sources.map((item) => <option key={item.purchaseOrderItemId} value={item.purchaseOrderItemId}>{item.orderNo} · {item.productName} · {t("未入庫")} {withUnit(item.unverifiedRemainingPurchaseQuantity ?? item.remainingPurchaseQuantity, item.actualUnit ?? item.purchaseUnit)}{item.unverifiedBlockedReason ? ` · ${t("要確認")}` : ""}</option>)}
            {sourceId && !source ? <option value={sourceId}>{t("対象明細を更新して確認してください。")}</option> : null}
          </select>
        </label>
        {sources.length > 1 ? <div className={styles.sourceCards} aria-label={t("到着した購入明細")}>
          {sources.slice(0, 8).map((item) => <button type="button" key={item.purchaseOrderItemId} className={source?.purchaseOrderItemId === item.purchaseOrderItemId ? styles.selectedCard : ""} disabled={locked} aria-pressed={source?.purchaseOrderItemId === item.purchaseOrderItemId} onClick={() => { inputChanged(); resetBatch(); setSourceId(item.purchaseOrderItemId); setTargetId(""); setQuantityText(""); setMode(""); }}>
            <strong>{item.productName}</strong><small>{item.orderNo}</small><span>{t("未入庫")} {withUnit(item.unverifiedRemainingPurchaseQuantity ?? item.remainingPurchaseQuantity, item.actualUnit ?? item.purchaseUnit)}</span>
          </button>)}
        </div> : null}
        {source ? <p className={styles.wide}>{t("記録購入量")} {withUnit(source.actualQuantity, source.actualUnit ?? "—")} · {t("登録済み入庫量")} {source.receivedPurchaseUnits.length ? source.receivedPurchaseUnits.map((record) => withUnit(record.quantity, record.purchaseUnit)).join(" · ") : withUnit(0, source.actualUnit ?? "—")}</p> : null}
        {arrivalBlocked ? <div className={styles.wide}><p className={styles.warning}>{t(blockedMessages[arrivalBlocked] ?? arrivalBlocked)}</p>
          {surface !== "store" && source?.correctionHref && arrivalBlocked !== "fully_received" ? <a href={source.correctionHref}>{t("購入記録を確認")}</a> : null}</div> : null}
        <label className={styles.wide}><span>{t("入庫先の保管場所")}</span>
          <select name="inventoryItemId" value={target?.id ?? targetId} disabled={locked || !source || Boolean(arrivalBlocked)} onChange={(event) => { inputChanged(); resetBatch(); setTargetId(event.target.value); setMode(""); }}>
            <option value="">{t("保管場所を選択してください")}</option>
            {targets.map((item) => <option key={item.id} value={item.id}>{item.locationName} · {item.countUnit}</option>)}
          </select>
          {target && targets.length === 1 ? <small>{t("この商品の保管場所を選択しました。場所を確認してください。")}</small> : null}
        </label>
        {source && !arrivalBlocked && !targets.length ? <p className={styles.wide}>{t("この店舗・商品に対応する保管場所がありません。先に在庫設定を登録してください。")} {surface === "store" ? <span>{t("本部に保管場所の設定を依頼してください。")}</span> : <a href={inventoryHref}>{t("在庫設定へ")}</a>}</p> : null}
        {source && target ? <details className={styles.batchPackaging} open={Boolean(source.actualPackaging || batchEnabled)}>
          <summary>{t(source.actualPackaging ? "記録済みの購入包装仕様" : "今回の包装・内容量を指定")}</summary>
          {batchBasisChanged ? <p className={styles.warning}>{t("購入または保管先の単位が変わりました。入力した包装仕様を新しい単位へ読み替えず、選び直してください。")}</p> : null}
          {source.actualPackaging ? <p>{t("1 {unit} の内容", { unit: source.actualPackaging.purchaseUnit })} · {withUnit(source.actualPackaging.contentQuantity, source.actualPackaging.contentUnit)} · {t("入庫数量")} {withUnit(source.actualPackaging.stockQuantityPerPurchase, source.actualPackaging.countUnit)}<small>{t("この購入明細の包装仕様は記録済みです。別の仕様は別の購入明細として登録してください。")}</small></p> : <>
            <label className={styles.review}><input name="batchPackagingEnabled" type="checkbox" checked={batchEnabled} disabled={locked} onChange={event => { inputChanged(); setBatchEnabled(event.target.checked); setBatchConfirmed(false); setBatchDraft(event.target.checked ? { purchaseUnit: source.actualUnit ?? "", countUnit: target.countUnit, contentQuantity: "", contentUnit: target.countUnit, stockQuantityPerPurchase: "" } : null); }} /><span>{t("今回の購入包装を確認して入庫に使う")}</span></label>
            {batchEnabled && batchDraft ? <div className={styles.batchFields}>
              <label className={styles.wide}><span>{t("包装テンプレートからコピー")}</span><select name="batchPackagingTemplate" value={batchDraft.templateId ?? ""} disabled={locked} onChange={event => { inputChanged(); setBatchConfirmed(false); const template = visibleData?.packagingTemplates?.find(template => template.id === event.target.value); setBatchDraft(template ? { templateId: template.id, purchaseUnit: template.purchaseUnit, countUnit: template.countUnit, contentQuantity: String(template.contentQuantity), contentUnit: template.contentUnit, stockQuantityPerPurchase: String(template.stockQuantityPerPurchase) } : { purchaseUnit: source.actualUnit ?? "", countUnit: target.countUnit, contentQuantity: "", contentUnit: target.countUnit, stockQuantityPerPurchase: "" }); }}><option value="">{t("今回の仕様を手入力")}</option>{visibleData?.packagingTemplates?.filter(template => template.status === "active" && template.productId === source.productId && template.purchaseUnit === source.actualUnit && template.countUnit === target.countUnit).map(template => <option key={template.id} value={template.id}>{template.name} · {withUnit(template.contentQuantity, template.contentUnit)}</option>)}</select></label>
              <label><span>{t("1購入単位の内容量")}</span><input name="batchContentQuantity" inputMode="decimal" value={batchDraft.contentQuantity} disabled={locked} onChange={event => { inputChanged(); setBatchConfirmed(false); setBatchDraft({ ...batchDraft, templateId: undefined, contentQuantity: event.target.value, ...(batchDraft.contentUnit === target.countUnit ? { stockQuantityPerPurchase: event.target.value } : {}) }); }} /><small>{batchDraft.purchaseUnit}</small></label>
              <label><span>{t("内容量の単位")}</span><input name="batchContentUnit" maxLength={64} value={batchDraft.contentUnit} disabled={locked} onChange={event => { inputChanged(); setBatchConfirmed(false); setBatchDraft({ ...batchDraft, templateId: undefined, contentUnit: event.target.value }); }} /></label>
              <label><span>{t("1購入単位から入庫する数量")}</span><input name="batchStockQuantityPerPurchase" inputMode="decimal" value={batchDraft.stockQuantityPerPurchase} disabled={locked} onChange={event => { inputChanged(); setBatchConfirmed(false); setBatchDraft({ ...batchDraft, templateId: undefined, stockQuantityPerPurchase: event.target.value }); }} /><small>{batchDraft.countUnit}</small></label>
              <p className={styles.wide}>{t("内容量は食材の実際の量です。輸送重量・購入原価の規格から自動換算しません。")}</p>
              <label className={`${styles.review} ${styles.wide}`}><input name="batchPackagingConfirmed" type="checkbox" checked={batchConfirmed} disabled={locked || !batchPackaging} onChange={event => { inputChanged(); setBatchConfirmed(event.target.checked); }} /><span>{t("今回の包装表示と入庫先の単位を確認しました")}</span></label>
              {!batchPackaging ? <small className={`${styles.warning} ${styles.wide}`}>{t("内容量・内容単位・入庫数量を明示してください。同じ内容単位の場合は数量を一致させます。")}</small> : null}
            </div> : null}
          </>}
          {surface !== "store" && batchPackaging && batchReady ? <BatchPackagingTemplateSaver storeId={storeId} productId={source.productId} packaging={batchPackaging} disabled={locked} onSaved={() => void load()} /> : null}
        </details> : null}
        <div className={styles.allReceived}>
          <strong>{quantityText ? t("今回受け取った数量") : t("今回の到着を確認")}{quantityText ? ` · ${withUnit(quantity, source?.actualUnit ?? source?.purchaseUnit ?? "—")}` : ""}</strong>
          <button type="button" className="secondary-button" disabled={locked || !target || !source || Boolean(arrivalBlocked) || !remainingQuantity} onClick={() => { inputChanged(); setQuantityText(String(remainingQuantity ?? "")); setMode(""); }}>{t("今回の未入庫分をすべて受け取りました")}{remainingQuantity && source ? ` · ${withUnit(remainingQuantity, source.actualUnit ?? source.purchaseUnit)}` : ""}</button>
          <small>{t("実際にこの数量が届いたことを確認してください。一部到着は詳細で入力できます。")}</small>
        </div>
        <details className={styles.detail} open={detailed} onToggle={(event) => setDetailed(event.currentTarget.open)}><summary>{t("一部到着・数量・保管場所の詳細")}</summary>
          <label><span>{t("入庫する購入数量")}</span><input name="purchaseQuantity" inputMode="decimal" value={quantityText} disabled={locked || !target || Boolean(arrivalBlocked)} placeholder={t("数量を入力")} onChange={(event) => { inputChanged(); setQuantityText(event.target.value); setMode(""); }} /><small>{source?.actualUnit ?? source?.purchaseUnit ?? "—"}</small></label>
          <p>{t("分けて保管する場合は、この保管場所へ入れる数量を登録し、残りを別の場所へ登録してください。")}</p>
          {target ? <p>{t(target.stockRevision > 0 ? "最近の実際の棚卸" : "元の記録数量")} {withUnit(target.currentQuantity, target.countUnit)} · {t("帳簿在庫")} {withUnit(target.stockQuantity, target.countUnit)}</p> : null}
          {!conversion && !batchPackaging && target ? <p>{t(blockedMessages.conversion_unknown)} {surface !== "store" && canViewProducts ? <a href="/os/products">{t("商品単位の設定を確認")}</a> : <span>{t("本部に単位の対応を確認してください。")}</span>}</p> : null}
        </details>
        {quantityText && inputInvalid && !pending ? <p className={`${styles.error} ${styles.wide}`}>{t("入庫数量は正の数で、未入庫の残量以内にしてください。小数は6桁までです。")}</p> : null}
        {needsReview && !pending ? <label className={styles.review}><input name="receiptUpdatedFactsConfirmed" type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>{t("更新後の購入数量・保管場所・換算を確認しました")}</span></label> : null}
        {preview ? <div className={styles.preview}>
          {pending?.payload.mode === "unverified" || mode === "unverified" ? <span>{t("到着した購入数量")} · {withUnit(pending?.payload.purchaseQuantity ?? quantity, preview.purchaseUnit)}</span> : <span>{t("入庫換算")} · {withUnit(pending?.payload.purchaseQuantity ?? quantity, preview.purchaseUnit)} × {number(pending?.payload.batchPackaging?.stockQuantityPerPurchase ?? batchPackaging?.stockQuantityPerPurchase ?? (pending?.payload.expectedConversion ?? conversion)?.unitsPerPurchase)} = {withUnit(preview.quantity, preview.countUnit)}</span>}
          <strong>{mode === "unverified" ? t("総在庫未確認") : <>{t("帳簿在庫")} · {withUnit(preview.before, preview.countUnit)} → {withUnit(preview.after, preview.countUnit)}</>}</strong>
          {mode === "included" ? <small>{t("今回は入庫の対応だけを記録し、在庫へ重複加算しません。")}</small> : null}
          {mode === "unverified" ? <small>{t("到着のみ記録し、総在庫は未確認にします。次の棚卸で実数を確認してください。")}</small> : null}
        </div> : null}
      </div>
      {pending ? <div className={styles.actions}><button type="submit" className="primary-button" disabled={!canRetry}>{t(submitting ? "登録中..." : "同じ内容で再送")}</button></div> : <div className={styles.quickActions}>
        <p>{t("今回の到着をどう記録しますか？")}</p>
        {(["add", "included", "unverified"] as const).map((choice) => {
          const reason = source && target ? receiptModeBlockedReason(source, target, choice, batchPackaging) : null;
          const choicePreview = source && target ? receiptPreview(source, target, quantity, choice, batchPackaging) : null;
          return <div key={choice}><button type="button" name="mode" value={choice} className={choice === "add" ? "primary-button" : "secondary-button"} disabled={!canRecord(choice)} onClick={() => void submit(choice)}>{t(choice === "add" ? "新しい到着分を在庫に加算" : choice === "included" ? "棚卸に含まれているため加算しない" : "到着だけ記録・総在庫は未確認にする")}</button>
            <small>{t(choice === "add" ? "今回の数量を現在庫へ追加します。" : choice === "included" ? "今回の数量はすでに棚卸済みです。重複加算しません。" : "数え直さず到着を記録します。現在庫は未確認になります。")}</small>
            {choicePreview && choice !== "unverified" ? <small>{t("現在庫 {before} → {after}", { before: withUnit(choicePreview.before, choicePreview.countUnit), after: withUnit(choicePreview.after, choicePreview.countUnit) })}</small> : null}
            {quantity !== null && quantity > 0 && source && target?.currentConversion && target.stockQuantity !== null && !reason && !choicePreview && choice !== "unverified" ? <small className={styles.warning}>{t("換算後の数量を小数点以下6桁で正確に記録できません。数量または棚卸単位を確認してください。")}</small> : null}
            {reason && choice !== "unverified" ? <small className={styles.warning}>{t(blockedMessages[reason] ?? reason)}</small> : null}
          </div>;
        })}
      </div>}
      {!sources.length ? <p>{t("この条件で入庫できる到着明細はありません。")}</p> : null}
      </form>
    </> : null}
    {visibleData?.recentReceipts.length ? <details className={styles.history}><summary>{t("最近の入庫履歴")}</summary><ul>{visibleData.recentReceipts.filter((receipt) => !orderId || receipt.orderNo === orderId).slice(0,8).map((receipt) => <li key={receipt.id}>
      <strong>{receipt.productName}</strong><span>{receipt.orderNo} · {receipt.locationName} · {withUnit(receipt.purchaseQuantity, receipt.purchaseUnit)}{receipt.mode === "unverified" ? ` · ${t("総在庫未確認")}` : ` → ${withUnit(receipt.countQuantity, receipt.countUnit)}`}</span>
      {receipt.batchPackaging ? <small>{t("1 {unit} の内容", { unit: receipt.batchPackaging.purchaseUnit })} · {withUnit(receipt.batchPackaging.contentQuantity, receipt.batchPackaging.contentUnit)}</small> : null}
      <small>{t(receipt.mode === "add" ? "在庫に加算" : receipt.mode === "included" ? "棚卸に含まれる入庫" : "到着のみ記録")} · {receipt.recordedBy} · {receipt.createdAt}</small>
    </li>)}</ul></details> : null}
  </section>;
}

export function receiptModeBlockedReason(source: InventoryReceiptSource, target: InventoryReceiptInventoryItem, mode: InventoryReceiptMode, packaging = source.actualPackaging ?? undefined) {
  if (packaging && mode !== "unverified") {
    if (packaging.purchaseUnit !== source.actualUnit || packaging.countUnit !== target.countUnit || target.countUnit === source.actualUnit) return "batch_unit_mismatch";
    return inventoryReceiptSourceBlockedReason(source, "unverified") ?? (mode === "add" ? target.batchAddBlockedReason ?? (target.stockQuantity === null ? "stock_unknown" : null) : target.batchIncludedBlockedReason ?? (target.stockQuantity === null ? "stock_unknown" : target.currentQuantity === null || !target.lastCountedAt ? "count_unknown" : null));
  }
  return mode === "unverified" ? inventoryReceiptSourceBlockedReason(source, mode) ?? target.unverifiedBlockedReason
    : source.blockedReason ?? (mode === "add" ? target.addBlockedReason : target.includedBlockedReason);
}
export function receiptPreview(source: InventoryReceiptSource, target: InventoryReceiptInventoryItem, quantity: number | null, mode: InventoryReceiptMode, packaging = source.actualPackaging ?? undefined): ReceiptPreview | null {
  if (quantity === null || quantity <= 0) return null;
  if (mode === "unverified") return { before: target.stockQuantity, after: null, quantity: null, countUnit: target.countUnit, purchaseUnit: source.actualUnit ?? "" };
  if (!packaging && !target.currentConversion) return null;
  if (packaging && (packaging.countUnit !== target.countUnit || packaging.purchaseUnit !== source.actualUnit || target.countUnit === source.actualUnit)) return null;
  const countQuantity = exactInventoryReceiptCountQuantity(quantity, packaging?.stockQuantityPerPurchase ?? target.currentConversion!.unitsPerPurchase);
  if (countQuantity === null || target.stockQuantity === null) return null;
  const after = mode === "add" ? addInventoryReceiptQuantities(target.stockQuantity, countQuantity) : target.stockQuantity;
  return after === null ? null : { before: target.stockQuantity, after, quantity: countQuantity, countUnit: target.countUnit, purchaseUnit: source.actualUnit ?? source.purchaseUnit };
}
