"use client";

import { Check, CheckCircle2, ClipboardCheck, Minus, Plus, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import type { InventoryQuickCheck, InventoryQuickCheckBasis, InventoryQuickCheckEstimate, InventoryQuickCheckSubmission, InventoryQuickCheckStatus } from "../lib/inventory-quick-policy";
import { parseInventoryCountQuantity } from "../lib/product-unit-conversions";
import styles from "./QuickInventoryList.module.css";

export type QuickInventoryItem = {
  id: string; storeId: string; productName: string; locationName: string; exceptionCode: string; exceptionNote: string;
  quickCheckBasis?: InventoryQuickCheckBasis; quickCheck?: InventoryQuickCheck | null; canQuickCheck?: boolean;
};
type Draft = InventoryQuickCheckSubmission;
const labels: Record<InventoryQuickCheckStatus, string> = { enough: "足りる", low: "残りわずか", out: "ない" };
const keyFor = (storeId: string) => `foundr1-os:quick-inventory-draft:v1:${storeId}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function QuickInventoryList({ storeId, items, saving, onSave }: {
  storeId: string; items: QuickInventoryItem[]; saving: boolean; onSave: (checks: InventoryQuickCheckSubmission[]) => Promise<boolean>;
}) {
  const { t, language } = useOsTranslation();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [estimateInputs, setEstimateInputs] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [hydratedStore, setHydratedStore] = useState<string | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    setHydratedStore(null);
    setStorageError(""); setSaveError("");
    try {
      const raw = JSON.parse(localStorage.getItem(keyFor(storeId)) || "{}");
      const safe: Record<string, Draft> = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [id, value] of Object.entries(raw)) {
        const draft = value as Draft;
        if (uuid.test(id) && draft.itemId === id && ["enough", "low", "out"].includes(draft.status) && draft.expectedBasis) safe[id] = draft;
      }
      setDrafts(safe);
      setEstimateInputs(Object.fromEntries(Object.values(safe).filter(draft => draft.estimate?.kind === "quantity").map(draft => [draft.itemId, String((draft.estimate as Extract<InventoryQuickCheckEstimate, { kind: "quantity" }>).quantity)])));
    } catch { setDrafts({}); setEstimateInputs({}); }
    setHydratedStore(storeId);
  }, [storeId]);
  useEffect(() => {
    if (hydratedStore !== storeId) return;
    try {
      if (Object.keys(drafts).length) localStorage.setItem(keyFor(storeId), JSON.stringify(drafts));
      else localStorage.removeItem(keyFor(storeId));
      setStorageError("");
    } catch { setStorageError("未保存の確認内容をこの端末に保存できません。画面を閉じずに保存してください。"); }
  }, [drafts, storeId, hydratedStore]);
  const draftList = Object.values(drafts);
  const currentItems = new Map(items.map(item => [item.id, item]));
  const staleDrafts = draftList.filter(draft => {
    const item = currentItems.get(draft.itemId);
    // Off-screen drafts remain saved, but only currently displayed items may be submitted.
    return item && JSON.stringify(item.quickCheckBasis) !== JSON.stringify(draft.expectedBasis);
  });
  const visibleDrafts = draftList.filter(draft => currentItems.has(draft.itemId));
  const invalidEstimateInputs = visibleDrafts.some(draft => Boolean(estimateInputs[draft.itemId]?.trim() && parseInventoryCountQuantity(estimateInputs[draft.itemId]) === null));
  const unseenCount = items.filter(item => !drafts[item.id] && (!item.quickCheck || item.quickCheck.state !== "fresh")).length;
  const canEdit = items.some(item => item.canQuickCheck && item.quickCheckBasis);
  const number = (value: number) => new Intl.NumberFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { maximumFractionDigits: 6 }).format(value);

  function choose(item: QuickInventoryItem, status: InventoryQuickCheckStatus) {
    if (!item.canQuickCheck || !item.quickCheckBasis || saving || savingRef.current) return;
    setSaveError("");
    const existingEstimate = drafts[item.id] ? drafts[item.id].estimate : item.quickCheck?.estimate?.purchaseUnit === item.quickCheckBasis.unitConfiguration.unit ? item.quickCheck.estimate : null;
    if (!drafts[item.id]) setEstimateInputs(current => ({ ...current, [item.id]: existingEstimate?.kind === "quantity" ? String(existingEstimate.quantity) : "" }));
    setDrafts(current => ({ ...current, [item.id]: { ...current[item.id], itemId: item.id, status,
      expectedBasis: current[item.id]?.expectedBasis ?? item.quickCheckBasis!,
      estimate: current[item.id] ? current[item.id].estimate : item.quickCheck?.estimate?.purchaseUnit === item.quickCheckBasis!.unitConfiguration.unit ? item.quickCheck.estimate : null
    } }));
  }
  function remainingEnough() {
    if (saving || savingRef.current) return;
    setSaveError("");
    setDrafts(current => {
      const next = { ...current };
      for (const item of items) if (!next[item.id] && item.canQuickCheck && item.quickCheckBasis) {
        if (item.quickCheck?.state !== "superseded" && (item.quickCheck?.status === "low" || item.quickCheck?.status === "out")) continue;
        const existingEstimate = item.quickCheck?.estimate?.purchaseUnit === item.quickCheckBasis.unitConfiguration.unit ? item.quickCheck.estimate : null;
        next[item.id] = { itemId: item.id, status: "enough", expectedBasis: item.quickCheckBasis, estimate: existingEstimate };
      }
      return next;
    });
  }
  function estimate(item: QuickInventoryItem, value: string | "small" | null) {
    const draft = drafts[item.id];
    if (!draft || saving || savingRef.current) return;
    const unit = draft.expectedBasis.unitConfiguration.unit;
    const quantity = value === null || value === "small" ? null : parseInventoryCountQuantity(value);
    if (value !== null && value !== "small" && quantity === null) return;
    const next: InventoryQuickCheckEstimate | null = value === "small" ? { kind: "small", purchaseUnit: unit || null } : value === null ? null : { kind: "quantity", quantity: quantity!, purchaseUnit: unit };
    setDrafts(current => ({ ...current, [item.id]: { ...current[item.id], estimate: next } }));
  }
  function recheck() {
    const changedUnits = new Set(draftList.filter(draft => currentItems.get(draft.itemId)?.quickCheckBasis?.unitConfiguration.unit !== draft.expectedBasis.unitConfiguration.unit).map(draft => draft.itemId));
    setEstimateInputs(current => Object.fromEntries(Object.entries(current).filter(([id]) => !changedUnits.has(id))));
    setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, draft]) => {
      const basis = currentItems.get(id)?.quickCheckBasis;
      if (!basis) return [id, draft];
      const unitChanged = basis.unitConfiguration.unit !== draft.expectedBasis.unitConfiguration.unit;
      return [id, { ...draft, expectedBasis: basis, estimate: unitChanged ? null : draft.estimate }];
    })));
    setSaveError("");
  }
  async function save() {
    if (savingRef.current || saving || !visibleDrafts.length || staleDrafts.length || invalidEstimateInputs) return;
    savingRef.current = true; setSaveError("");
    try {
      if (await onSave(visibleDrafts)) {
        const saved = new Set(visibleDrafts.map(draft => draft.itemId));
        const submitted = new Map(visibleDrafts.map(draft => [draft.itemId, JSON.stringify(draft)]));
        let persistedRemaining: Record<string, Draft> | null = null;
        // A parent refresh may have unmounted this instance; clear committed drafts synchronously too.
        try {
          const stored = JSON.parse(localStorage.getItem(keyFor(storeId)) || "{}");
          if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            const remaining = Object.fromEntries(Object.entries(stored).filter(([id, value]) => !saved.has(id) || JSON.stringify(value) !== submitted.get(id)));
            persistedRemaining = remaining as Record<string, Draft>;
            if (Object.keys(remaining).length) localStorage.setItem(keyFor(storeId), JSON.stringify(remaining));
            else localStorage.removeItem(keyFor(storeId));
          }
        } catch { /* The persisted draft stays reviewable if storage is unavailable. */ }
        setDrafts(current => ({ ...(persistedRemaining ?? {}), ...Object.fromEntries(Object.entries(current).filter(([id, value]) => !saved.has(id) || JSON.stringify(value) !== submitted.get(id))) }));
        if (persistedRemaining) setEstimateInputs(current => {
          const next = { ...current };
          for (const [id, value] of Object.entries(persistedRemaining!)) if (saved.has(id)) next[id] = value.estimate?.kind === "quantity" ? String(value.estimate.quantity) : "";
          return next;
        });
      } else setSaveError("確認内容を保存できませんでした。入力を残しています。最新の内容を確認して再試行してください。");
    } finally { savingRef.current = false; }
  }
  function estimateLabel(value: InventoryQuickCheckEstimate) {
    return value.kind === "small" ? t("少量（目安）") : t("約 {quantity} {unit}（目安）", { quantity: number(value.quantity), unit: value.purchaseUnit });
  }
  function time(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return <section className={styles.panel} data-quick-inventory="" data-i18n-ignore aria-label={t("かんたん在庫確認")}>
    <div className={styles.toolbar}>
      <div><ClipboardCheck size={18} /><strong>{t("かんたん在庫確認")}</strong><span>{t("この表示で未確認 {count} 件", { count: unseenCount })}</span></div>
      {canEdit ? <button type="button" className="secondary-button" disabled={saving || !items.length || items.length > 500} onClick={remainingEnough}><CheckCircle2 size={16} />{t("この表示は見ました。残りも足りる")}</button> : null}
    </div>
    <p className={styles.description}>{t("数えずに状態だけ確認できます。先に不足を選び、見た商品だけ「足りる」にしてください。")}</p>
    {!canEdit ? <p>{t("このアカウントではかんたん確認を保存できません。")}</p> : null}
    {storageError ? <p className={styles.error} role="alert">{t(storageError)}</p> : null}
    {saveError ? <p className={styles.error} role="alert">{t(saveError)}</p> : null}
    {staleDrafts.length ? <div className={styles.warning} role="alert"><p>{t("保存前に在庫や単位が更新されました。状態をもう一度見てください。単位が変わった目安は外します。")}</p><button type="button" className="secondary-button" disabled={saving} onClick={recheck}>{t("最新の設定で状態を見直しました")}</button></div> : null}
    <div className={styles.list}>
      {items.map(item => {
        const draft = drafts[item.id];
        const check = item.quickCheck;
        const currentStatus = draft?.status ?? (check?.state !== "superseded" ? check?.status : null);
        const currentEstimate = draft ? draft.estimate : check?.estimate;
        const purchaseUnit = draft?.expectedBasis.unitConfiguration.unit ?? item.quickCheckBasis?.unitConfiguration.unit ?? "";
        return <article className={styles.row} key={item.id} data-quick-item={item.id}>
          <div className={styles.itemHeading}><div><strong>{item.productName}</strong><small>{item.locationName}</small></div>
            <span className={`${styles.state} ${currentStatus === "low" || currentStatus === "out" ? styles.low : ""}`}>{draft ? t("未保存") : !check || check.state === "superseded" ? t("未確認") : check.state === "recheck" ? t("もう一度確認") : t("目視確認済み")}</span></div>
          {["quality", "damaged", "too_much"].includes(item.exceptionCode) ? <p className={styles.warning}>{t("品質・破損などの報告は別に残っています。数量で棚卸から確認してください。")}</p> : null}
          <div className={styles.statusButtons} role="group" aria-label={item.productName + " " + t("目視状態")}>
            {(Object.keys(labels) as InventoryQuickCheckStatus[]).map(status => <button key={status} type="button" data-quick-status={status} aria-pressed={currentStatus === status} className={currentStatus === status ? styles.selected : ""} disabled={!item.canQuickCheck || !item.quickCheckBasis || saving} onClick={() => choose(item, status)}>{currentStatus === status ? <Check size={15} /> : null}{t(labels[status])}</button>)}
          </div>
          {currentEstimate ? <small className={styles.estimateLabel}>{estimateLabel(currentEstimate)}</small> : null}
          {check && !draft && check.state !== "superseded" ? <small className={styles.checked}>{t("目視")} {time(check.checkedAt)} · {check.checkedBy}{check.state === "recheck" ? " · " + t("到着・時間経過などのため再確認") : ""}</small> : null}
          {item.canQuickCheck ? <details className={styles.estimate}><summary>{t("袋数などの目安を付ける（任意）")}</summary>
            <p>{t("状態を選んでから入力します。目安は実数棚卸や帳簿数量を書き換えません。")}</p>
            <div className={styles.estimateControls}><label><span>{t("目安の購入単位数")}</span><input inputMode="decimal" aria-label={item.productName + " " + t("目安の購入単位数")} disabled={!draft || saving || !purchaseUnit} value={estimateInputs[item.id] ?? ""} placeholder="2.5" aria-invalid={Boolean(estimateInputs[item.id]?.trim() && parseInventoryCountQuantity(estimateInputs[item.id]) === null)} onChange={event => { const value = event.target.value; setEstimateInputs(current => ({ ...current, [item.id]: value })); if (!value.trim()) estimate(item, null); else if (parseInventoryCountQuantity(value) !== null) estimate(item, value); }} /><small>{purchaseUnit}</small></label>
              <button type="button" className="text-button" disabled={!draft || saving || !purchaseUnit || Boolean(estimateInputs[item.id]?.trim() && parseInventoryCountQuantity(estimateInputs[item.id]) === null)} onClick={() => { const amount = (parseInventoryCountQuantity(estimateInputs[item.id]) ?? (draft?.estimate?.kind === "quantity" ? draft.estimate.quantity : 0)) + 1; setEstimateInputs(current => ({ ...current, [item.id]: String(amount) })); estimate(item, String(amount)); }}><Plus size={14} />{t("1単位を追加")}</button>
              <button type="button" className="text-button" disabled={!draft || saving || !purchaseUnit || Boolean(estimateInputs[item.id]?.trim() && parseInventoryCountQuantity(estimateInputs[item.id]) === null)} onClick={() => { const amount = (parseInventoryCountQuantity(estimateInputs[item.id]) ?? (draft?.estimate?.kind === "quantity" ? draft.estimate.quantity : 0)) + 0.5; setEstimateInputs(current => ({ ...current, [item.id]: String(amount) })); estimate(item, String(amount)); }}>{t("約半分を追加")}</button>
              <button type="button" className="text-button" disabled={!draft || saving} onClick={() => { estimate(item, "small"); setEstimateInputs(current => ({ ...current, [item.id]: "" })); }}>{t("少量")}</button>
              <button type="button" className="text-button" disabled={!draft || saving} onClick={() => { estimate(item, null); setEstimateInputs(current => ({ ...current, [item.id]: "" })); }}><Minus size={14} />{t("目安を外す")}</button>
            </div></details> : null}
        </article>;
      })}
    </div>
    {canEdit ? <div className={styles.saveBar}><span>{t("この表示で未保存 {count} 件", { count: visibleDrafts.length })}{draftList.length > visibleDrafts.length ? " · " + t("別の表示に未保存 {count} 件", { count: draftList.length - visibleDrafts.length }) : ""}</span>
      <button type="button" className="text-button" disabled={saving || !visibleDrafts.length} onClick={() => { const ids = new Set(items.map(item => item.id)); setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id)))); setSaveError(""); }}>{t("この表示の未保存を外す")}</button>
      {invalidEstimateInputs ? <span className={styles.error}>{t("目安は0以上の数量で入力してください。")}</span> : null}
      <button type="button" className="primary-button" disabled={saving || !visibleDrafts.length || staleDrafts.length > 0 || visibleDrafts.length > 500 || invalidEstimateInputs} onClick={() => void save()}><Save size={16} />{t(saving ? "保存中..." : "確認した状態を保存")}</button>
    </div> : null}
  </section>;
}
