import { sql } from "./db";

export type OnlineReceiptBrand = "nanacha" | "maamaa";

export type OnlineReceiptItem = {
  title: string;
  description: string;
  details: string[];
  sections: Array<{
    title: string;
    items: string[];
  }>;
  amount: number;
};

export type OnlineReceiptViewModel = {
  brand: OnlineReceiptBrand;
  brandName: string;
  logoSrc: string;
  receiptStatus: "valid" | "cancelled" | "partially_refunded";
  statusLabel: string;
  statusDetail: string;
  receiptNo: string;
  issuedAt: string;
  recipientName: string;
  pickupCode: string;
  pickupDate: string;
  pickupTime: string;
  paidAt: string;
  paymentProvider: string;
  downloadedAt: string;
  downloadCount: number;
  issuer: {
    name: string;
    address: string;
    phone: string;
    invoiceRegistrationNumber: string;
  };
  purposeText: string;
  taxRate: number;
  items: OnlineReceiptItem[];
  subtotalAmount: number;
  couponDiscountAmount: number;
  totalAmount: number;
  refundAmount: number;
  refundedAt: string;
  taxIncludedAmount: number;
};

type CustomerSummary = Record<string, unknown>;

type OrderRow = {
  id: string;
  pickupCode: string;
  orderSource: string;
  status: string;
  paymentStatus: string;
  paymentRefundStatus: string;
  paymentProvider: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency: string;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  optionText: string;
  toppings: string;
  customerSummary: CustomerSummary;
  paidAt: Date | string | null;
  paymentRefundedAt: Date | string | null;
  cancelledAt: Date | string | null;
  createdAt: Date | string | null;
  brandName: string;
  brandType: string;
  issuerName: string;
  invoiceRegistrationNumber: string;
  receiptPurposeText: string;
  receiptTaxRate: number | string;
  issuerAddress: string;
  issuerPhone: string;
};

