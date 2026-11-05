"use client";

import { Download, FolderPlus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canDineInGroupImportAddons, getDineInAddonCandidates, getDineInAddonImportCandidates, getDineInEffectiveItemGroupIds, getDineInGroupItemIds, getDineInOptionIdentity, getDineInLinkedItemDisabledReason, isDineInSingleChoiceGroup, type StoreDineInCatalog, type StoreDineInChange, type StoreDineInGroup, type StoreDineInKind } from "../../../lib/store-dine-in-menu-policy";
import { getPosOptionSelectionRules } from "../../../lib/dine-in-option-selection";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./DineInMenuEditor.module.css";

export type DineInMenuCommand = Omit<StoreDineInChange, "operationId" | "revision">;
export type DineInOptionCreateRequest = { token: string; groupId: string };
export type DineInImportRequest = { token: string; kind: "import" | "addon" | "importGroup"; sourceItemId?: string; sourceGroupId?: string; sourceOptionIds?: string[]; itemId?: string };
type Submit = (command: DineInMenuCommand) => Promise<unknown>;
type Candidates = ReturnType<typeof getDineInAddonCandidates>;
type PickerProps = { catalog: StoreDineInCatalog; source?: StoreDineInCatalog; candidates: Candidates; value: string[]; onChange: (ids: string[]) => void; disabled: boolean; prefix: string };
type ComposerProps = {
  catalog: StoreDineInCatalog;
  source?: StoreDineInCatalog;
  pricingDefaults?: { unit: string; unitPrice: number | null };
  disabled: boolean;
  disabledReason: string;
  completionId: string;
  selectedItemId: string;
  selectedGroupId: string;
  optionCreateRequest?: DineInOptionCreateRequest | null;
  importRequest?: DineInImportRequest | null;
  onSubmit: Submit;
};
type FormKind = "category" | "item" | "import" | "addon" | "group" | "importGroup" | "option" | "";

function getGroupProductNames(catalog?: StoreDineInCatalog) {
  const names = new Map<string, string[]>();
  if (!catalog) return names;
  for (const item of catalog.items) for (const groupId of getDineInEffectiveItemGroupIds(catalog, item.id)) {
    const current = names.get(groupId) || []; current.push(item.name); names.set(groupId, current);
  }
  return names;
}

function AddonOptionsPicker({ catalog, source, candidates, value, onChange, disabled, prefix }: PickerProps) {
  const { t } = useOsTranslation();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const storeContexts = useMemo(() => getGroupProductNames(catalog), [catalog]);
  const brandContexts = useMemo(() => getGroupProductNames(source), [source]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, { key: string; id: string; name: string; origin: "store" | "brand"; context: string; options: Candidates }>();
    for (const candidate of candidates) {
      const key = `${candidate.origin}:${candidate.groupId}`;
      if (!byGroup.has(key)) {
        const names = (candidate.origin === "brand" ? brandContexts : storeContexts).get(candidate.groupId) || [];
        byGroup.set(key, { key, id: candidate.groupId, name: candidate.groupName, origin: candidate.origin, context: names.length ? names.join(" / ") : t("未関連"), options: [] });
      }
      byGroup.get(key)!.options.push(candidate);
    }
    return [...byGroup.values()];
  }, [candidates, storeContexts, brandContexts, t]);
  const filtered = groups.flatMap(group => {
    const options = group.options.filter(candidate => `${group.name} ${group.context} ${candidate.option.name}`.toLocaleLowerCase().includes(normalizedQuery));
    return options.length ? [{ ...group, matchingOptions: options }] : [];
  });
  function toggle(id: string, checked: boolean) { onChange(checked ? [...new Set([...value, id])] : value.filter(value => value !== id)); }
  return <div className={styles.addonPicker}>
    <p className={styles.help}>{t("辛さ・しびれ・スープ・麺や必須の選択肢は独立したままにし、任意の追加食材だけをまとめます。")}</p>
    {candidates.length ? <>
      <label htmlFor={`${prefix}-search`}>{t("追加食材を検索")}</label>
      <input id={`${prefix}-search`} type="search" data-addon-source-search value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={t("食材名・元のグループ名")} />
      <div className={styles.pickerToolbar}><span>{t("選択中 {count} 件", { count: value.length })}</span><button type="button" className="secondary-button compact-button" data-addon-source-expand-all disabled={disabled || Boolean(normalizedQuery)} onClick={() => setExpanded(Object.fromEntries(groups.map(group => [group.key, true])))}>{t("すべて開く")}</button></div>
      <div className={styles.addonCandidates}>
        {filtered.map(group => {
          const open = Boolean(normalizedQuery) || expanded[group.key] === true;
          const sectionId = `${prefix}-${group.key.replace(":", "-")}`;
          return <section key={group.key} className={styles.addonSourceGroup} data-addon-source-group={group.id} data-addon-source-origin={group.origin}>
            <button type="button" className={styles.addonSourceToggle} data-addon-source-toggle={group.key} aria-expanded={open} aria-controls={sectionId} disabled={disabled || Boolean(normalizedQuery)} onClick={() => setExpanded(current => ({ ...current, [group.key]: !open }))}>
              <span><strong>{group.name}</strong><small>{t(group.origin === "brand" ? "ブランドメニュー" : "この店舗の店内メニュー")} · {group.context}</small></span><span>{t("表示 {count} / {total} 件", { count: group.matchingOptions.length, total: group.options.length })}{value.some(id => group.options.some(candidate => candidate.option.id === id)) ? ` · ${t("選択中")}` : ""}</span>
            </button>
            <div id={sectionId} className={styles.addonSourceOptions} hidden={!open}>
              {group.matchingOptions.map(candidate => <label key={candidate.option.id} className={styles.addonChoice}>
                <input type="checkbox" data-addon-option-id={candidate.option.id} checked={value.includes(candidate.option.id)} disabled={disabled} onChange={event => toggle(candidate.option.id, event.target.checked)} />
                <span>{candidate.option.name}</span><small>¥{candidate.option.priceDelta.toLocaleString("ja-JP")}</small>
              </label>)}
            </div>
          </section>;
        })}
        {!filtered.length ? <p className={styles.help}>{t("該当する追加食材がありません。")}</p> : null}
      </div>
    </> : <p className={styles.help}>{t("取り込める追加食材がありません。食材を選ばずにグループだけ作成することもできます。")}</p>}
    <p className={styles.help}>{t("取込元と取込先は別々のグループです。名前が同じでも自動では統合しません。価格と50gなどの規格を引き継ぎます。")}</p>
  </div>;
}

