"use client";

import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  ImageUp,
  Lightbulb,
  LogOut,
  MenuSquare,
  MonitorSmartphone,
  PackageCheck,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  WalletCards,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import { createTestPrintPayload, defaultPosPrinterSettings, getKitchenPrinterForBrand, getReceiptPrinter, printWithAndroidBridge, type PosPrinterConnection, type PosPrinterSettings, type PosReceiptTemplateSettings } from "../../../lib/pos-printer";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "メニュー管理", href: "/os/menus", icon: MenuSquare },
  { label: "手順書管理", href: "/os/procedures", icon: ClipboardCheck },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "POS", href: "/os/pos", icon: ShoppingCart },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

type StoreOption = {
  id: string;
  name: string;
};

type PosSummary = {
  orderCount: number;
  total: number;
  average: number;
  latestOrders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    paymentMethod: string;
    createdTime: string;
  }>;
};

type PosCashSession = {
  id: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  differenceAmount: number | null;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string;
};

type PosCashTotals = {
  openingAmount: number;
  expectedCashAmount: number;
  countedCashAmount: number;
  differenceAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
};

type PosReconciliation = {
  businessDate: string;
  activeSession: PosCashSession | null;
  sessions: PosCashSession[];
  totals: PosCashTotals;
};

type PosTaxSettings = {
  storeId: string;
  storeName: string;
  dineInEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  customerDisplayMediaSettings: CustomerDisplayMediaSettings;
  printerSettings: PosPrinterSettings;
  posBrandSettings: PosBrandSetting[];
  updatedAt: string;
};

type CustomerDisplayMediaAsset = {
  id: string;
  type: "image" | "video";
  url: string;
  pathname?: string;
  name: string;
  durationSeconds: number;
  fit: "cover" | "contain";
};

type CustomerDisplayMediaSettings = {
  mode: "default" | "slideshow" | "video";
  transition: "fade" | "slide" | "none";
  slideDurationSeconds: number;
  videoMuted: boolean;
  videoLoop: boolean;
  backgroundColor: string;
  assets: CustomerDisplayMediaAsset[];
};

const defaultCustomerDisplayMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

type PosBrandSetting = {
  brandId: string;
  brandName: string;
  posPricingMode: "fixed" | "weight";
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
};

type PosDiscountPreset = {
  key: string;
  name: string;
  displayNames?: Record<string, string>;
  discountType: "percent" | "amount";
  discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand";
  targetValue: string;
  enabled: boolean;
  stampEligible: boolean;
  allowCouponCombination: boolean;
};

function isNetworkPrinter(printer: PosPrinterConnection) {
  return printer.deviceType === "escpos_network";
}

function usesPrinterIdentifier(printer: PosPrinterConnection) {
  return printer.deviceType === "escpos_bluetooth" || printer.deviceType === "escpos_usb" || printer.deviceType === "star_printer";
}

function requiresPrinterIdentifier(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return true;
  if (printer.deviceType === "star_printer") return printer.connectionType !== "usb";
  return false;
}

function getPrinterIdentifierHelp(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return "ペアリング名または MAC";
  if (printer.deviceType === "escpos_usb") return "任意: USB名 / vendor:product";
  return "Star printer / MAC / IP";
}

function getPrinterIdentifierError(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return "ESC/POS Bluetooth プリンターの識別子を入力してください。ペアリング名または MAC を指定します。";
  return "Star プリンターの識別子を入力してください。Bluetooth はペアリング名または MAC、LAN は IP / MAC を指定します。";
}

