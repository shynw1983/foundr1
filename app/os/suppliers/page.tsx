"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { ModalHistoryScope } from "../components/useModalHistory";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { suppliers as initialSuppliers } from "../../../lib/mock-data";
import {
  defaultBusinessHours,
  formatBusinessHoursSummary,
  normalizeBusinessHours,
  serializeBusinessHours,
  weekdayKeys,
  weekdayLabels,
  type StoreBusinessHours,
  type WeekdayKey
} from "../../../lib/store-business-hours";

type Supplier = typeof initialSuppliers[number];
type SupplierLocation = {
  supplier: string;
  locationName: string;
  type: string;
  area: string;
  address: string;
  phone: string;
  hours: string;
  businessHoursSettings?: unknown;
  purchaseMethod: string;
  note: string;
};

type SupplierLocationDraft = Omit<SupplierLocation, "supplier">;

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const channelTypes = ["実店舗", "チェーン店", "ネットショップ", "卸売", "その他"];

export default function SuppliersPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierLocations, setSupplierLocations] = useState<SupplierLocation[]>([]);
  const [query, setQuery] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [newBusinessHours, setNewBusinessHours] = useState<StoreBusinessHours>(defaultBusinessHours);
  const [newLocations, setNewLocations] = useState<SupplierLocationDraft[]>([]);
  const [editingBusinessHours, setEditingBusinessHours] = useState<StoreBusinessHours>(defaultBusinessHours);
  const [editingLocations, setEditingLocations] = useState<SupplierLocationDraft[]>([]);

  async function loadData() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { suppliers?: Supplier[]; supplierLocations?: SupplierLocation[] };

    if (data.suppliers) setSuppliers(data.suppliers);
    if (data.supplierLocations) setSupplierLocations(data.supplierLocations);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredSuppliers = suppliers.filter((supplier) =>
    [
      supplier.name,
      supplier.category,
      supplier.channelType,
      supplier.reliability,
      supplier.address,
      supplier.phone,
      supplier.contactPerson,
      supplier.businessHours,
      supplier.orderUrl
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const supplierLocationsByName = supplierLocations.reduce<Record<string, SupplierLocation[]>>((grouped, location) => {
    const key = location.supplier;
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(location);
    return grouped;
  }, {});

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const supplier = readSupplierForm(formData);
    formData.set("businessHoursSettings", serializeBusinessHours(newBusinessHours));
    formData.set("locations", JSON.stringify(normalizeLocationDrafts(newLocations)));

    if (!supplier.name.trim()) return;

    const response = await fetch("/api/suppliers", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "発注先を保存できませんでした。");
      return;
    }

    await loadData();
    setNewBusinessHours(defaultBusinessHours);
    setNewLocations([]);
    form.reset();
    showNotice("発注先を追加しました。");
  }

  async function saveSupplierEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSupplier) return;

    const formData = new FormData(event.currentTarget);
    formData.set("currentName", editingSupplier.name);
    formData.set("businessHoursSettings", serializeBusinessHours(editingBusinessHours));
    formData.set("locations", JSON.stringify(normalizeLocationDrafts(editingLocations)));

    const response = await fetch("/api/suppliers", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "発注先を更新できませんでした。");
      return;
    }

    await loadData();
    setEditingSupplier(null);
    showNotice("発注先を更新しました。");
  }

  function startEditingSupplier(supplier: Supplier) {
    setEditingSupplier(supplier);
    setEditingBusinessHours(normalizeBusinessHours((supplier as Supplier & { businessHoursSettings?: unknown }).businessHoursSettings));
    setEditingLocations((supplierLocationsByName[supplier.name] ?? []).map((location) => ({
      locationName: location.locationName,
      type: location.type || supplier.channelType || "実店舗",
      area: location.area || "",
      address: location.address || "",
      phone: location.phone || "",
      hours: location.hours || "",
      businessHoursSettings: location.businessHoursSettings,
      purchaseMethod: location.purchaseMethod || "",
      note: location.note || ""
    })));
  }

  function deleteSupplier(supplier: Supplier) {
    if (!window.confirm(`${supplier.name} を削除しますか？\n商品・発注記録・価格記録との紐づけも解除されます。`)) return;

    setSuppliers((items) => items.filter((item) => item.name !== supplier.name));
    void fetch("/api/suppliers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: supplier.name })
    })
      .then((response) => {
        if (response.ok) {
          showNotice("発注先を削除しました。");
          return null;
        }

        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        return response.json().then((body) => {
          window.alert(body.error ?? "発注先を削除できませんでした。");
        });
      })
      .catch(() => {
        setSuppliers((items) => (items.some((item) => item.name === supplier.name) ? items : [...items, supplier]));
        window.alert("発注先を削除できませんでした。");
      });
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">発注先データベース</p>
            <h2>発注先管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="発注先・分類・区分を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>発注先を追加</h3>
              <p>実店舗、チェーン店、ネットショップを同じマスタで管理</p>
            </div>
          </div>
          <form className="management-form supplier-management-form" onSubmit={createSupplier}>
            <label>
              <span>発注先名</span>
              <input name="name" placeholder="例: 業務スーパー" />
            </label>
            <label>
              <span>取扱内容</span>
              <input name="category" placeholder="例: 冷凍食品 / 消耗品" />
            </label>
            <label>
              <span>区分</span>
              <select name="channelType" defaultValue="実店舗">
                {channelTypes.map((channelType) => (
                  <option value={channelType} key={channelType}>{channelType}</option>
                ))}
              </select>
            </label>
            <label>
              <span>住所</span>
              <input name="address" placeholder="例: 福岡市中央区..." />
            </label>
            <label>
              <span>電話番号</span>
              <input name="phone" placeholder="例: 092-000-0000" />
            </label>
            <label>
              <span>連絡先担当者</span>
              <input name="contactPerson" placeholder="例: 山田さん" />
            </label>
            <label>
              <span>営業時間</span>
              <input name="businessHours" placeholder="補足メモ（例: 祝日は変動）" />
            </label>
            <label>
              <span>注文URL</span>
              <input name="orderUrl" placeholder="例: https://example.com/order" />
            </label>
            <label>
              <span>メモ</span>
              <input name="reliability" placeholder="例: 即日対応 / 欠品あり / 配送 1-2 日" />
            </label>
            <SupplierBusinessHoursEditor value={newBusinessHours} onChange={setNewBusinessHours} />
            <SupplierLocationEditor locations={newLocations} onChange={setNewLocations} defaultType="実店舗" />
            <button className="primary-button" type="submit">
              <Plus size={18} />
              追加
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>発注先リスト</h3>
              <p>商品マスタのメイン発注先・予備発注先で選択される候補</p>
            </div>
            <span className="source-indicator">{filteredSuppliers.length} 件</span>
          </div>
          <div className="supplier-list">
            {filteredSuppliers.map((supplier) => (
              <article className="supplier-row supplier-admin-row" key={supplier.name}>
                <div>
                  <strong>{supplier.name}</strong>
                  <p>{supplier.category || "取扱内容未設定"}</p>
                  <small>{supplier.reliability || "メモ未設定"}</small>
                  <small>営業時間: {formatBusinessHoursSummary((supplier as Supplier & { businessHoursSettings?: unknown }).businessHoursSettings)}</small>
                  <div className="supplier-detail-list">
                    {supplier.address ? <span>住所: {supplier.address}</span> : null}
                    {supplier.phone ? <span>電話: {supplier.phone}</span> : null}
                    {supplier.contactPerson ? <span>担当: {supplier.contactPerson}</span> : null}
                    {supplier.businessHours ? <span>営業時間メモ: {supplier.businessHours}</span> : null}
                    {supplier.orderUrl ? (
                      <a href={supplier.orderUrl} target="_blank" rel="noreferrer">注文URL</a>
                    ) : null}
                  </div>
                  {supplierLocationsByName[supplier.name]?.length ? (
                    <div className="supplier-location-tags" aria-label={`${supplier.name} の店舗・支店・OCR表示名`}>
                      {supplierLocationsByName[supplier.name].map((location) => (
                        <span key={`${supplier.name}-${location.locationName}`}>
                          {location.locationName}
                          {location.address ? ` / ${location.address}` : ""}
                          {location.phone ? ` / ${location.phone}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="supplier-type">{supplier.channelType}</span>
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => startEditingSupplier(supplier)}>
                    編集
                  </button>
                  <button className="text-button danger-button" type="button" onClick={() => deleteSupplier(supplier)}>
                    削除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      {editingSupplier ? (
        <ModalHistoryScope historyKey="suppliers-edit" onClose={() => setEditingSupplier(null)}>
          <div className="modal-backdrop">
            <form className="edit-modal" onSubmit={saveSupplierEdit}>
            <div className="modal-heading">
              <div>
                <h3>発注先を編集</h3>
                <p>{editingSupplier.name}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setEditingSupplier(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>発注先名</span>
                <input name="name" defaultValue={editingSupplier.name} />
              </label>
              <label>
                <span>取扱内容</span>
                <input name="category" defaultValue={editingSupplier.category} />
              </label>
              <label>
                <span>区分</span>
                <select name="channelType" defaultValue={editingSupplier.channelType || "実店舗"}>
                  {channelTypes.map((channelType) => (
                    <option value={channelType} key={channelType}>{channelType}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>住所</span>
                <input name="address" defaultValue={editingSupplier.address} />
              </label>
              <label>
                <span>電話番号</span>
                <input name="phone" defaultValue={editingSupplier.phone} />
              </label>
              <label>
                <span>連絡先担当者</span>
                <input name="contactPerson" defaultValue={editingSupplier.contactPerson} />
              </label>
              <label>
                <span>営業時間</span>
                <input name="businessHours" defaultValue={editingSupplier.businessHours} placeholder="補足メモ（例: 祝日は変動）" />
              </label>
              <label>
                <span>注文URL</span>
                <input name="orderUrl" defaultValue={editingSupplier.orderUrl} />
              </label>
              <label>
                <span>メモ</span>
                <input name="reliability" defaultValue={editingSupplier.reliability} />
              </label>
              <SupplierBusinessHoursEditor value={editingBusinessHours} onChange={setEditingBusinessHours} />
              <SupplierLocationEditor locations={editingLocations} onChange={setEditingLocations} defaultType={editingSupplier.channelType || "実店舗"} />
            </div>
            <div className="modal-actions">
              <button className="text-button" type="button" onClick={() => setEditingSupplier(null)}>
                キャンセル
              </button>
              <button className="primary-button" type="submit">保存</button>
            </div>
            </form>
          </div>
        </ModalHistoryScope>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function normalizeLocationDrafts(locations: SupplierLocationDraft[]) {
  return locations
    .map((location) => ({
      locationName: location.locationName.trim(),
      type: location.type.trim() || "実店舗",
      area: location.area.trim(),
      address: location.address.trim(),
      phone: location.phone.trim(),
      hours: location.hours.trim(),
      businessHoursSettings: serializeBusinessHours(location.businessHoursSettings),
      purchaseMethod: location.purchaseMethod.trim(),
      note: location.note.trim()
    }))
    .filter((location) => location.locationName);
}

function emptyLocationDraft(defaultType: string): SupplierLocationDraft {
  return {
    locationName: "",
    type: defaultType || "実店舗",
    area: "",
    address: "",
    phone: "",
    hours: "",
    businessHoursSettings: defaultBusinessHours,
    purchaseMethod: "",
    note: ""
  };
}

function SupplierBusinessHoursEditor({
  value,
  onChange
}: {
  value: StoreBusinessHours;
  onChange: (value: StoreBusinessHours) => void;
}) {
  function updateDay(key: WeekdayKey, patch: Partial<StoreBusinessHours[WeekdayKey]>) {
    onChange({
      ...value,
      [key]: {
        ...value[key],
        ...patch
      }
    });
  }

  return (
    <div className="supplier-hours-editor full-span">
      <strong>曜日別営業時間</strong>
      <div className="supplier-hours-grid">
        {weekdayKeys.map((key) => (
          <div className="supplier-hours-row" key={key}>
            <span>{weekdayLabels[key]}</span>
            <input
              type="time"
              value={value[key].open}
              onChange={(event) => updateDay(key, { open: event.target.value })}
              disabled={value[key].closed}
            />
            <input
              type="time"
              value={value[key].close}
              onChange={(event) => updateDay(key, { close: event.target.value })}
              disabled={value[key].closed}
            />
            <label className="supplier-hours-closed">
              <input
                type="checkbox"
                checked={value[key].closed}
                onChange={(event) => updateDay(key, { closed: event.target.checked })}
              />
              定休日
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupplierLocationEditor({
  locations,
  onChange,
  defaultType
}: {
  locations: SupplierLocationDraft[];
  onChange: (locations: SupplierLocationDraft[]) => void;
  defaultType: string;
}) {
  function updateLocation(index: number, patch: Partial<SupplierLocationDraft>) {
    onChange(locations.map((location, locationIndex) => (
      locationIndex === index ? { ...location, ...patch } : location
    )));
  }

  function addLocation() {
    onChange([...locations, emptyLocationDraft(defaultType)]);
  }

  function deleteLocation(index: number) {
    onChange(locations.filter((_, locationIndex) => locationIndex !== index));
  }

  return (
    <div className="supplier-location-editor full-span">
      <div className="supplier-location-editor-heading">
        <strong>店舗・支店</strong>
        <button className="secondary-button" type="button" onClick={addLocation}>支店を追加</button>
      </div>
      {locations.length ? locations.map((location, index) => {
        const locationHours = normalizeBusinessHours(location.businessHoursSettings);
        return (
          <div className="supplier-location-card" key={index}>
            <div className="supplier-location-grid">
              <label>
                <span>支店名</span>
                <input value={location.locationName} onChange={(event) => updateLocation(index, { locationName: event.target.value })} placeholder="例: 春吉店" />
              </label>
              <label>
                <span>区分</span>
                <select value={location.type} onChange={(event) => updateLocation(index, { type: event.target.value })}>
                  {channelTypes.map((channelType) => (
                    <option value={channelType} key={channelType}>{channelType}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>住所</span>
                <input value={location.address} onChange={(event) => updateLocation(index, { address: event.target.value })} />
              </label>
              <label>
                <span>電話番号</span>
                <input value={location.phone} onChange={(event) => updateLocation(index, { phone: event.target.value })} />
              </label>
              <label>
                <span>エリア</span>
                <input value={location.area} onChange={(event) => updateLocation(index, { area: event.target.value })} placeholder="例: 清水店から車 10 分" />
              </label>
              <label>
                <span>購入方法</span>
                <input value={location.purchaseMethod} onChange={(event) => updateLocation(index, { purchaseMethod: event.target.value })} placeholder="例: 店頭購入" />
              </label>
              <label className="full-span">
                <span>営業時間メモ</span>
                <input value={location.hours} onChange={(event) => updateLocation(index, { hours: event.target.value })} placeholder="補足メモ（例: 年末年始は短縮）" />
              </label>
              <label className="full-span">
                <span>メモ</span>
                <input value={location.note} onChange={(event) => updateLocation(index, { note: event.target.value })} />
              </label>
            </div>
            <SupplierBusinessHoursEditor value={locationHours} onChange={(nextHours) => updateLocation(index, { businessHoursSettings: nextHours })} />
            <button className="text-button danger-button" type="button" onClick={() => deleteLocation(index)}>支店を削除</button>
          </div>
        );
      }) : (
        <p className="empty-state-text">支店・購入地点がある場合は追加してください。チェーン店は支店ごとに住所と電話番号を保存できます。</p>
      )}
    </div>
  );
}

function readSupplierForm(formData: FormData): Supplier {
  return {
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    channelType: String(formData.get("channelType") ?? "実店舗").trim() || "実店舗",
    reliability: String(formData.get("reliability") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    contactPerson: String(formData.get("contactPerson") ?? "").trim(),
    businessHours: String(formData.get("businessHours") ?? "").trim(),
    orderUrl: String(formData.get("orderUrl") ?? "").trim()
  };
}
