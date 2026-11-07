"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizePosCounterMenuPolicy } from "../../../lib/pos-counter-menu-policy";
import type { PosCounterMenuSettings } from "../../../lib/pos-counter-menu-settings";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosCounterMenuPolicySettings.module.css";

const readError = "共用メニューの設定を読み込めませんでした。";
const saveError = "共用メニューの設定を保存できませんでした。";
const savedNotice = "共用メニューの設定を保存しました。POS のページ全体を再読み込みしてください。";
const refreshConfirm = "再読み込みすると、この欄の未保存の変更は破棄されます。続けますか？";
type Policy = PosCounterMenuSettings["policy"];
type ApiResult = { selectedStoreId?: string; counterMenu?: PosCounterMenuSettings; access?: { canManagePosSettings?: boolean }; error?: string };

export function PosCounterMenuPolicySettings({ storeId, active, canManage, blocked }: { storeId: string; active: boolean; canManage: boolean; blocked: boolean }) {
  const { t } = useOsTranslation();
  const [current, setCurrent] = useState<PosCounterMenuSettings | null>(null);
  const [draft, setDraft] = useState<Policy>(() => normalizePosCounterMenuPolicy(null));
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [canWrite, setCanWrite] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const scope = useRef(storeId), generation = useRef(0), requested = useRef("");
  const readRequest = useRef<AbortController | null>(null), savingRef = useRef(false);
  scope.current = storeId;

  useEffect(() => {
    requested.current = "";
    savingRef.current = false; setSaving(false); setLoading(false); setCanWrite(false);
    setCurrent(null); setDraft(normalizePosCounterMenuPolicy(null)); setError(""); setMessage("");
    return () => { generation.current++; readRequest.current?.abort(); readRequest.current = null; };
  }, [storeId]);

  const refresh = useCallback(async () => {
    const id = scope.current, epoch = generation.current;
    if (!id || savingRef.current || readRequest.current) return;
    requested.current = id;
    const controller = new AbortController(); readRequest.current = controller;
    const isCurrent = () => !controller.signal.aborted && scope.current === id && generation.current === epoch;
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/os/pos/settings?${new URLSearchParams({ storeId: id, section: "counterMenuPolicy" })}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({})) as ApiResult;
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) { setCurrent(null); setCanWrite(false); }
      if (!response.ok || body.selectedStoreId !== id || !body.counterMenu) throw new Error(body.error || readError);
      setCurrent(body.counterMenu); setDraft(normalizePosCounterMenuPolicy(body.counterMenu.policy)); setCanWrite(body.access?.canManagePosSettings === true);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : readError);
    } finally {
      if (readRequest.current === controller) readRequest.current = null;
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && storeId && requested.current !== storeId) void refresh();
  }, [active, storeId, refresh]);

  const normalizedDraft = normalizePosCounterMenuPolicy(draft);
  const dirty = Boolean(current && JSON.stringify(current.policy) !== JSON.stringify(normalizedDraft));
  const availableIds = new Set(current?.categories.map(category => category.id) ?? []);
  const unavailableIds = normalizedDraft.standardTaxCategoryIds.filter(id => !availableIds.has(id));
  const canEnable = current?.hasEnabledMenu === true && current.priceTaxMode === "tax_included";
  const editable = Boolean(current?.ready && canManage && canWrite && !blocked && !loading && !saving);
  const canSave = editable && dirty && (!normalizedDraft.sharedMenuForTakeout || (canEnable && !unavailableIds.length));

  async function save() {
    if (!current || !canSave || savingRef.current) return;
    const id = scope.current, epoch = generation.current;
    const isCurrent = () => scope.current === id && generation.current === epoch;
    savingRef.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/os/pos/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: id, section: "counterMenuPolicy", counterMenuPolicy: normalizedDraft,
          counterMenuPolicyRevision: current.revision, counterMenuRevision: current.menuRevision })
      });
      const body = await response.json().catch(() => ({})) as ApiResult;
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) setCanWrite(false);
      if (!response.ok || body.selectedStoreId !== id || !body.counterMenu) throw new Error(body.error || saveError);
      setCurrent(body.counterMenu); setDraft(normalizePosCounterMenuPolicy(body.counterMenu.policy)); setMessage(savedNotice);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : saveError);
    } finally {
      if (isCurrent()) { savingRef.current = false; setSaving(false); }
    }
  }

  function toggleCategory(id: string, checked: boolean) {
    setDraft(previous => ({ ...previous,
      standardTaxCategoryIds: checked ? [...previous.standardTaxCategoryIds, id] : previous.standardTaxCategoryIds.filter(categoryId => categoryId !== id),
      takeoutRestrictedCategoryIds: checked ? previous.takeoutRestrictedCategoryIds : previous.takeoutRestrictedCategoryIds.filter(categoryId => categoryId !== id)
    }));
  }

  return <section className={styles.section} aria-label={t("店内・持ち帰りの共用メニュー")} data-pos-settings-pane="counterMenuPolicy">
    <header><h4>{t("店内・持ち帰りの共用メニュー")}</h4><p>{t("店内飲食と店頭持ち帰りで、同じ店舗専用メニューと税込価格を使います。Web予約や外部デリバリーには反映しません。")}</p></header>
    {loading ? <p role="status">{t("読み込み中…")}</p> : null}
    {current ? <>
      {!current.ready ? <p className={styles.help}>{t("この設定を保存するには、POS 設定の更新が必要です。")}</p> : null}
      <label className={styles.check}><input type="checkbox" checked={draft.sharedMenuForTakeout} disabled={!editable || (!draft.sharedMenuForTakeout && !canEnable)}
        onChange={event => setDraft(previous => ({ ...previous, sharedMenuForTakeout: event.target.checked }))} /><span>{t("店頭持ち帰りにも店舗専用メニューを使う")}</span></label>
      {!current.hasEnabledMenu ? <p className={styles.help}>{t("共用する店内メニューを有効にしてください。")}</p> : null}
      {current.priceTaxMode !== "tax_included" ? <p className={styles.help}>{t("メニューを共用するには「税込価格」を保存してください。")}</p> : null}
      <p className={styles.help}>{t("税区分や税率を変更したときは、税率・販売設定を保存し、この欄を再読み込みしてください。")}</p>
      {draft.sharedMenuForTakeout ? <>
        <div className={styles.rates}><span>{t("店内飲食の税率")} <strong>{current.dineInTaxRate}%</strong></span><span>{t("持ち帰りの基本税率")} <strong>{current.takeoutTaxRate}%</strong></span></div>
        <fieldset className={styles.categories} disabled={!editable}>
          <legend>{t("持ち帰りに標準税率を使う分類")} <strong>{current.dineInTaxRate}%</strong></legend>
          <p className={styles.help}>{t("酒類などの標準税率対象を選択してください。店頭で持ち帰り販売をしない分類は「店内販売のみ」を選びます。")}</p>
          {current.categories.length ? current.categories.map(category => {
            const standard = draft.standardTaxCategoryIds.includes(category.id);
            return <div className={styles.category} key={category.id}>
              <label className={styles.check}><input type="checkbox" checked={standard} onChange={event => toggleCategory(category.id, event.target.checked)} />
                <span>{category.name}<small>{category.brandName}</small></span></label>
              {standard ? <label className={`${styles.check} ${styles.restricted}`}><input type="checkbox" checked={draft.takeoutRestrictedCategoryIds.includes(category.id)}
                onChange={event => setDraft(previous => ({ ...previous, takeoutRestrictedCategoryIds: event.target.checked
                  ? [...previous.takeoutRestrictedCategoryIds, category.id] : previous.takeoutRestrictedCategoryIds.filter(id => id !== category.id) }))} />
                <span>{t("店内販売のみ")}</span></label> : null}
            </div>;
          }) : <p className={styles.help}>{t("有効な店内メニューに商品分類がありません。")}</p>}
        </fieldset>
        {unavailableIds.length ? <div className={styles.warning}><p>{t("利用できなくなった分類が設定されています。指定を解除してから保存してください。")}</p>
          <button type="button" className="secondary-button" disabled={!editable} onClick={() => setDraft(previous => ({ ...previous,
            standardTaxCategoryIds: previous.standardTaxCategoryIds.filter(id => availableIds.has(id)),
            takeoutRestrictedCategoryIds: previous.takeoutRestrictedCategoryIds.filter(id => availableIds.has(id))
          }))}>{t("利用できない分類の指定を解除")}</button></div> : null}
      </> : null}
    </> : null}
    <div className={styles.actions}>
      <button type="button" className="secondary-button" disabled={!storeId || loading || saving || blocked} onClick={() => {
        if (!dirty || window.confirm(t(refreshConfirm))) void refresh();
      }}>{t("共用メニュー設定を再読み込み")}</button>
      <button type="button" className="primary-button" disabled={!canSave} onClick={() => void save()}>{t(saving ? "保存中..." : "共用メニュー設定を保存")}</button>
      {current && dirty ? <small>{t("この欄に未保存の変更があります。")}</small> : null}
    </div>
    {error ? <p role="alert" className={styles.warning}>{t(error)}</p> : null}
    {message ? <p role="status">{t(message)}</p> : null}
  </section>;
}
