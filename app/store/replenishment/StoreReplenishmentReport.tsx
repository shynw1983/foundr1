"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import type { ReplenishmentDemandProduct, ReplenishmentDemandReport } from "../../../lib/replenishment-demand-types";
import styles from "./replenishment.module.css";

type Draft = { productId: string; unit: string; quantityText: string; note: string; shortageStatus: "low_stock" | "unavailable" };
type SavedReport = { draft: Draft; pending: ReplenishmentDemandReport | null };
const emptyDraft: Draft = { productId: "", unit: "", quantityText: "", note: "", shortageStatus: "low_stock" };
const requestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey = (storeId: string, operatorId: string) => `foundr1-store:replenishment-report:v1:${storeId}:${operatorId}`;

function readSaved(key: string, storeId: string, operatorId: string): SavedReport | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as SavedReport | null;
    if (!value?.draft || ["productId", "unit", "quantityText", "note"].some(field => typeof value.draft[field as keyof Draft] !== "string")) return null;
    if (!["low_stock", "unavailable"].includes(value.draft.shortageStatus)) return null;
    const pending = value.pending;
    if (pending && (pending.action !== "report" || pending.storeId !== storeId || pending.expectedOperatorId !== operatorId || !requestPattern.test(pending.requestId))) return null;
    return value;
  } catch { return null; }
}

