"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import type { CommonOrderTemplate, OrderTemplateItem } from "../../../lib/order-template-draft";
import styles from "./OrderTemplatesPanel.module.css";

export function OrderTemplatesPanel({ storeId, storeName, cartItems, products, disabled, onApply }: {
  storeId: string; storeName: string; cartItems: OrderTemplateItem[] | null;
  products: Array<{ id?: string; name: string }>; disabled: boolean;
  onApply: (template: CommonOrderTemplate) => { added: number; retained: number; unavailable: number };
}) {
  const { t } = useOsTranslation();
  const [data, setData] = useState<{ storeId: string; templates: CommonOrderTemplate[]; canManage: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const activeStore = useRef(storeId);
  const savingRef = useRef(false);
  activeStore.current = storeId;

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setSelectedId(""); setError(""); setName(""); setSaving(false);
    if (!storeId) return () => controller.abort();
    setLoading(true);
    void fetch(`/api/orders/templates?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted || activeStore.current !== storeId) return;
        if (!response.ok) throw new Error(body.error ?? "常用発注を読み込めませんでした。");
        setData({ storeId, templates: body.templates ?? [], canManage: body.canManage === true });
      })
      .catch(failure => { if (!controller.signal.aborted && activeStore.current === storeId) setError(failure instanceof Error ? failure.message : "常用発注を読み込めませんでした。"); })
      .finally(() => { if (!controller.signal.aborted && activeStore.current === storeId) setLoading(false); });
    return () => controller.abort();
  }, [storeId, revision]);

  useEffect(() => { setNotice(""); }, [storeId]);

  const visible = data?.storeId === storeId ? data : null;
  const selected = visible?.templates.find(template => template.id === selectedId);
  async function save() {
    if (!visible?.canManage || !cartItems || !name.trim() || savingRef.current || disabled) return;
    const submittedStore = storeId;
    savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/orders/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, name: name.trim(), items: cartItems }) });
      const body = await response.json().catch(() => ({}));
      if (activeStore.current !== submittedStore) return;
      if (!response.ok) throw new Error(body.error ?? "常用発注を保存できませんでした。");
      setRevision(value => value + 1);
      setNotice("常用発注を保存しました。");
    } catch (failure) { if (activeStore.current === submittedStore) setError(failure instanceof Error ? failure.message : "常用発注を保存できませんでした。"); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <details className={styles.panel} data-order-templates="" data-i18n-ignore>
    <summary>{t("常用発注")} · {storeName}</summary>
    <p>{t("よく使う商品と数量を保存できます。追加しても、現在の下書きの数量や補充対象は変えません。")}</p>
    {error ? <p role="alert" className={styles.error}>{t(error)}</p> : null}
    {notice ? <p role="status">{t(notice)}</p> : null}
    {loading ? <p role="status">{t("読み込み中")}</p> : null}
    {visible ? <>
      <div className={styles.row}><label><span>{t("保存した常用発注")}</span><select value={selectedId} disabled={disabled || saving} onChange={event => { setSelectedId(event.target.value); setError(""); setNotice(""); }}>
        <option value="">{t("選択してください")}</option>{visible.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label><button type="button" className="secondary-button" disabled={disabled || saving || !visible.canManage || !selected?.items.length} onClick={() => { if (selected && visible.canManage && !disabled && !saving) { const result = onApply(selected); setNotice(t("{added} 件を追加しました。既存 {retained} 件の数量は保持し、追加不可 {unavailable} 件を除外しました。", result)); } }}>{t("下書きに追加")}</button></div>
      {selected ? <><ul>{selected.items.map(item => <li key={item.productId}><span>{products.find(product => product.id === item.productId)?.name ?? t("商品")}</span><small>{item.quantity} {item.purchaseUnit}</small></li>)}</ul>
        {selected.unavailableItemCount > 0 ? <p>{t("非公開・発注停止・単位変更の商品 {count} 件は追加できません。", { count: selected.unavailableItemCount })}</p> : null}</> : null}
      {!visible.templates.length ? <p>{t("この店舗の常用発注はまだありません。")}</p> : null}
      {visible.canManage ? <div className={styles.save}><label><span>{t("常用発注の名前")}</span><input value={name} maxLength={60} disabled={disabled || saving} placeholder={t("例：毎週の定番商品")} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} /></label>
        <button type="button" className="text-button" disabled={disabled || saving || !cartItems || !name.trim()} onClick={() => void save()}>{t(saving ? "保存中..." : "現在の商品リストを保存")}</button>
        {!cartItems ? <small>{t("商品と発注数量を確定してから保存してください。")}</small> : null}
      </div> : null}
    </> : null}
  </details>;
}
