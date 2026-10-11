"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import { normalizeInventoryCountInput } from "../lib/inventory-count-input-policy";
import { formatInventoryCountQuantity, resolveProductUnitConversion, type ProductUnitConversionSnapshot } from "../lib/product-unit-conversions";
import type { InventoryCountReconciliation } from "../lib/inventory-usage-policy";
import type { QuickInventoryItem } from "./QuickInventoryList";
import styles from "../app/store/components/StoreInventoryExecution.module.css";

export type StoreInventoryItem = QuickInventoryItem & { productId: string; category: string; locationId: string; countUnit: string; currentQuantity: number | null; lastCountedQuantity: number | null; stockRevision: number; currentConversion: ProductUnitConversionSnapshot | null; unitChoices: ProductUnitConversionSnapshot[]; lastCountedLabel?: string; lastCountedBy?: string };
type Basis = Pick<StoreInventoryItem, "countUnit" | "stockRevision" | "currentConversion" | "unitChoices" | "currentQuantity"> & { unitConfiguration: NonNullable<StoreInventoryItem["quickCheckBasis"]>["unitConfiguration"] | null };
type Draft = { text: string; inputUnit: string; basis: Basis };
export type StoreCountSubmission = { action: "count"; storeId: string; itemId: string; quantity: number; inputUnit: string; countUnit: string; expectedConversion: ProductUnitConversionSnapshot | null; expectedInputConversion: ProductUnitConversionSnapshot | null; expectedStockRevision: number; expectedOperatorId: string };
export type StoreCountResult = { ok: boolean; error?: string; reconciliation?: InventoryCountReconciliation | null };
const basisFor = (item: StoreInventoryItem): Basis => ({ countUnit: item.countUnit, stockRevision: item.stockRevision, currentConversion: item.currentConversion, unitChoices: item.unitChoices, currentQuantity: item.currentQuantity, unitConfiguration: item.quickCheckBasis?.unitConfiguration ?? null });
const keyFor = (scope: string) => `foundr1-store:count-drafts:v1:${scope}`;
export function StoreInventoryCountList({ storeId, items, canOperate, expectedOperatorId, draftScopeKey, saving, onSave, onReport }: {
  storeId: string; items: StoreInventoryItem[]; canOperate: boolean; expectedOperatorId: string; draftScopeKey: string; saving: boolean;
  onSave: (payload: StoreCountSubmission) => Promise<StoreCountResult>;
  onReport: (item: StoreInventoryItem, code: "damaged" | "quality" | "too_much", note: string) => Promise<void>;
}) {
  const { t, language } = useOsTranslation();
  const [state, setState] = useState<{ scope: string; drafts: Record<string, Draft> }>({ scope: "", drafts: {} });
  const [errors, setErrors] = useState<Record<string, string>>({}), [notices, setNotices] = useState<Record<string, string | { difference: number; unit: string }>>({}), [notes, setNotes] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const currentScope = useRef(draftScopeKey); currentScope.current = draftScopeKey;
  useEffect(() => {
    let drafts: Record<string, Draft> = {};
    try { const raw = JSON.parse(localStorage.getItem(keyFor(draftScopeKey)) || "{}"); if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [id, draft] of Object.entries(raw)) { const d = draft as Draft; if (typeof d.text === "string" && typeof d.inputUnit === "string" && d.basis && Number.isInteger(d.basis.stockRevision)) drafts[id] = d; } } catch { /* An invalid local draft is never submitted. */ }
    setState({ scope: draftScopeKey, drafts }); setErrors({}); setNotices({}); setNotes({});
  }, [draftScopeKey]);
  useEffect(() => {
    if (state.scope !== draftScopeKey || !expectedOperatorId) return;
    try { if (Object.keys(state.drafts).length) localStorage.setItem(keyFor(draftScopeKey), JSON.stringify(state.drafts)); else localStorage.removeItem(keyFor(draftScopeKey)); } catch { setErrors(current => ({ ...current, storage: "入力をこの端末に保存できません。画面を閉じずに保存してください。" })); }
  }, [state, draftScopeKey, expectedOperatorId]);
  const drafts = state.scope === draftScopeKey ? state.drafts : {};
  const format = (quantity: number | null, unit: string) => quantity === null ? t("未確認") : `${quantity < 0 ? "−" : ""}${formatInventoryCountQuantity(Math.abs(quantity), language)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
  function update(item: StoreInventoryItem, patch: Partial<Draft>) {
    setErrors(current => ({ ...current, [item.id]: "" })); setNotices(current => ({ ...current, [item.id]: "" }));
    setState(current => ({ scope: draftScopeKey, drafts: { ...(current.scope === draftScopeKey ? current.drafts : {}), [item.id]: { text: "", inputUnit: item.countUnit, basis: basisFor(item), ...(current.scope === draftScopeKey ? current.drafts[item.id] : {}), ...patch } } }));
  }
  function entered(draft: Draft) {
    return normalizeInventoryCountInput(draft.text, draft.inputUnit, draft.basis.countUnit, draft.basis.unitConfiguration ?? { unit: draft.basis.countUnit });
  }
  async function save(item: StoreInventoryItem) {
    const draft = drafts[item.id];
    if (!canOperate || !expectedOperatorId || saving || submitting.current || !draft || JSON.stringify(draft.basis) !== JSON.stringify(basisFor(item))) return;
    let parsed; try { parsed = entered(draft); } catch (failure) { setErrors(current => ({ ...current, [item.id]: failure instanceof Error ? failure.message : "数量を確認してください。" })); return; }
    const scope = draftScopeKey; submitting.current = true;
    try {
      const result = await onSave({ action: "count", storeId, itemId: item.id, quantity: parsed.enteredQuantity, inputUnit: draft.inputUnit, countUnit: draft.basis.countUnit, expectedConversion: draft.basis.currentConversion, expectedInputConversion: draft.basis.unitConfiguration ? resolveProductUnitConversion(draft.basis.unitConfiguration, draft.inputUnit) : null, expectedStockRevision: draft.basis.stockRevision, expectedOperatorId });
      if (currentScope.current !== scope) return;
      if (!result.ok) { setErrors(current => ({ ...current, [item.id]: result.error || "在庫情報を保存できませんでした。" })); return; }
      const remaining = { ...drafts }; delete remaining[item.id];
      try { if (Object.keys(remaining).length) localStorage.setItem(keyFor(scope), JSON.stringify(remaining)); else localStorage.removeItem(keyFor(scope)); } catch { /* The server count remains authoritative. */ }
      setState(current => ({ ...current, drafts: Object.fromEntries(Object.entries(current.drafts).filter(([id]) => id !== item.id)) }));
      const reconciliation = result.reconciliation;
      setNotices(current => ({ ...current, [item.id]: reconciliation?.difference !== null && reconciliation?.difference !== undefined ? { difference: reconciliation.difference, unit: reconciliation.countUnit } : "棚卸を保存しました。" }));
    } finally { submitting.current = false; }
  }
  return <div className={styles.rows} data-store-count-list data-i18n-ignore>{errors.storage ? <p role="alert" className={styles.error}>{t(errors.storage)}</p> : null}{items.map(item => {
    const draft = drafts[item.id], notice = notices[item.id], stale = Boolean(draft && JSON.stringify(draft.basis) !== JSON.stringify(basisFor(item)));
    let preview: number | null = null, validationMessage = ""; if (draft?.text.trim()) try { preview = entered(draft).quantity; } catch (failure) { validationMessage = failure instanceof Error ? failure.message : "数量を確認してください。"; }
    const choices = [...new Set([item.countUnit, ...item.unitChoices.map(choice => choice.countUnit), draft?.inputUnit].filter((unit): unit is string => Boolean(unit)))];
    return <article key={item.id} className={styles.card} data-store-count-item={item.id}>
      <div className={styles.heading}><strong>{item.productName}</strong><span>{item.locationName}</span></div>
      <div className={styles.metrics}><span><small>{t("現在庫（帳簿）")}</small><strong>{format(item.currentQuantity, item.countUnit)}</strong></span><span><small>{t(item.stockRevision > 0 ? "最終棚卸数量" : "元の記録数量")}</small><span>{format(item.lastCountedQuantity, item.countUnit)}</span></span></div>
      {item.stockRevision > 0 && item.lastCountedLabel ? <small className={styles.hint}>{item.lastCountedLabel} · {item.lastCountedBy}</small> : null}
      <form className={styles.countForm} onSubmit={event => { event.preventDefault(); void save(item); }}>
        <label>{t("実数入力")}<input name={`countQuantity-${item.id}`} inputMode="decimal" value={draft?.text ?? ""} placeholder={t("例：0.5、10、1/4")} disabled={!canOperate || saving} onChange={event => update(item, { text: event.target.value })} /></label>
        <label>{t("入力単位")}<select name={`countUnit-${item.id}`} value={draft?.inputUnit ?? item.countUnit} disabled={!canOperate || saving} onChange={event => update(item, { inputUnit: event.target.value })}>{choices.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        <button type="submit" className="primary-button" disabled={!canOperate || saving || stale || preview === null}>{t("数えて保存")}</button>
      </form>
      {preview !== null && draft ? <p className={styles.hint}>{t("棚卸単位に換算：{quantity} {unit}", { quantity: formatInventoryCountQuantity(preview, language) + (draft.basis.countUnit.startsWith("1/") ? " ×" : ""), unit: draft.basis.countUnit })}{draft.basis.currentQuantity !== null ? <> · {t("確認差異")} {format(preview - draft.basis.currentQuantity, draft.basis.countUnit)}</> : null}</p> : null}
      {validationMessage ? <p className={styles.error}>{t(validationMessage)}</p> : null}
      {stale ? <div><p className={styles.hint}>{t("在庫または単位が更新されました。入力は残しています。最新の内容を確認してください。")}</p><button type="button" className="secondary-button" disabled={!canOperate || saving} onClick={() => { const changedUnits = JSON.stringify(draft?.basis.unitConfiguration) !== JSON.stringify(item.quickCheckBasis?.unitConfiguration ?? null) || draft?.basis.countUnit !== item.countUnit; update(item, { basis: basisFor(item), ...(changedUnits ? { text: "", inputUnit: item.countUnit } : {}) }); }}>{t("最新の数量・単位を確認して数え直す")}</button></div> : null}
      {errors[item.id] ? <p role="alert" className={styles.error}>{t(errors[item.id])}</p> : null}{notice ? <p role="status" className={styles.notice}>{typeof notice === "string" ? t(notice) : t("棚卸を保存しました。帳簿との差異：{difference}（原因は要確認）", { difference: format(notice.difference, notice.unit) })}</p> : null}
      <details className={styles.detail}><summary>{t("破損・品質・過剰を報告")}</summary><label>{t("現場メモ")}<input className={styles.search} name={`exceptionNote-${item.id}`} value={notes[item.id] ?? ""} disabled={!canOperate || saving} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} /></label><div className={styles.actions}>{(["damaged", "quality", "too_much"] as const).map(code => <button key={code} type="button" className="secondary-button" disabled={!canOperate || saving} onClick={() => void onReport(item, code, notes[item.id] ?? "")}>{t(code === "damaged" ? "破損" : code === "quality" ? "品質異常" : "多すぎ")}</button>)}</div></details>
    </article>;
  })}</div>;
}
