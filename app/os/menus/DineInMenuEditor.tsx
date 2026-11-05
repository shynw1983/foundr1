"use client";

import { ChevronDown, Copy, Plus, RefreshCw, Save, Store, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canDineInGroupImportAddons, getDineInAddonCandidates, getDineInBulkOptionDeleteDisabledReason, getDineInBulkOptionVisibilityDisabledReason, getDineInDeleteDisabledReason, getDineInEffectiveItemGroupIds, getDineInGroupItemIds, type StoreDineInCatalog } from "../../../lib/store-dine-in-menu-policy";
import { useOsTranslation } from "../components/OsTranslationProvider";
import type { SourceReviewEntry } from "../../../lib/store-dine-in-source-review";
import { DineInSourceReview, type DineInSourceReviewState } from "./DineInSourceReview";
import { DineInGroupItemsEditor, DineInItemGroupsEditor } from "./DineInAssociationsEditor";
import { DineInGroupOptions, DineInOptionBulkActions } from "./DineInGroupOptions";
import { DineInFulfillmentSettings } from "./DineInFulfillmentSettings";
import { DineInAddonImporter, DineInGroupSettings, DineInMenuComposer, DineInOrderingSection, type DineInMenuCommand, type DineInImportRequest, type DineInOptionCreateRequest } from "./DineInMenuComposer";
import styles from "./DineInMenuEditor.module.css";

type Kind = "item" | "group" | "option" | "category";
type MenuNode = {
  id: string;
  name: string;
  sourceName?: string;
  visible?: boolean;
  category?: string;
  price?: number | null;
  basePrice?: number | null;
  priceDelta?: number;
  variableSchema?: Record<string, unknown>;
  itemKind?: string;
  posPricingMode?: string;
  posWeightUnit?: string;
  posWeightUnitPrice?: number | null;
  linkedItemId?: string;
  localOnly?: boolean;
};
type Catalog = StoreDineInCatalog;
type MenuResponse = {
  ready: boolean;
  exists: boolean;
  enabled: boolean;
  revision: string;
  catalog: Catalog;
  source?: Catalog;
  sourceReview?: DineInSourceReviewState;
  pricingDefaults?: { unit: string; unitPrice: number | null };
};
type Command = DineInMenuCommand;
type Operation = Command & { storeId: string; brandId: string; revision: string; operationId: string };
export type DineInMenuEditorProps = {
  brandId: string;
  brandName?: string;
  stores: Array<{ id: string; name: string; brandIds: string[] }>;
  initialStoreId: string;
  onBusyChange?: (busy: boolean) => void;
};
type Target = MenuNode & { kind: Kind; groupId?: string; groupName?: string; parentVisible?: boolean };

const kindLabels = { category: "商品分類", item: "商品", group: "追加・選択グループ", option: "選択肢" };
const apiPath = "/api/os/menus/dine-in";
const pendingKey = (storeId: string, brandId: string) => `foundr1-dine-in-pending:v1:${storeId}:${brandId}`;
const optionGroupPreferenceKey = (context: string) => `foundr1-dine-in-option-groups:v1:${context}`;

function readOptionGroupPreferences(context: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(optionGroupPreferenceKey(context)) || "null");
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("expanded" in value)
      || !value.expanded || typeof value.expanded !== "object" || Array.isArray(value.expanded)) return {};
    return Object.fromEntries(Object.entries(value.expanded).slice(0, 1000).filter(([id, expanded]) => id.length > 0 && id.length <= 120 && typeof expanded === "boolean"));
  } catch { return {}; }
}

function DineInTargetButton({ entry, selected, busy, onChoose, price, itemCount, showGroupName = true, selection }: {
  entry: Target; selected: string; busy: boolean; onChoose: (entry: Target) => void; price: string; itemCount: number; showGroupName?: boolean; selection?: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void };
}) {
  const { t } = useOsTranslation();
  const button = <button type="button" disabled={busy} data-target-id={entry.id} data-target-kind={entry.kind} aria-pressed={selected === `${entry.kind}:${entry.id}`} onClick={() => onChoose(entry)}>
    <span className={styles.rowTitle}>{entry.name}<span className={styles.price}>{price}</span></span>
    <small><span>{(showGroupName ? entry.groupName : "") || entry.category || t(kindLabels[entry.kind])}</span>{entry.kind !== "category" ? <span className={entry.visible === false || entry.parentVisible === false ? styles.hiddenBadge : styles.visibleBadge}>{t(entry.visible === false ? "POS 非公開" : entry.parentVisible === false ? "グループ非公開" : "POS 公開")}</span> : <span>{t("商品 {count} 件", { count: itemCount })}</span>}</small>
    {entry.sourceName && entry.sourceName !== entry.name ? <small>{t("引継ぎ元")}: {entry.sourceName}</small> : null}
  </button>;
  return selection ? <div className={styles.optionSelectableRow} data-option-selected={selection.checked}>
    <label className={styles.optionSelect}><input type="checkbox" data-dine-in-option-select={entry.id} aria-label={t("「{name}」を一括操作の対象に選択", { name: entry.name })} checked={selection.checked} disabled={selection.disabled} onChange={event => selection.onChange(event.target.checked)} /></label>
    {button}
  </div> : button;
}

function readPending(storeId: string, brandId: string): Operation | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(pendingKey(storeId, brandId)) || "null") as Operation | null;
    return value?.storeId === storeId && value?.brandId === brandId && typeof value.operationId === "string" ? value : null;
  } catch { return null; }
}

function writePending(operation: Operation, clear = false) {
  try {
    const key = pendingKey(operation.storeId, operation.brandId);
    if (clear) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(operation));
  } catch { /* In-memory retries remain available when browser storage is unavailable. */ }
}

function isMenuResponse(value: unknown): value is MenuResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<MenuResponse>;
  return typeof body.ready === "boolean" && typeof body.exists === "boolean"
    && typeof body.revision === "string" && Array.isArray(body.catalog?.items)
    && Array.isArray(body.catalog?.optionGroups);
}

