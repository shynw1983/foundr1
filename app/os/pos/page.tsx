"use client";
import { invoiceRecipientLabel } from '../../../lib/pos-invoice';
import { posCampaignDate, validatePosCampaignPresets, type PosCampaignFields as CampaignFields } from "../../../lib/pos-discount-campaigns";
import { dineInGroupAppliesToItem } from "../../../lib/store-dine-in-menu-policy";
import { getPosOptionSelectionRules } from "../../../lib/dine-in-option-selection";
import { posOptionGiftCatalog } from "../../../lib/pos-option-gifts";
import type { PosGiftItem } from "../../../lib/pos-bowl-benefits";
import { resolvePosItemPricingMode } from "../../../lib/pos-item-pricing";
import { isPosBowl } from "../../../lib/pos-serving-policy";
import { PosDiscountCard, discountMatches } from "./PosDiscountCard";
import discountListStyles from "./PosDiscountCard.module.css";
import { PosSettingsNavigation, posSettingsPanes, posSettingsGroups, type PosSettingsPane, type PosSettingsGroup } from "./PosSettingsNavigation";
import settingsNavigationStyles from "./PosSettingsNavigation.module.css";
import { PosCampaignFields } from "./PosCampaignFields";
import { PosCounterMenuPolicySettings } from "./PosCounterMenuPolicySettings";

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
  QrCode,
  ArrowDown,
  ArrowUp,
  Search,
  ShoppingCart,
  WalletCards,
  Store,
  Trash2,
  Truck,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCodeGenerator from "qrcode";
import { useUnsavedChangesGuard } from "../../../components/UnsavedChangesGuard";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import { createPhysicalCustomerDisplayPayload, createTestPrintPayload, defaultPosPrinterSettings, displayWithAndroidBridge, getReceiptPrinter, listPairedNativePrinters, printWithAndroidBridge, resolvePosReceiptTemplate, type NativePrinterDevice, type PosPrinterConnection, type PosPrinterSettings, type PosReceiptTemplateBlock, type PosReceiptTemplateSettings } from "../../../lib/pos-printer";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";
import { useOsTranslation } from "../components/OsTranslationProvider";
import type { PosScaleTareSettings } from "../../../lib/pos-scale-tare";
import type { PosScaleFilterSettings } from "../../../lib/pos-scale-filter";
import { createPosScaleFilterForm, PosScaleFilterSettingsSection, validatePosScaleFilterForm, type PosScaleFilterFormState } from "./PosScaleFilterSettings";
import { createPosScaleTareForm, PosScaleTareSettingsSection, validatePosScaleTareForm, type PosScaleTareFormState } from "./PosScaleTareSettings";
import { createPosFulfillmentForm, PosFulfillmentSettingsSection, validatePosFulfillmentForm, type PosFulfillmentFormState } from "./PosFulfillmentSettings";
import { translatePosDisplayStandbyError } from "../../../lib/pos-display-standby-i18n";
import { PosDisplayStandbyEditor } from "./PosDisplayStandbyEditor";
import { PosPrintDocumentsEditor, type PosPrintDocumentTab } from "./PosPrintDocumentsEditor";
import PosSavedPrintPreviews from "./PosSavedPrintPreviews";
import { defaultPosDisplayStandbySettings, normalizePosDisplayStandbySettings, validatePosDisplayStandbySettings, type PosDisplayStandbySettings } from "../../../lib/pos-display-standby";
import type { PosFulfillmentWorkspaceSettings } from "../../../lib/pos-fulfillment-settings";

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
  { label: "テーブルQR注文", href: "/os/pos/table-order", icon: QrCode },
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
  takeoutEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  customerDisplayMediaSettings: CustomerDisplayMediaSettings;
  printerSettings: PosPrinterSettings;
  posBrandSettings: PosBrandSetting[];
  scaleTareSettings: PosScaleTareSettings;
  scaleFilterSettings: PosScaleFilterSettings;
  fulfillmentWorkspace: PosFulfillmentWorkspaceSettings;
  updatedAt: string;
};

type PosTaxFormState = {
  dineInEnabled: boolean;
  takeoutEnabled: boolean;
  dineInTaxRate: string;
  takeoutTaxRate: string;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  customerDisplayMediaSettings: CustomerDisplayMediaSettings;
  printerSettings: PosPrinterSettings;
  posBrandSettings: PosBrandSetting[];
  scaleTareSettings: PosScaleTareFormState;
  scaleFilterSettings: PosScaleFilterFormState;
  fulfillmentWorkspace: PosFulfillmentFormState;
};

type PosSettingsSaveSection = "general" | "customerDisplayMedia" | "all" | "printing" | "receipt" | "receiptConnection" | "discount" | "tare" | "filter" | "fulfillment" | "customerDisplayStandby";

const printingSettingKeys = ["enabled", "receiptEnabled", "receiptCopies", "bowlTickets", "receiptTemplate", "receiptTemplateVariants"] as const;
function printingFields(settings: PosPrinterSettings): Pick<PosPrinterSettings, typeof printingSettingKeys[number]> {
  return Object.fromEntries(printingSettingKeys.map(key => [key, settings[key]])) as Pick<PosPrinterSettings, typeof printingSettingKeys[number]>;
}

const receiptConnectionSettingKeys = ["showPrintQueue", "receiptPrinter", "customerDisplay", "deviceType", "connectionType", "identifier", "host", "port", "paperWidth", "characterEncoding", "cutPaper", "openCashDrawer"] as const;
function receiptConnectionFields(settings: PosPrinterSettings): Pick<PosPrinterSettings, typeof receiptConnectionSettingKeys[number]> {
  return Object.fromEntries(receiptConnectionSettingKeys.map(key => [key, settings[key]])) as Pick<PosPrinterSettings, typeof receiptConnectionSettingKeys[number]>;
}

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
  standby: PosDisplayStandbySettings;
};

const defaultCustomerDisplayMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: [],
  standby: defaultPosDisplayStandbySettings()
};

type PosBrandSetting = {
  brandId: string;
  brandName: string;
  posPricingMode: "fixed" | "weight";
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
};

type PosDiscountPreset = CampaignFields & {
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
  if (printer.deviceType === "star_printer") return false;
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

function createDiscountPreset(campaign = false): PosDiscountPreset {
  return {
    key: `discount_${globalThis.crypto.randomUUID()}`,
    applicationMode: campaign ? "campaign" : "manual",
    startsOn: campaign ? posCampaignDate() : "", endsOn: campaign ? posCampaignDate() : "", minimumSubtotal: 0,
    name: "",
    displayNames: {},
    discountType: "percent",
    discountValue: 10,
    targetScope: "all",
    targetValue: "",
    enabled: !campaign,
    stampEligible: false,
    allowCouponCombination: false
  };
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function getReceiptPreviewLines(value: string) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

const receiptTemplateBlockLabels: Record<PosReceiptTemplateBlock, string> = {
  logo: "ロゴ",
  business: "店名",
  contact: "住所・連絡先",
  message: "上部メッセージ",
  receipt: "会計内容",
  promotion: "販促画像・メッセージ",
  qr: "QRコード",
  footer: "下部メッセージ・印刷日時"
};

function ReceiptQrPreview({ value, label, size, alignment }: { value: string; label: string; size: PosReceiptTemplateSettings["qrCodeSize"]; alignment: PosReceiptTemplateSettings["qrCodeAlignment"] }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    if (!value.trim()) {
      setSrc("");
      return () => { active = false; };
    }
    void QRCodeGenerator.toDataURL(value.trim(), { errorCorrectionLevel: "M", margin: 1, width: 320 })
      .then((next) => { if (active) setSrc(next); })
      .catch(() => { if (active) setSrc(""); });
    return () => { active = false; };
  }, [value]);
  return (
    <div className={`pos-admin-receipt-paper-qr is-${alignment} is-${size}`}>
      {src ? <img src={src} alt="" /> : <div>QR</div>}
      {label ? <p>{label}</p> : null}
    </div>
  );
}

function getPaymentLabel(value: string) {
  if (value === "cash") return "現金";
  if (value === "card") return "カード";
  if (value === "other") return "その他";
  return value || "-";
}

function createPosTaxFormSnapshot(form: PosTaxFormState) {
  return JSON.stringify(form);
}

function generalFields(form:PosTaxFormState) {
 return {dineInEnabled:form.dineInEnabled,takeoutEnabled:form.takeoutEnabled,dineInTaxRate:form.dineInTaxRate,takeoutTaxRate:form.takeoutTaxRate,externalPaymentTerminalBrand:form.externalPaymentTerminalBrand,priceTaxMode:form.priceTaxMode,posBrandSettings:form.posBrandSettings};
}
function mediaFields(settings:CustomerDisplayMediaSettings) {
 const {standby:_standby,...media}=settings;return media;
}
function paneSnapshot(form:PosTaxFormState,pane:PosSettingsPane) {
 const value=pane==="general"?generalFields(form):pane==="customerDisplayMedia"?mediaFields(form.customerDisplayMediaSettings):pane==="customerDisplayStandby"?form.customerDisplayMediaSettings.standby:pane==="printing"?printingFields(form.printerSettings):pane==="receiptConnection"?receiptConnectionFields(form.printerSettings):pane==="discount"?form.discountPresets:pane==="tare"?form.scaleTareSettings:pane==="filter"?form.scaleFilterSettings:pane==="fulfillment"?form.fulfillmentWorkspace:null;
 return JSON.stringify(value);
}

