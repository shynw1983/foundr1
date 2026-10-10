"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import { normalizeInventoryRecipePayload, type InventoryRecipe, type InventoryRecipesResponse } from "../lib/inventory-recipe-policy";
import { listProductUnitConversions, formatInventoryCountQuantity } from "../lib/product-unit-conversions";
import { useInventoryReadModel } from "./useInventoryOperations";
import styles from "./InventoryOperations.module.css";

type InputDraft = { productId: string; quantity: string; unit: string; mode: "exact" | "estimate" | "unmeasured" };
type RecipeDraft = { id?: string; expectedVersionId: string | null; name: string; brandId: string; kind: "menu" | "production"; targetType: "item" | "option"; targetId: string; basis: "serving" | "measured"; measuredUnit: string; outputProductId: string; outputQuantity: string; outputUnit: string; inputs: InputDraft[] };
type PendingCreation = ReturnType<typeof normalizeInventoryRecipePayload> & { requestId: string };
export type InventoryRecipeEditorProps = { storeId?: string; brandId?: string; targetType?: "item" | "option"; targetId?: string; defaultName?: string; defaultKind?: "menu" | "production"; onSaved?: () => void };
export function recipeToDraft(recipe: InventoryRecipe): RecipeDraft {
  return { id: recipe.id, expectedVersionId: recipe.currentVersionId, name: recipe.name, brandId: recipe.brandId, kind: recipe.kind, targetType: recipe.targetType ?? "item", targetId: recipe.targetId ?? "", basis: recipe.snapshot.basis, measuredUnit: recipe.snapshot.measuredUnit ?? "", outputProductId: recipe.outputProductId ?? "", outputQuantity: recipe.snapshot.output ? String(recipe.snapshot.output.quantity) : "", outputUnit: recipe.snapshot.output?.unit ?? "", inputs: recipe.snapshot.inputs.map(input => ({ ...input, quantity: input.quantity === null ? "" : String(input.quantity) })) };
}
function pendingCreationDraft(payload: PendingCreation): RecipeDraft {
  return { expectedVersionId: null, name: payload.name, brandId: payload.brandId, kind: payload.kind, targetType: payload.targetType ?? "item", targetId: payload.targetId ?? "", basis: payload.snapshot.basis, measuredUnit: payload.snapshot.measuredUnit ?? "", outputProductId: payload.outputProductId ?? "", outputQuantity: payload.snapshot.output ? String(payload.snapshot.output.quantity) : "", outputUnit: payload.snapshot.output?.unit ?? "", inputs: payload.snapshot.inputs.map(input => ({ ...input, quantity: input.quantity === null ? "" : String(input.quantity) })) };
}
export function InventoryRecipeEditor(props: InventoryRecipeEditorProps) {
  const { t, language } = useOsTranslation();
  const params = new URLSearchParams(); if (props.storeId) params.set("storeId", props.storeId); if (props.brandId) params.set("brandId", props.brandId);
  const scope = `${props.storeId ?? "hq"}:${props.brandId ?? "all"}:${props.targetType ?? "all"}:${props.targetId ?? "all"}:${props.defaultKind ?? "menu"}`;
  const { data, loading, error: loadError, load } = useInventoryReadModel<InventoryRecipesResponse>(`/api/inventory/recipes?${params}`, scope);
  const blank = (): RecipeDraft => ({ expectedVersionId: null, name: props.defaultName ?? "", brandId: props.brandId ?? "", kind: props.defaultKind ?? "menu", targetType: props.targetType ?? "item", targetId: props.targetId ?? "", basis: "serving", measuredUnit: "", outputProductId: "", outputQuantity: "", outputUnit: "", inputs: [{ productId: "", quantity: "", unit: "", mode: "exact" }] });
  const [state, setState] = useState<{ scope: string; draft: RecipeDraft } | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflicted, setConflicted] = useState(false);
  const [pendingState, setPendingState] = useState<{ scope: string; payload: PendingCreation } | null>(null);
  const pendingRef = useRef<PendingCreation | null>(null);
  const currentScope = useRef(scope); currentScope.current = scope;
  const savingRef = useRef(false);
  const draft = state?.scope === scope ? state.draft : null;
  const pending = pendingState?.scope === scope ? pendingState.payload : null;
  const storageKey = `foundr1:pending-recipe-creation:${scope}`;
  const unitListPrefix = `recipe-units-${scope.replace(/[^a-z0-9_-]/gi, "-")}`;
  const recipes = data?.recipes.filter(recipe => (!props.targetId || (recipe.targetId === props.targetId && recipe.targetType === props.targetType)) && (!props.defaultKind || recipe.kind === props.defaultKind)) ?? [];
  useEffect(() => {
    setState(null); setError(""); setNotice(""); setConflicted(false); setSaving(false); setPendingState(null); pendingRef.current = null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (saved && !saved.id && saved.action === "save" && typeof saved.requestId === "string" && /^[0-9a-f-]{36}$/i.test(saved.requestId)) {
        const normalized = normalizeInventoryRecipePayload(saved) as PendingCreation;
        if (normalized.requestId === saved.requestId) { pendingRef.current = normalized; setPendingState({ scope, payload: normalized }); setState({ scope, draft: pendingCreationDraft(normalized) }); }
      }
    } catch { /* Invalid saved content is never sent as a new recipe. */ }
  }, [scope, storageKey]);
  useEffect(() => {
    if (!data || (state?.scope === scope)) return;
    const targeted = props.targetId ? data.recipes.find(recipe => recipe.status === "active" && recipe.targetId === props.targetId && recipe.targetType === props.targetType) : undefined;
    const next = targeted ? recipeToDraft(targeted) : blank();
    if (!next.brandId && props.targetId) next.brandId = data.menuTargets.find(target => target.id === props.targetId && target.type === props.targetType)?.brandId ?? "";
    setState({ scope, draft: next });
  }, [data, scope, state, props.targetId, props.targetType]);
  function change(update: Partial<RecipeDraft>) { if (!draft) return; setState({ scope, draft: { ...draft, ...update } }); setError(""); setNotice(""); }
  function changeInput(index: number, update: Partial<InputDraft>) { if (!draft) return; change({ inputs: draft.inputs.map((input, i) => i === index ? { ...input, ...update } : input) }); }
  function units(productId: string, savedUnit = "") {
    const product = data?.products.find(p => p.id === productId);
    const available = product ? listProductUnitConversions(product).map(unit => unit.countUnit) : [];
    return savedUnit && !available.includes(savedUnit) ? [savedUnit, ...available] : available;
  }
  async function save(action: "save" | "inactivate") {
    if (!draft || !data?.canManage || savingRef.current || conflicted) return;
    let payload = pendingRef.current;
    try {
      if (!payload) payload = normalizeInventoryRecipePayload(action === "inactivate" ? { action, id: draft.id, expectedVersionId: draft.expectedVersionId } : {
        action, id: draft.id, expectedVersionId: draft.expectedVersionId, name: draft.name, brandId: draft.brandId, kind: draft.kind,
        ...(!draft.id ? { requestId: crypto.randomUUID() } : {}),
        targetType: draft.kind === "menu" ? draft.targetType : null, targetId: draft.kind === "menu" ? draft.targetId : null,
        outputProductId: draft.kind === "production" ? draft.outputProductId : null,
        snapshot: { basis: draft.basis, ...(draft.basis === "measured" ? { measuredUnit: draft.measuredUnit } : {}),
          inputs: draft.inputs.map(input => ({ ...input, quantity: input.mode === "unmeasured" ? null : input.quantity })),
          ...(draft.kind === "production" ? { output: { productId: draft.outputProductId, quantity: draft.outputQuantity, unit: draft.outputUnit } } : {}) }
      }) as PendingCreation;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "配合を確認してください。"); return; }
    const isCreation = action === "save" && !payload.id;
    if (isCreation) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(payload)); } catch { setError("配合の送信内容を保存できませんでした。もう一度確認してください。"); return; }
      pendingRef.current = payload; setPendingState({ scope, payload });
    }
    const submittedScope = scope; savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (isCreation && (response.ok || response.status < 500)) { try { window.localStorage.removeItem(storageKey); } catch { /* A replay still uses the same server identity. */ } }
      if (currentScope.current !== submittedScope) return;
      if (isCreation && (response.ok || response.status < 500)) { pendingRef.current = null; setPendingState(null); }
      if (!response.ok) { if (response.status === 409) setConflicted(true); throw new Error(body.error || "配合を保存できませんでした。"); }
      setState({ scope, draft: action === "inactivate" ? blank() : recipeToDraft(body.recipe) });
      setNotice(action === "inactivate" ? "配合の使用を停止しました。過去の記録は保持されます。" : "配合の新しい版を保存しました。"); await load(); props.onSaved?.();
    } catch (failure) { if (currentScope.current === submittedScope) setError(failure instanceof Error ? failure.message : "配合を保存できませんでした。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  const locked = saving || conflicted || Boolean(pending);
  return <section className={styles.body} data-inventory-recipe-editor="" data-i18n-ignore aria-label={t("配合・注文の使用量") }>
    <div className={styles.heading}><strong>{t("配合・注文の使用量")}</strong><button className="text-button" type="button" disabled={loading || saving} onClick={() => void load()}>{t("更新")}</button></div>
    <p className={styles.hint}>{t("不足を確認する商品との関連付けとは別に、1食あたりの標準使用量を設定します。底料などの中間商品も独立した商品として選べます。")}</p>
    {loadError || error ? <p className={styles.error} role="alert">{t(error || loadError)}</p> : null}{notice ? <p className={styles.notice} role="status">{t(notice)}</p> : null}
    {loading && !data ? <p role="status">{t("読み込み中")}</p> : null}
    {data && !data.canManage ? <div className={styles.readonly}>
      {recipes.map(recipe => <div className={styles.card} key={recipe.id}><strong>{recipe.name} · {t("版 {version}", { version: recipe.version })}</strong>{!recipe.snapshot.inputs.length ? <span>{t("このメニュー・選択肢は単独では商品在庫を使用しない")}</span> : null}{recipe.snapshot.inputs.map(input => <span key={input.productId}>{data.products.find(product => product.id === input.productId)?.name ?? t("商品情報を確認してください")} · {input.quantity === null ? t("未計量") : `${formatInventoryCountQuantity(input.quantity, language)} ${input.unit}`} · {t(input.mode === "exact" ? "標準使用量" : input.mode === "estimate" ? "概算使用量" : "未計量")}</span>)}{recipe.snapshot.output ? <span>{t("できあがる商品")} · {data.products.find(product => product.id === recipe.outputProductId)?.name ?? t("商品情報を確認してください")} · {formatInventoryCountQuantity(recipe.snapshot.output.quantity, language)} {recipe.snapshot.output.unit}</span> : null}</div>)}{!recipes.length ? <p>{t("配合はまだ設定されていません。")}</p> : null}
    </div> : null}
    {data?.canManage && draft ? <form className={styles.body} onSubmit={event => { event.preventDefault(); void save("save"); }}>
      {pending ? <div className={styles.warning}><p>{t("新しい配合の送信結果を確認中です。名前・商品・数量・単位を変えず、同じ内容で再送してください。")}</p><button type="button" className="primary-button" disabled={saving || loading} onClick={() => void save("save")}>{t("同じ内容で再送")}</button></div> : null}
      <label className={styles.label}><span>{t("編集する配合")}</span><select name="recipeId" value={draft.id ?? ""} disabled={saving || Boolean(pending)} onChange={event => { const selected = recipes.find(recipe => recipe.id === event.target.value); setState({ scope, draft: selected ? recipeToDraft(selected) : blank() }); setConflicted(false); setError(""); setNotice(""); }}><option value="">{t("新しい配合")}</option>{recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.name} · v{recipe.version}{recipe.status === "inactive" ? ` · ${t("停止中")}` : ""}</option>)}</select></label>
      {conflicted ? <div className={styles.warning}><p>{t("他の担当者が配合を変更しました。入力は残しています。最新の版を読み込み、内容を確認してください。")}</p><button type="button" className="secondary-button" disabled={loading} onClick={() => { const requestedScope = scope; void load().then(latest => { if (!latest || currentScope.current !== requestedScope) return; const existing = latest.recipes.find(recipe => recipe.id === draft.id || !draft.id && draft.kind === "menu" && recipe.status === "active" && recipe.targetType === draft.targetType && recipe.targetId === draft.targetId); setState({ scope, draft: existing ? recipeToDraft(existing) : blank() }); setConflicted(false); setError(""); }); }}>{t("入力を破棄して最新の配合を読み込む")}</button></div> : null}
      <div className={styles.fields}>
        <label><span>{t("配合名")}</span><input name="recipeName" maxLength={160} value={draft.name} disabled={locked} onChange={event => change({ name: event.target.value })} /></label>
        <label><span>{t("ブランド")}</span><select name="recipeBrand" value={draft.brandId} disabled={locked || Boolean(props.brandId || props.targetId)} onChange={event => change({ brandId: event.target.value, targetId: "" })}><option value="">{t("選択してください")}</option>{data.brands.map(brand => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label>
        {!props.targetId && !props.defaultKind ? <label><span>{t("用途")}</span><select value={draft.kind} disabled={locked} onChange={event => change({ kind: event.target.value as RecipeDraft["kind"], ...(event.target.value === "production" && !draft.inputs.length ? { inputs: [{ productId: "", quantity: "", unit: "", mode: "exact" }] } : {}) })}><option value="menu">{t("メニューの使用量")}</option><option value="production">{t("仕込み・製造")}</option></select></label> : null}
        {draft.kind === "menu" && !props.targetId ? <label><span>{t("対象メニュー・選択肢")}</span><select name="recipeTarget" value={`${draft.targetType}:${draft.targetId}`} disabled={locked} onChange={event => { const [type, id] = event.target.value.split(":"); change({ targetType: type as "item" | "option", targetId: id ?? "" }); }}><option value="item:">{t("選択してください")}</option>{data.menuTargets.filter(target => target.brandId === draft.brandId).map(target => <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.name} · {t(target.type === "item" ? "メニュー" : "選択肢")}</option>)}</select></label> : null}
        {draft.kind === "production" ? <><label><span>{t("できあがる商品")}</span><select name="outputProductId" value={draft.outputProductId} disabled={locked} onChange={event => change({ outputProductId: event.target.value, outputUnit: "" })}><option value="">{t("選択してください")}</option>{data.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label><span>{t("標準のできあがり数量")}</span><input name="standardOutputQuantity" inputMode="decimal" value={draft.outputQuantity} disabled={locked} onChange={event => change({ outputQuantity: event.target.value })} /></label><label><span>{t("できあがりの単位")}</span><input name="outputUnit" list={`${unitListPrefix}-output`} maxLength={64} value={draft.outputUnit} disabled={locked} placeholder={t("単位を入力または選択")} onChange={event => change({ outputUnit: event.target.value })} /><datalist id={`${unitListPrefix}-output`}>{units(draft.outputProductId, draft.outputUnit).map(unit => <option key={unit} value={unit} />)}</datalist></label></> : null}
      </div>
      <p className={styles.hint}>{t("単位は直接入力できます。使用する庫位の単位、または確認済みの換算に合わせてください。入力だけでは新しい換算を作りません。")}</p>
      {draft.kind === "menu" ? <label className={styles.check}><input type="checkbox" name="recipeNoConsumption" checked={!draft.inputs.length} disabled={locked} onChange={event => change({ inputs: event.target.checked ? [] : [{ productId: "", quantity: "", unit: "", mode: "exact" }] })} /><span>{t("このメニュー・選択肢は単独では商品在庫を使用しない")}</span></label> : null}
      {!draft.inputs.length ? <p className={styles.hint}>{t("温度・辛さなど、単独で材料を使用しない選択肢を明示します。配合の未設定とは区別して記録します。")}</p> : null}
      <div className={styles.rows}>{draft.inputs.map((input, index) => <div className={styles.card} key={index}><div className={styles.row}>
        <label><span>{t("使用する商品")}</span><select name={`inputProduct-${index}`} value={input.productId} disabled={locked} onChange={event => changeInput(index, { productId: event.target.value, unit: "" })}><option value="">{t("選択してください")}</option>{data.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label><span>{t("数量")}</span><input name={`inputQuantity-${index}`} inputMode="decimal" value={input.quantity} disabled={locked || input.mode === "unmeasured"} placeholder={input.mode === "unmeasured" ? t("未計量") : t("数量を入力")} onChange={event => changeInput(index, { quantity: event.target.value })} /></label>
        <label><span>{t("単位")}</span><input name={`inputUnit-${index}`} list={`${unitListPrefix}-input-${index}`} maxLength={64} value={input.unit} disabled={locked} placeholder={t("単位を入力または選択")} onChange={event => changeInput(index, { unit: event.target.value })} /><datalist id={`${unitListPrefix}-input-${index}`}>{units(input.productId, input.unit).map(unit => <option key={unit} value={unit} />)}</datalist></label>
        <label><span>{t("数量の扱い")}</span><select value={input.mode} disabled={locked} onChange={event => changeInput(index, { mode: event.target.value as InputDraft["mode"], ...(event.target.value === "unmeasured" ? { quantity: "" } : {}) })}><option value="exact">{t("標準使用量・帳簿へ反映")}</option><option value="estimate">{t("概算・予測のみ")}</option><option value="unmeasured">{t("未計量・注文数を記録")}</option></select></label>
        <button type="button" className="text-button" disabled={locked || draft.inputs.length === 1} aria-label={t("投入商品を削除")} onClick={() => change({ inputs: draft.inputs.filter((_, i) => i !== index) })}>{t("削除")}</button>
      </div></div>)}</div>
      {draft.inputs.length > 0 ? <button type="button" className="secondary-button" disabled={locked || draft.inputs.length >= 100} onClick={() => change({ inputs: [...draft.inputs, { productId: "", quantity: "", unit: "", mode: "exact" }] })}>{t("使用する商品を追加")}</button> : null}
      <details className={styles.detail}><summary>{t("重量・実測単位を基準にする")}</summary><div><label className={styles.label}><span>{t("配合の基準")}</span><select value={draft.basis} disabled={locked} onChange={event => change({ basis: event.target.value as RecipeDraft["basis"] })}><option value="serving">{t(draft.kind === "menu" ? "1食あたり" : "標準のできあがり数量あたり")}</option><option value="measured">{t("実測単位あたり")}</option></select></label>{draft.basis === "measured" ? <label className={styles.label}><span>{t("注文の実測単位")}</span><input maxLength={64} value={draft.measuredUnit} disabled={locked} onChange={event => change({ measuredUnit: event.target.value })} /><small>{t("注文に同じ単位の実測数量がある場合だけ使用します。食数を重量として扱いません。")}</small></label> : null}</div></details>
      <p className={styles.hint}>{t(draft.kind === "production" ? "注文はできあがった商品の在庫を使います。原材料は仕込みの登録時に別に記録し、二重に差し引きません。" : "標準使用量は注文から計算する帳簿上の量です。実際の使用量は次の棚卸で確認します。")}</p>
      <div className={styles.actions}>{draft.id ? <button type="button" className="secondary-button" disabled={locked} onClick={() => void save("inactivate")}>{t("この配合の使用を停止")}</button> : null}<button className="primary-button" type="submit" disabled={locked || loading}>{t(saving ? "保存中..." : "新しい版を保存")}</button></div>
    </form> : null}
  </section>;
}
