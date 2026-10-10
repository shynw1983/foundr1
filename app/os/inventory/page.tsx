"use client";

import {
  AlertTriangle,
  Archive,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileText,
  Lightbulb,
  PackageCheck,
  PackagePlus,
  PackageSearch,
  Pencil,
  Search,
  Settings2,
  Store,
  Truck,
  UserCog
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { ReplenishmentPanel } from "../../../components/ReplenishmentPanel";
import { StockReceiptPanel } from "../../../components/StockReceiptPanel";
import { InventoryUsagePanel } from "../../../components/InventoryUsagePanel";
import { ManufacturingPanel } from "../../../components/ManufacturingPanel";
import type { InventoryCountReconciliation } from "../../../lib/inventory-usage-policy";
import { QuickInventoryList } from "../../../components/QuickInventoryList";
import type { InventoryQuickCheck, InventoryQuickCheckBasis, InventoryQuickCheckSubmission } from "../../../lib/inventory-quick-policy";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList, type OsNavItem } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { inventoryCountException, inventoryNeedsOrder } from "../../../lib/inventory-observation-policy";

import { normalizeInventoryCountInput } from "../../../lib/inventory-count-input-policy";
import { parseInventoryCountQuantity, type ProductInventoryUnitConversion, type ProductUnitConversionSnapshot } from "../../../lib/product-unit-conversions";

type StoreOption = { id: string; name: string };
type LocationOption = {
  id: string;
  name: string;
  equipmentBrand: string;
  equipmentName: string;
  positionName: string;
  locationType: string;
};
type ProductOption = { id: string; name: string; category: string; unit: string; storageType: string; inventoryUnitConversions?: ProductInventoryUnitConversion[]; inventoryUnitChoices?: ProductUnitConversionSnapshot[] };
type InventoryItem = {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  category: string;
  locationId: string;
  locationName: string;
  countUnit: string;
  currentConversion?: ProductUnitConversionSnapshot | null;
  countConversionSnapshot?: ProductUnitConversionSnapshot | null;
  stockConversionSnapshot?: ProductUnitConversionSnapshot | null;
  stockRevision?: number;
  lastCountedQuantity?: number | null;
  lastReceivedAt?: string | null;
  conversionChanged?: boolean;
  purchaseEquivalent?: { quantity: number; unit: string } | null;
  unitChoices?: ProductUnitConversionSnapshot[];
  safetyStock: number;
  currentQuantity: number | null;
  exceptionCode: string;
  exceptionNote: string;
  lastCountedAt: string | null;
  lastCountedBy: string;
  confidenceLabel: string;
  lastCountedLabel: string;
  quickCheckBasis?: InventoryQuickCheckBasis;
  quickCheck?: InventoryQuickCheck | null;
  canQuickCheck?: boolean;
  effectiveStockStatus?: "available" | "low_stock" | "unavailable";
};
type RecentCheck = {
  id: string;
  productName: string;
  locationName: string;
  quantity: number | null;
  countUnit: string;
  unitConversionSnapshot?: ProductUnitConversionSnapshot | null;
  purchaseEquivalent?: { quantity: number; unit: string } | null;
  recordType: string;
  exceptionCode: string;
  note: string;
  recordedBy: string;
  createdLabel: string;
  reconciliation?: InventoryCountReconciliation | null;
  quickStatus?: "enough" | "low" | "out";
  quickEstimate?: { kind: string; quantity?: number; purchaseUnit?: string | null } | null;
};
type InventoryPayload = {
  stores: StoreOption[];
  selectedStoreId?: string;
  locations: LocationOption[];
  products: ProductOption[];
  items: InventoryItem[];
  recentChecks: RecentCheck[];
};

const navItems: OsNavItem[] = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "在庫確認", href: "/os/inventory", icon: PackageSearch }
];

const quantityOptions = [
  { value: 0, label: "0" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 5, label: "5" }
];

const exceptionLabels: Record<string, string> = {
  low: "残りわずか",
  out: "在庫切れ",
  too_much: "多すぎ",
  damaged: "破損",
  quality: "品質異常"
};
const locationTypeLabels: Record<string, string> = {
  freezer: "冷凍",
  refrigerator: "冷蔵",
  ambient: "常温",
  other: "その他"
};
const emptyLocationDraft = {
  id: "",
  equipmentBrand: "",
  equipmentName: "",
  positionName: "",
  locationType: "freezer"
};

