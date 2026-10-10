"use client";

import { useEffect, useState } from "react";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";
import type { InventoryRecipe } from "../lib/inventory-recipe-policy";
import { scaleProductionQuantity, type InventoryProductionInput, type InventoryProductionResponse, type InventoryProductionTarget, type ProductionInputMode } from "../lib/inventory-production-policy";
import { formatInventoryCountQuantity, parseInventoryCountQuantity } from "../lib/product-unit-conversions";
import { InventoryRecipeEditor } from "./InventoryRecipeEditor";
import { useInventoryOperation, useInventoryReadModel } from "./useInventoryOperations";
import styles from "./InventoryOperations.module.css";

type InputDraft = { productId: string; inventoryItemId: string; quantity: string; mode: ProductionInputMode };
export function defaultManufacturingInputs(recipe: InventoryRecipe, items: InventoryProductionTarget[]): InputDraft[] {
  return recipe.snapshot.inputs.map(input => { const targets = items.filter(item => item.productId === input.productId); return { productId: input.productId, inventoryItemId: targets.length === 1 ? targets[0].id : "", quantity: "", mode: input.quantity === null ? "unmeasured" : "estimate" }; });
}
export function manufacturingInputQuantity(draft: InputDraft, recipe: InventoryRecipe, outputQuantity: number | null) {
  if (draft.mode === "unmeasured") return null;
  if (draft.mode === "exact") return parseInventoryCountQuantity(draft.quantity);
  const input = recipe.snapshot.inputs.find(input => input.productId === draft.productId);
  if (input?.quantity === null || input?.quantity === undefined || outputQuantity === null || !recipe.snapshot.output) return null;
  try { return scaleProductionQuantity(input.quantity, outputQuantity, recipe.snapshot.output.quantity); } catch { return null; }
}
export type ManufacturingPanelProps = { storeId: string; refreshKey?: unknown; onChanged?: () => void };
export function ManufacturingPanel({ storeId, refreshKey, onChanged }: ManufacturingPanelProps) {
  const { t, language } = useOsTranslation();
  const [open, setOpen] = useState(false), [recipeOpen, setRecipeOpen] = useState(false);
  const model = useInventoryReadModel<InventoryProductionResponse>(`/api/inventory/production?storeId=${encodeURIComponent(storeId)}`, storeId, open, refreshKey);
  const operation = useInventoryOperation("/api/inventory/production", storeId, () => { void model.load(); onChanged?.(); });
  const [draftStore, setDraftStore] = useState(storeId), [recipeId, setRecipeId] = useState(""), [outputText, setOutputText] = useState(""), [outputItemId, setOutputItemId] = useState("");
  const [inputs, setInputs] = useState<InputDraft[]>([]), [confirmed, setConfirmed] = useState(false), [recipeVersion, setRecipeVersion] = useState("");
  const [sourceId, setSourceId] = useState(""), [transferTargetId, setTransferTargetId] = useState(""), [transferText, setTransferText] = useState(""), [costText, setCostText] = useState(""), [supplyText, setSupplyText] = useState("");
  const [transferBasis, setTransferBasis] = useState<{ sourceId: string; countUnit: string } | null>(null);
  const [receiveTexts, setReceiveTexts] = useState<Record<string, string>>({}), [receiveConfirmed, setReceiveConfirmed] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState("");
  useEffect(() => { setDraftStore(storeId); setRecipeId(""); setRecipeVersion(""); setOutputText(""); setOutputItemId(""); setInputs([]); setConfirmed(false); setRecipeOpen(false); setSourceId(""); setTransferBasis(null); setTransferTargetId(""); setTransferText(""); setCostText(""); setSupplyText(""); setReceiveTexts({}); setReceiveConfirmed({}); setLocalError(""); }, [storeId]);
  const data = model.data?.store.id === storeId ? model.data : null, sameScope = draftStore === storeId;
  const recipe = sameScope ? data?.recipes.find(recipe => recipe.id === recipeId) : undefined;
  const recipeChanged = Boolean(recipe && recipe.currentVersionId !== recipeVersion);
  const targets = data?.inventoryItems.filter(item => item.storeId === storeId) ?? [];
  const outputTargets = targets.filter(item => item.productId === recipe?.snapshot.output?.productId);
  const outputTarget = outputTargets.find(item => item.id === outputItemId) ?? (!outputItemId && outputTargets.length === 1 ? outputTargets[0] : undefined);
  const outputQuantity = parseInventoryCountQuantity(outputText), locked = operation.busy || Boolean(operation.pending);
  const quantity = (value: number | null | undefined, unit: string) => value === null || value === undefined ? t("未確認") : `${value < 0 ? "−" : ""}${formatInventoryCountQuantity(Math.abs(value), language)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
  function chooseRecipe(id: string) {
    const selected = data?.recipes.find(recipe => recipe.id === id); setRecipeId(id); setRecipeVersion(selected?.currentVersionId ?? ""); setOutputText(""); setOutputItemId(""); setInputs(selected ? defaultManufacturingInputs(selected, targets) : []); setConfirmed(false); setLocalError("");
  }
  function updateInput(index: number, update: Partial<InputDraft>) { setInputs(previous => previous.map((input, i) => i === index ? { ...input, ...update } : input)); setConfirmed(false); setLocalError(""); }
  const preparedInputs: InventoryProductionInput[] = recipe ? inputs.flatMap(input => {
    const target = targets.find(target => target.id === input.inventoryItemId && target.productId === input.productId);
    const configured = recipe.snapshot.inputs.find(line => line.productId === input.productId), amount = manufacturingInputQuantity(input, recipe, outputQuantity);
    if (!target || !configured || (input.mode !== "unmeasured" && (amount === null || amount <= 0))) return [];
    return [{ productId: input.productId, inventoryItemId: target.id, quantity: amount, unit: configured.unit, mode: input.mode, expectedStockRevision: target.stockRevision }];
  }) : [];
  const canProduce = Boolean(data?.canProduce && recipe && !recipeChanged && outputTarget && outputQuantity !== null && outputQuantity > 0 && preparedInputs.length === recipe.snapshot.inputs.length && confirmed && !locked && !operation.needsReview);
  async function produce() {
    if (!canProduce || !recipe || !outputTarget || outputQuantity === null) return;
    if (await operation.submit({ action: "produce", storeId, recipeVersionId: recipeVersion, outputInventoryItemId: outputTarget.id, outputQuantity, inputs: preparedInputs, expectedOutputStockRevision: outputTarget.stockRevision })) { setOutputText(""); setConfirmed(false); }
  }
  const source = targets.find(item => item.id === sourceId);
  const transferUnitChanged = Boolean(source && (transferBasis?.sourceId !== source.id || transferBasis.countUnit !== source.countUnit));
  const destinationOptions = data?.transferInventoryItems?.filter(item => item.storeId !== storeId && item.productId === source?.productId) ?? [];
  const destination = destinationOptions.find(item => item.id === transferTargetId);
  const transferQuantity = parseInventoryCountQuantity(transferText);
  const canRetry = Boolean(data && operation.pending && (operation.pending.action === "produce" ? data.canProduce : operation.pending.action === "transfer_dispatch" ? data.canTransfer : data.canReceive));
  async function dispatch() {
    if (!data?.canTransfer || !source || !destination || transferUnitChanged || transferQuantity === null || transferQuantity <= 0 || locked || operation.needsReview) return;
    const optionalPrice = (value: string) => value.trim() ? Number(value) : null;
    const cost = optionalPrice(costText), supply = optionalPrice(supplyText);
    if ([cost, supply].some(value => value !== null && (!Number.isFinite(value) || value < 0 || Math.round(value * 100) / 100 !== value))) { setLocalError("価格は小数点以下2桁以内の数値で入力してください。"); return; }
    if (await operation.submit({ action: "transfer_dispatch", sourceStoreId: storeId, targetStoreId: destination.storeId, productId: source.productId, sourceInventoryItemId: source.id, targetInventoryItemId: destination.id, quantity: transferQuantity, unit: source.countUnit, expectedSourceStockRevision: source.stockRevision, costPriceJpy: cost, supplyPriceJpy: supply })) { setTransferText(""); setCostText(""); setSupplyText(""); }
  }
  async function receive(transferId: string) {
    const transfer = data?.transfers.find(item => item.id === transferId && item.targetStoreId === storeId), target = targets.find(item => item.id === transfer?.targetInventoryItemId && item.productId === transfer?.productId);
    const amount = parseInventoryCountQuantity(receiveTexts[transferId]);
    if (!data?.canReceive || !transfer || !target || amount === null || amount <= 0 || amount > transfer.remainingQuantity || !receiveConfirmed[transferId] || locked || operation.needsReview) return;
    if (await operation.submit({ action: "transfer_receive", transferId, quantity: amount, expectedTargetStockRevision: target.stockRevision })) { setReceiveTexts(previous => ({ ...previous, [transferId]: "" })); setReceiveConfirmed(previous => ({ ...previous, [transferId]: false })); }
  }
  return <details className={styles.panel} open={open} onToggle={event => setOpen(event.currentTarget.open)} data-manufacturing-panel="" data-i18n-ignore>
    <summary>{t("仕込み・製造と店舗への供給")}</summary>
    {open ? <div className={styles.body}>
      <div className={styles.heading}><p className={styles.hint}>{t("できあがった数量を登録します。原材料の標準目安と実測量を分け、注文ではできあがった商品の在庫だけを使用します。")}</p><button type="button" className="text-button" disabled={locked || model.loading} onClick={() => void model.load()}>{t("更新")}</button></div>
      {operation.error || model.error || localError ? <p className={styles.error} role="alert">{t(operation.error || localError || model.error)}</p> : null}{operation.notice ? <p className={styles.notice} role="status">{t(operation.notice)}</p> : null}
      {operation.pending ? <div className={styles.warning}><p>{t("送信結果を確認中です。内容を変えず、同じ操作を再送してください。")}</p><pre style={{ whiteSpace: "pre-wrap", font: "inherit", overflowWrap: "anywhere" }}>{t(operation.pending.action === "produce" ? "仕込みの登録" : operation.pending.action === "transfer_dispatch" ? "店舗への出荷" : "店舗での受取")} · {String(operation.pending.outputQuantity ?? operation.pending.quantity ?? "")} {String(operation.pending.unit ?? recipe?.snapshot.output?.unit ?? "")}</pre><button type="button" className="primary-button" disabled={operation.busy || !canRetry} onClick={() => void operation.submit({})}>{t("同じ内容で再送")}</button></div> : null}
      {operation.needsReview ? <div className={styles.warning}><p>{t("配合または在庫が変わりました。入力は残しています。最新の数量・保管場所を確認してから再登録してください。")}</p><button type="button" className="secondary-button" disabled={model.loading || locked} onClick={operation.confirmReview}>{t("更新後の内容を確認しました")}</button></div> : null}
      {data?.canProduce && sameScope ? <form className={styles.body} onSubmit={event => { event.preventDefault(); void produce(); }}>
        <div className={styles.fields}><label className={styles.wide}><span>{t("仕込みの配合")}</span><select name="productionRecipeId" value={recipeId} disabled={locked} onChange={event => chooseRecipe(event.target.value)}><option value="">{t("選択してください")}</option>{data.recipes.filter(recipe => recipe.kind === "production" && recipe.status === "active").map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.name} · v{recipe.version}</option>)}</select></label>
          {recipe ? <><label><span>{t("実際にできあがった数量")}</span><input name="productionOutputQuantity" inputMode="decimal" value={outputText} disabled={locked} placeholder={t("数量を入力")} onChange={event => { setOutputText(event.target.value); setConfirmed(false); }} /><small>{recipe.snapshot.output?.unit}</small></label><label><span>{t("できあがりを保管する場所")}</span><select name="productionOutputInventoryItemId" value={outputTarget?.id ?? outputItemId} disabled={locked} onChange={event => { setOutputItemId(event.target.value); setConfirmed(false); }}><option value="">{t("保管場所を選択してください")}</option>{outputTargets.map(item => <option key={item.id} value={item.id}>{item.locationName} · {item.countUnit}</option>)}</select></label></> : null}
        </div>
        {recipeChanged && recipe ? <div className={styles.warning}><p>{t("配合の版が変わりました。新しい版を選び直してください。")}</p><button type="button" className="secondary-button" disabled={locked} onClick={() => chooseRecipe(recipe.id)}>{t("新しい配合で入力し直す")}</button></div> : null}
        {recipe ? <><div className={styles.card}><strong>{t("原材料の標準目安")}</strong>{inputs.map(input => { const configured = recipe.snapshot.inputs.find(line => line.productId === input.productId), target = targets.find(item => item.productId === input.productId); return <span key={input.productId}>{target?.productName ?? t("商品情報を確認してください")} · {quantity(manufacturingInputQuantity(input, recipe, outputQuantity), configured?.unit ?? "")} · {t(input.mode === "exact" ? "実測投入" : input.mode === "estimate" ? "標準目安・帳簿から差し引かない" : "未計量")}</span>; })}</div>
          <details className={styles.detail}><summary>{t("投入量の実測・保管場所を詳しく指定")}</summary><div>{inputs.map((input, index) => { const candidates = targets.filter(item => item.productId === input.productId), configured = recipe.snapshot.inputs.find(line => line.productId === input.productId); return <div className={styles.card} key={input.productId}><strong>{candidates[0]?.productName ?? t("商品情報を確認してください")}</strong><div className={styles.fields}><label><span>{t("原材料を使う保管場所")}</span><select name={`productionInputLocation-${index}`} value={input.inventoryItemId} disabled={locked} onChange={event => updateInput(index, { inventoryItemId: event.target.value })}><option value="">{t("保管場所を選択してください")}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.locationName} · {item.countUnit}</option>)}</select></label><label><span>{t("投入数量の扱い")}</span><select name={`productionInputMode-${index}`} value={input.mode} disabled={locked} onChange={event => updateInput(index, { mode: event.target.value as ProductionInputMode, quantity: "" })}><option value="estimate" disabled={configured?.quantity === null}>{t("標準目安・予測として記録")}</option><option value="exact">{t("実測した投入量・帳簿から差し引く")}</option><option value="unmeasured">{t("未計量")}</option></select></label>{input.mode === "exact" ? <label><span>{t("実測した投入量")}</span><input name={`productionInputQuantity-${index}`} inputMode="decimal" value={input.quantity} disabled={locked} onChange={event => updateInput(index, { quantity: event.target.value })} /><small>{configured?.unit}</small></label> : null}</div></div>; })}</div></details>
          {inputs.some(input => !input.inventoryItemId) ? <p className={styles.warning}>{t("原材料の保管場所を詳細で選択してください。複数の場所からは自動で選びません。")}</p> : null}
          {outputTarget ? <p className={styles.hint}>{t("登録前の帳簿在庫")} · {quantity(outputTarget.stockQuantity, outputTarget.countUnit)}{outputTarget.stockQuantity === null ? ` · ${t("未確認の現在庫は、この登録だけでは確定しません。")}` : ""}</p> : null}
          <label className={styles.check}><input name="productionConfirmed" type="checkbox" disabled={locked || recipeChanged} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{t("今回のできあがり数量と原材料の扱い・保管場所を確認しました")}</span></label>
          <div className={styles.actions}><button className="primary-button" type="submit" disabled={!canProduce}>{t(operation.busy ? "登録中..." : "今回の仕込みを登録")}</button></div>
        </> : null}
        {!data.recipes.some(recipe => recipe.kind === "production" && recipe.status === "active") ? <p>{t("仕込みの配合を先に設定してください。")}</p> : null}
      </form> : data && !data.canProduce ? <p className={styles.hint}>{t("このアカウントでは仕込みを登録できません。")}</p> : null}
      <details className={styles.detail} open={recipeOpen} onToggle={event => setRecipeOpen(event.currentTarget.open)}><summary>{t("仕込みの配合を確認・設定")}</summary>{recipeOpen ? <InventoryRecipeEditor storeId={storeId} defaultKind="production" onSaved={() => { void model.load(); onChanged?.(); }} /> : null}</details>
      {data?.canTransfer || data?.canReceive ? <details className={styles.detail}><summary>{t("店舗への供給・到着の確認")}</summary><div>
        <p className={styles.hint}>{t("出荷は出庫として記録し、店舗で受け取るまでは輸送中です。店舗の受取登録で初めて入庫します。")}</p>
        {transferUnitChanged ? <p className={styles.warning}>{t("出庫元の単位が変わりました。数量や価格を読み替えず、商品・保管場所を選び直してください。")}</p> : null}
        {data.canTransfer ? <form className={styles.body} onSubmit={event => { event.preventDefault(); void dispatch(); }}><div className={styles.fields}>
          <label><span>{t("出荷する商品・保管場所")}</span><select name="transferSourceItemId" value={sourceId} disabled={locked} onChange={event => { setSourceId(event.target.value); const selected = targets.find(item => item.id === event.target.value); setTransferBasis(selected ? { sourceId: selected.id, countUnit: selected.countUnit } : null); setTransferTargetId(""); setTransferText(""); setCostText(""); setSupplyText(""); }}><option value="">{t("選択してください")}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.productName} · {item.locationName} · {item.countUnit}</option>)}</select></label>
          <label><span>{t("届け先の店舗・保管場所")}</span><select name="transferTargetItemId" value={transferTargetId} disabled={locked} onChange={event => setTransferTargetId(event.target.value)}><option value="">{t("選択してください")}</option>{destinationOptions.map(item => <option key={item.id} value={item.id}>{item.storeName} · {item.locationName} · {item.countUnit}</option>)}</select></label>
          <label><span>{t("今回出荷する数量")}</span><input name="transferQuantity" inputMode="decimal" value={transferText} disabled={locked} onChange={event => setTransferText(event.target.value)} /><small>{source?.countUnit}</small></label>
        </div><details className={styles.detail}><summary>{t("供給価格・本部原価の記録")}</summary><div className={styles.fields}><label><span>{t("1 {unit} の供給価格（円）", { unit: source?.countUnit ?? "—" })}</span><input name="supplyPriceJpy" inputMode="decimal" value={supplyText} disabled={locked} onChange={event => setSupplyText(event.target.value)} /></label><label><span>{t("1 {unit} の本部原価（円）", { unit: source?.countUnit ?? "—" })}</span><input name="costPriceJpy" inputMode="decimal" value={costText} disabled={locked} onChange={event => setCostText(event.target.value)} /></label><p className={`${styles.hint} ${styles.wide}`}>{t("価格は供給の記録です。請求・支払の確定は行いません。")}</p></div></details><div className={styles.actions}><button type="submit" className="primary-button" disabled={!source || !destination || transferUnitChanged || transferQuantity === null || transferQuantity <= 0 || locked || operation.needsReview}>{t("今回の出荷を登録")}</button></div></form> : null}
        {data.transfers.filter(transfer => transfer.status === "in_transit").map(transfer => { const target = targets.find(item => item.id === transfer.targetInventoryItemId && item.productId === transfer.productId), amount = parseInventoryCountQuantity(receiveTexts[transfer.id]); return <div className={styles.card} key={transfer.id}><strong>{transfer.productName} · {t("輸送中")}</strong><span>{t("未受取数量")} · {quantity(transfer.remainingQuantity, transfer.unit)}</span>{data.canReceive && transfer.targetStoreId === storeId && target ? <><label className={styles.label}><span>{t("今回実際に受け取った数量")}</span><input name={`transferReceiveQuantity-${transfer.id}`} inputMode="decimal" value={receiveTexts[transfer.id] ?? ""} disabled={locked} onChange={event => { setReceiveTexts(previous => ({ ...previous, [transfer.id]: event.target.value })); setReceiveConfirmed(previous => ({ ...previous, [transfer.id]: false })); }} /><small>{transfer.unit} · {target.locationName}</small></label><button type="button" className="secondary-button" disabled={locked} onClick={() => { setReceiveTexts(previous => ({ ...previous, [transfer.id]: String(transfer.remainingQuantity) })); setReceiveConfirmed(previous => ({ ...previous, [transfer.id]: false })); }}>{t("未受取分の数量を入力")}</button><label className={styles.check}><input type="checkbox" checked={receiveConfirmed[transfer.id] ?? false} disabled={locked} onChange={event => setReceiveConfirmed(previous => ({ ...previous, [transfer.id]: event.target.checked }))} /><span>{t("実際の到着数量を確認しました")}</span></label><div className={styles.actions}><button type="button" className="primary-button" disabled={!receiveConfirmed[transfer.id] || amount === null || amount <= 0 || amount > transfer.remainingQuantity || locked || operation.needsReview} onClick={() => void receive(transfer.id)}>{t("今回の受取を登録して入庫")}</button></div></> : null}</div>; })}
      </div></details> : null}
      <details className={styles.detail}><summary>{t("最近の仕込み・供給の記録")}</summary><div><ul className={styles.list}>{data?.recent.map(record => <li key={record.id}><strong>{record.recipeName || t(record.action === "transfer_dispatch" ? "店舗への出荷" : "店舗での受取")}</strong>{record.outputQuantity !== null ? <span>{quantity(record.outputQuantity, record.outputUnit)}</span> : null}<small>{new Date(record.createdAt).toLocaleString(language)} · {record.recordedBy}</small></li>)}</ul></div></details>
    </div> : null}
  </details>;
}