export default function PosPage() {
  const { t } = useOsTranslation();
  const [activeSettingsPane, setActiveSettingsPane] = useState<PosSettingsGroup>("general");
  const [expandedDiscountKey, setExpandedDiscountKey] = useState("");
  const [discountQuery, setDiscountQuery] = useState("");
  const [discountStatus, setDiscountStatus] = useState("all");
  const [giftItems,setGiftItems] = useState<PosGiftItem[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [taxSettings, setTaxSettings] = useState<PosTaxSettings | null>(null);
  const [taxForm, setTaxForm] = useState<PosTaxFormState>({
    dineInEnabled: true,
    takeoutEnabled: true,
    dineInTaxRate: "10",
    takeoutTaxRate: "8",
    externalPaymentTerminalBrand: "PayCAS",
    priceTaxMode: "tax_included",
    discountPresets: [],
    customerDisplayMediaSettings: defaultCustomerDisplayMediaSettings,
    printerSettings: defaultPosPrinterSettings,
    posBrandSettings: [],
    scaleTareSettings: createPosScaleTareForm(null),
    scaleFilterSettings: createPosScaleFilterForm(null),
    fulfillmentWorkspace: createPosFulfillmentForm(null)
  });
  const addDiscount = (kind: "manual" | "campaign" | "bowl") => {
    const preset = { ...createDiscountPreset(kind !== "manual"), ...(kind === "bowl" ? { campaignBasis: "bowl_choice" as const, minimumSubtotal: 1000, startsOn: "", endsOn: "", giftItemIds: [], giftCategories: [], giftOptionIds: [], giftOptionGroupIds: [], giftButtonLabel: "プレゼント" } : {}) };
    setTaxForm(current => ({ ...current, discountPresets: [...current.discountPresets, preset] }));
    setDiscountQuery(""); setDiscountStatus("all"); setExpandedDiscountKey(preset.key);
  };
  const visibleDiscounts = taxForm.discountPresets.map((preset, index) => ({ preset, index })).filter(({ preset }) => preset.key === expandedDiscountKey || discountMatches(preset, discountQuery, discountStatus, t));
  const [savedTaxForm, setSavedTaxForm] = useState<PosTaxFormState | null>(null);
  const savedTaxFormSnapshot = savedTaxForm ? createPosTaxFormSnapshot(savedTaxForm) : "";
  const [categorySaving,setCategorySaving]=useState(false);
  const categorySavingRef=useRef(false);
  const [canManagePosSettings, setCanManagePosSettings] = useState(false);
  const [taxSaving, setTaxSaving] = useState(false);
  const taxSavingRef = useRef(false);
  const [standbyUploading, setStandbyUploading] = useState(false);
  const standbyUploadingRef = useRef(false);
  const activeStoreRef = useRef("");
  const settingsLoadingRef = useRef(true);
  const settingsLoadSequence = useRef(0);
  const settingsSaveSequence = useRef(0);
  const [mediaUploadStatus, setMediaUploadStatus] = useState("");
  const [receiptImageUploadStatus, setReceiptImageUploadStatus] = useState("");
  const [testPrintStatus, setTestPrintStatus] = useState("");
  const [testPrinting, setTestPrinting] = useState(false);
  const [nativePrinterDevices, setNativePrinterDevices] = useState<NativePrinterDevice[]>([]);
  const [nativePrinterScanning, setNativePrinterScanning] = useState(false);
  const [printDocumentTab, setPrintDocumentTab] = useState<PosPrintDocumentTab>("kitchen");
  const [receiptPreviewMode, setReceiptPreviewMode] = useState<"receipt" | "invoice">("receipt");
  const [receiptPreviewBrandId, setReceiptPreviewBrandId] = useState("");
  const [physicalDisplayPreviewMode, setPhysicalDisplayPreviewMode] = useState<"standby" | "order" | "cash" | "complete">("standby");
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
    const requestId = ++settingsLoadSequence.current;
    activeStoreRef.current = storeId;
    settingsLoadingRef.current = true;
    // A different store/load owns all following form and save state.
    ++settingsSaveSequence.current;
    taxSavingRef.current = false;
    setTaxSaving(false);
    setCanManagePosSettings(false);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      const response = await fetch(`/api/store/pos${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      if (!response.ok) {
        if (requestId === settingsLoadSequence.current) setMessage("POS データを読み込めませんでした。");
        return;
      }
      const body = await response.json();
      if (requestId !== settingsLoadSequence.current) return;
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
      if (requestId !== settingsLoadSequence.current) return;
      const nextSettings = settingsBody?.settings ?? body.posSettings ?? null;
      activeStoreRef.current = selectedId;
      const giftMenu=body.dineInMenu || body;
      const productGifts = (giftMenu.items || []).filter((item:{brandName?:string;itemKind?:string;productionType?:string})=>!isPosBowl(item)).filter((item:Parameters<typeof resolvePosItemPricingMode>[0])=>resolvePosItemPricingMode(item)==='fixed').filter((item:Parameters<typeof dineInGroupAppliesToItem>[1] & {optionGroupIds?:string[]})=>!(giftMenu.optionGroups||[]).some((g:Parameters<typeof dineInGroupAppliesToItem>[0] & Parameters<typeof getPosOptionSelectionRules>[0])=>(!item.optionGroupIds||item.optionGroupIds.includes(g.id))&&dineInGroupAppliesToItem(g,item)&&getPosOptionSelectionRules(g).min>0)).map((item:PosGiftItem & {priceOverride?:number|null;basePrice?:number|null;isAvailable?:boolean})=>({...item,price:Number(item.priceOverride??item.price??item.basePrice??0),available:item.isAvailable!==false,fixed:true})).filter((item:PosGiftItem)=>item.available);
      setGiftItems([...productGifts,...posOptionGiftCatalog(giftMenu.optionGroups||[])]);
      setStores(body.access?.stores ?? []);
      setSelectedStoreId(selectedId);
      setReceiptPreviewBrandId("");
      setReceiptPreviewMode("receipt");
      setPrintDocumentTab("kitchen");
      setSummary(body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] });
      setTaxSettings(nextSettings);
      setCanManagePosSettings(Boolean(settingsBody?.access?.canManagePosSettings));
      const nextTaxForm: PosTaxFormState = {
        dineInEnabled: nextSettings?.dineInEnabled !== false,
        takeoutEnabled: nextSettings?.takeoutEnabled !== false,
        dineInTaxRate: String(nextSettings?.dineInTaxRate ?? 10),
        takeoutTaxRate: String(nextSettings?.takeoutTaxRate ?? 8),
        externalPaymentTerminalBrand: nextSettings?.externalPaymentTerminalBrand ?? "PayCAS",
        priceTaxMode: nextSettings?.priceTaxMode ?? "tax_included",
        discountPresets: Array.isArray(nextSettings?.discountPresets) ? nextSettings.discountPresets : [],
        customerDisplayMediaSettings: { ...defaultCustomerDisplayMediaSettings, ...nextSettings?.customerDisplayMediaSettings, standby: normalizePosDisplayStandbySettings(nextSettings?.customerDisplayMediaSettings?.standby) },
        printerSettings: nextSettings?.printerSettings ?? defaultPosPrinterSettings,
        posBrandSettings: Array.isArray(nextSettings?.posBrandSettings) ? nextSettings.posBrandSettings : [],
        scaleTareSettings: createPosScaleTareForm(nextSettings?.scaleTareSettings),
        scaleFilterSettings: createPosScaleFilterForm(nextSettings?.scaleFilterSettings),
        fulfillmentWorkspace: createPosFulfillmentForm(nextSettings?.fulfillmentWorkspace)
      };
      setTaxForm(nextTaxForm);
      setSavedTaxForm(nextTaxForm);
      setReconciliation({
        businessDate: cashBody?.businessDate ?? "",
        activeSession: cashBody?.activeSession ?? null,
        sessions: cashBody?.sessions ?? [],
        totals: cashBody?.totals ?? { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 }
      });
      setMessage("");
    } catch {
      if (requestId === settingsLoadSequence.current) setMessage("POS データを読み込めませんでした。");
    } finally {
      if (requestId === settingsLoadSequence.current) {
        settingsLoadingRef.current = false;
        setLoading(false);
      }
    }
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

  function applyNativePrinterDevice(device: NativePrinterDevice, quiet = false) {
    updateReceiptPrinter({
      deviceType: device.isLikelyStarPrinter ? "star_printer" : device.deviceType,
      connectionType: device.connectionType || "bluetooth",
      identifier: device.identifier || device.address || device.name,
      host: "",
      paperWidth: device.paperWidth || "58mm"
    });
    if (!quiet) {
      setTestPrintStatus(`${device.name || device.identifier} をレシートプリンターに設定しました。保存またはテスト印刷で反映されます。`);
    }
  }

  async function refreshNativePrinterDevices(options: { autoApply?: boolean; quiet?: boolean } = {}) {
    if (!hasNativePrintBridge || nativePrinterScanning) return;
    setNativePrinterScanning(true);
    if (!options.quiet) setTestPrintStatus("");
    const result = await listPairedNativePrinters();
    setNativePrinterScanning(false);
    if (!result.ok) {
      if (!options.quiet) setTestPrintStatus(result.error || "接続済みプリンターを読み込めませんでした。");
      return;
    }
    setNativePrinterDevices(result.devices);
    const likelyStarPrinters = result.devices.filter((device) => device.isLikelyStarPrinter);
    const selectedDevice = likelyStarPrinters.length === 1
      ? likelyStarPrinters[0]
      : result.devices.length === 1
        ? result.devices[0]
        : null;
    if (options.autoApply && selectedDevice) {
      applyNativePrinterDevice(selectedDevice, true);
      return;
    }
    if (!options.quiet) {
      setTestPrintStatus(result.devices.length
        ? "接続済みプリンターを読み込みました。使用するプリンターを選択してください。"
        : "Android にペアリング済みプリンターが見つかりません。先に Bluetooth 設定で mPOP をペアリングしてください。"
      );
    }
  }

  const activeReceiptTemplate = resolvePosReceiptTemplate(taxForm.printerSettings, receiptPreviewBrandId, receiptPreviewMode);

  function updateReceiptTemplate(patch: Partial<PosReceiptTemplateSettings>) {
    setTaxForm((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        ...(receiptPreviewBrandId || receiptPreviewMode === "invoice" ? {
          receiptTemplateVariants: [
            ...current.printerSettings.receiptTemplateVariants.filter((item) => item.brandId !== receiptPreviewBrandId || item.documentType !== receiptPreviewMode),
            {
              brandId: receiptPreviewBrandId,
              brandName: current.posBrandSettings.find((item) => item.brandId === receiptPreviewBrandId)?.brandName ?? "",
              documentType: receiptPreviewMode,
              template: { ...resolvePosReceiptTemplate(current.printerSettings, receiptPreviewBrandId, receiptPreviewMode), ...patch }
            }
          ]
        } : {
          receiptTemplate: { ...current.printerSettings.receiptTemplate, ...patch }
        })
      }
    }));
  }

  function removeReceiptTemplateOverride() {
    if (!receiptPreviewBrandId && receiptPreviewMode === "receipt") return;
    setTaxForm((current) => ({
      ...current,
      printerSettings: {
        ...current.printerSettings,
        receiptTemplateVariants: current.printerSettings.receiptTemplateVariants.filter((item) => item.brandId !== receiptPreviewBrandId || item.documentType !== receiptPreviewMode)
      }
    }));
  }

  function moveReceiptTemplateBlock(block: PosReceiptTemplateBlock, direction: -1 | 1) {
    const order = [...activeReceiptTemplate.blockOrder];
    const index = order.indexOf(block);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateReceiptTemplate({ blockOrder: order });
  }

  function createSavePayloadForm(section: PosSettingsSaveSection = "all") {
    if (section === "all" || !savedTaxForm) return taxForm;
    if (section === "general") return { ...savedTaxForm, ...generalFields(taxForm) };
    if (section === "customerDisplayMedia") return { ...savedTaxForm, customerDisplayMediaSettings: { ...mediaFields(taxForm.customerDisplayMediaSettings), standby: savedTaxForm.customerDisplayMediaSettings.standby } };
    if (section === "customerDisplayStandby") return { ...savedTaxForm, customerDisplayMediaSettings: { ...savedTaxForm.customerDisplayMediaSettings, standby: taxForm.customerDisplayMediaSettings.standby } };
    if (section === "fulfillment") return { ...savedTaxForm, fulfillmentWorkspace: taxForm.fulfillmentWorkspace };
    if (section === "printing") return { ...savedTaxForm, printerSettings: taxForm.printerSettings };
    if (section === "receiptConnection") return { ...savedTaxForm, printerSettings: { ...savedTaxForm.printerSettings, ...receiptConnectionFields(taxForm.printerSettings) } };
    if (section === "receipt") return { ...savedTaxForm, printerSettings: taxForm.printerSettings };
    if (section === "discount") return { ...savedTaxForm, discountPresets: taxForm.discountPresets };
    if (section === "tare") return { ...savedTaxForm, scaleTareSettings: taxForm.scaleTareSettings };
    if (section === "filter") return { ...savedTaxForm, scaleFilterSettings: taxForm.scaleFilterSettings };
    return taxForm;
  }

  function applySavedSection(section: PosSettingsSaveSection, settings: Partial<PosTaxSettings>) {
    const normalizedSaved: PosTaxFormState = {
      dineInEnabled: settings.dineInEnabled !== false,
      takeoutEnabled: settings.takeoutEnabled !== false,
      dineInTaxRate: String(settings.dineInTaxRate ?? taxForm.dineInTaxRate),
      takeoutTaxRate: String(settings.takeoutTaxRate ?? taxForm.takeoutTaxRate),
      externalPaymentTerminalBrand: settings.externalPaymentTerminalBrand ?? taxForm.externalPaymentTerminalBrand,
      priceTaxMode: settings.priceTaxMode ?? taxForm.priceTaxMode,
      discountPresets: Array.isArray(settings.discountPresets) ? settings.discountPresets : taxForm.discountPresets,
      customerDisplayMediaSettings: { ...(settings.customerDisplayMediaSettings ?? taxForm.customerDisplayMediaSettings), standby: normalizePosDisplayStandbySettings((settings.customerDisplayMediaSettings ?? taxForm.customerDisplayMediaSettings).standby) },
      printerSettings: settings.printerSettings ?? taxForm.printerSettings,
      posBrandSettings: Array.isArray(settings.posBrandSettings) ? settings.posBrandSettings : taxForm.posBrandSettings,
      scaleTareSettings: settings.scaleTareSettings ? createPosScaleTareForm(settings.scaleTareSettings) : taxForm.scaleTareSettings,
      scaleFilterSettings: settings.scaleFilterSettings ? createPosScaleFilterForm(settings.scaleFilterSettings) : taxForm.scaleFilterSettings,
      fulfillmentWorkspace: settings.fulfillmentWorkspace ? createPosFulfillmentForm(settings.fulfillmentWorkspace) : taxForm.fulfillmentWorkspace
    };

    function merge(current:PosTaxFormState|null):PosTaxFormState {
      if(section==="all"||!current)return normalizedSaved;
      if(section==="general")return {...current,...generalFields(normalizedSaved)};
      if(section==="customerDisplayMedia")return {...current,customerDisplayMediaSettings:{...mediaFields(normalizedSaved.customerDisplayMediaSettings),standby:current.customerDisplayMediaSettings.standby}};
      if(section==="customerDisplayStandby")return {...current,customerDisplayMediaSettings:{...current.customerDisplayMediaSettings,standby:normalizedSaved.customerDisplayMediaSettings.standby}};
      if(section==="printing"||section==="receiptConnection")return {...current,printerSettings:{...current.printerSettings,...(section==="printing"?printingFields(normalizedSaved.printerSettings):receiptConnectionFields(normalizedSaved.printerSettings))}};
      const patch=section==="fulfillment"?{fulfillmentWorkspace:normalizedSaved.fulfillmentWorkspace}:section==="receipt"?{printerSettings:normalizedSaved.printerSettings}:section==="discount"?{discountPresets:normalizedSaved.discountPresets}:section==="tare"?{scaleTareSettings:normalizedSaved.scaleTareSettings}:{scaleFilterSettings:normalizedSaved.scaleFilterSettings};
      return {...current,...patch};
    }
    setTaxForm(merge);setSavedTaxForm(merge);
  }

  async function savePosSettings(options: { quiet?: boolean; successMessage?: string; section?: PosSettingsSaveSection; categoryBatch?: boolean } = {}) {
    if ((categorySavingRef.current&&!options.categoryBatch) || !selectedStoreId || activeStoreRef.current !== selectedStoreId || settingsLoadingRef.current || !canManagePosSettings || taxSavingRef.current || standbyUploadingRef.current) return false;
    const saveStoreId = selectedStoreId;
    const loadSequence = settingsLoadSequence.current;
    const saveSequence = ++settingsSaveSequence.current;
    const isCurrentSave = () => activeStoreRef.current === saveStoreId && settingsLoadSequence.current === loadSequence
      && settingsSaveSequence.current === saveSequence;
    const section = options.section ?? "all";
    const payloadForm = createSavePayloadForm(section);
    const campaignError = section === "all" || section === "discount" ? validatePosCampaignPresets(payloadForm.discountPresets) : null;
    if (campaignError) {
      const invalid = payloadForm.discountPresets.find(preset => validatePosCampaignPresets([preset]));
      if (invalid) {
        setActiveSettingsPane("discount"); setDiscountQuery(""); setDiscountStatus("all"); setExpandedDiscountKey(invalid.key);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const row = [...document.querySelectorAll<HTMLElement>("[data-pos-discount-key]")].find(element => element.dataset.posDiscountKey === invalid.key);
          row?.scrollIntoView({block:"center"});
          if (!invalid.name.trim()) row?.querySelector<HTMLInputElement>("[data-pos-discount-name]")?.focus({preventScroll:true});
        }));
      }
      setMessage(t(campaignError)); return false;
    }
    const tareValidation = section === "all" || section === "tare" ? validatePosScaleTareForm(payloadForm.scaleTareSettings) : null;
    const filterValidation = section === "all" || section === "filter" ? validatePosScaleFilterForm(payloadForm.scaleFilterSettings) : null;
    const fulfillmentValidation = section === "all" || section === "fulfillment" ? validatePosFulfillmentForm(payloadForm.fulfillmentWorkspace) : null;
    const standbyValidation = section === "all" || section === "customerDisplayStandby" ? validatePosDisplayStandbySettings(payloadForm.customerDisplayMediaSettings.standby) : null;
    if (standbyValidation?.error || tareValidation?.error || filterValidation?.error || fulfillmentValidation?.error) {
      setMessage(translatePosDisplayStandbyError(standbyValidation?.error || tareValidation?.error || filterValidation?.error || fulfillmentValidation?.error || "POS 設定を保存できませんでした。", t));
      return false;
    }
    taxSavingRef.current = true;
    setTaxSaving(true);
    if (!options.quiet) setMessage("");
    try {
      const response = await fetch("/api/os/pos/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(section === "general" ? { storeId:saveStoreId, section:"general", ...generalFields(payloadForm) } : section === "customerDisplayMedia" ? { storeId:saveStoreId, section:"customerDisplayMedia",customerDisplayMediaSettings:mediaFields(payloadForm.customerDisplayMediaSettings) } : section === "customerDisplayStandby" ? {
          storeId: saveStoreId, section: "customerDisplayStandby", customerDisplayStandby: standbyValidation?.settings
        } : section === "discount" ? {
          storeId: saveStoreId, section: "discount", discountPresets: payloadForm.discountPresets, discountCampaignVersion: 5
        } : section === "receiptConnection" ? {
          storeId: saveStoreId, section: "receiptConnection", printerSettings: receiptConnectionFields(payloadForm.printerSettings)
        } : section === "printing" ? {
          storeId: saveStoreId, section: "printing", printerSettings: payloadForm.printerSettings
        } : section === "fulfillment" ? {
          storeId: saveStoreId,
          section: "fulfillment",
          fulfillmentWorkspace: fulfillmentValidation?.settings
        } : section === "filter" ? {
          storeId: selectedStoreId,
          section: "filter",
          scaleFilterSettings: filterValidation?.settings
        } : section === "tare" ? {
          storeId: selectedStoreId,
          section: "tare",
          scaleTareSettings: tareValidation?.settings
        } : {
          storeId: selectedStoreId,
          ...(section === "all" ? { customerDisplayStandby: standbyValidation?.settings, scaleTareSettings: tareValidation?.settings, scaleFilterSettings: filterValidation?.settings, fulfillmentWorkspace: fulfillmentValidation?.settings } : {}),
          dineInEnabled: payloadForm.dineInEnabled,
          takeoutEnabled: payloadForm.takeoutEnabled,
          dineInTaxRate: payloadForm.dineInTaxRate,
          takeoutTaxRate: payloadForm.takeoutTaxRate,
          externalPaymentTerminalBrand: payloadForm.externalPaymentTerminalBrand,
          priceTaxMode: payloadForm.priceTaxMode,
          discountPresets: payloadForm.discountPresets,
          discountCampaignVersion: 5,
          customerDisplayMediaSettings: payloadForm.customerDisplayMediaSettings,
          printerSettings: payloadForm.printerSettings,
          posBrandSettings: payloadForm.posBrandSettings
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!isCurrentSave()) return false;
      if (!response.ok) throw new Error(body.error || "POS 設定を保存できませんでした。");
      setTaxSettings(body.settings ?? null);
      applySavedSection(options.section ?? "all", body.settings ?? {});
      if (!options.quiet) setMessage(options.successMessage ?? "POS 設定を保存しました。");
      return true;
    } catch (error) {
      if (!isCurrentSave()) return false;
      const errorMessage = error instanceof Error ? error.message : "POS 設定を保存できませんでした。";
      if (options.quiet) {
        setTestPrintStatus(errorMessage);
      } else {
        setMessage(translatePosDisplayStandbyError(errorMessage, t));
      }
      return false;
    } finally {
      if (settingsSaveSequence.current === saveSequence) {
        taxSavingRef.current = false;
        if (isCurrentSave()) setTaxSaving(false);
      }
    }
  }

  async function saveSettingsGroup() {
    if(categorySavingRef.current||taxSavingRef.current||!savedTaxForm||!canManagePosSettings||loading)return;
    const group=posSettingsGroups.find(item=>item.id===activeSettingsPane)!;
    const sections=group.sections.filter(section=>paneSnapshot(taxForm,section)!==paneSnapshot(savedTaxForm,section));
    if(!sections.length)return;
    // Validate all local scale/workflow/designer drafts before beginning a multi-part save.
    for(const section of sections){
      const validation=section==="tare"?validatePosScaleTareForm(taxForm.scaleTareSettings):section==="filter"?validatePosScaleFilterForm(taxForm.scaleFilterSettings):section==="fulfillment"?validatePosFulfillmentForm(taxForm.fulfillmentWorkspace):section==="customerDisplayStandby"?validatePosDisplayStandbySettings(taxForm.customerDisplayMediaSettings.standby):null;
      if(validation?.error){setMessage(translatePosDisplayStandbyError(validation.error,t));document.querySelector<HTMLDetailsElement>(`[data-pos-settings-pane="${section}"]`)?.setAttribute("open","");return;}
    }
    const store=selectedStoreId,loadSequence=settingsLoadSequence.current;
    categorySavingRef.current=true;setCategorySaving(true);setMessage("");let completed=0;
    try{
      for(const section of sections){
        if(activeStoreRef.current!==store||settingsLoadSequence.current!==loadSequence)return;
        const ok=await savePosSettings({section,categoryBatch:true,successMessage:""});
        if(!ok){if(completed&&activeStoreRef.current===store&&settingsLoadSequence.current===loadSequence)setMessage(current=>`${t("一部の設定は保存済みです。未保存の設定を確認して、もう一度保存してください。")} ${current}`);return;}
        completed++;
      }
      if(activeStoreRef.current===store&&settingsLoadSequence.current===loadSequence)setMessage(t("現在の機能の設定を保存しました。"));
    }finally{categorySavingRef.current=false;setCategorySaving(false);}
  }

  async function testPrint() {
    if (testPrinting) return;
    if (!hasNativePrintBridge) {
      setTestPrintStatus("テスト印刷は iOS / Android アプリで実行してください。ブラウザでは設定の保存のみできます。");
      return;
    }
    const printer = getReceiptPrinter(taxForm.printerSettings);
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
    const saved = await savePosSettings({ quiet: true, section: "receiptConnection" });
    if (!saved) {
      setTestPrinting(false);
      return;
    }
    const result = await printWithAndroidBridge(createTestPrintPayload(printer, taxSettings?.storeName || "Foundr1 OS", activeReceiptTemplate));
    setTestPrintStatus(result.ok ? "プリンター設定を保存し、テスト印刷を送信しました。" : result.error || "テスト印刷に失敗しました。");
    setTestPrinting(false);
  }

  async function testPhysicalCustomerDisplay() {
    if (testPrinting) return;
    const printer = getReceiptPrinter(taxForm.printerSettings);
    if (printer.deviceType !== "star_printer") {
      setTestPrintStatus("mPOPカスタマーディスプレイを使うには、レシートプリンターを Star プリンターに設定してください。");
      return;
    }
    setTestPrinting(true);
    setTestPrintStatus("");
    const saved = await savePosSettings({ quiet: true, section: "receiptConnection" });
    if (!saved) {
      setTestPrinting(false);
      return;
    }
    const result = await displayWithAndroidBridge(createPhysicalCustomerDisplayPayload(
      taxForm.printerSettings,
      taxForm.printerSettings.customerDisplay.standbyLine1 || taxSettings?.storeName || "Foundr1 OS",
      taxForm.printerSettings.customerDisplay.standbyLine2
    ));
    setTestPrintStatus(result.ok ? "カスタマーディスプレイ設定を保存し、テスト表示を送信しました。" : result.error || "カスタマーディスプレイのテストに失敗しました。");
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

  const hasUnsavedPosSettings = Boolean(savedTaxFormSnapshot && createPosTaxFormSnapshot(taxForm) !== savedTaxFormSnapshot);
  const { guardAction, unsavedChangesDialog } = useUnsavedChangesGuard({
    isDirty: hasUnsavedPosSettings,
    onSave: () => savePosSettings(),
    title: "POS 設定に未保存の変更があります",
    message: "店舗を切り替える、または別ページへ移動する前に、現在の店舗設定を保存できます。"
  });

  function renderReceiptPreviewBlock(block: PosReceiptTemplateBlock) {
    if (block === "logo") return activeReceiptTemplate.showLogo ? (
      activeReceiptTemplate.logoUrl
        ? <img className={`pos-admin-receipt-paper-logo is-${activeReceiptTemplate.logoAlignment}`} style={{ width: `${activeReceiptTemplate.logoWidthPercent}%`, marginBottom: `${activeReceiptTemplate.logoBottomSpacing}px` }} src={activeReceiptTemplate.logoUrl} alt="" />
        : <div className={`pos-admin-receipt-paper-logo-placeholder is-${activeReceiptTemplate.logoAlignment}`} style={{ width: `${activeReceiptTemplate.logoWidthPercent}%`, marginBottom: `${activeReceiptTemplate.logoBottomSpacing}px` }}>LOGO</div>
    ) : null;
    if (block === "business") return <h5 className={`is-${activeReceiptTemplate.businessNameAlignment} is-size-${activeReceiptTemplate.businessNameTextSize}`}>{activeReceiptTemplate.businessName || taxSettings?.storeName || "店舗名"}</h5>;
    if (block === "contact") return (
      <div className="pos-admin-receipt-preview-block">
        {getReceiptPreviewLines(activeReceiptTemplate.companyInfo).map((line, index) => <p className={`is-${activeReceiptTemplate.contactInfoAlignment}`} key={`company-${index}`}>{line}</p>)}
        {getReceiptPreviewLines(activeReceiptTemplate.address).map((line, index) => <p className={`is-${activeReceiptTemplate.contactInfoAlignment}`} key={`address-${index}`}>{line}</p>)}
        {activeReceiptTemplate.taxRegistrationNumber ? <p className={`is-${activeReceiptTemplate.contactInfoAlignment}`}>登録番号: {activeReceiptTemplate.taxRegistrationNumber}</p> : null}
        {activeReceiptTemplate.phone ? <p className={`is-${activeReceiptTemplate.contactInfoAlignment}`}>TEL: {activeReceiptTemplate.phone}</p> : null}
        {activeReceiptTemplate.website ? <p className={`is-${activeReceiptTemplate.contactInfoAlignment}`}>{activeReceiptTemplate.website}</p> : null}
      </div>
    );
    if (block === "message") return (
      <div className={`pos-admin-receipt-preview-block is-message is-size-${activeReceiptTemplate.messageTextSize}`}>
        {getReceiptPreviewLines(activeReceiptTemplate.headerMessage).map((line, index) => <p className={`is-${activeReceiptTemplate.messageAlignment}`} key={`header-${index}`}>{line}</p>)}
      </div>
    );
    if (block === "promotion") return activeReceiptTemplate.promotionImageUrl || activeReceiptTemplate.promotionMessage ? (
      <div className={`pos-admin-receipt-preview-block is-message is-size-${activeReceiptTemplate.messageTextSize}`}>
        {activeReceiptTemplate.promotionImageUrl ? <img className={`pos-admin-receipt-paper-promo is-${activeReceiptTemplate.promotionImageAlignment}`} style={{ width: `${activeReceiptTemplate.promotionImageWidthPercent}%` }} src={activeReceiptTemplate.promotionImageUrl} alt="" /> : null}
        {getReceiptPreviewLines(activeReceiptTemplate.promotionMessage).map((line, index) => <p className={`is-${activeReceiptTemplate.messageAlignment}`} key={`promotion-${index}`}>{line}</p>)}
      </div>
    ) : null;
    if (block === "qr") return activeReceiptTemplate.qrCodeEnabled ? <ReceiptQrPreview value={activeReceiptTemplate.qrCodeUrl} label={activeReceiptTemplate.qrCodeLabel} size={activeReceiptTemplate.qrCodeSize} alignment={activeReceiptTemplate.qrCodeAlignment} /> : null;
    if (block === "footer") return (
      <div className={`pos-admin-receipt-preview-block is-message is-size-${activeReceiptTemplate.messageTextSize}`}>
        {getReceiptPreviewLines(activeReceiptTemplate.footerMessage).map((line, index) => <p className={`is-${activeReceiptTemplate.messageAlignment}`} key={`footer-${index}`}>{line}</p>)}
        {activeReceiptTemplate.showTimestamp ? <p>2026-06-14 12:34:56</p> : null}
      </div>
    );
    return (
      <div className="pos-admin-receipt-preview-block is-receipt-content">
        <div className="pos-admin-receipt-paper-rule" />
        <h5 className={`is-size-${activeReceiptTemplate.titleTextSize}`}>{receiptPreviewMode === "invoice" ? activeReceiptTemplate.invoiceTitle : activeReceiptTemplate.receiptTitle}</h5>
        {receiptPreviewMode === "invoice" ? <><div className="pos-admin-receipt-paper-line is-strong"><span>{invoiceRecipientLabel(activeReceiptTemplate.invoiceRecipientName)}</span></div><p>但し {activeReceiptTemplate.invoicePurposeText}として</p><div className="pos-admin-receipt-paper-rule" /></> : null}
        <div className="pos-admin-receipt-paper-line is-strong"><span>No. F1-1234</span><span /></div>
        <p>店内 / 現金</p>
        <div className="pos-admin-receipt-paper-rule" />
        <div className="pos-admin-receipt-paper-line"><span>麻辣湯 250g x1</span><span>{formatYen(1000)}</span></div>
        <p className="is-sub">  味: 豚骨 / 辛さ: 普通 / しびれ: 普通 / 春雨 50g x2 / 牛筋 50g</p>
        <div className="pos-admin-receipt-paper-line"><span>ウーロン茶 x1</span><span>{formatYen(450)}</span></div>
        <p className="is-sub">  食事と一緒に提供</p>
        <div className="pos-admin-receipt-paper-rule" />
        <div className="pos-admin-receipt-paper-line"><span>小計</span><span>{formatYen(1450)}</span></div>
        <div className="pos-admin-receipt-paper-line"><span>割引</span><span>-{formatYen(145)}</span></div>
        {activeReceiptTemplate.showTaxSummary ? <div className="pos-admin-receipt-paper-line"><span>消費税 10%</span><span>{formatYen(130)}</span></div> : null}
        <div className="pos-admin-receipt-paper-line is-total"><span>合計</span><span>{formatYen(1305)}</span></div>
        <div className="pos-admin-receipt-paper-line"><span>お預かり</span><span>{formatYen(2000)}</span></div>
        <div className="pos-admin-receipt-paper-line"><span>お釣り</span><span>{formatYen(695)}</span></div>
        {activeReceiptTemplate.showOrderNote ? <><div className="pos-admin-receipt-paper-rule" /><p>備考: 領収書希望</p></> : null}
        <div className="pos-admin-receipt-paper-rule" />
      </div>
    );
  }

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

  useEffect(() => {
    const printer = getReceiptPrinter(taxForm.printerSettings);
    if (!hasNativePrintBridge || !canManagePosSettings || nativePrinterDevices.length || nativePrinterScanning) return;
    if (printer.deviceType === "star_printer" && !printer.identifier) {
      void refreshNativePrinterDevices({ autoApply: true, quiet: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNativePrintBridge, canManagePosSettings, taxForm.printerSettings]);

  const dirtySettingsPanes = Object.fromEntries(posSettingsGroups.map(group=>[group.id,Boolean(savedTaxForm)&&group.sections.some(section=>paneSnapshot(taxForm,section)!==paneSnapshot(savedTaxForm!,section))])) as Record<PosSettingsGroup,boolean>;
  const otherDirtySettingsCount=posSettingsGroups.filter(group=>group.id!==activeSettingsPane&&dirtySettingsPanes[group.id]).length;
  const activeGroup=posSettingsGroups.find(group=>group.id===activeSettingsPane)!;
  function renderSettingsPane(pane:PosSettingsPane,children:React.ReactNode) {
    if(!(activeGroup.sections as readonly string[]).includes(pane))return null;
    const content=<fieldset className={settingsNavigationStyles.sectionFields} disabled={taxSaving||categorySaving||loading}>{children}</fieldset>;
    const collapsedLabel=pane==="filter"?"高度な設定：はかりの揺れ対策":pane==="customerDisplayStandby"?"待機画面を編集":pane==="receiptConnection"?"プリンター接続・テスト印刷":"";
    return collapsedLabel?<details className={settingsNavigationStyles.subsection} data-pos-settings-pane={pane}><summary>{t(collapsedLabel)}</summary>{content}</details>:<section className={settingsNavigationStyles.subsection} data-pos-settings-pane={pane}>{content}</section>;
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

        {message ? <div className={`action-notice ${settingsNavigationStyles.message}`} role="status">{message}</div> : null}

        <section className="panel pos-admin-toolbar">
          <label className="store-context-selector is-os">
            <span>設定対象店舗</span>
            <strong>{stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗未選択"}</strong>
            <select
              value={selectedStoreId}
              disabled={loading || (taxSaving||categorySaving)}
              onChange={(event) => {
                const storeId = event.target.value;
                guardAction(() => {
                  setSelectedStoreId(storeId);
                  setExpandedDiscountKey(""); setDiscountQuery(""); setDiscountStatus("all");
                  void load(storeId);
                }, "店舗を切替");
              }}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <small>この店舗の POS 設定を編集中</small>
          </label>
          <div className="pos-admin-actions">
            <a href="/os/menus"><MenuSquare size={16} />メニュー管理</a>
            <a href="/os/pos/reconciliation"><WalletCards size={16} />日次レジ締め</a>
            <a href="/os/pos/table-order"><QrCode size={16} />テーブルQR注文</a>
            <a href="/os/analytics/sales"><BarChart3 size={16} />売上分析</a>
            <a href={`/os/stores/devices${selectedStoreId ? `?storeId=${encodeURIComponent(selectedStoreId)}` : ""}`}><MonitorSmartphone size={16} />表示・設備設定</a>
            <a href="/os/stores"><Store size={16} />店舗設定</a>
          </div>
        </section>

        {hasUnsavedPosSettings ? <p className={settingsNavigationStyles.globalHint}>{t("POS 設定に未保存の変更があります。移動前に保存してください。")}</p> : null}

        <section className="panel pos-admin-tax-settings">
          <div className="panel-title">
            <WalletCards />
            <div>
              <h3>POS 設定</h3>
              <p>{t("機能を選んで設定します。保存は現在の機能だけに反映されます。")}</p>
            </div>
          </div>
          <PosSettingsNavigation active={activeSettingsPane} dirty={dirtySettingsPanes} disabled={loading||(taxSaving||categorySaving)||standbyUploading||Boolean(uploadingMediaType)||Boolean(uploadingReceiptImageSlot)} onChange={pane=>{setActiveSettingsPane(pane);setMessage("");}} />
          <div role="tabpanel" id={`pos-settings-group-${activeSettingsPane}`} aria-labelledby={`pos-settings-tab-${activeSettingsPane}`} data-pos-settings-group={activeSettingsPane}>
          {activeSettingsPane==="scale"?<p className={settingsNavigationStyles.connectionHint}>{t("はかりの接続・中継端末の管理は設備設定で行います。")} <a href={`/os/stores/devices${selectedStoreId?`?storeId=${encodeURIComponent(selectedStoreId)}`:""}`}>{t("設備設定を開く")}</a></p>:null}
          {renderSettingsPane("general", <>
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
            <label className="pos-admin-tax-toggle">
              <span>持ち帰り</span>
              <div>
                <input
                  type="checkbox"
                  checked={taxForm.takeoutEnabled}
                  onChange={(event) => setTaxForm((current) => ({ ...current, takeoutEnabled: event.target.checked }))}
                  disabled={!canManagePosSettings}
                />
                <strong>持ち帰りを POS に表示する</strong>
              </div>
            </label>
            <label>
              <span>店内飲食 税率（%）</span>
              <input
                inputMode="decimal"
                data-pos-general-dine-tax value={taxForm.dineInTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, dineInTaxRate: normalizeDecimalInput(event.target.value) }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>持ち帰り 税率（%）</span>
              <input
                inputMode="decimal"
                data-pos-general-takeout-tax value={taxForm.takeoutTaxRate}
                onChange={(event) => setTaxForm((current) => ({ ...current, takeoutTaxRate: normalizeDecimalInput(event.target.value) }))}
                disabled={!canManagePosSettings}
              />
            </label>
            <label>
              <span>外部決済端末</span>
              <select
                data-pos-general-terminal value={taxForm.externalPaymentTerminalBrand}
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
                data-pos-general-tax-mode value={taxForm.priceTaxMode}
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
                <h4>基本商品の販売方法（初期値）</h4>
                <p>麺・追加食材・ドリンクは個数で計算します。店内メニューの商品別設定が優先されます。</p>
                <p>この初期値を変更しても、作成済みの店内メニューは変更されません。</p>
              </div>
            </div>
            <div className="pos-admin-brand-pricing-list">
              {taxForm.posBrandSettings.length ? taxForm.posBrandSettings.map((setting, index) => (
                <div className="pos-admin-brand-pricing-row" key={setting.brandId}>
                  <strong>{setting.brandName}</strong>
                  <label>
                    <span>基本商品の販売方法（初期値）</span>
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
          </>)}
          <div hidden={activeSettingsPane !== "general"}>
            <PosCounterMenuPolicySettings key={selectedStoreId} storeId={selectedStoreId} active={activeSettingsPane === "general"}
              canManage={canManagePosSettings} blocked={loading || taxSaving || categorySaving} />
          </div>
          {renderSettingsPane("fulfillment", <>
          <PosFulfillmentSettingsSection
            value={taxForm.fulfillmentWorkspace}
            onChange={(fulfillmentWorkspace) => setTaxForm((current) => ({ ...current, fulfillmentWorkspace }))}
            canManage={canManagePosSettings && !loading}
            saving={(taxSaving||categorySaving)}
            onSave={() => void savePosSettings({ successMessage: t("受け渡し設定を保存しました。"), section: "fulfillment" })}
          />
          </>)}
          {renderSettingsPane("tare", <>
          <PosScaleTareSettingsSection
            value={taxForm.scaleTareSettings}
            onChange={(scaleTareSettings) => setTaxForm((current) => ({ ...current, scaleTareSettings }))}
            canManage={canManagePosSettings && !loading}
            saving={(taxSaving||categorySaving)}
            onSave={() => void savePosSettings({ successMessage: t("ボウルの重さを保存しました。"), section: "tare" })}
          />
          </>)}
          {renderSettingsPane("filter", <>
          <PosScaleFilterSettingsSection
            value={taxForm.scaleFilterSettings}
            onChange={(scaleFilterSettings) => setTaxForm((current) => ({ ...current, scaleFilterSettings }))}
            canManage={canManagePosSettings && !loading}
            saving={(taxSaving||categorySaving)}
            onSave={() => void savePosSettings({ successMessage: t("揺れ対策を保存しました。"), section: "filter" })}
          />
          </>)}
          {renderSettingsPane("customerDisplayStandby", <>
          <PosDisplayStandbyEditor key={selectedStoreId} value={taxForm.customerDisplayMediaSettings.standby}
            onUploadingChange={busy => { standbyUploadingRef.current = busy; setStandbyUploading(busy); }}
            storeId={selectedStoreId} storeName={taxSettings?.storeName || stores.find(store => store.id === selectedStoreId)?.name || ""}
            onChange={standby => setTaxForm(current => ({ ...current, customerDisplayMediaSettings: { ...current.customerDisplayMediaSettings, standby } }))}
            canManage={canManagePosSettings && !loading} saving={(taxSaving||categorySaving)}
            onSave={() => void savePosSettings({ section: "customerDisplayStandby", successMessage: t("待機画面を保存しました。客席表示のメニューから更新してください。") })} />
          </>)}
          {renderSettingsPane("customerDisplayMedia", <>
          <div className="pos-admin-display-media-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>{t("待機中の広告（画像・動画）")}</h4>
                <p>空き時間に表示する画像スライドショー、動画、切り替え効果を店舗ごとに設定します。</p>
              </div>
            </div>
            <div className="pos-admin-display-media-grid">
              <label>
                <span>表示モード</span>
                <select
                  data-pos-media-mode value={taxForm.customerDisplayMediaSettings.mode}
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
          </>)}
          {renderSettingsPane("receiptConnection", <>
          <div className="pos-admin-printer-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>{t("プリンター接続")}</h4>
                <p>{t("接続先・用紙幅・印刷待ちの表示を設定します。伝票の内容は「印刷・伝票」で設定・保存します。")}</p>
              </div>
              <div className="pos-admin-printer-actions">
                <button className="secondary-button" type="button" data-pos-save-section="receiptConnection" onClick={() => void savePosSettings({ successMessage: t("プリンター接続設定を保存しました。"), section: "receiptConnection" })} disabled={!canManagePosSettings || (taxSaving||categorySaving)}>
                  {(taxSaving||categorySaving) ? t("保存中...") : t("プリンター接続設定を保存")}
                </button>
                <button className="secondary-button" type="button" onClick={() => void testPrint()} disabled={!canManagePosSettings || (taxSaving||categorySaving) || testPrinting || !hasNativePrintBridge}>
                  <Printer size={15} />
                  {testPrinting ? "送信中..." : hasNativePrintBridge ? "テスト印刷" : "アプリでテスト"}
                </button>
                <button className="secondary-button" type="button" onClick={() => void testPhysicalCustomerDisplay()} disabled={!canManagePosSettings || (taxSaving||categorySaving) || testPrinting || !hasNativePrintBridge || !taxForm.printerSettings.customerDisplay.enabled}>
                  <MonitorSmartphone size={15} />
                  客表示テスト
                </button>
                <button className="secondary-button" type="button" onClick={() => void refreshNativePrinterDevices()} disabled={!canManagePosSettings || !hasNativePrintBridge || nativePrinterScanning}>
                  {nativePrinterScanning ? "読込中..." : "接続済みを読込"}
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
                  checked={taxForm.printerSettings.showPrintQueue ?? true}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    printerSettings: { ...current.printerSettings, showPrintQueue: event.target.checked }
                  }))}
                  disabled={!canManagePosSettings}
                />
                <span>POS の「印刷待ち・再印刷」欄を表示</span>
              </label>
              <label className="pos-admin-discount-check">
                <input
                  type="checkbox"
                  checked={taxForm.printerSettings.customerDisplay.enabled}
                  onChange={(event) => setTaxForm((current) => ({
                    ...current,
                    printerSettings: {
                      ...current.printerSettings,
                      customerDisplay: { ...current.printerSettings.customerDisplay, enabled: event.target.checked }
                    }
                  }))}
                  disabled={!canManagePosSettings || getReceiptPrinter(taxForm.printerSettings).deviceType !== "star_printer"}
                />
                <span>mPOPカスタマーディスプレイ（SCD222U）を使用</span>
              </label>
            </div>
            <p className="pos-admin-printer-status">OFF にすると POS ホームの印刷待ち欄を隠します。印刷と未印刷の記録は続き、会計履歴から確認・再印刷できます。</p>
            {taxForm.printerSettings.customerDisplay.enabled ? (
              <div className="pos-admin-printer-card">
                <div>
                  <strong>SCD222U 表示内容</strong>
                  <p>2行表示に合わせて、各項目は20文字以内で設定します。1行目を空欄にすると店舗名を表示します。</p>
                </div>
                <div className="pos-admin-customer-display-preview">
                  <div className="pos-admin-customer-display-preview-toolbar">
                    <span>液晶プレビュー</span>
                    <select value={physicalDisplayPreviewMode} onChange={(event) => setPhysicalDisplayPreviewMode(event.target.value as typeof physicalDisplayPreviewMode)}>
                      <option value="standby">待機中</option>
                      <option value="order">注文中</option>
                      <option value="cash">現金会計</option>
                      <option value="complete">会計完了</option>
                    </select>
                  </div>
                  <div className="pos-admin-customer-display-screen" aria-label="SCD222U 表示プレビュー">
                    {physicalDisplayPreviewMode === "standby" ? (
                      <>
                        <span>{taxForm.printerSettings.customerDisplay.standbyLine1 || taxSettings?.storeName || "店舗名"}</span>
                        <span>{taxForm.printerSettings.customerDisplay.standbyLine2 || " "}</span>
                      </>
                    ) : physicalDisplayPreviewMode === "order" ? (
                      <>
                        <span>{taxForm.printerSettings.customerDisplay.showItemName ? "商品名サンプル x2" : taxForm.printerSettings.customerDisplay.orderPrompt || " "}</span>
                        <span>{taxForm.printerSettings.customerDisplay.totalLabel || "合計"} ¥1,280</span>
                      </>
                    ) : physicalDisplayPreviewMode === "cash" ? (
                      <>
                        <span>{taxForm.printerSettings.customerDisplay.tenderedLabel || "お預かり"} ¥2,000</span>
                        <span>{taxForm.printerSettings.customerDisplay.changeLabel || "お釣り"} ¥720</span>
                      </>
                    ) : (
                      <>
                        <span>{taxForm.printerSettings.customerDisplay.thankYouLine || " "}</span>
                        <span>{taxForm.printerSettings.customerDisplay.totalLabel || "合計"} ¥1,280</span>
                      </>
                    )}
                  </div>
                  <p>プレビューの金額と商品名は表示例です。</p>
                </div>
                <div className="pos-admin-printer-grid">
                  <label>
                    <span>待機中・1行目（空欄は店舗名）</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.standbyLine1}
                      maxLength={20}
                      placeholder={taxSettings?.storeName || "店舗名"}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, standbyLine1: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>待機中・2行目</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.standbyLine2}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, standbyLine2: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>商品名を表示しない時の1行目</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.orderPrompt}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, orderPrompt: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>会計完了・1行目</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.thankYouLine}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, thankYouLine: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>合計金額のラベル</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.totalLabel}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, totalLabel: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>お預かり金額のラベル</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.tenderedLabel}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, tenderedLabel: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label>
                    <span>お釣り金額のラベル</span>
                    <input
                      value={taxForm.printerSettings.customerDisplay.changeLabel}
                      maxLength={20}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, changeLabel: event.target.value } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  <label className="pos-admin-discount-check">
                    <input
                      type="checkbox"
                      checked={taxForm.printerSettings.customerDisplay.showItemName}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        printerSettings: { ...current.printerSettings, customerDisplay: { ...current.printerSettings.customerDisplay, showItemName: event.target.checked } }
                      }))}
                      disabled={!canManagePosSettings}
                    />
                    <span>注文中に最後に追加した商品名を表示</span>
                  </label>
                </div>
              </div>
            ) : null}
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
                  <input data-pos-printer-host value={getReceiptPrinter(taxForm.printerSettings).host} onChange={(event) => updateReceiptPrinter({ host: event.target.value.trim(), identifier: event.target.value.trim() })} placeholder="192.168.0.33" disabled={!canManagePosSettings || !isNetworkPrinter(getReceiptPrinter(taxForm.printerSettings))} />
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
              {nativePrinterDevices.length ? (
                <div className="pos-admin-printer-actions">
                  {nativePrinterDevices.map((device) => (
                    <button className="secondary-button" type="button" key={`${device.address}-${device.name}`} onClick={() => applyNativePrinterDevice(device)} disabled={!canManagePosSettings}>
                      {device.name || device.address || "Bluetooth printer"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {testPrintStatus ? <p className="pos-admin-printer-status">{testPrintStatus}</p> : null}
          </div>
          </>)}
          {renderSettingsPane("printing", <>
          <PosPrintDocumentsEditor settings={taxForm.printerSettings} kind={printDocumentTab} onKindChange={setPrintDocumentTab}
            brandId={receiptPreviewBrandId} onBrandChange={setReceiptPreviewBrandId} brands={taxForm.posBrandSettings}
            storeName={taxSettings?.storeName || stores.find(store => store.id === selectedStoreId)?.name || t("店舗名")}
            disabled={!canManagePosSettings || (taxSaving||categorySaving) || loading} saving={(taxSaving||categorySaving)}
            onChange={printerSettings => setTaxForm(current => ({ ...current, printerSettings }))}
            onSave={() => void savePosSettings({ section: "printing", successMessage: t("印刷・伝票設定を保存しました。") })}
            recentDocuments={<PosSavedPrintPreviews storeId={selectedStoreId} />}
            receiptEditor={<>
            <div className="pos-admin-printer-card">
              <div>
                <strong>レシートテンプレート</strong>
                <p>レシートに表示する店舗情報、登録番号、連絡先、販促メッセージを管理します。右側で印刷イメージを確認できます。</p>
              </div>
              <div className="pos-admin-receipt-scope-bar">
                <label>
                  <span>帳票</span>
                  <select value={receiptPreviewMode} onChange={(event) => setReceiptPreviewMode(event.target.value as "receipt" | "invoice")}>
                    <option value="receipt">レシート</option>
                    <option value="invoice">領収書</option>
                  </select>
                </label>
                {(receiptPreviewBrandId || receiptPreviewMode === "invoice") ? (
                  <button className="secondary-button" type="button" onClick={removeReceiptTemplateOverride} disabled={!canManagePosSettings || !taxForm.printerSettings.receiptTemplateVariants.some((item) => item.brandId === receiptPreviewBrandId && item.documentType === receiptPreviewMode)}>
                    共通設定に戻す
                  </button>
                ) : <small>このテンプレートが未設定のブランド・帳票の基準になります。</small>}
              </div>
              <div className="pos-admin-receipt-template-workspace">
                <div className="pos-admin-receipt-template-editor">
                  <div className="pos-admin-printer-grid">
                    <label className="pos-admin-discount-check">
                      <input
                        type="checkbox"
                        checked={activeReceiptTemplate.showLogo}
                        onChange={(event) => updateReceiptTemplate({ showLogo: event.target.checked })}
                        disabled={!canManagePosSettings}
                      />
                      <span>ロゴを表示</span>
                    </label>
                    <label>
                      <span>ロゴ位置</span>
                      <select value={activeReceiptTemplate.logoAlignment} onChange={(event) => updateReceiptTemplate({ logoAlignment: event.target.value as PosReceiptTemplateSettings["logoAlignment"] })} disabled={!canManagePosSettings}>
                        <option value="left">左揃え</option>
                        <option value="center">中央揃え</option>
                      </select>
                    </label>
                    <label>
                      <span>ロゴ幅（用紙に対する比率）</span>
                      <div className="pos-admin-receipt-range-control">
                        <input type="range" min="20" max="100" step="5" value={activeReceiptTemplate.logoWidthPercent} onChange={(event) => updateReceiptTemplate({ logoWidthPercent: Number(event.target.value) })} disabled={!canManagePosSettings} />
                        <output>{activeReceiptTemplate.logoWidthPercent}%</output>
                      </div>
                    </label>
                    <label>
                      <span>ロゴ下の間隔</span>
                      <div className="pos-admin-receipt-range-control">
                        <input type="range" min="0" max="40" step="2" value={activeReceiptTemplate.logoBottomSpacing} onChange={(event) => updateReceiptTemplate({ logoBottomSpacing: Number(event.target.value) })} disabled={!canManagePosSettings} />
                        <output>{activeReceiptTemplate.logoBottomSpacing}</output>
                      </div>
                    </label>
                    <div className="pos-admin-receipt-image-field">
                      <span>ロゴ画像</span>
                      <div className="pos-admin-receipt-image-control">
                        {activeReceiptTemplate.logoUrl ? (
                          <img src={activeReceiptTemplate.logoUrl} alt="" />
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
                          {activeReceiptTemplate.logoUrl ? (
                            <button className="secondary-button" type="button" onClick={() => updateReceiptTemplate({ logoUrl: "", showLogo: false })} disabled={!canManagePosSettings}>
                              クリア
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <label>
                      <span>通常タイトル</span>
                      <input
                        data-print-receipt-title value={activeReceiptTemplate.receiptTitle}
                        onChange={(event) => updateReceiptTemplate({ receiptTitle: event.target.value })}
                        placeholder="レシート"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>領収書タイトル</span>
                      <input
                        value={activeReceiptTemplate.invoiceTitle}
                        onChange={(event) => updateReceiptTemplate({ invoiceTitle: event.target.value })}
                        placeholder="領収書"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>領収書 宛名</span>
                      <input
                        value={activeReceiptTemplate.invoiceRecipientName}
                        onChange={(event) => updateReceiptTemplate({ invoiceRecipientName: event.target.value })}
                        placeholder="上様"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>領収書 但し書き</span>
                      <input
                        value={activeReceiptTemplate.invoicePurposeText}
                        onChange={(event) => updateReceiptTemplate({ invoicePurposeText: event.target.value })}
                        placeholder="飲食代"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>表示名</span>
                      <input
                        value={activeReceiptTemplate.businessName}
                        onChange={(event) => updateReceiptTemplate({ businessName: event.target.value })}
                        placeholder="店舗名または会社名"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>店名・表示名の位置</span>
                      <select value={activeReceiptTemplate.businessNameAlignment} onChange={(event) => updateReceiptTemplate({ businessNameAlignment: event.target.value as PosReceiptTemplateSettings["businessNameAlignment"] })} disabled={!canManagePosSettings}>
                        <option value="left">左揃え</option>
                        <option value="center">中央揃え</option>
                      </select>
                    </label>
                    <label>
                      <span>住所・連絡先の位置</span>
                      <select value={activeReceiptTemplate.contactInfoAlignment} onChange={(event) => updateReceiptTemplate({ contactInfoAlignment: event.target.value as PosReceiptTemplateSettings["contactInfoAlignment"] })} disabled={!canManagePosSettings}>
                        <option value="left">左揃え</option>
                        <option value="center">中央揃え</option>
                      </select>
                    </label>
                    <label>
                      <span>お客様向けメッセージの位置</span>
                      <select value={activeReceiptTemplate.messageAlignment} onChange={(event) => updateReceiptTemplate({ messageAlignment: event.target.value as PosReceiptTemplateSettings["messageAlignment"] })} disabled={!canManagePosSettings}>
                        <option value="left">左揃え</option>
                        <option value="center">中央揃え</option>
                      </select>
                    </label>
                    <label>
                      <span>店名の文字サイズ</span>
                      <select value={activeReceiptTemplate.businessNameTextSize} onChange={(event) => updateReceiptTemplate({ businessNameTextSize: event.target.value as PosReceiptTemplateSettings["businessNameTextSize"] })} disabled={!canManagePosSettings}>
                        <option value="small">小</option><option value="standard">標準</option><option value="large">大</option>
                      </select>
                    </label>
                    <label>
                      <span>帳票タイトルの文字サイズ</span>
                      <select value={activeReceiptTemplate.titleTextSize} onChange={(event) => updateReceiptTemplate({ titleTextSize: event.target.value as PosReceiptTemplateSettings["titleTextSize"] })} disabled={!canManagePosSettings}>
                        <option value="small">小</option><option value="standard">標準</option><option value="large">大</option>
                      </select>
                    </label>
                    <label>
                      <span>メッセージの文字サイズ</span>
                      <select value={activeReceiptTemplate.messageTextSize} onChange={(event) => updateReceiptTemplate({ messageTextSize: event.target.value as PosReceiptTemplateSettings["messageTextSize"] })} disabled={!canManagePosSettings}>
                        <option value="small">小</option><option value="standard">標準</option><option value="large">大</option>
                      </select>
                    </label>
                    <label>
                      <span>印刷の間隔</span>
                      <select value={activeReceiptTemplate.density} onChange={(event) => updateReceiptTemplate({ density: event.target.value as PosReceiptTemplateSettings["density"] })} disabled={!canManagePosSettings}>
                        <option value="standard">標準</option><option value="compact">コンパクト（紙を節約）</option>
                      </select>
                    </label>
                    <label>
                      <span>登録番号 / 税号</span>
                      <input
                        value={activeReceiptTemplate.taxRegistrationNumber}
                        onChange={(event) => updateReceiptTemplate({ taxRegistrationNumber: event.target.value })}
                        placeholder="T1234567890123"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>電話番号</span>
                      <input
                        value={activeReceiptTemplate.phone}
                        onChange={(event) => updateReceiptTemplate({ phone: event.target.value })}
                        placeholder="03-0000-0000"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                    <label>
                      <span>Web / SNS</span>
                      <input
                        value={activeReceiptTemplate.website}
                        onChange={(event) => updateReceiptTemplate({ website: event.target.value })}
                        placeholder="https://foundr1.jp"
                        disabled={!canManagePosSettings}
                      />
                    </label>
                  </div>
                  <div className="pos-admin-receipt-template-textareas">
                    <label>
                      <span>会社情報</span>
                      <textarea value={activeReceiptTemplate.companyInfo} onChange={(event) => updateReceiptTemplate({ companyInfo: event.target.value })} disabled={!canManagePosSettings} />
                    </label>
                    <label>
                      <span>住所</span>
                      <textarea value={activeReceiptTemplate.address} onChange={(event) => updateReceiptTemplate({ address: event.target.value })} disabled={!canManagePosSettings} />
                    </label>
                    <label>
                      <span>上部メッセージ</span>
                      <textarea value={activeReceiptTemplate.headerMessage} onChange={(event) => updateReceiptTemplate({ headerMessage: event.target.value })} disabled={!canManagePosSettings} />
                    </label>
                    <label>
                      <span>下部メッセージ</span>
                      <textarea data-print-receipt-footer value={activeReceiptTemplate.footerMessage} onChange={(event) => updateReceiptTemplate({ footerMessage: event.target.value })} disabled={!canManagePosSettings} />
                    </label>
                    <label>
                      <span>販促メッセージ</span>
                      <textarea value={activeReceiptTemplate.promotionMessage} onChange={(event) => updateReceiptTemplate({ promotionMessage: event.target.value })} disabled={!canManagePosSettings} />
                    </label>
                    <div className="pos-admin-receipt-image-field">
                      <span>販促画像</span>
                      <div className="pos-admin-receipt-image-control">
                        {activeReceiptTemplate.promotionImageUrl ? (
                          <img src={activeReceiptTemplate.promotionImageUrl} alt="" />
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
                          {activeReceiptTemplate.promotionImageUrl ? (
                            <button className="secondary-button" type="button" onClick={() => updateReceiptTemplate({ promotionImageUrl: "" })} disabled={!canManagePosSettings}>
                              クリア
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <label>
                      <span>販促画像の位置</span>
                      <select value={activeReceiptTemplate.promotionImageAlignment} onChange={(event) => updateReceiptTemplate({ promotionImageAlignment: event.target.value as PosReceiptTemplateSettings["promotionImageAlignment"] })} disabled={!canManagePosSettings}>
                        <option value="left">左揃え</option><option value="center">中央揃え</option>
                      </select>
                    </label>
                    <label>
                      <span>販促画像の幅</span>
                      <div className="pos-admin-receipt-range-control">
                        <input type="range" min="20" max="100" step="5" value={activeReceiptTemplate.promotionImageWidthPercent} onChange={(event) => updateReceiptTemplate({ promotionImageWidthPercent: Number(event.target.value) })} disabled={!canManagePosSettings} />
                        <output>{activeReceiptTemplate.promotionImageWidthPercent}%</output>
                      </div>
                    </label>
                  </div>
                  <div className="pos-admin-receipt-qr-settings">
                    <label className="pos-admin-discount-check">
                      <input type="checkbox" checked={activeReceiptTemplate.qrCodeEnabled} onChange={(event) => updateReceiptTemplate({ qrCodeEnabled: event.target.checked })} disabled={!canManagePosSettings} />
                      <span>QRコードを表示</span>
                    </label>
                    <label><span>リンク先</span><input type="url" value={activeReceiptTemplate.qrCodeUrl} onChange={(event) => updateReceiptTemplate({ qrCodeUrl: event.target.value })} placeholder="https://foundr1.jp/member" disabled={!canManagePosSettings} /></label>
                    <label><span>QR下の案内</span><input value={activeReceiptTemplate.qrCodeLabel} onChange={(event) => updateReceiptTemplate({ qrCodeLabel: event.target.value })} placeholder="会員登録はこちら" disabled={!canManagePosSettings} /></label>
                    <label><span>QRサイズ</span><select value={activeReceiptTemplate.qrCodeSize} onChange={(event) => updateReceiptTemplate({ qrCodeSize: event.target.value as PosReceiptTemplateSettings["qrCodeSize"] })} disabled={!canManagePosSettings}><option value="small">小</option><option value="medium">標準</option><option value="large">大</option></select></label>
                    <label><span>QR位置</span><select value={activeReceiptTemplate.qrCodeAlignment} onChange={(event) => updateReceiptTemplate({ qrCodeAlignment: event.target.value as PosReceiptTemplateSettings["qrCodeAlignment"] })} disabled={!canManagePosSettings}><option value="left">左揃え</option><option value="center">中央揃え</option></select></label>
                  </div>
                  <div className="pos-admin-printer-toggles">
                    <label className="pos-admin-discount-check">
                      <input type="checkbox" checked={activeReceiptTemplate.showTaxSummary} onChange={(event) => updateReceiptTemplate({ showTaxSummary: event.target.checked })} disabled={!canManagePosSettings} />
                      <span>税明細を表示</span>
                    </label>
                    <label className="pos-admin-discount-check">
                      <input type="checkbox" checked={activeReceiptTemplate.showOrderNote} onChange={(event) => updateReceiptTemplate({ showOrderNote: event.target.checked })} disabled={!canManagePosSettings} />
                      <span>備考を表示</span>
                    </label>
                    <label className="pos-admin-discount-check">
                      <input type="checkbox" checked={activeReceiptTemplate.showTimestamp} onChange={(event) => updateReceiptTemplate({ showTimestamp: event.target.checked })} disabled={!canManagePosSettings} />
                      <span>印刷日時を表示</span>
                    </label>
                  </div>
                  <div className="pos-admin-receipt-block-order">
                    <div><strong>印刷ブロックの順序</strong><span>矢印で上から順に並べ替えます。</span></div>
                    {activeReceiptTemplate.blockOrder.map((block, index) => (
                      <div className="pos-admin-receipt-block-row" key={block}>
                        <span>{index + 1}</span><strong>{receiptTemplateBlockLabels[block]}</strong>
                        <button className="icon-button" type="button" aria-label={`${receiptTemplateBlockLabels[block]}を上へ`} onClick={() => moveReceiptTemplateBlock(block, -1)} disabled={!canManagePosSettings || index === 0}><ArrowUp size={14} /></button>
                        <button className="icon-button" type="button" aria-label={`${receiptTemplateBlockLabels[block]}を下へ`} onClick={() => moveReceiptTemplateBlock(block, 1)} disabled={!canManagePosSettings || index === activeReceiptTemplate.blockOrder.length - 1}><ArrowDown size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <aside className="pos-admin-receipt-preview-panel" aria-label="レシート印刷プレビュー">
                  <div className="pos-admin-receipt-preview-heading">
                    <strong>印刷プレビュー</strong>
                    <select value={receiptPreviewMode} onChange={(event) => setReceiptPreviewMode(event.target.value as "receipt" | "invoice")}>
                      <option value="receipt">レシート</option>
                      <option value="invoice">領収書</option>
                    </select>
                    <span>{getReceiptPrinter(taxForm.printerSettings).paperWidth}</span>
                  </div>
                  <div data-i18n-ignore data-print-receipt-preview className={`pos-admin-receipt-paper is-${activeReceiptTemplate.density} is-${getReceiptPrinter(taxForm.printerSettings).paperWidth.replace("mm", "")}`}>
                    {activeReceiptTemplate.blockOrder.map((block) => <div className="pos-admin-receipt-paper-block" key={block}>{renderReceiptPreviewBlock(block)}</div>)}
                  </div>
                  <small>{t("例の注文です。売上・注文・在庫には保存しません。実際の票面は注文内容と保存した設定で決まります。")}</small>
                </aside>
              </div>
            </div>
              {receiptImageUploadStatus ? <p className="pos-admin-printer-status">{receiptImageUploadStatus}</p> : null}
            </>} />
          </>)}
          {renderSettingsPane("discount", <>
          <div className="pos-admin-discount-settings">
            <div className="pos-admin-discount-heading">
              <div>
                <h4>割引・キャンペーン</h4>
                <p>手動の割引と、期間・最低購入金額で自動適用するキャンペーンを管理します。重ねずに最もお得な1件を適用します。</p>
              </div>
              <div className="pos-admin-section-actions">
                <button
                  className="secondary-button"
                  type="button"
                  data-add-pos-manual onClick={() => addDiscount("manual")}
                  disabled={!canManagePosSettings || taxForm.discountPresets.length >= 20}
                >
                  <Plus size={15} />
                  割引を追加
                </button>
                <button className="secondary-button" type="button" data-add-pos-campaign onClick={() => addDiscount("campaign")} disabled={!canManagePosSettings || taxForm.discountPresets.length >= 20}><Plus size={15} />キャンペーンを追加</button>
                <button className="secondary-button" type="button" data-add-pos-bowl-campaign onClick={() => addDiscount("bowl")} disabled={!canManagePosSettings || taxForm.discountPresets.length>=20}><Plus size={15}/>{t("1杯ごとの特典を追加")}</button>
                <button className="secondary-button" type="button" data-pos-save-section="discount" onClick={() => void savePosSettings({ successMessage: "割引・キャンペーンを保存しました。", section: "discount" })} disabled={!canManagePosSettings || (taxSaving||categorySaving)}>
                  {(taxSaving||categorySaving) ? "保存中..." : "割引を保存"}
                </button>
              </div>
            </div>
            <div className={discountListStyles.toolbar}>
              <label><span className={discountListStyles.srOnly}>{t("名称・条件で検索")}</span><input type="search" data-pos-discount-search value={discountQuery} placeholder={t("名称・条件で検索")} onChange={event => { setDiscountQuery(event.target.value); setExpandedDiscountKey(""); }} /></label>
              <select aria-label={t("表示する状態")} data-pos-discount-status value={discountStatus} onChange={event => { setDiscountStatus(event.target.value); setExpandedDiscountKey(""); }}><option value="all">{t("すべての状態")}</option><option value="enabled">{t("有効のみ")}</option><option value="disabled">{t("停止中のみ")}</option></select>
              <span data-pos-discount-count>{visibleDiscounts.length} / {taxForm.discountPresets.length}{t("件")}</span>
            </div>
            <div className="pos-admin-discount-list">
              {visibleDiscounts.length ? visibleDiscounts.map(({ preset, index }) => (
                <PosDiscountCard key={preset.key || index} preset={preset} gifts={giftItems} open={expandedDiscountKey === preset.key} dirty={JSON.stringify(preset) !== JSON.stringify(savedTaxForm?.discountPresets.find(item => item.key === preset.key))} disabled={!canManagePosSettings} onToggle={() => setExpandedDiscountKey(current => current === preset.key ? "" : preset.key)} onEnabled={enabled => setTaxForm(current => ({...current, discountPresets:current.discountPresets.map((item,itemIndex) => itemIndex === index ? {...item,enabled} : item)}))}>
                <div className={`pos-admin-discount-row ${discountListStyles.editor}`} data-pos-discount-editor>
                  <label>
                    <span>名称</span>
                    <input
                      data-pos-discount-name
                      value={preset.name}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                      }))}
                      placeholder="学割 20%OFF"
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  {!(preset.applicationMode === "campaign" && preset.campaignBasis === "bowl_choice" && preset.bowlBenefitMode === "gift_only") ? <>
                  <label>
                    <span>方式</span>
                    <select
                      data-pos-discount-type
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
                      data-pos-discount-value
                      value={String(preset.discountValue)}
                      onChange={(event) => setTaxForm((current) => ({
                        ...current,
                        discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: Number(normalizeIntegerInput(event.target.value)) || 0 } : item)
                      }))}
                      disabled={!canManagePosSettings}
                    />
                  </label>
                  </> : null}
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
                  <PosCampaignFields gifts={giftItems} value={preset} disabled={!canManagePosSettings} onChange={patch => setTaxForm(current => ({ ...current, discountPresets: current.discountPresets.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))} />
                </div>
                </PosDiscountCard>
              )) : <p className="pos-admin-discount-empty">{t(taxForm.discountPresets.length ? "条件に一致する割引・キャンペーンはありません。" : "割引・キャンペーンは未設定です。")}</p>}
            </div>
          </div>
          </>)}
          </div>
          <div className={settingsNavigationStyles.saveBar} data-pos-active-save-bar>
            <div><strong>{t(activeGroup.label)}</strong><small>{t(dirtySettingsPanes[activeSettingsPane]?"この機能に未保存の変更があります。":"この機能は保存済みです。")}{otherDirtySettingsCount?` · ${t("ほかの機能に未保存の変更があります。")}`:""}</small>{message?<small role="status">{message}</small>:null}</div>
            <button className="primary-button" type="button" data-pos-save-active={activeSettingsPane} disabled={!canManagePosSettings||loading||taxSaving||categorySaving||standbyUploading||Boolean(uploadingMediaType)||Boolean(uploadingReceiptImageSlot)||!dirtySettingsPanes[activeSettingsPane]} onClick={()=>void saveSettingsGroup()}>{t(taxSaving||categorySaving?"保存中...":activeGroup.save)}</button>
          </div>
        </section>

        <details className={settingsNavigationStyles.overview} data-pos-business-overview><summary>{t("営業状況を見る")}</summary>
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
        </details>
        {unsavedChangesDialog}
      </section>
    </main>
  );
}
