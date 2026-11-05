"use client";

import { Check, Palette, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useOsTranslation } from "../../../os/components/OsTranslationProvider";
import { createStoreThemePalette, getDefaultStoreTheme, normalizeStoreThemeColor, storeThemeTargets, type StoreThemeContext, type StoreThemeMode, type StoreThemeTarget } from "../../../../lib/store-theme";
import { StoreNavTabs } from "../../components/StoreNavTabs";
import { StoreThemeEditorScope, useStoreTheme } from "../../components/StoreThemeProvider";
import { setStoredStoreSelection, storeSelectionEventName } from "../../components/store-selection";
import styles from "./appearance.module.css";

const targetLabels: Record<StoreThemeTarget, string> = {
  operations: "Store操作画面", pickup: "呼出画面", customer: "POSお客様画面", courier: "配達員向け表示"
};
const presets = [
  { color: "#c30d23", label: "ブランドレッド" },
  { color: "#00977b", label: "ジェイド" }, { color: "#0098b0", label: "ターコイズ" },
  { color: "#3478d4", label: "アジュール" }, { color: "#8264d9", label: "アイリス" },
  { color: "#d85d8b", label: "ピオニー" }, { color: "#ea8054", label: "コーラル" }
].map(preset => {
  const palette = createStoreThemePalette(preset.color);
  return { ...preset, style: {
    "--preset-primary": palette["--store-primary"], "--preset-on-primary": palette["--store-on-primary"],
    "--preset-soft": palette["--store-primary-soft"], "--preset-focus": palette["--store-primary-text"],
    "--preset-bg": palette["--store-bg"], "--preset-panel": palette["--store-panel"], "--preset-line": palette["--store-line"]
  } as CSSProperties };
});

type Draft = { storeId: string; target: StoreThemeTarget; mode: StoreThemeMode; color: string; revision: string | null };
function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
}
function previewStyle(color: string): CSSProperties {
  const palette = createStoreThemePalette(color);
  return {
    "--preview-primary": palette["--store-primary"], "--preview-on-primary": palette["--store-on-primary"],
    "--preview-soft": palette["--store-primary-soft"], "--preview-focus": palette["--store-primary-text"],
    "--preview-bg": palette["--store-bg"], "--preview-panel": palette["--store-panel"],
    "--preview-line": palette["--store-line"], "--preview-ink": palette["--store-ink"], "--preview-muted": palette["--store-muted"]
  } as CSSProperties;
}

function PresetPreview({ target }: { target: StoreThemeTarget }) {
  return <span className={styles.presetPreview} aria-hidden="true" data-preset-target={target}>
    {target === "operations" ? <span className={styles.presetRail}><i /><i /><i /></span> : null}
    <span className={styles.presetCanvas}><span className={styles.presetHeading} />
      {target === "customer" ? <><span className={styles.presetReceipt}><i /><i /></span><span className={styles.presetTotal}><i /></span></>
        : <><span className={`${styles.presetTiles} ${target !== "operations" ? styles.presetBoard : ""}`}><i /><i /></span><span className={styles.presetAction}><i /></span></>}
    </span>
  </span>;
}

