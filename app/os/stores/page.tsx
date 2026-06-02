"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { salesSourceDefinitions } from "../../../lib/sales-sources";
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

type StoreItem = {
  id?: string;
  name: string;
  companyName?: string;
  owner: string;
  brands: string[];
  businessHours?: unknown;
  reservationNote?: string;
  payrollCycleType?: "month_end" | "specified_day";
  payrollClosingDay?: number;
  socialInsurancePrefecture?: string;
  salesSources?: SalesSourceItem[];
};

type SalesSourceItem = {
  platform: string;
  label: string;
  sourceType: string;
  brandName: string;
  isEnabled: boolean;
};

type BrandItem = {
  name: string;
  type: string;
};

type StoreEditTab = "basic" | "hours" | "sales" | "payroll";

const prefectureOptions = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

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

export default function StoresPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [storesData, setStoresData] = useState<StoreItem[]>([]);
  const [brandsData, setBrandsData] = useState<BrandItem[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [editingStore, setEditingStore] = useState<StoreItem | null>(null);
  const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
  const [selectedStoreBrands, setSelectedStoreBrands] = useState<string[]>([]);
  const [editingStoreBrands, setEditingStoreBrands] = useState<string[]>([]);
  const [newBusinessHours, setNewBusinessHours] = useState<StoreBusinessHours>(defaultBusinessHours);
  const [editingBusinessHours, setEditingBusinessHours] = useState<StoreBusinessHours>(defaultBusinessHours);
  const [editingStoreName, setEditingStoreName] = useState("");
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [editingOwner, setEditingOwner] = useState("");
  const [editingReservationNote, setEditingReservationNote] = useState("");
  const [editingStoreTab, setEditingStoreTab] = useState<StoreEditTab>("basic");
  const [editingPayrollCycleType, setEditingPayrollCycleType] = useState<"month_end" | "specified_day">("month_end");
  const [editingPayrollClosingDay, setEditingPayrollClosingDay] = useState(25);
  const [editingSocialInsurancePrefecture, setEditingSocialInsurancePrefecture] = useState("福岡県");
  const [selectedSalesSourcePlatforms, setSelectedSalesSourcePlatforms] = useState<string[]>(["smaregi", "uber_eats"]);
  const [editingSalesSourcePlatforms, setEditingSalesSourcePlatforms] = useState<string[]>([]);

  async function loadData() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return;
    const data = await response.json() as {
      stores?: StoreItem[];
      brands?: BrandItem[];
    };

    if (data.stores) setStoresData(data.stores);
    if (data.brands) setBrandsData(data.brands);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const companyName = String(formData.get("companyName") ?? "");
    const owner = String(formData.get("owner") ?? "");
    const reservationNote = String(formData.get("reservationNote") ?? "");
    const selectedBrands = formData.getAll("brand").map((value) => String(value));
    formData.set("businessHours", serializeBusinessHours(newBusinessHours));
    formData.set("payrollCycleType", "month_end");
    formData.set("payrollClosingDay", "31");
    formData.set("socialInsurancePrefecture", "福岡県");
    selectedSalesSourcePlatforms.forEach((platform) => formData.set(`salesSource:${platform}:enabled`, "on"));

    if (!name.trim()) return;

    const response = await fetch("/api/stores", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "店舗を保存できませんでした。");
      return;
    }

    setStoresData((items) => [
      ...items.filter((item) => item.name !== name),
      { name, companyName, owner, brands: selectedBrands, businessHours: newBusinessHours, reservationNote, payrollCycleType: "month_end", payrollClosingDay: 31, socialInsurancePrefecture: "福岡県" }
    ]);
    setSelectedStoreBrands([]);
    setSelectedSalesSourcePlatforms(["smaregi", "uber_eats"]);
    setNewBusinessHours(defaultBusinessHours);
    form.reset();
    void loadData();
    showNotice("店舗を追加しました。");
  }

  async function createBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const type = String(formData.get("type") ?? "");

    if (!name.trim()) return;

    const response = await fetch("/api/brands", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "ブランドを保存できませんでした。");
      return;
    }

    setBrandsData((items) => [
      ...items.filter((item) => item.name !== name),
      { name, type: type || "未設定" }
    ]);
    form.reset();
    showNotice("ブランドを追加しました。");
  }

  function deleteStore(store: StoreItem) {
    if (!window.confirm(`${store.name} を削除しますか？`)) return;

    setStoresData((items) => items.filter((item) => item.name !== store.name));
    void fetch("/api/stores", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: store.name })
    }).then(async (response) => {
      if (response.ok) {
        showNotice("店舗を削除しました。");
        return;
      }
      const body = await response.json();
      setStoresData((items) => (items.some((item) => item.name === store.name) ? items : [...items, store]));
      window.alert(body.error ?? "店舗を削除できませんでした。");
    });
  }

  function deleteBrand(brand: BrandItem) {
    if (!window.confirm(`${brand.name} を削除しますか？`)) return;

    setBrandsData((items) => items.filter((item) => item.name !== brand.name));
    void fetch("/api/brands", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: brand.name })
    }).then(async (response) => {
      if (response.ok) {
        showNotice("ブランドを削除しました。");
        return;
      }
      const body = await response.json();
      setBrandsData((items) => (items.some((item) => item.name === brand.name) ? items : [...items, brand]));
      window.alert(body.error ?? "ブランドを削除できませんでした。");
    });
  }

  async function saveBrandEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBrand) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextName = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "").trim() || "未設定";

    if (!nextName) return;

    formData.set("currentName", editingBrand.name);

    const response = await fetch("/api/brands", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "ブランドを更新できませんでした。");
      return;
    }

    setBrandsData((items) =>
      items.map((item) => item.name === editingBrand.name ? { name: nextName, type } : item)
    );
    setStoresData((items) =>
      items.map((store) => ({
        ...store,
        brands: store.brands.map((brandName) => brandName === editingBrand.name ? nextName : brandName)
      }))
    );
    setEditingBrand(null);
    showNotice("ブランドを更新しました。");
  }

  async function saveStoreEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStore) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextName = String(formData.get("name") ?? "").trim();
    const companyName = String(formData.get("companyName") ?? "").trim();
    const owner = String(formData.get("owner") ?? "").trim();
    const reservationNote = String(formData.get("reservationNote") ?? "").trim();
    const payrollCycleType = String(formData.get("payrollCycleType") ?? "month_end") === "specified_day" ? "specified_day" : "month_end";
    const payrollClosingDay = payrollCycleType === "month_end" ? 31 : Math.max(1, Math.min(30, Math.round(Number(formData.get("payrollClosingDay") ?? editingPayrollClosingDay) || editingPayrollClosingDay)));
    const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? editingSocialInsurancePrefecture);

    if (!nextName) return;

    formData.set("currentName", editingStore.name);
    formData.set("businessHours", serializeBusinessHours(editingBusinessHours));
    editingStoreBrands.forEach((brandName) => formData.append("brand", brandName));
    editingSalesSourcePlatforms.forEach((platform) => formData.set(`salesSource:${platform}:enabled`, "on"));

    const response = await fetch("/api/stores", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "店舗を更新できませんでした。");
      return;
    }

    setStoresData((items) =>
      items.map((item) => item.name === editingStore.name ? { ...item, name: nextName, companyName, owner, brands: editingStoreBrands, businessHours: editingBusinessHours, reservationNote, payrollCycleType, payrollClosingDay, socialInsurancePrefecture } : item)
    );
    setEditingStore(null);
    setEditingStoreBrands([]);
    setEditingSalesSourcePlatforms([]);
    setEditingReservationNote("");
    setEditingStoreTab("basic");
    void loadData();
    showNotice("店舗を更新しました。");
  }

  function startEditingStore(store: StoreItem) {
    setEditingStore(store);
    setEditingStoreBrands(store.brands);
    setEditingBusinessHours(normalizeBusinessHours(store.businessHours));
    setEditingStoreName(store.name);
    setEditingCompanyName(store.companyName ?? "");
    setEditingOwner(store.owner);
    setEditingReservationNote(store.reservationNote ?? "");
    setEditingStoreTab("basic");
    setEditingPayrollCycleType(store.payrollCycleType === "specified_day" ? "specified_day" : "month_end");
    setEditingPayrollClosingDay(store.payrollCycleType === "specified_day" ? store.payrollClosingDay ?? 25 : 25);
    setEditingSocialInsurancePrefecture(store.socialInsurancePrefecture ?? "福岡県");
    setEditingSalesSourcePlatforms(Array.from(new Set((store.salesSources ?? []).filter((source) => source.isEnabled).map((source) => source.platform))));
  }

  function toggleBrandSelection(
    current: string[],
    brandName: string,
    checked: boolean
  ) {
    const allBrandNames = brandsData.map((brand) => brand.name);
    const concreteBrandNames = allBrandNames.filter((name) => name !== "共通");

    if (brandName === "共通") {
      return checked ? concreteBrandNames : [];
    }

    const nextConcrete = checked
      ? Array.from(new Set([...current.filter((name) => name !== "共通"), brandName]))
      : current.filter((name) => name !== "共通" && name !== brandName);
    const hasAllConcreteBrands = concreteBrandNames.every((name) => nextConcrete.includes(name));

    return nextConcrete;
  }

  function toggleStoreBrand(brandName: string, checked: boolean) {
    setSelectedStoreBrands((current) => toggleBrandSelection(current, brandName, checked));
  }

  function toggleEditingStoreBrand(brandName: string, checked: boolean) {
    setEditingStoreBrands((current) => toggleBrandSelection(current, brandName, checked));
  }

  function toggleSalesSourcePlatform(current: string[], platform: string, checked: boolean) {
    return checked
      ? Array.from(new Set([...current, platform]))
      : current.filter((item) => item !== platform);
  }

  function formatStoreSalesSources(store: StoreItem) {
    const platforms = Array.from(new Set((store.salesSources ?? []).filter((source) => source.isEnabled).map((source) => source.platform)));
    if (platforms.length === 0) return "売上源未設定";
    return platforms.map((platform) => salesSourceDefinitions.find((source) => source.platform === platform)?.label ?? platform).join(" / ");
  }

  function formatStoreBrands(brandNames: string[]) {
    const concreteBrandNames = brandsData.map((brand) => brand.name).filter((name) => name !== "共通");
    const hasAllConcreteBrands = concreteBrandNames.length > 0 && concreteBrandNames.every((name) => brandNames.includes(name));

    if (hasAllConcreteBrands) {
      return "共通（全ブランド）";
    }

    return brandNames.length > 0 ? brandNames.join(" / ") : "ブランド未設定";
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
            <p className="eyebrow">店舗とブランドの基本情報</p>
            <h2>店舗・ブランド</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
        </header>

        <section className="management-grid">
          <section className="panel">
            <PanelTitle title="店舗管理" subtitle="Foundr1 OS 全体で共有する店舗情報を管理。予約、販売状態、手順書、勤怠、POS の基礎データとして利用します。" />
            <div className="management-list">
              {storesData.map((store) => (
                <article className="management-row" key={store.name}>
                  <div>
                    <strong>{store.name}</strong>
                    <p>{store.companyName || "所属会社未設定"} / {store.owner || "担当者未設定"}</p>
                    <small>{formatStoreBrands(store.brands)}</small>
                    <small>売上源: {formatStoreSalesSources(store)}</small>
                    <small>営業時間: {formatBusinessHoursSummary(store.businessHours)}</small>
                    <small>給与: {store.payrollCycleType === "specified_day" ? `${store.payrollClosingDay ?? 25}日締め` : "月末締め"} / 社保 {store.socialInsurancePrefecture ?? "福岡県"}</small>
                    {store.reservationNote ? <small>予約メモ: {store.reservationNote}</small> : null}
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => startEditingStore(store)}>
                      編集
                    </button>
                    <button className="text-button danger-button" type="button" onClick={() => deleteStore(store)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {storesData.length === 0 ? (
                <div className="empty-state">登録済みの店舗はありません</div>
              ) : null}
            </div>
            <div className="management-subsection-title">
              <h4>新しい店舗を追加</h4>
              <p>ブランド、営業時間、予約画面メモを設定すると、Store 画面と予約受付にも反映されます。</p>
            </div>
            <form className="management-form" onSubmit={createStore}>
              <label>
                <span>店舗名</span>
                <input name="name" placeholder="例: 天神店" />
              </label>
              <label>
                <span>所属会社</span>
                <input name="companyName" placeholder="例: 株式会社丸九" />
              </label>
              <label>
                <span>担当者メモ</span>
                <input name="owner" placeholder="例: 店長名・担当者名" />
              </label>
              <BusinessHoursEditor value={newBusinessHours} onChange={setNewBusinessHours} />
              <label>
                <span>予約画面メモ</span>
                <input name="reservationNote" placeholder="例: ラストオーダーは閉店30分前" />
              </label>
              <div className="checkbox-group">
                <span>取り扱いブランド</span>
                {brandsData.map((brand) => (
                  <label key={brand.name}>
                    <input
                      type="checkbox"
                      name="brand"
                      value={brand.name}
                      checked={selectedStoreBrands.includes(brand.name)}
                      onChange={(event) => toggleStoreBrand(brand.name, event.target.checked)}
                    />
                    {brand.name === "共通" ? "共通（全ブランド）" : brand.name}
                  </label>
                ))}
              </div>
              <SalesSourceSelector
                selectedPlatforms={selectedSalesSourcePlatforms}
                onToggle={(platform, checked) => setSelectedSalesSourcePlatforms((current) => toggleSalesSourcePlatform(current, platform, checked))}
                selectedBrandCount={selectedStoreBrands.length}
              />
              <button className="primary-button" type="submit">店舗を追加</button>
            </form>
          </section>

          <section className="panel">
            <PanelTitle title="ブランド管理" subtitle="商品用途として使うブランドを管理" />
            <form className="management-form" onSubmit={createBrand}>
              <label>
                <span>ブランド名</span>
                <input name="name" placeholder="例: nanacha" />
              </label>
              <label>
                <span>種類</span>
                <input name="type" placeholder="例: ミルクティー" />
              </label>
              <button className="primary-button" type="submit">ブランドを追加</button>
            </form>
            <div className="management-list">
              {brandsData.map((brand) => (
                <article className="management-row" key={brand.name}>
                  <div>
                    <strong>{brand.name}</strong>
                    <p>{brand.type}</p>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => setEditingBrand(brand)}>
                      編集
                    </button>
                    <button className="text-button danger-button" type="button" onClick={() => deleteBrand(brand)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {brandsData.length === 0 ? (
                <div className="empty-state">ブランドを読み込み中です</div>
              ) : null}
            </div>
          </section>
        </section>
      </section>

      {editingStore ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-edit-title">
          <form className="edit-modal" onSubmit={saveStoreEdit}>
            <div className="modal-heading">
              <div>
                <h3 id="store-edit-title">店舗を編集</h3>
                <p>{editingStore.name}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingStore(null)}>
                閉じる
              </button>
            </div>
            <div className="store-settings-tabs" aria-label="店舗設定メニュー">
              <button className={editingStoreTab === "basic" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("basic")}>基本情報</button>
              <button className={editingStoreTab === "hours" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("hours")}>営業時間</button>
              <button className={editingStoreTab === "sales" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("sales")}>売上源</button>
              <button className={editingStoreTab === "payroll" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("payroll")}>給与計算</button>
            </div>
            <div className="edit-fields">
              {editingStoreTab === "basic" ? (
                <>
                  <label>
                    <span>店舗名</span>
                    <input name="name" value={editingStoreName} onChange={(event) => setEditingStoreName(event.target.value)} />
                  </label>
                  <label>
                    <span>所属会社</span>
                    <input name="companyName" value={editingCompanyName} onChange={(event) => setEditingCompanyName(event.target.value)} placeholder="例: 株式会社丸九" />
                  </label>
                  <label>
                    <span>担当者メモ</span>
                    <input name="owner" value={editingOwner} onChange={(event) => setEditingOwner(event.target.value)} placeholder="例: 店長名・担当者名" />
                  </label>
                  <label>
                    <span>予約画面メモ</span>
                    <input
                      name="reservationNote"
                      value={editingReservationNote}
                      onChange={(event) => setEditingReservationNote(event.target.value)}
                      placeholder="例: ラストオーダーは閉店30分前"
                    />
                  </label>
                  <div className="checkbox-group">
                    <span>取り扱いブランド</span>
                    {brandsData.map((brand) => (
                      <label key={brand.name}>
                        <input
                          type="checkbox"
                          value={brand.name}
                          checked={editingStoreBrands.includes(brand.name)}
                          onChange={(event) => toggleEditingStoreBrand(brand.name, event.target.checked)}
                        />
                        {brand.name === "共通" ? "共通（全ブランド）" : brand.name}
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input type="hidden" name="name" value={editingStoreName} />
                  <input type="hidden" name="companyName" value={editingCompanyName} />
                  <input type="hidden" name="owner" value={editingOwner} />
                  <input type="hidden" name="reservationNote" value={editingReservationNote} />
                </>
              )}
              {editingStoreTab === "hours" ? (
                <BusinessHoursEditor value={editingBusinessHours} onChange={setEditingBusinessHours} />
              ) : null}
              {editingStoreTab === "sales" ? (
                <SalesSourceSelector
                  selectedPlatforms={editingSalesSourcePlatforms}
                  onToggle={(platform, checked) => setEditingSalesSourcePlatforms((current) => toggleSalesSourcePlatform(current, platform, checked))}
                  selectedBrandCount={editingStoreBrands.length}
                />
              ) : null}
              {editingStoreTab === "payroll" ? (
                <div className="store-payroll-settings">
                  <div className="store-payroll-summary">
                    <strong>給与計算期間</strong>
                    <p>{editingPayrollCycleType === "specified_day" ? `前月${editingPayrollClosingDay + 1}日から当月${editingPayrollClosingDay}日までを集計します。` : "毎月1日から月末までを集計します。"}</p>
                  </div>
                  <label>
                    <span>給与計算周期</span>
                    <select
                      name="payrollCycleType"
                      value={editingPayrollCycleType}
                      onChange={(event) => setEditingPayrollCycleType(event.target.value === "specified_day" ? "specified_day" : "month_end")}
                    >
                      <option value="month_end">月末締め</option>
                      <option value="specified_day">指定日締め</option>
                    </select>
                  </label>
                  <label>
                    <span>締め日</span>
                    <input
                      name="payrollClosingDay"
                      type="number"
                      min="1"
                      max="30"
                      value={editingPayrollClosingDay}
                      onChange={(event) => setEditingPayrollClosingDay(Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 25))))}
                      disabled={editingPayrollCycleType === "month_end"}
                    />
                  </label>
                  <label>
                    <span>社保地区</span>
                    <select name="socialInsurancePrefecture" value={editingSocialInsurancePrefecture} onChange={(event) => setEditingSocialInsurancePrefecture(event.target.value)}>
                      {prefectureOptions.map((prefecture) => (
                        <option value={prefecture} key={prefecture}>{prefecture}</option>
                      ))}
                    </select>
                  </label>
                  <div className="store-payroll-summary">
                    <strong>社会保険料率</strong>
                    <p>健康保険・厚生年金などの料率を地区別に参照するための基準地域です。料率表との連携は給与計算の次フェーズで反映します。</p>
                  </div>
                </div>
              ) : (
                <>
                  <input type="hidden" name="payrollCycleType" value={editingPayrollCycleType} />
                  <input type="hidden" name="payrollClosingDay" value={editingPayrollClosingDay} />
                  <input type="hidden" name="socialInsurancePrefecture" value={editingSocialInsurancePrefecture} />
                </>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingStore(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary-button">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingBrand ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="brand-edit-title">
          <form className="edit-modal" onSubmit={saveBrandEdit}>
            <div className="modal-heading">
              <div>
                <h3 id="brand-edit-title">ブランドを編集</h3>
                <p>{editingBrand.name}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingBrand(null)}>
                閉じる
              </button>
            </div>
            <div className="edit-fields">
              <label>
                <span>ブランド名</span>
                <input name="name" defaultValue={editingBrand.name} />
              </label>
              <label>
                <span>種類</span>
                <input name="type" defaultValue={editingBrand.type} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingBrand(null)}>
                キャンセル
              </button>
              <button type="submit" className="primary-button">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function SalesSourceSelector({
  selectedPlatforms,
  onToggle,
  selectedBrandCount
}: {
  selectedPlatforms: string[];
  onToggle: (platform: string, checked: boolean) => void;
  selectedBrandCount?: number;
}) {
  return (
    <div className="checkbox-group sales-source-settings">
      <span>売上源</span>
      {salesSourceDefinitions.map((source) => {
        const generatedCount = source.sourceType === "delivery" ? Math.max(1, selectedBrandCount ?? 1) : 1;
        return (
          <label key={source.platform}>
            <input
              type="checkbox"
              name={`salesSource:${source.platform}:enabled`}
              checked={selectedPlatforms.includes(source.platform)}
              onChange={(event) => onToggle(source.platform, event.target.checked)}
            />
            <span>
              {source.label}
              {source.sourceType === "delivery" ? ` / ブランド別 ${generatedCount}件` : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function BusinessHoursEditor({
  value,
  onChange
}: {
  value: StoreBusinessHours;
  onChange: (value: StoreBusinessHours) => void;
}) {
  function updateDay(day: WeekdayKey, patch: Partial<StoreBusinessHours[WeekdayKey]>) {
    onChange({
      ...value,
      [day]: {
        ...value[day],
        ...patch
      }
    });
  }

  return (
    <div className="business-hours-editor">
      <span>営業時間</span>
      <div className="business-hours-grid">
        {weekdayKeys.map((day) => (
          <div className="business-hours-row" key={day}>
            <label className="business-hours-closed">
              <input
                type="checkbox"
                checked={value[day].closed}
                onChange={(event) => updateDay(day, { closed: event.target.checked })}
              />
              {weekdayLabels[day]} 休業
            </label>
            <input
              type="time"
              value={value[day].open}
              disabled={value[day].closed}
              onChange={(event) => updateDay(day, { open: event.target.value })}
              aria-label={`${weekdayLabels[day]} 開店時間`}
            />
            <input
              type="time"
              value={value[day].close}
              disabled={value[day].closed}
              onChange={(event) => updateDay(day, { close: event.target.value })}
              aria-label={`${weekdayLabels[day]} 閉店時間`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
