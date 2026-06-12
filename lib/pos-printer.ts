export type PosPrinterConnection = {
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

export type PosPrinterSettings = PosPrinterConnection & {
  enabled: boolean;
  receiptEnabled: boolean;
  kitchenEnabled: boolean;
  receiptPrinter: PosPrinterConnection;
  kitchenPrinter: PosPrinterConnection;
  brandKitchenPrinters: PosBrandKitchenPrinterSetting[];
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
  order?: {
    pickupCode: string;
    orderType: string;
    paymentMethod: string;
    paymentLabel: string;
    cashierName?: string;
    note?: string;
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
  host: "",
  port: 9100,
  paperWidth: "80mm",
  characterEncoding: "shift_jis",
  cutPaper: true,
  openCashDrawer: false
};

export const defaultPosPrinterSettings: PosPrinterSettings = {
  enabled: false,
  receiptEnabled: true,
  kitchenEnabled: false,
  ...defaultPosPrinterConnection,
  receiptPrinter: defaultPosPrinterConnection,
  kitchenPrinter: defaultPosPrinterConnection,
  brandKitchenPrinters: []
};

export function normalizePosPrinterConnection(value: unknown, fallback: PosPrinterConnection = defaultPosPrinterConnection): PosPrinterConnection {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<PosPrinterConnection> : {};
  const port = Math.round(Number(source.port || fallback.port));
  return {
    host: String(source.host ?? fallback.host ?? "").trim().slice(0, 120),
    port: Number.isFinite(port) ? Math.max(1, Math.min(65535, port)) : fallback.port,
    paperWidth: source.paperWidth === "58mm" ? "58mm" : fallback.paperWidth,
    characterEncoding: source.characterEncoding === "utf8" ? "utf8" : fallback.characterEncoding,
    cutPaper: source.cutPaper ?? fallback.cutPaper,
    openCashDrawer: source.openCashDrawer ?? fallback.openCashDrawer
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
        name: "Foundr1 OS Test Print",
        quantity: 1,
        amount: 0,
        options: [`${printer.host}:${printer.port}`, printer.paperWidth]
      }]
    }
  };
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