function createDiscountPreset(): PosDiscountPreset {
  return {
    key: `discount_${Date.now()}`,
    name: "",
    displayNames: {},
    discountType: "percent",
    discountValue: 10,
    targetScope: "all",
    targetValue: "",
    enabled: true,
    stampEligible: false,
    allowCouponCombination: false
  };
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function getPaymentLabel(value: string) {
  if (value === "cash") return "現金";
  if (value === "card") return "カード";
  if (value === "other") return "その他";
  return value || "-";
}

export default function PosPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [taxSettings, setTaxSettings] = useState<PosTaxSettings | null>(null);
  const [taxForm, setTaxForm] = useState<{ dineInEnabled: boolean; dineInTaxRate: string; takeoutTaxRate: string; externalPaymentTerminalBrand: string; priceTaxMode: string; discountPresets: PosDiscountPreset[]; customerDisplayMediaSettings: CustomerDisplayMediaSettings; printerSettings: PosPrinterSettings; posBrandSettings: PosBrandSetting[] }>({
    dineInEnabled: true,
    dineInTaxRate: "10",
    takeoutTaxRate: "8",
    externalPaymentTerminalBrand: "PayCAS",
    priceTaxMode: "tax_included",
    discountPresets: [],
    customerDisplayMediaSettings: defaultCustomerDisplayMediaSettings,
    printerSettings: defaultPosPrinterSettings,
    posBrandSettings: []
  });
  const [canManagePosSettings, setCanManagePosSettings] = useState(false);
  const [taxSaving, setTaxSaving] = useState(false);
  const [mediaUploadStatus, setMediaUploadStatus] = useState("");
  const [receiptImageUploadStatus, setReceiptImageUploadStatus] = useState("");
  const [testPrintStatus, setTestPrintStatus] = useState("");
  const [testPrinting, setTestPrinting] = useState(false);
  const [testPrinterTarget, setTestPrinterTarget] = useState("receipt");
  const [hasNativePrintBridge, setHasNativePrintBridge] = useState(false);
  const [uploadingMediaType, setUploadingMediaType] = useState<"" | "image" | "video">("");
  const [uploadingReceiptImageSlot, setUploadingReceiptImageSlot] = useState<"" | "logo" | "promotion">("");
  const [reconciliation, setReconciliation] = useState<PosReconciliation>({
    businessDate: "",
    activeSession: null,
    sessions: [],
    totals: { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load(storeId = selectedStoreId) {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/pos${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("POS データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    const selectedId = body.selectedStoreId ?? "";
    const cashParams = new URLSearchParams();
    if (selectedId) cashParams.set("storeId", selectedId);
    const cashResponse = selectedId
      ? await fetch(`/api/store/pos/reconciliation?${cashParams.toString()}`, { cache: "no-store" })
      : null;
    const settingsResponse = selectedId
      ? await fetch(`/api/os/pos/settings?${cashParams.toString()}`, { cache: "no-store" })
      : null;
    const cashBody = cashResponse?.ok ? await cashResponse.json() : null;
    const settingsBody = settingsResponse?.ok ? await settingsResponse.json() : null;
    const nextSettings = settingsBody?.settings ?? body.posSettings ?? null;
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(selectedId);
    setSummary(body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] });
    setTaxSettings(nextSettings);
    setCanManagePosSettings(Boolean(settingsBody?.access?.canManagePosSettings));
    setTaxForm({
      dineInEnabled: nextSettings?.dineInEnabled !== false,
      dineInTaxRate: String(nextSettings?.dineInTaxRate ?? 10),
      takeoutTaxRate: String(nextSettings?.takeoutTaxRate ?? 8),
      externalPaymentTerminalBrand: nextSettings?.externalPaymentTerminalBrand ?? "PayCAS",
      priceTaxMode: nextSettings?.priceTaxMode ?? "tax_included",
      discountPresets: Array.isArray(nextSettings?.discountPresets) ? nextSettings.discountPresets : [],
      customerDisplayMediaSettings: nextSettings?.customerDisplayMediaSettings ?? defaultCustomerDisplayMediaSettings,
      printerSettings: nextSettings?.printerSettings ?? defaultPosPrinterSettings,
      posBrandSettings: Array.isArray(nextSettings?.posBrandSettings) ? nextSettings.posBrandSettings : []
    });
    setReconciliation({
      businessDate: cashBody?.businessDate ?? "",
      activeSession: cashBody?.activeSession ?? null,
      sessions: cashBody?.sessions ?? [],
      totals: cashBody?.totals ?? { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 }
    });
    setMessage("");
    setLoading(false);
  }

  function updateReceiptPrinter(patch: Partial<PosPrinterConnection>) {
    setTaxForm((current) => {
      const receiptPrinter = { ...getReceiptPrinter(current.printerSettings), ...patch };
      return {
        ...current,
        printerSettings: {
          ...current.printerSettings,
          ...receiptPrinter,
          receiptPrinter
        }
      };
    });
  }

  function updateKitchenPrinter(patch: Partial<PosPrinterConnection>) {
    setTaxForm((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        kitchenPrinter: { ...current.printerSettings.kitchenPrinter, ...patch }
      }
    }));
  }

  function updateBrandKitchenPrinter(brand: PosBrandSetting, patch: Partial<PosPrinterConnection>) {
    setTaxForm((current) => {
      const existingPrinters = current.printerSettings.brandKitchenPrinters.filter((printer) => printer.brandId !== brand.brandId);
      const currentPrinter = current.printerSettings.brandKitchenPrinters.find((printer) => printer.brandId === brand.brandId)?.printer
        ?? current.printerSettings.kitchenPrinter;
      return {
        ...current,
        printerSettings: {
          ...current.printerSettings,
          brandKitchenPrinters: [
            ...existingPrinters,
            {
              brandId: brand.brandId,
              brandName: brand.brandName,
              printer: { ...currentPrinter, ...patch }
            }
          ]
        }
      };
    });
  }

  function updateReceiptTemplate(patch: Partial<PosReceiptTemplateSettings>) {
    setTaxForm((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        receiptTemplate: { ...current.printerSettings.receiptTemplate, ...patch }
      }
    }));
  }

  function getTestPrinter() {
    if (testPrinterTarget === "kitchen") return getKitchenPrinterForBrand(taxForm.printerSettings);
    if (testPrinterTarget.startsWith("brand:")) {
      return getKitchenPrinterForBrand(taxForm.printerSettings, testPrinterTarget.slice("brand:".length));
    }
    return getReceiptPrinter(taxForm.printerSettings);
  }

  async function savePosSettings(options: { quiet?: boolean } = {}) {
    if (!selectedStoreId || taxSaving) return false;
    setTaxSaving(true);
    if (!options.quiet) setMessage("");
    try {
      const response = await fetch("/api/os/pos/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          dineInEnabled: taxForm.dineInEnabled,
          dineInTaxRate: taxForm.dineInTaxRate,
          takeoutTaxRate: taxForm.takeoutTaxRate,
          externalPaymentTerminalBrand: taxForm.externalPaymentTerminalBrand,
          priceTaxMode: taxForm.priceTaxMode,
          discountPresets: taxForm.discountPresets,
          customerDisplayMediaSettings: taxForm.customerDisplayMediaSettings,
          printerSettings: taxForm.printerSettings,
          posBrandSettings: taxForm.posBrandSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "POS 設定を保存できませんでした。");
      setTaxSettings(body.settings ?? null);
      setTaxForm({
        dineInEnabled: body.settings?.dineInEnabled !== false,
        dineInTaxRate: String(body.settings?.dineInTaxRate ?? taxForm.dineInTaxRate),
        takeoutTaxRate: String(body.settings?.takeoutTaxRate ?? taxForm.takeoutTaxRate),
        externalPaymentTerminalBrand: body.settings?.externalPaymentTerminalBrand ?? taxForm.externalPaymentTerminalBrand,
        priceTaxMode: body.settings?.priceTaxMode ?? taxForm.priceTaxMode,
        discountPresets: Array.isArray(body.settings?.discountPresets) ? body.settings.discountPresets : taxForm.discountPresets,
        customerDisplayMediaSettings: body.settings?.customerDisplayMediaSettings ?? taxForm.customerDisplayMediaSettings,
        printerSettings: body.settings?.printerSettings ?? taxForm.printerSettings,
        posBrandSettings: Array.isArray(body.settings?.posBrandSettings) ? body.settings.posBrandSettings : taxForm.posBrandSettings
      });
      if (!options.quiet) setMessage("POS 設定を保存しました。");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "POS 設定を保存できませんでした。";
      if (options.quiet) {
        setTestPrintStatus(errorMessage);
      } else {
        setMessage(errorMessage);
      }
      return false;
    } finally {
      setTaxSaving(false);
    }
  }

  async function testPrint() {
    if (testPrinting) return;
    if (!hasNativePrintBridge) {
      setTestPrintStatus("テスト印刷は iOS / Android アプリで実行してください。ブラウザでは設定の保存のみできます。");
      return;
    }
    const printer = getTestPrinter();
    if (requiresPrinterIdentifier(printer) && !printer.identifier) {
      setTestPrintStatus(getPrinterIdentifierError(printer));
      return;
    }
    if (isNetworkPrinter(printer) && !printer.host) {
      setTestPrintStatus("プリンター IP を入力してください。");
      return;
    }
    setTestPrinting(true);
    setTestPrintStatus("");
    const saved = await savePosSettings({ quiet: true });
    if (!saved) {
      setTestPrinting(false);
      return;
    }
    const result = await printWithAndroidBridge(createTestPrintPayload(printer, taxSettings?.storeName || "Foundr1 OS"));
    setTestPrintStatus(result.ok ? "プリンター設定を保存し、テスト印刷を送信しました。" : result.error || "テスト印刷に失敗しました。");
    setTestPrinting(false);
  }

  async function uploadCustomerDisplayMedia(file: File, type: "image" | "video") {
    if (!canManagePosSettings || uploadingMediaType) return;
    setUploadingMediaType(type);
    setMediaUploadStatus("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      formData.append("name", file.name);
      const response = await fetch("/api/os/pos/customer-display-media", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "アップロードできませんでした。");
      const asset: CustomerDisplayMediaAsset = {
        id: `${type}_${Date.now()}`,
        type,
        url: body.url,
        pathname: body.pathname || "",
        name: body.name || file.name,
        durationSeconds: taxForm.customerDisplayMediaSettings.slideDurationSeconds,
        fit: "cover"
      };
      setTaxForm((current) => ({
        ...current,
        customerDisplayMediaSettings: {
          ...current.customerDisplayMediaSettings,
          mode: type === "video" ? "video" : "slideshow",
          assets: type === "video"
            ? [asset, ...current.customerDisplayMediaSettings.assets.filter((item) => item.type !== "video")]
            : [...current.customerDisplayMediaSettings.assets, asset].slice(0, 12)
        }
      }));
      setMediaUploadStatus("アップロードしました。保存すると客席表示に反映されます。");
    } catch (error) {
      setMediaUploadStatus(error instanceof Error ? error.message : "アップロードできませんでした。");
    } finally {
      setUploadingMediaType("");
    }
  }

  async function uploadReceiptTemplateImage(file: File, slot: "logo" | "promotion") {
    if (!canManagePosSettings || uploadingReceiptImageSlot) return;
    setUploadingReceiptImageSlot(slot);
    setReceiptImageUploadStatus("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slot", slot);
      formData.append("name", file.name);
      const response = await fetch("/api/os/pos/receipt-template-image", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "アップロードできませんでした。");
      updateReceiptTemplate(slot === "logo"
        ? { logoUrl: body.url, showLogo: true }
        : { promotionImageUrl: body.url }
      );
      setReceiptImageUploadStatus("アップロードしました。保存するとレシート印刷に反映されます。");
    } catch (error) {
      setReceiptImageUploadStatus(error instanceof Error ? error.message : "アップロードできませんでした。");
    } finally {
      setUploadingReceiptImageSlot("");
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const detectNativePrintBridge = () => {
      setHasNativePrintBridge(Boolean(window.Foundr1Printer?.print));
    };
    detectNativePrintBridge();
    window.addEventListener("focus", detectNativePrintBridge);
    window.addEventListener("pageshow", detectNativePrintBridge);
    return () => {
      window.removeEventListener("focus", detectNativePrintBridge);
      window.removeEventListener("pageshow", detectNativePrintBridge);
    };
  }, []);

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

      <section className="workspace pos-admin-page">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS</p>
            <h2>店頭会計</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "データ同期済み"}</span>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button" href="/store/pos" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              店舗 POS を開く
            </a>
          </div>
        </header>

        {message ? <div className="action-notice">{message}</div> : null}

        <section className="panel pos-admin-toolbar">
          <label>
            <span>店舗</span>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                const storeId = event.target.value;
                setSelectedStoreId(storeId);
                void load(storeId);
              }}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <div className="pos-admin-actions">
            <a href="/os/menus"><MenuSquare size={16} />メニュー管理</a>
            <a href="/os/pos/reconciliation"><WalletCards size={16} />日次レジ締め</a>
            <a href="/os/analytics/sales"><BarChart3 size={16} />売上分析</a>
            <a href="/os/stores"><Store size={16} />店舗設定</a>
          </div>
        </section>

        <section className="panel pos-admin-tax-settings">
          <div className="panel-title">
            <WalletCards />
            <div>
              <h3>POS 基本設定</h3>
              <p>税率、価格表示、外部決済端末の表示名を店舗ごとに管理します。</p>
            </div>
          </div>
          <div className="pos-admin-tax-grid">
            <label className="pos-admin-tax-toggle">
              <span>店内飲食</span>
              <div>
                <input
                  type="checkbox"
                  checked={taxForm.dineInEnabled}
                  onChange={(event) => setTaxForm((current) => ({ ...current, dineInEnabled: event.target.checked }))}
                  disabled={!canManagePosSettings}
                />
                <strong>店内飲食を POS に表示する</strong>
              </div>
            </label>
            <label>
              <span>店内飲食 税率（%）</span>
              <input
                inputMode="decimal"
                value={taxForm.dineInTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, dineInTaxRate: normalizeDecimalInput(event.target.value) }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>持ち帰り 税率（%）</span>
              <input
                inputMode="decimal"
                value={taxForm.takeoutTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, takeoutTaxRate: normalizeDecimalInput(event.target.value) }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>外部決済端末</span>
              <select
                value={taxForm.externalPaymentTerminalBrand}
                onChange={(event) => setTaxForm((current) => ({ ...current, externalPaymentTerminalBrand: event.target.value }))}
                disabled={!canManagePosSettings}
              >
                <option value="PayCAS">PayCAS</option>
                <option value="KOMOJU">KOMOJU</option>
                <option value="Square">Square</option>
                <option value="stera terminal">stera terminal</option>
                <option value="Airペイ">Airペイ</option>
                <option value="その他決済端末">その他決済端末</option>
              </select>
            </label>
            <label>
              <span>商品価格の税区分</span>
              <select
                value={taxForm.priceTaxMode}
                onChange={(event) => setTaxForm((current) => ({ ...current, priceTaxMode: event.target.value }))}
                disabled={!canManagePosSettings}
              >
                <option value="tax_included">税込価格</option>
                <option value="tax_excluded">税抜価格</option>
              </select>
            </label>
          </div>
          <div className="pos-admin-brand-pricing-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>ブランド別 POS 販売方式</h4>
                <p>計量販売を行うブランドだけ、重量単価を設定します。通常商品は固定価格のままです。</p>
              </div>
            </div>
            <div className="pos-admin-brand-pricing-list">
              {taxForm.posBrandSettings.length ? taxForm.posBrandSettings.map((setting, index) => (
                <div className="pos-admin-brand-pricing-row" key={setting.brandId}>
                  <strong>{setting.brandName}</strong>
                  <label>
                    <span>販売方式</span>
                    <select
                      value={setting.posPricingMode}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posPricingMode: event.target.value as PosBrandSetting["posPricingMode"] } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="fixed">固定価格</option>
                      <option value="weight">計量販売</option>
                    </select>
                  </label>
                  <label>
                    <span>重量単位</span>
                    <input
                      value={setting.posWeightUnit}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posWeightUnit: event.target.value } : item)
                      }))}
                      disabled={!canManagePosSettings || setting.posPricingMode !== "weight"}
                    />
                  </label>
                  <label>
                    <span>重量単価</span>
                    <input
                      inputMode="decimal"
                      value={setting.posWeightUnitPrice == null ? "" : String(setting.posWeightUnitPrice)}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        posBrandSettings: current.posBrandSettings.map((item, itemIndex) => itemIndex === index ? { ...item, posWeightUnitPrice: Number(normalizeDecimalInput(event.target.value)) || null } : item)
                      }))}
                      placeholder="4"
                      disabled={!canManagePosSettings || setting.posPricingMode !== "weight"}
                    />
                  </label>
                </div>
              )) : <p className="pos-admin-discount-empty">この店舗に紐づくブランドはありません。</p>}
            </div>
          </div>
          <div className="pos-admin-display-media-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>客席表示の待機画面</h4>
                <p>空き時間に表示する画像スライドショー、動画、切り替え効果を店舗ごとに設定します。</p>
              </div>
            </div>
            <div className="pos-admin-display-media-grid">
              <label>
                <span>表示モード</span>
                <select
                  value={taxForm.customerDisplayMediaSettings.mode}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, mode: event.target.value as CustomerDisplayMediaSettings["mode"] }
                  }))}
                  disabled={!canManagePosSettings}
                >
                  <option value="default">標準の待機画面</option>
                  <option value="slideshow">画像スライドショー</option>
                  <option value="video">動画</option>
                </select>
              </label>
              <label>
                <span>切り替え効果</span>
                <select
                  value={taxForm.customerDisplayMediaSettings.transition}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, transition: event.target.value as CustomerDisplayMediaSettings["transition"] }
                  }))}
                  disabled={!canManagePosSettings}
                >
                  <option value="fade">フェード</option>
                  <option value="slide">スライド</option>
                  <option value="none">なし</option>
                </select>
              </label>
              <label>
                <span>画像表示秒数</span>
                <input
                  inputMode="numeric"
                  value={String(taxForm.customerDisplayMediaSettings.slideDurationSeconds)}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, slideDurationSeconds: Number(normalizeIntegerInput(event.target.value)) || 8 }
                  }))}
                  disabled={!canManagePosSettings}
                />
              </label>
              <label>
                <span>背景色</span>
                <input
                  type="color"
                  value={taxForm.customerDisplayMediaSettings.backgroundColor}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, backgroundColor: event.target.value }
                  }))}
                  disabled={!canManagePosSettings}
                />
              </label>
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.customerDisplayMediaSettings.videoMuted}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, videoMuted: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>動画をミュート再生</span>
              </label>
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.customerDisplayMediaSettings.videoLoop}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, videoLoop: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>動画をループ再生</span>
              </label>
            </div>
            <div className="pos-admin-display-upload-row">
              <label className={canManagePosSettings ? "secondary-button" : "secondary-button is-disabled"}>
                画像をアップロード
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  disabled={!canManagePosSettings || Boolean(uploadingMediaType)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadCustomerDisplayMedia(file, "image");
                  }}
                />
              </label>
              <label className={canManagePosSettings ? "secondary-button" : "secondary-button is-disabled"}>
                動画をアップロード
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  disabled={!canManagePosSettings || Boolean(uploadingMediaType)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadCustomerDisplayMedia(file, "video");
                  }}
                />
              </label>
              {mediaUploadStatus ? <small>{mediaUploadStatus}</small> : null}
            </div>
            <div className="pos-admin-display-asset-list">
              {taxForm.customerDisplayMediaSettings.assets.length ? taxForm.customerDisplayMediaSettings.assets.map((asset, index) => (
                <div className="pos-admin-display-asset-row" key={asset.id || index}>
                  <div>
                    <strong>{asset.name}</strong>
                    <span>{asset.type === "video" ? "動画" : "画像"} / {asset.fit === "contain" ? "全体表示" : "画面に合わせる"}</span>
                  </div>
                  <label>
                    <span>表示</span>
                    <select
                      value={asset.fit}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        customerDisplayMediaSettings: {
                          ...current.customerDisplayMediaSettings,
                          assets: current.customerDisplayMediaSettings.assets.map((item, itemIndex) => itemIndex === index ? { ...item, fit: event.target.value as CustomerDisplayMediaAsset["fit"] } : item)
                        }
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="cover">画面に合わせる</option>
                      <option value="contain">全体表示</option>
                    </select>
                  </label>
                  {asset.type === "image" ? (
                    <label>
                      <span>秒数</span>
                      <input
                        inputMode="numeric"
                        value={String(asset.durationSeconds)}
                        onChange={(event) => setTaxForm((current) => ({
                          ...current,
                          customerDisplayMediaSettings: {
                            ...current.customerDisplayMediaSettings,
                            assets: current.customerDisplayMediaSettings.assets.map((item, itemIndex) => itemIndex === index ? { ...item, durationSeconds: Number(normalizeIntegerInput(event.target.value)) || 8 } : item)
                          }
                        }))}
                        disabled={!canManagePosSettings}
                      />
                    </label>
                  ) : null}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="メディアを削除"
                    onClick={() => setTaxForm((current) => ({
                      ...current,
                      customerDisplayMediaSettings: {
                        ...current.customerDisplayMediaSettings,
                        assets: current.customerDisplayMediaSettings.assets.filter((_, itemIndex) => itemIndex !== index)
                      }
                    }))}
                    disabled={!canManagePosSettings}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )) : <p className="pos-admin-discount-empty">画像または動画をアップロードすると、客席表示の待機画面に使用できます。</p>}
            </div>
          </div>
          <div className="pos-admin-printer-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>レシート / 厨房プリンター</h4>
                <p>店舗アプリから Wi-Fi 熱敏プリンターへ印刷する接続情報を管理します。ブラウザでは設定保存のみできます。</p>
              </div>
              <div className="pos-admin-printer-actions">
                <select value={testPrinterTarget} onChange={(event) => setTestPrinterTarget(event.target.value)} disabled={!canManagePosSettings || taxSaving || testPrinting}>
                  <option value="receipt">レシート</option>
                  <option value="kitchen">厨房デフォルト</option>
                  {taxForm.posBrandSettings.map((brand) => (
                    <option key={brand.brandId} value={`brand:${brand.brandId}`}>{brand.brandName} 厨房</option>
                  ))}
                </select>
                <button className="secondary-button" type="button" onClick={() => void savePosSettings()} disabled={!canManagePosSettings || taxSaving}>
                  {taxSaving ? "保存中..." : "保存"}
                </button>
                <button className="secondary-button" type="button" onClick={() => void testPrint()} disabled={!canManagePosSettings || taxSaving || testPrinting || !hasNativePrintBridge}>
                  <Printer size={15} />
                  {testPrinting ? "送信中..." : hasNativePrintBridge ? "テスト印刷" : "アプリでテスト"}
                </button>
              </div>
            </div>
            {!hasNativePrintBridge ? (
              <p className="pos-admin-printer-status">ブラウザではプリンター設定の保存のみできます。テスト印刷は iOS / Android アプリで実行してください。</p>
            ) : null}
            <div className="pos-admin-printer-toggles">
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.printerSettings.enabled}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    printerSettings: { ...current.printerSettings, enabled: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>POS 印刷を有効にする</span>
              </label>
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.printerSettings.receiptEnabled}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    printerSettings: { ...current.printerSettings, receiptEnabled: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>会計後にレシート印刷</span>
              </label>
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.printerSettings.kitchenEnabled}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    printerSettings: { ...current.printerSettings, kitchenEnabled: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>厨房伝票を印刷</span>
              </label>
            </div>
            <div className="pos-admin-printer-card">
              <div>
                <strong>レシートプリンター</strong>
                <p>会計後のレシート印刷に使用します。</p>
              </div>
              <div className="pos-admin-printer-grid">
                <label>
                  <span>機器タイプ</span>
                  <select value={getReceiptPrinter(taxForm.printerSettings).deviceType} onChange={(event) => updateReceiptPrinter({ deviceType: event.target.value as PosPrinterConnection["deviceType"] })} disabled={!canManagePosSettings}>
                    <option value="escpos_network">ESC/POS Wi-Fi / LAN</option>
                    <option value="escpos_bluetooth">ESC/POS Bluetooth</option>
                    <option value="escpos_usb">ESC/POS USB</option>
                    <option value="star_printer">Star プリンター</option>
                  </select>
                </label>
                {getReceiptPrinter(taxForm.printerSettings).deviceType === "star_printer" ? (
                  <>
                    <label>
                      <span>接続方式</span>
                      <select value={getReceiptPrinter(taxForm.printerSettings).connectionType} onChange={(event) => updateReceiptPrinter({ connectionType: event.target.value as PosPrinterConnection["connectionType"] })} disabled={!canManagePosSettings}>
                        <option value="bluetooth">Bluetooth</option>
                        <option value="bluetooth_le">Bluetooth LE</option>
                        <option value="usb">USB</option>
                        <option value="lan">LAN</option>
                      </select>
                    </label>
                    <label>
                      <span>識別子</span>
                      <input value={getReceiptPrinter(taxForm.printerSettings).identifier} onChange={(event) => updateReceiptPrinter({ identifier: event.target.value.trim() })} placeholder="Star printer / MAC / IP" disabled={!canManagePosSettings || getReceiptPrinter(taxForm.printerSettings).connectionType === "usb"} />
                    </label>
                  </>
                ) : null}
                {usesPrinterIdentifier(getReceiptPrinter(taxForm.printerSettings)) && getReceiptPrinter(taxForm.printerSettings).deviceType !== "star_printer" ? (
                  <label>
                    <span>識別子</span>
                    <input value={getReceiptPrinter(taxForm.printerSettings).identifier} onChange={(event) => updateReceiptPrinter({ identifier: event.target.value.trim() })} placeholder={getPrinterIdentifierHelp(getReceiptPrinter(taxForm.printerSettings))} disabled={!canManagePosSettings} />
                  </label>
                ) : null}
                <label>
                  <span>プリンター IP</span>
                  <input value={getReceiptPrinter(taxForm.printerSettings).host} onChange={(event) => updateReceiptPrinter({ host: event.target.value.trim(), identifier: event.target.value.trim() })} placeholder="192.168.0.33" disabled={!canManagePosSettings || !isNetworkPrinter(getReceiptPrinter(taxForm.printerSettings))} />
                </label>
                <label>
                  <span>ポート</span>
                  <input inputMode="numeric" value={String(getReceiptPrinter(taxForm.printerSettings).port)} onChange={(event) => updateReceiptPrinter({ port: Number(normalizeIntegerInput(event.target.value)) || 9100 })} disabled={!canManagePosSettings || !isNetworkPrinter(getReceiptPrinter(taxForm.printerSettings))} />
                </label>
                <label>
                  <span>用紙幅</span>
                  <select value={getReceiptPrinter(taxForm.printerSettings).paperWidth} onChange={(event) => updateReceiptPrinter({ paperWidth: event.target.value as PosPrinterConnection["paperWidth"] })} disabled={!canManagePosSettings}>
                    <option value="80mm">80mm</option>
                    <option value="58mm">58mm</option>
                  </select>
                </label>
                <label>
                  <span>文字コード</span>
                  <select value={getReceiptPrinter(taxForm.printerSettings).characterEncoding} onChange={(event) => updateReceiptPrinter({ characterEncoding: event.target.value as PosPrinterConnection["characterEncoding"] })} disabled={!canManagePosSettings}>
                    <option value="shift_jis">Shift_JIS</option>
                    <option value="utf8">UTF-8</option>
                  </select>
                </label>
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={getReceiptPrinter(taxForm.printerSettings).cutPaper} onChange={(event) => updateReceiptPrinter({ cutPaper: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>印刷後にカット</span>
                </label>
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={getReceiptPrinter(taxForm.printerSettings).openCashDrawer} onChange={(event) => updateReceiptPrinter({ openCashDrawer: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>現金会計でドロアを開く</span>
                </label>
              </div>
            </div>
            <div className="pos-admin-printer-card">
              <div>
                <strong>厨房デフォルトプリンター</strong>
                <p>ブランド別の指定がない厨房伝票に使用します。</p>
              </div>
              <div className="pos-admin-printer-grid">
                <label>
                  <span>機器タイプ</span>
                  <select value={taxForm.printerSettings.kitchenPrinter.deviceType} onChange={(event) => updateKitchenPrinter({ deviceType: event.target.value as PosPrinterConnection["deviceType"] })} disabled={!canManagePosSettings}>
                    <option value="escpos_network">ESC/POS Wi-Fi / LAN</option>
                    <option value="escpos_bluetooth">ESC/POS Bluetooth</option>
                    <option value="escpos_usb">ESC/POS USB</option>
                    <option value="star_printer">Star プリンター</option>
                  </select>
                </label>
                {taxForm.printerSettings.kitchenPrinter.deviceType === "star_printer" ? (
                  <>
                    <label>
                      <span>接続方式</span>
                      <select value={taxForm.printerSettings.kitchenPrinter.connectionType} onChange={(event) => updateKitchenPrinter({ connectionType: event.target.value as PosPrinterConnection["connectionType"] })} disabled={!canManagePosSettings}>
                        <option value="bluetooth">Bluetooth</option>
                        <option value="bluetooth_le">Bluetooth LE</option>
                        <option value="usb">USB</option>
                        <option value="lan">LAN</option>
                      </select>
                    </label>
                    <label>
                      <span>識別子</span>
                      <input value={taxForm.printerSettings.kitchenPrinter.identifier} onChange={(event) => updateKitchenPrinter({ identifier: event.target.value.trim() })} placeholder="Star printer / MAC / IP" disabled={!canManagePosSettings || taxForm.printerSettings.kitchenPrinter.connectionType === "usb"} />
                    </label>
                  </>
                ) : null}
                {usesPrinterIdentifier(taxForm.printerSettings.kitchenPrinter) && taxForm.printerSettings.kitchenPrinter.deviceType !== "star_printer" ? (
                  <label>
                    <span>識別子</span>
                    <input value={taxForm.printerSettings.kitchenPrinter.identifier} onChange={(event) => updateKitchenPrinter({ identifier: event.target.value.trim() })} placeholder={getPrinterIdentifierHelp(taxForm.printerSettings.kitchenPrinter)} disabled={!canManagePosSettings} />
                  </label>
                ) : null}
                <label>
                  <span>プリンター IP</span>
                  <input value={taxForm.printerSettings.kitchenPrinter.host} onChange={(event) => updateKitchenPrinter({ host: event.target.value.trim(), identifier: event.target.value.trim() })} placeholder="192.168.0.34" disabled={!canManagePosSettings || !isNetworkPrinter(taxForm.printerSettings.kitchenPrinter)} />
                </label>
                <label>
                  <span>ポート</span>
                  <input inputMode="numeric" value={String(taxForm.printerSettings.kitchenPrinter.port)} onChange={(event) => updateKitchenPrinter({ port: Number(normalizeIntegerInput(event.target.value)) || 9100 })} disabled={!canManagePosSettings || !isNetworkPrinter(taxForm.printerSettings.kitchenPrinter)} />
                </label>
                <label>
                  <span>用紙幅</span>
                  <select value={taxForm.printerSettings.kitchenPrinter.paperWidth} onChange={(event) => updateKitchenPrinter({ paperWidth: event.target.value as PosPrinterConnection["paperWidth"] })} disabled={!canManagePosSettings}>
                    <option value="80mm">80mm</option>
                    <option value="58mm">58mm</option>
                  </select>
                </label>
                <label>
                  <span>文字コード</span>
                  <select value={taxForm.printerSettings.kitchenPrinter.characterEncoding} onChange={(event) => updateKitchenPrinter({ characterEncoding: event.target.value as PosPrinterConnection["characterEncoding"] })} disabled={!canManagePosSettings}>
                    <option value="shift_jis">Shift_JIS</option>
                    <option value="utf8">UTF-8</option>
                  </select>
                </label>
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={taxForm.printerSettings.kitchenPrinter.cutPaper} onChange={(event) => updateKitchenPrinter({ cutPaper: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>印刷後にカット</span>
                </label>
              </div>
            </div>
            {taxForm.posBrandSettings.length ? (
              <div className="pos-admin-printer-card">
                <div>
                  <strong>ブランド別 厨房プリンター</strong>
                  <p>空欄のブランドは厨房デフォルトプリンターを使用します。</p>
                </div>
                <div className="pos-admin-printer-brand-list">
                  {taxForm.posBrandSettings.map((brand) => {
                    const printer = taxForm.printerSettings.brandKitchenPrinters.find((item) => item.brandId === brand.brandId)?.printer
                      ?? taxForm.printerSettings.kitchenPrinter;
                    return (
                      <div className="pos-admin-printer-brand-row" key={brand.brandId}>
                        <strong>{brand.brandName}</strong>
                        <label>
                          <span>機器</span>
                          <select value={printer.deviceType} onChange={(event) => updateBrandKitchenPrinter(brand, { deviceType: event.target.value as PosPrinterConnection["deviceType"] })} disabled={!canManagePosSettings}>
                            <option value="escpos_network">ESC/POS Wi-Fi / LAN</option>
                            <option value="escpos_bluetooth">ESC/POS Bluetooth</option>
                            <option value="escpos_usb">ESC/POS USB</option>
                            <option value="star_printer">Star プリンター</option>
                          </select>
                        </label>
                        {printer.deviceType === "star_printer" ? (
                          <>
                            <label>
                              <span>接続</span>
                              <select value={printer.connectionType} onChange={(event) => updateBrandKitchenPrinter(brand, { connectionType: event.target.value as PosPrinterConnection["connectionType"] })} disabled={!canManagePosSettings}>
                                <option value="bluetooth">Bluetooth</option>
                                <option value="bluetooth_le">Bluetooth LE</option>
                                <option value="usb">USB</option>
                                <option value="lan">LAN</option>
                              </select>
                            </label>
                            <label>
                              <span>識別子</span>
                              <input value={printer.identifier} onChange={(event) => updateBrandKitchenPrinter(brand, { identifier: event.target.value.trim() })} placeholder="Star printer / MAC / IP" disabled={!canManagePosSettings || printer.connectionType === "usb"} />
                            </label>
                          </>
                        ) : null}
                        {usesPrinterIdentifier(printer) && printer.deviceType !== "star_printer" ? (
                          <label>
                            <span>識別子</span>
                            <input value={printer.identifier} onChange={(event) => updateBrandKitchenPrinter(brand, { identifier: event.target.value.trim() })} placeholder={getPrinterIdentifierHelp(printer)} disabled={!canManagePosSettings} />
                          </label>
                        ) : null}
                        <label>
                          <span>厨房 IP</span>
                          <input value={printer.host} onChange={(event) => updateBrandKitchenPrinter(brand, { host: event.target.value.trim(), identifier: event.target.value.trim() })} placeholder={taxForm.printerSettings.kitchenPrinter.host || "192.168.0.35"} disabled={!canManagePosSettings || !isNetworkPrinter(printer)} />
                        </label>
                        <label>
                          <span>ポート</span>
                          <input inputMode="numeric" value={String(printer.port)} onChange={(event) => updateBrandKitchenPrinter(brand, { port: Number(normalizeIntegerInput(event.target.value)) || 9100 })} disabled={!canManagePosSettings || !isNetworkPrinter(printer)} />
                        </label>
                        <label>
                          <span>用紙幅</span>
                          <select value={printer.paperWidth} onChange={(event) => updateBrandKitchenPrinter(brand, { paperWidth: event.target.value as PosPrinterConnection["paperWidth"] })} disabled={!canManagePosSettings}>
                            <option value="80mm">80mm</option>
                            <option value="58mm">58mm</option>
                          </select>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="pos-admin-printer-card">
              <div>
                <strong>レシートテンプレート</strong>
                <p>レシートに表示する店舗情報、登録番号、連絡先、販促メッセージを管理します。</p>
              </div>
              <div className="pos-admin-printer-grid">
                <label className="pos-admin-discount-check">
                  <input
                    type="checkbox"
                    checked={taxForm.printerSettings.receiptTemplate.showLogo}
                    onChange={(event) => updateReceiptTemplate({ showLogo: event.target.checked })}
                    disabled={!canManagePosSettings}
                  />
                  <span>ロゴを表示</span>
                </label>
                <div className="pos-admin-receipt-image-field">
                  <span>ロゴ画像</span>
                  <div className="pos-admin-receipt-image-control">
                    {taxForm.printerSettings.receiptTemplate.logoUrl ? (
                      <img src={taxForm.printerSettings.receiptTemplate.logoUrl} alt="" />
                    ) : (
                      <div>Logo</div>
                    )}
                    <div className="pos-admin-display-upload-row">
                      <label className="secondary-button">
                        <ImageUp size={16} />
                        {uploadingReceiptImageSlot === "logo" ? "アップロード中" : "画像を選択"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          disabled={!canManagePosSettings || Boolean(uploadingReceiptImageSlot)}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void uploadReceiptTemplateImage(file, "logo");
                          }}
                        />
                      </label>
                      {taxForm.printerSettings.receiptTemplate.logoUrl ? (
                        <button className="secondary-button" type="button" onClick={() => updateReceiptTemplate({ logoUrl: "", showLogo: false })} disabled={!canManagePosSettings}>
                          クリア
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <label>
                  <span>表示名</span>
                  <input
                    value={taxForm.printerSettings.receiptTemplate.businessName}
                    onChange={(event) => updateReceiptTemplate({ businessName: event.target.value })}
                    placeholder="店舗名または会社名"
                    disabled={!canManagePosSettings}
                  />
                </label>
                <label>
                  <span>登録番号 / 税号</span>
                  <input
                    value={taxForm.printerSettings.receiptTemplate.taxRegistrationNumber}
                    onChange={(event) => updateReceiptTemplate({ taxRegistrationNumber: event.target.value })}
                    placeholder="T1234567890123"
                    disabled={!canManagePosSettings}
                  />
                </label>
                <label>
                  <span>電話番号</span>
                  <input
                    value={taxForm.printerSettings.receiptTemplate.phone}
                    onChange={(event) => updateReceiptTemplate({ phone: event.target.value })}
                    placeholder="03-0000-0000"
                    disabled={!canManagePosSettings}
                  />
                </label>
                <label>
                  <span>Web / SNS</span>
                  <input
                    value={taxForm.printerSettings.receiptTemplate.website}
                    onChange={(event) => updateReceiptTemplate({ website: event.target.value })}
                    placeholder="https://foundr1.jp"
                    disabled={!canManagePosSettings}
                  />
                </label>
              </div>
              <div className="pos-admin-receipt-template-textareas">
                <label>
                  <span>会社情報</span>
                  <textarea value={taxForm.printerSettings.receiptTemplate.companyInfo} onChange={(event) => updateReceiptTemplate({ companyInfo: event.target.value })} disabled={!canManagePosSettings} />
                </label>
                <label>
                  <span>住所</span>
                  <textarea value={taxForm.printerSettings.receiptTemplate.address} onChange={(event) => updateReceiptTemplate({ address: event.target.value })} disabled={!canManagePosSettings} />
                </label>
                <label>
                  <span>上部メッセージ</span>
                  <textarea value={taxForm.printerSettings.receiptTemplate.headerMessage} onChange={(event) => updateReceiptTemplate({ headerMessage: event.target.value })} disabled={!canManagePosSettings} />
                </label>
                <label>
                  <span>下部メッセージ</span>
                  <textarea value={taxForm.printerSettings.receiptTemplate.footerMessage} onChange={(event) => updateReceiptTemplate({ footerMessage: event.target.value })} disabled={!canManagePosSettings} />
                </label>
                <label>
                  <span>販促メッセージ</span>
                  <textarea value={taxForm.printerSettings.receiptTemplate.promotionMessage} onChange={(event) => updateReceiptTemplate({ promotionMessage: event.target.value })} disabled={!canManagePosSettings} />
                </label>
                <div className="pos-admin-receipt-image-field">
                  <span>販促画像</span>
                  <div className="pos-admin-receipt-image-control">
                    {taxForm.printerSettings.receiptTemplate.promotionImageUrl ? (
                      <img src={taxForm.printerSettings.receiptTemplate.promotionImageUrl} alt="" />
                    ) : (
                      <div>Promotion</div>
                    )}
                    <div className="pos-admin-display-upload-row">
                      <label className="secondary-button">
                        <ImageUp size={16} />
                        {uploadingReceiptImageSlot === "promotion" ? "アップロード中" : "画像を選択"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          disabled={!canManagePosSettings || Boolean(uploadingReceiptImageSlot)}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void uploadReceiptTemplateImage(file, "promotion");
                          }}
                        />
                      </label>
                      {taxForm.printerSettings.receiptTemplate.promotionImageUrl ? (
                        <button className="secondary-button" type="button" onClick={() => updateReceiptTemplate({ promotionImageUrl: "" })} disabled={!canManagePosSettings}>
                          クリア
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="pos-admin-printer-toggles">
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={taxForm.printerSettings.receiptTemplate.showTaxSummary} onChange={(event) => updateReceiptTemplate({ showTaxSummary: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>税明細を表示</span>
                </label>
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={taxForm.printerSettings.receiptTemplate.showOrderNote} onChange={(event) => updateReceiptTemplate({ showOrderNote: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>備考を表示</span>
                </label>
                <label className="pos-admin-discount-check">
                  <input type="checkbox" checked={taxForm.printerSettings.receiptTemplate.showTimestamp} onChange={(event) => updateReceiptTemplate({ showTimestamp: event.target.checked })} disabled={!canManagePosSettings} />
                  <span>印刷日時を表示</span>
                </label>
              </div>
            </div>
            {receiptImageUploadStatus ? <p className="pos-admin-printer-status">{receiptImageUploadStatus}</p> : null}
            {testPrintStatus ? <p className="pos-admin-printer-status">{testPrintStatus}</p> : null}
          </div>
          <div className="pos-admin-discount-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>割引プリセット</h4>
                <p>店舗 POS に表示する割引ボタン、割引率、対象範囲を管理します。</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTaxForm((current) => ({ ...current, discountPresets: [...current.discountPresets, createDiscountPreset()] }))}
                disabled={!canManagePosSettings}
              >
                <Plus size={15} />
                追加
              </button>
            </div>
            <div className="pos-admin-discount-list">
              {taxForm.discountPresets.length ? taxForm.discountPresets.map((preset, index) => (
                <div className="pos-admin-discount-row" key={preset.key || index}>
                  <label className="pos-admin-discount-enabled">
                    <span>有効</span>
                    <input
                      type="checkbox"
                      checked={preset.enabled}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>名称</span>
                    <input
                      value={preset.name}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                      }))}
                      placeholder="学割 20%OFF"
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>方式</span>
                    <select
                      value={preset.discountType}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, discountType: event.target.value as PosDiscountPreset["discountType"] } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="percent">％割引</option>
                      <option value="amount">金額割引</option>
                    </select>
                  </label>
                  <label>
                    <span>{preset.discountType === "percent" ? "割引率（%）" : "割引額"}</span>
                    <input
                      inputMode="numeric"
                      value={String(preset.discountValue)}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: Number(normalizeIntegerInput(event.target.value)) || 0 } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>対象</span>
                    <select
                      value={preset.targetScope}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, targetScope: event.target.value as PosDiscountPreset["targetScope"], targetValue: event.target.value === "all" ? "" : item.targetValue } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    >
                      <option value="all">全商品</option>
                      <option value="category">カテゴリ</option>
                      <option value="item_kind">商品種別</option>
                      <option value="brand">ブランドID</option>
                    </select>
                  </label>
                  <label>
                    <span>対象値</span>
                    <input
                      value={preset.targetValue}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, targetValue: event.target.value } : item)
                      }))}
                      placeholder={preset.targetScope === "category" ? "ドリンク" : preset.targetScope === "item_kind" ? "drink" : preset.targetScope === "brand" ? "brand id" : "不要"}
                      disabled={!canManagePosSettings || preset.targetScope === "all"}
                    />
                  </label>
                  <label className="pos-admin-discount-check">
                    <input
                      type="checkbox"
                      checked={preset.allowCouponCombination}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, allowCouponCombination: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                    <span>クーポン併用可</span>
                  </label>
                  <label className="pos-admin-discount-check">
                    <input
                      type="checkbox"
                      checked={preset.stampEligible}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, stampEligible: event.target.checked } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                    <span>スタンプ対象</span>
                  </label>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="割引を削除"
                    onClick={() => setTaxForm((current) => ({ ...current, discountPresets: current.discountPresets.filter((_, itemIndex) => itemIndex !== index) }))}
                    disabled={!canManagePosSettings}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )) : <p className="pos-admin-discount-empty">割引プリセットは未設定です。</p>}
            </div>
          </div>
          <div className="pos-admin-tax-footer">
            <span>
              現在: {taxSettings?.dineInEnabled === false ? "持ち帰りのみ" : `店内 ${taxSettings?.dineInTaxRate ?? 10}%`} / 持ち帰り {taxSettings?.takeoutTaxRate ?? 8}% / 外部決済 {taxSettings?.externalPaymentTerminalBrand ?? "PayCAS"} / {taxSettings?.priceTaxMode === "tax_excluded" ? "税抜価格" : "税込価格"}
            </span>
            <button className="primary-button" type="button" onClick={() => void savePosSettings()} disabled={!canManagePosSettings || taxSaving}>
              {taxSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </section>

        <section className="metric-grid pos-admin-metrics">
          <article className="metric-card">
            <span>本日 POS 件数</span>
            <strong>{loading ? "-" : `${summary.orderCount} 件`}</strong>
            <p>店頭会計のみ</p>
          </article>
          <article className="metric-card">
            <span>本日 POS 売上</span>
            <strong>{loading ? "-" : formatYen(summary.total)}</strong>
            <p>キャンセル除外</p>
          </article>
          <article className="metric-card">
            <span>平均会計</span>
            <strong>{loading ? "-" : formatYen(summary.average)}</strong>
            <p>客単価の目安</p>
          </article>
          <article className="metric-card">
            <span>現金差額</span>
            <strong>{loading ? "-" : formatYen(reconciliation.totals.differenceAmount)}</strong>
            <p>{reconciliation.activeSession ? "開いているレジ締めあり" : "締め済みセッション合計"}</p>
          </article>
        </section>

        <section className="panel pos-admin-reconciliation">
          <div className="panel-title">
            <WalletCards />
            <div>
              <h3>日次レジ締め</h3>
              <p>釣銭準備金、現金売上、入出金、点検金額の差額を確認します。</p>
            </div>
            <a className="text-button" href="/os/pos/reconciliation">明細を見る</a>
          </div>
          <div className="pos-admin-cash-grid">
            <div>
              <span>開始金額</span>
              <strong>{formatYen(reconciliation.totals.openingAmount)}</strong>
            </div>
            <div>
              <span>現金売上</span>
              <strong>{formatYen(reconciliation.totals.cashSales)}</strong>
            </div>
            <div>
              <span>入金 / 出金</span>
              <strong>{formatYen(reconciliation.totals.cashIn)} / {formatYen(reconciliation.totals.cashOut)}</strong>
            </div>
            <div>
              <span>システム上の現金</span>
              <strong>{formatYen(reconciliation.totals.expectedCashAmount)}</strong>
            </div>
            <div>
              <span>実際の現金</span>
              <strong>{formatYen(reconciliation.totals.countedCashAmount)}</strong>
            </div>
            <div>
              <span>差額</span>
              <strong>{formatYen(reconciliation.totals.differenceAmount)}</strong>
            </div>
          </div>
          {reconciliation.sessions.length === 0 ? (
            <div className="empty-state">
              <WalletCards />
              <p>今日のレジ締めはまだありません。</p>
            </div>
          ) : (
            <div className="pos-admin-order-list">
              {reconciliation.sessions.map((session) => (
                <div key={session.id} className="pos-admin-order-row">
                  <div>
                    <strong>{session.registerName} / {session.status === "open" ? "進行中" : "締め済み"}</strong>
                    <span>
                      現金売上 {formatYen(session.cashSales)} / 予定 {formatYen(session.expectedCashAmount)}
                      {session.countedCashAmount !== null ? ` / 実際 ${formatYen(session.countedCashAmount)}` : ""}
                    </span>
                  </div>
                  <b>{session.differenceAmount === null ? "-" : formatYen(session.differenceAmount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel pos-admin-history">
          <div className="panel-title">
            <ShoppingCart />
            <div>
              <h3>直近の POS 会計</h3>
              <p>店舗 POS で確定した注文が表示されます。</p>
            </div>
          </div>
          {summary.latestOrders.length === 0 ? (
            <div className="empty-state">
              <MonitorSmartphone />
              <p>今日の POS 会計はまだありません。</p>
            </div>
          ) : (
            <div className="pos-admin-order-list">
              {summary.latestOrders.map((order) => (
                <div key={order.id} className="pos-admin-order-row">
                  <div>
                    <strong>{order.pickupCode}</strong>
                    <span>{order.createdTime} / {getPaymentLabel(order.paymentMethod)}</span>
                  </div>
                  <b>{formatYen(order.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