/** A report is scoped to the employee who wrote it. Uncertain sends keep their exact body and nonce. */
export function StoreReplenishmentReport({ storeId, expectedOperatorId, canOperate, products, initialProductId = "", onRecorded, onAuthorizationRequired }: {
  storeId: string; expectedOperatorId: string; canOperate: boolean; products: ReplenishmentDemandProduct[];
  initialProductId?: string; onRecorded: () => void; onAuthorizationRequired: () => void;
}) {
  const { t } = useOsTranslation();
  const scope = `${storeId}:${expectedOperatorId}`, key = storageKey(storeId, expectedOperatorId);
  const [state, setState] = useState<{ scope: string; draft: Draft; pending: ReplenishmentDemandReport | null }>({ scope, draft: emptyDraft, pending: null });
  const [hydratedScope, setHydratedScope] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const activeScope = useRef(scope), mounted = useRef(false), writing = useRef(false);
  const productsRef = useRef(products); productsRef.current = products;
  const pendingRef = useRef<ReplenishmentDemandReport | null>(null);
  activeScope.current = scope;
  useEffect(() => {
    mounted.current = true;
    const saved = readSaved(key, storeId, expectedOperatorId);
    const initialProduct = productsRef.current.find(item => item.id === initialProductId);
    setState({ scope, draft: saved?.draft ?? (initialProduct ? { ...emptyDraft, productId: initialProduct.id, unit: initialProduct.unit } : emptyDraft), pending: saved?.pending ?? null });
    pendingRef.current = saved?.pending ?? null;
    setHydratedScope(scope); setError(""); setNotice(""); setBusy(false);
    return () => { mounted.current = false; };
  }, [scope, key, storeId, expectedOperatorId, initialProductId]);
  const current = hydratedScope === scope && state.scope === scope ? state : null;
  const draft = current?.draft ?? emptyDraft, pending = current?.pending ?? null;
  const product = products.find(item => item.id === draft.productId);
  const changedUnit = Boolean(product && draft.unit !== product.unit);
  const quantity = draft.quantityText.trim() ? Number(draft.quantityText) : null;
  const validQuantity = quantity === null || (/^\d+$/.test(draft.quantityText.trim()) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 999);
  const valid = Boolean(current && product && !changedUnit && validQuantity);
  const locked = busy || Boolean(pending) || !canOperate || !current;

  function change(next: Partial<Draft>) {
    if (locked) return;
    const updated = { ...draft, ...next };
    setState({ scope, draft: updated, pending: null }); setError(""); setNotice("");
    try { window.localStorage.setItem(key, JSON.stringify({ draft: updated, pending: null })); }
    catch { setError("入力内容を端末に保存できません。送信前に再確認してください。"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !canOperate || !expectedOperatorId || writing.current || (!pendingRef.current && !valid)) return;
    const payload: ReplenishmentDemandReport = pendingRef.current ?? {
      action: "report", requestId: crypto.randomUUID(), storeId, expectedOperatorId,
      productId: draft.productId, quantity, unit: draft.unit, note: draft.note.trim(), shortageStatus: draft.shortageStatus
    };
    if (payload.storeId !== storeId || payload.expectedOperatorId !== expectedOperatorId) return;
    const savedScope = scope, savedKey = key, savedDraft = draft;
    try { window.localStorage.setItem(savedKey, JSON.stringify({ draft: savedDraft, pending: payload })); }
    catch { setError("送信内容を保存できませんでした。もう一度確認してください。"); return; }
    pendingRef.current = payload; setState({ scope, draft, pending: payload });
    writing.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/store/replenishment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      const authorizedAgain = response.status === 401 || response.status === 403 || body.code === "operator_changed";
      const confirmed = response.ok && body.ok === true && typeof body.demandId === "string";
      // Clear the original employee's saved record only after a definitive result, even if they left this screen.
      if (confirmed) {
        try { window.localStorage.removeItem(savedKey); } catch { /* The stable request ID still prevents duplicate reports. */ }
      } else if (!response.ok && response.status < 500 && !authorizedAgain) {
        try { window.localStorage.setItem(savedKey, JSON.stringify({ draft: savedDraft, pending: null })); } catch { /* Preserve the visible draft. */ }
      }
      if (!mounted.current || activeScope.current !== savedScope) return;
      if (confirmed) {
        pendingRef.current = null; setState({ scope, draft: emptyDraft, pending: null });
        setNotice(body.replayed ? "この報告は登録済みです。重複して追加しません。" : "補充の必要を報告しました。担当者が内容を確認します。");
        onRecorded(); return;
      }
      if (authorizedAgain) {
        setError(body.error || "操作担当者を再確認してください。同じ担当者で報告を再送できます。");
        onAuthorizationRequired(); return;
      }
      if (!response.ok && response.status < 500) {
        pendingRef.current = null; setState({ scope, draft: savedDraft, pending: null }); onRecorded();
      }
      setError(body.error || (response.ok || response.status >= 500 ? "送信結果を確認できません。同じ内容で再送してください。" : "報告内容と最新の商品情報を確認してください。"));
    } catch {
      if (mounted.current && activeScope.current === savedScope) setError("送信結果を確認できません。同じ内容で再送してください。");
    } finally {
      writing.current = false;
      if (mounted.current && activeScope.current === savedScope) setBusy(false);
    }
  }

  return <section className={styles.section} aria-label={t("補充の必要を報告")} data-store-replenishment-report data-i18n-ignore>
    <h2>{t("補充の必要を報告")}</h2>
    <p className={styles.hint}>{t("不足に気づいた商品を報告します。正式な発注数量は担当者が確認して決定します。")}</p>
    {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
    {notice ? <p className={styles.notice} role="status">{t(notice)}</p> : null}
    {pending ? <p className={styles.warning}>{t("送信結果を確認中です。内容を変えず、元の操作担当者で同じ報告を再送してください。")}</p> : null}
    <form onSubmit={event => void submit(event)}>
      <div className={styles.fields}>
        <label className={styles.productField}><span>{t("不足している商品")}</span>
          <select name="productId" required value={draft.productId} disabled={locked} onChange={event => {
            const selected = products.find(item => item.id === event.target.value);
            change({ productId: selected?.id ?? "", unit: selected?.unit ?? "", quantityText: "" });
          }}>
            <option value="">{t("選択してください")}</option>
            {products.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit} · {item.id.slice(-8)}</option>)}
            {draft.productId && !product ? <option value={draft.productId}>{t("選択した商品を確認してください")}</option> : null}
          </select>
        </label>
        <label><span>{t("不足の状況")}</span><select name="shortageStatus" value={draft.shortageStatus} disabled={locked} onChange={event => change({ shortageStatus: event.target.value as Draft["shortageStatus"] })}><option value="low_stock">{t("残りわずか")}</option><option value="unavailable">{t("ない")}</option></select></label>
        <label><span>{t("希望数量（任意）")}</span><div className={styles.quantity}>
          <input name="quantity" inputMode="numeric" autoComplete="off" value={draft.quantityText} disabled={locked || !product} placeholder={t("未定でも報告できます")} onChange={event => change({ quantityText: event.target.value })} />
          <span>{draft.unit}</span>
        </div></label>
        <label className={styles.noteField}><span>{t("現場メモ（任意）")}</span>
          <textarea name="note" rows={2} maxLength={1000} value={draft.note} disabled={locked} placeholder={t("残りの様子、必要な時期など")} onChange={event => change({ note: event.target.value })} />
        </label>
      </div>
      {!validQuantity ? <p className={styles.error}>{t("希望数量は1〜999の整数で入力するか、空欄にしてください。")}</p> : null}
      {changedUnit ? <div className={styles.warning}><p>{t("商品の単位が変わりました。数量を入力し直してください。")}</p><button type="button" className="secondary-button" disabled={locked} onClick={() => change({ unit: product?.unit ?? "", quantityText: "" })}>{t("現在の商品単位で入力し直す")}</button></div> : null}
      <div className={styles.actions}><p className={styles.hint}>{t("同じ店舗・商品の報告はまとめて確認されます。報告回数で数量は増えません。")}</p>
        <button type="submit" className="primary-button" disabled={busy || !canOperate || !current || (!pending && !valid)}>{t(busy ? "送信中" : pending ? "同じ内容で再送" : "担当者に報告")}</button>
      </div>
    </form>
  </section>;
}
