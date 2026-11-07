import { invoiceRecipientStem } from './pos-invoice';
import { isPosImmediateItem, type PosItemFulfillmentMode } from './pos-item-fulfillment';
import {
  applyPosReceiptTaxBreakdown, getKitchenPrinterForBrand, getReceiptPrinter, getPosBowlTicketSettings,
  normalizePosDocumentCopies, posBowlTicketKinds, prefixPosReducedTaxMarker, resolvePosBowlTicketTemplate,
  resolvePosKitchenTicketTemplate, resolvePosReceiptTemplate,
  type PosPrintPayload, type PosPrinterSettings
} from "./pos-printer";
import type { PosServingTicket } from "./pos-serving-policy";
import type { PosPrintDocumentKind, PosPrintMode } from "./pos-print-document-contract";
import type { PosCounterTaxBucket } from './pos-counter-tax';

export type PosPrintSnapshotItem = {
  fulfillmentMode?: PosItemFulfillmentMode;
  productionType?: string;
  itemKind?: string;
  orderItemId?: string;
  brandId: string;
  brandName: string;
  name: string;
  displayNames?: Record<string, string>;
  counterStandardTax?: boolean;
  quantity: number;
  amount: number;
  measuredQuantity: number | null;
  measuredUnit: string;
  measuredUnitPrice?: number | null;
  preparationNote: string;
  selectedOptions: Array<{
    id?: string; groupId?: string; groupName?: string; complimentary?: boolean;
    groupDisplayNames?: Record<string, string>;
    name: string; displayNames?: Record<string, string>; priceDelta?: number | null; counterStandardTax?: boolean;
  }>;
};

export type PosPrintSnapshotSale = {
  pickupCode: string;
  orderType: string;
  paymentMethod: string;
  amount: number;
  subtotalAmount: number;
  discountAmount: number;
  couponDiscountAmount: number;
  taxAmount: number;
  taxRate: number;
  taxBreakdown?: PosCounterTaxBucket[];
  cashTenderedAmount: number | null;
  cashChangeAmount: number | null;
  receiptRequested: boolean;
  receiptRecipientName?: string;
  receiptPurposeText?: string;
  note: string;
  memberLanguage: string;
  cashierName?: string;
  printedAt?: string;
};

export type PosPrintDocumentSnapshot = {
  documentKey: string;
  kind: PosPrintDocumentKind;
  sequence: number;
  copyNumber: number;
  pickupCode: string;
  itemId: string | null;
  brandId: string | null;
  target: "receipt" | "kitchen";
  requested: boolean;
  label: string;
  payload: PosPrintPayload;
};

const kindLabels: Record<PosPrintDocumentKind, string> = {
  kitchen: "厨房伝票", finishing: "出品伝票", pickup: "お客様番号札", receipt: "レシート"
};

function localized(name: string, names: Record<string, string> | undefined, language: string) {
  const key = language === "zh-Hans" ? "zh" : language;
  return key === "ja" ? name : String(names?.[key] || names?.[language] || names?.en || name).trim();
}

