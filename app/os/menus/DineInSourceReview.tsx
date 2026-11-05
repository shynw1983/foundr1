"use client";

import { ArrowRight, Download, Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { SourceReviewEntry, StoreDineInSourceReview } from "../../../lib/store-dine-in-source-review";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./DineInSourceReview.module.css";

type ReviewField = SourceReviewEntry["fields"][number];
export type DineInSourceReviewState = StoreDineInSourceReview;
type Decision = { field: ReviewField["field"]; decision: "adopt" | "keep" };
type Props = {
  review: DineInSourceReviewState;
  disabled: boolean;
  completionId: string;
  onReview: (entryKey: string, decisions: Decision[]) => Promise<unknown>;
  onEstablishBaseline: () => Promise<unknown>;
  onEdit: (entry: SourceReviewEntry) => void;
  onImport: (entry: SourceReviewEntry) => void;
};
const fieldNames: Record<ReviewField["field"], string> = {
  name: "名前", price: "価格・追加料金", category: "商品分類", specification: "販売単位・規格",
  rules: "選択ルール", memberships: "所属グループ・選択肢", availability: "元メニューの状態"
};
const kindNames = { item: "商品", group: "選択グループ", option: "選択肢" };
const statusNames = { linked: "対応あり", localOnly: "店内のみ", missing: "元メニューに見つかりません", new: "未取込" };
const valueNames: Record<string, string> = {
  fixed: "個数販売", weight: "計量販売", single: "1つだけ選択", multiple: "複数選択", quantity: "個数で選択",
  drink: "ドリンク", fixed_product: "料理・単品", buildable_product: "基本商品", bowl: "基本商品", item: "料理・単品",
  name: "名前", category: "商品分類", price: "価格", amount: "金額", basePrice: "ブランド価格", priceDelta: "追加料金",
  mode: "販売方法", pricingMode: "販売方法", posPricingMode: "販売方法", unit: "単位", weightUnit: "重量単位", posWeightUnit: "重量単位",
  unitPrice: "重量単価", weightUnitPrice: "重量単価", posWeightUnitPrice: "重量単価", portionGrams: "1点の重量", grams: "重量（g）",
  selectionType: "選び方", min: "最小数", max: "最大数", minSelections: "最小選択数", maxSelections: "最大選択数",
  minQuantity: "最小個数", maxQuantity: "最大個数", required: "必須", optional: "任意", active: "有効", visible: "POS 公開",
  isActive: "有効", posEnabled: "POS で使用", itemKind: "商品の種類", productionType: "厨房での扱い",
  sourceGroupName: "元のグループ", groupName: "グループ", group: "グループ", groups: "グループ", options: "選択肢", items: "商品",
  default: "初期選択", defaultQuantity: "初期個数", defaultOptionKeys: "初期選択", maxTotalQuantity: "合計個数の上限",
  optionKey: "選択肢のキー", groupKey: "グループのキー", ruleJson: "選択ルール", applicableCategories: "対象の商品分類",
  portion: "1点の規格", variableSchema: "販売仕様", posWeightPricing: "計量販売", buildable: "組み合わせ商品", preset: "セット商品", defaultNoodle: "標準の麺", baseSoup: "基本スープ", presetSoups: "セット商品", optionGroupKeys: "使用する選択グループ", temperatures: "温度", allowedSizes: "サイズ", allowedSweetness: "甘さ", allowedIce: "氷", allowedOptions: "オプション", allowedToppings: "トッピング", limit: "上限", allowRepeat: "同じ食材の複数選択", perOptionMax: "食材ごとの上限", defaultChoice: "初期選択", defaultOptionKey: "初期選択",
  status: "状態", enabled: "使用中", missing: "見つかりません", removed: "削除済み", inactive: "停止中", available: "有効"
};

export function DineInSourceReview({ review, disabled, completionId, onReview, onEstablishBaseline, onEdit, onImport }: Props) {
  const { t } = useOsTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [choiceState, setChoiceState] = useState<{ context: string; values: Record<string, "adopt" | "keep"> }>({ context: "", values: {} });
  const filtered = useMemo(() => review.entries.filter(entry => {
    if (filter === "pending" && !entry.pending) return false;
    if (filter === "linked" && entry.status !== "linked") return false;
    if (filter === "localOnly" && entry.status !== "localOnly") return false;
    if (filter === "missing" && entry.status !== "missing") return false;
    if (filter === "new" && entry.status !== "new") return false;
    return `${entry.localName} ${entry.localGroupName || ""} ${entry.sourceName} ${entry.sourceGroupName || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [review.entries, filter, query]);
  const entry = filtered.find(value => value.key === selectedKey) || filtered[0];
  const choiceContext = `${entry?.key || ""}:${review.sourceRevision}:${completionId}`;
  const choices = choiceState.context === choiceContext ? choiceState.values : {};
  const decisions = entry?.fields.flatMap(field => choices[field.field] ? [{ field: field.field, decision: choices[field.field] }] : []) || [];
  const pendingFields = entry?.fields.filter(field => field.changed || !field.baselineKnown) || [];


  function formatValue(value: unknown, field?: ReviewField["field"], depth = 0): string {
    if (value === null || value === undefined || value === "") return t("設定なし");
    if (typeof value === "boolean") return t(value ? "有効" : "無効");
    if (typeof value === "number") return field === "price" ? `¥${value.toLocaleString("ja-JP")}` : value.toLocaleString("ja-JP");
    if (typeof value === "string") return valueNames[value] ? t(valueNames[value]) : value;
    if (Array.isArray(value)) return value.length ? value.map(part => formatValue(part, undefined, depth + 1)).join(depth ? " / " : "\n") : t("なし");
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (field === "name" && typeof record.name === "string") {
        const translations = record.displayNames && typeof record.displayNames === "object" ? Object.entries(record.displayNames as Record<string, unknown>).filter(([language, text]) => language !== "ja" && typeof text === "string" && text.trim()) : [];
        return [record.name, ...translations.map(([language, text]) => `${language}: ${String(text)}`)].join("\n");
      }
      if (field === "price" && Object.hasOwn(record, "amount")) {
        const amount = typeof record.amount === "number" ? `¥${record.amount.toLocaleString("ja-JP")}` : t("設定なし");
        const basePrice = record.basis === "weight" ? `${amount} / 1${String(record.unit || "g")}（${t("計量販売")}）` : `${amount} / ${t("1点")}${record.portion ? `（${String(record.portion)}）` : ""}`;
        const lines = [Object.hasOwn(record, "networkAmount") ? `${t("ブランド基準価格")}: ${basePrice}` : basePrice];
        if (Object.hasOwn(record, "networkAmount")) lines.push(`${t("Web予約・Webサイトの設定価格")}: ${formatValue(record.networkAmount, "price")} / ${t("1点")}`);
        if (Object.hasOwn(record, "importAmount")) lines.push(`${t("現在の POS 取込価格")}: ${formatValue({ amount: record.importAmount, basis: record.importBasis, unit: record.importUnit }, "price")}`);
        return lines.join("\n");
      }
      const values = Object.entries(record).filter(([key, part]) => !["id", "source", "sourceField", "optionValueType", "displayNames", "storeDineInOnly"].includes(key) && !key.endsWith("Id") && part !== undefined);
      if (values.length === 1 && values[0][0] === "name") return String(values[0][1] || t("設定なし"));
      return values.map(([key, part]) => `${t(valueNames[key] || key)}: ${formatValue(part, ["price", "amount", "priceDelta", "basePrice"].includes(key) ? "price" : undefined, depth + 1)}${key === "portionGrams" && typeof part === "number" ? "g" : ""}`).join(depth ? " / " : "\n") || t("設定なし");
    }
    return String(value);
  }

  function saveAllKept() {
    if (!entry || disabled || !pendingFields.length) return;
    void onReview(entry.key, pendingFields.map(field => ({ field: field.field, decision: "keep" })));
  }

  return <section className={styles.review} aria-label={t("店内とブランドメニューの対応・更新確認")} data-dine-in-source-review data-source-review>
    <div className={styles.intro}>
      <h4>{t("対応・更新確認")}</h4>
      <p>{t("元メニューの変更は自動で反映しません。店内の名前・価格・分け方を確認し、採用する項目だけ選んでください。")}</p>
      <p>{t("比較元は OS のブランドメニューです。Uber など各配信先の公開価格・配信完了を示すものではありません。")}</p>
    </div>
    {review.initial ? <div className={styles.initial} data-source-review-initial>
      <p>{t("初回の対応確認です。以前の取込時点は記録されていないため、更新の有無は断定しません。現在の内容を比較して、今後の確認基準を保存してください。")}</p>
      <p>{t("現在の商品・価格を保ち、未取込の候補は今回は追加せず、今後の変更を確認する基準を保存します。")}</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled} data-source-review-baseline data-dine-in-action="acknowledgeSourceBaseline" onClick={() => { if (!disabled) void onEstablishBaseline(); }}><Save size={14} aria-hidden="true" />{t("店内設定を維持して初回確認を完了")}</button>
    </div> : null}
    <div className={styles.filters}>
      <label htmlFor="dine-in-source-search">{t("店内名・元の名前・グループで検索")}<input id="dine-in-source-search" type="search" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={t("商品・食材・グループ名")} /></label>
      <label htmlFor="dine-in-source-filter">{t("表示する対応")}<select id="dine-in-source-filter" value={filter} disabled={disabled} onChange={event => setFilter(event.target.value)}><option value="all">{t("すべての対応")}</option><option value="pending">{t("確認が必要な項目")}</option><option value="linked">{t("対応あり")}</option><option value="new">{t("未取込のブランド商品・選択肢")}</option><option value="localOnly">{t("店内のみ")}</option><option value="missing">{t("元メニューに見つからない項目")}</option></select></label>
    </div>
    <div className={styles.summary}><span>{t("表示 {count} 件", { count: filtered.length })}</span><span>{t("未確認 {count} 件", { count: review.pendingCount })}</span></div>
    <div className={styles.layout}>
      <div className={styles.list} role="group" aria-label={t("商品・グループの対応一覧")}>
        {filtered.map(value => <button type="button" className={styles.row} key={value.key} disabled={disabled} data-source-review-key={value.key} data-source-entry-key={value.key} aria-pressed={entry?.key === value.key} onClick={() => setSelectedKey(value.key)}>
          <span className={styles.rowTitle}><span>{value.localName || value.sourceName}</span>{value.pending ? <span className={styles.badge}>{t("要確認")}</span> : null}</span>
          <small>{t(kindNames[value.kind])}{" · "}{value.localGroupName || value.sourceGroupName || t(statusNames[value.status])}</small>
          <small>{t("元メニュー")}: {value.sourceName || t("対応なし")}{value.sourceGroupName ? ` / ${value.sourceGroupName}` : ""}</small>
          {value.kind !== "group" ? <small className={styles.rowPrices}>{value.localName ? <span>{t("店内の設定")}: {formatValue(value.fields.find(field => field.field === "price")?.localValue, "price")}</span> : null}{value.networkPrice !== undefined && value.networkPrice !== null ? <span>{t("Web予約・Webサイトの設定価格")}: {formatValue(value.networkPrice, "price")}</span> : null}</small> : null}
        </button>)}
        {!filtered.length ? <p className={styles.empty}>{t("条件に合う対応はありません。")}</p> : null}
      </div>
      {entry ? <div className={styles.detail} data-source-review-detail={entry.key}>
        <div className={styles.detailHeader}><div><h4>{entry.localName || entry.sourceName}</h4><small>{t(kindNames[entry.kind])}{" · "}{t(statusNames[entry.status])}</small></div>{entry.status !== "new" ? <button type="button" className="secondary-button compact-button" disabled={disabled} onClick={() => onEdit(entry)}>{t("店内の編集へ")}<ArrowRight size={14} aria-hidden="true" /></button> : null}</div>
        <div className={styles.identity}>
          <div><span>{t("この店舗の店内メニュー")}</span><strong>{entry.localName || t("未取込")}</strong><small>{entry.localGroupName || t("所属なし")}</small></div>
          <div><span>{t("ブランドメニュー（OS）")}</span><strong>{entry.sourceName || t("対応する元商品なし")}</strong><small>{entry.sourceGroupName || t("所属なし")}</small></div>
        </div>
        {entry.status === "localOnly" ? <p className={styles.sourceStatus}>{t("この店舗で作成した項目です。同じ名前の商品に自動では関連付けません。まとめたグループの食材は、食材ごとに元のグループを確認できます。")}</p> : null}
        {entry.status === "missing" ? <p className={styles.sourceStatus}>{t("元の商品が削除・停止されているか、現在のブランドメニューに存在しません。店内の項目は自動で削除しません。販売できるかは元の在庫・販売制限も確認してください。")}</p> : null}
        {entry.status === "new" ? <div className={styles.actions}><p className={styles.note}>{t("ブランドメニューにある未取込の候補です。取込画面で商品・追加食材と、入れる先を選んでください。")}</p><button type="button" className="secondary-button compact-button" disabled={disabled} data-source-review-import onClick={() => onImport(entry)}><Download size={14} aria-hidden="true" />{t("取込画面で確認")}</button></div> : null}
        <div className={styles.fields}>
          {entry.fields.map(field => <div className={styles.field} key={field.field} data-source-review-field={field.field} data-source-field={field.field}>
            <div className={styles.fieldHeader}><h5>{t(fieldNames[field.field])}</h5>{!field.baselineKnown && entry.status !== "localOnly" ? <span className={styles.badge}>{t("初回確認")}</span> : field.changed ? <span className={styles.badge}>{t("元メニューが変更されました")}</span> : null}</div>
            <div className={styles.comparison}>
              <div className={styles.value}><span>{t("店内の設定")}</span><strong>{entry.status === "new" ? t("未取込") : formatValue(field.localValue, field.field)}</strong></div>
              <div className={styles.value}><span>{t("元メニューの現在値")}</span><strong>{entry.status === "localOnly" ? t("対応なし") : formatValue(field.sourceValue, field.field)}</strong></div>
            </div>
            {field.baselineKnown && field.changed ? <p className={styles.previous}>{t("前回確認した元の値")}: {formatValue(field.previousValue, field.field)}</p> : null}
            {entry.status !== "localOnly" ? <div className={styles.decision}>
              <label htmlFor={`source-decision-${field.field}`}>{t("この項目の扱い")}</label>
              <select id={`source-decision-${field.field}`} data-source-review-decision={field.field} disabled={disabled} value={choices[field.field] || ""} onChange={event => { const value = event.target.value; setChoiceState(previous => { const next = { ...(previous.context === choiceContext ? previous.values : {}) }; if (value) next[field.field] = value as "adopt" | "keep"; else delete next[field.field]; return { context: choiceContext, values: next }; }); }}>
                <option value="">{t("選択してください")}</option><option value="keep">{t(entry.status === "new" ? "今回は取り込まない" : "店内の設定を維持する")}</option>{field.canAdopt ? <option value="adopt">{t(field.field === "price" ? "ブランド基準価格を採用する" : "元メニューの値を採用する")}</option> : null}
              </select>
              {field.field === "price" && field.canAdopt ? <p className={styles.note}>{t("採用するのはブランド基準価格です。ネット価格に合わせる場合は「店内の編集へ」で店内価格を設定してください。")}</p> : null}
              {field.reason ? <p className={styles.note}>{t(field.reason)}</p> : null}
            </div> : null}
          </div>)}
        </div>
        {entry.importPrice !== undefined && entry.importPrice !== null ? <p className={styles.note}>{t("現在の POS 取込価格は、店舗の従来の POS 価格設定を含みます。ブランド基準価格・ネット価格とは別です。")}</p> : null}
        {entry.status !== "localOnly" ? <div className={styles.actions}>
          <button type="button" className="primary-button compact-button" disabled={disabled || !decisions.length} data-dine-in-action="reviewSource" data-source-review-save onClick={() => { if (decisions.length) void onReview(entry.key, decisions); }}><Save size={14} aria-hidden="true" />{t("選んだ項目の扱いを保存")}</button>
          {entry.pending && pendingFields.length ? <button type="button" className="secondary-button compact-button" disabled={disabled} data-dine-in-action="keepSource" data-source-review-keep onClick={saveAllKept}>{t(entry.status === "new" ? "今回は取り込まず確認済みにする" : "店内の設定を維持して確認済みにする")}</button> : null}
          <p className={styles.note}>{t("選んでいない項目は変更しません。店内の価格を変えた後は、POS の「メニューを更新」を押してください。")}</p>
        </div> : null}
      </div> : <p className={styles.empty}>{t("対応を選ぶと、店内と元メニューの名前・分け方・価格・規格を比較できます。")}</p>}
    </div>
  </section>;
}
