"use client";

import { useEffect, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import type { ProductBatchPackaging, ProductPackagingTemplate } from "../lib/product-packaging-policy";
import { useInventoryOperation, useInventoryReadModel } from "./useInventoryOperations";
import styles from "./InventoryOperations.module.css";

export function BatchPackagingTemplateSaver({ storeId, productId, packaging, disabled, onSaved }: { storeId: string; productId: string; packaging: ProductBatchPackaging; disabled?: boolean; onSaved?: () => void }) {
  const { t } = useOsTranslation();
  const scope = `${storeId}:${productId}`;
  const model = useInventoryReadModel<{ templates: ProductPackagingTemplate[]; canManage: boolean }>(`/api/inventory/packaging?storeId=${encodeURIComponent(storeId)}&productId=${encodeURIComponent(productId)}`, scope);
  const operation = useInventoryOperation("/api/inventory/packaging", scope, () => { void model.load(); onSaved?.(); });
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ scope: string; id: string; expectedUpdatedAt: string } | null>(null);
  useEffect(() => { setName(""); setEditing(null); }, [scope]);
  const target = editing?.scope === scope ? editing : null;
  const locked = disabled || operation.busy || Boolean(operation.pending);
  const collision = model.data?.templates.some(template => template.name.trim() === name.trim() && template.id !== target?.id);
  async function save() {
    if (!model.data?.canManage || locked || operation.needsReview || !name.trim() || collision) return;
    const { templateId: _templateId, ...snapshot } = packaging;
    if (await operation.submit({ action: "save", productId, name: name.trim(), packaging: snapshot, ...(target ? { id: target.id, expectedUpdatedAt: target.expectedUpdatedAt } : {}) })) { setName(""); setEditing(null); }
  }
  if (!model.data?.canManage) return null;
  return <details className={styles.detail} data-packaging-template-saver="" data-i18n-ignore><summary>{t("今回の仕様を包装テンプレートに保存")}</summary><div>
    <p className={styles.hint}>{t("テンプレートは次の購入時の入力に使います。記録済みの購入包装や商品マスタを変更しません。")}</p>
    {operation.error || model.error ? <p className={styles.error} role="alert">{t(operation.error || model.error)}</p> : null}{operation.notice ? <p className={styles.notice} role="status">{t(operation.notice)}</p> : null}
    <div className={styles.fields}><label><span>{t("保存先の包装テンプレート")}</span><select name="packagingTemplateSaveTarget" value={target?.id ?? ""} disabled={locked} onChange={event => { const template = model.data?.templates.find(template => template.id === event.target.value); setEditing(template ? { scope, id: template.id, expectedUpdatedAt: template.updatedAt } : null); setName(template?.name ?? ""); operation.confirmReview(); }}><option value="">{t("新しいテンプレートとして保存")}</option>{model.data.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label><span>{t("包装テンプレート名")}</span><input name="packagingTemplateName" maxLength={160} value={name} disabled={locked} onChange={event => setName(event.target.value)} /></label></div>
    {collision ? <p className={styles.warning}>{t("同じ名前のテンプレートがあります。既存の保存先を選ぶか、別の名前を入力してください。")}</p> : null}
    {target ? <p className={styles.warning}>{t("選んだテンプレートを今回の仕様で更新します。過去の購入記録は変更しません。")}</p> : null}
    {operation.needsReview ? <div className={styles.warning}><p>{t("包装テンプレートが更新されました。入力は残しています。最新の保存先を確認してください。")}</p><button type="button" className="secondary-button" disabled={model.loading || locked} onClick={() => void model.load().then(latest => { if (!latest) return; const template = latest.templates.find(template => template.id === target?.id); setEditing(template ? { scope, id: template.id, expectedUpdatedAt: template.updatedAt } : null); operation.confirmReview(); })}>{t("最新の保存先を確認しました")}</button></div> : null}
    {operation.pending ? <div className={styles.warning}><p>{t("テンプレートの送信結果を確認中です。同じ名前・仕様で再送してください。")}</p><button type="button" className="primary-button" disabled={operation.busy || disabled} onClick={() => void operation.submit({})}>{t("同じ内容で再送")}</button></div> : <div className={styles.actions}><button type="button" className="secondary-button" disabled={locked || !name.trim() || collision || operation.needsReview} onClick={() => void save()}>{t(target ? "選んだ包装テンプレートを更新" : "包装テンプレートを保存")}</button></div>}
  </div></details>;
}
