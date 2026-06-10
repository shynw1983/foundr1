"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  emptyCustomerDisplayNameSettings,
  normalizeCustomerDisplayNameSettings,
  type CustomerDisplayNameSettings
} from "../../../lib/customer-display-names";
import { normalizeDecimalInput } from "../../../lib/number-input";
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
  companyRepresentativeName?: string;
  invoiceRegistrationNumber?: string;
  receiptPurposeText?: string;
  receiptTaxRate?: number;
  companyAddress?: string;
  companyPhone?: string;
  privacyContactName?: string;
  privacyContactEmail?: string;
  privacyContactPhone?: string;
  customerDisplayNames?: CustomerDisplayNameSettings;
  owner: string;
  defaultProcurementStaffId?: string;
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

type StaffOption = {
  id: string;
  name: string;
  role: string;
  storeNames: string[];
};

type StoreEditTab = "basic" | "hours" | "operations" | "sales" | "customer" | "payment" | "receipt" | "payroll";

type StoreTemporaryClosure = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  publicMessage: string;
  status: string;
};

type AffectedClosureOrder = {
  id: string;
  pickupCode: string;
  pickupDate: string;
  pickupTime: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerPhone: string;
  closureId: string;
  reason: string;
  publicMessage: string;
};

function salesSourceKey(platform: string, brandName = "") {
  return `${platform}::${brandName}`;
}

function salesSourceFormField(platform: string, brandName = "") {
  return brandName
    ? `salesSource:${platform}:brand:${brandName}:enabled`
    : `salesSource:${platform}:enabled`;
}

function customerDisplayOverrideKey(brandName: string, platform: string) {
  return `${brandName}::${platform}`;
}

function getCustomerDisplayOverrideValue(settings: CustomerDisplayNameSettings, brandName: string, platform: string) {
  return settings.overrides.find((override) => override.brandName === brandName && override.platform === platform)?.displayName ?? "";
}