export function DineInMenuComposer({ catalog, source, pricingDefaults, disabled, disabledReason, completionId, selectedItemId, selectedGroupId, optionCreateRequest, importRequest, onSubmit }: ComposerProps) {
  const { t } = useOsTranslation();
  const importedRequestToken = useRef("");
  const optionRequestToken = useRef("");
  const optionForm = useRef<HTMLFormElement>(null);
  const optionNameInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<FormKind>("");
  const [categoryName, setCategoryName] = useState("");
  const [optionGroupId, setOptionGroupId] = useState("");
  const [optionName, setOptionName] = useState("");
  const [optionPrice, setOptionPrice] = useState("");
  const [optionPortion, setOptionPortion] = useState("");
  const [itemName, setItemName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [itemKind, setItemKind] = useState<"drink" | "fixed_product" | "buildable_product">("buildable_product");
  const [pricingMode, setPricingMode] = useState<"fixed" | "weight">("weight");
  const [price, setPrice] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceItemId, setSourceItemId] = useState("");
  const [importName, setImportName] = useState("");
  const [importCategoryId, setImportCategoryId] = useState("");
  const [addonItemId, setAddonItemId] = useState("");
  const [addonTargetId, setAddonTargetId] = useState("");
  const [addonMode, setAddonMode] = useState<"new" | "existing">("new");
  const [addonName, setAddonName] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [groupSelectionType, setGroupSelectionType] = useState<"single" | "quantity">("single");
  const [groupOrigin, setGroupOrigin] = useState<"brand" | "store">("brand");
  const [importGroupId, setImportGroupId] = useState("");
  const [importGroupName, setImportGroupName] = useState("");
  const [importGroupOptions, setImportGroupOptions] = useState<string[]>([]);
  const [importGroupQuery, setImportGroupQuery] = useState("");
  const storeGroupContexts = useMemo(() => getGroupProductNames(catalog), [catalog]);
  const brandGroupContexts = useMemo(() => getGroupProductNames(source), [source]);
  const sourceItem = source?.items.find(item => item.id === sourceItemId);
  const effectiveCategoryId = catalog.categories.some(category => category.id === categoryId) ? categoryId : "";
  const effectiveAddonItemId = catalog.items.some(item => item.id === addonItemId) ? addonItemId : "";
  const addonTargets = catalog.optionGroups.filter(group => canDineInGroupImportAddons(group));
  const addonTarget = addonMode === "existing" ? addonTargets.find(group => group.id === addonTargetId) : undefined;
  const candidates = useMemo(() => addonTarget ? getDineInAddonImportCandidates(catalog, addonTarget.id, source) : addonMode === "new" ? getDineInAddonCandidates(catalog, effectiveAddonItemId, undefined, source) : [], [catalog, effectiveAddonItemId, addonTarget, addonMode, source]);
  const effectiveAddonIds = addonIds.filter(id => candidates.some(candidate => candidate.option.id === id));
  const sourceItems = source?.items.filter(item => `${item.name} ${item.category}`.toLocaleLowerCase().includes(sourceQuery.trim().toLocaleLowerCase())) || [];
  const validPrice = /^\d{1,7}$/.test(price) && Number(price) <= 9_999_999;
  const weightPricingAvailable = Number(pricingDefaults?.unitPrice) > 0;
  const importableGroups = (groupOrigin === "brand" ? source?.optionGroups || [] : catalog.optionGroups).filter(group => group.options.length > 0);
  const importGroup = importableGroups.find(group => group.id === importGroupId);
  const groupContexts = groupOrigin === "brand" ? brandGroupContexts : storeGroupContexts;
  const matchingImportGroups = importableGroups.filter(group => `${group.name} ${group.sourceName} ${(groupContexts.get(group.id) || []).join(" ")}`.toLocaleLowerCase().includes(importGroupQuery.trim().toLocaleLowerCase()));
  const importOptionIds = importGroupOptions.filter(id => importGroup?.options.some(option => option.id === id));
  const importRules = importGroup ? getPosOptionSelectionRules(importGroup) : null;
  const importMinimum = importRules?.min || 0;
  const importMinimumOptions = importRules?.type === "quantity" ? Math.ceil(importMinimum / Math.max(1, importRules.perOptionMax)) : importMinimum;
  const importSelectionInsufficient = importOptionIds.length < importMinimumOptions;
  const optionGroup = catalog.optionGroups.find(group => group.id === optionGroupId);
  const groupPortion = Number(optionGroup?.ruleJson.portionGrams);
  const inheritedPortion = Number.isInteger(groupPortion) && groupPortion > 0 && groupPortion <= 99_999 ? groupPortion : null;
  const validOptionName = Boolean(optionName.trim()) && [...optionName.trim()].length <= 120 && !/[\u0000-\u001f\u007f]/.test(optionName);
  const validOptionPrice = /^\d{1,7}$/.test(optionPrice) && Number(optionPrice) <= 9_999_999;
  const validOptionPortion = !optionPortion || /^\d{1,5}$/.test(optionPortion) && Number(optionPortion) > 0 && Number(optionPortion) <= 99_999;
  const optionConsumerNames = optionGroup ? storeGroupContexts.get(optionGroup.id) || [] : [];
  const optionDisabledReason = !catalog.optionGroups.length ? "先に選択グループを作成してください。" : !optionGroup ? "追加先の選択グループを選択してください。" : !validOptionName ? "選択肢名は1〜120文字で入力してください。" : !validOptionPrice ? "価格は0〜9,999,999円の整数で入力してください。" : !validOptionPortion ? "1点あたりの重量は1〜99,999gの整数で入力するか、空欄にしてください。" : "";
  const newItemDisabledReason = !catalog.categories.length ? "先に商品分類を作成してください。" : !itemName.trim() ? "商品名を入力してください。" : !effectiveCategoryId ? "商品分類を選択してください。" : pricingMode === "weight" ? !weightPricingAvailable ? "重量単価が未設定です。店舗の POS 設定で設定してください。" : "" : !validPrice ? "販売価格を円の整数で入力してください。" : "";

  useEffect(() => {
    setOpen(""); setCategoryName(""); setItemName(""); setPrice(""); setItemKind("buildable_product"); setPricingMode("weight");
    setSourceQuery(""); setSourceItemId(""); setImportName(""); setImportCategoryId("");
    setAddonName(""); setAddonTargetId(""); setAddonMode("new"); setAddonIds([]); setGroupSelectionType("single");
    setGroupOrigin("brand"); setImportGroupId(""); setImportGroupName(""); setImportGroupOptions([]); setImportGroupQuery("");
    setOptionGroupId(""); setOptionName(""); setOptionPrice(""); setOptionPortion("");
  }, [completionId]);

  useEffect(() => {
    if (!importRequest || importedRequestToken.current === importRequest.token) return;
    importedRequestToken.current = importRequest.token;
    setOpen(importRequest.kind);
    if (importRequest.kind === "import") {
      const item = source?.items.find(item => item.id === importRequest.sourceItemId || item.sourceItemId === importRequest.sourceItemId);
      setSourceQuery(""); setSourceItemId(item?.id || ""); setImportName(item?.name || ""); setImportCategoryId("");
    } else if (importRequest.kind === "importGroup") {
      const group = source?.optionGroups.find(group => group.id === importRequest.sourceGroupId);
      setAddonItemId(importRequest.itemId || catalog.items[0]?.id || "");
      setGroupOrigin("brand"); setImportGroupId(group?.id || ""); setImportGroupName(group?.name || "");
      setImportGroupOptions(importRequest.sourceOptionIds?.length ? importRequest.sourceOptionIds : group?.options.map(option => option.id) || []);
    } else {
      setAddonItemId(importRequest.itemId || catalog.items[0]?.id || "");
      const target = catalog.optionGroups.find(group => getDineInEffectiveItemGroupIds(catalog, importRequest.itemId || catalog.items[0]?.id || "").includes(group.id) && canDineInGroupImportAddons(group));
      setAddonTargetId(target?.id || ""); setAddonMode(target ? "existing" : "new");
      setAddonName(""); setAddonIds(importRequest.sourceOptionIds || []);
    }
  }, [importRequest, source, catalog.items, catalog.optionGroups]);

  useEffect(() => {
    if (!optionCreateRequest || optionRequestToken.current === optionCreateRequest.token) return;
    optionRequestToken.current = optionCreateRequest.token;
    setOptionGroupId(catalog.optionGroups.some(group => group.id === optionCreateRequest.groupId) ? optionCreateRequest.groupId : "");
    setOptionName(""); setOptionPrice(""); setOptionPortion(""); setOpen("option");
  }, [optionCreateRequest, catalog.optionGroups]);

  useEffect(() => {
    if (open !== "option") return;
    optionForm.current?.scrollIntoView({ block: "nearest" });
    optionNameInput.current?.focus({ preventScroll: true });
  }, [open, optionCreateRequest?.token]);

  function toggle(kind: FormKind) {
    if (kind === "option" && open !== "option") {
      setOptionGroupId(catalog.optionGroups.some(group => group.id === selectedGroupId) ? selectedGroupId : catalog.optionGroups[0]?.id || "");
      setOptionPortion("");
    }
    if (kind === "item" && !categoryId && catalog.categories.length) setCategoryId(catalog.categories[0].id);
    if (kind === "addon" || kind === "group" || kind === "importGroup") {
      setAddonItemId(catalog.items.some(item => item.id === selectedItemId) ? selectedItemId : catalog.items[0]?.id || "");
      setAddonTargetId(""); setAddonMode("new"); setAddonIds([]);
    }
    setOpen(value => value === kind ? "" : kind);
  }

  return <section className={styles.composer} aria-label={t("店内メニューに追加")}>
    <div className={styles.composerActions}>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="category" disabled={disabled} aria-expanded={open === "category"} aria-controls="dine-in-compose-category" onClick={() => toggle("category")}><FolderPlus size={15} aria-hidden="true" />{t("商品分類を追加")}</button>
      <button type="button" className="primary-button compact-button" data-dine-in-open="item" disabled={disabled} aria-expanded={open === "item"} aria-controls="dine-in-compose-item" onClick={() => toggle("item")}><Plus size={15} aria-hidden="true" />{t("商品を新規作成")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="option" disabled={disabled} aria-expanded={open === "option"} aria-controls="dine-in-compose-option" onClick={() => toggle("option")}><Plus size={15} aria-hidden="true" />{t("新規選択肢を作成")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="import" disabled={disabled} aria-expanded={open === "import"} aria-controls="dine-in-compose-import" onClick={() => toggle("import")}><Download size={15} aria-hidden="true" />{t("ブランド商品から取込")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="group" disabled={disabled || !catalog.items.length} aria-expanded={open === "group"} aria-controls="dine-in-compose-group" onClick={() => toggle("group")}><Plus size={15} aria-hidden="true" />{t("選択グループを作成")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="importGroup" disabled={disabled || !catalog.items.length} aria-expanded={open === "importGroup"} aria-controls="dine-in-compose-importGroup" onClick={() => toggle("importGroup")}><Download size={15} aria-hidden="true" />{t("味・麺などのグループを取込")}</button>
      <button type="button" className="secondary-button compact-button" data-dine-in-open="addon" disabled={disabled || !catalog.items.length} aria-expanded={open === "addon"} aria-controls="dine-in-compose-addon" onClick={() => toggle("addon")}><Plus size={15} aria-hidden="true" />{t("追加食材グループを作成")}</button>
    </div>
    {disabledReason ? <p className={styles.help}>{t(disabledReason)}</p> : null}
    {!catalog.items.length && !open ? <p className={styles.help}>{t("商品分類を作り、商品を追加してください。必要な商品だけブランドメニューから取り込むこともできます。")}</p> : null}
    {open ? <div id={`dine-in-compose-${open}`} className={styles.composeForm} data-dine-in-composer={open}>
      <div className={styles.composeHeading}>
        <h4>{t(open === "category" ? "商品分類を追加" : open === "option" ? "新規選択肢を作成" : open === "item" ? "商品を新規作成" : open === "import" ? "ブランド商品から取込" : open === "group" ? "選択グループを作成" : open === "importGroup" ? "味・麺などのグループを取込" : "追加食材グループを作成")}</h4>
        <button type="button" className="secondary-button compact-button" aria-label={t("入力欄を閉じる")} disabled={disabled} onClick={() => setOpen("")}><X size={15} aria-hidden="true" />{t("閉じる")}</button>
      </div>
      {open === "option" ? <form ref={optionForm} className={styles.creationForm} data-dine-in-create-option-form onSubmit={event => {
        event.preventDefault();
        if (!disabled && optionGroup && !optionDisabledReason) void onSubmit({ action: "createOption", targetId: optionGroup.id, name: optionName.trim(), price: Number(optionPrice), ...(optionPortion ? { portionGrams: Number(optionPortion) } : {}) });
      }}>
        <p className={styles.help}>{t("ブランド商品を取り込まず、この店舗だけで使う選択肢を一から作成します。Web予約・Webサイト・外部デリバリーは変更しません。")}</p>
        {catalog.optionGroups.length ? <>
          <label htmlFor="dine-in-new-option-group">{t("追加先の選択グループ")}<select id="dine-in-new-option-group" data-dine-in-new-option-group value={optionGroup?.id || ""} disabled={disabled} onChange={event => { setOptionGroupId(event.target.value); setOptionPortion(""); }}><option value="">{t("追加先の選択グループを選択してください。")}</option>{catalog.optionGroups.map(group => <option key={group.id} value={group.id}>{group.name} / {(storeGroupContexts.get(group.id) || []).join(" / ") || t("未関連")}{group.visible === false ? ` / ${t("グループ非公開")}` : ""}</option>)}</select></label>
          <div className={styles.formColumns}>
            <label htmlFor="dine-in-new-option-name">{t("選択肢名")}<input ref={optionNameInput} id="dine-in-new-option-name" data-dine-in-new-option-name value={optionName} maxLength={120} disabled={disabled} onChange={event => setOptionName(event.target.value)} /></label>
            <label htmlFor="dine-in-new-option-price">{t("追加料金（円／1点・0円可）")}<input id="dine-in-new-option-price" data-dine-in-new-option-price inputMode="numeric" value={optionPrice} maxLength={7} disabled={disabled} onChange={event => setOptionPrice(event.target.value.normalize("NFKC").replace(/[￥¥円,\s]/g, ""))} /></label>
            <label htmlFor="dine-in-new-option-portion">{t("1点あたりの重量（g・任意）")}<input id="dine-in-new-option-portion" data-dine-in-new-option-portion inputMode="numeric" value={optionPortion} maxLength={5} disabled={disabled} placeholder={inheritedPortion ? t("未入力：1点 {grams}g", { grams: inheritedPortion }) : t("未入力：1点（重量指定なし）")} onChange={event => setOptionPortion(event.target.value.normalize("NFKC"))} aria-describedby="dine-in-new-option-portion-help" /></label>
          </div>
          <p id="dine-in-new-option-portion-help" className={styles.help} data-dine-in-new-option-portion-help>{inheritedPortion ? t("空欄の場合、このグループの現在の規格（1点 {grams}g）を引き継ぎます。", { grams: inheritedPortion }) : t("空欄の場合は重量を指定せず、1点として販売します。")}</p>
          {optionGroup ? <div className={styles.optionCreateScope} data-dine-in-new-option-scope><p>{t("このグループを使う店内商品 {count} 件に追加します。", { count: optionConsumerNames.length })}{optionConsumerNames.length ? ` ${optionConsumerNames.join(" / ")}` : ""}</p>{optionGroup.visible === false ? <p>{t("このグループは非公開です。選択肢を追加しても自動では公開しません。")}</p> : null}<p>{t("グループの選び方・必須数・既存の選択肢の名前・価格・規格は変更しません。")}</p></div> : null}
          {optionDisabledReason ? <p className={styles.help} role="status">{t(optionDisabledReason)}</p> : null}
          <button type="submit" className="primary-button compact-button" data-dine-in-action="createOption" disabled={disabled || Boolean(optionDisabledReason)}>{t("新規選択肢を追加")}</button>
        </> : <>
          <p className={styles.help} role="status">{t("先に選択グループを作成してください。")}</p>
          {!catalog.items.length ? <p className={styles.help}>{t("先に商品を作成するか、ブランド商品を取り込んでください。選択グループは商品に付けて管理します。")}</p> : null}
          <button type="button" className="secondary-button compact-button" data-dine-in-create-option-first-group disabled={disabled || !catalog.items.length} onClick={() => toggle("group")}>{t("選択グループを作成")}</button>
        </>}
      </form> : null}
      {open === "category" ? <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && categoryName.trim()) void onSubmit({ action: "createCategory", name: categoryName.trim() }); }}>
        <p className={styles.help}>{t("商品分類は POS の商品一覧を分ける見出しです。追加料金の選択グループとは別に管理します。")}</p>
        <label htmlFor="dine-in-new-category-name">{t("商品分類名")}</label>
        <input id="dine-in-new-category-name" value={categoryName} disabled={disabled} maxLength={120} placeholder={t("例：ドリンク")} onChange={event => setCategoryName(event.target.value)} />
        <button type="submit" className="primary-button compact-button" data-dine-in-action="createCategory" disabled={disabled || !categoryName.trim()}>{t("商品分類を作成")}</button>
      </form> : null}
      {open === "item" ? <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && !newItemDisabledReason) void onSubmit({ action: "createItem", name: itemName.trim(), categoryId: effectiveCategoryId, itemKind, pricingMode, price: pricingMode === "weight" ? 0 : Number(price) }); }}>
        <p className={styles.help}>{t("この店舗の店内飲食だけで販売する商品を作成します。新しい商品の価格を設定してください。")}</p>
        <div className={styles.formColumns}>
          <label htmlFor="dine-in-new-item-name">{t("商品名")}<input id="dine-in-new-item-name" value={itemName} disabled={disabled} maxLength={120} onChange={event => setItemName(event.target.value)} /></label>
          <label htmlFor="dine-in-new-item-category">{t("商品分類")}<select id="dine-in-new-item-category" value={effectiveCategoryId} disabled={disabled || !catalog.categories.length} onChange={event => setCategoryId(event.target.value)}><option value="">{t("商品分類を選択")}</option>{catalog.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label htmlFor="dine-in-new-item-kind">{t("商品の種類")}<select id="dine-in-new-item-kind" value={itemKind} disabled={disabled} onChange={event => {
            const nextKind = event.target.value as typeof itemKind;
            setItemKind(nextKind); setPricingMode(nextKind === "buildable_product" ? "weight" : "fixed");
          }}><option value="buildable_product">{t("基本商品（麻辣湯の一杯）")}</option><option value="fixed_product">{t("料理・単品（1個・1皿ごと）")}</option><option value="drink">{t("ドリンク")}</option></select></label>
          <label htmlFor="dine-in-new-item-pricing">{t("販売方法")}<select id="dine-in-new-item-pricing" value={pricingMode} disabled={disabled || itemKind === "drink"} onChange={event => setPricingMode(event.target.value as "fixed" | "weight")}><option value="fixed">{t("個数販売（1個・1皿ごと）")}</option><option value="weight">{t("計量販売（重量で計算）")}</option></select></label>
          {pricingMode === "fixed" ? <label htmlFor="dine-in-new-item-price">{t("販売価格（円）")}<input id="dine-in-new-item-price" inputMode="numeric" value={price} disabled={disabled} maxLength={7} placeholder="0" onChange={event => setPrice(event.target.value.normalize("NFKC").replace(/[￥¥円,\s]/g, ""))} /></label> : null}
        </div>
        {itemKind === "buildable_product" ? <p className={styles.help}>{t("基本商品は厨房で一杯として扱います。")}</p> : null}
        {itemKind === "drink" ? <p className={styles.help}>{t("ドリンクは個数販売です。重量では計算しません。")}</p> : <p className={styles.help}>{t("麺・追加食材は、選択した個数で加算します。")}</p>}
        {pricingMode === "weight" ? <>
          <p className={styles.help}>{t("計量販売には現在の店舗設定の重量単価を使用します。")}</p>
          {weightPricingAvailable ? <div className={styles.pricingRate} data-dine-in-new-weight-rate><span>{t("店舗設定の重量単価")}</span><strong>{t("¥{price} / 1{unit}", { price: Number(pricingDefaults!.unitPrice).toLocaleString("ja-JP"), unit: pricingDefaults!.unit || "g" })}</strong></div> : null}
        </> : null}
        <p className={styles.help}>{t("税の扱いは店舗の POS 設定に従います。")}</p>
        {newItemDisabledReason ? <p id="dine-in-create-item-help" className={styles.help}>{t(newItemDisabledReason)}</p> : null}
        <button type="submit" className="primary-button compact-button" data-dine-in-action="createItem" disabled={disabled || Boolean(newItemDisabledReason)} aria-describedby={newItemDisabledReason ? "dine-in-create-item-help" : undefined}>{t("商品を作成")}</button>
      </form> : null}
      {open === "import" ? <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && sourceItem && importName.trim()) void onSubmit({ action: "importItem", sourceItemId: sourceItem.id, name: importName.trim(), ...(importCategoryId ? { categoryId: importCategoryId } : {}) }); }}>
        <p className={styles.help}>{t("必要な商品を1件ずつ取り込みます。元の商品・価格・Web予約・外部デリバリーは変更しません。")}</p>
        {!source ? <p className={styles.help}>{t("ブランド商品の候補を取得できません。再読込してください。")}</p> : <>
          <label htmlFor="dine-in-import-search">{t("ブランド商品を検索")}</label>
          <input id="dine-in-import-search" type="search" value={sourceQuery} disabled={disabled} onChange={event => setSourceQuery(event.target.value)} placeholder={t("商品名・商品分類")} />
          <label htmlFor="dine-in-import-source">{t("取り込むブランド商品")}</label>
          <select id="dine-in-import-source" value={sourceItemId} disabled={disabled} onChange={event => { setSourceItemId(event.target.value); setImportName(source.items.find(item => item.id === event.target.value)?.name || ""); }}><option value="">{t("ブランド商品を選択")}</option>{sourceItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{sourceItem && !sourceItems.some(item => item.id === sourceItem.id) ? <option value={sourceItem.id}>{sourceItem.name}</option> : null}</select>
          {!sourceItems.length ? <p className={styles.help}>{t("該当するブランド商品がありません。")}</p> : null}
          {sourceItem ? <>
            <div className={styles.importSummary}><span>{sourceItem.name}</span><strong>{sourceItem.posPricingMode === "weight" ? t("¥{price} / 1{unit}", { price: Number(sourceItem.posWeightUnitPrice || 0).toLocaleString("ja-JP"), unit: sourceItem.posWeightUnit || "g" }) : t("¥{price} / 1点", { price: sourceItem.price.toLocaleString("ja-JP") })}</strong><small>{t("原価格・規格・選択ルールを引き継ぎます。取り込んだ後の店内名は自由に変更できます。")}</small></div>
            <div className={styles.formColumns}>
              <label htmlFor="dine-in-import-name">{t("取り込んだ後の店内名")}<input id="dine-in-import-name" maxLength={120} value={importName} disabled={disabled} onChange={event => setImportName(event.target.value)} /></label>
              <label htmlFor="dine-in-import-category">{t("取り込んだ後の商品分類")}<select id="dine-in-import-category" value={importCategoryId} disabled={disabled} onChange={event => setImportCategoryId(event.target.value)}><option value="">{t("元の商品分類を使用")}</option>{catalog.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            </div>
          </> : null}
          <button type="submit" className="primary-button compact-button" data-dine-in-action="importItem" disabled={disabled || !sourceItem || !importName.trim()}>{t("この商品を取り込む")}</button>
        </>}
      </form> : null}
      {open === "group" ? <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && effectiveAddonItemId && addonName.trim()) void onSubmit({ action: "createOptionGroup", itemId: effectiveAddonItemId, name: addonName.trim(), selectionType: groupSelectionType }); }}>
        <p className={styles.help}>{t("商品に属する任意の選択グループを作成します。作成後、既存のグループから追加食材を選んで取り込めます。")}</p>
        <div className={styles.formColumns}>
          <label htmlFor="dine-in-group-item">{t("所属する商品")}<select id="dine-in-group-item" value={effectiveAddonItemId} disabled={disabled} onChange={event => setAddonItemId(event.target.value)}><option value="">{t("商品を選択")}</option>{catalog.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label htmlFor="dine-in-group-name">{t("選択グループ名")}<input id="dine-in-group-name" value={addonName} maxLength={120} disabled={disabled} onChange={event => setAddonName(event.target.value)} /></label>
          <label htmlFor="dine-in-group-selection">{t("選び方")}<select id="dine-in-group-selection" value={groupSelectionType} disabled={disabled} onChange={event => setGroupSelectionType(event.target.value as "single" | "quantity")}><option value="single">{t("1つだけ選択（任意）")}</option><option value="quantity">{t("個数で選択（複数可・任意）")}</option></select></label>
        </div>
        <p className={styles.help}>{t("辛さ・しびれ・スープ・麺や必須の選択肢は独立したままにし、任意の追加食材だけをまとめます。")}</p>
        <button type="submit" className="primary-button compact-button" data-dine-in-action="createOptionGroup" disabled={disabled || !effectiveAddonItemId || !addonName.trim()}>{t("選択グループを作成")}</button>
      </form> : null}
      {open === "importGroup" ? <form className={styles.creationForm} onSubmit={event => {
        event.preventDefault();
        if (!disabled && effectiveAddonItemId && importGroup && importGroupName.trim() && importOptionIds.length && !importSelectionInsufficient) void onSubmit({ action: "importOptionGroup", itemId: effectiveAddonItemId, sourceGroupId: importGroup.id, origin: groupOrigin, optionIds: importOptionIds, name: importGroupName.trim() });
      }}>
        <p className={styles.help}>{t("味・辛さ・しびれ・麺などを、独立した選択グループとして取り込みます。元のグループと他の商品は変更しません。")}</p>
        <div className={styles.formColumns}>
          <label htmlFor="dine-in-import-group-item">{t("所属する商品")}<select id="dine-in-import-group-item" value={effectiveAddonItemId} disabled={disabled} onChange={event => setAddonItemId(event.target.value)}><option value="">{t("商品を選択")}</option>{catalog.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label htmlFor="dine-in-import-group-origin">{t("取込元")}<select id="dine-in-import-group-origin" value={groupOrigin} disabled={disabled} onChange={event => { setGroupOrigin(event.target.value as "brand" | "store"); setImportGroupId(""); setImportGroupName(""); setImportGroupOptions([]); setImportGroupQuery(""); }}><option value="brand">{t("ブランドメニュー")}</option><option value="store">{t("この店舗の店内メニュー")}</option></select></label>
          <label htmlFor="dine-in-import-group-search">{t("選択グループを検索")}<input id="dine-in-import-group-search" data-import-group-search type="search" value={importGroupQuery} disabled={disabled} onChange={event => setImportGroupQuery(event.target.value)} placeholder={t("名前・関連する商品で検索")} /></label>
          <label htmlFor="dine-in-import-group-source">{t("取り込む選択グループ")}<select id="dine-in-import-group-source" value={importGroup?.id || ""} disabled={disabled} onChange={event => {
            const group = importableGroups.find(group => group.id === event.target.value);
            setImportGroupId(group?.id || ""); setImportGroupName(group?.name || ""); setImportGroupOptions(group?.options.map(option => option.id) || []);
          }}><option value="">{t("選択グループを選択")}</option>{matchingImportGroups.map(group => <option key={group.id} value={group.id}>{group.name} / {(groupContexts.get(group.id) || []).join(" / ") || t("未関連")}</option>)}{importGroup && !matchingImportGroups.some(group => group.id === importGroup.id) ? <option value={importGroup.id}>{importGroup.name}</option> : null}</select></label>
          <label htmlFor="dine-in-import-group-name">{t("取り込んだ後のグループ名")}<input id="dine-in-import-group-name" value={importGroupName} disabled={disabled || !importGroup} maxLength={120} onChange={event => setImportGroupName(event.target.value)} /></label>
        </div>
        {importGroup ? <>
          <p className={styles.help}>{t("価格・50gなどの規格・必須数・選び方を引き継ぎます。取込後に、この店舗だけの選び方を設定できます。")}</p>
          <div className={styles.pickerToolbar}><span>{t("選択中 {count} 件", { count: importOptionIds.length })}</span><button type="button" className="secondary-button compact-button" disabled={disabled} onClick={() => setImportGroupOptions(importGroup.options.map(option => option.id))}>{t("すべて選択")}</button></div>
          <div className={styles.addonCandidates}>{importGroup.options.map(option => <label className={styles.addonChoice} key={option.id}><input type="checkbox" data-dine-in-import-option-id={option.id} checked={importOptionIds.includes(option.id)} disabled={disabled} onChange={event => setImportGroupOptions(ids => event.target.checked ? [...ids, option.id] : ids.filter(id => id !== option.id))} /><span>{option.name}</span><small>¥{option.priceDelta.toLocaleString("ja-JP")}</small></label>)}</div>
          {importSelectionInsufficient ? <p role="status" className={styles.help}>{t("元の必須数を満たすため、{count} 件以上の選択肢を残してください。", { count: importMinimumOptions })}</p> : null}
        </> : <p className={styles.help}>{t("取り込むグループを選ぶと、内容と価格を確認できます。")}</p>}
        <button type="submit" className="primary-button compact-button" data-dine-in-action="importOptionGroup" disabled={disabled || !effectiveAddonItemId || !importGroup || !importGroupName.trim() || !importOptionIds.length || importSelectionInsufficient}>{t("この選択グループを取り込む")}</button>
      </form> : null}
      {open === "addon" ? <form className={styles.creationForm} onSubmit={event => {
        event.preventDefault();
        if (disabled) return;
        if (addonMode === "existing" && addonTarget && effectiveAddonIds.length) void onSubmit({ action: "importAddonOptions", targetId: addonTarget.id, optionIds: effectiveAddonIds });
        else if (addonMode === "new" && effectiveAddonItemId && addonName.trim()) void onSubmit({ action: "createAddonGroup", itemId: effectiveAddonItemId, name: addonName.trim(), optionIds: effectiveAddonIds });
      }}>
        <fieldset className={styles.importModes} disabled={disabled}>
          <legend>{t("取込先")}</legend>
          <label><input type="radio" name="dine-in-addon-mode" data-addon-target-mode="new" value="new" checked={addonMode === "new"} onChange={() => { setAddonMode("new"); setAddonTargetId(""); setAddonIds([]); }} /><span>{t("新しいグループを作成")}</span></label>
          <label><input type="radio" name="dine-in-addon-mode" data-addon-target-mode="existing" value="existing" checked={addonMode === "existing"} onChange={() => { setAddonMode("existing"); setAddonIds([]); }} /><span>{t("既存グループに追加")}</span></label>
        </fieldset>
        <div className={styles.formColumns}>
          {addonMode === "new" ? <>
            <label htmlFor="dine-in-addon-item">{t("追加食材をまとめる商品")}<select id="dine-in-addon-item" value={effectiveAddonItemId} disabled={disabled} onChange={event => { setAddonItemId(event.target.value); setAddonIds([]); }}><option value="">{t("商品を選択")}</option>{catalog.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label htmlFor="dine-in-addon-name">{t("新しい追加食材グループ名")}<input id="dine-in-addon-name" value={addonName} maxLength={120} disabled={disabled} placeholder={t("例：追加食材")} onChange={event => setAddonName(event.target.value)} /></label>
          </> : <label htmlFor="dine-in-addon-target">{t("追加する既存グループ")}<select id="dine-in-addon-target" data-dine-in-addon-target value={addonTarget?.id || ""} disabled={disabled} onChange={event => { setAddonTargetId(event.target.value); setAddonIds([]); }}><option value="">{t("選択グループを選択")}</option>{addonTargets.map(group => <option key={group.id} value={group.id}>{group.name} / {(storeGroupContexts.get(group.id) || []).slice(0, 1).join("") || t("未関連")} / {t("{count} 商品・{options} 選択肢", { count: (storeGroupContexts.get(group.id) || []).length, options: group.options.length })}</option>)}</select></label>}
        </div>
        {addonMode === "new" && addonName.trim() && catalog.optionGroups.some(group => group.name === addonName.trim()) ? <p className={styles.help} role="status">{t("同じ名前のグループがあります。既存グループに追加する場合は「既存グループに追加」を選んでください。新規作成すると別のグループになります。")}</p> : null}
        {addonTarget ? <div className={styles.importSummary} data-addon-existing-summary><strong>{t("取込先")}: {addonTarget.name}</strong><small>{t("現在の選択肢")}: {addonTarget.options.map(option => option.name).join(" / ") || t("選択肢なし")}</small><small>{t("このグループを使う商品")}: {(storeGroupContexts.get(addonTarget.id) || []).join(" / ") || t("未関連")}</small></div> : null}
        {(addonMode === "new" ? Boolean(effectiveAddonItemId) : Boolean(addonTarget)) ? <AddonOptionsPicker catalog={catalog} source={source} key={`${addonMode}:${effectiveAddonItemId}:${addonTarget?.id || "new"}`} candidates={candidates} value={effectiveAddonIds} disabled={disabled} onChange={setAddonIds} prefix="dine-in-addon-create" /> : <p className={styles.help}>{t(addonMode === "new" ? "先に商品を選択してください。" : "追加する既存グループを選択してください。")}</p>}
        {addonTarget && (storeGroupContexts.get(addonTarget.id) || []).length !== 1 ? <p className={styles.help}>{t("共有中・未関連のグループにはコピーして追加します。取込元のグループは変更せず、商品との関連付けも変更しません。")}</p> : <p className={styles.help}>{t("1商品だけで使用中の取込先では、その商品の追加食材を元の場所から移動します。ほかの商品で使用中の食材はコピーします。")}</p>}
        <button type="submit" className="primary-button compact-button" data-dine-in-action={addonMode === "existing" ? "importAddonOptions" : "createAddonGroup"} disabled={disabled || (addonMode === "existing" ? !addonTarget || !effectiveAddonIds.length : !effectiveAddonItemId || !addonName.trim())}>{t(addonMode === "existing" ? "選択した食材をこのグループへ取り込む" : "追加食材グループを作成")}</button>
      </form> : null}
    </div> : null}
  </section>;
}

