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
import { useEffect, useMemo, useState } from "react";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList, type OsNavItem } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type StoreOption = { id: string; name: string };
type LocationOption = {
  id: string;
  name: string;
  equipmentBrand: string;
  equipmentName: string;
  positionName: string;
  locationType: string;
};
type ProductOption = { id: string; name: string; category: string; unit: string; storageType: string };
type InventoryItem = {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  category: string;
  locationId: string;
  locationName: string;
  countUnit: string;
  safetyStock: number;
  currentQuantity: number | null;
  exceptionCode: string;
  exceptionNote: string;
  lastCountedAt: string | null;
  lastCountedBy: string;
  confidenceLabel: string;
  lastCountedLabel: string;
};
type RecentCheck = {
  id: string;
  productName: string;
  locationName: string;
  quantity: number | null;
  countUnit: string;
  recordType: string;
  exceptionCode: string;
  note: string;
  recordedBy: string;
  createdLabel: string;
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
  { value: 0.5, label: "半分" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 5, label: "5以上" }
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
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [data, setData] = useState<InventoryPayload>({
    stores: [],
    locations: [],
    products: [],
    items: [],
    recentChecks: []
  });
  const [storeId, setStoreId] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [showLocationSettings, setShowLocationSettings] = useState(false);
  const [locationDraft, setLocationDraft] = useState(emptyLocationDraft);

  useEffect(() => {
    void loadInventory();
  }, []);

  async function loadInventory(nextStoreId?: string) {
    setIsLoading(true);
    const targetStoreId = nextStoreId ?? storeId;
    const response = await fetch(`/api/inventory${targetStoreId ? `?storeId=${encodeURIComponent(targetStoreId)}` : ""}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "在庫情報を読み込めませんでした。");
      setIsLoading(false);
      return;
    }
    const payload = await response.json() as InventoryPayload;
    setData(payload);
    setStoreId(payload.selectedStoreId ?? nextStoreId ?? "");
    setIsLoading(false);
  }

  async function postInventory(body: Record<string, unknown>, successMessage: string) {
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, storeId })
    });
    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(responseBody.error ?? "在庫情報を保存できませんでした。");
    }
    showNotice(successMessage);
  }

  async function recordCount(item: InventoryItem, quantity: number) {
    if (isSaving) return;
    const previous = data.items;
    const exceptionCode = quantity === 0 ? "out" : quantity <= item.safetyStock ? "low" : "";
    setData((current) => ({
      ...current,
      items: current.items.map((candidate) => candidate.id === item.id
        ? {
            ...candidate,
            currentQuantity: quantity,
            exceptionCode,
            exceptionNote: "",
            confidenceLabel: "確認済み",
            lastCountedLabel: "たった今"
          }
        : candidate)
    }));
    setIsSaving(item.id);
    try {
      await postInventory({ action: "count", itemId: item.id, quantity }, `${item.productName}の在庫を記録しました。`);
      await loadInventory(storeId);
    } catch (error) {
      setData((current) => ({ ...current, items: previous }));
      window.alert(error instanceof Error ? error.message : "在庫情報を保存できませんでした。");
    } finally {
      setIsSaving("");
    }
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
        countUnit: formData.get("countUnit"),
        safetyStock: formData.get("safetyStock")
      }, "在庫確認の商品を追加しました。");
      form.reset();
      setShowSetup(false);
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
    needsOrder: data.items.filter((item) => item.currentQuantity !== null && item.currentQuantity <= item.safetyStock).length,
    needsCheck: data.items.filter((item) => item.confidenceLabel !== "確認済み").length,
    exceptions: data.items.filter((item) => ["too_much", "damaged", "quality"].includes(item.exceptionCode)).length
  }), [data.items]);

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
                disabled={isLoading}
                onChange={(event) => {
                  const nextStoreId = event.target.value;
                  setStoreId(nextStoreId);
                  setLocationFilter("all");
                  setLocationDraft(emptyLocationDraft);
                  void loadInventory(nextStoreId);
                }}
              >
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
          <section className="inventory-summary" aria-label="在庫状況">
            <article>
              <span>発注を確認</span>
              <strong>{summary.needsOrder}</strong>
              <small>安全在庫以下</small>
            </article>
            <article>
              <span>現場確認が必要</span>
              <strong>{summary.needsCheck}</strong>
              <small>未確認・古い記録</small>
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
              <div className="inventory-setup-grid">
                <label>
                  <span>商品</span>
                  <select name="productId" required defaultValue="">
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
                  <input name="countUnit" defaultValue="袋" placeholder="袋・箱・本・パック" />
                </label>
                <label>
                  <span>安全在庫</span>
                  <input name="safetyStock" type="number" min="0" step="0.5" defaultValue="1" inputMode="decimal" />
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

          {filteredItems.length === 0 ? (
            <section className="panel inventory-empty">
              <PackageSearch size={30} />
              <h3>{data.items.length === 0 ? "在庫確認の商品はまだありません" : "条件に合う商品がありません"}</h3>
              <p>{data.items.length === 0 ? "「商品を追加」から、まず冷凍庫にある主要商品を登録してください。" : "保管場所または検索条件を変更してください。"}</p>
            </section>
          ) : (
            <section className="inventory-list">
              {filteredItems.map((item) => {
                const needsOrder = item.currentQuantity !== null && item.currentQuantity <= item.safetyStock;
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
                        <span>{item.locationName} ・ 安全在庫 {formatQuantity(item.safetyStock)}{item.countUnit}</span>
                      </div>
                      <div className="inventory-current">
                        <small>現在</small>
                        <strong>{item.currentQuantity === null ? "未確認" : `${formatQuantity(item.currentQuantity)}${item.countUnit}`}</strong>
                        <span className={item.confidenceLabel === "確認済み" ? "is-fresh" : ""}>
                          {item.lastCountedLabel ? `${item.lastCountedLabel} ${item.lastCountedBy}` : item.confidenceLabel}
                        </span>
                      </div>
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
          )}

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
                      {check.recordType === "exception"
                        ? exceptionLabels[check.exceptionCode] ?? "異常解消"
                        : `${formatQuantity(check.quantity ?? 0)}${check.countUnit}`}
                    </span>
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
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}