export default function InventoryPage() {
  const { t, language } = useOsTranslation();
  const stockLabels = stockLabelsForLanguage(language);
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [data, setData] = useState<InventoryPayload>({
    stores: [],
    locations: [],
    products: [],
    items: [],
    recentChecks: []
  });
  const [storeId, setStoreId] = useState("");
  const [inventoryMode, setInventoryMode] = useState<"quick" | "precise">("quick");
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [quickSaveError, setQuickSaveError] = useState("");
  const [countDrafts, setCountDrafts] = useState<Record<string,string>>({});
  const [countInputUnits,setCountInputUnits] = useState<Record<string,string>>({});
  const [countSaveError, setCountSaveError] = useState("");
  const activeInventoryStore = useRef(storeId);
  activeInventoryStore.current = storeId;
  const [replenishmentOpen, setReplenishmentOpen] = useState(false);
  const [replenishmentRefreshKey, setReplenishmentRefreshKey] = useState(0);
  const [locationFilter, setLocationFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const inventoryLoadSequence = useRef(0);
  const [isSaving, setIsSaving] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [setupProductId, setSetupProductId] = useState("");
  const [setupCountUnit, setSetupCountUnit] = useState("");
  const [setupCustomUnit, setSetupCustomUnit] = useState("");
  const setupProduct = data.products.find(product => product.id === setupProductId);
  const setupUnitChoices = setupProduct?.inventoryUnitChoices ?? [];
  const setupConversion = setupUnitChoices.find(choice => choice.countUnit === setupCountUnit);
  const [showLocationSettings, setShowLocationSettings] = useState(false);
  const [locationDraft, setLocationDraft] = useState(emptyLocationDraft);

  useEffect(() => {
    try { if (localStorage.getItem("foundr1-os:inventory-mode-v1") === "precise") setInventoryMode("precise"); } catch { /* Quick mode is the usable default. */ }
    const loadLinkedStore = () => {
      const linkedStoreId = new URLSearchParams(window.location.search).get("storeId")?.trim() ?? "";
      setLocationFilter("all");
      setLocationDraft(emptyLocationDraft);
      setReceiptsOpen(false); setQuickSaveError(""); setCountDrafts({}); setCountSaveError("");
      void loadInventory(linkedStoreId);
    };
    loadLinkedStore();
    window.addEventListener("popstate", loadLinkedStore);
    return () => { window.removeEventListener("popstate", loadLinkedStore); ++inventoryLoadSequence.current; };
  }, []);

  async function loadInventory(nextStoreId?: string, preserveCurrentItems = false) {
    const sequence = ++inventoryLoadSequence.current;
    setIsLoading(true);
    const targetStoreId = nextStoreId ?? storeId;
    setLoadError("");
    setStoreId(targetStoreId);
    if (nextStoreId !== undefined && !preserveCurrentItems) setData((current) => ({ stores: current.stores, locations: [], products: [], items: [], recentChecks: [] }));
    try {
      const response = await fetch(`/api/inventory${targetStoreId ? `?storeId=${encodeURIComponent(targetStoreId)}` : ""}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "在庫情報を読み込めませんでした。");
      }
      const payload = await response.json() as InventoryPayload;
      if (sequence !== inventoryLoadSequence.current) return;
      if (targetStoreId && payload.selectedStoreId !== targetStoreId) throw new Error("在庫情報を読み込めませんでした。");
      setData(payload);
      setReplenishmentRefreshKey(key => key + 1);
      setStoreId(payload.selectedStoreId ?? targetStoreId);
    } catch (failure) {
      if (sequence !== inventoryLoadSequence.current) return;
      setLoadError(failure instanceof Error ? failure.message : "在庫情報を読み込めませんでした。");
      setData((current) => ({ stores: current.stores, locations: [], products: [], items: [], recentChecks: [] }));
      setStoreId(targetStoreId);
    } finally {
      if (sequence === inventoryLoadSequence.current) setIsLoading(false);
    }
  }

  async function postInventory(body: Record<string, unknown>, successMessage: string) {
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, storeId })
    });
    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({})) as { error?: string; code?: string };
      if (responseBody.code === "stock_revision_changed") throw new Error(stockLabels.stockChanged);
      throw new Error(responseBody.error ?? "在庫情報を保存できませんでした。");
    }
    const result = await response.json().catch(() => ({})) as { count?: { reconciliation?: InventoryCountReconciliation } };
    const compared = result.count?.reconciliation;
    showNotice(compared?.difference !== null && compared?.difference !== undefined
      ? t("棚卸を保存しました。帳簿との差異：{difference} {unit}（原因は要確認）",{difference:formatQuantity(compared.difference),unit:compared.countUnit}) : successMessage);
    return result;
  }

  function changeMode(mode: "quick" | "precise") {
    setInventoryMode(mode);
    try { localStorage.setItem("foundr1-os:inventory-mode-v1", mode); } catch { /* Keep the selected mode usable without storage. */ }
  }

  async function reloadIfCurrentStore(submittedStore: string) {
    if (activeInventoryStore.current === submittedStore) await loadInventory(submittedStore, true);
  }

  async function recordQuickChecks(checks: InventoryQuickCheckSubmission[]) {
    if (isSaving || !checks.length) return false;
    const submittedStore = storeId;
    setIsSaving("quick"); setQuickSaveError("");
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "batch_quick_check", storeId: submittedStore, checks }) });
      const body = await response.json().catch(() => ({}));
      if (activeInventoryStore.current !== submittedStore) return false;
      if (!response.ok) {
        if (response.status === 409) await reloadIfCurrentStore(submittedStore);
        throw new Error(body.error ?? "かんたん確認を保存できませんでした。再試行してください。");
      }
      showNotice(t("{count} 件の目視状態を保存しました。", { count: checks.length }));
      await reloadIfCurrentStore(submittedStore);
      return true;
    } catch (error) {
      if (activeInventoryStore.current === submittedStore) setQuickSaveError(error instanceof Error ? error.message : "かんたん確認を保存できませんでした。再試行してください。");
      return false;
    } finally { setIsSaving(""); }
  }

  async function recordCount(item: InventoryItem, quantity: number, inputUnit = item.countUnit): Promise<boolean> {
    if (isSaving) return false;
    const submittedStore = storeId;
    setCountSaveError("");
    setIsSaving(item.id);
    try {
      await postInventory({ action: "count", itemId: item.id, quantity, inputUnit, countUnit: item.countUnit, expectedConversion: item.currentConversion ?? null, expectedStockRevision: item.stockRevision }, `${item.productName}の在庫を記録しました。`);
      if (activeInventoryStore.current === submittedStore) {
        setCountDrafts(current => { const next={...current};delete next[item.id];return next; });
        await loadInventory(submittedStore,true);
      }
      return true;
    } catch (error) {
      if (activeInventoryStore.current === submittedStore) {
        setCountSaveError(error instanceof Error ? error.message : "在庫情報を保存できませんでした。");
        if (error instanceof Error && error.message === stockLabels.stockChanged) await loadInventory(submittedStore,true);
      }
      return false;
    } finally {
      setIsSaving("");
    }
  }

  async function recordExactCount(event: FormEvent<HTMLFormElement>, item: InventoryItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const quantity = parseInventoryCountQuantity(new FormData(form).get("quantity"));
    if (quantity === null) {
      window.alert(t("数量は0以上、小数は6桁までです。分数は正確に記録できる値を入力するか、1/X単位を選んでください。"));
      return;
    }
    if (await recordCount(item, quantity,String(new FormData(form).get("inputUnit") ?? item.countUnit))) form.reset();
  }

  async function recordException(item: InventoryItem, exceptionCode: string) {
    if (isSaving) return;
    setIsSaving(item.id);
    try {
      await postInventory(
        { action: "exception", itemId: item.id, exceptionCode },
        `${item.productName}に「${exceptionLabels[exceptionCode]}」を記録しました。`
      );
      await loadInventory(storeId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "異常を記録できませんでした。");
    } finally {
      setIsSaving("");
    }
  }

  async function addInventoryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storeId || isSaving) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSaving("setup");
    try {
      await postInventory({
        action: "configure",
        productId: formData.get("productId"),
        locationId: formData.get("locationId"),
        countUnit: setupCountUnit === "__custom__" ? setupCustomUnit : setupCountUnit,
        safetyStock: formData.get("safetyStock")
      }, "在庫確認の商品を追加しました。");
      form.reset();
      setShowSetup(false);
      setSetupProductId(""); setSetupCountUnit(""); setSetupCustomUnit("");
      await loadInventory(storeId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "商品を追加できませんでした。");
    } finally {
      setIsSaving("");
    }
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storeId || isSaving) return;
    setIsSaving("location");
    try {
      await postInventory({
        action: "save_location",
        locationId: locationDraft.id,
        equipmentBrand: locationDraft.equipmentBrand,
        equipmentName: locationDraft.equipmentName,
        positionName: locationDraft.positionName,
        locationType: locationDraft.locationType
      }, locationDraft.id ? "保管場所を更新しました。" : "保管場所を追加しました。");
      setLocationDraft(emptyLocationDraft);
      await loadInventory(storeId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "保管場所を保存できませんでした。");
    } finally {
      setIsSaving("");
    }
  }

  async function archiveLocation(location: LocationOption) {
    if (isSaving) return;
    if (!window.confirm(`「${location.name}」を停止しますか？`)) return;
    setIsSaving(`location-${location.id}`);
    try {
      await postInventory({
        action: "archive_location",
        locationId: location.id
      }, "保管場所を停止しました。");
      if (locationDraft.id === location.id) setLocationDraft(emptyLocationDraft);
      if (locationFilter === location.id) setLocationFilter("all");
      await loadInventory(storeId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "保管場所を停止できませんでした。");
    } finally {
      setIsSaving("");
    }
  }

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.items.filter((item) => {
      if (locationFilter !== "all" && item.locationId !== locationFilter) return false;
      if (!keyword) return true;
      return `${item.productName} ${item.category} ${item.locationName}`.toLowerCase().includes(keyword);
    });
  }, [data.items, locationFilter, query]);

  const summary = useMemo(() => ({
    needsOrder: data.items.filter(inventoryItemNeedsOrder).length,
    needsCheck: data.items.filter((item) => inventoryMode === "quick" ? !item.quickCheck || item.quickCheck.state !== "fresh" : item.confidenceLabel !== "確認済み" || item.conversionChanged).length,
    exceptions: data.items.filter((item) => ["too_much", "damaged", "quality"].includes(item.exceptionCode)).length
  }), [data.items, inventoryMode]);

  return (
    <main className="shell inventory-page">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user"><UserBadge /></div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar inventory-topbar">
          <div>
            <p className="eyebrow">正確さより、欠品を早く見つける</p>
            <h2>在庫確認</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="inventory-topbar-actions">
            <label>
              <span>店舗</span>
              <select
                value={storeId}
                disabled={isLoading || Boolean(isSaving)}
                onChange={(event) => {
                  const nextStoreId = event.target.value;
                  setStoreId(nextStoreId);
                  setLocationFilter("all");
                  setLocationDraft(emptyLocationDraft);
                  setReceiptsOpen(false); setQuickSaveError(""); setCountDrafts({}); setCountSaveError("");
                  const url = new URL(window.location.href);
                  url.searchParams.set("storeId", nextStoreId);
                  window.history.replaceState(window.history.state, "", url);
                  void loadInventory(nextStoreId);
                }}
              >
                {storeId && !data.stores.some((store) => store.id === storeId) ? <option value={storeId} disabled>{t("選択してください")}</option> : null}
                {data.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => setShowLocationSettings((current) => !current)}>
              <Settings2 size={17} />
              保管場所設定
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (data.locations.length === 0) {
                  setShowLocationSettings(true);
                  return;
                }
                setShowSetup((current) => !current);
              }}
            >
              <PackagePlus size={17} />
              商品を追加
            </button>
          </div>
        </header>

        <div className="inventory-content">
          {inventoryMode === "precise" ? <p className="inventory-unit-summary" data-i18n-ignore>{stockLabels.bookNotice}</p> : null}
          {loadError ? <p className="inline-alert" role="alert">{t(loadError)}</p> : null}
          <div className="inventory-mode-switch" role="group" aria-label={t("在庫確認の方法")} data-i18n-ignore>
            <button type="button" aria-pressed={inventoryMode === "quick"} className={inventoryMode === "quick" ? "is-active" : ""} onClick={() => changeMode("quick")}><CheckCircle2 size={16} />{t("かんたん確認")}</button>
            <button type="button" aria-pressed={inventoryMode === "precise"} className={inventoryMode === "precise" ? "is-active" : ""} onClick={() => changeMode("precise")}><ClipboardList size={16} />{t("数量で棚卸")}</button>
          </div>
          {inventoryMode === "quick" ? <p className="inventory-unit-notice" data-i18n-ignore>{t("日常は目視で十分です。数えるのは、必要なときだけ。正確な数量と目安は分けて残します。")}</p> : null}
          {!loadError && storeId ? <details className="panel inventory-receipts-fold" open={receiptsOpen} onToggle={event => setReceiptsOpen(event.currentTarget.open)} data-i18n-ignore><summary><PackagePlus size={17} />{t("到着した商品を入庫する")}</summary>{receiptsOpen ? <StockReceiptPanel storeId={storeId} onRecorded={() => void reloadIfCurrentStore(storeId)} /> : null}</details> : null}
          {!loadError && storeId ? <InventoryUsagePanel storeId={storeId} refreshKey={replenishmentRefreshKey} onChanged={() => void reloadIfCurrentStore(storeId)} /> : null}
          {!loadError && storeId ? <ManufacturingPanel storeId={storeId} refreshKey={replenishmentRefreshKey} onChanged={() => void reloadIfCurrentStore(storeId)} /> : null}
          {countSaveError ? <p role="alert" data-i18n-ignore>{t(countSaveError)}</p> : null}
          {!loadError && storeId ? <ReplenishmentPanel storeId={storeId} refreshKey={replenishmentRefreshKey} open={replenishmentOpen} onOpenChange={setReplenishmentOpen} /> : null}
          <section className="inventory-summary" aria-label="在庫状況">
            <article>
              <span>発注を確認</span>
              <strong>{summary.needsOrder}</strong>
              <small>{t("安全在庫以下・不足の報告")}</small>
            </article>
            <article>
              <span>現場確認が必要</span>
              <strong>{summary.needsCheck}</strong>
              <small data-i18n-ignore>{t(inventoryMode === "quick" ? "未目視・もう一度確認" : "未確認・古い記録")}</small>
            </article>
            <article>
              <span>その他の異常</span>
              <strong>{summary.exceptions}</strong>
              <small>破損・品質・過剰</small>
            </article>
          </section>

          {showLocationSettings ? (
            <section className="panel inventory-location-settings">
              <div className="panel-title">
                <div>
                  <h3>店舗の保管場所設定</h3>
                  <p>設備・収納と、その中の区画や位置を先に登録します。</p>
                </div>
              </div>
              <form className="inventory-location-form" onSubmit={saveLocation}>
                <label>
                  <span>設備ブランド</span>
                  <input
                    value={locationDraft.equipmentBrand}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, equipmentBrand: event.target.value }))}
                    placeholder="例：HOSHIZAKI（ブランドなしは空欄）"
                  />
                </label>
                <label>
                  <span>設備名・収納名</span>
                  <input
                    value={locationDraft.equipmentName}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, equipmentName: event.target.value }))}
                    placeholder="例：立式冷凍冷蔵庫、吊戸棚"
                    required
                  />
                </label>
                <label>
                  <span>区画・位置</span>
                  <input
                    value={locationDraft.positionName}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, positionName: event.target.value }))}
                    placeholder="例：冷蔵1、冷凍2、1左"
                    required
                  />
                </label>
                <label>
                  <span>保管区分</span>
                  <select
                    value={locationDraft.locationType}
                    onChange={(event) => setLocationDraft((current) => ({ ...current, locationType: event.target.value }))}
                  >
                    {Object.entries(locationTypeLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <div className="inventory-location-form-actions">
                  {locationDraft.id ? (
                    <button className="secondary-button" type="button" onClick={() => setLocationDraft(emptyLocationDraft)}>
                      キャンセル
                    </button>
                  ) : null}
                  <button className="primary-button" type="submit" disabled={isSaving === "location"}>
                    {isSaving === "location" ? "保存中..." : locationDraft.id ? "変更を保存" : "場所を追加"}
                  </button>
                </div>
              </form>
              <div className="inventory-location-list">
                {data.locations.length === 0 ? <p>この店舗には保管場所がまだありません。</p> : null}
                {data.locations.map((location) => (
                  <article key={location.id}>
                    <div>
                      {location.equipmentBrand ? <span className="inventory-equipment-brand">{location.equipmentBrand}</span> : null}
                      <strong>{location.equipmentName}</strong>
                      <span>{location.positionName}</span>
                    </div>
                    <span className={`inventory-location-type is-${location.locationType}`}>
                      {locationTypeLabels[location.locationType] ?? "その他"}
                    </span>
                    <div>
                      <button
                        type="button"
                        onClick={() => setLocationDraft({
                          id: location.id,
                          equipmentBrand: location.equipmentBrand,
                          equipmentName: location.equipmentName,
                          positionName: location.positionName,
                          locationType: location.locationType
                        })}
                      >
                        <Pencil size={14} />
                        編集
                      </button>
                      <button
                        className="is-danger"
                        type="button"
                        disabled={isSaving === `location-${location.id}`}
                        onClick={() => void archiveLocation(location)}
                      >
                        <Archive size={14} />
                        停止
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {showSetup ? (
            <form className="panel inventory-setup" onSubmit={addInventoryItem}>
              <div className="panel-title">
                <div>
                  <h3>在庫確認に商品を追加</h3>
                  <p>商品、保存済みの保管場所、数える単位、安全在庫を設定します。</p>
                </div>
              </div>
              <p className="inventory-unit-notice" data-i18n-ignore>{t("棚卸単位を変更すると、記録数量の再確認が必要です。安全在庫も選択した単位で設定してください。")}</p>
              <div className="inventory-setup-grid">
                <label>
                  <span>商品</span>
                  <select name="productId" required value={setupProductId} onChange={event => {
                    const next = data.products.find(product => product.id === event.target.value);
                    setSetupProductId(event.target.value); setSetupCountUnit(next?.unit ?? ""); setSetupCustomUnit("");
                  }}>
                    <option value="">商品を選択</option>
                    {data.products.map((product) => (
                      <option value={product.id} key={product.id}>{product.category}｜{product.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>保管場所</span>
                  <select name="locationId" defaultValue="" required>
                    <option value="">保管場所を選択</option>
                    {data.locations.map((location) => (
                      <option value={location.id} key={location.id}>
                        {[location.equipmentBrand, location.equipmentName].filter(Boolean).join(" ")}｜{location.positionName}（{locationTypeLabels[location.locationType] ?? "その他"}）
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>数える単位</span>
                  <select name="countUnit" value={setupCountUnit} disabled={!setupProductId} required onChange={event => setSetupCountUnit(event.target.value)}>
                    <option value="">{t("棚卸単位を選択")}</option>
                    {setupUnitChoices.map(choice => <option value={choice.countUnit} key={choice.countUnit}>{choice.countUnit}</option>)}
                    <option value="__custom__">{t("その他（換算未設定）")}</option>
                  </select>
                  {setupCountUnit === "__custom__" ? <input value={setupCustomUnit} maxLength={40} required placeholder={t("棚卸単位を入力")} onChange={event => setSetupCustomUnit(event.target.value)} /> : null}
                  <small data-i18n-ignore>{setupConversion ? t("1 {purchaseUnit} = {quantity} {countUnit}", {purchaseUnit:setupConversion.purchaseUnit,quantity:formatQuantity(setupConversion.unitsPerPurchase) + (setupConversion.countUnit.startsWith("1/") ? " ×" : ""),countUnit:setupConversion.countUnit}) : setupProductId ? t("購入単位との換算は未設定です。") : ""}</small>
                </label>
                <label>
                  <span>安全在庫</span>
                  <input name="safetyStock" type="number" min="0" step="0.000001" defaultValue="1" inputMode="decimal" />
                </label>
                <button className="primary-button" type="submit" disabled={isSaving === "setup"}>
                  {isSaving === "setup" ? "追加中..." : "追加する"}
                </button>
              </div>
            </form>
          ) : null}

          <section className="inventory-toolbar">
            <div className="inventory-location-tabs">
              <button type="button" className={locationFilter === "all" ? "is-active" : ""} onClick={() => setLocationFilter("all")}>
                すべて
              </button>
              {data.locations.map((location) => (
                <button
                  type="button"
                  className={locationFilter === location.id ? "is-active" : ""}
                  onClick={() => setLocationFilter(location.id)}
                  key={location.id}
                >
                  {location.name}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input value={query} placeholder="商品・場所を検索" onChange={(event) => setQuery(event.target.value)} />
            </label>
          </section>

          {quickSaveError ? <p className="inline-alert" role="alert" data-i18n-ignore>{t(quickSaveError)}</p> : null}
          {inventoryMode === "quick" && filteredItems.length > 0 ? <QuickInventoryList key={storeId} storeId={storeId} items={filteredItems} saving={Boolean(isSaving)} onSave={recordQuickChecks} /> : null}
          {filteredItems.length === 0 ? (
            <section className="panel inventory-empty">
              <PackageSearch size={30} />
              <h3>{data.items.length === 0 ? "在庫確認の商品はまだありません" : "条件に合う商品がありません"}</h3>
              <p>{data.items.length === 0 ? "「商品を追加」から、まず冷凍庫にある主要商品を登録してください。" : "保管場所または検索条件を変更してください。"}</p>
              {data.items.length === 0 ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    if (data.locations.length === 0) {
                      setShowLocationSettings(true);
                      return;
                    }
                    setShowSetup(true);
                  }}
                >
                  <PackagePlus size={17} />
                  商品を追加
                </button>
              ) : null}
            </section>
          ) : inventoryMode === "precise" ? (
            <section className="inventory-list">
              {filteredItems.map((item) => {
                const needsOrder = inventoryItemNeedsOrder(item);
                const hasOtherException = ["too_much", "damaged", "quality"].includes(item.exceptionCode);
                return (
                  <article className={`inventory-item${needsOrder ? " is-low" : ""}${hasOtherException ? " has-exception" : ""}`} key={item.id}>
                    <div className="inventory-item-heading">
                      <div>
                        <div className="inventory-item-title">
                          <strong>{item.productName}</strong>
                          {needsOrder ? <span className="inventory-status is-warning">発注確認</span> : null}
                          {hasOtherException ? <span className="inventory-status is-danger">{exceptionLabels[item.exceptionCode]}</span> : null}
                        </div>
                        <span>{item.locationName} ・ 安全在庫 {formatCountWithUnit(item.safetyStock, item.countUnit)}</span>
                      </div>
                      <div className="inventory-current" style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "55%", overflowWrap: "anywhere", textAlign: "right" }}>
                        <small data-i18n-ignore>{item.stockRevision === 0 ? t("元の記録数量") : stockLabels.currentStock}</small>
                        <strong>{item.currentQuantity === null ? "未確認" : formatCountWithUnit(item.currentQuantity, item.countUnit)}</strong>
                        <span className={item.confidenceLabel === "確認済み" ? "is-fresh" : ""}>
                          {t(item.confidenceLabel)}
                        </span>
                        {item.lastCountedLabel ? <span>{t("最終実数確認")} {item.lastCountedLabel} {item.lastCountedBy}</span> : null}
                        <span data-i18n-ignore>{item.stockRevision === 0 ? t("元の記録数量") : stockLabels.lastCountedQuantity} {item.lastCountedQuantity === null || item.lastCountedQuantity === undefined ? t("未確認") : formatCountWithUnit(item.lastCountedQuantity, item.countUnit)}</span>
                        {item.stockRevision === 0 ? <span data-i18n-ignore>{t("入庫の前に実数を棚卸で確認してください。")}</span> : null}
                        {item.lastReceivedAt ? <span data-i18n-ignore>{stockLabels.lastReceipt} {formatStockTimestamp(item.lastReceivedAt)}</span> : null}
                      </div>
                    </div>

                    <div className="inventory-unit-summary" data-i18n-ignore>
                      <span>{item.currentConversion ? t("1 {purchaseUnit} = {quantity} {countUnit}", { purchaseUnit: item.currentConversion.purchaseUnit, quantity: formatQuantity(item.currentConversion.unitsPerPurchase) + (item.currentConversion.countUnit.startsWith("1/") ? " ×" : ""), countUnit: item.currentConversion.countUnit }) : t("購入単位との換算は未設定です。")}</span>
                      {item.purchaseEquivalent ? <small>{t("記録時の購入単位換算：約 {quantity} {unit}", { quantity: formatEquivalentQuantity(item.purchaseEquivalent.quantity), unit: item.purchaseEquivalent.unit })}</small> : null}
                      {item.conversionChanged ? <small className="inventory-unit-warning">{t("換算設定が変更されています。数量を再確認してください。")}</small> : null}
                    </div>

                    <div className="inventory-quantity-row" aria-label={`${item.productName}の在庫量`}>
                      {quantityOptions.map((option) => (
                        <button
                          type="button"
                          className={item.currentQuantity === option.value ? "is-selected" : ""}
                          disabled={isSaving === item.id}
                          onClick={() => void recordCount(item, option.value)}
                          key={option.value}
                        >
                          <strong>{option.label}</strong>
                          <small>{item.countUnit}</small>
                        </button>
                      ))}
                    </div>

                    <form className="inventory-exception-row" onSubmit={(event) => void recordExactCount(event, item)}>
                      <label style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
                        <span>{t("実数入力")}</span>
                        <input
                          name="quantity"
                          value={countDrafts[item.id] ?? ""}
                          onChange={event => setCountDrafts(current => ({...current,[item.id]:event.target.value}))}
                          type="text"
                          inputMode="decimal"
                          placeholder={t("例：3、0.5、1/4")}
                          maxLength={30}
                          aria-label={`${item.productName} ${t("在庫量")}`}
                          disabled={isSaving === item.id}
                          required
                          style={{ width: 112, maxWidth: "100%" }}
                        />
                        <select name="inputUnit" aria-label={t("入力単位")} value={countInputUnits[item.id]??item.countUnit} disabled={isSaving===item.id} onChange={event=>setCountInputUnits(current=>({...current,[item.id]:event.target.value}))}>
                          {[...new Set([item.countUnit,...(item.unitChoices??[]).map(choice=>choice.countUnit)])].map(unit=><option key={unit} value={unit}>{unit}</option>)}
                        </select>
                      </label>
                      <button className="secondary-button" type="submit" disabled={Boolean(isSaving)}>{t("数えて保存")}</button>
                    </form>
                    {countDrafts[item.id] ? <small data-i18n-ignore>{countDraftPreview(item,countDrafts[item.id],countInputUnits[item.id]??item.countUnit,t)}</small> : null}

                    <div className="inventory-exception-row">
                      <span>見つけたことを記録</span>
                      <div>
                        {Object.entries(exceptionLabels).map(([code, label]) => (
                          <button
                            type="button"
                            className={item.exceptionCode === code ? "is-selected" : ""}
                            disabled={isSaving === item.id}
                            onClick={() => void recordException(item, code)}
                            key={code}
                          >
                            {code === "damaged" || code === "quality" ? <AlertTriangle size={14} /> : null}
                            {label}
                          </button>
                        ))}
                        {item.exceptionCode ? (
                          <button type="button" disabled={isSaving === item.id} onClick={() => void recordException(item, "")}>
                            <CheckCircle2 size={14} />
                            解消
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}

          {data.recentChecks.length > 0 ? (
            <details className="panel inventory-history">
              <summary>最近の記録を見る</summary>
              <div>
                {data.recentChecks.map((check) => (
                  <article key={check.id}>
                    <span>{check.createdLabel}</span>
                    <strong>{check.productName}</strong>
                    <span>{check.locationName}</span>
                    <span>
                      {check.recordType === "quick_check" ? t(({ enough: "足りる", low: "残りわずか", out: "ない" } as Record<string, string>)[check.quickStatus ?? ""] ?? "目視確認") : check.recordType === "exception"
                        ? exceptionLabels[check.exceptionCode] ?? "異常解消"
                        : check.quantity === null
                          ? t("未確認")
                          : formatCountWithUnit(check.quantity, check.countUnit || `（${t("単位未記録")}）`)}
                    </span>
                    {check.recordType === "quick_check" ? <small data-i18n-ignore>{t("目視（実数棚卸ではありません）")}{check.quickEstimate ? " · " + (check.quickEstimate.kind === "small" ? t("少量（目安）") : t("約 {quantity} {unit}（目安）", { quantity: check.quickEstimate.quantity ?? "", unit: check.quickEstimate.purchaseUnit ?? "" })) : ""}</small> : check.purchaseEquivalent ? <small data-i18n-ignore>{t("記録時の購入単位換算：約 {quantity} {unit}", { quantity: formatEquivalentQuantity(check.purchaseEquivalent.quantity), unit: check.purchaseEquivalent.unit })}</small> : null}
                    {check.reconciliation ? <small data-i18n-ignore>{check.reconciliation.difference === null ? t("今回の実数を新しい起点にしました。") : t("帳簿との差異：{difference} {unit}（原因は要確認）",{difference:formatQuantity(check.reconciliation.difference),unit:check.countUnit})}</small> : null}
                    <small>{check.recordedBy}</small>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function formatQuantity(value: number) {
  value = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function inventoryItemNeedsOrder(item: InventoryItem) {
  return item.effectiveStockStatus !== undefined ? item.effectiveStockStatus !== "available" : inventoryNeedsOrder(item);
}

function formatEquivalentQuantity(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumSignificantDigits: 8 }).format(value);
}

function formatCountWithUnit(value: number, unit: string) {
  return `${formatQuantity(value)}${unit.startsWith("1/") ? " × " : " "}${unit}`;
}

function stockLabelsForLanguage(language: string) {
  if (language === "zh-Hans") return {
    currentStock: "当前库存", lastCountedQuantity: "最近清点数量", lastReceipt: "最近入库",
    bookNotice: "账面库存由清点、入库及已启用的订单和制作联动计算；预测用量单独展示。",
    stockChanged: "库存或单位设置已被入库、其他清点等操作更新。请查看最新数据并重新确认数量。"
  };
  if (language === "zh-Hant") return {
    currentStock: "目前庫存", lastCountedQuantity: "最近清點數量", lastReceipt: "最近入庫",
    bookNotice: "帳面庫存由清點、入庫及已啟用的訂單和製作聯動計算；預測用量另行顯示。",
    stockChanged: "庫存或單位設定已被入庫、其他清點等操作更新。請查看最新資料並重新確認數量。"
  };
  return {
    currentStock: "現在庫", lastCountedQuantity: "最終棚卸数量", lastReceipt: "最終入庫",
    bookNotice: "帳簿在庫は棚卸・入庫と、有効な注文・製造連動から計算します。予測使用量は別に表示します。",
    stockChanged: "入庫・別の棚卸・単位設定などで在庫が更新されています。最新の情報を確認して数量を再確認してください。"
  };
}

function formatStockTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function countDraftPreview(item:InventoryItem,value:string,inputUnit:string,t:(key:string,params?:Record<string,string|number>)=>string) {
  try {
    const target=item.currentConversion;const choices=item.unitChoices??[];
    const product={unit:target?.purchaseUnit??item.countUnit,inventoryUnitConversions:choices.map(choice=>({unit:choice.countUnit,unitsPerPurchase:choice.unitsPerPurchase,...(/^1\/(\d+)/.test(choice.countUnit)?{fractionalDenominator:Number(choice.countUnit.match(/^1\/(\d+)/)?.[1])}:{})}))};
    const entered=normalizeInventoryCountInput(value,inputUnit,item.countUnit,product);
    if(item.currentQuantity===null)return t("棚卸単位に換算：{quantity} {unit}",{quantity:formatQuantity(entered.quantity),unit:item.countUnit});
    return t("帳簿残量 {expected} / 実数 {observed} / 差異 {difference} {unit}",{expected:formatQuantity(item.currentQuantity),observed:formatQuantity(entered.quantity),difference:formatQuantity(entered.quantity-item.currentQuantity),unit:item.countUnit});
  } catch { return t("入力単位と棚卸単位の対応を商品設定で確認してください。"); }
}