function TargetPreview({ target, brand, storeName, canEdit }: { target: StoreThemeTarget; brand: StoreThemeContext["brand"]; storeName: string; canEdit: boolean }) {
  const { t } = useOsTranslation();
  if (target === "operations") return <>
    <div className={styles.previewOperationsHead}><span>Foundr1 STORE</span><span className={styles.previewSelected}>{t("選択中")}</span></div>
    <div className={styles.previewControls}><button type="button" className={styles.previewPrimary} disabled={!canEdit}>{t("メイン操作")}</button><button type="button" className={styles.previewSecondary} disabled={!canEdit}>{t("サブ操作")}</button><span className={styles.previewSelected}><Check size={15} />{t("選択中")}</span></div>
    <label className={styles.previewInput}>{t("入力・フォーカス")}<input type="text" placeholder={t("タップしてフォーカスを確認")} disabled={!canEdit} /></label>
    <div className={styles.semanticStates}><span className={styles.semanticSuccess}>{t("完了")}</span><span className={styles.semanticWarning}>{t("要確認")}</span><span className={styles.semanticDanger}>{t("エラー")}</span></div>
  </>;
  const brandHeading = <div className={styles.previewBrand}>{brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span className={styles.previewBrandMark} aria-hidden="true" />}<strong>{brand?.name || storeName}</strong><span>{t("配色サンプル")}</span></div>;
  if (target === "pickup") return <>{brandHeading}<div className={styles.previewPickup}>
    <section className={styles.previewAccent}><h3>{t("お受け取り")}</h3><strong>A102</strong><small>{t("お受け取りできます")}</small></section>
    <section className={styles.previewQuiet}><h3>{t("準備中")}</h3><strong>A103</strong><small>{t("もうしばらくお待ちください")}</small></section>
  </div></>;
  if (target === "customer") return <>{brandHeading}<div className={styles.previewCustomer}>
    <div className={styles.previewReceipt}><span>{t("ご注文内容")}</span><p><span>{t("商品名の表示例")}</span><b>¥1,280</b></p><small>{t("数量")} 1</small></div>
    <div className={styles.previewAccent}><span>{t("合計")}</span><strong>¥1,280</strong><small>{t("お支払い内容をご確認ください")}</small></div>
  </div></>;
  return <>{brandHeading}<div className={styles.previewCourier}>
    <div className={styles.previewCourierHeading}><span>{t("受け取り待ち")}</span><span className={styles.previewPlatform}>Uber Eats</span></div>
    <div className={styles.previewAccent}><strong>102</strong><span>{t("お受け取りできます")}</span></div>
    <div className={styles.previewQuiet}><strong>103</strong><span>{t("準備中")}</span></div>
  </div></>;
}

export default function StoreAppearancePage() {
  const { t } = useOsTranslation();
  const { context } = useStoreTheme();
  const [target, setTarget] = useState<StoreThemeTarget>("operations");
  return <main className={`store-workbench-shell ${styles.page}`}>
    <header className="store-workbench-topbar">
      <a className="brand-block" href="/store" aria-label="Foundr1 店舗"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1 data-i18n-ignore>{t("表示設定")}</h1></div></a>
      <StoreNavTabs active="appearance" storeId={context?.storeId} />
    </header>
    <div className={styles.content} data-i18n-ignore><StoreThemeEditorScope key={target} target={target}><StoreAppearanceEditor target={target} onTargetChange={setTarget} /></StoreThemeEditorScope></div>
  </main>;
}

