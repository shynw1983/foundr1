"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import { isInventoryMappedOptionAllowed, type InventoryOrderUsageResponse } from "../lib/inventory-order-usage-policy";
import { parseInventoryCountQuantity } from "../lib/product-unit-conversions";
import styles from "./InventoryOperations.module.css";

type PendingSource = NonNullable<InventoryOrderUsageResponse["pendingSources"]>[number];
type OptionTarget = NonNullable<InventoryOrderUsageResponse["optionTargets"]>[number];
type DraftOption = { rawName: string; originalQuantity: number | null; id: string; quantity: string; added?: boolean };
type DraftItem = { sourceItemId: string; rawName: string; rawSpecifications: string[]; originalQuantity: number | null; menuCatalogItemId: string; quantity: string; options: DraftOption[]; measuredQuantity: string; measuredUnit: string };
type SourceDraft = { source: PendingSource; rows: DraftItem[]; preparedAt: string };
export function createInventorySourceMappingDraft(source: PendingSource): SourceDraft {
  return { source, preparedAt: "", rows: source.items.map(item => ({ sourceItemId: item.sourceItemId, rawName: item.rawName, rawSpecifications: item.rawSpecifications ?? [], originalQuantity: item.quantity, menuCatalogItemId: "", quantity: "", options: item.rawOptions.map(option => ({ rawName: option.name, originalQuantity: option.quantity, id: "", quantity: "" })), measuredQuantity: "", measuredUnit: "" })) };
}
export function confirmedInventorySourcePreparedAt(value: string, now = Date.now()) {
  if (!value.trim()) return null;
  const time = new Date(value).getTime(); return Number.isFinite(time) && time <= now ? new Date(time).toISOString() : null;
}
export function inventorySourceMappedItems(draft: SourceDraft, menuIds: Set<string>, optionAllowed: (optionId: string, menuId: string) => boolean) {
  const servingQuantity = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  if (!draft.rows.length) return null;
  const items = draft.rows.map(row => {
    const quantity = servingQuantity(row.quantity), measuredQuantity = row.measuredQuantity.trim() ? parseInventoryCountQuantity(row.measuredQuantity) : null;
    if (!menuIds.has(row.menuCatalogItemId) || quantity === null || (row.measuredQuantity.trim() && (measuredQuantity === null || measuredQuantity <= 0 || !row.measuredUnit.trim()))) return null;
    const options = row.options.map(option => { const count = servingQuantity(option.quantity); return optionAllowed(option.id, row.menuCatalogItemId) && count !== null ? { id: option.id, quantity: count } : null; });
    if (options.some(option => option === null)) return null;
    const combined = new Map<string, number>(); for (const option of options) if (option) { const count = (combined.get(option.id) ?? 0) + option.quantity; if (!Number.isSafeInteger(count)) return null; combined.set(option.id, count); }
    return { sourceItemId: row.sourceItemId, menuCatalogItemId: row.menuCatalogItemId, quantity, options: [...combined].map(([id, quantity]) => ({ id, quantity })), ...(measuredQuantity !== null ? { measuredQuantity, measuredUnit: row.measuredUnit.trim() } : {}) };
  });
  return items.some(item => item === null) ? null : items;
}

