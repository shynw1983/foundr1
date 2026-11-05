"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getDineInBulkOptionDeleteDisabledReason, getDineInBulkOptionVisibilityDisabledReason, type StoreDineInCatalog, type StoreDineInGroup } from "../../../lib/store-dine-in-menu-policy";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./DineInMenuEditor.module.css";

export function DineInOptionBulkActions({ scope, count, total, disabled, reason, hideReason, showReason, canHide, canShow, onSelectAll, onClear, onDelete, onVisibility }: {
  scope: string;
  count: number;
  total: number;
  disabled: boolean;
  reason: string | null;
  hideReason: string | null;
  showReason: string | null;
  canHide: boolean;
  canShow: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onVisibility: (visible: boolean) => void;
}) {
  const { t } = useOsTranslation();
  return <div className={styles.bulkOptions} data-dine-in-bulk-options={scope}>
    <span data-dine-in-bulk-count={count} aria-live="polite">{t("選択中 {count} 件", { count })}</span>
    <div className={styles.bulkOptionActions}>
      <button type="button" className="secondary-button compact-button" data-dine-in-bulk-select-all disabled={disabled || !total || count === total} onClick={onSelectAll}>{t("絞り込み結果をすべて選択")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-bulk-clear disabled={disabled || !count} onClick={onClear}>{t("選択を解除")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-bulk-hide disabled={disabled || !count || !canHide || Boolean(hideReason)} title={hideReason ? t(hideReason) : undefined} onClick={() => onVisibility(false)}>{t("選択した選択肢を非表示")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-bulk-show disabled={disabled || !count || !canShow || Boolean(showReason)} title={showReason ? t(showReason) : undefined} onClick={() => onVisibility(true)}>{t("選択した選択肢を表示")}</button>
      <button type="button" className="danger-button compact-button" data-dine-in-bulk-delete disabled={disabled || !count || Boolean(reason)} onClick={onDelete}>{t("選択した選択肢を削除")}</button>
    </div>
    <p className={styles.help}>{t("検索・公開状態を変えると選択を解除します。削除前に対象を確認できます。")}</p>
    <p className={styles.help}>{t("選択肢の公開設定だけを変更します。非公開の親グループ・関連商品は自動で公開せず、ホームの単品商品や別の選択肢は変更しません。")}</p>
    {count && hideReason ? <p role="status" className={styles.help}>{t("非表示にできない理由")}: {t(hideReason)}</p> : null}
    {count && showReason && showReason !== hideReason ? <p role="status" className={styles.help}>{t("表示にできない理由")}: {t(showReason)}</p> : null}
    {count && reason ? <p role="status" className={styles.help}>{t("削除できない理由")}: {t(reason)}</p> : null}
  </div>;
}

export function DineInGroupOptions({ catalog, group, disabled, selectionScope, onEdit, onDelete, onVisibility, onCreate }: {
  catalog: StoreDineInCatalog;
  group: StoreDineInGroup;
  disabled: boolean;
  selectionScope: string;
  onEdit: (optionId: string) => void;
  onCreate: () => void;
  onDelete: (optionIds: string[]) => void;
  onVisibility: (optionIds: string[], visible: boolean) => void;
}) {
  const { t } = useOsTranslation();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const items = useMemo(() => new Map(catalog.items.map(item => [item.id, item])), [catalog.items]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // This is the group's complete editing list, including hidden choices and
  // choices excluded for particular products. It does not change POS scopes.
  const options = group.options.filter(option => {
    const linked = option.linkedItemId ? items.get(option.linkedItemId) : undefined;
    return !normalizedQuery || `${option.name} ${option.sourceName} ${option.sourceGroupName || ""} ${linked?.name || ""}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const scope = JSON.stringify([selectionScope, group.id, normalizedQuery]);
  const selectedIds = selection.scope === scope ? selection.ids.filter(id => options.some(option => option.id === id)) : [];
  const selectedSet = new Set(selectedIds);
  useEffect(() => { setSelection({ scope, ids: [] }); }, [scope]);
  const reason = selectedIds.length ? getDineInBulkOptionDeleteDisabledReason(catalog, selectedIds) : null;
  const hideReason = selectedIds.length ? getDineInBulkOptionVisibilityDisabledReason(catalog, selectedIds, false) : null;
  const showReason = selectedIds.length ? getDineInBulkOptionVisibilityDisabledReason(catalog, selectedIds, true) : null;
  const canHide = options.some(option => selectedSet.has(option.id) && option.visible !== false);
  const canShow = options.some(option => selectedSet.has(option.id) && option.visible === false);
  function toggle(id: string, checked: boolean) {
    if (disabled) return;
    setSelection({ scope, ids: checked ? [...new Set([...selectedIds, id])] : selectedIds.filter(value => value !== id) });
  }
  return <section className={styles.groupOptions} data-dine-in-group-options={group.id}>
    <div className={styles.groupOptionsHeading}><h4>{t("このグループの選択肢")}</h4><span data-group-options-total={group.options.length}>{t("選択肢 {count} 件", { count: group.options.length })}</span><button type="button" className="secondary-button compact-button" data-dine-in-create-group-option={group.id} disabled={disabled} onClick={onCreate}><Plus size={15} aria-hidden="true" />{t("新規選択肢を追加")}</button></div>
    <p className={styles.help}>{t("非表示の選択肢も含めた一覧です。選択肢を押すと編集できます。")}</p>
    <label htmlFor={`dine-in-group-options-search-${group.id}`}>{t("このグループ内を検索")}<input id={`dine-in-group-options-search-${group.id}`} type="search" data-group-options-search value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={t("選択肢名・引継ぎ元・関連商品で検索")} /></label>
    {normalizedQuery ? <p className={styles.help} data-group-options-matched={options.length}>{t("表示 {count} / {total} 件", { count: options.length, total: group.options.length })}</p> : null}
    <DineInOptionBulkActions scope={group.id} count={selectedIds.length} total={options.length} disabled={disabled} reason={reason} hideReason={hideReason} showReason={showReason} canHide={canHide} canShow={canShow} onVisibility={visible => onVisibility(selectedIds, visible)} onSelectAll={() => setSelection({ scope, ids: options.map(option => option.id) })} onClear={() => setSelection({ scope, ids: [] })} onDelete={() => onDelete(selectedIds)} />
    <div className={styles.groupOptionRows}>
      {options.map(option => {
        const linked = option.linkedItemId ? items.get(option.linkedItemId) : undefined;
        const name = linked?.name || option.name;
        const price = Number(linked?.price ?? option.priceDelta ?? 0).toLocaleString("ja-JP");
        const grams = option.linkedItemId ? NaN : Number((option.sourceGroupRuleJson || group.ruleJson).portionGrams);
        const sources = [option.sourceGroupName && option.sourceGroupName !== group.name ? option.sourceGroupName : "", option.sourceName && option.sourceName !== name ? option.sourceName : ""].filter(Boolean);
        return <div key={option.id} className={styles.optionSelectableRow} data-option-selected={selectedSet.has(option.id)}>
          <label className={styles.optionSelect}><input type="checkbox" data-group-option-select={option.id} aria-label={t("「{name}」を一括操作の対象に選択", { name })} checked={selectedSet.has(option.id)} disabled={disabled} onChange={event => toggle(option.id, event.target.checked)} /></label>
          <button type="button" className={styles.groupOptionRow} data-group-option-id={option.id} data-group-option-visible={option.visible !== false} data-group-option-parent-visible={group.visible !== false} disabled={disabled} onClick={() => { if (!disabled) onEdit(option.id); }}>
          <span className={styles.groupOptionTitle}><strong>{name}</strong><span data-group-option-price>{t("¥{price} / 1点", { price })}{Number.isFinite(grams) && grams > 0 ? <small>{t("1点 {grams}g", { grams })}</small> : null}</span></span>
          <span className={styles.groupOptionStatus}>{option.visible === false ? <span className={styles.hiddenBadge}>{t("POS 非公開")}</span> : group.visible !== false ? <span className={styles.visibleBadge}>{t("POS 公開")}</span> : null}{group.visible === false ? <span className={styles.hiddenBadge}>{t("グループ非公開")}</span> : null}<span className={styles.groupOptionEdit}>{t("編集")}</span></span>
          {sources.length ? <small className={styles.groupOptionHint}>{t("引継ぎ元")}: {sources.join(" / ")}</small> : null}
          {option.linkedItemId ? <small className={styles.groupOptionHint} data-group-option-linked-item={option.linkedItemId}>{t("関連する店内商品")}: {linked?.name || t("関連する商品がありません。")}{" · "}{t("名前・価格は関連商品に従います。")}</small> : null}
        </button></div>;
      })}
    </div>
    {!options.length ? <p className={styles.empty} data-group-options-empty={group.options.length ? "search" : "empty"}>{t(group.options.length ? "検索に一致する選択肢がありません。" : "このグループには選択肢がありません。")}</p> : null}
  </section>;
}