function StoreAppearanceEditor({ target, onTargetChange }: { target: StoreThemeTarget; onTargetChange: (target: StoreThemeTarget) => void }) {
  const { t, language } = useOsTranslation();
  const { context: scopedContext, loading, error, refresh, previewColor, setPreviewColor, saveTheme } = useStoreTheme();
  const context = scopedContext?.target === target ? scopedContext : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const acceptedRefresh = useRef(0);
  const currentStoreId = useRef<string | null>(null);
  const fallback = getDefaultStoreTheme(target);
  const brandColor = context?.brand?.primaryColor ?? fallback.primaryColor;
  const currentDraft = draft?.storeId === context?.storeId && draft?.target === target ? draft : null;
  const savedMode = target === "operations" ? "custom" : context?.theme.mode ?? "brand";
  const mode = currentDraft?.mode ?? savedMode;
  const colorInput = currentDraft?.color ?? context?.theme.primaryColor ?? fallback.primaryColor;
  const color = mode === "brand" ? normalizeStoreThemeColor(brandColor) : normalizeStoreThemeColor(colorInput);
  const dirty = Boolean(context && (mode !== savedMode || (mode === "custom" && color !== normalizeStoreThemeColor(context.theme.primaryColor))));
  const canEdit = Boolean(context?.canManageTheme && !accessDenied && !loading && !switching);

  useEffect(() => {
    if (currentStoreId.current !== (context?.storeId ?? null)) {
      currentStoreId.current = context?.storeId ?? null;
      setDraft(null); setNotice(""); setSaveError(""); setConflict(false); setAccessDenied(false); setSwitching(false); setPreviewColor(null);
    }
    if (acceptedRefresh.current !== refreshRevision && context) {
      acceptedRefresh.current = refreshRevision;
      if (!error) { setDraft(value => value?.storeId === context.storeId && value.target === target ? { ...value, revision: context.revision } : value); setConflict(false); }
    }
    if (!context?.canManageTheme || accessDenied) setPreviewColor(null);
  }, [context, error, refreshRevision, accessDenied, setPreviewColor, target]);

  useEffect(() => {
    const clearPreview = () => { setPreviewColor(null); setDraft(null); };
    window.addEventListener(storeSelectionEventName, clearPreview);
    return () => { window.removeEventListener(storeSelectionEventName, clearPreview); setPreviewColor(null); };
  }, [setPreviewColor]);

  function editColor(value: string) {
    if (!context || !canEdit || saving) return;
    const normalized = normalizeStoreThemeColor(value);
    setDraft(previous => ({ storeId: context.storeId, target, mode: "custom", color: value, revision: previous?.storeId === context.storeId && previous.target === target ? previous.revision : context.revision }));
    setNotice(""); setSaveError("");
    if (normalized) setPreviewColor(normalized);
  }
  function editMode(nextMode: StoreThemeMode) {
    if (!context || !canEdit || saving || target === "operations") return;
    setDraft(previous => ({ storeId: context.storeId, target, mode: nextMode, color: previous?.storeId === context.storeId && previous.target === target ? previous.color : context.theme.primaryColor, revision: previous?.storeId === context.storeId && previous.target === target ? previous.revision : context.revision }));
    setNotice(""); setSaveError("");
    setPreviewColor(nextMode === "brand" ? brandColor : normalizeStoreThemeColor(colorInput));
  }
  function cancelPreview() {
    if (saving) return;
    setDraft(null); setPreviewColor(null); setNotice(""); setSaveError(""); setConflict(false);
  }
  async function refreshLatest() {
    if (refreshing || saving) return;
    setRefreshing(true); setSaveError("");
    try { await refresh(); setRefreshRevision(value => value + 1); }
    catch { setSaveError("表示設定を取得できませんでした。もう一度更新してください。"); }
    finally { setRefreshing(false); }
  }
  async function save() {
    if (!context || !canEdit || !color || !dirty || saving || conflict) return;
    setSaving(true); setSaveError(""); setNotice("");
    try {
      await saveTheme(color, currentDraft ? currentDraft.revision : context.revision, mode);
      setDraft(null); setPreviewColor(null); setNotice("選択した画面の配色を保存しました。");
    } catch (failure) {
      const status = errorStatus(failure);
      if (status === 409) { setConflict(true); setSaveError("ほかの担当者が表示設定を変更しました。入力を保持したまま最新の設定を確認してください。"); }
      else if (status === 401 || status === 403) { setAccessDenied(true); setDraft(null); setPreviewColor(null); setSaveError("表示設定を変更する権限を確認できません。ログイン状態と権限を確認してください。"); }
      else setSaveError(status > 0 && failure instanceof Error ? failure.message : "テーマ色を保存できませんでした。入力を保持して再試行してください。");
    } finally { setSaving(false); }
  }
  function changeStore(storeId: string) {
    if (!context || saving || !context.stores.some(store => store.id === storeId) || storeId === context.storeId) return;
    cancelPreview(); setSwitching(true);
    const url = new URL(window.location.href);
    if (url.searchParams.has("storeId")) { url.searchParams.set("storeId", storeId); window.history.replaceState(window.history.state, "", url.toString()); }
    setStoredStoreSelection(storeId);
  }
  function changeTarget(nextTarget: StoreThemeTarget) {
    if (saving || nextTarget === target) return;
    cancelPreview(); onTargetChange(nextTarget);
  }
  const updatedAt = context?.updatedAt ? new Date(context.updatedAt) : null;
  const updatedText = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(updatedAt)
    : t("初期設定");

  return <>
    {loading || switching ? <p className={styles.message} role="status">{t("表示設定を読み込んでいます。")}</p> : null}
    {error ? <div className={`${styles.message} ${styles.error}`} role="alert"><p>{t(error)}</p><button type="button" className="secondary-button" onClick={() => void refreshLatest()} disabled={refreshing}>{t("再読み込み")}</button></div> : null}
    {!loading && context && (!context.canManageTheme || accessDenied) ? <section className={`panel ${styles.denied}`}><Palette size={22} aria-hidden="true" /><h2>{t("表示設定を変更する権限がありません。")}</h2><p>{t("設定を変更する場合は、店舗の管理者に確認してください。")}</p>{saveError ? <p role="alert">{t(saveError)}</p> : null}<a href="/store/inventory" className="secondary-button">{t("在庫確認へ戻る")}</a></section> : null}
    {context?.canManageTheme && !accessDenied ? <>
      <section className={`panel ${styles.settings}`} aria-busy={saving || loading || switching}>
        <div className={styles.sectionHeading}><div><h2>{t("画面ごとのテーマ色")}</h2><p>{t("操作画面とお客様向けの画面を別々に設定します。")}</p></div><Palette size={20} aria-hidden="true" /></div>
        <div className={styles.storeRow}><label>{t("設定する店舗")}{context.stores.length > 1 ? <select value={context.storeId} disabled={saving || loading || switching} onChange={event => changeStore(event.target.value)} aria-label={t("設定する店舗")}>{context.stores.map(store => <option value={store.id} key={store.id}>{store.name}</option>)}</select> : <strong>{context.storeName}</strong>}</label><p>{t("最終更新")}<span>{updatedText}</span></p></div>
        <label className={styles.targetField}>{t("設定する画面")}<select value={target} disabled={saving || loading || switching} onChange={event => changeTarget(event.target.value as StoreThemeTarget)} aria-label={t("設定する画面")}>{storeThemeTargets.map(value => <option key={value} value={value}>{t(targetLabels[value])}</option>)}</select></label>
        <div className={styles.currentColor}><span className={styles.currentSwatch} style={{ backgroundColor: context.theme.primaryColor }} aria-hidden="true" /><span>{t("保存済みのテーマ色")}<strong>{context.theme.primaryColor.toUpperCase()}{savedMode === "brand" ? ` · ${t("ブランドカラー（標準）")}` : ""}</strong></span></div>
        {target !== "operations" ? <>
          <fieldset className={styles.modeFieldset} disabled={!canEdit || saving}><legend>{t("配色モード")}</legend>
            <label><input type="radio" name={`theme-mode-${target}`} value="brand" checked={mode === "brand"} onChange={() => editMode("brand")} />{t("ブランドカラー（標準）")}</label>
            <label><input type="radio" name={`theme-mode-${target}`} value="custom" checked={mode === "custom"} onChange={() => editMode("custom")} />{t("カスタムカラー")}</label>
          </fieldset>
          <div className={styles.brandInfo}>{context.brand?.logoUrl ? <img src={context.brand.logoUrl} alt="" /> : null}<div><strong>{context.brand?.name || t("この画面の標準配色")}</strong><p>{t(context.brand ? "ブランドのロゴに合わせた配色を使用します。" : "単一のブランド配色を確認できないため、この画面の標準配色を使用します。")}</p></div><span className={styles.currentSwatch} style={{ backgroundColor: brandColor }} aria-hidden="true" /></div>
        </> : null}
        <fieldset className={styles.colorFieldset} disabled={!canEdit || saving || mode === "brand"}><legend>{t("テーマ色を選ぶ")}</legend>
          <div className={styles.presets}>{presets.map(preset => <button key={preset.color} type="button" className={styles.preset} style={preset.style} onClick={() => editColor(preset.color)} aria-pressed={mode === "custom" && color === preset.color}><PresetPreview target={target} /><span className={styles.presetCaption}><span>{t(preset.label)}</span><span className={styles.presetMarker} aria-hidden="true">{mode === "custom" && color === preset.color ? <Check size={13} /> : null}</span></span></button>)}</div>
          <div className={styles.customColor}><label>{t("カラーピッカー")}<input type="color" value={mode === "brand" ? brandColor : normalizeStoreThemeColor(colorInput) ?? fallback.primaryColor} onChange={event => editColor(event.target.value)} aria-label={t("カラーピッカー")} /></label><label className={styles.hexField}>{t("HEXカラー")}<input type="text" value={mode === "brand" ? brandColor : colorInput} maxLength={7} spellCheck={false} autoComplete="off" inputMode="text" aria-invalid={mode === "custom" && !color} aria-describedby="theme-color-hint" onChange={event => editColor(event.target.value)} /></label></div>
          <p id="theme-color-hint" className={mode === "custom" && !color ? styles.errorText : styles.helper}>{t(mode === "custom" && !color ? "#から始まる6桁のカラーコードを入力してください。" : "背景・選択状態・文字色はテーマ色に合わせて自動調整されます。")}</p>
        </fieldset>
        {mode === "brand" ? <p className={styles.helper}>{t("色を変更する場合は、カスタムカラーを選択してください。")}</p> : null}
        <p className={styles.helper}>{t("プレビューは下の表示例だけに反映されます。保存すると、選択した画面に適用されます。")}</p>
        {previewColor && dirty ? <p className={styles.previewNotice} role="status">{t("保存前のプレビューを表示中")}</p> : null}
        {notice ? <p className={styles.success} role="status">{t(notice)}</p> : null}
        {saveError ? <div className={styles.error} role="alert"><p>{t(saveError)}</p>{conflict ? <button type="button" className="secondary-button" disabled={refreshing} onClick={() => void refreshLatest()}><RefreshCw size={15} />{t(refreshing ? "確認中" : "最新の設定を確認")}</button> : null}</div> : null}
        <div className={styles.actions}><button type="button" className="secondary-button" disabled={!canEdit || saving} onClick={() => target === "operations" ? editColor(fallback.primaryColor) : editMode("brand")}><RotateCcw size={15} />{t(target === "operations" ? "標準色をプレビュー" : "ブランドカラーをプレビュー")}</button><div><button type="button" className="secondary-button" disabled={saving || !currentDraft} onClick={cancelPreview}>{t("プレビューを取り消す")}</button><button type="button" className="primary-button" disabled={!canEdit || saving || refreshing || !color || !dirty || conflict} onClick={() => void save()}>{t(saving ? "保存中" : "{target}に保存", { target: t(targetLabels[target]) })}</button></div></div>
      </section>
      <section className={`panel ${styles.preview}`} aria-labelledby="theme-preview-title">
        <div className={styles.sectionHeading}><div><h2 id="theme-preview-title">{t("{target}のプレビュー", { target: t(targetLabels[target]) })}</h2><p>{t("選択した画面の表示例です。")}</p></div></div>
        <div className={styles.localPreview} style={previewStyle(color ?? context.theme.primaryColor)} data-preview-target={target}><TargetPreview target={target} brand={context.brand} storeName={context.storeName} canEdit={canEdit} /></div>
        <p className={styles.helper}>{t("完了・注意・エラーの意味を伝える色はテーマ色にかかわらず維持します。")}</p>
      </section>
    </> : null}
  </>;
}