export function OrderUsageSourceMapper({ storeId, data, onMapped, onReload }: { storeId: string; data: InventoryOrderUsageResponse; onMapped?: () => void; onReload?: () => Promise<InventoryOrderUsageResponse | undefined> }) {
  const { t } = useOsTranslation();
  const [draftState, setDraftState] = useState<{ storeId: string; draft: SourceDraft } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflicted, setConflicted] = useState(false);
  const currentStore = useRef(storeId); currentStore.current = storeId; const savingRef = useRef(false);
  useEffect(() => { setDraftState(null); setConfirmed(false); setSaving(false); setError(""); setNotice(""); setConflicted(false); }, [storeId]);
  const sources = data.settings.storeId === storeId ? data.pendingSources ?? [] : [];
  const draft = draftState?.storeId === storeId ? draftState.draft : null;
  const currentSource = sources.find(source => source.orderId === draft?.source.orderId);
  const sourceChanged = Boolean(draft && (!currentSource || JSON.stringify(currentSource.expectedSourceSnapshot) !== JSON.stringify(draft.source.expectedSourceSnapshot)));
  const menuTargets = data.menuTargets ?? [], optionTargets = data.optionTargets ?? [];
  function allowedOptions(menuId: string): OptionTarget[] {
    const target = menuTargets.find(menu => menu.id === menuId);
    return target ? optionTargets.filter(option => isInventoryMappedOptionAllowed(option, target)) : [];
  }
  const mappedItems = draft ? inventorySourceMappedItems(draft, new Set(menuTargets.map(menu => menu.id)), (id, menuId) => allowedOptions(menuId).some(option => option.id === id)) : null;
  const confirmedPreparedAt = draft?.source.requiresPreparationTime ? confirmedInventorySourcePreparedAt(draft.preparedAt) : null;
  const preparationReady = !draft?.source.requiresPreparationTime || Boolean(confirmedPreparedAt);
  const locked = saving || conflicted || sourceChanged;
  function choose(source: PendingSource) { setDraftState({ storeId, draft: createInventorySourceMappingDraft(source) }); setConfirmed(false); setConflicted(false); setError(""); setNotice(""); }
  function changeRow(index: number, update: Partial<DraftItem>) { if (!draft) return; setDraftState({ storeId, draft: { ...draft, rows: draft.rows.map((row, i) => i === index ? { ...row, ...update } : row) } }); setConfirmed(false); setError(""); setNotice(""); }
  async function save() {
    if (!data.canManage || !draft || !mappedItems || !confirmed || !preparationReady || locked || savingRef.current) return;
    const submittedStore = storeId; savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory/order-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "map_source", storeId, orderId: draft.source.orderId, expectedSourceSnapshot: draft.source.expectedSourceSnapshot, mappedItems, confirmOriginalOrder: true, ...(draft.source.requiresPreparationTime ? { confirmedPreparedAt } : {}) }) });
      const body = await response.json(); if (currentStore.current !== submittedStore) return;
      if (!response.ok) { if (response.status === 409) setConflicted(true); throw new Error(body.error || "原注文の対応付けを保存できませんでした。"); }
      setDraftState(null); setConfirmed(false); setNotice("原注文の商品・選択肢・数量を確認しました。使用量は注文連動の設定に従って記録します。"); onMapped?.();
    } catch (failure) { if (currentStore.current === submittedStore) setError(failure instanceof Error ? failure.message : "原注文の対応付けを保存できませんでした。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  if (!data.canManage || (!sources.length && !draft)) return null;
  return <div className={styles.body} data-order-usage-source-mapper="" data-i18n-ignore>
    <strong>{t("外部注文の商品・数量を確認")}</strong>
    <p className={styles.hint}>{t("名前だけでは商品を推測しません。外部の原注文の番号・日時・明細の順序を照合し、メニュー・すべての選択肢・数量を明示してください。取込数量には仮の値が含まれる場合があります。")}</p>
    {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}{notice ? <p className={styles.notice} role="status">{t(notice)}</p> : null}
    <label className={styles.label}><span>{t("確認する外部注文")}</span><select name="mappingOrderId" value={draft?.source.orderId ?? ""} disabled={saving} onChange={event => { const source = sources.find(source => source.orderId === event.target.value); if (source) choose(source); else { setDraftState(null); setConfirmed(false); } }}><option value="">{t("選択してください")}</option>{sources.map(source => <option key={source.orderId} value={source.orderId}>{source.orderNo} · {source.orderSource}</option>)}{draft && !currentSource ? <option value={draft.source.orderId}>{draft.source.orderNo} · {t("最新の状態を確認してください")}</option> : null}</select></label>
    {draft ? <>
      <p className={styles.hint}>{t("原注文の記録日時")} · {draft.source.orderedAt ? new Date(draft.source.orderedAt).toLocaleString() : t("未確認")}</p>
      {draft.source.requiresPreparationTime ? <label className={styles.label}><span>{t("原注文で確認した実際の調理開始日時")}</span><input name="mappingConfirmedPreparedAt" type="datetime-local" step="1" value={draft.preparedAt} disabled={locked} onChange={event => { setDraftState({ storeId, draft: { ...draft, preparedAt: event.target.value } }); setConfirmed(false); }} /><small>{t("この端末の時刻で入力します。取込時刻は使いません。未来の時刻は登録できません。")}</small>{draft.preparedAt && !confirmedPreparedAt ? <small className={styles.warning}>{t("実際の調理開始日時を、現在以前の有効な日時で入力してください。")}</small> : null}</label> : <p className={styles.hint}>{t("記録された調理開始日時")} · {draft.source.firstPreparedAt ? new Date(draft.source.firstPreparedAt).toLocaleString() : t("未確認")}</p>}
      {conflicted || sourceChanged ? <div className={styles.warning}><p>{t("原注文または対応付けが変わりました。入力は残しています。最新の原注文を読み込み直してください。")}</p><button type="button" className="secondary-button" disabled={saving} onClick={() => { const requestedStore = storeId, orderId = draft.source.orderId; void onReload?.().then(latest => { if (currentStore.current !== requestedStore || !latest) return; const source = latest.pendingSources?.find(source => source.orderId === orderId); if (source) choose(source); else { setDraftState(null); setConflicted(false); setNotice("この注文は確認済み、または現在の確認対象ではありません。最近の使用記録を確認してください。"); } }); }}>{t("入力を破棄して最新の原注文を読み込む")}</button></div> : null}
      {draft.rows.map((row, index) => <article className={styles.card} key={row.sourceItemId}>
        <strong>{row.rawName || t("名称未確認の明細")}</strong><small className={styles.muted}>{t("取込数量（参考）")} · {row.originalQuantity ?? t("未確認")}</small>
        {row.rawSpecifications.length ? <div className={styles.card}><small>{t("取り込まれた仕様（参考）")}</small>{row.rawSpecifications.map((specification, specificationIndex) => <span key={specificationIndex}>{specification}</span>)}</div> : null}
        <div className={styles.fields}><label><span>{t("原注文に対応するメニュー")}</span><select name={`mappingMenu-${index}`} value={row.menuCatalogItemId} disabled={locked} onChange={event => changeRow(index, { menuCatalogItemId: event.target.value, options: row.options.map(option => ({ ...option, id: "" })) })}><option value="">{t("選択してください")}</option>{menuTargets.map(menu => <option key={menu.id} value={menu.id}>{[menu.brandName, menu.category, menu.name].filter(Boolean).join(" · ")}</option>)}</select></label><label><span>{t("原注文で確認した食数")}</span><input name={`mappingQuantity-${index}`} inputMode="numeric" value={row.quantity} disabled={locked} placeholder={t("原注文を確認して入力")} onChange={event => changeRow(index, { quantity: event.target.value })} /></label></div>
        <button type="button" className="secondary-button" disabled={locked || row.originalQuantity === null || !Number.isInteger(row.originalQuantity) || row.originalQuantity <= 0} onClick={() => changeRow(index, { quantity: String(row.originalQuantity), options: row.options.map(option => ({ ...option, quantity: option.originalQuantity !== null && Number.isInteger(option.originalQuantity) && option.originalQuantity > 0 ? String(option.originalQuantity) : option.quantity })) })}>{t("原注文と照合して取込数量を入力")}</button>
        {row.options.map((option, optionIndex) => <div className={styles.card} key={optionIndex}><small>{option.rawName || t("原注文の選択肢を追加")} · {t("取込数量（参考）")} {option.originalQuantity ?? t("未確認")}</small><div className={styles.fields}><label><span>{t("対応する選択肢")}</span><select name={`mappingOption-${index}-${optionIndex}`} value={option.id} disabled={locked || !row.menuCatalogItemId} onChange={event => changeRow(index, { options: row.options.map((item, i) => i === optionIndex ? { ...item, id: event.target.value } : item) })}><option value="">{t("選択してください")}</option>{allowedOptions(row.menuCatalogItemId).map(target => <option key={target.id} value={target.id}>{target.groupName} · {target.name}</option>)}</select></label><label><span>{t("1食あたりの選択数")}</span><input name={`mappingOptionQuantity-${index}-${optionIndex}`} inputMode="numeric" value={option.quantity} disabled={locked} onChange={event => changeRow(index, { options: row.options.map((item, i) => i === optionIndex ? { ...item, quantity: event.target.value } : item) })} /></label></div>{option.added ? <button type="button" className="text-button" disabled={locked} onClick={() => changeRow(index, { options: row.options.filter((_, i) => i !== optionIndex) })}>{t("追加した選択肢を削除")}</button> : null}</div>)}
        <button type="button" className="secondary-button" disabled={locked || !row.menuCatalogItemId} onClick={() => changeRow(index, { options: [...row.options, { rawName: "", originalQuantity: null, id: "", quantity: "", added: true }] })}>{t("原注文にある選択肢を追加")}</button>
        <details className={styles.detail}><summary>{t("原注文の実測数量がある場合")}</summary><div className={styles.fields}><label><span>{t("原注文で確認した実測数量")}</span><input name={`mappingMeasuredQuantity-${index}`} inputMode="decimal" value={row.measuredQuantity} disabled={locked} onChange={event => changeRow(index, { measuredQuantity: event.target.value })} /></label><label><span>{t("原注文の実測単位")}</span><input name={`mappingMeasuredUnit-${index}`} maxLength={64} value={row.measuredUnit} disabled={locked} onChange={event => changeRow(index, { measuredUnit: event.target.value })} /></label><p className={`${styles.hint} ${styles.wide}`}>{t("実測値がない場合は空欄にします。食数や商品名から重量を作りません。")}</p></div></details>
      </article>)}
      <label className={styles.check}><input name="mappingOriginalConfirmed" type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} /><span>{t(draft.source.requiresPreparationTime ? "原注文の番号・日時、実際の調理開始時刻と、すべての商品・選択肢・数量を照合しました" : "原注文の番号・日時と、すべての商品・選択肢・数量を照合しました")}</span></label>
      <p className={styles.hint}>{t("この確認は対象の注文だけに適用します。同じ商品名の別注文へ自動で対応付けません。")}</p>
      <div className={styles.actions}><button type="button" className="primary-button" disabled={locked || !mappedItems || !confirmed || !preparationReady} onClick={() => void save()}>{t(saving ? "保存中..." : "この原注文の対応付けを保存")}</button></div>
    </> : null}
  </div>;
}
