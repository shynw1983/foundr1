"use client";

import { Plus, Trash2 } from "lucide-react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { normalizeDecimalInput } from "../../../lib/number-input";
import { maxInventoryUnitConversions, normalizeInventoryUnitConversions, type ProductInventoryUnitConversion } from "../../../lib/product-unit-conversions";
import styles from "./ProductUnitConversionsEditor.module.css";

export type InventoryUnitConversionDraft = Omit<ProductInventoryUnitConversion, "unitsPerPurchase" | "fractionalDenominator"> & {
  unitsPerPurchase: number | string;
  fractionalDenominator?: number | string | null;
};
type ProductUnitReference = {
  unit: string;
  packageQuantity?: number | string | null;
  packageQuantityUnit?: string | null;
};

export function normalizeUnitConversionDrafts(rows: InventoryUnitConversionDraft[], product: ProductUnitReference) {
  return normalizeInventoryUnitConversions(rows.map((row) => ({
    unit: row.unit.trim(),
    unitsPerPurchase: row.unitsPerPurchase === "" ? null : Number(row.unitsPerPurchase),
    ...(row.fractionalDenominator !== undefined && row.fractionalDenominator !== null
      ? { fractionalDenominator: row.fractionalDenominator === "" ? null : Number(row.fractionalDenominator) } : {})
  })), product);
}

export function reconfirmUnitConversionDrafts(rows: InventoryUnitConversionDraft[], purchaseUnit: string): InventoryUnitConversionDraft[] {
  return rows.map((row) => row.fractionalDenominator !== undefined && row.fractionalDenominator !== null
    ? { ...row, unit: `1/${Number(row.fractionalDenominator)}${purchaseUnit.trim()}`, unitsPerPurchase: Number(row.fractionalDenominator) }
    : { ...row });
}

function packageReference(product: ProductUnitReference) {
  const quantity = Number(product.packageQuantity);
  const countUnit = String(product.packageQuantityUnit ?? "").trim();
  return Number.isFinite(quantity) && quantity > 0 && countUnit && countUnit !== product.unit.trim()
    ? { unit: countUnit, quantity } : null;
}

function Relation({ purchaseUnit, countUnit, quantity }: { purchaseUnit: string; countUnit: string; quantity: number | string }) {
  return <span data-i18n-ignore>1 {purchaseUnit} = {quantity}{countUnit.startsWith("1/") ? " × " : " "}{countUnit}</span>;
}

export function ProductUnitConversionsSummary({ product, compact = false, showLabel = true }: {
  product: ProductUnitReference & { inventoryUnitConversions?: ProductInventoryUnitConversion[] };
  compact?: boolean;
  showLabel?: boolean;
}) {
  const { t } = useOsTranslation();
  const reference = packageReference(product);
  const relations = product.inventoryUnitConversions ?? [];
  if (compact && !relations.length && !reference) return null;
  return <div className={compact ? styles.compact : styles.summary}>
    {showLabel ? <span className={styles.summaryLabel}>{t("使用・棚卸単位")}</span> : null}
    {relations.map((relation) => <span key={relation.unit}>
      <Relation purchaseUnit={product.unit} countUnit={relation.unit} quantity={relation.unitsPerPurchase} />
    </span>)}
    {reference && !relations.some((relation) => relation.unit === reference.unit) ? <span><Relation purchaseUnit={product.unit} countUnit={reference.unit} quantity={reference.quantity} /> <small>{t("包装規格による換算")}</small></span> : null}
    {!relations.length && !reference ? <span>{t("換算未設定")}</span> : null}
  </div>;
}

