export type PosPrinterConnection = {
  deviceType: "escpos_network" | "escpos_bluetooth" | "escpos_usb" | "star_printer";
  connectionType: "lan" | "bluetooth" | "bluetooth_le" | "usb";
  identifier: string;
  host: string;
  port: number;
  paperWidth: "80mm" | "58mm";
  characterEncoding: "shift_jis" | "utf8";
  cutPaper: boolean;
  openCashDrawer: boolean;
};

export type PosBrandKitchenPrinterSetting = {
  brandId: string;
  brandName: string;
  printer: PosPrinterConnection;
};

export type PosReceiptTemplateSettings = {
  showLogo: boolean;
  logoUrl: string;
  promotionImageUrl: string;
  receiptTitle: string;
  invoiceTitle: string;
  invoiceRecipientName: string;
  invoicePurposeText: string;
  businessName: string;
  companyInfo: string;
  taxRegistrationNumber: string;
  phone: string;
  address: string;
  website: string;
  headerMessage: string;
  footerMessage: string;
  promotionMessage: string;
  showTaxSummary: boolean;
  showOrderNote: boolean;
  showTimestamp: boolean;
};

export type PosKitchenTicketTemplateSettings = {
  showTitle: boolean;
  title: string;
  showStoreName: boolean;
  showPickupCode: boolean;
  showOrderType: boolean;
  showItems: boolean;
  showOptions: boolean;
  showNote: boolean;
  showTimestamp: boolean;
  showAmounts: boolean;
  largeText: boolean;
};

export type PosPrinterSettings = PosPrinterConnection & {
  enabled: boolean;
  receiptEnabled: boolean;
  kitchenEnabled: boolean;
  receiptPrinter: PosPrinterConnection;
  kitchenPrinter: PosPrinterConnection;
  brandKitchenPrinters: PosBrandKitchenPrinterSetting[];
  receiptTemplate: PosReceiptTemplateSettings;
  kitchenTicketTemplate: PosKitchenTicketTemplateSettings;
};

export type PosPrintLineItem = {
  name: string;
  quantity: number;
  unitPrice?: number | null;
  amount: number;
  options?: string[];
};

export type PosPrintPayload = {
  version: 1;
  jobType: "test" | "receipt" | "kitchen";
  printer: PosPrinterConnection;
  storeName: string;
  printedAt: string;
  receiptTemplate?: PosReceiptTemplateSettings;
  kitchenTicketTemplate?: PosKitchenTicketTemplateSettings;
  order?: {
    pickupCode: string;
    orderType: string;
    paymentMethod: string;
    paymentLabel: string;
    cashierName?: string;
    note?: string;
    receiptRequested?: boolean;
    receiptTitle?: string;
    receiptRecipientName?: string;
    receiptPurposeText?: string;
    subtotalAmount: number;
    discountAmount: number;
    couponDiscountAmount: number;
    taxAmount: number;
    taxRate: number;
    totalAmount: number;
    cashTenderedAmount?: number | null;
    cashChangeAmount?: number | null;
    items: PosPrintLineItem[];
  };
};

type BridgePrintResult = {
  ok?: boolean;
  error?: string;
};

declare global {
  interface Window {
    Foundr1Printer?: {
      print?: (payloadJson: string) => BridgePrintResult | Promise<BridgePrintResult> | string | void;
      isAvailable?: () => boolean;
    };
  }
}

export const defaultPosPrinterConnection: PosPrinterConnection = {
  deviceType: "escpos_network",
  connectionType: "lan",
  identifier: "",
  host: "",
  port: 9100,
  paperWidth: "80mm",
  characterEncoding: "shift_jis",
  cutPaper: true,
  openCashDrawer: false
};

export const defaultPosReceiptTemplateSettings: PosReceiptTemplateSettings = {
  showLogo: false,
  logoUrl: "",
  promotionImageUrl: "",
  receiptTitle: "レシート",
  invoiceTitle: "領収書",
  invoiceRecipientName: "上様",
  invoicePurposeText: "飲食代",
  businessName: "",
  companyInfo: "",
  taxRegistrationNumber: "",
  phone: "",
  address: "",
  website: "",
  headerMessage: "",
  footerMessage: "",
  promotionMessage: "",
  showTaxSummary: true,
  showOrderNote: true,
  showTimestamp: true
};

export const defaultPosKitchenTicketTemplateSettings: PosKitchenTicketTemplateSettings = {
  showTitle: true,
  title: "厨房伝票",
  showStoreName: true,
  showPickupCode: true,
  showOrderType: true,
  showItems: true,
  showOptions: true,
  showNote: true,
  showTimestamp: true,
  showAmounts: false,
  largeText: true
};

