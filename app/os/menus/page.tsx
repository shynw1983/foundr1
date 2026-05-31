"use client";

import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Lightbulb,
  LogOut,
  MenuSquare,
  PackageCheck,
  Plus,
  Save,
  Search,
  Store,
  Trash2,
  Truck,
  Upload,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type OptionItem = {
  id: string;
  name: string;
};

type StoreOption = OptionItem & {
  brandIds: string[];
};

type MenuSource = {
  id: string;
  brandId: string;
  storeId: string;
  name: string;
  sourceType: string;
  sourceUrl: string;
  status: string;
};

type MenuItem = {
  id: string;
  brandId: string;
  storeId: string;
  menuSourceId: string;
  externalId: string;
  itemKind: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
  isActive: boolean;
};

type MenuGroup = {
  id: string;
  brandId: string;
  menuCatalogItemId: string;
  externalId: string;
  groupKey: string;
  name: string;
  selectionType: string;
  affectsProcedure: boolean;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
};

type MenuOption = {
  id: string;
  optionGroupId: string;
  externalId: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
  affectsProcedure: boolean;
  sortOrder: number;
  isActive: boolean;
};

type MenuAdminData = {
  brands: OptionItem[];
  stores: StoreOption[];
  sources: MenuSource[];
  items: MenuItem[];
  groups: MenuGroup[];
  options: MenuOption[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const emptyItem: MenuItem = {
  id: "",
  brandId: "",
  storeId: "",
  menuSourceId: "",
  externalId: "",
  itemKind: "fixed_product",
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  basePrice: null,
  variableSchema: {},
  isActive: true
};

const emptyGroup: MenuGroup = {
  id: "",
  brandId: "",
  menuCatalogItemId: "",
  externalId: "",
  groupKey: "",
  name: "",
  selectionType: "single",
  affectsProcedure: true,
  ruleJson: {},
  sortOrder: 100,
  isActive: true
};

const emptyOption: MenuOption = {
  id: "",
  optionGroupId: "",
  externalId: "",
  optionKey: "",
  name: "",
  priceDelta: null,
  affectsProcedure: true,
  sortOrder: 100,
  isActive: true
};

const itemKindOptions = [
  { value: "fixed_product", label: "通常商品" },
  { value: "buildable_product", label: "組み立て商品" },
  { value: "modifier", label: "追加・変更" },
  { value: "option", label: "単独オプション" }
];

const selectionTypeOptions = [
  { value: "single", label: "1つ選ぶ" },
  { value: "multiple", label: "複数選べる" },
  { value: "quantity", label: "数量で選ぶ" }
];

const schemaRuleKeys: Record<string, string> = {
  size: "allowedSizes",
  temperature: "temperatures",
  sweetness: "allowedSweetness",
  ice: "allowedIce",
  option: "allowedOptions",
  topping: "allowedToppings"
};

function cloneItem(item: MenuItem): MenuItem {
  return JSON.parse(JSON.stringify(item)) as MenuItem;
}

function getLabel(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function getBrandName(brands: OptionItem[], id: string) {
  return brands.find((brand) => brand.id === id)?.name ?? "";
}

function getRuleKey(groupKey: string) {
  return schemaRuleKeys[groupKey] ?? `allowed_${groupKey}`;
}

function getOptionKey(option: MenuOption) {
  return option.optionKey || option.externalId || option.id;
}

function getAllowedKeys(item: MenuItem, group: MenuGroup, options: MenuOption[]) {
  const ruleKey = getRuleKey(group.groupKey);
  const rawValue = item.variableSchema?.[ruleKey];
  if (Array.isArray(rawValue)) return new Set(rawValue.map(String));
  return new Set(options.map(getOptionKey));
}

function groupUsesFallbackAll(group: MenuGroup) {
  return group.ruleJson?.defaultBehavior === "all_when_missing_or_empty";
}

function buildPublicMenuUrl(brandId: string, storeId: string) {
  const params = new URLSearchParams();
  if (brandId) params.set("brand", brandId);
  if (storeId) params.set("store", storeId);
  return `/api/public/menus${params.size ? `?${params.toString()}` : ""}`;
}

function getCategoryCounts(items: MenuItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const category = item.category || "未分類";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export default function MenuAdminPage() {
  const [data, setData] = useState<MenuAdminData>({
    brands: [],
    stores: [],
    sources: [],
    items: [],
    groups: [],
    options: []
  });
  const [activeBrandId, setActiveBrandId] = useState("");
  const [activeStoreId, setActiveStoreId] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemDraft, setItemDraft] = useState<MenuItem>(emptyItem);
  const [groupDraft, setGroupDraft] = useState<MenuGroup>(emptyGroup);
  const [optionDraft, setOptionDraft] = useState<MenuOption>(emptyOption);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const [savingKind, setSavingKind] = useState<"item" | "group" | "option" | "">("");

  async function loadMenus(nextSelectedItemId = selectedItemId) {
    setLoading(true);
    const response = await fetch("/api/menus");
    if (!response.ok) {
      setMessage("メニュー情報を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const nextData = await response.json() as MenuAdminData;
    const nextBrandId = activeBrandId || nextData.brands[0]?.id || "";
    const brandItems = nextData.items.filter((item) => item.brandId === nextBrandId);
    const nextItem = brandItems.find((item) => item.id === nextSelectedItemId) ?? brandItems[0];

    setData(nextData);
    setActiveBrandId(nextBrandId);
    setSelectedItemId(nextItem?.id ?? "");
    setItemDraft(nextItem ? cloneItem(nextItem) : { ...emptyItem, brandId: nextBrandId, storeId: activeStoreId });
    setActiveCategory((current) => current ?? nextItem?.category ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void loadMenus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleStores = useMemo(() => {
    if (!activeBrandId) return data.stores;
    return data.stores.filter((store) => store.brandIds.includes(activeBrandId));
  }, [activeBrandId, data.stores]);

  const filteredItems = useMemo(() => data.items.filter((item) => {
    if (activeBrandId && item.brandId !== activeBrandId) return false;
    if (activeStoreId && item.storeId && item.storeId !== activeStoreId) return false;
    return true;
  }), [activeBrandId, activeStoreId, data.items]);

  const categoryCounts = useMemo(() => getCategoryCounts(filteredItems), [filteredItems]);
  const currentCategory = activeCategory;
  const categoryItems = useMemo(() => filteredItems.filter((item) => {
    if (currentCategory === null) return true;
    return (item.category || "未分類") === currentCategory;
  }), [currentCategory, filteredItems]);

  const selectedSource = data.sources.find((source) => source.id === itemDraft.menuSourceId);
  const publicMenuUrl = buildPublicMenuUrl(activeBrandId, activeStoreId);

  const visibleGroups = useMemo(() => data.groups.filter((group) => {
    if (!activeBrandId || group.brandId !== activeBrandId) return false;
    return !group.menuCatalogItemId || group.menuCatalogItemId === itemDraft.id;
  }), [activeBrandId, data.groups, itemDraft.id]);

  function selectBrand(brandId: string) {
    const brandItems = data.items.filter((item) => item.brandId === brandId);
    const nextItem = brandItems[0];
    setActiveBrandId(brandId);
    setActiveStoreId("");
    setActiveCategory(nextItem?.category || null);
    setSelectedItemId(nextItem?.id ?? "");
    setItemDraft(nextItem ? cloneItem(nextItem) : { ...emptyItem, brandId });
    setGroupDraft({ ...emptyGroup, brandId });
    setOptionDraft(emptyOption);
  }

  function selectItem(item: MenuItem) {
    setSelectedItemId(item.id);
    setActiveCategory(item.category || "未分類");
    setItemDraft(cloneItem(item));
    setGroupDraft({ ...emptyGroup, brandId: item.brandId, menuCatalogItemId: item.id });
    setOptionDraft(emptyOption);
  }

  function startNewItem() {
    const categoryForNewItem = currentCategory === null ? "" : currentCategory;
    const nextItem = {
      ...emptyItem,
      brandId: activeBrandId,
      storeId: activeStoreId,
      category: categoryForNewItem === "未分類" ? "" : categoryForNewItem
    };
    setSelectedItemId("");
    setActiveCategory(null);
    setItemDraft(nextItem);
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId });
    setOptionDraft(emptyOption);
    setMessage("新しい商品を入力できます。");
  }

  async function save(kind: "item" | "group" | "option", payload: Record<string, unknown>) {
    setMessage("");
    setSavingKind(kind);
    try {
      const response = await fetch("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...payload })
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok) {
        setMessage(result.error || "保存できませんでした。");
        return;
      }

      setMessage("保存しました。");
      if (kind === "item") {
        await loadMenus(result.id || itemDraft.id);
        return;
      }
      if (kind === "group") setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: itemDraft.id });
      if (kind === "option") setOptionDraft(emptyOption);
      await loadMenus(itemDraft.id);
    } catch {
      setMessage("通信エラーで保存できませんでした。");
    } finally {
      setSavingKind("");
    }
  }

  async function deleteEntry(kind: "item" | "group" | "option", id: string) {
    if (!confirm("削除しますか。")) return;
    const response = await fetch("/api/menus", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id })
    });
    if (!response.ok) {
      setMessage("削除できませんでした。関連データを確認してください。");
      return;
    }
    setMessage("削除しました。");
    await loadMenus("");
  }

  async function uploadMenuPhoto(file: File) {
    setPhotoStatus("写真を処理中...");
    setMessage("");
    const uploadFile = await prepareMenuPhoto(file);
    setPhotoStatus("アップロード中...");
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("itemName", itemDraft.name || "menu-item");

    try {
      const response = await fetch("/api/menus/photo", {
        method: "POST",
        body: formData
      });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        setPhotoStatus(result.error || "写真をアップロードできませんでした。");
        return;
      }

      setItemDraft((current) => ({ ...current, imageUrl: result.url ?? "" }));
      setPhotoStatus("アップロードしました。商品を保存すると公開メニューに反映されます。");
    } catch {
      setPhotoStatus("通信エラーで写真をアップロードできませんでした。");
      setMessage("写真をアップロードできませんでした。");
    }
  }

  async function prepareMenuPhoto(file: File) {
    if (!file.type.startsWith("image/") || file.type.includes("heic") || file.type.includes("heif")) return file;
    if (file.size <= 1.5 * 1024 * 1024) return file;

    try {
      const compressed = await compressImageFile(file);
      return compressed.size < file.size ? compressed : file;
    } catch {
      return file;
    }
  }

  async function compressImageFile(file: File) {
    const image = await loadImageForCompression(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.72, 0.62]) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (blob.size <= 1.5 * 1024 * 1024 || quality === 0.62) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "menu-item"}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now()
        });
      }
    }

    return file;
  }

  function loadImageForCompression(file: File) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image load failed"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }

  function selectMenuPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setPhotoStatus("");
      setMessage("画像ファイルを選択してください。");
      return;
    }
    void uploadMenuPhoto(file);
  }

  function updateAllowedOption(group: MenuGroup, option: MenuOption, checked: boolean) {
    const groupOptions = data.options.filter((entry) => entry.optionGroupId === group.id);
    const currentAllowed = getAllowedKeys(itemDraft, group, groupOptions);
    const optionKey = getOptionKey(option);
    if (checked) currentAllowed.add(optionKey);
    else currentAllowed.delete(optionKey);

    if (!checked && groupUsesFallbackAll(group) && currentAllowed.size === 0) {
      setMessage("元サイトとの互換性のため、最後の選択肢は外せません。");
      return;
    }

    const ruleKey = getRuleKey(group.groupKey);
    const allKeys = groupOptions.map(getOptionKey);
    const normalizedAllowed = Array.from(currentAllowed);
    const nextSchema = {
      ...itemDraft.variableSchema,
      [ruleKey]: normalizedAllowed.length === allKeys.length && groupUsesFallbackAll(group)
        ? undefined
        : normalizedAllowed
    };
    if (nextSchema[ruleKey] === undefined) delete nextSchema[ruleKey];
    setItemDraft({ ...itemDraft, variableSchema: nextSchema });
  }

  function resetGroupDraftForItem() {
    setGroupDraft({ ...emptyGroup, brandId: activeBrandId, menuCatalogItemId: itemDraft.id });
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">F1</div>
          <div>
            <p>Foundr1 OS</p>
            <strong>メニュー管理</strong>
          </div>
        </div>
        <UserBadge />
        <MobileNavMenu navItems={navItems} />
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace menu-admin-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Menu Master</p>
            <h2>メニュー管理</h2>
            <p>分類、商品、サイズ・温度・辛さなどの選択肢を人が編集しやすい単位で管理します。</p>
          </div>
          <a className="secondary-button" href={publicMenuUrl} target="_blank" rel="noreferrer">
            公開 API を確認
          </a>
        </div>

        <section className="info-panel">
          <strong>編集の考え方</strong>
          <p>
            商品を先に選び、その商品に使える選択肢だけを調整します。取込元や内部キーは補助情報に下げ、
            日常編集では分類、商品名、価格、公開状態、選択可否だけを触れるようにしています。
          </p>
        </section>

        <div className="filter-bar">
          <label>
            <span>ブランド</span>
            <select value={activeBrandId} onChange={(event) => selectBrand(event.target.value)}>
              <option value="">選択</option>
              {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label>
            <span>店舗</span>
            <select value={activeStoreId} onChange={(event) => setActiveStoreId(event.target.value)}>
              <option value="">全店共通</option>
              {visibleStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
          </label>
          <code>{publicMenuUrl}</code>
        </div>

        {message ? <div className="inline-alert">{message}</div> : null}

        <div className="menu-editor-layout">
          <aside className="menu-category-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Categories</p>
                <h3>分類</h3>
              </div>
              <span className="status-pill">{filteredItems.length}件</span>
            </div>
            <button
              className={currentCategory === null ? "menu-category-button is-active" : "menu-category-button"}
              type="button"
              onClick={() => setActiveCategory(null)}
            >
              <span>すべて</span>
              <strong>{filteredItems.length}</strong>
            </button>
            {categoryCounts.map((category) => (
              <button
                className={currentCategory === category.name ? "menu-category-button is-active" : "menu-category-button"}
                type="button"
                onClick={() => setActiveCategory(category.name)}
                key={category.name}
              >
                <span>{category.name}</span>
                <strong>{category.count}</strong>
              </button>
            ))}
          </aside>

          <aside className="menu-item-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Items</p>
                <h3>商品</h3>
              </div>
              <button className="secondary-button" type="button" onClick={startNewItem}>
                <Plus size={16} />
                商品追加
              </button>
            </div>
            <div className="menu-item-list">
              {categoryItems.map((item) => (
                <button
                  className={selectedItemId === item.id ? "menu-item-button is-active" : "menu-item-button"}
                  type="button"
                  onClick={() => selectItem(item)}
                  key={item.id}
                >
                  <strong>{item.name}</strong>
                  <span>{item.category || "未分類"} / {item.basePrice == null ? "価格未設定" : `${item.basePrice.toLocaleString()}円`}</span>
                </button>
              ))}
              {!categoryItems.length ? <p className="empty-state">{loading ? "読み込み中..." : "商品がありません。"}</p> : null}
            </div>
          </aside>

          <section className="menu-detail-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{getBrandName(data.brands, itemDraft.brandId) || "Menu Item"}</p>
                <h3>{itemDraft.id ? "商品編集" : "新規商品"}</h3>
              </div>
              <div className="row-actions">
                {itemDraft.id ? (
                  <button className="danger-button" type="button" onClick={() => void deleteEntry("item", itemDraft.id)}>
                    <Trash2 size={15} />
                  </button>
                ) : null}
                <button className="primary-button" type="button" disabled={savingKind === "item"} onClick={() => void save("item", itemDraft)}>
                  <Save size={16} />
                  {savingKind === "item" ? "保存中..." : "商品を保存"}
                </button>
              </div>
            </div>

            <div className="menu-edit-card">
              <div className="menu-form-grid">
                <label>
                  <span>商品名</span>
                  <input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder="商品名" />
                </label>
                <label>
                  <span>分類</span>
                  <input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} placeholder="例: タピオカフラッペ" />
                </label>
                <label>
                  <span>商品タイプ</span>
                  <select value={itemDraft.itemKind} onChange={(event) => setItemDraft({ ...itemDraft, itemKind: event.target.value })}>
                    {itemKindOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>基本価格</span>
                  <input value={itemDraft.basePrice ?? ""} onChange={(event) => setItemDraft({ ...itemDraft, basePrice: event.target.value ? Number(event.target.value) : null })} inputMode="decimal" />
                </label>
                <label>
                  <span>店舗</span>
                  <select value={itemDraft.storeId} onChange={(event) => setItemDraft({ ...itemDraft, storeId: event.target.value })}>
                    <option value="">全店共通</option>
                    {visibleStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
                  </select>
                </label>
                <label className="checkbox-group menu-inline-check">
                  <input type="checkbox" checked={itemDraft.isActive} onChange={(event) => setItemDraft({ ...itemDraft, isActive: event.target.checked })} />
                  <span>公開中</span>
                </label>
              </div>
              <label className="menu-full-field">
                <span>説明</span>
                <textarea value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} rows={3} />
              </label>
              <div className="photo-upload-box menu-photo-upload">
                <div className="product-photo-preview">
                  {itemDraft.imageUrl ? <img src={itemDraft.imageUrl} alt="" /> : <span>No image</span>}
                </div>
                <div>
                  <label className="menu-full-field">
                    <span>商品画像 URL</span>
                    <input value={itemDraft.imageUrl} onChange={(event) => setItemDraft({ ...itemDraft, imageUrl: event.target.value })} placeholder="https://..." />
                  </label>
                  <p>ブランドサイトに表示する成品写真です。OS にアップロードした公開 URL がメニュー API に出力されます。</p>
                  <div className="photo-upload-actions">
                    <label className="secondary-button">
                      <Upload size={16} />
                      写真を選択
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) selectMenuPhoto(file);
                        }}
                      />
                    </label>
                  </div>
                  {photoStatus ? <small>{photoStatus}</small> : null}
                </div>
              </div>
            </div>

            <section className="menu-edit-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Rules</p>
                  <h3>この商品で選べる内容</h3>
                </div>
                <button className="primary-button" type="button" disabled={savingKind === "item"} onClick={() => void save("item", itemDraft)}>
                  <Save size={16} />
                  {savingKind === "item" ? "保存中..." : "選択可否を保存"}
                </button>
              </div>
              <div className="menu-rule-list">
                {visibleGroups.map((group) => {
                  const groupOptions = data.options.filter((option) => option.optionGroupId === group.id);
                  const allowedKeys = getAllowedKeys(itemDraft, group, groupOptions);
                  return (
                    <article className="menu-rule-card" key={group.id}>
                      <div className="menu-rule-card-head">
                        <div>
                          <strong>{group.name}</strong>
                          <span>{getLabel(selectionTypeOptions, group.selectionType)} / {group.affectsProcedure ? "手順に影響" : "表示のみ"}</span>
                        </div>
                        <button className="secondary-button" type="button" onClick={() => setGroupDraft(group)}>
                          グループ編集
                        </button>
                      </div>
                      <div className="menu-choice-grid">
                        {groupOptions.map((option) => (
                          <label className={allowedKeys.has(getOptionKey(option)) ? "menu-choice-chip is-allowed" : "menu-choice-chip"} key={option.id}>
                            <input
                              type="checkbox"
                              checked={allowedKeys.has(getOptionKey(option))}
                              onChange={(event) => updateAllowedOption(group, option, event.target.checked)}
                            />
                            <span>{option.name}</span>
                            {option.priceDelta ? <small>{option.priceDelta > 0 ? "+" : ""}{option.priceDelta}円</small> : null}
                          </label>
                        ))}
                        {!groupOptions.length ? <p className="empty-state">選択肢がありません。</p> : null}
                      </div>
                    </article>
                  );
                })}
                {!visibleGroups.length ? <p className="empty-state">このブランドの選択グループはまだありません。</p> : null}
              </div>
            </section>

            <section className="menu-edit-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Option Editing</p>
                  <h3>選択肢の追加・編集</h3>
                </div>
                <button className="secondary-button" type="button" onClick={resetGroupDraftForItem}>
                  <Plus size={16} />
                  商品専用グループ
                </button>
              </div>
              <div className="menu-option-editor">
                <div className="menu-option-form">
                  <h4>選択グループ</h4>
                  <label>
                    <span>対象</span>
                    <select value={groupDraft.menuCatalogItemId} onChange={(event) => setGroupDraft({ ...groupDraft, menuCatalogItemId: event.target.value })}>
                      <option value="">ブランド共通</option>
                      {itemDraft.id ? <option value={itemDraft.id}>{itemDraft.name || "現在の商品"}</option> : null}
                    </select>
                  </label>
                  <div className="menu-form-grid">
                    <label>
                      <span>表示名</span>
                      <input value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} placeholder="例: サイズ" />
                    </label>
                    <label>
                      <span>内部キー</span>
                      <input value={groupDraft.groupKey} onChange={(event) => setGroupDraft({ ...groupDraft, groupKey: event.target.value })} placeholder="例: size" />
                    </label>
                    <label>
                      <span>選択方式</span>
                      <select value={groupDraft.selectionType} onChange={(event) => setGroupDraft({ ...groupDraft, selectionType: event.target.value })}>
                        {selectionTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>並び順</span>
                      <input value={groupDraft.sortOrder} onChange={(event) => setGroupDraft({ ...groupDraft, sortOrder: Number(event.target.value || 0) })} inputMode="numeric" />
                    </label>
                  </div>
                  <label className="checkbox-group menu-inline-check">
                    <input type="checkbox" checked={groupDraft.affectsProcedure} onChange={(event) => setGroupDraft({ ...groupDraft, affectsProcedure: event.target.checked })} />
                    <span>手順に影響する</span>
                  </label>
                  <button className="primary-button" type="button" disabled={savingKind === "group"} onClick={() => void save("group", { ...groupDraft, brandId: groupDraft.brandId || activeBrandId })}>
                    <Save size={16} />
                    {savingKind === "group" ? "保存中..." : "グループを保存"}
                  </button>
                </div>

                <div className="menu-option-form">
                  <h4>選択肢</h4>
                  <label>
                    <span>グループ</span>
                    <select value={optionDraft.optionGroupId} onChange={(event) => setOptionDraft({ ...optionDraft, optionGroupId: event.target.value })}>
                      <option value="">選択</option>
                      {visibleGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                  <div className="menu-form-grid">
                    <label>
                      <span>表示名</span>
                      <input value={optionDraft.name} onChange={(event) => setOptionDraft({ ...optionDraft, name: event.target.value })} placeholder="例: HOT" />
                    </label>
                    <label>
                      <span>内部キー</span>
                      <input value={optionDraft.optionKey} onChange={(event) => setOptionDraft({ ...optionDraft, optionKey: event.target.value })} placeholder="例: hot" />
                    </label>
                    <label>
                      <span>価格差額</span>
                      <input value={optionDraft.priceDelta ?? ""} onChange={(event) => setOptionDraft({ ...optionDraft, priceDelta: event.target.value ? Number(event.target.value) : null })} inputMode="decimal" />
                    </label>
                    <label>
                      <span>並び順</span>
                      <input value={optionDraft.sortOrder} onChange={(event) => setOptionDraft({ ...optionDraft, sortOrder: Number(event.target.value || 0) })} inputMode="numeric" />
                    </label>
                  </div>
                  <label className="checkbox-group menu-inline-check">
                    <input type="checkbox" checked={optionDraft.affectsProcedure} onChange={(event) => setOptionDraft({ ...optionDraft, affectsProcedure: event.target.checked })} />
                    <span>手順に影響する</span>
                  </label>
                  <button className="primary-button" type="button" disabled={savingKind === "option"} onClick={() => void save("option", optionDraft)}>
                    <Save size={16} />
                    {savingKind === "option" ? "保存中..." : "選択肢を保存"}
                  </button>
                </div>
              </div>

              <div className="menu-option-list">
                {visibleGroups.map((group) => (
                  <article className="menu-option-group-row" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <p>{group.menuCatalogItemId ? "商品専用" : "ブランド共通"} / {group.groupKey}</p>
                    </div>
                    <div className="menu-option-tags">
                      {data.options.filter((option) => option.optionGroupId === group.id).map((option) => (
                        <button className="menu-option-tag" type="button" onClick={() => setOptionDraft(option)} key={option.id}>
                          {option.name}
                        </button>
                      ))}
                    </div>
                    <div className="row-actions">
                      <button className="secondary-button" type="button" onClick={() => setGroupDraft(group)}>
                        編集
                      </button>
                      <button className="danger-button" type="button" onClick={() => void deleteEntry("group", group.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <details className="menu-source-details">
              <summary>取込元・内部情報</summary>
              <div>
                <p>取込元: {selectedSource?.name || "未指定"}</p>
                <p>外部 ID: {itemDraft.externalId || "未設定"}</p>
                <p>Source URL: {selectedSource?.sourceUrl || "未設定"}</p>
              </div>
            </details>
          </section>
        </div>
      </section>
    </main>
  );
}
