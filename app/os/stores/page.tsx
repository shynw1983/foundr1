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
  companyLegalName?: string;
  invoiceRegistrationNumber?: string;
  companyAddress?: string;
  companyPhone?: string;
  owner: string;
  brands: string[];
  businessHours?: unknown;
  reservationNote?: string;
  payrollCycleType?: "month_end" | "specified_day";
  payrollClosingDay?: number;
  socialInsurancePrefecture?: string;
  weatherLocationName?: string;
  weatherLatitude?: number | null;
  weatherLongitude?: number | null;
  attendanceLocationEnabled?: boolean;
  attendanceLatitude?: number | null;
  attendanceLongitude?: number | null;
  attendanceRadiusMeters?: number;
  attendanceAccuracyThresholdMeters?: number;
  shiftFirstHalfSubmissionDeadlineDay?: number;
  shiftSecondHalfSubmissionDeadlineDay?: number;
  shiftSubmissionDeadlineTime?: string;
  salesSources?: SalesSourceItem[];
  paymentAccount?: PaymentAccountItem | null;
};

type SalesSourceItem = {
  platform: string;
  label: string;
  sourceType: string;
  brandName: string;
  isEnabled: boolean;
};

type PaymentAccountItem = {
  provider: string;
  accountName: string;
  secretKeyEnvName: string;
  hasSecretKey: boolean;
  webhookSecretEnvName: string;
  hasWebhookSecret: boolean;
  paymentTypes: string[];
  paymentTypesEnvName: string;
  isActive: boolean;
};

type BrandItem = {
  name: string;
  type: string;
};

type StoreEditTab = "basic" | "hours" | "sales" | "payment" | "receipt" | "payroll";

function salesSourceKey(platform: string, brandName = "") {
  return `${platform}::${brandName}`;
}

function salesSourceFormField(platform: string, brandName = "") {
  return brandName
    ? `salesSource:${platform}:brand:${brandName}:enabled`
    : `salesSource:${platform}:enabled`;
}

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