export function DineInMenuEditor({ brandId, brandName, stores, initialStoreId, onBusyChange }: DineInMenuEditorProps) {
  const { t } = useOsTranslation();
  const eligibleStores = useMemo(() => stores.filter(store => store.brandIds.includes(brandId)), [stores, brandId]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [restoredBrand, setRestoredBrand] = useState("");
  const [snapshot, setSnapshot] = useState<{ context: string; body: MenuResponse } | null>(null);
  const [view, setView] = useState<"edit" | "source">("edit");
  const [importRequest, setImportRequest] = useState<DineInImportRequest | null>(null);
  const [optionCreateRequest, setOptionCreateRequest] = useState<DineInOptionCreateRequest | null>(null);
  const [kind, setKind] = useState<Kind>("item");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "visible" | "hidden" | "trash">("all");
  const [optionGroupPreferences, setOptionGroupPreferences] = useState<{ context: string; expanded: Record<string, boolean> } | null>(null);
  const [selected, setSelected] = useState("");
  const [linkedGroupReturn, setLinkedGroupReturn] = useState<{ itemId: string; groupId: string } | null>(null);
  const [name, setName] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [optionPrice, setOptionPrice] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("");
  const [visibility, setVisibility] = useState(true);
  const [pricingMode, setPricingMode] = useState<"fixed" | "weight">("fixed");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Operation | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [initializeMode, setInitializeMode] = useState<"empty" | "source">("empty");
  const [completionId, setCompletionId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null);
  const [bulkSelection, setBulkSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const bulkDeleteDialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const storeId = eligibleStores.some(store => store.id === selectedStoreId) ? selectedStoreId
    : eligibleStores.find(store => store.id === initialStoreId)?.id || eligibleStores[0]?.id || "";
  const context = `${brandId}:${storeId}`;
  const activeContext = useRef(context);
  activeContext.current = context;
  const body = snapshot?.context === context ? snapshot.body : null;
  const busy = saving || Boolean(pending);

  useEffect(() => { setView("edit"); setImportRequest(null); setOptionCreateRequest(null); }, [context]);
  useEffect(() => { setOptionGroupPreferences({ context, expanded: readOptionGroupPreferences(context) }); }, [context]);

  useEffect(() => {
    let remembered = "";
    try { remembered = window.localStorage.getItem(`foundr1-dine-in-store:v1:${brandId}`) || ""; } catch { /* Optional browser preference. */ }
    setSelectedStoreId(eligibleStores.some(store => store.id === remembered) ? remembered : initialStoreId);
    setRestoredBrand(brandId);
  }, [brandId, eligibleStores, initialStoreId]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setSnapshot(null); setSelected(""); setLinkedGroupReturn(null); setName(""); setDuplicateName(""); setOptionPrice(""); setItemPrice(""); setItemCategoryId(""); setInitializeMode("empty"); setPricingMode("fixed"); setStatusFilter("all");
    setNotice(null); setConflict(false); setSaving(false); setLoading(false); setDeleteTarget(null); setBulkDeleteIds(null); setBulkSelection({ scope: "", ids: [] }); setOptionCreateRequest(null);
    setPending(previous => previous?.storeId === storeId && previous.brandId === brandId ? previous : null);
    if (!brandId || !storeId || restoredBrand !== brandId) return () => controller.abort();
    setLoading(true);
    setPending(previous => previous || readPending(storeId, brandId));
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    void fetch(`${apiPath}?storeId=${encodeURIComponent(storeId)}&brandId=${encodeURIComponent(brandId)}`, {
      cache: "no-store", signal: controller.signal
    }).then(async response => {
      const result: unknown = await response.json();
      if (!response.ok) throw new Error((result as { error?: string })?.error || "店内メニューを読み込めません。再読込してください。");
      if (!isMenuResponse(result)) throw new Error("店内メニューを読み込めません。再読込してください。");
      if (generation.current === current && activeContext.current === context) setSnapshot({ context, body: result });
    }).catch(error => {
      if ((!controller.signal.aborted || timedOut) && generation.current === current && activeContext.current === context) {
        setNotice({ tone: "error", text: error instanceof Error && !["AbortError", "TypeError", "SyntaxError"].includes(error.name) ? error.message : "店内メニューを読み込めません。再読込してください。" });
      }
    }).finally(() => { window.clearTimeout(timeout); if (generation.current === current) setLoading(false); });
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [brandId, storeId, restoredBrand, context, reload]);

  const catalog = body?.exists ? body.catalog : null;
  const groupProductNames = useMemo(() => {
    const names = new Map<string, string[]>();
    if (!catalog) return names;
    for (const item of catalog.items) for (const groupId of getDineInEffectiveItemGroupIds(catalog, item.id)) {
      const current = names.get(groupId) || []; current.push(item.name); names.set(groupId, current);
    }
    return names;
  }, [catalog]);
  const targets = useMemo<Target[]>(() => !catalog ? [] : [
    ...catalog.categories.map(category => ({ ...category, kind: "category" as const })),
    ...catalog.items.map(item => ({ ...item, kind: "item" as const })),
    ...catalog.optionGroups.map(group => ({ ...group, kind: "group" as const })),
    ...catalog.optionGroups.flatMap(group => group.options.map(option => ({ ...option, kind: "option" as const, groupId: group.id, groupName: group.name, parentVisible: group.visible })))
  ], [catalog]);
  const searchQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => targets.filter(target => target.kind === kind && `${target.name} ${target.sourceName || ""} ${target.category || ""} ${target.groupName || ""} ${target.kind === "option" && target.groupId ? (groupProductNames.get(target.groupId) || []).join(" ") : ""}`.toLocaleLowerCase().includes(searchQuery))
    .filter(target => statusFilter === "all" || statusFilter === "trash" || (statusFilter === "visible") === (target.visible !== false && target.parentVisible !== false)), [targets, kind, searchQuery, statusFilter, groupProductNames]);
  const filteredOptionGroups = useMemo(() => {
    if (kind !== "option" || statusFilter === "trash" || !catalog) return [];
    const byGroup = new Map<string, Target[]>();
    for (const option of filtered) if (option.groupId) {
      const current = byGroup.get(option.groupId) || []; current.push(option); byGroup.set(option.groupId, current);
    }
    return catalog.optionGroups.flatMap(group => {
      const options = byGroup.get(group.id); return options?.length ? [{ group, options, products: groupProductNames.get(group.id) || [] }] : [];
    });
  }, [kind, statusFilter, catalog, filtered, groupProductNames]);
  const trash = (catalog?.trash || []).filter(entry => entry.kind === kind && entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const target = targets.find(entry => `${entry.kind}:${entry.id}` === selected);
  const selectedGroup = target?.kind === "group" ? catalog?.optionGroups.find(group => group.id === target.id) : undefined;
  const disabled = busy || loading || conflict || !body?.ready || !body.exists;
  const disabledReason = saving ? "保存中です。完了するまでお待ちください。" : pending ? "前の保存結果を確認してから編集してください。" : conflict ? "再読込して最新の状態を確認してください。" : "";
  const storeName = eligibleStores.find(store => store.id === storeId)?.name || "";
  const weightPricingAvailable = Number(body?.pricingDefaults?.unitPrice) > 0;
  const isDrink = target?.itemKind === "drink";
  const validOptionPrice = /^\d{1,7}$/.test(optionPrice) && Number(optionPrice) <= 9_999_999;
  const validItemPrice = /^\d{1,7}$/.test(itemPrice) && Number(itemPrice) <= 9_999_999;
  const currentItemCategoryId = target?.kind === "item" ? catalog?.categories.find(category => category.name === target.category)?.id || "" : "";
  const effectiveItemCategoryId = catalog?.categories.some(category => category.id === itemCategoryId) ? itemCategoryId : "";
  const targetOptionGroup = target?.kind === "option" ? catalog?.optionGroups.find(group => group.options.some(option => option.id === target.id)) : undefined;
  const returnGroup = targetOptionGroup || (target?.kind === "item" && linkedGroupReturn?.itemId === target.id ? catalog?.optionGroups.find(group => group.id === linkedGroupReturn.groupId) : undefined);
  const linkedTargetItem = target?.linkedItemId ? catalog?.items.find(item => item.id === target.linkedItemId) : undefined;
  const selectedItem = target?.kind === "item" ? catalog?.items.find(item => item.id === target.id) : undefined;
  const orderedItemGroups = selectedItem && catalog ? getDineInEffectiveItemGroupIds(catalog, selectedItem.id).flatMap(id => { const group = catalog.optionGroups.find(group => group.id === id); return group ? [{ id, name: group.name }] : []; }) : [];
  const sharedOptionItemCount = targetOptionGroup && catalog ? getDineInGroupItemIds(catalog, targetOptionGroup.id).length : 0;
  const rememberedGroups = optionGroupPreferences?.context === context ? optionGroupPreferences.expanded : {};
  // A selection belongs to exactly one store, brand and filtered list revision.
  // Deriving the scope also prevents stale IDs appearing during a context render.
  const bulkScope = JSON.stringify([context, body?.revision, kind, statusFilter, searchQuery, view]);
  const bulkOptionIds = bulkSelection.scope === bulkScope && kind === "option" && statusFilter !== "trash" ? bulkSelection.ids.filter(id => filtered.some(entry => entry.id === id)) : [];
  const bulkOptionSet = new Set(bulkOptionIds);
  useEffect(() => { setBulkSelection({ scope: bulkScope, ids: [] }); }, [bulkScope]);
  const bulkDisabledReason = catalog && bulkOptionIds.length ? getDineInBulkOptionDeleteDisabledReason(catalog, bulkOptionIds) : null;
  const bulkHideReason = catalog && bulkOptionIds.length ? getDineInBulkOptionVisibilityDisabledReason(catalog, bulkOptionIds, false) : null;
  const bulkShowReason = catalog && bulkOptionIds.length ? getDineInBulkOptionVisibilityDisabledReason(catalog, bulkOptionIds, true) : null;
  const bulkCanHide = filtered.some(entry => bulkOptionSet.has(entry.id) && entry.visible !== false);
  const bulkCanShow = filtered.some(entry => bulkOptionSet.has(entry.id) && entry.visible === false);
  const bulkDeleteOptions = bulkDeleteIds && catalog ? catalog.optionGroups.flatMap(group => group.options.filter(option => bulkDeleteIds.includes(option.id)).map(option => ({ ...option, groupId: group.id, groupName: group.name, name: catalog.items.find(item => item.id === option.linkedItemId)?.name || option.name }))) : [];
  const bulkConfirmReason = catalog && bulkDeleteIds ? getDineInBulkOptionDeleteDisabledReason(catalog, bulkDeleteIds) : null;

  function toggleBulkOption(id: string, checked: boolean) {
    if (disabled || !filtered.some(entry => entry.kind === "option" && entry.id === id)) return;
    setBulkSelection({ scope: bulkScope, ids: checked ? [...new Set([...bulkOptionIds, id])] : bulkOptionIds.filter(value => value !== id) });
  }

  function requestBulkDelete(optionIds: string[]) {
    if (disabled || !catalog || !optionIds.length || getDineInBulkOptionDeleteDisabledReason(catalog, optionIds)) return;
    setNotice(null); setBulkDeleteIds([...new Set(optionIds)]);
  }

  function requestBulkVisibility(optionIds: string[], visible: boolean) {
    if (disabled || !catalog || !optionIds.length || getDineInBulkOptionVisibilityDisabledReason(catalog, optionIds, visible)) return;
    const selectedIds = new Set(optionIds);
    if (!catalog.optionGroups.some(group => group.options.some(option => selectedIds.has(option.id) && (option.visible !== false) !== visible))) return;
    void submit({ action: "setOptionsVisibility", optionIds: [...optionIds], visible });
  }

  function rememberOptionGroups(expanded: Record<string, boolean>) {
    const currentIds = new Set(catalog?.optionGroups.map(group => group.id) || []);
    const next = Object.fromEntries(Object.entries(expanded).filter(([id]) => currentIds.has(id)));
    setOptionGroupPreferences({ context, expanded: next });
    try { window.localStorage.setItem(optionGroupPreferenceKey(context), JSON.stringify({ version: 1, expanded: next })); } catch { /* Browser preferences are optional; in-memory controls still work. */ }
  }

  useEffect(() => {
    const dialog = deleteDialog.current;
    if (deleteTarget && dialog && !dialog.open) dialog.showModal();
    if (!deleteTarget && dialog?.open) dialog.close();
  }, [deleteTarget]);

  useEffect(() => {
    const dialog = bulkDeleteDialog.current;
    if (bulkDeleteIds && dialog && !dialog.open) dialog.showModal();
    if (!bulkDeleteIds && dialog?.open) dialog.close();
  }, [bulkDeleteIds]);

  function choose(entry: Target, nextCatalog = catalog) {
    setSelected(`${entry.kind}:${entry.id}`); setLinkedGroupReturn(null); setName(entry.name); setVisibility(entry.visible !== false);
    setPricingMode(entry.posPricingMode === "weight" ? "weight" : "fixed");
    setItemPrice(entry.kind === "item" ? String(entry.price ?? entry.basePrice ?? 0) : "");
    setItemCategoryId(entry.kind === "item" ? nextCatalog?.categories.find(category => category.name === entry.category)?.id || "" : "");
    setDuplicateName(""); setOptionPrice(entry.kind === "option" ? String(entry.priceDelta || 0) : ""); setNotice(null);
  }

  function changeStore(value: string) {
    setSelectedStoreId(value);
    try { window.localStorage.setItem(`foundr1-dine-in-store:v1:${brandId}`, value); } catch { /* Optional browser preference. */ }
  }

  async function submit(command: Command, retry?: Operation) {
    if (saving || (!retry && (pending || !body?.ready || conflict))) return;
    const operation: Operation = retry || {
      ...command, storeId, brandId, revision: body!.revision, operationId: crypto.randomUUID()
    };
    const requestContext = context;
    const current = generation.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    writePending(operation); setPending(operation); setSaving(true); setNotice(null);
    try {
      const response = await fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation), signal: controller.signal });
      const result: unknown = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          writePending(operation, true);
          if (current === generation.current && activeContext.current === requestContext) {
            setPending(null); setConflict(response.status === 409);
          }
        }
        throw new Error((result as { error?: string })?.error || "保存できません。同じ操作を再試行してください。");
      }
      if (!isMenuResponse(result)) throw new Error("保存結果を確認できません。同じ操作を再試行してください。");
      writePending(operation, true);
      if (current !== generation.current || activeContext.current !== requestContext) return;
      setSnapshot({ context: requestContext, body: result }); setPending(null); setConflict(false);
      setCompletionId(operation.operationId);
      if (["setItemPricing", "setItemPrice", "setItemCategory"].includes(operation.action)) {
        const savedItem = result.catalog.items.find(item => item.id === operation.targetId);
        setPricingMode(savedItem?.posPricingMode === "weight" ? "weight" : "fixed");
        setItemPrice(savedItem ? String(savedItem.price ?? savedItem.basePrice ?? 0) : "");
        setItemCategoryId(savedItem ? result.catalog.categories.find(category => category.name === savedItem.category)?.id || "" : "");
      }
      if (operation.action === "reviewSource" && target && result.sourceReview?.entries.some(entry => entry.key === operation.entryKey && entry.targetId === target.id && entry.kind === target.kind)) {
        const saved = target.kind === "item" ? result.catalog.items.find(item => item.id === target.id)
          : target.kind === "group" ? result.catalog.optionGroups.find(group => group.id === target.id)
          : target.kind === "option" ? result.catalog.optionGroups.flatMap(group => group.options).find(option => option.id === target.id)
          : result.catalog.categories.find(category => category.id === target.id);
        if (saved) choose({ ...saved, kind: target.kind }, result.catalog);
      }
      if (operation.action === "setOptionPrice") {
        const savedOption = result.catalog.optionGroups.flatMap(group => group.options).find(option => option.id === operation.targetId);
        setOptionPrice(String(savedOption?.priceDelta || 0));
      }
      if (operation.action === "setVisibility") setVisibility(operation.visible === true);
      if (operation.action === "setOptionsVisibility") {
        setBulkSelection({ scope: "", ids: [] });
        if (target?.kind === "option" && operation.optionIds?.includes(target.id)) setVisibility(operation.visible === true);
      }
      if (operation.action === "duplicate") setDuplicateName("");
      if (operation.action === "delete") {
        setDeleteTarget(null); setSelected(""); setName(""); setDuplicateName("");
      }
      if (operation.action === "deleteOptions") {
        setBulkDeleteIds(null); setBulkSelection({ scope: "", ids: [] });
        if (target?.kind === "option" && operation.optionIds?.includes(target.id)) { setSelected(""); setName(""); setOptionPrice(""); }
      }
      if (operation.action === "restore") {
        const restored = catalog?.trash?.find(entry => entry.id === operation.targetId);
        setStatusFilter("all"); setQuery(""); setSelected("");
        if (restored) {
          const nodes = restored.kind === "category" ? result.catalog.categories : restored.kind === "item" ? result.catalog.items : restored.kind === "group" ? result.catalog.optionGroups : result.catalog.optionGroups.flatMap(group => group.options);
          const node = nodes.find(node => node.id === restored.targetId);
          if (node) { setKind(restored.kind); choose({ ...node, kind: restored.kind }, result.catalog); }
        }
      }
      if (operation.action === "createOption") {
        const previousIds = new Set(catalog?.optionGroups.flatMap(group => group.options.map(option => option.id)) || []);
        const savedGroup = result.catalog.optionGroups.find(group => group.id === operation.targetId);
        const created = savedGroup?.options.find(option => !previousIds.has(option.id));
        if (created && savedGroup) { setView("edit"); setKind("option"); setStatusFilter("all"); setQuery(""); choose({ ...created, kind: "option", groupId: savedGroup.id, groupName: savedGroup.name, parentVisible: savedGroup.visible }, result.catalog); }
      }
      if (["createItem", "importItem", "createCategory", "createAddonGroup", "createOptionGroup", "importOptionGroup"].includes(operation.action)) {
        const createdKind = operation.action === "createCategory" ? "category" : ["createAddonGroup", "createOptionGroup", "importOptionGroup"].includes(operation.action) ? "group" : "item";
        const previousIds = new Set(targets.filter(entry => entry.kind === createdKind).map(entry => entry.id));
        const nodes = createdKind === "category" ? result.catalog.categories : createdKind === "group" ? result.catalog.optionGroups : result.catalog.items;
        const created = nodes.find(entry => !previousIds.has(entry.id));
        if (created) { setView("edit"); setKind(createdKind); setStatusFilter("all"); setQuery(""); choose({ ...created, kind: createdKind }, result.catalog); }
      }
      setNotice({ tone: "success", text: operation.action === "acknowledgeSourceBaseline" ? "初回確認の基準を保存しました。店内の商品・価格は変更していません。今後の元メニューの変更を確認できます。" : ["delete", "deleteOptions"].includes(operation.action) ? "ごみ箱に移動しました。同じ名前・価格・IDで元に戻せます。過去の注文は変わりません。" : operation.action === "restore" ? "店内メニューに戻しました。POS の「メニューを更新」を押すと反映されます。" : operation.action === "initialize" ? result.enabled ? "店内メニューを作成しました。POS の「メニューを更新」を押すと反映されます。" : "店内メニューを作成しました。商品を追加してから POS で使用を開始してください。" : result.enabled ? "店内メニューを保存しました。POS の「メニューを更新」を押すと反映されます。" : "下書きを保存しました。POS で使用を開始するまでは現在のメニューは変わりません。" });
      return result;
    } catch (error) {
      if (current === generation.current && activeContext.current === requestContext) {
        setNotice({ tone: "error", text: error instanceof Error && !["AbortError", "TypeError", "SyntaxError"].includes(error.name) ? error.message : "保存結果を確認できません。同じ操作を再試行してください。" });
      }
    } finally { window.clearTimeout(timeout); if (current === generation.current && activeContext.current === requestContext) setSaving(false); }
  }

  function editSourceEntry(entry: SourceReviewEntry) {
    const node = targets.find(target => target.kind === entry.kind && target.id === entry.targetId);
    if (!node) return;
    setView("edit"); setKind(node.kind); setStatusFilter("all"); setQuery(""); choose(node);
  }

  function importSourceEntry(entry: SourceReviewEntry) {
    if (!catalog || !body?.source || disabled) return;
    if (entry.kind === "item") {
      setImportRequest({ token: crypto.randomUUID(), kind: "import", sourceItemId: entry.sourceId });
    } else {
      const group = body.source.optionGroups.find(group => group.sourceGroupId === entry.sourceId || group.options.some(option => option.sourceOptionId === entry.sourceId));
      const itemId = target?.kind === "item" ? target.id : catalog.items[0]?.id || "";
      const candidates = getDineInAddonCandidates(catalog, itemId, undefined, body.source);
      const safeOptions = group?.options.filter(option => candidates.some(candidate => candidate.option.id === option.id)) || [];
      if (catalog.items.length && safeOptions.length && (entry.kind === "group" || safeOptions.some(option => option.sourceOptionId === entry.sourceId))) {
        setImportRequest({ token: crypto.randomUUID(), kind: "addon", sourceOptionIds: entry.kind === "option" ? safeOptions.filter(option => option.sourceOptionId === entry.sourceId).map(option => option.id) : [], itemId });
      } else if (catalog.items.length && group) {
        setImportRequest({ token: crypto.randomUUID(), kind: "importGroup", sourceGroupId: group.id, sourceOptionIds: entry.kind === "option" ? group.options.filter(option => option.sourceOptionId === entry.sourceId).map(option => option.id) : undefined, itemId });
      } else {
        const sourceItem = body.source.items.find(item => group && getDineInEffectiveItemGroupIds(body.source!, item.id).includes(group.id));
        setImportRequest({ token: crypto.randomUUID(), kind: "import", sourceItemId: sourceItem?.id || "" });
        setNotice({ tone: "success", text: "先に商品を作成するか、ブランド商品を取り込んでください。選択グループは商品に付けて管理します。" });
      }
    }
    setView("edit");
  }

  const deleteCategoryItems = deleteTarget?.kind === "category" ? catalog?.items.filter(item => item.category === deleteTarget.name) || [] : [];
  const replacementCategories = catalog?.categories.filter(category => category.id !== deleteTarget?.id) || [];
  const deleteGroupItems = deleteTarget?.kind === "group" && catalog ? getDineInGroupItemIds(catalog, deleteTarget.id) : [];
  const deleteDisabledReason = target && catalog ? getDineInDeleteDisabledReason(catalog, target.kind, target.id) : null;

  function priceLabel(entry: Target) {
    if (entry.kind === "group" || entry.kind === "category") return "";
    if (entry.kind === "item" && entry.posPricingMode === "weight") {
      return t("¥{price} / 1{unit}", { price: Number(entry.posWeightUnitPrice || 0).toLocaleString("ja-JP"), unit: entry.posWeightUnit || "g" });
    }
    const price = entry.kind === "option" ? entry.priceDelta || 0 : entry.price ?? entry.basePrice ?? 0;
    return t("¥{price} / 1点", { price: Number(price).toLocaleString("ja-JP") });
  }

  return <section className={styles.panel} data-dine-in-menu-editor data-i18n-ignore aria-label={t("店舗の店内飲食メニュー")}>
    <div className={styles.heading}>
      <div><h3>{t("店舗の店内飲食メニュー")}</h3><p>{t("商品分類・商品を自由に作成できます。必要な商品だけブランドメニューから取り込めます。")}</p></div>
      <button type="button" className="secondary-button compact-button" disabled={saving || loading || !storeId || !brandId} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />{t("再読込")}</button>
    </div>
    <div className={styles.context}>
      <label>{t("対象店舗")}<select aria-label={t("店内メニューの対象店舗")} value={storeId} disabled={busy || loading} onChange={event => changeStore(event.target.value)}><option value="" disabled>{t("店舗を選択")}</option>{eligibleStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <div><span>{t("対象")}</span><strong><Store size={15} aria-hidden="true" />{storeName || t("店舗を選択")}<span> / </span>{brandName || t("ブランドを選択")}<span> / </span>{t("店内飲食")}</strong></div>
      {body?.exists ? <span className={body.enabled ? styles.enabled : styles.paused}>{t(body.enabled ? "独立メニューを使用中" : "独立メニューは停止中")}</span> : null}
    </div>
    <p className={styles.help}>{t("Web予約・Webサイト・外部デリバリーは変更しません。取り込む商品の価格と50gなどの規格はそのまま引き継ぎます。")}</p>
    {!brandId || !storeId ? <p className={styles.empty}>{t("ブランドと店舗を選択してください。")}</p> : null}
    {loading ? <p role="status" className={styles.empty}>{t("店内メニューを読み込み中...")}</p> : null}
    {body && !body.ready ? <p role="alert" className={styles.error}>{t("店内メニューの準備が完了していません。管理者に確認してください。")}</p> : null}
    {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? styles.error : styles.success}>{t(notice.text)}</p> : null}
    {pending ? <div className={styles.pending} role="status"><span>{t("保存結果の確認が必要です。同じ操作を再試行すると、重複せずに結果を確認できます。")}</span><button type="button" className="secondary-button compact-button" disabled={saving || loading} data-dine-in-action="retry" onClick={() => void submit(pending, pending)}>{t(saving ? "保存中..." : "同じ操作を再試行")}</button></div> : null}
    {conflict ? <p className={styles.error}>{t("別の端末で変更されました。再読込してから編集してください。")}</p> : null}
    {body?.ready ? <>
      {!body.exists ? <div className={styles.initialize}>
        <div><h4>{t("店内メニューを新規作成")}</h4><p>{t("空のメニューから、商品分類と商品を作成します。ブランド商品の取込は作成後に必要なものだけ選べます。")}</p></div>
        <fieldset className={styles.initializeModes} disabled={busy || loading || conflict}>
          <legend>{t("作成方法")}</legend>
          <label><input type="radio" name="dine-in-initialize-mode" value="empty" checked={initializeMode === "empty"} onChange={() => setInitializeMode("empty")} /><span>{t("空のメニューから作成")}</span></label>
          <label><input type="radio" name="dine-in-initialize-mode" value="source" checked={initializeMode === "source"} onChange={() => setInitializeMode("source")} /><span>{t("現在の POS メニューをまとめて取り込む")}</span></label>
        </fieldset>
        {initializeMode === "source" ? <p className={styles.help}>{t("現在の POS の商品・価格・公開設定・選択ルールをまとめてコピーします。コピー後は店内メニューで独立して編集できます。")}</p> : null}
        {initializeMode === "empty" ? <p className={styles.help}>{t("商品を追加して確認後、POS で使用を開始してください。作成だけでは現在の POS メニューは切り替わりません。")}</p> : null}
        <button type="button" className="primary-button" disabled={busy || loading || conflict} data-dine-in-action="initialize" onClick={() => void submit({ action: "initialize", mode: initializeMode, enabled: initializeMode === "source" })}><Plus size={16} aria-hidden="true" />{t("店内メニューを新規作成")}</button>
      </div> : <div className={styles.activation}><p>{t(body.enabled ? "この独立メニューを店内飲食の POS で使用しています。" : "現在は従来の POS メニューを使用しています。独立メニューの編集内容は保存されています。")}</p><button type="button" className="secondary-button compact-button" disabled={disabled} data-dine-in-action="setEnabled" onClick={() => void submit({ action: "setEnabled", enabled: !body.enabled })}>{t(body.enabled ? "独立メニューを停止" : "独立メニューを使用")}</button></div>}
      {catalog ? <>
        <div className={styles.kinds} role="group" aria-label={t("店内メニューの表示切替")}>
          <button type="button" data-dine-in-view="edit" aria-pressed={view === "edit"} disabled={busy} onClick={() => { setView("edit"); setLinkedGroupReturn(null); }}>{t("商品を編集")}</button>
          <button type="button" data-dine-in-view="source" aria-pressed={view === "source"} disabled={busy} onClick={() => { setView("source"); setLinkedGroupReturn(null); }}>{t("対応・更新確認")}{body.sourceReview?.pendingCount ? ` (${body.sourceReview.pendingCount})` : ""}</button>
        </div>
        {view === "source" ? body.sourceReview ? <DineInSourceReview key={context} review={body.sourceReview} disabled={disabled} completionId={completionId} onEstablishBaseline={() => submit({ action: "acknowledgeSourceBaseline", sourceRevision: body.sourceReview!.sourceRevision })} onReview={(entryKey, decisions) => submit({ action: "reviewSource", sourceRevision: body.sourceReview!.sourceRevision, entryKey, decisions })} onEdit={editSourceEntry} onImport={importSourceEntry} /> : <p className={styles.empty}>{t("元メニューの比較を取得できません。再読込してください。")}</p> : null}
        <div hidden={view !== "edit"} className={styles.workspace} data-dine-in-edit-view>
        <DineInMenuComposer key={context} catalog={catalog} source={body.source} pricingDefaults={body.pricingDefaults} disabled={disabled} disabledReason={disabledReason} completionId={completionId} selectedItemId={target?.kind === "item" ? target.id : ""} selectedGroupId={selectedGroup?.id || targetOptionGroup?.id || ""} optionCreateRequest={optionCreateRequest} importRequest={importRequest} onSubmit={submit} />
        <div className={styles.filters}>
          <div className={styles.kinds} role="group" aria-label={t("編集する項目の種類")}>{(Object.entries(kindLabels) as Array<[Kind, string]>).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => { setKind(value); setSelected(""); setLinkedGroupReturn(null); setQuery(""); }}>{t(label)}</button>)}</div>
          <label>{t("名前で検索")}<input type="search" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder={t("店内名・引継ぎ元の名前")} /></label>
        </div>
        <div className={styles.statusFilters} role="group" aria-label={t("表示状態で絞り込む")}>
          {(["all", "visible", "hidden", "trash"] as const).map(value => <button type="button" key={value} className="secondary-button compact-button" data-dine-in-filter={value} aria-pressed={statusFilter === value} disabled={busy} onClick={() => { setStatusFilter(value); setSelected(""); setLinkedGroupReturn(null); }}>{t(value === "all" ? "すべて" : value === "visible" ? "POS に表示" : value === "hidden" ? "非表示" : "ごみ箱")}{value === "trash" ? ` (${(catalog.trash || []).filter(entry => entry.kind === kind).length})` : ""}</button>)}
        </div>
        <p className={styles.help}>{t("一時的に使わない商品・選択肢は「非表示」にしてください。名前・価格・設定を残したまま、いつでも表示に戻せます。")}</p>
        <details className={styles.recoveryHelp}><summary>{t("以前に削除した商品を戻したい場合")}</summary><p className={styles.help}>{t("ごみ箱に残っている項目は「元に戻す」で復元できます。以前の削除でごみ箱に残っていないブランド商品は「ブランド商品から取込」で追加してください。その場合、削除前の店内名・独自価格は再設定が必要です。")}</p></details>
        <p className={styles.help}>{t(kind === "category" ? "商品分類は商品の一覧を分ける見出しです。分類名を選ぶと変更できます。" : kind === "group" ? "追加・選択グループは商品を選んだ後に表示する項目です。商品分類とは別に管理します。" : "一覧から商品・選択肢を選ぶと、店内名や公開設定を変更できます。")}</p>
        {kind === "option" && statusFilter !== "trash" ? <div className={styles.optionGroupsToolbar}>
          <span>{t("{count} グループ・{options} 件の選択肢", { count: filteredOptionGroups.length, options: filtered.length })}</span>
          <div><button type="button" className="secondary-button compact-button" data-option-groups-action="expandAll" disabled={busy || Boolean(searchQuery) || !filteredOptionGroups.length} onClick={() => rememberOptionGroups({ ...rememberedGroups, ...Object.fromEntries(filteredOptionGroups.map(({ group }) => [group.id, true])) })}>{t("すべて開く")}</button><button type="button" className="secondary-button compact-button" data-option-groups-action="collapseAll" disabled={busy || Boolean(searchQuery) || !filteredOptionGroups.length} onClick={() => rememberOptionGroups({ ...rememberedGroups, ...Object.fromEntries(filteredOptionGroups.map(({ group }) => [group.id, false])) })}>{t("すべて閉じる")}</button></div>
          {searchQuery || target?.kind === "option" ? <p>{t(searchQuery ? "検索中は、一致したグループを開いて表示します。検索を消すと元の開閉状態に戻ります。" : "編集中のグループは開いたまま表示します。")}</p> : null}
        </div> : null}
        {kind === "option" && statusFilter !== "trash" ? <DineInOptionBulkActions scope="list" count={bulkOptionIds.length} total={filtered.length} disabled={disabled} reason={bulkDisabledReason} hideReason={bulkHideReason} showReason={bulkShowReason} canHide={bulkCanHide} canShow={bulkCanShow} onVisibility={visible => requestBulkVisibility(bulkOptionIds, visible)} onSelectAll={() => {
          if (disabled) return;
          setBulkSelection({ scope: bulkScope, ids: filtered.map(entry => entry.id) });
          rememberOptionGroups({ ...rememberedGroups, ...Object.fromEntries(filteredOptionGroups.map(({ group }) => [group.id, true])) });
        }} onClear={() => setBulkSelection({ scope: bulkScope, ids: [] })} onDelete={() => requestBulkDelete(bulkOptionIds)} /> : null}
        <div className={styles.body}>
          <div className={styles.list} role="group" aria-label={t("店内メニュー一覧")} data-dine-in-option-groups={kind === "option" && statusFilter !== "trash" ? "true" : undefined}>
            {statusFilter === "trash" ? trash.map(entry => <div key={entry.id} className={styles.trashRow} data-dine-in-trash-id={entry.id}><div><strong>{entry.name}</strong><small>{t(kindLabels[entry.kind])}</small></div><button type="button" className="secondary-button compact-button" data-dine-in-action="restore" disabled={disabled} onClick={() => void submit({ action: "restore", targetId: entry.id })}>{t("店内メニューに戻す")}</button></div>) : kind === "option" ? filteredOptionGroups.map(({ group, options, products }) => {
              const selectedGroup = target?.kind === "option" && target.groupId === group.id;
              const expanded = Boolean(searchQuery) || selectedGroup || rememberedGroups[group.id] === true;
              const sectionId = `dine-in-option-group-${group.id}`;
              const contextLabel = products.length ? products.slice(0, 2).join(" / ") + (products.length > 2 ? ` / ${t("ほか {count} 商品", { count: products.length - 2 })}` : "") : t("所属する商品なし");
              return <section key={group.id} className={styles.optionListGroup} data-option-group-id={group.id} data-option-group-selected={selectedGroup ? "true" : "false"}>
                <button type="button" id={`${sectionId}-heading`} className={styles.optionGroupToggle} data-option-group-toggle={group.id} aria-expanded={expanded} aria-controls={sectionId} disabled={busy || Boolean(searchQuery) || selectedGroup} title={selectedGroup ? t("編集中のグループは開いたまま表示します。") : undefined} onClick={() => rememberOptionGroups({ ...rememberedGroups, [group.id]: !expanded })}>
                  <span className={styles.optionGroupTitle}><strong>{group.name}</strong><small data-option-group-context title={products.join(" / ")}>{contextLabel}</small></span>
                  <span className={styles.optionGroupMeta}><span>{t("表示 {count} / {total} 件", { count: options.length, total: group.options.length })}</span>{selectedGroup ? <em>{t("編集中")}</em> : group.visible === false ? <em>{t("グループ非公開")}</em> : null}</span>
                  <ChevronDown size={16} aria-hidden="true" className={styles.optionGroupChevron} />
                </button>
                <div id={sectionId} role="group" aria-labelledby={`${sectionId}-heading`} className={styles.optionGroupOptions} data-option-group-options={group.id} hidden={!expanded}>
                  {options.map(entry => <DineInTargetButton key={entry.id} entry={entry} selected={selected} busy={busy} onChoose={choose} price={priceLabel(entry)} itemCount={0} showGroupName={false} selection={{ checked: bulkOptionSet.has(entry.id), disabled, onChange: checked => toggleBulkOption(entry.id, checked) }} />)}
                </div>
              </section>;
            }) : filtered.map(entry => <DineInTargetButton key={`${entry.kind}:${entry.id}`} entry={entry} selected={selected} busy={busy} onChoose={choose} price={priceLabel(entry)} itemCount={entry.kind === "category" ? catalog.items.filter(item => item.category === entry.name).length : 0} />)}
            {!(statusFilter === "trash" ? trash.length : filtered.length) ? <p className={styles.empty}>{t(statusFilter === "trash" ? "ごみ箱に該当する項目はありません。" : "該当する項目がありません。")}</p> : null}
          </div>
          {statusFilter !== "trash" && target ? <div className={styles.editor} key={`${target.kind}:${target.id}`}>
            <div className={styles.itemHeading}><span>{t(kindLabels[target.kind])}</span><h4>{target.name}</h4>{target.kind !== "category" ? <p>{target.kind === "option" && target.localOnly ? t("この店舗で作成した選択肢") : target.variableSchema?.storeDineInOnly ? t("この店舗で新規作成した商品") : target.sourceName ? <>{t("引継ぎ元")}: {target.sourceName}</> : t("この店舗で作成したグループ")}</p> : null}</div>
            {returnGroup ? <button type="button" className={`secondary-button compact-button ${styles.returnToGroup}`} data-dine-in-return-group={returnGroup.id} disabled={disabled} onClick={() => { if (disabled) return; setKind("group"); setStatusFilter("all"); setQuery(""); choose({ ...returnGroup, kind: "group" }); }}>{t("このグループに戻る")}: {returnGroup.name}</button> : null}
            {target.kind !== "category" ? <div className={styles.visibilityAction}><span>{t(target.visible === false ? "POS では非表示です" : "POS に表示しています")}</span><button type="button" className="secondary-button compact-button" disabled={disabled} data-dine-in-action="toggleVisibility" onClick={() => void submit({ action: "setVisibility", kind: target.kind, targetId: target.id, visible: target.visible === false })}>{t(target.visible === false ? "POS に表示する" : "一時的に非表示にする")}</button></div> : null}
            {selectedGroup ? <DineInGroupOptions key={selectedGroup.id} catalog={catalog} group={selectedGroup} disabled={disabled} selectionScope={`${context}:${body.revision}:${completionId}:${view}`} onDelete={requestBulkDelete} onVisibility={requestBulkVisibility} onCreate={() => { if (!disabled) setOptionCreateRequest({ token: crypto.randomUUID(), groupId: selectedGroup.id }); }} onEdit={optionId => {
              if (disabled) return;
              const option = targets.find(entry => entry.kind === "option" && entry.groupId === selectedGroup.id && entry.id === optionId);
              if (!option) return;
              setKind("option"); setStatusFilter("all"); setQuery(""); choose(option);
            }} /> : null}
            {target.kind === "item" ? <DineInItemGroupsEditor catalog={catalog} targetId={target.id} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {selectedGroup ? <DineInGroupItemsEditor catalog={catalog} targetId={selectedGroup.id} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {target.kind === "category" ? <DineInOrderingSection key="categories" kind="category" rows={catalog.categories} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {target.kind === "item" ? <><DineInOrderingSection key="items" kind="item" rows={catalog.items.map(item => ({ id: item.id, name: item.name, detail: item.category }))} disabled={disabled} completionId={completionId} onSubmit={submit} /><DineInOrderingSection key={`groups:${target.id}`} kind="group" targetId={target.id} rows={orderedItemGroups} disabled={disabled} completionId={completionId} onSubmit={submit} /></> : null}
            {selectedGroup && !["addon", "choice"].includes(selectedGroup.localKind || "") ? <DineInOrderingSection key={`options:${selectedGroup.id}`} kind="option" targetId={selectedGroup.id} rows={selectedGroup.options} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {targetOptionGroup ? <DineInOrderingSection key={`options:${targetOptionGroup.id}`} kind="option" targetId={targetOptionGroup.id} rows={targetOptionGroup.options} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {linkedTargetItem ? <div className={styles.linkedItem} data-dine-in-linked-item={linkedTargetItem.id}><strong>{t("関連する店内商品")}: {linkedTargetItem.name}</strong><p>{t("名前・価格は関連する店内商品に従います。商品の名前・価格を直すと、この選択肢にも反映します。")}</p><button type="button" className="secondary-button compact-button" data-dine-in-edit-linked-item={linkedTargetItem.id} disabled={disabled} onClick={() => { if (disabled) return; setKind("item"); setStatusFilter("all"); setQuery(""); choose({ ...linkedTargetItem, kind: "item" }); if (targetOptionGroup) setLinkedGroupReturn({ itemId: linkedTargetItem.id, groupId: targetOptionGroup.id }); }}>{t("関連する商品を編集")}</button></div> : null}
            {target.kind === "item" || target.kind === "option" ? <div className={styles.priceSummary} data-dine-in-current-price><span>{t("現在の価格")}</span><strong>{priceLabel(target)}</strong><small>{t(target.kind === "option" ? "麺・追加食材は、選択した個数で加算します。" : target.posPricingMode === "weight" ? "重量と保存済みの重量単価で計算します。" : "ドリンク・酒類を含む個数販売の商品は、店内の販売価格を変更できます。")}</small></div> : null}
            {target.kind === "item" || target.kind === "category" ? <DineInFulfillmentSettings key={`fulfillment:${target.kind}:${target.id}`} catalog={catalog} kind={target.kind} targetId={target.id} disabled={disabled} onSubmit={submit} /> : null}
            {target.kind === "item" && target.posPricingMode !== "weight" ? <form className={styles.form} data-dine-in-item-price-form onSubmit={event => {
              event.preventDefault();
              if (!disabled && validItemPrice && Number(itemPrice) !== Number(target.price ?? target.basePrice ?? 0)) void submit({ action: "setItemPrice", targetId: target.id, price: Number(itemPrice) });
            }}>
              <label htmlFor="dine-in-edit-item-price">{t("店内の販売価格（円／1点）")}<input id="dine-in-edit-item-price" data-dine-in-item-price aria-invalid={!validItemPrice} aria-describedby={!validItemPrice ? "dine-in-item-price-help" : undefined} inputMode="numeric" value={itemPrice} disabled={disabled} maxLength={7} onChange={event => setItemPrice(event.target.value.normalize("NFKC").replace(/[￥¥円,\s]/g, ""))} /></label>
              <p>{t("この商品の店内価格だけを変更します。Web予約・Webサイト・外部デリバリーと、別の店内版の価格は変わりません。")}</p>
              {!validItemPrice ? <p id="dine-in-item-price-help" role="status">{t("価格は0〜9,999,999円の整数で入力してください。")}</p> : null}
              <button type="submit" className="secondary-button compact-button" data-dine-in-action="setItemPrice" disabled={disabled || !validItemPrice || Number(itemPrice) === Number(target.price ?? target.basePrice ?? 0)} aria-describedby={!validItemPrice ? "dine-in-item-price-help" : undefined}>{t("店内の販売価格を保存")}</button>
            </form> : null}
            {target.kind === "item" ? <form className={styles.form} data-dine-in-item-category-form onSubmit={event => {
              event.preventDefault();
              if (!disabled && effectiveItemCategoryId && effectiveItemCategoryId !== currentItemCategoryId) void submit({ action: "setItemCategory", targetId: target.id, categoryId: effectiveItemCategoryId });
            }}>
              <label htmlFor="dine-in-edit-item-category">{t("商品分類")}<select id="dine-in-edit-item-category" data-dine-in-item-category value={effectiveItemCategoryId} disabled={disabled || !catalog.categories.length} onChange={event => setItemCategoryId(event.target.value)}><option value="">{t("商品分類を選択")}</option>{catalog.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <p>{t("この商品の店内の商品分類を変更します。価格・選択肢・過去の注文と、他の商品は変わりません。")}</p>
              <button type="submit" className="secondary-button compact-button" data-dine-in-action="setItemCategory" disabled={disabled || !effectiveItemCategoryId || effectiveItemCategoryId === currentItemCategoryId}>{t("商品分類を保存")}</button>
            </form> : null}
            {target.kind === "option" && !target.linkedItemId ? <form className={styles.form} data-dine-in-option-price-form onSubmit={event => {
              event.preventDefault();
              if (!disabled && validOptionPrice && Number(optionPrice) !== target.priceDelta) void submit({ action: "setOptionPrice", targetId: target.id, price: Number(optionPrice) });
            }}>
              <label htmlFor="dine-in-edit-option-price">{t("店内の追加料金（円／1点）")}<input id="dine-in-edit-option-price" data-dine-in-option-price aria-invalid={!validOptionPrice} aria-describedby={!validOptionPrice ? "dine-in-option-price-help" : undefined} inputMode="numeric" value={optionPrice} disabled={disabled} maxLength={7} onChange={event => setOptionPrice(event.target.value.normalize("NFKC").replace(/[￥¥円,\s]/g, ""))} /></label>
              <p>{t("この選択肢の店内価格だけを変更します。50gなどの1点あたりの規格は変わりません。")}</p>
              <p>{t("Web予約・Webサイト・外部デリバリーと、同じ食材の別の店内版の価格は変更しません。")}</p>
              {sharedOptionItemCount > 1 ? <p role="status">{t("この選択肢は {count} 件の店内商品で共用しています。変更はこれらの商品に適用します。", { count: sharedOptionItemCount })}</p> : null}
              {!validOptionPrice ? <p id="dine-in-option-price-help" role="status">{t("価格は0〜9,999,999円の整数で入力してください。")}</p> : null}
              <button type="submit" className="secondary-button compact-button" data-dine-in-action="setOptionPrice" disabled={disabled || !validOptionPrice || Number(optionPrice) === target.priceDelta} aria-describedby={!validOptionPrice ? "dine-in-option-price-help" : undefined}>{t("店内の追加料金を保存")}</button>
            </form> : null}
            {target.kind === "item" ? <form className={styles.form} data-dine-in-pricing-form onSubmit={event => {
              event.preventDefault();
              if (!disabled && !isDrink && pricingMode !== target.posPricingMode && (pricingMode !== "weight" || weightPricingAvailable)) void submit({ action: "setItemPricing", targetId: target.id, pricingMode });
            }}>
              <label htmlFor="dine-in-edit-pricing">{t("販売方法")}<select id="dine-in-edit-pricing" data-dine-in-pricing value={pricingMode} disabled={disabled || isDrink} onChange={event => setPricingMode(event.target.value as "fixed" | "weight")}><option value="fixed">{t("個数販売（1個・1皿ごと）")}</option><option value="weight" disabled={!weightPricingAvailable && target.posPricingMode !== "weight"}>{t("計量販売（重量で計算）")}</option></select></label>
              <p>{t(isDrink ? "ドリンクは個数販売です。重量では計算しません。" : "麺・追加食材は、選択した個数で加算します。")}</p>
              {!isDrink && pricingMode === "fixed" && target.posPricingMode !== "fixed" ? <div className={styles.pricingRate} data-dine-in-fixed-price><span>{t("個数販売の価格")}</span><strong>{t("¥{price} / 1点", { price: Number(target.price ?? target.basePrice ?? 0).toLocaleString("ja-JP") })}</strong></div> : null}
              {!isDrink && pricingMode === "weight" && target.posPricingMode === "weight" ? <p>{t("この商品の重量単価は保存済みです。店舗の初期値を変更しても自動では変わりません。")}</p> : !isDrink && pricingMode === "weight" ? <>
                <p>{t("計量販売には現在の店舗設定の重量単価を使用します。")}</p>
                {weightPricingAvailable ? <div className={styles.pricingRate} data-dine-in-default-rate><span>{t("店舗設定の重量単価")}</span><strong>{t("¥{price} / 1{unit}", { price: Number(body.pricingDefaults!.unitPrice).toLocaleString("ja-JP"), unit: body.pricingDefaults!.unit || "g" })}</strong></div> : <p role="status">{t("重量単価が未設定です。店舗の POS 設定で設定してください。")}</p>}
              </> : !isDrink && !weightPricingAvailable ? <p>{t("重量単価が未設定です。店舗の POS 設定で設定してください。")}</p> : null}
              {!isDrink ? <button type="submit" className="secondary-button compact-button" disabled={disabled || pricingMode === target.posPricingMode || (pricingMode === "weight" && !weightPricingAvailable)} data-dine-in-action="setItemPricing">{t("販売方法を保存")}</button> : null}
            </form> : null}
            {!target.linkedItemId ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (name.trim() && name.trim() !== target.name) void submit({ action: "rename", kind: target.kind, targetId: target.id, name: name.trim() }); }}>
              <label htmlFor="dine-in-edit-name">{t(target.kind === "category" ? "商品分類名" : "店内で使う名前")}<input id="dine-in-edit-name" data-dine-in-name value={name} maxLength={120} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
              <p>{t(target.kind === "category" ? "商品分類名を変更します。この分類の商品の所属もまとめて更新します。" : "POS・客表示・厨房・レシートに使用します。改名前の注文は変わりません。")}</p>
              {target.kind !== "category" ? <p>{t("改名時は以前の翻訳名を解除し、新しい日本語名を表示します。")}</p> : null}
              <button type="submit" className="primary-button" disabled={disabled || !name.trim() || name.trim() === target.name} data-dine-in-action="rename"><Save size={15} aria-hidden="true" />{t(target.kind === "category" ? "商品分類名を保存" : "店内名を保存")}</button>
            </form> : null}
            {target.kind !== "category" ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void submit({ action: "setVisibility", kind: target.kind, targetId: target.id, visible: visibility }); }}>
              <label>{t("この店舗の POS に表示")}<select id="dine-in-edit-visibility" data-dine-in-visibility value={visibility ? "show" : "hide"} disabled={disabled} onChange={event => setVisibility(event.target.value === "show")}><option value="show">{t("公開")}</option><option value="hide">{t("非公開")}</option></select></label>
              <p>{t("POS の公開設定です。食材の欠品状態とは別に管理します。")}</p>
              {target.parentVisible === false ? <p>{t("この選択肢のグループが非公開です。POS に表示するには、グループも公開してください。")}</p> : null}
              <button type="submit" className="secondary-button compact-button" disabled={disabled || visibility === target.visible} data-dine-in-action="setVisibility">{t("公開設定を保存")}</button>
            </form> : null}
            {selectedGroup ? <DineInGroupSettings catalog={catalog} group={selectedGroup} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            {selectedGroup && canDineInGroupImportAddons(selectedGroup) ? <DineInAddonImporter catalog={catalog} source={body.source} group={selectedGroup} disabled={disabled} completionId={completionId} onSubmit={submit} /> : null}
            <section className={styles.deleteSection} aria-label={t("店内メニューから削除")}>
              <p>{t("一時的に使わない場合は非表示にしてください。ごみ箱へ移動した項目は、後から元に戻せます。")}</p>
              {deleteDisabledReason ? <p id="dine-in-delete-help" role="status">{t(deleteDisabledReason)}</p> : null}
              <button type="button" className="danger-button compact-button" data-dine-in-action="openDelete" disabled={disabled || Boolean(deleteDisabledReason)} aria-describedby={deleteDisabledReason ? "dine-in-delete-help" : undefined} onClick={() => { setDeleteTarget(target); setReplacementCategoryId(""); }}><Trash2 size={15} aria-hidden="true" />{t("ごみ箱へ移動")}</button>
            </section>
            {target.kind === "item" || target.kind === "option" && !target.linkedItemId ? <details className={styles.derive}><summary>{t(target.kind === "item" ? "この商品から店内版を追加" : "この選択肢から店内版を追加")}</summary><form onSubmit={event => { event.preventDefault(); if (duplicateName.trim()) void submit({ action: "duplicate", kind: target.kind, targetId: target.id, name: duplicateName.trim() }); }}><p>{t("価格・規格・食材の関連を引き継ぎ、別の店内名で追加します。元の商品はそのまま残ります。")}</p><label>{t("新しい店内版の名前")}<input value={duplicateName} maxLength={120} disabled={disabled} onChange={event => setDuplicateName(event.target.value)} placeholder={t("新しい名前を入力")} /></label><button type="submit" className="primary-button" disabled={disabled || !duplicateName.trim()} data-dine-in-action="duplicate"><Copy size={15} aria-hidden="true" />{t("店内版を追加")}</button></form></details> : null}
          </div> : <p className={styles.empty}>{t("一覧から編集する商品・選択肢を選んでください。")}</p>}
        </div>
        </div>
      </> : null}
    </> : null}
    <dialog ref={bulkDeleteDialog} className={styles.deleteDialog} data-dine-in-bulk-dialog aria-labelledby="dine-in-bulk-delete-title" aria-describedby="dine-in-bulk-delete-scope" onCancel={event => { if (busy) event.preventDefault(); else setBulkDeleteIds(null); }} onClose={() => { if (!busy) setBulkDeleteIds(null); }}>
      {bulkDeleteIds ? <form className={styles.deleteDialogBody} onSubmit={event => {
        event.preventDefault();
        if (!disabled && !bulkConfirmReason) void submit({ action: "deleteOptions", optionIds: bulkDeleteIds });
      }}>
        <h4 id="dine-in-bulk-delete-title">{t("選択肢 {count} 件をごみ箱に移動しますか？", { count: bulkDeleteIds.length })}</h4>
        <p>{storeName} / {brandName || t("ブランドを選択")} / {t("店内飲食")}</p>
        <p id="dine-in-bulk-delete-scope">{t("選択した選択肢を所属グループから削除します。同じグループを使う店内商品にも適用します。")}</p>
        <ul className={styles.bulkDeleteNames}>{bulkDeleteOptions.map(option => <li key={option.id} data-dine-in-bulk-confirm-option={option.id}><strong>{option.name}</strong><span>{option.groupName}</span></li>)}</ul>
        <p>{t("この店舗の店内メニューからのみ削除します。Web予約・Webサイト・外部デリバリーと過去の注文は変更しません。")}</p>
        <p>{t("選択肢は1件ずつごみ箱から元に戻せます。名前・価格・規格と同じIDを復元します。")}</p>
        {bulkDeleteOptions.some(option => option.linkedItemId) ? <p data-dine-in-bulk-linked-warning>{t("関連商品がある選択肢は、選択肢だけを削除します。ホームに表示する商品は残ります。")}</p> : null}
        {bulkConfirmReason ? <p role="status" className={styles.help}>{t(bulkConfirmReason)}</p> : null}
        {notice?.tone === "error" ? <p role="alert" className={styles.error}>{t(notice.text)}</p> : null}
        {pending ? <p role="status" className={styles.help}>{t("保存結果の確認が必要です。同じ操作を再試行すると、重複せずに結果を確認できます。")}</p> : null}
        <div className={styles.deleteDialogActions}>
          <button type="button" className="secondary-button compact-button" data-dine-in-bulk-cancel disabled={busy} onClick={() => setBulkDeleteIds(null)}>{t("キャンセル")}</button>
          {pending?.action === "deleteOptions" ? <button type="button" className="danger-button compact-button" disabled={saving || loading} data-dine-in-action="retryDeleteOptions" onClick={() => void submit(pending, pending)}>{t(saving ? "保存中..." : "同じ操作を再試行")}</button> : <button type="submit" className="danger-button compact-button" data-dine-in-action="deleteOptions" disabled={disabled || Boolean(bulkConfirmReason)}>{t(saving ? "保存中..." : "ごみ箱へ移動")}</button>}
        </div>
      </form> : null}
    </dialog>
    <dialog ref={deleteDialog} className={styles.deleteDialog} aria-labelledby="dine-in-delete-title" aria-describedby="dine-in-delete-scope" onCancel={event => { if (busy) event.preventDefault(); else setDeleteTarget(null); }} onClose={() => { if (!busy) setDeleteTarget(null); }}>
      {deleteTarget ? <form className={styles.deleteDialogBody} onSubmit={event => { event.preventDefault(); if (!disabled && (!deleteCategoryItems.length || replacementCategoryId)) void submit({ action: "delete", kind: deleteTarget.kind, targetId: deleteTarget.id, ...(deleteCategoryItems.length ? { replacementCategoryId } : {}) }); }}>
        <h4 id="dine-in-delete-title">{t("「{name}」をごみ箱に移動しますか？", { name: deleteTarget.name })}</h4>
        <p id="dine-in-delete-scope">{t("この店舗の店内メニューからのみ削除します。Web予約・Webサイト・外部デリバリーと過去の注文は変更しません。")}</p>
        <p>{t("ごみ箱から元に戻すと、名前・価格・選択肢の設定と同じIDを復元します。")}</p>
        {deleteTarget.kind === "item" ? <p>{t("この商品と、この商品だけに属する選択グループを削除します。他の商品は変更しません。")}</p> : null}
        {deleteTarget.kind === "group" ? <p>{t("このグループと中の選択肢を、店内の商品 {count} 件から外します。", { count: deleteGroupItems.length })}</p> : null}
        {deleteTarget.kind === "option" ? <p>{t("この選択肢を所属する店内グループから削除します。")}</p> : null}
        {deleteCategoryItems.length ? <>
          <p>{t("この分類には商品 {count} 件があります。商品は削除せず、選んだ分類へ移動します。", { count: deleteCategoryItems.length })}</p>
          <label htmlFor="dine-in-delete-replacement">{t("商品の移動先")}<select id="dine-in-delete-replacement" value={replacementCategoryId} disabled={disabled || !replacementCategories.length} onChange={event => setReplacementCategoryId(event.target.value)}><option value="">{t("移動先の商品分類を選択")}</option>{replacementCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          {!replacementCategories.length ? <p role="status">{t("先に別の商品分類を作成してください。商品がある最後の分類は削除できません。")}</p> : null}
        </> : null}
        {notice?.tone === "error" ? <p role="alert" className={styles.error}>{t(notice.text)}</p> : null}
        {pending ? <p role="status" className={styles.help}>{t("保存結果の確認が必要です。同じ操作を再試行すると、重複せずに結果を確認できます。")}</p> : null}
        <div className={styles.deleteDialogActions}>
          <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => setDeleteTarget(null)}>{t("キャンセル")}</button>
          {pending ? <button type="button" className="danger-button compact-button" disabled={saving || loading} data-dine-in-action="retryDelete" onClick={() => void submit(pending, pending)}>{t(saving ? "保存中..." : "同じ操作を再試行")}</button> : <button type="submit" className="danger-button compact-button" data-dine-in-action="delete" disabled={disabled || Boolean(deleteCategoryItems.length && !replacementCategoryId)}>{t(saving ? "保存中..." : "ごみ箱へ移動")}</button>}
        </div>
      </form> : null}
    </dialog>
  </section>;
}
