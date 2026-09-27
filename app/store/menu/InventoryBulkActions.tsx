"use client";

import { CheckCircle2, ListChecks, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type InventorySelection = { key: string; label: string; detail: string };
type Language = "ja" | "zh-Hans" | "zh-Hant";
export type InventoryBatchResult = { succeeded: number; failed: Array<{ key: string; label: string; error: string }> };

export function inventoryBulkCopy(language: Language) {
  return language === "ja" ? {
    select: "複数選択", done: "選択を終了", selectAll: "絞り込み結果を全選択", clear: "選択を解除",
    selected: "件を選択中", hidden: "件は現在の絞り込み対象外", hint: "商品を選び、まとめて販売状態を変更できます。",
    available: "販売再開", unavailable: "欠品にする", cancel: "キャンセル", confirm: "確認して変更",
    review: "選択内容を確認", scope: "関連する商品・選択肢にも反映し、Web予約と連携先へ同期します。プラットフォーム別の例外設定は解除されます。",
    updating: "更新中", saved: "件を更新しました。連携先の反映状況は同期履歴で確認できます。",
    failed: "件は更新できませんでした。失敗した項目を選択したまま残しています。", details: "失敗した項目",
    error: "更新できませんでした。接続を確認して再試行してください。", availableState: "販売中", unavailableState: "売切", lowState: "残りわずか"
  } : language === "zh-Hant" ? {
    select: "多選", done: "結束多選", selectAll: "全選篩選結果", clear: "清除已選",
    selected: "項已選", hidden: "項不在目前篩選結果內", hint: "選擇商品後，可一次修改銷售狀態。",
    available: "恢復銷售", unavailable: "設為缺貨", cancel: "取消", confirm: "確認修改",
    review: "確認已選項目", scope: "關聯商品及選項也會更新，並同步至網站預約與關聯平台。各平台的單獨設定會清除。",
    updating: "正在更新", saved: "項已更新。各平台的執行情況可在同步履歷中查看。",
    failed: "項更新失敗，已保留勾選，可再次提交。", details: "失敗項目",
    error: "更新失敗，請檢查連接後重試。", availableState: "有貨", unavailableState: "缺貨", lowState: "即將缺貨"
  } : {
    select: "多选", done: "结束多选", selectAll: "全选筛选结果", clear: "清除已选",
    selected: "项已选", hidden: "项不在当前筛选结果内", hint: "选择商品后，可一次修改销售状态。",
    available: "恢复销售", unavailable: "设为缺货", cancel: "取消", confirm: "确认修改",
    review: "确认已选项目", scope: "关联商品及选项也会更新，并同步至网站预约与关联平台。各平台的单独设置会清除。",
    updating: "正在更新", saved: "项已更新。各平台的执行情况可在同步履历中查看。",
    failed: "项更新失败，已保留勾选，可再次提交。", details: "失败项目",
    error: "更新失败，请检查连接后重试。", availableState: "有货", unavailableState: "缺货", lowState: "即将缺货"
  };
}

export function InventorySelectionRow({ target, status, language, checked, disabled, onChange }: {
  target: InventorySelection;
  status: "available" | "low_stock" | "unavailable";
  language: Language;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const copy = inventoryBulkCopy(language);
  return <label className={`store-inventory-selection-row${checked ? " is-selected" : ""}`} data-i18n-ignore>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={target.label} />
    <span className="store-inventory-selection-copy"><strong>{target.label}</strong><small>{target.detail}</small></span>
    <span className={`store-inventory-selection-status is-${status}`}>
      {status === "available" ? copy.availableState : status === "unavailable" ? copy.unavailableState : copy.lowState}
    </span>
  </label>;
}

export function InventoryBulkActions({ language, storeName, selected, visibleKeys, disabled, progress, result, onSelectAll, onClear, onClose, onApply }: {
  language: Language;
  storeName: string;
  selected: InventorySelection[];
  visibleKeys: string[];
  disabled: boolean;
  progress: { completed: number; total: number } | null;
  result: InventoryBatchResult | null;
  onSelectAll: () => void;
  onClear: () => void;
  onClose: () => void;
  onApply: (available: boolean) => Promise<void>;
}) {
  const copy = inventoryBulkCopy(language);
  const [action, setAction] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hiddenCount = selected.filter(target => !visibleKeys.includes(target.key)).length;
  useEffect(() => {
    if (action !== null) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [action]);
  return <div className="store-inventory-bulk-controls" data-i18n-ignore>
    <div className="store-inventory-selection-tools">
      <p>{copy.hint}</p>
      <button type="button" className="text-button" disabled={disabled || !visibleKeys.length} onClick={onSelectAll}>{copy.selectAll}</button>
    </div>
    {result && <div className={`store-inventory-bulk-result${result.failed.length ? " has-failures" : ""}`} role="status">
      <p>{result.succeeded} {copy.saved}</p>
      {!!result.failed.length && <><p>{result.failed.length} {copy.failed}</p><details>
        <summary>{copy.details}</summary>
        <ul>{result.failed.map(target => <li key={target.key}><strong>{target.label}</strong> — {target.error}</li>)}</ul>
      </details></>}
    </div>}
    <div className="store-inventory-bulk-bar" aria-label={copy.select}>
      <div className="store-inventory-bulk-summary" role="status" aria-live="polite">
        <ListChecks size={20} aria-hidden="true" />
        <div><strong>{progress ? `${copy.updating} ${progress.completed} / ${progress.total}` : `${selected.length} ${copy.selected}`}</strong>
          {hiddenCount > 0 && <small>{hiddenCount} {copy.hidden}</small>}
        </div>
      </div>
      <div className="store-inventory-bulk-secondary">
        <button type="button" className="text-button" disabled={disabled || !selected.length} onClick={onClear}>{copy.clear}</button>
        <button type="button" className="text-button" disabled={disabled} onClick={onClose}>{copy.done}</button>
      </div>
      <div className="store-inventory-bulk-submit">
        <button type="button" className="secondary-button" disabled={disabled || !selected.length} onClick={() => setAction(false)}><XCircle size={17} />{copy.unavailable}</button>
        <button type="button" className="primary-button" disabled={disabled || !selected.length} onClick={() => setAction(true)}><CheckCircle2 size={17} />{copy.available}</button>
      </div>
    </div>
    <dialog ref={dialogRef} className="store-inventory-bulk-dialog" aria-labelledby="inventory-bulk-title" onCancel={() => setAction(null)} onClose={() => setAction(null)}>
      <h2 id="inventory-bulk-title">{action ? copy.available : copy.unavailable} · {selected.length}</h2>
      <p>{storeName}</p>
      <p>{copy.scope}</p>
      <ul aria-label={copy.review}>{selected.map(target => <li key={target.key}><strong>{target.label}</strong><small>{target.detail}</small></li>)}</ul>
      <div className="store-inventory-bulk-dialog-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setAction(null)}>{copy.cancel}</button>
        <button type="button" className="primary-button" disabled={disabled || !selected.length} onClick={() => {
          if (action === null) return;
          const available = action;
          setAction(null);
          void onApply(available);
        }}>{copy.confirm}</button>
      </div>
    </dialog>
  </div>;
}