export const defaultPosPrinterSettings: PosPrinterSettings = {
  enabled: false,
  receiptEnabled: true,
  kitchenEnabled: false,
  ...defaultPosPrinterConnection,
  receiptPrinter: defaultPosPrinterConnection,
  kitchenPrinter: defaultPosPrinterConnection,
  brandKitchenPrinters: [],
  receiptTemplate: defaultPosReceiptTemplateSettings,
  kitchenTicketTemplate: defaultPosKitchenTicketTemplateSettings
};

export function normalizePosPrinterConnection(value: unknown, fallback: PosPrinterConnection = defaultPosPrinterConnection): PosPrinterConnection {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosPrinterConnection> : {};
  const port = Math.round(Number(source.port || fallback.port));
  const deviceType = ["escpos_bluetooth", "escpos_usb", "star_printer"].includes(String(source.deviceType))
    ? source.deviceType as PosPrinterConnection["deviceType"]
    : fallback.deviceType;
  const connectionType = ["bluetooth", "bluetooth_le", "usb"].includes(String(source.connectionType))
    ? source.connectionType as PosPrinterConnection["connectionType"]
    : deviceType === "star_printer"
      ? fallback.connectionType
      : "lan";
  const host = String(source.host ?? fallback.host ?? "").trim().slice(0, 120);
  const identifier = String(source.identifier ?? "").trim().slice(0, 160) || host;
  return {
    deviceType,
    connectionType,
    identifier,
    host,
    port: Number.isFinite(port) ? Math.max(1, Math.min(65535, port)) : fallback.port,
    paperWidth: source.paperWidth === "58mm" ? "58mm" : fallback.paperWidth,
    characterEncoding: source.characterEncoding === "utf8" ? "utf8" : fallback.characterEncoding,
    cutPaper: source.cutPaper ?? fallback.cutPaper,
    openCashDrawer: source.openCashDrawer ?? fallback.openCashDrawer
  };
}

export function normalizePosReceiptTemplateSettings(value: unknown): PosReceiptTemplateSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosReceiptTemplateSettings> : {};
  const text = (next: unknown, max = 240) => String(next ?? "").trim().slice(0, max);
  const textWithFallback = (next: unknown, fallback: string, max = 120) => {
    const value = text(next, max);
    return value || fallback;
  };
  return {
    showLogo: source.showLogo === true,
    logoUrl: text(source.logoUrl, 500),
    promotionImageUrl: text(source.promotionImageUrl, 500),
    receiptTitle: textWithFallback(source.receiptTitle, defaultPosReceiptTemplateSettings.receiptTitle, 80),
    invoiceTitle: textWithFallback(source.invoiceTitle, defaultPosReceiptTemplateSettings.invoiceTitle, 80),
    invoiceRecipientName: textWithFallback(source.invoiceRecipientName, defaultPosReceiptTemplateSettings.invoiceRecipientName, 120),
    invoicePurposeText: textWithFallback(source.invoicePurposeText, defaultPosReceiptTemplateSettings.invoicePurposeText, 120),
    businessName: text(source.businessName, 120),
    companyInfo: text(source.companyInfo, 500),
    taxRegistrationNumber: text(source.taxRegistrationNumber, 80),
    phone: text(source.phone, 80),
    address: text(source.address, 240),
    website: text(source.website, 160),
    headerMessage: text(source.headerMessage, 500),
    footerMessage: text(source.footerMessage, 500),
    promotionMessage: text(source.promotionMessage, 500),
    showTaxSummary: source.showTaxSummary !== false,
    showOrderNote: source.showOrderNote !== false,
    showTimestamp: source.showTimestamp !== false
  };
}

export function normalizePosKitchenTicketTemplateSettings(value: unknown): PosKitchenTicketTemplateSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosKitchenTicketTemplateSettings> : {};
  const text = (next: unknown, fallback: string, max = 80) => {
    const value = String(next ?? "").trim();
    return (value || fallback).slice(0, max);
  };
  return {
    showTitle: source.showTitle !== false,
    title: text(source.title, defaultPosKitchenTicketTemplateSettings.title),
    showStoreName: source.showStoreName !== false,
    showPickupCode: source.showPickupCode !== false,
    showOrderType: source.showOrderType !== false,
    showItems: source.showItems !== false,
    showOptions: source.showOptions !== false,
    showNote: source.showNote !== false,
    showTimestamp: source.showTimestamp !== false,
    showAmounts: source.showAmounts === true,
    largeText: source.largeText !== false
  };
}