export function DineInAddonImporter({ catalog, source, group, disabled, completionId, onSubmit }: { catalog: StoreDineInCatalog; source?: StoreDineInCatalog; group: StoreDineInGroup; disabled: boolean; completionId: string; onSubmit: Submit }) {
  const { t } = useOsTranslation();
  const [ids, setIds] = useState<string[]>([]);
  const [order, setOrder] = useState(group.options.map(option => option.id));
  const existing = useMemo(() => new Set(group.options.map(getDineInOptionIdentity)), [group.options]);
  const candidates = useMemo(() => getDineInAddonImportCandidates(catalog, group.id, source).filter(candidate => !existing.has(getDineInOptionIdentity(candidate.option))), [catalog, group.id, source, existing]);
  const consumerIds = getDineInGroupItemIds(catalog, group.id);
  const legacyOrdering = ["addon", "choice"].includes(group.localKind || "");
  useEffect(() => { setIds([]); setOrder(group.options.map(option => option.id)); }, [completionId, group.id, group.options]);
  const originalOrder = group.options.map(option => option.id);
  const effectiveOrder = order.length === group.options.length && order.every(id => group.options.some(option => option.id === id)) ? order : originalOrder;
  const orderChanged = effectiveOrder.join(":") !== originalOrder.join(":");

  function move(id: string, direction: -1 | 1) {
    const next = [...effectiveOrder], index = next.indexOf(id), target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  return <>
    {legacyOrdering ? <section className={styles.addonOrder} data-addon-order={group.id} aria-label={t("追加食材の表示順")}>
      <h4>{t(group.localKind === "choice" ? "選択肢の表示順" : "追加食材の表示順")}</h4>
      {group.localKind === "choice" ? <p className={styles.help}>{t(group.selectionType === "single" ? "1つだけ選択（任意）" : "個数で選択（複数可・任意）")}</p> : null}
      {effectiveOrder.length ? <>
        <p className={styles.help}>{t("上下に移動し、表示順を保存してください。食材の価格と規格は変わりません。")}</p>
        <div className={styles.orderRows}>
          {effectiveOrder.map((id, index) => {
            const option = group.options.find(option => option.id === id)!;
            return <div key={id} className={styles.orderRow} data-addon-order-option-id={id}>
              <span>{option.name}<small>¥{option.priceDelta.toLocaleString("ja-JP")}</small></span>
              <div>
                <button type="button" className="secondary-button compact-button" data-addon-order-direction="up" aria-label={t("「{name}」を上へ", { name: option.name })} disabled={disabled || index === 0} onClick={() => move(id, -1)}>{t("上へ")}</button>
                <button type="button" className="secondary-button compact-button" data-addon-order-direction="down" aria-label={t("「{name}」を下へ", { name: option.name })} disabled={disabled || index === effectiveOrder.length - 1} onClick={() => move(id, 1)}>{t("下へ")}</button>
              </div>
            </div>;
          })}
        </div>
        <button type="button" className="primary-button compact-button" data-dine-in-action="reorderAddonOptions" disabled={disabled || !orderChanged} onClick={() => void onSubmit({ action: "reorderAddonOptions", targetId: group.id, optionIds: effectiveOrder })}>{t("食材の表示順を保存")}</button>
      </> : <p className={styles.help}>{t("追加食材を取り込むと表示順を変更できます。")}</p>}
    </section> : null}
    <details className={styles.derive} data-addon-importer={group.id}>
    <summary>{t("他のグループから追加食材を取り込む")}</summary>
    <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && ids.length) void onSubmit({ action: "importAddonOptions", targetId: group.id, optionIds: ids }); }}>
      <p className={styles.help}>{t("取込先")}: {group.name} · {t("現在 {count} 商品に関連付け", { count: consumerIds.length })}</p>
      <p className={styles.help}>{t(consumerIds.length === 1 ? "1商品だけで使用中の取込先では、その商品の追加食材を元の場所から移動します。ほかの商品で使用中の食材はコピーします。" : "共有中・未関連のグループにはコピーして追加します。取込元のグループは変更せず、商品との関連付けも変更しません。")}</p>
      <AddonOptionsPicker catalog={catalog} source={source} candidates={candidates} value={ids} onChange={setIds} disabled={disabled} prefix={`dine-in-addon-import-${group.id}`} />
      <button type="submit" className="primary-button compact-button" data-dine-in-action="importAddonOptions" disabled={disabled || !ids.length}>{t("選択した食材をこのグループへ取り込む")}</button>
    </form>
    </details>
  </>;
}