/** Build immutable content without checking or contacting a physical printer. */
export function buildPosPrintDocumentSnapshots(
  settings: PosPrinterSettings,
  storeName: string,
  sale: PosPrintSnapshotSale,
  items: PosPrintSnapshotItem[],
  tickets: PosServingTicket[],
  mode: PosPrintMode
): PosPrintDocumentSnapshot[] {
  const printedAt = sale.printedAt || new Date().toISOString();
  const language = ["en", "zh", "zh-Hans", "zh-Hant", "ko", "vi", "ne"].includes(sale.memberLanguage) ? sale.memberLanguage : "ja";
  const receiptPrinter = getReceiptPrinter(settings);
  const documents: PosPrintDocumentSnapshot[] = [];
  const line = (item: PosPrintSnapshotItem, lang = "ja", hideAmount = false, markReducedRate = false) => {
    const choices = new Map<string, { text: string; count: number }>();
    for (const option of item.selectedOptions) {
      const key = `${option.groupId || option.groupName || ""}:${option.id || option.name}:${option.complimentary ? "gift" : "paid"}`;
      const group = localized(option.groupName || "", option.groupDisplayNames, lang);
      const optionName = prefixPosReducedTaxMarker(localized(option.name, option.displayNames, lang),
        markReducedRate && !(option.counterStandardTax ?? item.counterStandardTax) && !option.complimentary && Number(option.priceDelta) > 0);
      const text = [group, optionName].filter(Boolean).join(": ");
      const entry = choices.get(key);
      if (entry) entry.count += 1;
      else choices.set(key, { text, count: 1 });
    }
    const weight = item.measuredQuantity
      ? `${item.measuredQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${item.measuredUnit}`
      : "";
    return {
      name: prefixPosReducedTaxMarker(localized(item.name, item.displayNames, lang), markReducedRate && !item.counterStandardTax),
      quantity: item.quantity,
      unitPrice: hideAmount ? 0 : item.amount / item.quantity,
      amount: hideAmount ? 0 : item.amount,
      options: [weight, ...Array.from(choices.values(), option => `${option.text}${option.count > 1 ? ` x${option.count}` : ""}`)].filter(Boolean)
    };
  };
  const base = {
    pickupCode: sale.pickupCode, orderType: sale.orderType, paymentMethod: sale.paymentMethod,
    paymentLabel: ({ cash: "現金", card: "カード", other: "その他" } as Record<string, string>)[sale.paymentMethod] || sale.paymentMethod,
    cashierName: sale.cashierName, note: sale.note,
    subtotalAmount: sale.subtotalAmount, discountAmount: sale.discountAmount,
    couponDiscountAmount: sale.couponDiscountAmount, taxAmount: sale.taxAmount,
    taxRate: sale.taxRate, totalAmount: sale.amount,
    cashTenderedAmount: sale.cashTenderedAmount, cashChangeAmount: sale.cashChangeAmount
  };
  function add(
    kind: PosPrintDocumentKind, copies: number, roleEnabled: boolean, key: string,
    pickupCode: string, itemId: string | null, brandId: string | null,
    target: PosPrintDocumentSnapshot["target"], payload: PosPrintPayload
  ) {
    for (let index = 0; index < copies; index += 1) {
      const snapshotPayload = structuredClone({ ...payload, documentRole: kind });
      if (kind === "receipt") snapshotPayload.printer.openCashDrawer = mode === "auto" && roleEnabled && index === 0 && receiptPrinter.openCashDrawer;
      documents.push({
      documentKey: `${key}:${kind}:${index + 1}`, kind, sequence: documents.length,
      copyNumber: index + 1, pickupCode, itemId, brandId, target,
      requested: mode !== "none" && roleEnabled,
      label: `${kind === "receipt" && !items.some(item => !isPosImmediateItem(item)) ? "会計番号 " : ""}${pickupCode} ${kindLabels[kind]}${copies > 1 ? ` ${index + 1}/${copies}` : ""}`,
      // The snapshot records content. Claiming later replaces the destination, never this content.
      payload: snapshotPayload
      });
    }
  }

  const ticketIndexes = new Set<number>();
  for (const ticket of tickets) {
    const item = items[ticket.itemIndex];
    if (!item || ticketIndexes.has(ticket.itemIndex)) throw new Error("料理と伝票の対応を確認してください。");
    if (isPosImmediateItem(item)) continue;
    ticketIndexes.add(ticket.itemIndex);
    for (const kind of posBowlTicketKinds) {
      const config = getPosBowlTicketSettings(settings, kind);
      const customer = kind === "pickup";
      add(kind, config.copies, config.enabled, `item:${ticket.itemIndex}`, ticket.pickupCode,
        ticket.itemId || item.orderItemId || null, item.brandId || null, "receipt", {
          version: 1, jobType: "kitchen", printer: { ...receiptPrinter, openCashDrawer: false },
          storeName: `${storeName} / ${item.brandName}`, printedAt,
          kitchenTicketTemplate: resolvePosBowlTicketTemplate(settings, kind, item.brandId, language),
          order: {
            ...base, pickupCode: ticket.pickupCode, paymentMethod: "kitchen", paymentLabel: "厨房",
            subtotalAmount: customer ? 0 : item.amount, totalAmount: customer ? 0 : item.amount,
            discountAmount: 0, couponDiscountAmount: 0, taxAmount: 0, taxRate: 0,
            cashTenderedAmount: null, cashChangeAmount: null,
            note: customer ? "" : [item.preparationNote, sale.note].filter(Boolean).join(" / "),
            items: [line(item, customer ? language : "ja", customer)]
          }
        });
    }
  }

  const other = items.filter((item, index) => !ticketIndexes.has(index) && !isPosImmediateItem(item));
  for (const brandId of new Set(other.map(item => item.brandId))) {
    const group = other.filter(item => item.brandId === brandId);
    const amount = group.reduce((total, item) => total + item.amount, 0);
    add("kitchen", normalizePosDocumentCopies(settings.kitchenCopies), settings.kitchenEnabled,
      `brand:${brandId}`, sale.pickupCode, null, brandId || null, "kitchen", {
        version: 1, jobType: "kitchen", printer: { ...getKitchenPrinterForBrand(settings, brandId), openCashDrawer: false },
        storeName: `${storeName} / ${group[0].brandName}`, printedAt,
        kitchenTicketTemplate: resolvePosKitchenTicketTemplate(settings, brandId),
        order: { ...base, paymentMethod: "kitchen", paymentLabel: "厨房", subtotalAmount: amount, totalAmount: amount,
          discountAmount: 0, couponDiscountAmount: 0, taxAmount: 0, taxRate: 0,
          cashTenderedAmount: null, cashChangeAmount: null, items: group.map(item => line(item)) }
      });
  }

  const brands = [...new Set(items.map(item => item.brandId))];
  const template = structuredClone(resolvePosReceiptTemplate(settings, brands.length === 1 ? brands[0] : null,
    sale.receiptRequested ? "invoice" : "receipt"));
  for (const key of ["logoUrl", "promotionImageUrl"] as const) {
    if (template[key]) template[key] = new URL(template[key], "https://www.foundr1.jp").toString();
  }
  const markReducedRate = sale.taxBreakdown?.some(bucket => bucket.rate === 8) ?? false;
  const receipt = applyPosReceiptTaxBreakdown(template, {
    ...base, receiptRequested: sale.receiptRequested,
    receiptTitle: sale.receiptRequested ? template.invoiceTitle : template.receiptTitle,
    receiptRecipientName: sale.receiptRequested ? invoiceRecipientStem(sale.receiptRecipientName ?? template.invoiceRecipientName) : "",
    receiptPurposeText: sale.receiptRequested ? (sale.receiptPurposeText ?? template.invoicePurposeText) : "",
    items: items.map((item, index) => {
      const printedLine = line(item, language, false, markReducedRate);
      const pickupCode = ticketIndexes.has(index) ? tickets.find(ticket => ticket.itemIndex === index)?.pickupCode : undefined;
      return { ...printedLine, name: [pickupCode, printedLine.name].filter(Boolean).join(" ") };
    })
  }, sale.taxBreakdown);
  add("receipt", normalizePosDocumentCopies(settings.receiptCopies), settings.receiptEnabled,
    "order", sale.pickupCode, null, brands.length === 1 ? brands[0] : null, "receipt", {
      version: 1, jobType: "receipt", printer: { ...receiptPrinter, openCashDrawer: false },
      storeName, printedAt, ...receipt
    });
  return documents;
}