function getCustomerDisplayNameCandidates(brandNames: string[], selectedSourceKeys: string[]) {
  const concreteBrandNames = brandNames.filter((brandName) => brandName && brandName !== "共通");
  const brands = concreteBrandNames.length ? concreteBrandNames : [""];
  const selectedPlatforms = Array.from(new Set(
    selectedSourceKeys
      .map((key) => key.split("::")[0] ?? "")
      .filter(Boolean)
  ));
  const platforms = selectedPlatforms.length ? selectedPlatforms : ["web_reservation"];

  return platforms.flatMap((platform) => {
    const definition = salesSourceDefinitions.find((source) => source.platform === platform);
    return brands.map((brandName) => ({
      key: customerDisplayOverrideKey(brandName, platform),
      brandName,
      platform,
      sourceLabel: definition?.label ?? platform
    }));
  });
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
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
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
  const [editingCompanyRepresentativeName, setEditingCompanyRepresentativeName] = useState("");
  const [editingInvoiceRegistrationNumber, setEditingInvoiceRegistrationNumber] = useState("");
  const [editingReceiptPurposeText, setEditingReceiptPurposeText] = useState("テイクアウト飲食代");
  const [editingReceiptTaxRate, setEditingReceiptTaxRate] = useState("8");
  const [editingCompanyAddress, setEditingCompanyAddress] = useState("");
  const [editingCompanyPhone, setEditingCompanyPhone] = useState("");
  const [editingPrivacyContactName, setEditingPrivacyContactName] = useState("");
  const [editingPrivacyContactEmail, setEditingPrivacyContactEmail] = useState("");
  const [editingPrivacyContactPhone, setEditingPrivacyContactPhone] = useState("");
  const [editingCustomerDisplayNames, setEditingCustomerDisplayNames] = useState<CustomerDisplayNameSettings>(emptyCustomerDisplayNameSettings);
  const [editingOwner, setEditingOwner] = useState("");
  const [editingDefaultProcurementStaffId, setEditingDefaultProcurementStaffId] = useState("");
  const [editingReservationNote, setEditingReservationNote] = useState("");
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
  const [temporaryClosures, setTemporaryClosures] = useState<StoreTemporaryClosure[]>([]);
  const [affectedClosureOrders, setAffectedClosureOrders] = useState<AffectedClosureOrder[]>([]);
  const [closureDraft, setClosureDraft] = useState({
    date: "",
    startTime: "10:00",
    endTime: "22:00",
    reason: "臨時休業",
    publicMessage: "臨時休業のため、この時間帯は受付を停止しています。"
  });
  const [temporaryClosureLoading, setTemporaryClosureLoading] = useState(false);
  const [temporaryClosureMessage, setTemporaryClosureMessage] = useState("");

  async function loadData() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return;
    const data = await response.json() as {
      stores?: StoreItem[];
      brands?: BrandItem[];
      staffOptions?: StaffOption[];
    };

    if (data.stores) setStoresData(data.stores);
    if (data.brands) setBrandsData(data.brands);
    if (data.staffOptions) setStaffOptions(data.staffOptions);
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
      setEditingGeocodeMessage("座標を入力しました。");
    } catch (error) {
      setEditingGeocodeMessage(error instanceof Error ? error.message : "住所から座標を取得できませんでした。");
    } finally {
      setIsEditingGeocoding(false);
    }
  }

  async function loadTemporaryClosureSettings(storeId?: string) {
    if (!storeId) {
      setTemporaryClosures([]);
      setAffectedClosureOrders([]);
      return;
    }
    setTemporaryClosureLoading(true);
    setTemporaryClosureMessage("");
    try {
      const response = await fetch(`/api/os/store-temporary-closures?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as {
        temporaryClosures?: StoreTemporaryClosure[];
        affectedOrders?: AffectedClosureOrder[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "臨時休業を読み込めませんでした。");
      setTemporaryClosures(Array.isArray(body.temporaryClosures) ? body.temporaryClosures : []);
      setAffectedClosureOrders(Array.isArray(body.affectedOrders) ? body.affectedOrders : []);
    } catch (error) {
      setTemporaryClosures([]);
      setAffectedClosureOrders([]);
      setTemporaryClosureMessage(error instanceof Error ? error.message : "臨時休業を読み込めませんでした。");
    } finally {
      setTemporaryClosureLoading(false);
    }
  }

  async function saveTemporaryClosure() {
    if (!editingStore?.id) return;
    setTemporaryClosureLoading(true);
    setTemporaryClosureMessage("");
    try {
      const response = await fetch("/api/os/store-temporary-closures", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_temporary_closure",
          storeId: editingStore.id,
          closureDate: closureDraft.date,
          closureStartTime: closureDraft.startTime,
          closureEndTime: closureDraft.endTime,
          closureReason: closureDraft.reason,
          closurePublicMessage: closureDraft.publicMessage
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "臨時休業を保存できませんでした。");
      setClosureDraft((current) => ({ ...current, date: "" }));
      setTemporaryClosureMessage("臨時休業を保存しました。受け付け済み予約がある場合は下の一覧で対応してください。");
      await loadTemporaryClosureSettings(editingStore.id);
    } catch (error) {
      setTemporaryClosureMessage(error instanceof Error ? error.message : "臨時休業を保存できませんでした。");
    } finally {
      setTemporaryClosureLoading(false);
    }
  }

  async function cancelTemporaryClosure(closureId: string) {
    if (!editingStore?.id) return;
    setTemporaryClosureLoading(true);
    setTemporaryClosureMessage("");
    try {
      const response = await fetch("/api/os/store-temporary-closures", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_temporary_closure", storeId: editingStore.id, closureId })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "臨時休業を解除できませんでした。");
      setTemporaryClosureMessage("臨時休業を解除しました。");
      await loadTemporaryClosureSettings(editingStore.id);
    } catch (error) {
      setTemporaryClosureMessage(error instanceof Error ? error.message : "臨時休業を解除できませんでした。");
    } finally {
      setTemporaryClosureLoading(false);
    }
  }

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const companyName = String(formData.get("companyName") ?? "");
    const owner = String(formData.get("owner") ?? "");
    const defaultProcurementStaffId = String(formData.get("defaultProcurementStaffId") ?? "");
    const reservationNote = String(formData.get("reservationNote") ?? "");
    const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
    const attendanceLatitude = parseOptionalCoordinate(formData.get("attendanceLatitude"));
    const attendanceLongitude = parseOptionalCoordinate(formData.get("attendanceLongitude"));
    const weatherLocationName = newAttendanceAddress.trim() || name;
    const weatherLatitude = attendanceLatitude;
    const weatherLongitude = attendanceLongitude;
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
        defaultProcurementStaffId,
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

  async function deleteEditingStore() {
    if (!editingStore) return;
    if (!window.confirm(`${editingStore.name} を削除します。この操作は通常使いません。本当に続行しますか？`)) return;
    const typedName = window.prompt(`削除を確定するには、店舗名「${editingStore.name}」を入力してください。`);
    if (typedName !== editingStore.name) {
      window.alert("店舗名が一致しないため、削除を中止しました。");
      return;
    }
    if (!window.confirm("最後の確認です。店舗データを削除しますか？")) return;

    const storeToDelete = editingStore;
    const response = await fetch("/api/stores", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: storeToDelete.name })
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "店舗を削除できませんでした。");
      return;
    }
    setStoresData((items) => items.filter((item) => item.name !== storeToDelete.name));
    setEditingStore(null);
    showNotice("店舗を削除しました。");
  }

  async function deleteEditingBrand() {
    if (!editingBrand) return;
    if (!window.confirm(`${editingBrand.name} を削除します。この操作は通常使いません。本当に続行しますか？`)) return;
    const typedName = window.prompt(`削除を確定するには、ブランド名「${editingBrand.name}」を入力してください。`);
    if (typedName !== editingBrand.name) {
      window.alert("ブランド名が一致しないため、削除を中止しました。");
      return;
    }
    if (!window.confirm("最後の確認です。ブランドデータを削除しますか？")) return;

    const brandToDelete = editingBrand;
    const response = await fetch("/api/brands", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandToDelete.name })
    });
    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "ブランドを削除できませんでした。");
      return;
    }
    setBrandsData((items) => items.filter((item) => item.name !== brandToDelete.name));
    setEditingBrand(null);
    showNotice("ブランドを削除しました。");
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
    const companyRepresentativeName = String(formData.get("companyRepresentativeName") ?? "").trim();
    const invoiceRegistrationNumber = String(formData.get("invoiceRegistrationNumber") ?? "").trim();
    const receiptPurposeText = String(formData.get("receiptPurposeText") ?? "テイクアウト飲食代").trim() || "テイクアウト飲食代";
    const receiptTaxRate = Number(formData.get("receiptTaxRate") ?? 8) || 8;
    const companyAddress = String(formData.get("companyAddress") ?? "").trim();
    const companyPhone = String(formData.get("companyPhone") ?? "").trim();
    const privacyContactName = String(formData.get("privacyContactName") ?? "").trim();
    const privacyContactEmail = String(formData.get("privacyContactEmail") ?? "").trim();
    const privacyContactPhone = String(formData.get("privacyContactPhone") ?? "").trim();
    const owner = String(formData.get("owner") ?? "").trim();
    const defaultProcurementStaffId = String(formData.get("defaultProcurementStaffId") ?? "").trim();
    const reservationNote = String(formData.get("reservationNote") ?? "").trim();
    const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
    const attendanceLatitude = parseOptionalCoordinate(formData.get("attendanceLatitude") ?? editingAttendanceLatitude);
    const attendanceLongitude = parseOptionalCoordinate(formData.get("attendanceLongitude") ?? editingAttendanceLongitude);
    const weatherLocationName = editingAttendanceAddress.trim() || companyAddress || nextName;
    const weatherLatitude = attendanceLatitude;
    const weatherLongitude = attendanceLongitude;
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
    formData.set("customerDisplayNames", JSON.stringify(editingCustomerDisplayNames));
    formData.set("businessHours", serializeBusinessHours(editingBusinessHours));
    formData.set("weatherLocationName", weatherLocationName);
    formData.set("weatherLatitude", weatherLatitude === null ? "" : String(weatherLatitude));
    formData.set("weatherLongitude", weatherLongitude === null ? "" : String(weatherLongitude));
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
        companyRepresentativeName,
        invoiceRegistrationNumber,
        receiptPurposeText,
        receiptTaxRate,
        companyAddress,
        companyPhone,
        privacyContactName,
        privacyContactEmail,
        privacyContactPhone,
        customerDisplayNames: editingCustomerDisplayNames,
        owner,
        defaultProcurementStaffId,
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
    setEditingCustomerDisplayNames(emptyCustomerDisplayNameSettings);
    setEditingCompanyRepresentativeName("");
    setEditingPrivacyContactName("");
    setEditingPrivacyContactEmail("");
    setEditingPrivacyContactPhone("");
    setEditingKomojuEnabled(false);
    setEditingKomojuAccountName("");
    setEditingKomojuSecretKeyEnvName("");
    setEditingKomojuWebhookSecretEnvName("");
    setEditingKomojuPaymentTypesEnvName("");
    setEditingKomojuPaymentTypes("");
    setEditingReservationNote("");
    setEditingDefaultProcurementStaffId("");
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
    setEditingCompanyRepresentativeName(store.companyRepresentativeName ?? "");
    setEditingInvoiceRegistrationNumber(store.invoiceRegistrationNumber ?? "");
    setEditingReceiptPurposeText(store.receiptPurposeText ?? "テイクアウト飲食代");
    setEditingReceiptTaxRate(String(store.receiptTaxRate ?? 8));
    setEditingCompanyAddress(store.companyAddress ?? "");
    setEditingCompanyPhone(store.companyPhone ?? "");
    setEditingPrivacyContactName(store.privacyContactName ?? "");
    setEditingPrivacyContactEmail(store.privacyContactEmail ?? "");
    setEditingPrivacyContactPhone(store.privacyContactPhone ?? "");
    setEditingCustomerDisplayNames(normalizeCustomerDisplayNameSettings(store.customerDisplayNames));
    setEditingOwner(store.owner);
    setEditingDefaultProcurementStaffId(store.defaultProcurementStaffId ?? "");
    setEditingReservationNote(store.reservationNote ?? "");
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
    void loadTemporaryClosureSettings(store.id);
  }

  function getStaffName(staffId?: string) {
    if (!staffId) return "";
    return staffOptions.find((staff) => staff.id === staffId)?.name ?? "";
  }

  function getStoreStaffOptions(storeName?: string) {
    if (!storeName) return staffOptions;
    return staffOptions.filter((staff) => staff.storeNames.length === 0 || staff.storeNames.includes(storeName));
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
                    <small>通常の購入担当: {getStaffName(store.defaultProcurementStaffId) || "未設定"}</small>
                    <small>営業時間: {formatBusinessHoursSummary(store.businessHours)}</small>
                    <small>給与: {store.payrollCycleType === "specified_day" ? `${store.payrollClosingDay ?? 25}日締め` : "月末締め"} / 社保 {store.socialInsurancePrefecture ?? "福岡県"}</small>
                    <small>天気: {store.attendanceLatitude !== null && store.attendanceLatitude !== undefined && store.attendanceLongitude !== null && store.attendanceLongitude !== undefined ? "打刻地点から自動取得" : "福岡市（既定）"}</small>
                    <small>打刻地点: {store.attendanceLocationEnabled ? `${store.attendanceLatitude ?? "--"}, ${store.attendanceLongitude ?? "--"} / ${store.attendanceRadiusMeters ?? 100}m` : "位置制限なし"}</small>
                    {store.reservationNote ? <small>予約メモ: {store.reservationNote}</small> : null}
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => startEditingStore(store)}>
                      編集
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
              <label>
                <span>通常の購入担当</span>
                <select name="defaultProcurementStaffId" defaultValue="">
                  <option value="">未設定</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.name}</option>
                  ))}
                </select>
              </label>
              <BusinessHoursEditor value={newBusinessHours} onChange={setNewBusinessHours} />
              <label>
                <span>予約画面メモ</span>
                <input name="reservationNote" placeholder="例: ラストオーダーは閉店30分前" />
              </label>
              <div className="store-weather-settings">
                <strong>モバイル打刻地点</strong>
                <p>店舗スタッフ本人のスマホ打刻で使用します。座標がある場合、売上分析の天気もこの地点から自動取得します。</p>
                <label className="inline-checkbox">
                  <input type="checkbox" name="attendanceLocationEnabled" />
                  位置範囲内のみ打刻を許可
                </label>
                <label className="store-geocode-address">
                  <span>住所から座標を取得</span>
                  <input
                    name="attendanceAddress"
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
                  <input name="attendanceLatitude" inputMode="decimal" value={newAttendanceLatitude} onChange={(event) => setNewAttendanceLatitude(normalizeDecimalInput(event.target.value))} placeholder="例: 33.5902" />
                </label>
                <label>
                  <span>経度</span>
                  <input name="attendanceLongitude" inputMode="decimal" value={newAttendanceLongitude} onChange={(event) => setNewAttendanceLongitude(normalizeDecimalInput(event.target.value))} placeholder="例: 130.4017" />
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
              <button className={editingStoreTab === "operations" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("operations")}>受付・休業</button>
              <button className={editingStoreTab === "sales" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("sales")}>売上源</button>
              <button className={editingStoreTab === "customer" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("customer")}>顧客表示</button>
              <button className={editingStoreTab === "payment" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("payment")}>決済</button>
              <button className={editingStoreTab === "receipt" ? "is-active" : ""} type="button" onClick={() => setEditingStoreTab("receipt")}>会社・文書</button>
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
                    <span>通常の購入担当</span>
                    <select
                      name="defaultProcurementStaffId"
                      value={editingDefaultProcurementStaffId}
                      onChange={(event) => setEditingDefaultProcurementStaffId(event.target.value)}
                    >
                      <option value="">未設定</option>
                      {getStoreStaffOptions(editingStoreName).map((staff) => (
                        <option key={staff.id} value={staff.id}>{staff.name}</option>
                      ))}
                    </select>
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
                    <strong>モバイル打刻地点</strong>
                    <p>店舗スタッフ本人のスマホ打刻で、店舗からの距離と位置精度を確認します。座標がある場合、売上分析の天気もこの地点から自動取得します。</p>
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
                        name="attendanceAddress"
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
                      <input name="attendanceLatitude" inputMode="decimal" value={editingAttendanceLatitude} onChange={(event) => setEditingAttendanceLatitude(normalizeDecimalInput(event.target.value))} placeholder="例: 33.5902" />
                    </label>
                    <label>
                      <span>経度</span>
                      <input name="attendanceLongitude" inputMode="decimal" value={editingAttendanceLongitude} onChange={(event) => setEditingAttendanceLongitude(normalizeDecimalInput(event.target.value))} placeholder="例: 130.4017" />
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
                  <input type="hidden" name="companyRepresentativeName" value={editingCompanyRepresentativeName} />
                  <input type="hidden" name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} />
                  <input type="hidden" name="receiptPurposeText" value={editingReceiptPurposeText} />
                  <input type="hidden" name="receiptTaxRate" value={editingReceiptTaxRate} />
                  <input type="hidden" name="companyAddress" value={editingCompanyAddress} />
                  <input type="hidden" name="companyPhone" value={editingCompanyPhone} />
                  <input type="hidden" name="privacyContactName" value={editingPrivacyContactName} />
                  <input type="hidden" name="privacyContactEmail" value={editingPrivacyContactEmail} />
                  <input type="hidden" name="privacyContactPhone" value={editingPrivacyContactPhone} />
                  <input type="hidden" name="customerDisplayNames" value={JSON.stringify(editingCustomerDisplayNames)} />
                  <input type="hidden" name="owner" value={editingOwner} />
                  <input type="hidden" name="defaultProcurementStaffId" value={editingDefaultProcurementStaffId} />
                  <input type="hidden" name="reservationNote" value={editingReservationNote} />
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
              {editingStoreTab === "operations" ? (
                <div className="store-payroll-settings">
                  <div className="store-payroll-summary">
                    <strong>臨時休業</strong>
                    <p>未来の日付や時間帯を指定して、Web 予約の受付を停止します。本日だけの受付停止は Store 画面の「本日休業」を使います。</p>
                  </div>
                  <div className="store-temporary-closure-form">
                    <strong>臨時休業時間</strong>
                    <label>
                      <span>日付</span>
                      <input type="date" value={closureDraft.date} onChange={(event) => setClosureDraft((current) => ({ ...current, date: event.target.value }))} />
                    </label>
                    <label>
                      <span>開始</span>
                      <input type="time" value={closureDraft.startTime} onChange={(event) => setClosureDraft((current) => ({ ...current, startTime: event.target.value }))} />
                    </label>
                    <label>
                      <span>終了</span>
                      <input type="time" value={closureDraft.endTime} onChange={(event) => setClosureDraft((current) => ({ ...current, endTime: event.target.value }))} />
                    </label>
                    <label>
                      <span>理由</span>
                      <input value={closureDraft.reason} onChange={(event) => setClosureDraft((current) => ({ ...current, reason: event.target.value }))} />
                    </label>
                    <label className="is-wide">
                      <span>お客様向け表示</span>
                      <input value={closureDraft.publicMessage} onChange={(event) => setClosureDraft((current) => ({ ...current, publicMessage: event.target.value }))} />
                    </label>
                    <button className="secondary-button" type="button" disabled={temporaryClosureLoading || !closureDraft.date} onClick={() => void saveTemporaryClosure()}>
                      {temporaryClosureLoading ? "保存中..." : "臨時休業を追加"}
                    </button>
                  </div>
                  {temporaryClosureMessage ? <p className="store-geocode-message">{temporaryClosureMessage}</p> : null}
                  {temporaryClosures.length ? (
                    <div className="store-temporary-closure-list">
                      {temporaryClosures.map((closure) => (
                        <div key={closure.id}>
                          <span>{new Date(closure.startsAt).toLocaleString("ja-JP")} - {new Date(closure.endsAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
                          <strong>{closure.reason || "臨時休業"}</strong>
                          {closure.publicMessage ? <small>{closure.publicMessage}</small> : null}
                          <button type="button" disabled={temporaryClosureLoading} onClick={() => void cancelTemporaryClosure(closure.id)}>解除</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state-text">予定されている臨時休業はありません。</p>
                  )}
                  {affectedClosureOrders.length ? (
                    <div className="store-temporary-affected-orders">
                      <strong>対応が必要な予約 {affectedClosureOrders.length}件</strong>
                      {affectedClosureOrders.map((order) => (
                        <div key={order.id}>
                          <span>{order.pickupCode} / {order.pickupDate} {order.pickupTime}</span>
                          <small>{order.customerName || "-"} / {order.customerPhone || "電話未登録"} / {order.status}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {editingStoreTab === "sales" ? (
                <SalesSourceSelector
                  selectedKeys={editingSalesSourceKeys}
                  brandNames={editingStoreBrands}
                  onToggle={(key, checked) => setEditingSalesSourceKeys((current) => toggleSalesSourceKey(current, key, checked))}
                />
              ) : null}
              {editingStoreTab === "customer" ? (
                <CustomerDisplayNameEditor
                  value={editingCustomerDisplayNames}
                  internalStoreName={editingStoreName}
                  brandNames={editingStoreBrands}
                  selectedSourceKeys={editingSalesSourceKeys}
                  onChange={setEditingCustomerDisplayNames}
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
                    <strong>会社情報と個人情報文書</strong>
                    <p>領収書 PDF と従業員向けの個人情報・マイナンバー取扱文書に表示する会社情報です。この店舗に紐づく会社情報として保存されます。</p>
                  </div>
                  <label>
                    <span>正式会社名</span>
                    <input name="companyLegalName" value={editingCompanyLegalName} onChange={(event) => setEditingCompanyLegalName(event.target.value)} placeholder="例: 株式会社丸九" />
                  </label>
                  <label>
                    <span>代表者名</span>
                    <input name="companyRepresentativeName" value={editingCompanyRepresentativeName} onChange={(event) => setEditingCompanyRepresentativeName(event.target.value)} placeholder="例: 代表取締役 山田太郎" />
                  </label>
                  <label>
                    <span>インボイス登録番号</span>
                    <input name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} onChange={(event) => setEditingInvoiceRegistrationNumber(event.target.value)} placeholder="例: T1234567890123" />
                  </label>
                  <label>
                    <span>但し書き</span>
                    <input name="receiptPurposeText" value={editingReceiptPurposeText} onChange={(event) => setEditingReceiptPurposeText(event.target.value)} placeholder="例: テイクアウト飲食代" />
                  </label>
                  <label>
                    <span>消費税率（%）</span>
                    <select name="receiptTaxRate" value={editingReceiptTaxRate} onChange={(event) => setEditingReceiptTaxRate(event.target.value)}>
                      <option value="8">8%（テイクアウト）</option>
                      <option value="10">10%（店内飲食）</option>
                    </select>
                  </label>
                  <label>
                    <span>会社住所</span>
                    <input name="companyAddress" value={editingCompanyAddress} onChange={(event) => setEditingCompanyAddress(event.target.value)} placeholder="例: 福岡県福岡市..." />
                  </label>
                  <label>
                    <span>会社電話番号</span>
                    <input name="companyPhone" value={editingCompanyPhone} onChange={(event) => setEditingCompanyPhone(event.target.value)} placeholder="例: 092-000-0000" />
                  </label>
                  <div className="store-payroll-summary">
                    <strong>個人情報問い合わせ窓口</strong>
                    <p>従業員が個人情報・個人番号の取扱いについて問い合わせる窓口です。未設定の場合、確認文書には未設定と表示されます。</p>
                  </div>
                  <label>
                    <span>担当部署・担当者</span>
                    <input name="privacyContactName" value={editingPrivacyContactName} onChange={(event) => setEditingPrivacyContactName(event.target.value)} placeholder="例: 人事労務担当" />
                  </label>
                  <label>
                    <span>問い合わせメール</span>
                    <input name="privacyContactEmail" type="email" value={editingPrivacyContactEmail} onChange={(event) => setEditingPrivacyContactEmail(event.target.value)} placeholder="例: hr@example.jp" />
                  </label>
                  <label>
                    <span>問い合わせ電話番号</span>
                    <input name="privacyContactPhone" value={editingPrivacyContactPhone} onChange={(event) => setEditingPrivacyContactPhone(event.target.value)} placeholder="例: 092-000-0000" />
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="companyLegalName" value={editingCompanyLegalName} />
                  <input type="hidden" name="companyRepresentativeName" value={editingCompanyRepresentativeName} />
                  <input type="hidden" name="invoiceRegistrationNumber" value={editingInvoiceRegistrationNumber} />
                  <input type="hidden" name="receiptPurposeText" value={editingReceiptPurposeText} />
                  <input type="hidden" name="receiptTaxRate" value={editingReceiptTaxRate} />
                  <input type="hidden" name="companyAddress" value={editingCompanyAddress} />
                  <input type="hidden" name="companyPhone" value={editingCompanyPhone} />
                  <input type="hidden" name="privacyContactName" value={editingPrivacyContactName} />
                  <input type="hidden" name="privacyContactEmail" value={editingPrivacyContactEmail} />
                  <input type="hidden" name="privacyContactPhone" value={editingPrivacyContactPhone} />
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
            <details className="store-danger-zone">
              <summary>閉店・重複登録などで店舗を削除する</summary>
              <p>店舗削除は通常使いません。予約、POS、勤怠、売上、手順書との関連を確認してから実行してください。</p>
              <button type="button" className="danger-button" onClick={() => void deleteEditingStore()}>
                店舗を削除
              </button>
            </details>
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
            <details className="store-danger-zone">
              <summary>廃止・重複登録などでブランドを削除する</summary>
              <p>ブランド削除は通常使いません。メニュー、予約、POS、売上との関連を確認してから実行してください。</p>
              <button type="button" className="danger-button" onClick={() => void deleteEditingBrand()}>
                ブランドを削除
              </button>
            </details>
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

function CustomerDisplayNameEditor({
  value,
  internalStoreName,
  brandNames,
  selectedSourceKeys,
  onChange
}: {
  value: CustomerDisplayNameSettings;
  internalStoreName: string;
  brandNames: string[];
  selectedSourceKeys: string[];
  onChange: (value: CustomerDisplayNameSettings) => void;
}) {
  const settings = normalizeCustomerDisplayNameSettings(value);
  const candidates = getCustomerDisplayNameCandidates(brandNames, selectedSourceKeys);

  function updateDefaultName(defaultName: string) {
    onChange({ ...settings, defaultName });
  }

  function updateOverride(brandName: string, platform: string, sourceLabel: string, displayName: string) {
    const nextOverrides = settings.overrides.filter((override) => !(override.brandName === brandName && override.platform === platform));
    const trimmedName = displayName.trim();
    onChange({
      ...settings,
      overrides: trimmedName
        ? [...nextOverrides, { brandName, platform, sourceLabel, displayName: trimmedName }]
        : nextOverrides
    });
  }

  return (
    <div className="store-payroll-settings">
      <div className="store-payroll-summary">
        <strong>お客様向け店舗名</strong>
        <p>購入履歴、領収書、Web予約など、お客様向け画面に表示する名称です。内部管理用の店舗名は変更されません。</p>
      </div>
      <label>
        <span>標準表示名</span>
        <input
          value={settings.defaultName}
          onChange={(event) => updateDefaultName(event.target.value)}
          placeholder={internalStoreName || "例: まぁ麻 福岡清水店"}
        />
      </label>
      <div className="customer-display-name-grid">
        <div className="store-payroll-summary">
          <strong>ブランド・チャネル別表示名</strong>
          <p>未入力の組み合わせは標準表示名を使います。ブランドやチャネルごとに正式名称が違う場合だけ入力してください。</p>
        </div>
        {candidates.map((candidate) => (
          <label key={candidate.key} className="customer-display-name-row">
            <span>{candidate.brandName || "全ブランド"} / {candidate.sourceLabel}</span>
            <input
              value={getCustomerDisplayOverrideValue(settings, candidate.brandName, candidate.platform)}
              onChange={(event) => updateOverride(candidate.brandName, candidate.platform, candidate.sourceLabel, event.target.value)}
              placeholder={settings.defaultName || internalStoreName || "表示名"}
            />
          </label>
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