export function DineInOrderingSection({ kind, targetId, rows, disabled, completionId, onSubmit }: {
  kind: StoreDineInKind; targetId?: string; rows: Array<{ id: string; name: string; detail?: string }>;
  disabled: boolean; completionId: string; onSubmit: Submit;
}) {
  const { t } = useOsTranslation();
  const [order, setOrder] = useState(rows.map(row => row.id));
  const ids = rows.map(row => row.id);
  const signature = ids.join(":");
  useEffect(() => { setOrder(signature ? signature.split(":") : []); }, [signature, completionId, kind, targetId]);
  const effective = order.length === ids.length && order.every(id => ids.includes(id)) ? order : ids;
  const title = kind === "category" ? "商品分類の表示順" : kind === "item" ? "商品の表示順" : kind === "group" ? "この商品の選択グループの表示順" : "選択肢の表示順";
  function move(id: string, direction: -1 | 1) {
    const next = [...effective], from = next.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]]; setOrder(next);
  }
  return <details className={styles.orderDisclosure} data-dine-in-order={kind} data-dine-in-order-target={targetId || "catalog"}>
    <summary>{t(title)}</summary>
    <p className={styles.help}>{t("上下に移動し、表示順を保存してください。非表示の項目も含めた順番です。価格と規格は変わりません。")}</p>
    <div className={styles.orderRows}>{effective.map((id, index) => {
      const row = rows.find(row => row.id === id)!;
      return <div className={styles.orderRow} key={id} data-dine-in-order-id={id}><span>{row.name}{row.detail ? <small>{row.detail}</small> : null}</span><div>
        <button type="button" className="secondary-button compact-button" data-dine-in-order-direction="up" aria-label={t("「{name}」を上へ", { name: row.name })} disabled={disabled || index === 0} onClick={() => move(id, -1)}>{t("上へ")}</button>
        <button type="button" className="secondary-button compact-button" data-dine-in-order-direction="down" aria-label={t("「{name}」を下へ", { name: row.name })} disabled={disabled || index === effective.length - 1} onClick={() => move(id, 1)}>{t("下へ")}</button>
      </div></div>;
    })}</div>
    <button type="button" className="primary-button compact-button" data-dine-in-action="reorder" disabled={disabled || effective.join(":") === signature} onClick={() => void onSubmit({ action: "reorder", kind, ...(targetId ? { targetId } : {}), ids: effective })}>{t("表示順を保存")}</button>
  </details>;
}