type ItemRow = {
  itemName: string;
  sizeKey: string;
  sizeLabel: string;
  temperature: string;
  sweetness: string;
  ice: string;
  optionLabel: string;
  toppingLabels: string[];
  quantity: number;
  measuredQuantity: string;
  measuredUnit: string;
  measuredUnitPrice: string;
  amount: number;
  sortOrder: number;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPickupDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

function splitLines(value: string) {
  return clean(value).split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function getBrand(order: Pick<OrderRow, "orderSource" | "brandName" | "brandType">): OnlineReceiptBrand {
  const source = order.orderSource.toLowerCase();
  const brandText = `${order.brandName} ${order.brandType}`.toLowerCase();
  if (source.includes("maamaa") || brandText.includes("maamaa") || brandText.includes("まぁ麻")) return "maamaa";
  return "nanacha";
}

function getCustomerName(summary: CustomerSummary) {
  const customer = asRecord(summary.customer);
  return clean(customer.name) || clean(summary.name) || "お客様";
}

function getCouponDiscount(summary: CustomerSummary) {
  const discount = Number(summary.couponDiscountAmount ?? 0);
  return Number.isFinite(discount) ? Math.max(0, Math.round(discount)) : 0;
}

function getSubtotal(summary: CustomerSummary, totalAmount: number, couponDiscountAmount: number, items: OnlineReceiptItem[]) {
  const subtotal = Number(summary.subtotalAmount ?? 0);
  if (Number.isFinite(subtotal) && subtotal > 0) return Math.round(subtotal);
  const itemSubtotal = items.reduce((sum, item) => sum + item.amount, 0);
  if (itemSubtotal > 0) return itemSubtotal;
  return totalAmount + couponDiscountAmount;
}

function getReceiptPurposeText(value: unknown) {
  return clean(value) || "テイクアウト飲食代";
}

function getReceiptTaxRate(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : 8;
}

function getIncludedTax(totalAmount: number, taxRate: number) {
  return Math.round(totalAmount * taxRate / (100 + taxRate));
}

function getReceiptStatus(order: Pick<OrderRow, "status" | "paymentStatus" | "paymentRefundStatus" | "paymentRefundedAt" | "cancelledAt">, refundAmount: number) {
  const paymentStatus = clean(order.paymentStatus);
  const paymentRefundStatus = clean(order.paymentRefundStatus);
  const status = clean(order.status);
  const refundedAt = formatDateTime(order.paymentRefundedAt) || formatDateTime(order.cancelledAt);
  if (paymentStatus === "refunded" || status === "cancelled") {
    return {
      receiptStatus: "cancelled" as const,
      statusLabel: "取消済み",
      statusDetail: "この領収書の対象注文は取消・返金済みです。原本として利用しないでください。",
      refundAmount,
      refundedAt
    };
  }
  if (paymentStatus === "partial_refunded" || paymentRefundStatus === "partial" || refundAmount > 0) {
    return {
      receiptStatus: "partially_refunded" as const,
      statusLabel: "一部返金済み",
      statusDetail: "この注文には一部返金があります。返金額を確認してください。",
      refundAmount,
      refundedAt
    };
  }
  return {
    receiptStatus: "valid" as const,
    statusLabel: "",
    statusDetail: "",
    refundAmount: 0,
    refundedAt: ""
  };
}

function getLogoSrc(brand: OnlineReceiptBrand) {
  return brand === "maamaa" ? "/brands/maamaa-logo.png" : "/brands/nanacha-logo.png";
}

function getBrandName(brand: OnlineReceiptBrand, fallback: string) {
  if (fallback) return fallback;
  return brand === "maamaa" ? "まぁ麻" : "nanacha";
}

export async function recordOnlineReceiptDownload(input: {
  orderId: string;
  pickupCode: string;
}) {
  const rows = await sql`
    update store_customer_orders
    set
      receipt_download_count = coalesce(receipt_download_count, 0) + 1,
      receipt_last_downloaded_at = now(),
      updated_at = now()
    where id::text = ${input.orderId}
      and pickup_code = ${input.pickupCode}
      and payment_status in ('paid', 'refunded', 'partial_refunded')
    returning
      receipt_download_count::int as "downloadCount",
      receipt_last_downloaded_at as "downloadedAt"
  `;
  const row = rows[0] as { downloadCount?: number; downloadedAt?: Date | string | null } | undefined;
  if (!row) return null;
  return {
    downloadCount: Number(row.downloadCount ?? 0),
    downloadedAt: row.downloadedAt ?? null
  };
}

function getNanachaDetails(item: ItemRow) {
  return [
    item.sizeLabel,
    item.temperature,
    item.sweetness,
    item.ice,
    item.optionLabel,
    ...item.toppingLabels
  ].map(clean).filter(Boolean);
}

function getMaamaaSections(summary: CustomerSummary) {
  const maamaa = asRecord(summary.maamaa);
  return asArray(maamaa.items).map((rawItem) => {
    const item = asRecord(rawItem);
    return asArray(item.sections).map((rawSection) => {
      const section = asRecord(rawSection);
      return {
        title: clean(section.sectionTitle),
        items: asArray(section.items).map((rawChoice) => clean(asRecord(rawChoice).name)).filter(Boolean)
      };
    }).filter((section) => section.title && section.items.length);
  });
}

function getMaamaaDetailsFromSummary(summary: CustomerSummary) {
  const maamaa = asRecord(summary.maamaa);
  return asArray(maamaa.items).map((rawItem) => {
    const item = asRecord(rawItem);
    const customization = asRecord(item.customization);
    const details = [
      clean(asRecord(customization.medicinalSpice).name),
      clean(asRecord(customization.heat).name) ? `辛さ: ${clean(asRecord(customization.heat).name)}` : "",
      clean(asRecord(customization.numb).name) ? `痺れ: ${clean(asRecord(customization.numb).name)}` : "",
      ...asArray(customization.specialFlavors).map((rawFlavor) => {
        const name = clean(asRecord(rawFlavor).name);
        return name ? `味変: ${name}` : "";
      })
    ];
    return details.filter(Boolean);
  });
}

function buildItems(order: OrderRow, itemRows: ItemRow[], brand: OnlineReceiptBrand): OnlineReceiptItem[] {
  if (itemRows.length) {
    const maamaaSections = brand === "maamaa" ? getMaamaaSections(order.customerSummary) : [];
    const maamaaDetails = brand === "maamaa" ? getMaamaaDetailsFromSummary(order.customerSummary) : [];
    return itemRows.map((item, index) => {
      const details = brand === "maamaa"
        ? (maamaaDetails[index]?.length ? maamaaDetails[index] : [item.sizeLabel, item.optionLabel].map(clean).filter(Boolean))
        : getNanachaDetails(item);
      const sections = brand === "maamaa"
        ? (maamaaSections[index] ?? [])
        : (item.toppingLabels.length ? [{ title: "トッピング", items: item.toppingLabels }] : []);
      const measured = item.measuredQuantity && item.measuredUnit ? `${item.measuredQuantity}${item.measuredUnit}` : "";
      return {
        title: item.itemName || `商品 ${index + 1}`,
        description: measured || (item.quantity > 1 ? `数量 ${item.quantity}` : ""),
        details,
        sections,
        amount: Number(item.amount ?? 0)
      };
    });
  }

  const fallbackDetails = brand === "maamaa"
    ? splitLines(order.size)
    : [order.size, order.temperature, order.sweetness, order.ice, order.optionText, ...splitLines(order.toppings)].map(clean).filter(Boolean);
  return splitLines(order.drink).map((title, index) => ({
    title: title.replace(/^\d+\.\s*/, "") || `商品 ${index + 1}`,
    description: "",
    details: fallbackDetails,
    sections: [],
    amount: index === 0 ? Number(order.amount ?? 0) : 0
  }));
}

export async function getOnlineReceiptViewModel(input: {
  orderId: string;
  pickupCode: string;
  downloadedAt?: Date | string | null;
  downloadCount?: number;
}): Promise<OnlineReceiptViewModel | null> {
  const orderRows = await sql`
    select
      store_customer_orders.id::text as id,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.payment_refund_status, '') as "paymentRefundStatus",
      store_customer_orders.payment_provider as "paymentProvider",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.amount,
      store_customer_orders.currency,
      store_customer_orders.drink,
      store_customer_orders.size,
      store_customer_orders.temperature,
      store_customer_orders.sweetness,
      store_customer_orders.ice,
      store_customer_orders.option_text as "optionText",
      store_customer_orders.toppings,
      store_customer_orders.customer_summary as "customerSummary",
      store_customer_orders.paid_at as "paidAt",
      store_customer_orders.payment_refunded_at as "paymentRefundedAt",
      store_customer_orders.cancelled_at as "cancelledAt",
      store_customer_orders.created_at as "createdAt",
      coalesce(brands.name, '') as "brandName",
      coalesce(brands.brand_type, '') as "brandType",
      coalesce(companies.legal_name, companies.name, stores.name, '') as "issuerName",
      coalesce(companies.invoice_registration_number, '') as "invoiceRegistrationNumber",
      coalesce(companies.receipt_purpose_text, 'テイクアウト飲食代') as "receiptPurposeText",
      coalesce(companies.receipt_tax_rate, 8)::float as "receiptTaxRate",
      coalesce(companies.address, '') as "issuerAddress",
      coalesce(companies.phone, '') as "issuerPhone"
    from store_customer_orders
    left join brands on brands.id = store_customer_orders.brand_id
    left join stores on stores.id = store_customer_orders.store_id
    left join companies on companies.id = stores.company_id
    where store_customer_orders.id::text = ${input.orderId}
      and store_customer_orders.pickup_code = ${input.pickupCode}
    limit 1
  `;
  const order = orderRows[0] as OrderRow | undefined;
  if (!order || !["paid", "refunded", "partial_refunded"].includes(order.paymentStatus)) return null;

  const itemRows = await sql`
    select
      item_name as "itemName",
      size_key as "sizeKey",
      size_label as "sizeLabel",
      temperature,
      sweetness,
      ice,
      option_label as "optionLabel",
      topping_labels as "toppingLabels",
      quantity,
      coalesce(measured_quantity::text, '') as "measuredQuantity",
      measured_unit as "measuredUnit",
      coalesce(measured_unit_price::text, '') as "measuredUnitPrice",
      amount,
      sort_order as "sortOrder"
    from store_customer_order_items
    where order_id = ${input.orderId}
    order by sort_order asc, created_at asc
  ` as ItemRow[];

  const refundRows = await sql`
    select coalesce(sum(refunded_amount), 0)::int as "refundAmount"
    from store_customer_order_items
    where order_id = ${input.orderId}
  `;

  const customerSummary = asRecord(order.customerSummary);
  const brand = getBrand(order);
  const totalAmount = Number(order.amount ?? 0);
  const rawRefundAmount = Number(refundRows[0]?.refundAmount ?? 0);
  const receiptStatus = getReceiptStatus(order, rawRefundAmount > 0 ? rawRefundAmount : order.paymentStatus === "refunded" ? totalAmount : 0);
  const items = buildItems({ ...order, customerSummary }, itemRows, brand);
  const couponDiscountAmount = getCouponDiscount(customerSummary);
  const subtotalAmount = getSubtotal(customerSummary, totalAmount, couponDiscountAmount, items);
  const taxRate = getReceiptTaxRate(order.receiptTaxRate);

  return {
    brand,
    brandName: getBrandName(brand, order.brandName),
    logoSrc: getLogoSrc(brand),
    ...receiptStatus,
    receiptNo: `${clean(order.pickupCode)}-${clean(order.id).slice(0, 8)}`,
    issuedAt: formatDateTime(new Date()),
    recipientName: getCustomerName(customerSummary),
    pickupCode: clean(order.pickupCode),
    pickupDate: formatPickupDate(order.pickupDate),
    pickupTime: clean(order.pickupTime),
    paidAt: formatDateTime(order.paidAt) || formatDateTime(order.createdAt),
    paymentProvider: clean(order.paymentProvider).toUpperCase(),
    downloadedAt: formatDateTime(input.downloadedAt ?? null),
    downloadCount: Math.max(0, Math.round(Number(input.downloadCount ?? 0) || 0)),
    issuer: {
      name: clean(order.issuerName) || "会社名未設定",
      address: clean(order.issuerAddress),
      phone: clean(order.issuerPhone),
      invoiceRegistrationNumber: clean(order.invoiceRegistrationNumber)
    },
    purposeText: getReceiptPurposeText(order.receiptPurposeText),
    taxRate,
    items,
    subtotalAmount,
    couponDiscountAmount,
    totalAmount,
    refundAmount: receiptStatus.refundAmount,
    refundedAt: receiptStatus.refundedAt,
    taxIncludedAmount: getIncludedTax(totalAmount, taxRate)
  };
}

export function getDemoOnlineReceiptViewModel(brand: OnlineReceiptBrand): OnlineReceiptViewModel {
  const totalAmount = brand === "maamaa" ? 2380 : 1580;
  const couponDiscountAmount = brand === "maamaa" ? 200 : 0;
  const subtotalAmount = totalAmount + couponDiscountAmount;
  return {
    brand,
    brandName: brand === "maamaa" ? "まぁ麻" : "nanacha",
    logoSrc: getLogoSrc(brand),
    receiptStatus: "valid",
    statusLabel: "",
    statusDetail: "",
    receiptNo: `${brand === "maamaa" ? "M" : "N"}-1234-DEMO`,
    issuedAt: "2026/06/06 21:57",
    recipientName: "山田 太郎",
    pickupCode: brand === "maamaa" ? "M-1234" : "N-1234",
    pickupDate: "2026/06/06(土)",
    pickupTime: "18:30",
    paidAt: "2026/06/06 18:05",
    paymentProvider: brand === "maamaa" ? "KOMOJU" : "SQUARE",
    downloadedAt: "",
    downloadCount: 0,
    issuer: {
      name: "Foundr1 株式会社",
      address: "福岡県福岡市中央区天神 1-1-1",
      phone: "092-000-0000",
      invoiceRegistrationNumber: "T1234567890123"
    },
    purposeText: "テイクアウト飲食代",
    taxRate: 8,
    items: brand === "maamaa"
      ? [
          {
            title: "麻辣湯",
            description: "",
            details: ["薬膳スープ", "辛さ: 中辛", "痺れ: ひかえめ", "味変: 黒酢"],
            sections: [
              { title: "肉類", items: ["牛肉", "ラム肉"] },
              { title: "海鮮", items: ["エビ", "イカ"] },
              { title: "野菜", items: ["白菜", "きくらげ", "青梗菜"] },
              { title: "麺類", items: ["春雨"] }
            ],
            amount: 2380
          }
        ]
      : [
          {
            title: "黒糖ミルクティー",
            description: "",
            details: ["M", "ICE", "甘さ: 50%", "氷: 少なめ", "タピオカ"],
            sections: [{ title: "トッピング", items: ["フォームミルク"] }],
            amount: 780
          },
          {
            title: "ジャスミンミルクティー",
            description: "",
            details: ["L", "HOT", "甘さ: 30%", "氷: なし", "オプションなし"],
            sections: [],
            amount: 800
          }
        ],
    subtotalAmount,
    couponDiscountAmount,
    totalAmount,
    refundAmount: 0,
    refundedAt: "",
    taxIncludedAmount: getIncludedTax(totalAmount, 8)
  };
}