function parseOptionalCoordinate(value: FormDataEntryValue | string | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const coordinate = Number(text);
  return Number.isFinite(coordinate) ? coordinate : null;
}

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
  const [editingCompanyLegalName, setEditingCompanyLegalName] = useState("");
  const [editingInvoiceRegistrationNumber, setEditingInvoiceRegistrationNumber] = useState("");
  const [editingCompanyAddress, setEditingCompanyAddress] = useState("");
  const [editingCompanyPhone, setEditingCompanyPhone] = useState("");
  const [editingOwner, setEditingOwner] = useState("");
  const [editingReservationNote, setEditingReservationNote] = useState("");
  const [editingWeatherLocationName, setEditingWeatherLocationName] = useState("");
  const [editingWeatherLatitude, setEditingWeatherLatitude] = useState("");
  const [editingWeatherLongitude, setEditingWeatherLongitude] = useState("");
  const [editingAttendanceLocationEnabled, setEditingAttendanceLocationEnabled] = useState(false);
  const [newAttendanceAddress, setNewAttendanceAddress] = useState("");
  const [newAttendanceLatitude, setNewAttendanceLatitude] = useState("");
  const [newAttendanceLongitude, setNewAttendanceLongitude] = useState("");
  const [newGeocodeMessage, setNewGeocodeMessage] = useState("");
  const [isNewGeocoding, setIsNewGeocoding] = useState(false);
  const [editingAttendanceAddress, setEditingAttendanceAddress] = useState("");
  const [editingAttendanceLatitude, setEditingAttendanceLatitude] = useState("");
  const [editingAttendanceLongitude, setEditingAttendanceLongitude] = useState("");
  const [editingAttendanceRadiusMeters, setEditingAttendanceRadiusMeters] = useState("100");
  const [editingAttendanceAccuracyThresholdMeters, setEditingAttendanceAccuracyThresholdMeters] = useState("100");
  const [editingGeocodeMessage, setEditingGeocodeMessage] = useState("");
  const [isEditingGeocoding, setIsEditingGeocoding] = useState(false);
  const [editingStoreTab, setEditingStoreTab] = useState<StoreEditTab>("basic");
  const [editingPayrollCycleType, setEditingPayrollCycleType] = useState<"month_end" | "specified_day">("month_end");
  const [editingPayrollClosingDay, setEditingPayrollClosingDay] = useState(25);
  const [editingSocialInsurancePrefecture, setEditingSocialInsurancePrefecture] = useState("福岡県");
  const [editingShiftFirstHalfDeadlineDay, setEditingShiftFirstHalfDeadlineDay] = useState(25);
  const [editingShiftSecondHalfDeadlineDay, setEditingShiftSecondHalfDeadlineDay] = useState(10);
  const [editingShiftDeadlineTime, setEditingShiftDeadlineTime] = useState("23:59");
  const [selectedSalesSourceKeys, setSelectedSalesSourceKeys] = useState<string[]>([salesSourceKey("smaregi")]);
  const [editingSalesSourceKeys, setEditingSalesSourceKeys] = useState<string[]>([]);
  const [editingKomojuEnabled, setEditingKomojuEnabled] = useState(false);
  const [editingKomojuAccountName, setEditingKomojuAccountName] = useState("");
  const [editingKomojuSecretKeyEnvName, setEditingKomojuSecretKeyEnvName] = useState("");
  const [editingKomojuWebhookSecretEnvName, setEditingKomojuWebhookSecretEnvName] = useState("");
  const [editingKomojuPaymentTypesEnvName, setEditingKomojuPaymentTypesEnvName] = useState("");
  const [editingKomojuPaymentTypes, setEditingKomojuPaymentTypes] = useState("");

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

  async function geocodeAddress(address: string) {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) throw new Error("住所を入力してください。");

    const params = new URLSearchParams({ address: trimmedAddress });
    const response = await fetch(`/api/stores/geocode?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { error?: string; latitude?: number; longitude?: number; label?: string };
    if (!response.ok || typeof body.latitude !== "number" || typeof body.longitude !== "number") {
      throw new Error(body.error ?? "住所から座標を取得できませんでした。");
    }
    return body;
  }

  async function applyNewAttendanceGeocode() {
    setIsNewGeocoding(true);
    setNewGeocodeMessage("");
    try {
      const result = await geocodeAddress(newAttendanceAddress);
      setNewAttendanceLatitude(String(result.latitude));
      setNewAttendanceLongitude(String(result.longitude));
      setNewAttendanceAddress(result.label ?? newAttendanceAddress);
      setNewGeocodeMessage("座標を入力しました。");
    } catch (error) {
      setNewGeocodeMessage(error instanceof Error ? error.message : "住所から座標を取得できませんでした。");
    } finally {
      setIsNewGeocoding(false);
    }
  }

  async function applyEditingAttendanceGeocode() {
    setIsEditingGeocoding(true);
    setEditingGeocodeMessage("");
    try {
      const result = await geocodeAddress(editingAttendanceAddress || editingCompanyAddress || editingStoreName);
      setEditingAttendanceLatitude(String(result.latitude));
      setEditingAttendanceLongitude(String(result.longitude));
      setEditingAttendanceAddress(result.label ?? editingAttendanceAddress);
      setEditingWeatherLocationName((current) => current || result.label || editingAttendanceAddress);
      setEditingGeocodeMessage("座標を入力しました。");
    } catch (error) {
      setEditingGeocodeMessage(error instanceof Error ? error.message : "住所から座標を取得できませんでした。");
    } finally {
      setIsEditingGeocoding(false);
    }
  }

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const companyName = String(formData.get("companyName") ?? "");
    const owner = String(formData.get("owner") ?? "");
    const reservationNote = String(formData.get("reservationNote") ?? "");
    const weatherLocationName = String(formData.get("weatherLocationName") ?? "");
    const weatherLatitude = parseOptionalCoordinate(formData.get("weatherLatitude"));
    const weatherLongitude = parseOptionalCoordinate(formData.get("weatherLongitude"));
    const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
    const attendanceLatitude = parseOptionalCoordinate(formData.get("attendanceLatitude"));
    const attendanceLongitude = parseOptionalCoordinate(formData.get("attendanceLongitude"));
    const attendanceRadiusMeters = Math.max(10, Math.min(2000, Math.round(Number(formData.get("attendanceRadiusMeters") ?? 100) || 100)));
    const attendanceAccuracyThresholdMeters = Math.max(10, Math.min(2000, Math.round(Number(formData.get("attendanceAccuracyThresholdMeters") ?? 100) || 100)));
    const selectedBrands = formData.getAll("brand").map((value) => String(value));
    formData.set("businessHours", serializeBusinessHours(newBusinessHours));
    formData.set("payrollCycleType", "month_end");
    formData.set("payrollClosingDay", "31");
    formData.set("socialInsurancePrefecture", "福岡県");
    selectedSalesSourceKeys.forEach((key) => {
      const [platform, brandName = ""] = key.split("::");
      formData.set(salesSourceFormField(platform, brandName), "on");
    });

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
      {
        name,
        companyName,
        owner,
        brands: selectedBrands,
        businessHours: newBusinessHours,
        reservationNote,
        payrollCycleType: "month_end",
        payrollClosingDay: 31,
        socialInsurancePrefecture: "福岡県",
        weatherLocationName,
        weatherLatitude,
        weatherLongitude,
        attendanceLocationEnabled,
        attendanceLatitude,
        attendanceLongitude,
        attendanceRadiusMeters,
        attendanceAccuracyThresholdMeters
      }
    ]);
    setSelectedStoreBrands([]);
    setSelectedSalesSourceKeys([salesSourceKey("smaregi")]);
    setNewBusinessHours(defaultBusinessHours);
    setNewAttendanceAddress("");
    setNewAttendanceLatitude("");
    setNewAttendanceLongitude("");
    setNewGeocodeMessage("");
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
    const companyLegalName = String(formData.get("companyLegalName") ?? "").trim();
    const invoiceRegistrationNumber = String(formData.get("invoiceRegistrationNumber") ?? "").trim();
    const companyAddress = String(formData.get("companyAddress") ?? "").trim();
    const companyPhone = String(formData.get("companyPhone") ?? "").trim();
    const owner = String(formData.get("owner") ?? "").trim();
    const reservationNote = String(formData.get("reservationNote") ?? "").trim();
    const weatherLocationName = String(formData.get("weatherLocationName") ?? editingWeatherLocationName).trim();
    const weatherLatitude = parseOptionalCoordinate(formData.get("weatherLatitude") ?? editingWeatherLatitude);
    const weatherLongitude = parseOptionalCoordinate(formData.get("weatherLongitude") ?? editingWeatherLongitude);
    const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
    const attendanceLatitude = parseOptionalCoordinate(formData.get("attendanceLatitude") ?? editingAttendanceLatitude);
    const attendanceLongitude = parseOptionalCoordinate(formData.get("attendanceLongitude") ?? editingAttendanceLongitude);
    const attendanceRadiusMeters = Math.max(10, Math.min(2000, Math.round(Number(formData.get("attendanceRadiusMeters") ?? editingAttendanceRadiusMeters) || 100)));
    const attendanceAccuracyThresholdMeters = Math.max(10, Math.min(2000, Math.round(Number(formData.get("attendanceAccuracyThresholdMeters") ?? editingAttendanceAccuracyThresholdMeters) || 100)));
    const payrollCycleType = String(formData.get("payrollCycleType") ?? "month_end") === "specified_day" ? "specified_day" : "month_end";
    const payrollClosingDay = payrollCycleType === "month_end" ? 31 : Math.max(1, Math.min(30, Math.round(Number(formData.get("payrollClosingDay") ?? editingPayrollClosingDay) || editingPayrollClosingDay)));
    const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? editingSocialInsurancePrefecture);
    const shiftFirstHalfSubmissionDeadlineDay = Math.max(1, Math.min(28, Math.round(Number(formData.get("shiftFirstHalfSubmissionDeadlineDay") ?? editingShiftFirstHalfDeadlineDay) || editingShiftFirstHalfDeadlineDay)));
    const shiftSecondHalfSubmissionDeadlineDay = Math.max(1, Math.min(28, Math.round(Number(formData.get("shiftSecondHalfSubmissionDeadlineDay") ?? editingShiftSecondHalfDeadlineDay) || editingShiftSecondHalfDeadlineDay)));
    const shiftSubmissionDeadlineTime = String(formData.get("shiftSubmissionDeadlineTime") ?? editingShiftDeadlineTime);

    if (!nextName) return;

    formData.set("currentName", editingStore.name);
    formData.set("businessHours", serializeBusinessHours(editingBusinessHours));
    editingStoreBrands.forEach((brandName) => formData.append("brand", brandName));
    editingSalesSourceKeys.forEach((key) => {
      const [platform, brandName = ""] = key.split("::");
      formData.set(salesSourceFormField(platform, brandName), "on");
    });
    if (editingKomojuEnabled) formData.set("komojuEnabled", "on");
    formData.set("komojuAccountName", editingKomojuAccountName);
    formData.set("komojuSecretKeyEnvName", editingKomojuSecretKeyEnvName);
    formData.set("komojuWebhookSecretEnvName", editingKomojuWebhookSecretEnvName);
    formData.set("komojuPaymentTypesEnvName", editingKomojuPaymentTypesEnvName);
    formData.set("komojuPaymentTypes", editingKomojuPaymentTypes);

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
      items.map((item) => item.name === editingStore.name ? {
        ...item,
        name: nextName,
        companyName,
        companyLegalName,
        invoiceRegistrationNumber,
        companyAddress,
        companyPhone,
        owner,
        brands: editingStoreBrands,
        businessHours: editingBusinessHours,
        reservationNote,
        payrollCycleType,
        payrollClosingDay,
        socialInsurancePrefecture,
        weatherLocationName,
        weatherLatitude,
        weatherLongitude,
        attendanceLocationEnabled,
        attendanceLatitude,
        attendanceLongitude,
        attendanceRadiusMeters,
        attendanceAccuracyThresholdMeters,
        shiftFirstHalfSubmissionDeadlineDay,
        shiftSecondHalfSubmissionDeadlineDay,
        shiftSubmissionDeadlineTime
      } : item)
    );
    setEditingStore(null);
    setEditingStoreBrands([]);
    setEditingSalesSourceKeys([]);
    setEditingKomojuEnabled(false);
    setEditingKomojuAccountName("");
    setEditingKomojuSecretKeyEnvName("");
    setEditingKomojuWebhookSecretEnvName("");
    setEditingKomojuPaymentTypesEnvName("");
    setEditingKomojuPaymentTypes("");
    setEditingReservationNote("");
    setEditingWeatherLocationName("");
    setEditingWeatherLatitude("");
    setEditingWeatherLongitude("");
    setEditingAttendanceLocationEnabled(false);
    setEditingAttendanceAddress("");
    setEditingAttendanceLatitude("");
    setEditingAttendanceLongitude("");
    setEditingAttendanceRadiusMeters("100");
    setEditingAttendanceAccuracyThresholdMeters("100");
    setEditingShiftFirstHalfDeadlineDay(25);
    setEditingShiftSecondHalfDeadlineDay(10);
    setEditingShiftDeadlineTime("23:59");
    setEditingGeocodeMessage("");
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
    setEditingCompanyLegalName(store.companyLegalName ?? "");
    setEditingInvoiceRegistrationNumber(store.invoiceRegistrationNumber ?? "");
    setEditingCompanyAddress(store.companyAddress ?? "");
    setEditingCompanyPhone(store.companyPhone ?? "");
    setEditingOwner(store.owner);
    setEditingReservationNote(store.reservationNote ?? "");
    setEditingWeatherLocationName(store.weatherLocationName ?? "");
    setEditingWeatherLatitude(store.weatherLatitude === null || store.weatherLatitude === undefined ? "" : String(store.weatherLatitude));
    setEditingWeatherLongitude(store.weatherLongitude === null || store.weatherLongitude === undefined ? "" : String(store.weatherLongitude));
    setEditingAttendanceLocationEnabled(store.attendanceLocationEnabled === true);
    setEditingAttendanceAddress(store.companyAddress || store.weatherLocationName || store.name);
    setEditingAttendanceLatitude(store.attendanceLatitude === null || store.attendanceLatitude === undefined ? "" : String(store.attendanceLatitude));
    setEditingAttendanceLongitude(store.attendanceLongitude === null || store.attendanceLongitude === undefined ? "" : String(store.attendanceLongitude));
    setEditingAttendanceRadiusMeters(String(store.attendanceRadiusMeters ?? 100));
    setEditingAttendanceAccuracyThresholdMeters(String(store.attendanceAccuracyThresholdMeters ?? 100));
    setEditingGeocodeMessage("");
    setEditingStoreTab("basic");
    setEditingPayrollCycleType(store.payrollCycleType === "specified_day" ? "specified_day" : "month_end");
    setEditingPayrollClosingDay(store.payrollCycleType === "specified_day" ? store.payrollClosingDay ?? 25 : 25);
    setEditingSocialInsurancePrefecture(store.socialInsurancePrefecture ?? "福岡県");
    setEditingShiftFirstHalfDeadlineDay(store.shiftFirstHalfSubmissionDeadlineDay ?? 25);
    setEditingShiftSecondHalfDeadlineDay(store.shiftSecondHalfSubmissionDeadlineDay ?? 10);
    setEditingShiftDeadlineTime(store.shiftSubmissionDeadlineTime ?? "23:59");
    setEditingSalesSourceKeys(Array.from(new Set((store.salesSources ?? []).filter((source) => source.isEnabled).map((source) => salesSourceKey(source.platform, source.brandName)))));
    setEditingKomojuEnabled(store.paymentAccount?.isActive === true);
    setEditingKomojuAccountName(store.paymentAccount?.accountName ?? "");
    setEditingKomojuSecretKeyEnvName(store.paymentAccount?.secretKeyEnvName ?? "");
    setEditingKomojuWebhookSecretEnvName(store.paymentAccount?.webhookSecretEnvName ?? "");
    setEditingKomojuPaymentTypesEnvName(store.paymentAccount?.paymentTypesEnvName ?? "");
    setEditingKomojuPaymentTypes((store.paymentAccount?.paymentTypes ?? []).join(","));
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

  function toggleSalesSourceKey(current: string[], key: string, checked: boolean) {
    return checked
      ? Array.from(new Set([...current, key]))
      : current.filter((item) => item !== key);
  }

  function formatStoreSalesSources(store: StoreItem) {
    const sources = (store.salesSources ?? []).filter((source) => source.isEnabled);
    if (sources.length === 0) return "売上源未設定";
    return sources.map((source) => (
      source.brandName ? `${source.label} / ${source.brandName}` : source.label
    )).join(" / ");
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
                    <small>決済: {store.paymentAccount?.isActive ? `KOMOJU / ${store.paymentAccount.accountName || "アカウント名未設定"}` : "未設定"}</small>
                    <small>領収書: {store.invoiceRegistrationNumber || store.companyLegalName || store.companyAddress ? (store.invoiceRegistrationNumber || "登録番号未設定") : "未設定"}</small>
                    <small>営業時間: {formatBusinessHoursSummary(store.businessHours)}</small>
                    <small>給与: {store.payrollCycleType === "specified_day" ? `${store.payrollClosingDay ?? 25}日締め` : "月末締め"} / 社保 {store.socialInsurancePrefecture ?? "福岡県"}</small>
                    <small>天気: {store.weatherLocationName || (store.weatherLatitude && store.weatherLongitude ? `${store.weatherLatitude}, ${store.weatherLongitude}` : "福岡市（既定）")}</small>
                    <small>打刻地点: {store.attendanceLocationEnabled ? `${store.attendanceLatitude ?? "--"}, ${store.attendanceLongitude ?? "--"} / ${store.attendanceRadiusMeters ?? 100}m` : "位置制限なし"}</small>
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
              <div className="store-weather-settings">
                <strong>天気分析地点</strong>
                <p>未入力の場合は福岡市中心部の天気を売上分析の参考値として使用します。</p>
                <label>
                  <span>地点名</span>
                  <input name="weatherLocationName" placeholder="例: 福岡市中央区 清水店" />
                </label>
                <label>
                  <span>緯度</span>
                  <input name="weatherLatitude" inputMode="decimal" placeholder="例: 33.5902" />
                </label>
                <label>
                  <span>経度</span>
                  <input name="weatherLongitude" inputMode="decimal" placeholder="例: 130.4017" />
                </label>
              </div>
              <div className="store-weather-settings">
                <strong>モバイル打刻地点</strong>
                <p>店舗スタッフ本人のスマホ打刻で使用します。</p>
                <label className="inline-checkbox">
                  <input type="checkbox" name="attendanceLocationEnabled" />
                  位置範囲内のみ打刻を許可
                </label>
                <label className="store-geocode-address">
                  <span>住所から座標を取得</span>
                  <input
                    value={newAttendanceAddress}
                    onChange={(event) => setNewAttendanceAddress(event.target.value)}
                    placeholder="例: 福岡県福岡市中央区..."
                  />
                </label>
                <button className="secondary-button store-geocode-button" type="button" onClick={applyNewAttendanceGeocode} disabled={isNewGeocoding}>
                  {isNewGeocoding ? "取得中" : "座標を取得"}
                </button>
                {newGeocodeMessage ? <p className="store-geocode-message">{newGeocodeMessage}</p> : null}
                <label>
                  <span>緯度</span>
                  <input name="attendanceLatitude" inputMode="decimal" value={newAttendanceLatitude} onChange={(event) => setNewAttendanceLatitude(event.target.value)} placeholder="例: 33.5902" />
                </label>
                <label>
                  <span>経度</span>
                  <input name="attendanceLongitude" inputMode="decimal" value={newAttendanceLongitude} onChange={(event) => setNewAttendanceLongitude(event.target.value)} placeholder="例: 130.4017" />
                </label>
                <label>
                  <span>許可範囲（m）</span>
                  <input name="attendanceRadiusMeters" type="number" min="10" max="2000" defaultValue="100" />
                </label>
                <label>
                  <span>位置精度上限（m）</span>
                  <input name="attendanceAccuracyThresholdMeters" type="number" min="10" max="2000" defaultValue="100" />
                </label>
              </div>
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
                selectedKeys={selectedSalesSourceKeys}
                brandNames={selectedStoreBrands}
                onToggle={(key, checked) => setSelectedSalesSourceKeys((current) => toggleSalesSourceKey(current, key, checked))}
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
              <button className={editingStoreTab === "payment" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("payment")}>決済</button>
              <button className={editingStoreTab === "receipt" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("receipt")}>領収書</button>
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
                  <div className="store-weather-settings">
                    <strong>天気分析地点</strong>
                    <p>売上分析で日別・曜日別の天気参考値として使います。未入力の場合は福岡市中心部を使用します。</p>
                    <label>
                      <span>地点名</span>
                      <input name="weatherLocationName" value={editingWeatherLocationName} onChange={(event) => setEditingWeatherLocationName(event.target.value)} placeholder="例: 福岡市中央区 清水店" />
                    </label>
                    <label>
                      <span>緯度</span>
                      <input name="weatherLatitude" inputMode="decimal" value={editingWeatherLatitude} onChange={(event) => setEditingWeatherLatitude(event.target.value)} placeholder="例: 33.5902" />
                    </label>
                    <label>
                      <span>経度</span>
                      <input name="weatherLongitude" inputMode="decimal" value={editingWeatherLongitude} onChange={(event) => setEditingWeatherLongitude(event.target.value)} placeholder="例: 130.4017" />
                    </label>
                  </div>
                  <div className="store-weather-settings">
                    <strong>モバイル打刻地点</strong>
                    <p>店舗スタッフ本人のスマホ打刻で、店舗からの距離と位置精度を確認します。</p>
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        name="attendanceLocationEnabled"
                        checked={editingAttendanceLocationEnabled}
                        onChange={(event) => setEditingAttendanceLocationEnabled(event.target.checked)}
                      />
                      位置範囲内のみ打刻を許可
                    </label>
                    <label className="store-geocode-address">
                      <span>住所から座標を取得</span>
                      <input
                        value={editingAttendanceAddress}
                        onChange={(event) => setEditingAttendanceAddress(event.target.value)}
                        placeholder="例: 福岡県福岡市中央区..."
                      />
                    </label>
                    <button className="secondary-button store-geocode-button" type="button" onClick={applyEditingAttendanceGeocode} disabled={isEditingGeocoding}>
                      {isEditingGeocoding ? "取得中" : "座標を取得"}
                    </button>
                    {editingGeocodeMessage ? <p className="store-geocode-message">{editingGeocodeMessage}</p> : null}
                    <label>
                      <span>緯度</span>
                      <input name="attendanceLatitude" inputMode="decimal" value={editingAttendanceLatitude} onChange={(event) => setEditingAttendanceLatitude(event.target.value)} placeholder="例: 33.5902" />
                    </label>
                    <label>
                      <span>経度</span>
                      <input name="attendanceLongitude" inputMode="decimal" value={editingAttendanceLongitude} onChange={(event) => setEditingAttendanceLongitude(event.target.value)} placeholder="例: 130.4017" />
                    </label>
                    <label>
                      <span>許可範囲（m）</span>
                      <input name="attendanceRadiusMeters" type="number" min="10" max="2000" value={editingAttendanceRadiusMeters} onChange={(event) => setEditingAttendanceRadiusMeters(event.target.value)} />
                    </label>
                    <label>
                      <span>位置精度上限（m）</span>
                      <input name="attendanceAccuracyThresholdMeters" type="number" min="10" max="2000" value={editingAttendanceAccuracyThresholdMeters} onChange={(event) => setEditingAttendanceAccuracyThresholdMeters(event.target.value)} />
                    </label>
                  </div>
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
                  <input type="hidden" name="companyLegalName" value={editingCompanyLegalName} />
                  <input type="hidden" name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} />
                  <input type="hidden" name="companyAddress" value={editingCompanyAddress} />
                  <input type="hidden" name="companyPhone" value={editingCompanyPhone} />
                  <input type="hidden" name="owner" value={editingOwner} />
                  <input type="hidden" name="reservationNote" value={editingReservationNote} />
                  <input type="hidden" name="weatherLocationName" value={editingWeatherLocationName} />
                  <input type="hidden" name="weatherLatitude" value={editingWeatherLatitude} />
                  <input type="hidden" name="weatherLongitude" value={editingWeatherLongitude} />
                  {editingAttendanceLocationEnabled ? <input type="hidden" name="attendanceLocationEnabled" value="on" /> : null}
                  <input type="hidden" name="attendanceLatitude" value={editingAttendanceLatitude} />
                  <input type="hidden" name="attendanceLongitude" value={editingAttendanceLongitude} />
                  <input type="hidden" name="attendanceRadiusMeters" value={editingAttendanceRadiusMeters} />
                  <input type="hidden" name="attendanceAccuracyThresholdMeters" value={editingAttendanceAccuracyThresholdMeters} />
                </>
              )}
              {editingStoreTab === "hours" ? (
                <BusinessHoursEditor value={editingBusinessHours} onChange={setEditingBusinessHours} />
              ) : null}
              {editingStoreTab === "sales" ? (
                <SalesSourceSelector
                  selectedKeys={editingSalesSourceKeys}
                  brandNames={editingStoreBrands}
                  onToggle={(key, checked) => setEditingSalesSourceKeys((current) => toggleSalesSourceKey(current, key, checked))}
                />
              ) : null}
              {editingStoreTab === "payment" ? (
                <div className="store-payroll-settings">
                  <div className="store-payroll-summary">
                    <strong>KOMOJU 店舗決済</strong>
                    <p>麻辣烫のブランドサイトでこの店舗が選択されたときに使う KOMOJU アカウントです。Webhook URL は店舗ごとに分けて設定します。</p>
                  </div>
                  <label className="inline-checkbox">
                    <input
                      type="checkbox"
                      name="komojuEnabled"
                      checked={editingKomojuEnabled}
                      onChange={(event) => setEditingKomojuEnabled(event.target.checked)}
                    />
                    KOMOJU を有効にする
                  </label>
                  <label>
                    <span>決済アカウント名</span>
                    <input name="komojuAccountName" value={editingKomojuAccountName} onChange={(event) => setEditingKomojuAccountName(event.target.value)} placeholder="例: 清水店 KOMOJU" />
                  </label>
                  <label>
                    <span>Secret key env 名</span>
                    <input name="komojuSecretKeyEnvName" value={editingKomojuSecretKeyEnvName} onChange={(event) => setEditingKomojuSecretKeyEnvName(event.target.value)} placeholder="例: KOMOJU_SECRET_KEY_SHIMIZU" />
                  </label>
                  <label>
                    <span>Webhook secret env 名</span>
                    <input name="komojuWebhookSecretEnvName" value={editingKomojuWebhookSecretEnvName} onChange={(event) => setEditingKomojuWebhookSecretEnvName(event.target.value)} placeholder="例: KOMOJU_WEBHOOK_SECRET_SHIMIZU" />
                  </label>
                  <label>
                    <span>支払い方法 env 名</span>
                    <input name="komojuPaymentTypesEnvName" value={editingKomojuPaymentTypesEnvName} onChange={(event) => setEditingKomojuPaymentTypesEnvName(event.target.value)} placeholder="例: KOMOJU_SHIMIZU_PAYMENT_TYPES" />
                  </label>
                  <label>
                    <span>支払い方法（直接指定）</span>
                    <input name="komojuPaymentTypes" value={editingKomojuPaymentTypes} onChange={(event) => setEditingKomojuPaymentTypes(event.target.value)} placeholder="例: paypay,credit_card" />
                  </label>
                  <div className="store-payroll-summary">
                    <strong>Webhook URL</strong>
                    <p>{editingStore.id ? `/api/webhooks/komoju/${editingStore.id}` : "/api/webhooks/komoju/{storeId}"}</p>
                  </div>
                </div>
              ) : null}
              {editingStoreTab === "receipt" ? (
                <div className="store-payroll-settings">
                  <div className="store-payroll-summary">
                    <strong>領収書発行情報</strong>
                    <p>前台の取货号画面からダウンロードされる PDF 領収書に表示する会社情報です。この店舗に紐づく会社情報として保存されます。</p>
                  </div>
                  <label>
                    <span>宛名に表示する会社名</span>
                    <input name="companyLegalName" value={editingCompanyLegalName} onChange={(event) => setEditingCompanyLegalName(event.target.value)} placeholder="例: 株式会社丸九" />
                  </label>
                  <label>
                    <span>インボイス登録番号</span>
                    <input name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} onChange={(event) => setEditingInvoiceRegistrationNumber(event.target.value)} placeholder="例: T1234567890123" />
                  </label>
                  <label>
                    <span>会社住所</span>
                    <input name="companyAddress" value={editingCompanyAddress} onChange={(event) => setEditingCompanyAddress(event.target.value)} placeholder="例: 福岡県福岡市..." />
                  </label>
                  <label>
                    <span>会社電話番号</span>
                    <input name="companyPhone" value={editingCompanyPhone} onChange={(event) => setEditingCompanyPhone(event.target.value)} placeholder="例: 092-000-0000" />
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="companyLegalName" value={editingCompanyLegalName} />
                  <input type="hidden" name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} />
                  <input type="hidden" name="companyAddress" value={editingCompanyAddress} />
                  <input type="hidden" name="companyPhone" value={editingCompanyPhone} />
                </>
              )}
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
                  <div className="store-payroll-summary">
                    <strong>希望シフト提出期限</strong>
                    <p>スタッフ画面では、今日提出できる前半・後半の対象期間だけを自動表示します。</p>
                  </div>
                  <label>
                    <span>前半シフト締切日</span>
                    <input
                      name="shiftFirstHalfSubmissionDeadlineDay"
                      type="number"
                      min="1"
                      max="28"
                      value={editingShiftFirstHalfDeadlineDay}
                      onChange={(event) => setEditingShiftFirstHalfDeadlineDay(Math.max(1, Math.min(28, Math.round(Number(event.target.value) || 25))))}
                    />
                  </label>
                  <label>
                    <span>後半シフト締切日</span>
                    <input
                      name="shiftSecondHalfSubmissionDeadlineDay"
                      type="number"
                      min="1"
                      max="28"
                      value={editingShiftSecondHalfDeadlineDay}
                      onChange={(event) => setEditingShiftSecondHalfDeadlineDay(Math.max(1, Math.min(28, Math.round(Number(event.target.value) || 10))))}
                    />
                  </label>
                  <label>
                    <span>締切時刻</span>
                    <input
                      name="shiftSubmissionDeadlineTime"
                      type="time"
                      value={editingShiftDeadlineTime}
                      onChange={(event) => setEditingShiftDeadlineTime(event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="payrollCycleType" value={editingPayrollCycleType} />
                  <input type="hidden" name="payrollClosingDay" value={editingPayrollClosingDay} />
                  <input type="hidden" name="socialInsurancePrefecture" value={editingSocialInsurancePrefecture} />
                  <input type="hidden" name="shiftFirstHalfSubmissionDeadlineDay" value={editingShiftFirstHalfDeadlineDay} />
                  <input type="hidden" name="shiftSecondHalfSubmissionDeadlineDay" value={editingShiftSecondHalfDeadlineDay} />
                  <input type="hidden" name="shiftSubmissionDeadlineTime" value={editingShiftDeadlineTime} />
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
  selectedKeys,
  brandNames,
  onToggle,
}: {
  selectedKeys: string[];
  brandNames: string[];
  onToggle: (key: string, checked: boolean) => void;
}) {
  const concreteBrandNames = brandNames.filter((brandName) => brandName && brandName !== "共通");
  const directSources = salesSourceDefinitions.filter((source) => source.sourceType !== "delivery");
  const deliverySources = salesSourceDefinitions.filter((source) => source.sourceType === "delivery");

  return (
    <div className="checkbox-group sales-source-settings">
      <span>売上源</span>
      {directSources.map((source) => {
        const key = salesSourceKey(source.platform);
        return (
          <label key={key}>
            <input
              type="checkbox"
              name={salesSourceFormField(source.platform)}
              checked={selectedKeys.includes(key)}
              onChange={(event) => onToggle(key, event.target.checked)}
            />
            <span>{source.label}</span>
          </label>
        );
      })}
      <div className="sales-source-brand-grid">
        {deliverySources.map((source) => (
          <div className="sales-source-brand-group" key={source.platform}>
            <strong>{source.label}</strong>
            {concreteBrandNames.length > 0 ? concreteBrandNames.map((brandName) => {
              const key = salesSourceKey(source.platform, brandName);
              return (
                <label key={key}>
                  <input
                    type="checkbox"
                    name={salesSourceFormField(source.platform, brandName)}
                    checked={selectedKeys.includes(key)}
                    onChange={(event) => onToggle(key, event.target.checked)}
                  />
                  <span>{brandName}</span>
                </label>
              );
            }) : <small>先に取り扱いブランドを選択してください。</small>}
          </div>
        ))}
      </div>
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
