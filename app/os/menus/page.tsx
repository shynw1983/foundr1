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

const emptySource: MenuSource = {
  id: "",
  brandId: "",
  storeId: "",
  name: "",
  sourceType: "manual",
  sourceUrl: "",
  status: "active"
};

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

const sourceTypeOptions = [
  { value: "manual", label: "OS 手入力" },
  { value: "imported_site", label: "ブランドサイト取込" },
  { value: "external_api", label: "外部 API" }
];

const itemKindOptions = [
  { value: "fixed_product", label: "固定商品" },
  { value: "buildable_product", label: "組み立て商品" },
  { value: "modifier", label: "追加・変更" },
  { value: "option", label: "選択肢" }
];

const selectionTypeOptions = [
  { value: "single", label: "単一選択" },
  { value: "multiple", label: "複数選択" },
  { value: "quantity", label: "数量選択" }
];

function stringifySchema(value: Record<string, unknown>) {
  return Object.keys(value ?? {}).length ? JSON.stringify(value, null, 2) : "{}";
}

function getName(items: OptionItem[], id: string) {
  return items.find((item) => item.id === id)?.name ?? "";
}

function buildPublicMenuUrl(brandId: string, storeId: string) {
  const params = new URLSearchParams();
  if (brandId) params.set("brand", brandId);
  if (storeId) params.set("store", storeId);
  return `/api/public/menus${params.size ? `?${params.toString()}` : ""}`;
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
  const [sourceDraft, setSourceDraft] = useState<MenuSource>(emptySource);
  const [itemDraft, setItemDraft] = useState<MenuItem>(emptyItem);
  const [groupDraft, setGroupDraft] = useState<MenuGroup>(emptyGroup);
  const [optionDraft, setOptionDraft] = useState<MenuOption>(emptyOption);
  const [schemaText, setSchemaText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadMenus() {
    setLoading(true);
    const response = await fetch("/api/menus");
    if (!response.ok) {
      setMessage("メニュー情報を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const nextData = await response.json() as MenuAdminData;
    setData(nextData);
    setActiveBrandId((current) => current || nextData.brands[0]?.id || "");
    setLoading(false);
  }

  useEffect(() => {
    void loadMenus();
  }, []);

  const visibleStores = useMemo(() => {
    if (!activeBrandId) return data.stores;
    return data.stores.filter((store) => store.brandIds.includes(activeBrandId));
  }, [activeBrandId, data.stores]);

  const filteredSources = useMemo(() => data.sources.filter((source) => {
    if (activeBrandId && source.brandId !== activeBrandId) return false;
    if (activeStoreId && source.storeId && source.storeId !== activeStoreId) return false;
    return true;
  }), [activeBrandId, activeStoreId, data.sources]);

  const filteredItems = useMemo(() => data.items.filter((item) => {
    if (activeBrandId && item.brandId !== activeBrandId) return false;
    if (activeStoreId && item.storeId && item.storeId !== activeStoreId) return false;
    return true;
  }), [activeBrandId, activeStoreId, data.items]);

  const filteredGroups = useMemo(() => data.groups.filter((group) => {
    if (activeBrandId && group.brandId !== activeBrandId) return false;
    return true;
  }), [activeBrandId, data.groups]);

  const filteredOptions = useMemo(() => data.options.filter((option) => {
    if (!activeBrandId) return true;
    const group = data.groups.find((entry) => entry.id === option.optionGroupId);
    return group?.brandId === activeBrandId;
  }), [activeBrandId, data.groups, data.options]);

  async function save(kind: "source" | "item" | "group" | "option", payload: Record<string, unknown>) {
    setMessage("");
    const response = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...payload })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(result.error || "保存できませんでした。");
      return;
    }
    setMessage("保存しました。");
    if (kind === "source") setSourceDraft({ ...emptySource, brandId: activeBrandId, storeId: activeStoreId });
    if (kind === "item") {
      setItemDraft({ ...emptyItem, brandId: activeBrandId, storeId: activeStoreId });
      setSchemaText("{}");
    }
    if (kind === "group") setGroupDraft({ ...emptyGroup, brandId: activeBrandId });
    if (kind === "option") setOptionDraft(emptyOption);
    await loadMenus();
  }

  async function deleteEntry(kind: "source" | "item" | "group" | "option", id: string) {
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
    await loadMenus();
  }

  function beginEditItem(item: MenuItem) {
    setItemDraft(item);
    setSchemaText(stringifySchema(item.variableSchema));
  }

  function resetDraftsForBrand(brandId: string) {
    setActiveBrandId(brandId);
    setActiveStoreId("");
    setSourceDraft({ ...emptySource, brandId });
    setItemDraft({ ...emptyItem, brandId });
    setGroupDraft({ ...emptyGroup, brandId });
    setOptionDraft(emptyOption);
    setSchemaText("{}");
  }

  const publicMenuUrl = buildPublicMenuUrl(activeBrandId, activeStoreId);

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
            <p className="eyebrow">Menu Source</p>
            <h2>メニュー管理</h2>
            <p>ブランドサイト、POS、手順書で使うメニューを Foundr1 OS 側で一元管理します。</p>
          </div>
          <a className="secondary-button" href={publicMenuUrl} target="_blank" rel="noreferrer">
            公開 API を確認
          </a>
        </div>

        <section className="info-panel">
          <strong>運用方針</strong>
          <p>
            商品マスタは原材料・包材・備品などの運営物品、メニュー管理はお客様に販売する商品と選択肢です。
            手順書はメニューの商品・サイズ・温度・辛さなどを条件として読み取り、必要な材料は商品マスタにリンクします。
          </p>
        </section>

        <div className="filter-bar">
          <label>
            <span>ブランド</span>
            <select value={activeBrandId} onChange={(event) => resetDraftsForBrand(event.target.value)}>
              <option value="">すべて</option>
              {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label>
            <span>店舗</span>
            <select value={activeStoreId} onChange={(event) => {
              const storeId = event.target.value;
              setActiveStoreId(storeId);
              setSourceDraft((draft) => ({ ...draft, storeId }));
              setItemDraft((draft) => ({ ...draft, storeId }));
            }}>
              <option value="">全店共通</option>
              {visibleStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
          </label>
          <code>{publicMenuUrl}</code>
        </div>

        {message ? <div className="inline-alert">{message}</div> : null}

        <div className="menu-admin-grid">
          <section className="management-form">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Source</p>
                <h3>メニューソース</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setSourceDraft({ ...emptySource, brandId: activeBrandId, storeId: activeStoreId })}>
                <Plus size={16} />
                新規
              </button>
            </div>
            <label>
              <span>ブランド</span>
              <select value={sourceDraft.brandId || activeBrandId} onChange={(event) => setSourceDraft({ ...sourceDraft, brandId: event.target.value })}>
                <option value="">選択</option>
                {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label>
              <span>店舗</span>
              <select value={sourceDraft.storeId} onChange={(event) => setSourceDraft({ ...sourceDraft, storeId: event.target.value })}>
                <option value="">全店共通</option>
                {visibleStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              <span>名称</span>
              <input value={sourceDraft.name} onChange={(event) => setSourceDraft({ ...sourceDraft, name: event.target.value })} placeholder="nanacha 公式メニュー" />
            </label>
            <label>
              <span>種別</span>
              <select value={sourceDraft.sourceType} onChange={(event) => setSourceDraft({ ...sourceDraft, sourceType: event.target.value })}>
                {sourceTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>URL</span>
              <input value={sourceDraft.sourceUrl} onChange={(event) => setSourceDraft({ ...sourceDraft, sourceUrl: event.target.value })} placeholder="https://..." />
            </label>
            <button className="primary-button" type="button" onClick={() => void save("source", { ...sourceDraft, brandId: sourceDraft.brandId || activeBrandId, storeId: sourceDraft.storeId || activeStoreId })}>
              <Save size={16} />
              ソースを保存
            </button>
          </section>

          <section className="management-form">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Item</p>
                <h3>メニュー商品</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => {
                setItemDraft({ ...emptyItem, brandId: activeBrandId, storeId: activeStoreId });
                setSchemaText("{}");
              }}>
                <Plus size={16} />
                新規
              </button>
            </div>
            <label>
              <span>ブランド</span>
              <select value={itemDraft.brandId || activeBrandId} onChange={(event) => setItemDraft({ ...itemDraft, brandId: event.target.value })}>
                <option value="">選択</option>
                {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label>
              <span>店舗</span>
              <select value={itemDraft.storeId} onChange={(event) => setItemDraft({ ...itemDraft, storeId: event.target.value })}>
                <option value="">全店共通</option>
                {visibleStores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              <span>ソース</span>
              <select value={itemDraft.menuSourceId} onChange={(event) => setItemDraft({ ...itemDraft, menuSourceId: event.target.value })}>
                <option value="">未指定</option>
                {filteredSources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
              </select>
            </label>
            <label>
              <span>商品名</span>
              <input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder="抹茶ラテ" />
            </label>
            <label>
              <span>商品タイプ</span>
              <select value={itemDraft.itemKind} onChange={(event) => setItemDraft({ ...itemDraft, itemKind: event.target.value })}>
                {itemKindOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="menu-admin-two-columns">
              <label>
                <span>カテゴリ</span>
                <input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} placeholder="ドリンク" />
              </label>
              <label>
                <span>基本価格</span>
                <input value={itemDraft.basePrice ?? ""} onChange={(event) => setItemDraft({ ...itemDraft, basePrice: event.target.value ? Number(event.target.value) : null })} inputMode="decimal" />
              </label>
            </div>
            <label>
              <span>説明</span>
              <textarea value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} rows={2} />
            </label>
            <label>
              <span>差分条件 JSON</span>
              <textarea className="menu-admin-json" value={schemaText} onChange={(event) => setSchemaText(event.target.value)} rows={5} placeholder="{&quot;sizes&quot;:[&quot;M&quot;,&quot;L&quot;],&quot;temperatures&quot;:[&quot;ICE&quot;,&quot;HOT&quot;]}" />
            </label>
            <label className="checkbox-group">
              <input type="checkbox" checked={itemDraft.isActive} onChange={(event) => setItemDraft({ ...itemDraft, isActive: event.target.checked })} />
              <span>公開中</span>
            </label>
            <button className="primary-button" type="button" onClick={() => void save("item", { ...itemDraft, brandId: itemDraft.brandId || activeBrandId, storeId: itemDraft.storeId || activeStoreId, variableSchema: schemaText })}>
              <Save size={16} />
              メニュー商品を保存
            </button>
          </section>

          <section className="management-form">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Options</p>
                <h3>選択グループ</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setGroupDraft({ ...emptyGroup, brandId: activeBrandId })}>
                <Plus size={16} />
                新規
              </button>
            </div>
            <label>
              <span>ブランド</span>
              <select value={groupDraft.brandId || activeBrandId} onChange={(event) => setGroupDraft({ ...groupDraft, brandId: event.target.value })}>
                <option value="">選択</option>
                {data.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label>
              <span>対象商品</span>
              <select value={groupDraft.menuCatalogItemId} onChange={(event) => setGroupDraft({ ...groupDraft, menuCatalogItemId: event.target.value })}>
                <option value="">ブランド共通</option>
                {filteredItems.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="menu-admin-two-columns">
              <label>
                <span>キー</span>
                <input value={groupDraft.groupKey} onChange={(event) => setGroupDraft({ ...groupDraft, groupKey: event.target.value })} placeholder="temperature" />
              </label>
              <label>
                <span>表示名</span>
                <input value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} placeholder="温度" />
              </label>
            </div>
            <label>
              <span>選択方式</span>
              <select value={groupDraft.selectionType} onChange={(event) => setGroupDraft({ ...groupDraft, selectionType: event.target.value })}>
                {selectionTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="menu-admin-two-columns">
              <label>
                <span>並び順</span>
                <input value={groupDraft.sortOrder} onChange={(event) => setGroupDraft({ ...groupDraft, sortOrder: Number(event.target.value || 0) })} inputMode="numeric" />
              </label>
              <label className="checkbox-group">
                <input type="checkbox" checked={groupDraft.affectsProcedure} onChange={(event) => setGroupDraft({ ...groupDraft, affectsProcedure: event.target.checked })} />
                <span>手順に影響</span>
              </label>
            </div>
            <label className="checkbox-group">
              <input type="checkbox" checked={groupDraft.isActive} onChange={(event) => setGroupDraft({ ...groupDraft, isActive: event.target.checked })} />
              <span>公開中</span>
            </label>
            <button className="primary-button" type="button" onClick={() => void save("group", { ...groupDraft, brandId: groupDraft.brandId || activeBrandId })}>
              <Save size={16} />
              グループを保存
            </button>
          </section>

          <section className="management-form">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Choice</p>
                <h3>選択肢</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setOptionDraft(emptyOption)}>
                <Plus size={16} />
                新規
              </button>
            </div>
            <label>
              <span>グループ</span>
              <select value={optionDraft.optionGroupId} onChange={(event) => setOptionDraft({ ...optionDraft, optionGroupId: event.target.value })}>
                <option value="">選択</option>
                {filteredGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
              </select>
            </label>
            <div className="menu-admin-two-columns">
              <label>
                <span>キー</span>
                <input value={optionDraft.optionKey} onChange={(event) => setOptionDraft({ ...optionDraft, optionKey: event.target.value })} placeholder="ice" />
              </label>
              <label>
                <span>表示名</span>
                <input value={optionDraft.name} onChange={(event) => setOptionDraft({ ...optionDraft, name: event.target.value })} placeholder="ICE" />
              </label>
            </div>
            <div className="menu-admin-two-columns">
              <label>
                <span>価格差額</span>
                <input value={optionDraft.priceDelta ?? ""} onChange={(event) => setOptionDraft({ ...optionDraft, priceDelta: event.target.value ? Number(event.target.value) : null })} inputMode="decimal" />
              </label>
              <label>
                <span>並び順</span>
                <input value={optionDraft.sortOrder} onChange={(event) => setOptionDraft({ ...optionDraft, sortOrder: Number(event.target.value || 0) })} inputMode="numeric" />
              </label>
            </div>
            <label className="checkbox-group">
              <input type="checkbox" checked={optionDraft.affectsProcedure} onChange={(event) => setOptionDraft({ ...optionDraft, affectsProcedure: event.target.checked })} />
              <span>手順に影響</span>
            </label>
            <label className="checkbox-group">
              <input type="checkbox" checked={optionDraft.isActive} onChange={(event) => setOptionDraft({ ...optionDraft, isActive: event.target.checked })} />
              <span>公開中</span>
            </label>
            <button className="primary-button" type="button" onClick={() => void save("option", optionDraft)}>
              <Save size={16} />
              選択肢を保存
            </button>
          </section>
        </div>

        <section className="menu-admin-list-grid">
          <MenuList
            title="メニュー商品"
            emptyText={loading ? "読み込み中..." : "メニュー商品はまだありません。"}
            rows={filteredItems.map((item) => ({
              id: item.id,
              title: item.name,
              meta: `${getName(data.brands, item.brandId)} / ${item.category || "カテゴリ未設定"} / ${item.isActive ? "公開中" : "非公開"}`,
              body: item.description || itemKindOptions.find((option) => option.value === item.itemKind)?.label || item.itemKind,
              onEdit: () => beginEditItem(item),
              onDelete: () => void deleteEntry("item", item.id)
            }))}
          />
          <MenuList
            title="選択グループ"
            emptyText="選択グループはまだありません。"
            rows={filteredGroups.map((group) => ({
              id: group.id,
              title: group.name,
              meta: `${group.groupKey} / ${selectionTypeOptions.find((option) => option.value === group.selectionType)?.label || group.selectionType}`,
              body: group.menuCatalogItemId ? getName(filteredItems, group.menuCatalogItemId) : "ブランド共通",
              onEdit: () => setGroupDraft(group),
              onDelete: () => void deleteEntry("group", group.id)
            }))}
          />
          <MenuList
            title="選択肢"
            emptyText="選択肢はまだありません。"
            rows={filteredOptions.map((option) => ({
              id: option.id,
              title: option.name,
              meta: `${option.optionKey} / ${option.priceDelta ? `+${option.priceDelta}` : "価格差なし"}`,
              body: data.groups.find((group) => group.id === option.optionGroupId)?.name || "グループ未設定",
              onEdit: () => setOptionDraft(option),
              onDelete: () => void deleteEntry("option", option.id)
            }))}
          />
        </section>
      </section>
    </main>
  );
}

function MenuList({
  title,
  emptyText,
  rows
}: {
  title: string;
  emptyText: string;
  rows: Array<{ id: string; title: string; meta: string; body: string; onEdit: () => void; onDelete: () => void }>;
}) {
  return (
    <section className="management-list">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div className="management-row" key={row.id}>
          <div>
            <strong>{row.title}</strong>
            <p>{row.meta}</p>
            <small>{row.body}</small>
          </div>
          <div className="row-actions">
            <button className="secondary-button" type="button" onClick={row.onEdit}>
              編集
            </button>
            <button className="danger-button" type="button" onClick={row.onDelete}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
      {!rows.length ? <p className="empty-state">{emptyText}</p> : null}
    </section>
  );
}