export function DineInGroupSettings({ catalog, group, disabled, completionId, onSubmit }: {
  catalog: StoreDineInCatalog; group: StoreDineInGroup; disabled: boolean; completionId: string; onSubmit: Submit;
}) {
  const { t } = useOsTranslation();
  const protectedSingle = isDineInSingleChoiceGroup(group);
  const currentRules = getPosOptionSelectionRules(group);
  const currentType = protectedSingle ? "single" : ["single", "multiple", "quantity"].includes(currentRules.type) ? currentRules.type as "single" | "multiple" | "quantity" : "single";
  const currentMin = currentRules.min;
  const currentMax = currentType === "single" ? 1 : currentRules.max;
  const currentPerOption = currentType === "quantity" ? currentRules.perOptionMax : 1;
  const [selectionType, setSelectionType] = useState<"single" | "multiple" | "quantity">(currentType);
  const [minimum, setMinimum] = useState(String(currentMin));
  const [maximum, setMaximum] = useState(String(currentMax));
  const [perOption, setPerOption] = useState(String(currentPerOption));
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  useEffect(() => { setSelectionType(currentType); setMinimum(String(currentMin)); setMaximum(String(currentMax)); setPerOption(String(currentPerOption)); setLinkedIds([]); }, [group.id, completionId, currentType, currentMin, currentMax, currentPerOption]);
  const min = Number(minimum), max = selectionType === "single" ? 1 : Number(maximum), perMax = selectionType === "quantity" ? Number(perOption) : 1;
  const valid = /^\d{1,2}$/.test(minimum) && (selectionType === "single" || /^\d{1,2}$/.test(maximum)) && (selectionType !== "quantity" || /^\d{1,2}$/.test(perOption)) && min >= 0 && max >= 1 && max <= 99 && min <= max && perMax >= 1 && perMax <= max;
  const changed = selectionType !== currentType || min !== currentMin || max !== currentMax || perMax !== currentPerOption;
  const consumerIds = new Set(getDineInGroupItemIds(catalog, group.id));
  const sharedCount = consumerIds.size;
  const linked = new Set(group.options.flatMap(option => option.linkedItemId ? [option.linkedItemId] : []));
  const canLink = ["addon", "choice"].includes(group.localKind || "") && !protectedSingle;
  const products = catalog.items.filter(item => !consumerIds.has(item.id) && item.brandId === group.brandId && item.posPricingMode === "fixed" && item.productionType !== "bowl" && !linked.has(item.id));
  const effectiveLinks = linkedIds.filter(id => products.some(item => item.id === id && !getDineInLinkedItemDisabledReason(catalog, item)));
  function changeSelection(value: "single" | "multiple" | "quantity") {
    setSelectionType(value);
    if (value === "single") { setMinimum(current => Number(current) > 1 ? "1" : current); setMaximum("1"); setPerOption("1"); }
    else { const nextMaximum = Number(maximum) <= 1 ? "99" : maximum; setMaximum(nextMaximum); setPerOption(value === "quantity" ? nextMaximum : "1"); }
  }
  return <>
    <form className={styles.groupSettings} data-dine-in-group-selection onSubmit={event => {
      event.preventDefault(); if (!disabled && valid && changed) void onSubmit({ action: "setGroupSelection", targetId: group.id, selectionType, minSelections: min, maxSelections: max, perOptionMax: perMax });
    }}>
      <h4>{t("POS での選び方")}</h4>
      <div className={styles.formColumns}>
        <label htmlFor="dine-in-selection-type">{t("選び方")}<select id="dine-in-selection-type" value={selectionType} disabled={disabled || protectedSingle} onChange={event => changeSelection(event.target.value as typeof selectionType)}><option value="single">{t("1つだけ選択")}</option><option value="multiple">{t("複数の種類を選択（重複なし）")}</option><option value="quantity">{t("個数で選択（同じものを複数可）")}</option></select></label>
        <label htmlFor="dine-in-selection-min">{t("最低の選択数（0は任意）")}<input id="dine-in-selection-min" inputMode="numeric" maxLength={2} value={minimum} disabled={disabled} onChange={event => setMinimum(event.target.value.normalize("NFKC"))} /></label>
        <label htmlFor="dine-in-selection-max">{t("合計の上限")}<input id="dine-in-selection-max" inputMode="numeric" maxLength={2} value={selectionType === "single" ? "1" : maximum} disabled={disabled || selectionType === "single"} onChange={event => { const value = event.target.value.normalize("NFKC"); setMaximum(value); if (Number(perOption) > Number(value)) setPerOption(value); }} /></label>
        {selectionType === "quantity" ? <label htmlFor="dine-in-selection-per-option">{t("同じ選択肢の上限")}<input id="dine-in-selection-per-option" inputMode="numeric" maxLength={2} value={perOption} disabled={disabled} onChange={event => setPerOption(event.target.value.normalize("NFKC"))} /></label> : null}
      </div>
      {protectedSingle ? <p className={styles.help}>{t("辛さ・しびれは1つだけ選択します。味や麺とは独立して管理します。")}</p> : <p className={styles.help}>{t("同じ麺を2点・3点と追加する場合は「個数で選択」を使います。1点あたりの価格と50gなどの規格は変わりません。")}</p>}
      {sharedCount > 1 ? <p className={styles.help}>{t("このグループは {count} 件の商品で共用しています。選び方の変更はこれらの商品に適用します。", { count: sharedCount })}</p> : null}
      {!valid ? <p className={styles.help} role="status">{t("最低数は0〜上限、上限は1〜99、同じ選択肢の上限は合計の上限以内で入力してください。")}</p> : null}
      <button type="submit" className="secondary-button compact-button" data-dine-in-action="setGroupSelection" disabled={disabled || !valid || !changed}>{t("選び方を保存")}</button>
    </form>
    {canLink ? <details className={styles.derive} data-dine-in-link-items={group.id}>
      <summary>{t("ドリンク・酒類などの店内商品を選択肢に追加")}</summary>
      <form className={styles.creationForm} onSubmit={event => { event.preventDefault(); if (!disabled && effectiveLinks.length) void onSubmit({ action: "linkItemOptions", targetId: group.id, itemIds: effectiveLinks }); }}>
        <p className={styles.help}>{t("POS の商品一覧に残したまま、この商品・一杯の選択肢としても販売します。誰の一杯に付けたかを注文と伝票に残します。")}</p>
        <p className={styles.help}>{t("名前・価格は関連する店内商品に従います。商品の名前・価格を直すと、この選択肢にも反映します。")}</p>
        <div className={styles.addonCandidates}>{products.map(item => {
          const reason = getDineInLinkedItemDisabledReason(catalog, item);
          return <label className={styles.addonChoice} key={item.id}><input type="checkbox" data-dine-in-link-item-id={item.id} checked={effectiveLinks.includes(item.id)} disabled={disabled || Boolean(reason)} onChange={event => setLinkedIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /><span>{item.name}<small className={styles.choiceHint}>{reason ? t(reason) : item.visible ? item.category : t("POS の商品一覧では非表示")}</small></span><small>¥{item.price.toLocaleString("ja-JP")}</small></label>;
        })}</div>
        {!products.length ? <p className={styles.help}>{t("追加できる店内商品がありません。先にドリンク・酒類などの個数販売の商品を作成してください。")}</p> : null}
        <button type="submit" className="primary-button compact-button" data-dine-in-action="linkItemOptions" disabled={disabled || !effectiveLinks.length}>{t("選択した商品を選択肢に追加")}</button>
      </form>
    </details> : null}
  </>;
}