export function normalizePosPrinterSettings(value: unknown): PosPrinterSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosPrinterSettings> : {};
  const legacyPrinter = normalizePosPrinterConnection(source, defaultPosPrinterConnection);
  const receiptPrinter = normalizePosPrinterConnection(source.receiptPrinter, legacyPrinter);
  const kitchenPrinter = normalizePosPrinterConnection(source.kitchenPrinter, legacyPrinter);
  const brandKitchenPrinters = Array.isArray(source.brandKitchenPrinters) ? source.brandKitchenPrinters : [];
  return {
    enabled: source.enabled === true,
    receiptEnabled: source.receiptEnabled !== false,
    kitchenEnabled: source.kitchenEnabled === true,
    ...receiptPrinter,
    receiptPrinter,
    kitchenPrinter,
    receiptTemplate: normalizePosReceiptTemplateSettings(source.receiptTemplate),
    kitchenTicketTemplate: normalizePosKitchenTicketTemplateSettings(source.kitchenTicketTemplate),
    brandKitchenPrinters: brandKitchenPrinters.flatMap((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? item as Partial<PosBrandKitchenPrinterSetting> : {};
      const brandId = String(record.brandId || "").trim();
      if (!brandId) return [];
      return [{
        brandId: brandId.slice(0, 80),
        brandName: String(record.brandName || "").trim().slice(0, 120),
        printer: normalizePosPrinterConnection(record.printer, kitchenPrinter)
      }];
    }).slice(0, 30)
  };
}

export function getReceiptPrinter(settings: PosPrinterSettings) {
  return settings.receiptPrinter || normalizePosPrinterConnection(settings, defaultPosPrinterConnection);
}

export function getKitchenPrinterForBrand(settings: PosPrinterSettings, brandId?: string | null) {
  if (brandId) {
    const brandPrinter = settings.brandKitchenPrinters.find((item) => item.brandId === brandId)?.printer;
    if (brandPrinter?.host) return brandPrinter;
  }
  return settings.kitchenPrinter || getReceiptPrinter(settings);
}

export function createTestPrintPayload(printer: PosPrinterConnection, storeName: string): PosPrintPayload {
  return {
    version: 1,
    jobType: "test",
    printer,
    storeName,
    printedAt: new Date().toISOString(),
    receiptTemplate: defaultPosReceiptTemplateSettings,
    kitchenTicketTemplate: defaultPosKitchenTicketTemplateSettings,
    order: {
      pickupCode: "TEST",
      orderType: "takeout",
      paymentMethod: "test",
      paymentLabel: "テスト",
      subtotalAmount: 0,
      discountAmount: 0,
      couponDiscountAmount: 0,
      taxAmount: 0,
      taxRate: 8,
      totalAmount: 0,
      items: [{
        name: "Foundr1 OS テスト印刷 / 厨房打印测试",
        quantity: 1,
        amount: 0,
        options: [
          printer.deviceType === "star_printer" ? `Star printer / ${printer.connectionType}` : getEscPosDeviceLabel(printer),
          printer.identifier ? `ID: ${printer.identifier}` : printer.paperWidth,
          printer.paperWidth,
          "日本語: レシート / 厨房伝票 / 合計",
          "中文: 厨房打印 / 收据 / 合计"
        ]
      }]
    }
  };
}

function getEscPosDeviceLabel(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_bluetooth") return `ESC/POS Bluetooth / ${printer.identifier}`;
  if (printer.deviceType === "escpos_usb") return `ESC/POS USB${printer.identifier ? ` / ${printer.identifier}` : ""}`;
  return `${printer.host}:${printer.port}`;
}

export async function printWithAndroidBridge(payload: PosPrintPayload) {
  if (typeof window === "undefined" || !window.Foundr1Printer?.print) {
    return { ok: false, error: "Android 印刷ブリッジが見つかりません。" };
  }
  if (window.Foundr1Printer.isAvailable && !window.Foundr1Printer.isAvailable()) {
    return { ok: false, error: "Android 印刷ブリッジを利用できません。" };
  }
  try {
    const result = await window.Foundr1Printer.print(JSON.stringify(payload));
    if (typeof result === "string") {
      const parsed = JSON.parse(result) as BridgePrintResult;
      return parsed.ok === false ? { ok: false, error: parsed.error || "印刷に失敗しました。" } : { ok: true };
    }
    if (result?.ok === false) return { ok: false, error: result.error || "印刷に失敗しました。" };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "印刷に失敗しました。" };
  }
}
