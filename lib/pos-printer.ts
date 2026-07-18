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

export type PosPhysicalCustomerDisplaySettings = {
  enabled: boolean;
  deviceType: "scd222u";
};

export type PosReceiptTemplateSettings = {
  showLogo: boolean;
  logoUrl: string;
  logoAlignment: "left" | "center";
  logoWidthPercent: number;
  logoBottomSpacing: number;
  promotionImageUrl: string;
  promotionImageAlignment: "left" | "center";
  promotionImageWidthPercent: number;
  receiptTitle: string;
  invoiceTitle: string;
  invoiceRecipientName: string;
  invoicePurposeText: string;
  businessName: string;
  businessNameAlignment: "left" | "center";
  companyInfo: string;
  taxRegistrationNumber: string;
  phone: string;
  address: string;
  website: string;
  headerMessage: string;
  footerMessage: string;
  promotionMessage: string;
  contactInfoAlignment: "left" | "center";
  messageAlignment: "left" | "center";
  businessNameTextSize: "small" | "standard" | "large";
  titleTextSize: "small" | "standard" | "large";
  messageTextSize: "small" | "standard" | "large";
  density: "compact" | "standard";
  blockOrder: PosReceiptTemplateBlock[];
  qrCodeEnabled: boolean;
  qrCodeUrl: string;
  qrCodeLabel: string;
  qrCodeAlignment: "left" | "center";
  qrCodeSize: "small" | "medium" | "large";
  showTaxSummary: boolean;
  showOrderNote: boolean;
  showTimestamp: boolean;
};

export type PosReceiptTemplateBlock = "logo" | "business" | "contact" | "message" | "receipt" | "promotion" | "qr" | "footer";

export type PosReceiptTemplateVariant = {
  brandId: string;
  brandName: string;
  documentType: "receipt" | "invoice";
  template: PosReceiptTemplateSettings;
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
  kitchenCopies: number;
  receiptPrinter: PosPrinterConnection;
  kitchenPrinter: PosPrinterConnection;
  brandKitchenPrinters: PosBrandKitchenPrinterSetting[];
  customerDisplay: PosPhysicalCustomerDisplaySettings;
  receiptTemplate: PosReceiptTemplateSettings;
  receiptTemplateVariants: PosReceiptTemplateVariant[];
  kitchenTicketTemplate: PosKitchenTicketTemplateSettings;
};

