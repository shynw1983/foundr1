"use client";

import { AlertTriangle, Check, ChevronDown, ClipboardList, PackageSearch, Plus, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { canonicalNavItems, OsNavList } from "../components/OsNavList";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { UserBadge } from "../components/UserBadge";
import type { ReplenishmentDemand, ReplenishmentDemandCreateOrder, ReplenishmentDemandResponse, ReplenishmentDemandReview, ReplenishmentDemandStatus } from "../../../lib/replenishment-demand-types";
import type { ReplenishmentSource } from "../../../lib/replenishment-policy";
import { replenishmentText } from "./copy";
import styles from "./replenishment.module.css";

type Draft = { version: number; quantity: string; unit: string; note: string };
type Decision = { demandId: string; status: ReplenishmentDemandStatus; note: string; until: string };
type Filter = "pending" | "ordered" | "deferred" | "history" | "all";
type Preview = { body: ReplenishmentDemandCreateOrder; names: Array<{ id: string; name: string }>; buyerName: string; storeName: string; attempted: boolean };
const progressLabels: Record<ReplenishmentDemand["progress"], string> = {
  reported: "確認待ち", reviewing: "確認中", deferred: "保留", purchasing: "購入中", awaiting_receipt: "入庫待ち",
  partial_received: "一部入庫", received: "入庫済み・充足確認待ち", needs_review: "再確認が必要", resolved: "充足済み", dismissed: "見送り"
};
const orderLabels: Record<string, string> = { requested: "発注済み", purchased: "購入済み", in_delivery: "配送中", delivered: "納品済み", received: "受領済み", unavailable: "購入不可" };
const eventLabels: Record<string, string> = { report: "店舗報告", automatic: "自動チェック", review: "担当者判断", create_order: "発注済み" };
const quantity = (value: string): number | null => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 999 ? Number(value) : null;
const initialDraft = (demand: ReplenishmentDemand): Draft => ({ version: demand.version, quantity: demand.quantity === null ? "" : String(demand.quantity), unit: demand.unit, note: demand.note });
const canOrder = (demand: ReplenishmentDemand) => ["open", "reviewing", "ordered"].includes(demand.status) && demand.product.isOrderable && demand.unit === demand.product.unit;
const pendingKey = (actorId: string, storeId: string) => `foundr1-os:replenishment-order:v2:${actorId}:${storeId}`;
function forgetPending(preview: Preview) {
  try { window.sessionStorage.removeItem(pendingKey(preview.body.expectedActorId, preview.body.storeId)); } catch { /* In-memory state is still authoritative for this tab. */ }
}

export default function ReplenishmentPage() {
  const { language, t: osT } = useOsTranslation();
  const t = useCallback((text: string) => {
    const local = replenishmentText(language, text);
    return local === text ? osT(text) : local;
  }, [language, osT]);
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [data, setData] = useState<ReplenishmentDemandResponse | null>(null);
  const [storeId, setStoreId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [manualProduct, setManualProduct] = useState("");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [additionalConfirmed, setAdditionalConfirmed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [createdOrder, setCreatedOrder] = useState("");
  const loadSequence = useRef(0);
  const activeStore = useRef(storeId); activeStore.current = storeId;
  const previewRef = useRef(preview); previewRef.current = preview;
  const previewDialog = useRef<HTMLElement | null>(null);
  const manualRequest = useRef<{ requestId: string; key: string } | null>(null);
  const busy = Boolean(saving);
  const visibleData = data?.storeId === storeId ? data : null;
  const number = (value: number | null | undefined) => value === null || value === undefined ? t("数量未記録") : new Intl.NumberFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { maximumFractionDigits: 6 }).format(value);
  const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("未確認");

  const load = useCallback(async (nextStore: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/os/replenishment${nextStore ? `?storeId=${encodeURIComponent(nextStore)}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (sequence !== loadSequence.current || activeStore.current !== nextStore) return;
      if (!response.ok) throw new Error(body.error || "需要を読み込めませんでした。");
      if (body.storeId !== nextStore) throw new Error("需要を読み込めませんでした。");
      setData(body);
      setSelected(current => current.filter(id => body.demands.some((d: ReplenishmentDemand) => d.id === id && canOrder(d))));
      const actorId = body.operator?.id;
      setPreview(current => current && (current.body.expectedActorId !== actorId || current.body.storeId !== nextStore) ? null : current);
      // Pending writes are recovered only after the current authenticated
      // identity and original store have both been established by the API.
      if (actorId && nextStore) {
        try {
          const stored = window.sessionStorage.getItem(pendingKey(actorId, nextStore));
          if (stored) {
            const pending = JSON.parse(stored) as Preview;
            if (pending.body?.action === "create_order" && pending.body.expectedActorId === actorId && pending.body.storeId === nextStore && typeof pending.body.requestId === "string" && Array.isArray(pending.body.items) && pending.attempted) setPreview(pending);
          }
        } catch { /* Keep current drafts usable if local storage is unavailable. */ }
      }
    } catch (failure) {
      if (sequence === loadSequence.current && activeStore.current === nextStore) setError(failure instanceof Error ? failure.message : "需要を読み込めませんでした。");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const nextStore = params.get("storeId")?.trim() || "";
      const productId = params.get("productId")?.trim() || "";
      if (productId) { setQuery(productId); setFilter("all"); setManualProduct(productId); }
      activeStore.current = nextStore; setStoreId(nextStore); setSelected([]); setDecision(null); setBuyerId(""); setAdditionalConfirmed(false);
      void load(nextStore);
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => { ++loadSequence.current; window.removeEventListener("popstate", readLocation); };
  }, [load]);

  useEffect(() => {
    if (!preview || typeof document === "undefined") return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    previewDialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewRef.current?.attempted) { event.preventDefault(); setPreview(null); }
      if (event.key !== "Tab") return;
      const controls = previewDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === previewDialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [Boolean(preview)]);

  const demands = visibleData?.demands ?? [];
  const shown = demands.filter(demand => {
    const matches = filter === "all" || filter === "pending" && ["open", "reviewing"].includes(demand.status) || filter === "ordered" && demand.status === "ordered" || filter === "deferred" && demand.status === "deferred" || filter === "history" && ["resolved", "dismissed"].includes(demand.status);
    return matches && `${demand.product.name} ${demand.product.id} ${demand.storeName} ${demand.note}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  const selectedDemands = useMemo(() => demands.filter(demand => selected.includes(demand.id)), [demands, selected]);
  const selectedHasOpen = selectedDemands.some(demand => demand.openItemIds.length > 0);
  const draftFor = (demand: ReplenishmentDemand) => drafts[demand.id] ?? initialDraft(demand);
  const stale = (demand: ReplenishmentDemand) => draftFor(demand).version !== demand.version || draftFor(demand).unit !== demand.product.unit;
  const unsavedJudgment = selectedDemands.some(demand => draftFor(demand).note !== demand.note);
  const validSelection = selectedDemands.length > 0 && selectedDemands.length === selected.length && !unsavedJudgment && selectedDemands.every(demand => canOrder(demand) && !stale(demand) && quantity(draftFor(demand).quantity) !== null);
  const validOrder = Boolean(visibleData?.canManage && visibleData.operator?.id && storeId && validSelection && visibleData.buyers.some(buyer => buyer.id === buyerId) && deadline && (!selectedHasOpen || additionalConfirmed));

  function changeStore(nextStore: string) {
    activeStore.current = nextStore; setStoreId(nextStore); setData(null); setSelected([]); setDecision(null); setManualOpen(false); setBuyerId(""); setAdditionalConfirmed(false); setCreatedOrder("");
    const url = new URL(window.location.href);
    if (nextStore) url.searchParams.set("storeId", nextStore); else url.searchParams.delete("storeId");
    window.history.replaceState(window.history.state, "", url);
    void load(nextStore);
  }

  function changeDraft(demand: ReplenishmentDemand, patch: Partial<Draft>) {
    setDrafts(current => ({ ...current, [demand.id]: { ...(current[demand.id] ?? initialDraft(demand)), ...patch } }));
  }

  async function review(demand: ReplenishmentDemand, status: ReplenishmentDemandStatus, note?: string, until?: string) {
    if (busy || stale(demand)) return;
    const draft = draftFor(demand);
    if (draft.quantity.trim() && quantity(draft.quantity) === null) { setError("1〜999の整数"); return; }
    const viewStore = storeId;
    const body: ReplenishmentDemandReview = { action: "review", storeId: demand.storeId, demandId: demand.id, expectedVersion: draft.version, status, quantity: quantity(draft.quantity), unit: draft.unit, note: note ?? draft.note, deferredUntil: until || null };
    setSaving(demand.id); setError("");
    try {
      const response = await fetch("/api/os/replenishment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 && activeStore.current === viewStore) await load(viewStore);
        throw new Error(result.error || "需要を保存できませんでした。");
      }
      setDrafts(current => { const next = { ...current }; delete next[demand.id]; return next; });
      setDecision(null); showNotice(t("判断を保存しました。"));
      if (activeStore.current === viewStore) await load(viewStore);
    } catch (failure) { if (activeStore.current === viewStore) setError(failure instanceof Error ? failure.message : "需要を保存できませんでした。"); }
    finally { setSaving(""); }
  }

  async function report() {
    const product = visibleData?.products.find(item => item.id === manualProduct);
    if (busy || !visibleData?.canManage || !storeId || !product || (manualQuantity.trim() && quantity(manualQuantity) === null)) return;
    const input = { action: "report", storeId, productId: product.id, unit: product.unit, quantity: quantity(manualQuantity), note: manualNote };
    const key = JSON.stringify(input);
    if (!manualRequest.current || manualRequest.current.key !== key) manualRequest.current = { key, requestId: crypto.randomUUID() };
    const viewStore = storeId;
    setSaving("manual"); setError("");
    try {
      const response = await fetch("/api/os/replenishment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId: manualRequest.current.requestId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "需要を保存できませんでした。");
      manualRequest.current = null; setManualProduct(""); setManualQuantity(""); setManualNote(""); setManualOpen(false); showNotice(t("需要を保存しました。"));
      if (activeStore.current === viewStore) await load(viewStore);
    } catch (failure) { if (activeStore.current === viewStore) setError(failure instanceof Error ? failure.message : "需要を保存できませんでした。"); }
    finally { setSaving(""); }
  }

  function prepareOrder() {
    if (!validOrder || busy) return;
    const body: ReplenishmentDemandCreateOrder = {
      action: "create_order", storeId, requestId: crypto.randomUUID(), expectedActorId: visibleData!.operator!.id, buyerId, deadline, note: orderNote,
      additionalOrderConfirmed: additionalConfirmed,
      items: selectedDemands.map(demand => ({ demandId: demand.id, expectedVersion: draftFor(demand).version, quantity: quantity(draftFor(demand).quantity)!, unit: draftFor(demand).unit, expectedOpenItemIds: [...demand.openItemIds] }))
    };
    setPreview({ body, names: selectedDemands.map(demand => ({ id: demand.id, name: demand.product.name })), buyerName: visibleData?.buyers.find(buyer => buyer.id === buyerId)?.name ?? "", storeName: visibleData?.stores.find(store => store.id === storeId)?.name ?? "", attempted: false });
  }

  async function issueOrder() {
    const current = previewRef.current;
    if (!current || busy) return;
    const attempted = { ...current, attempted: true };
    setPreview(attempted);
    try { window.sessionStorage.setItem(pendingKey(current.body.expectedActorId, current.body.storeId), JSON.stringify(attempted)); } catch { /* Keep the same request in memory. */ }
    setSaving("order"); setError("");
    try {
      const response = await fetch("/api/os/replenishment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current.body) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          // A known rejection is safe to review again. Transport/server failures
          // retain the original idempotency key and immutable request body.
          setPreview(null);
          // An expired/switched identity cannot establish whether the original
          // employee's earlier attempt committed. Keep that employee's retry.
          if (![401, 403].includes(response.status) && body.code !== "actor_changed") forgetPending(current);
          if (activeStore.current === current.body.storeId) await load(current.body.storeId);
        }
        throw new Error(body.error || "発注結果を確認できません。同じ内容で再確認してください。");
      }
      forgetPending(current); setPreview(null); setSelected([]); setAdditionalConfirmed(false);
      setDrafts(previous => { const next = { ...previous }; current.body.items.forEach(item => delete next[item.demandId]); return next; });
      setCreatedOrder(body.orderId || ""); showNotice(t("発注を作成しました。"));
      if (activeStore.current === current.body.storeId) await load(current.body.storeId);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "発注結果を確認できません。同じ内容で再確認してください。"); }
    finally { setSaving(""); }
  }

  function sourceLine(source: ReplenishmentSource) {
    const confidence = source.stockRevision === 0 ? "元の記録・実数再確認" : source.countConfidence === "confirmed" ? "実数確認済み" : source.countConfidence === "stale" ? "古い記録・要再確認" : "未確認";
    return <li key={`${source.kind}:${source.id}`} className={styles.source}>
      <div><strong>{source.kind === "inventory" ? source.locationName || t("保管場所未設定") : source.name}</strong><span className={styles.badge}>{t(source.kind === "inventory" ? "自動在庫チェック" : source.kind === "item" ? "メニュー" : "選択肢")}</span><span>{t(source.stockStatus === "unavailable" ? "在庫切れ" : "残りわずか")}</span></div>
      {source.kind === "inventory" ? <><p>{t("現在庫")} {number(source.quantity)} {source.countUnit || ""} · {t(confidence)}{source.conversionChanged ? ` · ${t("換算が変わりました")}` : ""}</p><p>{t("最終棚卸")} {date(source.lastCountedAt)}{source.purchaseEquivalent ? ` · ${t("購入単位の目安")} ${number(source.purchaseEquivalent.quantity)} ${source.purchaseEquivalent.unit}` : ""}{source.quickCheck ? ` · ${t("目視確認")}` : ""}</p></> : null}
      {source.note ? <p>{source.note}</p> : null}
    </li>;
  }

  return <main className={`shell ${styles.page}`}>
    <aside className="sidebar" aria-label="管理画面ナビゲーション"><a className="brand-block" href="/os" aria-label="OS ホームへ戻る"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 OS</p><h1>Foundr1 OS</h1></div></a><MobileNavMenu navItems={canonicalNavItems} /><div className="sidebar-user"><UserBadge /></div><OsNavList navItems={canonicalNavItems} /></aside>
    <section className="workspace" data-i18n-ignore>
      <header className={`topbar ${styles.topbar}`}><div><p className="eyebrow">{t("不足をまとめて、確認してから発注")}</p><h2>{t("補充需要")}</h2><p className={styles.help}>{t("店舗とシステムからの需要を、同じ店舗・SKUごとに確認します。報告数をそのまま購入数量に足しません。")}</p></div>
        <div className={styles.topActions}><label>{t("店舗")}<select aria-label={t("店舗")} value={storeId} disabled={loading || busy || Boolean(preview)} onChange={event => changeStore(event.target.value)}><option value="">{t("すべての店舗")}</option>{data?.stores.map(store => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label><button className="secondary-button" type="button" disabled={loading || busy} onClick={() => void load(storeId)}><RefreshCw size={16} />{t(loading ? "更新中" : "更新")}</button>{visibleData?.canManage && storeId ? <button className="primary-button" type="button" disabled={busy || Boolean(preview)} onClick={() => setManualOpen(value => !value)}><Plus size={16} />{t("需要を追加")}</button> : null}</div>
      </header>
      <div className={styles.content}>
        {error ? <div className={styles.alert} role="alert"><AlertTriangle size={17} /><span>{t(error)}</span></div> : null}
        {createdOrder ? <div className={styles.success} role="status"><Check size={17} />{t("発注を作成しました。")}<a href={`/os/procurement?order=${encodeURIComponent(createdOrder)}`}>{t("購入管理を開く")}</a></div> : null}
        {manualOpen && visibleData?.canManage && storeId ? <section className={`panel ${styles.manual}`} aria-label={t("需要を追加")}><div className={styles.sectionHeading}><h3>{t("需要を追加")}</h3><button type="button" className={styles.iconButton} aria-label={t("閉じる")} onClick={() => setManualOpen(false)} disabled={busy}><X size={18} /></button></div><div className={styles.formGrid}>
          <label>{t("追加する商品を検索")}<input value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} /></label><label>{t("正確なSKUを選択")}<select value={manualProduct} onChange={event => setManualProduct(event.target.value)}><option value="">{t("商品を選択してください")}</option>{visibleData.products.filter(product => product.id === manualProduct || `${product.name} ${product.id}`.toLocaleLowerCase().includes(catalogQuery.toLocaleLowerCase())).map(product => <option value={product.id} key={product.id}>{product.name} · {product.unit} · {product.id.slice(-8)}</option>)}</select></label>
          <label>{t("発注数量")}<div className={styles.quantityInput}><input inputMode="numeric" aria-label={t("発注数量")} value={manualQuantity} onChange={event => setManualQuantity(event.target.value)} placeholder={t("数量未定")} />{visibleData.products.find(product => product.id === manualProduct)?.unit}</div><small>{t("数量は空欄でも報告できます。")}</small></label><label>{t("報告メモ")}<input value={manualNote} onChange={event => setManualNote(event.target.value)} maxLength={2000} /></label>
        </div><div className={styles.formFooter}><button type="button" className="primary-button" disabled={busy || !manualProduct || (manualQuantity.trim() !== "" && quantity(manualQuantity) === null)} onClick={() => void report()}>{t(saving === "manual" ? "保存中" : "需要を保存")}</button></div></section> : null}
        <div className={styles.toolbar}><div className={styles.tabs} role="group" aria-label={t("補充需要")}>{([["pending", "対応待ち"], ["ordered", "購入・入庫待ち"], ["deferred", "保留"], ["history", "履歴"], ["all", "すべて"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(label)}<span>{demands.filter(demand => value === "all" || value === "pending" && ["open", "reviewing"].includes(demand.status) || value === "ordered" && demand.status === "ordered" || value === "deferred" && demand.status === "deferred" || value === "history" && ["resolved", "dismissed"].includes(demand.status)).length}</span></button>)}</div><label className={styles.search}><Search size={16} /><input aria-label={t("商品名・店舗・メモを検索")} placeholder={t("商品名・店舗・メモを検索")} value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {!storeId ? <p className={styles.help}>{t("店舗を選ぶと、需要の追加と正式な発注ができます。")}</p> : null}
        {loading && !visibleData ? <div className={styles.empty}>{t("更新中")}</div> : !shown.length ? <div className={styles.empty}><PackageSearch size={24} /><p>{t("この条件の需要はありません。")}</p></div> : <div className={styles.list}>{shown.map(demand => {
          const draft = draftFor(demand); const isStale = stale(demand); const editable = Boolean(visibleData?.canManage && !["resolved", "dismissed"].includes(demand.status));
          const displayedOrders = [...new Map([...demand.orders, ...demand.openOrders].map(order => [order.itemId, order])).values()];
          return <article className={`panel ${styles.demand}`} key={demand.id}>
            <div className={styles.demandHeader}>{storeId && canOrder(demand) && visibleData?.canManage ? <input className={styles.checkbox} type="checkbox" aria-label={`${demand.product.name} ${t("選択した需要")}`} checked={selected.includes(demand.id)} disabled={busy || Boolean(preview)} onChange={event => { setSelected(current => event.target.checked ? [...current, demand.id] : current.filter(id => id !== demand.id)); setAdditionalConfirmed(false); }} /> : <ClipboardList size={18} className={styles.muted} />}
              <div className={styles.identity}><h3>{demand.product.name}</h3><p>{demand.storeName} · {t("発注・購入単位")} {demand.product.unit}<span className={styles.sku} title={demand.product.id}>SKU {demand.product.id.slice(-8)}</span></p></div><span className={`${styles.status} ${["needs_review", "partial_received"].includes(demand.progress) ? styles.warningStatus : demand.progress === "resolved" ? styles.doneStatus : ""}`}>{t(progressLabels[demand.progress])}</span></div>
            {!demand.product.isOrderable ? <p className={styles.warning}>{t("発注できない商品です。商品公開・停止状態を確認してください。")}</p> : null}
            {demand.deferredUntil && demand.status === "deferred" ? <p className={styles.help}>{t("保留期限")} {date(demand.deferredUntil)}</p> : null}
            {editable ? <><div className={styles.reviewFields}><label>{t("発注数量")}<div className={styles.quantityInput}><input inputMode="numeric" value={draft.quantity} aria-label={`${demand.product.name} ${t("発注数量")}`} placeholder={t("数量未定")} disabled={busy || Boolean(preview)} onChange={event => changeDraft(demand, { quantity: event.target.value })} /><span>{draft.unit}</span></div><small>{t("1〜999の整数")}</small></label><label>{t("判断メモ")}<textarea rows={2} value={draft.note} placeholder={t("追加・減量・保留の理由など")} maxLength={2000} disabled={busy || Boolean(preview)} onChange={event => changeDraft(demand, { note: event.target.value })} /></label></div>
              {isStale ? <div className={styles.stale}><span>{t("他の操作で内容が変わりました。入力は保持しています。最新の記録と照合してください。")}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => changeDraft(demand, { version: demand.version, unit: demand.product.unit, ...(draft.unit !== demand.product.unit ? { quantity: "" } : {}) })}>{t("内容を確認して再編集")}</button></div> : null}
              <div className={styles.rowActions}><button className="secondary-button" type="button" disabled={busy || isStale || Boolean(preview) || (draft.quantity.trim() !== "" && quantity(draft.quantity) === null)} onClick={() => void review(demand, demand.status === "open" ? "reviewing" : demand.status)}>{t(saving === demand.id ? "保存中" : "変更を保存")}</button>{demand.status === "deferred" ? <button type="button" disabled={busy || isStale || Boolean(preview)} onClick={() => void review(demand, "reviewing")}>{t("再開")}</button> : <button type="button" disabled={busy || isStale || Boolean(preview)} onClick={() => setDecision({ demandId: demand.id, status: "deferred", note: "", until: "" })}>{t("保留にする")}</button>}<button type="button" disabled={busy || isStale || Boolean(preview)} onClick={() => setDecision({ demandId: demand.id, status: "resolved", note: "", until: "" })}>{t("充足を確認")}</button><button type="button" disabled={busy || isStale || Boolean(preview)} onClick={() => setDecision({ demandId: demand.id, status: "dismissed", note: "", until: "" })}>{t("見送る")}</button></div>
              {decision?.demandId === demand.id ? <div className={styles.decision}>{decision.status === "resolved" ? <p>{t("実際の在庫・到着状況を確認して充足済みにします。購入完了だけでは充足済みになりません。")}</p> : null}<label>{t("理由・確認内容")}<input value={decision.note} onChange={event => setDecision(current => current ? { ...current, note: event.target.value } : current)} placeholder={t("確認内容を記録してください。")} maxLength={2000} /></label>{decision.status === "deferred" ? <label>{t("保留期限")}<input type="date" value={decision.until} onChange={event => setDecision(current => current ? { ...current, until: event.target.value } : current)} /></label> : null}<div className={styles.rowActions}><button type="button" className="primary-button" disabled={busy || !decision.note.trim() || (decision.status === "deferred" && !decision.until)} onClick={() => void review(demand, decision.status, decision.note, decision.until)}>{t("決定を保存")}</button><button type="button" disabled={busy} onClick={() => setDecision(null)}>{t("キャンセル")}</button></div></div> : null}</> : demand.note ? <p>{demand.note}</p> : null}
            <div className={styles.facts}>
              {demand.inventory.length > 0 ? <details open><summary><ChevronDown size={14} />{t("SKUごとの在庫・目視確認")}<span>{demand.inventory.length} {t("件")}</span></summary><p className={styles.help}>{t("保管場所ごとに単位・数量を確認してください。異なる単位の数量は合計しません。")}</p><ul>{demand.inventory.map(item => <li className={styles.source} key={item.id}><div><strong>{item.locationName || t("保管場所未設定")}</strong><span>{t("現在庫")} {number(item.quantity)} {item.countUnit}</span><span>{t("安全在庫")} {number(item.safetyStock)} {item.countUnit}</span></div><p>{t("最終棚卸")} {date(item.lastCountedAt)}{item.quickStatus ? ` · ${t("目視確認")} ${t(({ enough: "足りる", low: "残りわずか", out: "在庫切れ" } as Record<string, string>)[item.quickStatus] || "未確認")} ${date(item.quickCheckedAt)}` : ""}</p></li>)}</ul></details> : null}
              {demand.sources.length > 0 ? <details><summary><ChevronDown size={14} />{t("不足の根拠")}<span>{demand.sources.length} {t("件")}</span></summary><ul>{demand.sources.map(sourceLine)}</ul></details> : null}
              {displayedOrders.length > 0 ? <details open><summary><ChevronDown size={14} />{t("入庫・在途・既存発注")}<span>{displayedOrders.length} {t("件")}</span></summary><ul>{displayedOrders.map(order => <li key={order.itemId} className={styles.order}><div><a href={`/os/procurement?order=${encodeURIComponent(order.orderNo)}`}>{order.orderNo}</a><span className={styles.badge}>{t(orderLabels[order.status] || "再確認が必要")}</span></div><p>{t("依頼")} {number(order.requestedQuantity)} {order.unit} · {t("実購")} {number(order.actualQuantity)} {order.actualUnit || ""} · {t("入庫")} {number(order.actualUnit ? order.receivedQuantity : null)} {order.actualUnit || ""}</p></li>)}</ul></details> : null}
              <details><summary><ChevronDown size={14} />{t("履歴・報告")}<span>{demand.events.length} {t("件")}</span></summary>{demand.events.length ? <ul>{demand.events.map(event => <li className={styles.event} key={event.id}><div><span>{t(eventLabels[event.kind] || "担当者判断")}</span><span>{event.actorName || t("自動チェック")} · {date(event.createdAt)}</span></div>{event.quantity !== null ? <p>{t("依頼")} {number(event.quantity)} {event.unit || t("未確認")}</p> : null}{event.shortageStatus ? <p>{t(event.shortageStatus === "unavailable" ? "在庫切れ" : "残りわずか")}</p> : null}{event.note ? <p>{event.note}</p> : null}</li>)}</ul> : <p className={styles.help}>{t("記録なし")}</p>}</details>
            </div>
          </article>;
        })}</div>}
        {storeId && visibleData?.canManage ? <section className={`panel ${styles.orderPanel}`} aria-label={t("発注内容を確認")}><h3>{t("選択した需要")} <span>{selectedDemands.length} {t("件")}</span></h3><p className={styles.help}>{t("数量を自動提案しません。棚卸・在途・必要量を確認して入力してください。")}</p><div className={styles.formGrid}><label>{t("購入担当")}<select value={buyerId} disabled={busy || Boolean(preview)} onChange={event => setBuyerId(event.target.value)}><option value="">{t("選択してください")}</option>{visibleData.buyers.map(buyer => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}</select></label><label>{t("希望納品日")}<input type="date" value={deadline} disabled={busy || Boolean(preview)} onChange={event => setDeadline(event.target.value)} /></label><label className={styles.fullWidth}>{t("発注メモ")}<input maxLength={2000} value={orderNote} disabled={busy || Boolean(preview)} onChange={event => setOrderNote(event.target.value)} /></label></div>{selectedHasOpen ? <label className={styles.checkLabel}><input type="checkbox" checked={additionalConfirmed} disabled={busy || Boolean(preview)} onChange={event => setAdditionalConfirmed(event.target.checked)} /><span>{t("既存の未完了発注を確認し、それでも追加が必要です。")}</span></label> : null}<div className={styles.formFooter}>{!validOrder ? <small>{t(unsavedJudgment ? "判断メモは発注前に保存してください。" : "需要を選択し、数量・購入担当・希望納品日を入力してください。")}</small> : null}<button type="button" className="primary-button" disabled={!validOrder || busy || Boolean(preview)} onClick={prepareOrder}>{t("発注内容を確認")}</button></div></section> : null}
      </div>
      {preview ? <div className={styles.backdrop}><section className={styles.preview} ref={previewDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="replenishment-preview-title"><div className={styles.sectionHeading}><h3 id="replenishment-preview-title">{t("発注内容の最終確認")}</h3>{!preview.attempted ? <button type="button" className={styles.iconButton} aria-label={t("閉じる")} onClick={() => setPreview(null)} disabled={busy}><X size={18} /></button> : null}</div><p>{t("正式な発注を作成し、購入担当に依頼します。")}</p><dl className={styles.previewMeta}><div><dt>{t("店舗")}</dt><dd>{preview.storeName}</dd></div><div><dt>{t("購入担当")}</dt><dd>{preview.buyerName}</dd></div><div><dt>{t("希望納品日")}</dt><dd>{preview.body.deadline}</dd></div></dl><ul className={styles.previewItems}>{preview.body.items.map(item => <li key={item.demandId}><span>{preview.names.find(entry => entry.id === item.demandId)?.name}</span><strong>{item.quantity} {item.unit}</strong></li>)}</ul><p className={styles.help}>{t("発注先は購入管理で確認してください。")}</p>{preview.body.note ? <p>{preview.body.note}</p> : null}{preview.attempted && error ? <p className={styles.alert} role="alert">{t(error)}</p> : null}<div className={styles.formFooter}>{!preview.attempted ? <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>{t("キャンセル")}</button> : null}<button type="button" className="primary-button" disabled={busy} onClick={() => void issueOrder()}>{t(saving === "order" ? "送信中" : preview.attempted ? "同じ内容で結果を確認" : "発注を確定する")}</button></div></section></div> : null}
    </section><ActionNotice notice={notice} onClose={clearNotice} />
  </main>;
}
