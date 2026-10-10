"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import type { InventoryOrderUsageRequest, InventoryOrderUsageResponse } from "../lib/inventory-order-usage-policy";
import type { InventoryUsageResponse } from "../lib/inventory-usage-policy";
import { formatInventoryCountQuantity } from "../lib/product-unit-conversions";
import { InventoryRecipeEditor } from "./InventoryRecipeEditor";
import { OrderUsageSourceMapper } from "./OrderUsageSourceMapper";
import { useInventoryReadModel } from "./useInventoryOperations";
import styles from "./InventoryOperations.module.css";

export const inventoryUsageReasonLabels: Record<string, string> = {
  anchor_missing: "数量の基準になる棚卸がありません。", book_unknown: "現在庫の数量が未確認です。", unmapped_orders: "使用量を計算できない注文があります。",
  unit_changed: "単位が変わったため数量を比較できません。", movement_unknown: "数量未確認の入出庫があります。", prediction_basis_missing: "予測の根拠となる配合や棚卸の比較がありません。", prediction_partial: "未対応の注文があるため予測は一部のみです。",
  recipe_missing: "メニューの配合が未設定です。", measured_basis_unknown: "注文の実測数量・単位を確認してください。", recipe_product_scope_changed: "配合の商品と店舗の適用範囲を確認してください。",
  usage_location_ambiguous: "使用する保管場所を選択してください。", usage_location_missing: "使用する商品の保管場所がありません。", stock_conversion_changed: "棚卸と現在の単位対応が異なります。", conversion_unknown: "商品の単位対応を確認してください。",
  source_identity_unresolved: "注文の商品識別を確認してください。", source_not_ready: "注文の商品明細を確認中です。", processing_failed: "使用量の記録に失敗しました。内容を確認して再確認してください。"
};
export type InventoryUsagePanelProps = { storeId: string; refreshKey?: unknown; onChanged?: () => void };
type SettingsDraft = Pick<InventoryOrderUsageResponse["settings"], "storeId" | "enabled" | "revision">;
const settingsDraft = (settings: InventoryOrderUsageResponse["settings"]): SettingsDraft => ({ storeId: settings.storeId, enabled: settings.enabled, revision: settings.revision });
export function InventoryUsagePanel({ storeId, refreshKey, onChanged }: InventoryUsagePanelProps) {
  const { t, language } = useOsTranslation();
  const [open, setOpen] = useState(false), [recipeOpen, setRecipeOpen] = useState(false);
  const usage = useInventoryReadModel<InventoryUsageResponse>(`/api/inventory/usage?storeId=${encodeURIComponent(storeId)}`, storeId, open, refreshKey);
  const operations = useInventoryReadModel<InventoryOrderUsageResponse>(`/api/inventory/order-usage?storeId=${encodeURIComponent(storeId)}`, storeId, open, refreshKey);
  const [setting, setSetting] = useState<SettingsDraft | null>(null);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [stale, setStale] = useState(false);
  const currentStore = useRef(storeId); currentStore.current = storeId; const savingRef = useRef(false);
  useEffect(() => { setSetting(null); setLocations({}); setConfirmed(false); setError(""); setNotice(""); setStale(false); setBusy(false); setRecipeOpen(false); }, [storeId]);
  useEffect(() => { if (operations.data && !setting) setSetting(settingsDraft(operations.data.settings)); }, [operations.data, setting]);
  const data = operations.data?.settings.storeId === storeId ? operations.data : null;
  const usageData = usage.data?.selectedStoreId === storeId ? usage.data : null;
  const draft = setting?.storeId === storeId ? setting : null;
  const quantity = (value: number | null, unit: string) => value === null ? t("未確認") : `${value < 0 ? "−" : ""}${formatInventoryCountQuantity(Math.abs(value), language)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(language) : t("未確認");
  async function save(payload: InventoryOrderUsageRequest) {
    if (!data?.canManage || savingRef.current || stale) return;
    const savedStore = storeId; savingRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory/order-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json(); if (currentStore.current !== savedStore) return;
      if (!response.ok) { if (response.status === 409) setStale(true); throw new Error(body.error || "注文の在庫連動を保存できませんでした。"); }
      setNotice(payload.action === "retry" ? "未処理の注文を再確認しました。" : "注文の在庫連動を保存しました。"); setLocations({}); setConfirmed(false);
      const [, latest] = await Promise.all([usage.load(), operations.load()]); if (latest && currentStore.current === savedStore) setSetting(settingsDraft(latest.settings)); onChanged?.();
    } catch (failure) { if (currentStore.current === savedStore) setError(failure instanceof Error ? failure.message : "注文の在庫連動を保存できませんでした。"); }
    finally { savingRef.current = false; setBusy(false); }
  }
  return <details className={styles.panel} open={open} onToggle={event => setOpen(event.currentTarget.open)} data-inventory-usage-panel="" data-i18n-ignore>
    <summary>{t("注文と在庫・次の棚卸の確認")}</summary>
    {open ? <div className={styles.body}>
      <div className={styles.heading}><p className={styles.hint}>{t("棚卸を起点に、入庫と注文の標準使用量をつなぎます。次の棚卸との差は確認差異で、損耗として自動登録しません。")}</p><button type="button" className="text-button" disabled={busy || usage.loading || operations.loading} onClick={() => void Promise.all([usage.load(), operations.load()])}>{t("更新")}</button></div>
      <p className={styles.hint}>{t("帳簿上の数量には、仕込みの投入・店舗への出庫など、ほかの入出庫記録も含まれます。")}</p>
      {error || usage.error || operations.error ? <p className={styles.error} role="alert">{t(error || usage.error || operations.error)}</p> : null}{notice ? <p className={styles.notice} role="status">{t(notice)}</p> : null}
      {stale ? <div className={styles.warning}><p>{t("設定が変更されました。入力は残しています。最新の設定を読み込み直してください。")}</p><button type="button" className="secondary-button" disabled={busy || operations.loading} onClick={() => { const requestedStore = storeId; void operations.load().then(latest => { if (!latest || currentStore.current !== requestedStore) return; setSetting(settingsDraft(latest.settings)); setLocations({}); setConfirmed(false); setStale(false); setError(""); }); }}>{t("入力を破棄して最新の設定を読み込む")}</button></div> : null}
      {usageData?.items.map(item => <article className={styles.card} key={item.inventoryItemId}>
        <div className={styles.heading}><strong>{item.productName}</strong><span className={styles.muted}>{item.locationName} · {t(item.confidence === "confirmed" ? "数量記録から計算" : item.confidence === "estimated" ? "予測を含む" : "未確認の情報あり")}</span></div>
        <div className={styles.flow}><span>{t("起点の棚卸")} · {quantity(item.anchor?.quantity ?? null, item.countUnit)}</span><b>＋</b><span>{t("入庫")} · {quantity(item.receivedQuantity, item.countUnit)}</span><b>−</b><span>{t("注文の標準使用量")} · {quantity(item.orderDeductedQuantity, item.countUnit)}</span><b>→</b><span>{t("帳簿上の見込み数量")} · {quantity(item.bookExpectedQuantity, item.countUnit)}</span></div>
        <div className={styles.metrics}><div><span>{t("概算を含む在庫予測")}</span><strong>{quantity(item.forecastQuantity, item.countUnit)}</strong></div><div><span>{t("1日あたりの使用目安")}</span><strong>{quantity(item.dailyUsage, item.countUnit)}</strong></div><div><span>{t("残り日数の目安")}</span><strong>{item.daysRemaining === null ? t("未確認") : t("約 {days} 日", { days: formatInventoryCountQuantity(item.daysRemaining, language) })}</strong></div></div>
        <small className={styles.muted}>{t("対応済み {servings} 食・未対応 {orders} 注文", { servings: formatInventoryCountQuantity(item.coverage.mappedServings, language), orders: item.coverage.unmappedOrders })} · {t(item.forecastSource === "calibrated" ? "棚卸間の実績から予測" : item.forecastSource === "recipe" ? "設定した概算配合から予測" : item.forecastSource === "mixed" ? "配合と棚卸間の実績から予測" : "予測の追加根拠なし")}</small>
        {item.issueReasons.map(reason => <small className={styles.warning} key={reason}>{t(inventoryUsageReasonLabels[reason] ?? "関連する数量記録を確認してください。")}</small>)}
        <small className={styles.muted}>{t("基準日時")} · {date(item.anchor?.countedAt ?? null)} · {t("更新日時")} {date(item.asOf)}</small>
      </article>)}
      {usageData && !usageData.items.length ? <p>{t("在庫商品の登録後に、注文と在庫の確認ができます。")}</p> : null}
      <details className={styles.detail}><summary>{t("注文連動の設定・使用する保管場所")}</summary><div>
        {data && draft ? <><p className={styles.hint}>{t("有効にした後の注文だけを対象にします。過去の注文を現在庫からまとめて差し引きません。キャンセル後も、調理済みの使用量は戻しません。")}</p>
          <div className={styles.fields}><label><span>{t("注文と在庫の連動")}</span><select name="usageEnabled" value={String(draft.enabled)} disabled={!data.canManage || busy || stale} onChange={event => { setSetting({ ...draft, enabled: event.target.value === "true" }); setConfirmed(false); }}><option value="false">{t("無効")}</option><option value="true">{t("有効")}</option></select></label><div className={styles.label}><span>{t("標準使用量を記録するタイミング")}</span><strong>{t("実際の調理開始時")}</strong><small className={styles.hint}>{t("支払いだけでは在庫を差し引きません。")}</small></div></div>
          <p className={styles.hint}>{t("有効化の起点")} · {date(data.settings.enabledFrom)}</p>
          {data.canManage ? <><label className={styles.check}><input type="checkbox" name="usageConfirmed" checked={confirmed} disabled={busy || stale} onChange={event => setConfirmed(event.target.checked)} /><span>{t("現在の棚卸と配合・保管場所を確認しました")}</span></label><div className={styles.actions}><button type="button" className="primary-button" disabled={!confirmed || busy || stale} onClick={() => void save({ action: "settings", storeId, enabled: draft.enabled, triggerMode: "preparation", expectedRevision: draft.revision })}>{t("注文連動の設定を保存")}</button></div></> : null}
          {data.locations.map(location => <div className={styles.card} key={location.productId}><strong>{location.productName}</strong><label className={styles.label}><span>{t("使用する保管場所")}</span><select name={`usageLocation-${location.productId}`} disabled={!data.canManage || busy || stale} value={locations[location.productId] ?? location.explicitInventoryItemId ?? ""} onChange={event => setLocations(previous => ({ ...previous, [location.productId]: event.target.value }))}><option value="">{t(location.selection === "single" ? "1つの保管場所を自動使用" : "保管場所を選択してください")}</option>{location.items.map(item => <option value={item.id} key={item.id}>{item.locationName} · {item.countUnit}</option>)}</select></label>{location.selection === "ambiguous" ? <small className={styles.warning}>{t("保管場所が複数あります。使用する場所を明示してください。")}</small> : null}{data.canManage ? <div className={styles.actions}><button type="button" className="secondary-button" disabled={busy || stale || locations[location.productId] === undefined || (locations[location.productId] || null) === location.explicitInventoryItemId} onClick={() => void save({ action: "location", storeId, productId: location.productId, inventoryItemId: locations[location.productId] || null, expectedInventoryItemId: location.explicitInventoryItemId })}>{t("この商品の保管場所を保存")}</button></div> : null}</div>)}
        </> : null}
      </div></details>
      <details className={styles.detail} open={recipeOpen} onToggle={event => setRecipeOpen(event.currentTarget.open)}><summary>{t("配合・注文の使用量を確認")}</summary>{recipeOpen ? <InventoryRecipeEditor storeId={storeId} onSaved={() => { void Promise.all([usage.load(), operations.load()]); onChanged?.(); }} /> : null}</details>
      <details className={styles.detail}><summary>{t("未対応の注文・最近の使用記録")}</summary><div>
        {data?.canManage ? <OrderUsageSourceMapper storeId={storeId} data={data} onReload={() => operations.load()} onMapped={() => { void Promise.all([usage.load(), operations.load()]); onChanged?.(); }} /> : null}
        {data?.issues.filter(issue => !issue.resolvedAt).map(issue => <div key={issue.id} className={styles.warning}><strong>{issue.orderNo || t("注文")}</strong> · {t(inventoryUsageReasonLabels[issue.code] ?? "注文の数量・商品・配合を確認してください。")}</div>)}
        {data?.canManage ? <div className={styles.actions}><button type="button" className="secondary-button" disabled={busy || stale} onClick={() => void save({ action: "retry", storeId })}>{t("未処理の注文を再確認")}</button></div> : null}
        <ul className={styles.list}>{data?.recentUsage.map(record => <li key={record.id}><strong>{record.orderNo} · {date(record.occurredAt)}</strong>{record.items.map(item => <span key={item.id}>{item.productName} · {item.locationName} · {quantity(item.quantity, item.countUnit)} · {t(item.changesStock ? "帳簿へ反映" : item.confidence === "estimate" ? "概算の記録のみ" : "数量未計量の記録")}</span>)}{record.restrictedItemCount > 0 ? <small>{t("権限外の商品 {count} 件", { count: record.restrictedItemCount })}</small> : null}</li>)}</ul>
      </div></details>
      <details className={styles.detail}><summary>{t("最近の棚卸差異")}</summary><div><p className={styles.hint}>{t("差異には盛付けの変動、記録漏れ、計量誤差などが含まれます。損耗は別に確認してください。")}</p>{usageData?.recentReconciliations.map(check => <div className={styles.card} key={check.id}><strong>{check.productName} · {check.locationName}</strong><div className={styles.flow}><span>{t("見込み")} · {quantity(check.snapshot.expectedQuantity, check.snapshot.countUnit)}</span><span>{t("実際の棚卸")} · {quantity(check.snapshot.observedQuantity, check.snapshot.countUnit)}</span><span>{t("確認差異")} · {quantity(check.snapshot.difference, check.snapshot.countUnit)}</span></div><small>{date(check.snapshot.countedAt)}</small></div>)}</div></details>
    </div> : null}
  </details>;
}