export type PosPhysicalCustomerDisplayPayload = {
  version: 1;
  deviceType: "scd222u";
  printer: PosPrinterConnection;
  line1: string;
  line2: string;
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

export type NativePrinterDevice = {
  name: string;
  address: string;
  identifier: string;
  deviceType: PosPrinterConnection["deviceType"];
  connectionType: PosPrinterConnection["connectionType"];
  paperWidth: PosPrinterConnection["paperWidth"];
  isLikelyStarPrinter: boolean;
};

declare global {
  interface Window {
    Foundr1Printer?: {
      print?: (payloadJson: string) => BridgePrintResult | Promise<BridgePrintResult> | string | void;
      display?: (payloadJson: string) => BridgePrintResult | Promise<BridgePrintResult> | string | void;
      listPairedPrinters?: () => string | Promise<string>;
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
  logoAlignment: "center",
  logoWidthPercent: 58,
  logoBottomSpacing: 8,
  promotionImageUrl: "",
  promotionImageAlignment: "center",
  promotionImageWidthPercent: 100,
  receiptTitle: "レシート",
  invoiceTitle: "領収書",
  invoiceRecipientName: "上様",
  invoicePurposeText: "飲食代",
  businessName: "",
  businessNameAlignment: "center",
  companyInfo: "",
  taxRegistrationNumber: "",
  phone: "",
  address: "",
  website: "",
  headerMessage: "",
  footerMessage: "",
  promotionMessage: "",
  contactInfoAlignment: "left",
  messageAlignment: "left",
  businessNameTextSize: "standard",
  titleTextSize: "standard",
  messageTextSize: "standard",
  density: "standard",
  blockOrder: ["logo", "business", "contact", "message", "receipt", "promotion", "qr", "footer"],
  qrCodeEnabled: false,
  qrCodeUrl: "",
  qrCodeLabel: "",
  qrCodeAlignment: "center",
  qrCodeSize: "medium",
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

export const defaultPosPhysicalCustomerDisplaySettings: PosPhysicalCustomerDisplaySettings = {
  enabled: false,
  deviceType: "scd222u"
};

export const defaultPosPrinterSettings: PosPrinterSettings = {
  enabled: false,
  receiptEnabled: true,
  kitchenEnabled: false,
  kitchenCopies: 1,
  ...defaultPosPrinterConnection,
  receiptPrinter: defaultPosPrinterConnection,
  kitchenPrinter: defaultPosPrinterConnection,
  brandKitchenPrinters: [],
  customerDisplay: defaultPosPhysicalCustomerDisplaySettings,
  receiptTemplate: defaultPosReceiptTemplateSettings,
  receiptTemplateVariants: [],
  kitchenTicketTemplate: defaultPosKitchenTicketTemplateSettings
};

export function normalizePosPrinterConnection(value: unknown, fallback: PosPrinterConnection = defaultPosPrinterConnection): PosPrinterConnection {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosPrinterConnection> : {};
  const port = Math.round(Number(source.port || fallback.port));
  const deviceType = ["escpos_network", "escpos_bluetooth", "escpos_usb", "star_printer"].includes(String(source.deviceType))
    ? source.deviceType as PosPrinterConnection["deviceType"]
    : fallback.deviceType;
  const connectionType = ["lan", "bluetooth", "bluetooth_le", "usb"].includes(String(source.connectionType))
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
  const alignment = (next: unknown, fallback: "left" | "center") => next === "center" || next === "left" ? next : fallback;
  const rawLogoWidthPercent = Math.round(Number(source.logoWidthPercent ?? defaultPosReceiptTemplateSettings.logoWidthPercent));
  const rawLogoBottomSpacing = Math.round(Number(source.logoBottomSpacing ?? defaultPosReceiptTemplateSettings.logoBottomSpacing));
  const rawPromotionImageWidthPercent = Math.round(Number(source.promotionImageWidthPercent ?? defaultPosReceiptTemplateSettings.promotionImageWidthPercent));
  const textSize = (next: unknown, fallback: "small" | "standard" | "large") => next === "small" || next === "large" || next === "standard" ? next : fallback;
  const qrSize = (next: unknown) => next === "small" || next === "large" || next === "medium" ? next : defaultPosReceiptTemplateSettings.qrCodeSize;
  const validBlocks: PosReceiptTemplateBlock[] = ["logo", "business", "contact", "message", "receipt", "promotion", "qr", "footer"];
  const suppliedBlocks = Array.isArray(source.blockOrder) ? source.blockOrder.filter((item): item is PosReceiptTemplateBlock => validBlocks.includes(item as PosReceiptTemplateBlock)) : [];
  const blockOrder = [...new Set([...suppliedBlocks, ...validBlocks])];
  return {
    showLogo: source.showLogo === true,
    logoUrl: text(source.logoUrl, 500),
    logoAlignment: alignment(source.logoAlignment, defaultPosReceiptTemplateSettings.logoAlignment),
    logoWidthPercent: Number.isFinite(rawLogoWidthPercent) ? Math.max(20, Math.min(100, rawLogoWidthPercent)) : defaultPosReceiptTemplateSettings.logoWidthPercent,
    logoBottomSpacing: Number.isFinite(rawLogoBottomSpacing) ? Math.max(0, Math.min(40, rawLogoBottomSpacing)) : defaultPosReceiptTemplateSettings.logoBottomSpacing,
    promotionImageUrl: text(source.promotionImageUrl, 500),
    promotionImageAlignment: alignment(source.promotionImageAlignment, defaultPosReceiptTemplateSettings.promotionImageAlignment),
    promotionImageWidthPercent: Number.isFinite(rawPromotionImageWidthPercent) ? Math.max(20, Math.min(100, rawPromotionImageWidthPercent)) : defaultPosReceiptTemplateSettings.promotionImageWidthPercent,
    receiptTitle: textWithFallback(source.receiptTitle, defaultPosReceiptTemplateSettings.receiptTitle, 80),
    invoiceTitle: textWithFallback(source.invoiceTitle, defaultPosReceiptTemplateSettings.invoiceTitle, 80),
    invoiceRecipientName: textWithFallback(source.invoiceRecipientName, defaultPosReceiptTemplateSettings.invoiceRecipientName, 120),
    invoicePurposeText: textWithFallback(source.invoicePurposeText, defaultPosReceiptTemplateSettings.invoicePurposeText, 120),
    businessName: text(source.businessName, 120),
    businessNameAlignment: alignment(source.businessNameAlignment, defaultPosReceiptTemplateSettings.businessNameAlignment),
    companyInfo: text(source.companyInfo, 500),
    taxRegistrationNumber: text(source.taxRegistrationNumber, 80),
    phone: text(source.phone, 80),
    address: text(source.address, 240),
    website: text(source.website, 160),
    headerMessage: text(source.headerMessage, 500),
    footerMessage: text(source.footerMessage, 500),
    promotionMessage: text(source.promotionMessage, 500),
    contactInfoAlignment: alignment(source.contactInfoAlignment, defaultPosReceiptTemplateSettings.contactInfoAlignment),
    messageAlignment: alignment(source.messageAlignment, defaultPosReceiptTemplateSettings.messageAlignment),
    businessNameTextSize: textSize(source.businessNameTextSize, defaultPosReceiptTemplateSettings.businessNameTextSize),
    titleTextSize: textSize(source.titleTextSize, defaultPosReceiptTemplateSettings.titleTextSize),
    messageTextSize: textSize(source.messageTextSize, defaultPosReceiptTemplateSettings.messageTextSize),
    density: source.density === "compact" ? "compact" : "standard",
    blockOrder,
    qrCodeEnabled: source.qrCodeEnabled === true,
    qrCodeUrl: text(source.qrCodeUrl, 500),
    qrCodeLabel: text(source.qrCodeLabel, 160),
    qrCodeAlignment: alignment(source.qrCodeAlignment, defaultPosReceiptTemplateSettings.qrCodeAlignment),
    qrCodeSize: qrSize(source.qrCodeSize),
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
  const receiptTemplateVariants = Array.isArray(source.receiptTemplateVariants) ? source.receiptTemplateVariants : [];
  const kitchenCopies = Math.round(Number(source.kitchenCopies ?? defaultPosPrinterSettings.kitchenCopies));
  return {
    enabled: source.enabled === true,
    receiptEnabled: source.receiptEnabled !== false,
    kitchenEnabled: source.kitchenEnabled === true,
    kitchenCopies: Number.isFinite(kitchenCopies) ? Math.max(1, Math.min(5, kitchenCopies)) : defaultPosPrinterSettings.kitchenCopies,
    ...receiptPrinter,
    receiptPrinter,
    kitchenPrinter,
    customerDisplay: {
      enabled: source.customerDisplay?.enabled === true,
      deviceType: "scd222u"
    },
    receiptTemplate: normalizePosReceiptTemplateSettings(source.receiptTemplate),
    receiptTemplateVariants: receiptTemplateVariants.flatMap((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? item as Partial<PosReceiptTemplateVariant> : {};
      const brandId = String(record.brandId ?? "").trim().slice(0, 80);
      const documentType: PosReceiptTemplateVariant["documentType"] = record.documentType === "invoice" ? "invoice" : "receipt";
      return [{
        brandId,
        brandName: String(record.brandName ?? "").trim().slice(0, 120),
        documentType,
        template: normalizePosReceiptTemplateSettings(record.template)
      }];
    }).filter((variant, index, variants) => variants.findIndex((item) => item.brandId === variant.brandId && item.documentType === variant.documentType) === index).slice(0, 60),
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

export function resolvePosReceiptTemplate(settings: PosPrinterSettings, brandId: string | null | undefined, documentType: "receipt" | "invoice") {
  const normalizedBrandId = String(brandId ?? "").trim();
  return settings.receiptTemplateVariants.find((item) => item.brandId === normalizedBrandId && item.documentType === documentType)?.template
    ?? settings.receiptTemplateVariants.find((item) => !item.brandId && item.documentType === documentType)?.template
    ?? settings.receiptTemplate;
}

export function getReceiptPrinter(settings: PosPrinterSettings) {
  return settings.receiptPrinter || normalizePosPrinterConnection(settings, defaultPosPrinterConnection);
}

export function getKitchenPrinterForBrand(settings: PosPrinterSettings, brandId?: string | null) {
  if (brandId) {
    const brandPrinter = settings.brandKitchenPrinters.find((item) => item.brandId === brandId)?.printer;
    if (brandPrinter && hasPosPrinterDestination(brandPrinter)) return brandPrinter;
  }
  return settings.kitchenPrinter || getReceiptPrinter(settings);
}

export function hasPosPrinterDestination(printer: PosPrinterConnection) {
  if (printer.deviceType === "escpos_network") return Boolean(printer.host);
  if (printer.deviceType === "escpos_usb") return true;
  if (printer.deviceType === "star_printer") return true;
  return Boolean(printer.identifier);
}

export function createAutoStarBluetoothPrinter(fallback: PosPrinterConnection = defaultPosPrinterConnection): PosPrinterConnection {
  return {
    ...fallback,
    deviceType: "star_printer",
    connectionType: "bluetooth",
    identifier: "",
    host: "",
    paperWidth: "58mm"
  };
}

export function createTestPrintPayload(printer: PosPrinterConnection, storeName: string, receiptTemplate: PosReceiptTemplateSettings = defaultPosReceiptTemplateSettings): PosPrintPayload {
  return {
    version: 1,
    jobType: "test",
    printer,
    storeName,
    printedAt: new Date().toISOString(),
    receiptTemplate,
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

export function createPhysicalCustomerDisplayPayload(
  settings: PosPrinterSettings,
  line1: string,
  line2: string
): PosPhysicalCustomerDisplayPayload {
  return {
    version: 1,
    deviceType: "scd222u",
    printer: getReceiptPrinter(settings),
    line1: String(line1 || "").replace(/[\r\n]+/g, " ").trim().slice(0, 40),
    line2: String(line2 || "").replace(/[\r\n]+/g, " ").trim().slice(0, 40)
  };
}

export async function displayWithAndroidBridge(payload: PosPhysicalCustomerDisplayPayload) {
  if (typeof window === "undefined" || !window.Foundr1Printer?.display) {
    return { ok: false, error: "Android カスタマーディスプレイブリッジが見つかりません。" };
  }
  try {
    const result = await window.Foundr1Printer.display(JSON.stringify(payload));
    if (typeof result === "string") {
      const parsed = JSON.parse(result) as BridgePrintResult;
      return parsed.ok === false ? { ok: false, error: parsed.error || "カスタマーディスプレイの更新に失敗しました。" } : { ok: true };
    }
    if (result?.ok === false) return { ok: false, error: result.error || "カスタマーディスプレイの更新に失敗しました。" };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "カスタマーディスプレイの更新に失敗しました。" };
  }
}

export async function listPairedNativePrinters() {
  if (typeof window === "undefined" || !window.Foundr1Printer?.listPairedPrinters) {
    return { ok: false, error: "Android 印刷ブリッジが見つかりません。", devices: [] as NativePrinterDevice[] };
  }
  try {
    const result = await window.Foundr1Printer.listPairedPrinters();
    const parsed = JSON.parse(result || "{}") as { ok?: boolean; error?: string; devices?: NativePrinterDevice[] };
    return {
      ok: parsed.ok !== false,
      error: parsed.error || "",
      devices: Array.isArray(parsed.devices) ? parsed.devices : []
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "プリンター検索に失敗しました。",
      devices: [] as NativePrinterDevice[]
    };
  }
}