export default function ProductUnitConversionsEditor({ product, rows, requiresReconfirmation, onChange, onReconfirm }: {
  product: ProductUnitReference;
  rows: InventoryUnitConversionDraft[];
  requiresReconfirmation: boolean;
  onChange: (rows: InventoryUnitConversionDraft[]) => void;
  onReconfirm: (rows: InventoryUnitConversionDraft[]) => void;
}) {
  const { t } = useOsTranslation();
  const reference = packageReference(product);
  function updateRow(index: number, next: Partial<InventoryUnitConversionDraft>) {
    onChange(rows.map((row, position) => position === index ? { ...row, ...next } : row));
  }
  let validationError = "";
  try { normalizeUnitConversionDrafts(rows, product); } catch (error) {
    validationError = error instanceof Error ? error.message : "使用・棚卸単位と換算数量を確認してください。";
  }
  return <fieldset className={styles.editor}>
    <legend>{t("使用・棚卸単位")}</legend>
    <p>{t("1発注・購入単位に含まれる数量を登録します。数量や単位は自動で推測しません。")}</p>
    <p><span>{t("発注・購入単位")}</span>: <strong data-i18n-ignore>{product.unit || "—"}</strong></p>
    {rows.map((row, index) => {
      const fractional = row.fractionalDenominator !== undefined && row.fractionalDenominator !== null;
      return <div className={styles.row} key={index}>
        <label><span>{t("登録方法")}</span>
          <select value={fractional ? "fraction" : "unit"} onChange={(event) => updateRow(index, event.target.value === "fraction"
            ? { unit: "", unitsPerPurchase: "", fractionalDenominator: "" }
            : { unit: "", unitsPerPurchase: "", fractionalDenominator: null })}>
            <option value="unit">{t("自由な単位")}</option>
            <option value="fraction">{t("分割単位")}</option>
          </select>
        </label>
        <label><span>{t(fractional ? "分割数" : "棚卸・使用単位")}</span>
          {fractional ? <input inputMode="numeric" value={row.fractionalDenominator ?? ""} placeholder={t("例: 4")}
            onChange={(event) => {
              const value = normalizeDecimalInput(event.target.value);
              updateRow(index, { fractionalDenominator: value, unitsPerPurchase: value, unit: value ? `1/${Number(value)}${product.unit.trim()}` : "" });
            }} />
            : <input value={row.unit} placeholder={t("例: 個、杯")}
              onChange={(event) => updateRow(index, { unit: event.target.value })} />}
        </label>
        <label><span>{t(fractional ? "生成される単位" : "1発注・購入単位あたりの数量")}</span>
          {fractional ? <input value={row.unit} readOnly aria-label={t("生成される単位")} />
            : <input inputMode="decimal" value={row.unitsPerPurchase} placeholder={t("例: 20")}
              onChange={(event) => updateRow(index, { unitsPerPurchase: normalizeDecimalInput(event.target.value) })} />}
        </label>
        <button type="button" className="text-button danger-button" aria-label={t("換算を削除")}
          onClick={() => onChange(rows.filter((_, position) => position !== index))}><Trash2 size={15} /><span>{t("削除")}</span></button>
      </div>;
    })}
    <button type="button" className="text-button" disabled={rows.length >= maxInventoryUnitConversions} onClick={() => onChange([...rows, { unit: "", unitsPerPurchase: "" }])}>
      <Plus size={15} />{t("単位の換算を追加")}
    </button>
    {!rows.length ? <small>{t("追加しない商品は、明示的な換算なしで保存されます。")}</small> : null}
    {reference ? <div className={styles.reference}>
      <span>{t("包装規格による換算（参照）")}</span>
      <Relation purchaseUnit={product.unit} countUnit={reference.unit} quantity={reference.quantity} />
      <small>{t("包装規格の数量・数量単位を参照しています。ここでは編集しません。")}</small>
    </div> : null}
    {requiresReconfirmation ? <div className={styles.notice} role="alert">
      <p>{t("発注・購入単位が変わりました。すべての換算数量を見直してください。分割単位は確認後に新しい単位へ更新します。")}</p>
      <button type="button" className="secondary-button" onClick={() => onReconfirm(reconfirmUnitConversionDrafts(rows, product.unit))}>{t("発注・購入単位と換算を再確認しました")}</button>
    </div> : null}
    {!requiresReconfirmation && validationError ? <p className={styles.error} role="alert">{t(validationError)}</p> : null}
  </fieldset>;
}
