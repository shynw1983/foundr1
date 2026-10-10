"use client";

import { Link2, RefreshCw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuProductLinksResponse } from "../../../lib/menu-product-links";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { InventoryRecipeEditor } from "../../../components/InventoryRecipeEditor";

export function MenuProductLinksEditor({ kind, targetId }: { kind: "item" | "option"; targetId: string }) {
  const { t } = useOsTranslation();
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<MenuProductLinksResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const targetKey = `${kind}:${targetId}`;
  const currentTarget = useRef(targetKey);
  currentTarget.current = targetKey;
  const loadSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(body => setAuthorized((body?.employee?.role === "owner" || body?.employee?.role === "manager") && body.employee.permissions?.includes("menus.edit") === true))
      .catch(() => { if (!controller.signal.aborted) setAuthorized(false); });
    return () => controller.abort();
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!authorized || !targetId) return;
    const sequence = ++loadSequence.current;
    const key = `${kind}:${targetId}`;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ kind, targetId });
      const response = await fetch(`/api/menu-product-links?${params}`, { cache: "no-store", signal });
      const body = await response.json();
      if (sequence !== loadSequence.current || currentTarget.current !== key || signal?.aborted) return;
      if (!response.ok) throw new Error(body.error || "発注商品の関連付けを読み込めませんでした。");
      setData(body);
      setSelectedIds(body.productIds);
      setConflicted(false);
    } catch (error) {
      if (sequence === loadSequence.current && currentTarget.current === key && !signal?.aborted) {
        setMessage(error instanceof Error ? error.message : "発注商品の関連付けを読み込めませんでした。");
      }
    } finally {
      if (sequence === loadSequence.current && currentTarget.current === key && !signal?.aborted) setLoading(false);
    }
  }, [authorized, kind, targetId]);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelectedIds([]);
    setQuery("");
    setMessage("");
    setConflicted(false);
    setRecipeOpen(false);
    void load(controller.signal);
    return () => { controller.abort(); ++loadSequence.current; };
  }, [load]);

  async function save() {
    if (!data || loading || saving || conflicted || !data.target.isActive) return;
    const key = targetKey;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/menu-product-links", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, targetId, productIds: selectedIds, expectedProductIds: data.productIds })
      });
      const body = await response.json();
      if (currentTarget.current !== key) return;
      if (!response.ok) {
        if (response.status === 409) setConflicted(true);
        throw new Error(body.error || "発注商品の関連付けを保存できませんでした。");
      }
      setData(body);
      setSelectedIds(body.productIds);
      setMessage("発注商品の関連付けを保存しました。");
    } catch (error) {
      if (currentTarget.current === key) setMessage(error instanceof Error ? error.message : "発注商品の関連付けを保存できませんでした。");
    } finally { setSaving(false); }
  }

  if (!authorized || !targetId) return null;
  const available = data ? [...data.availableProducts, ...data.products.filter(product => !data.availableProducts.some(candidate => candidate.id === product.id))] : [];
  const matches = available.filter(product => `${product.name} ${product.unit}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const changed = data && [...selectedIds].sort().join(",") !== [...data.productIds].sort().join(",");
  return (
    <section className="menu-product-links" aria-label={t("在庫・発注の商品関連付け")} data-i18n-ignore>
      <div className="menu-product-links-head">
        <div><strong><Link2 size={16} />{t("在庫・発注の商品関連付け")}</strong><p>{t("このメニューが不足したときに確認する発注商品を選びます。")}</p></div>
        <button className="secondary-button compact-button" type="button" disabled={loading || saving} onClick={() => void load()} aria-label={t("関連付けを再読込")}><RefreshCw size={15} /></button>
      </div>
      {loading ? <p role="status">{t("読み込み中")}</p> : null}
      {message ? <p className={conflicted ? "inline-alert" : "menu-product-links-message"} role="status">{t(message)}</p> : null}
      {data ? <>
        {!data.target.isActive ? <p className="inline-alert">{t("停止中のメニューは関連付けを変更できません。")}</p> : null}
        <label className="menu-product-links-search"><Search size={15} /><input type="search" aria-label={t("発注商品を検索")} placeholder={t("商品名・規格・単位で検索")} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="menu-product-link-options">
          {matches.map(product => <label key={product.id}>
            <input type="checkbox" checked={selectedIds.includes(product.id)} disabled={saving || conflicted || !data.target.isActive} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, product.id] : ids.filter(id => id !== product.id))} />
            <span><strong>{product.name}</strong><small>{t("発注単位")} · {product.unit}</small>{!data.availableProducts.some(candidate => candidate.id === product.id) ? <small>{t("適用ブランドの確認が必要")}</small> : null}</span>
          </label>)}
          {!matches.length ? <p>{t("該当する発注商品がありません。商品マスタの適用ブランドを確認してください。")}</p> : null}
        </div>
        <div className="menu-product-links-footer"><small>{t("関連付け {count} 商品", { count: selectedIds.length })}</small><button className="primary-button compact-button" type="button" disabled={!changed || loading || saving || conflicted || !data.target.isActive} onClick={() => void save()}><Save size={15} />{t(saving ? "保存中" : "関連付けを保存")}</button></div>
      </> : null}
      <details className="menu-product-links-recipe" open={recipeOpen} onToggle={event => setRecipeOpen(event.currentTarget.open)}>
        <summary>{t("配合・注文の使用量を設定")}</summary>
        {recipeOpen ? <InventoryRecipeEditor targetType={kind} targetId={targetId} /> : null}
      </details>
    </section>
  );
}
