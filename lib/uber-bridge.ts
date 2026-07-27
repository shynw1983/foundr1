export type UberBridgeNode = {
  viewId?: string;
  text?: string;
  contentDescription?: string;
  className?: string;
  path?: string;
};

export type UberBridgeModifier = {
  group: string;
  name: string;
  price: number;
};

export type UberBridgeItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  optionTotal: number;
  lineTotal: number;
  modifiers: UberBridgeModifier[];
};

export type ParsedUberBridgeOrder = {
  orderNo: string;
  customerName: string;
  orderedAt: Date;
  status: "new" | "preparing" | "ready" | "completed" | "cancelled";
  items: UberBridgeItem[];
  total: number;
  completeness: number;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function idSuffix(value: unknown) {
  const normalized = clean(value);
  return normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
}

function parseMoney(value: unknown) {
  const match = clean(value).replace(/[,，\s]/g, "").match(/[￥¥](-?\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseQuantity(value: unknown) {
  const match = clean(value).match(/(\d+(?:\.\d+)?)\s*[×xX]/);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function parseJapaneseDate(value: unknown) {
  const match = clean(value).match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+09:00`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOrderStatus(texts: string[]): ParsedUberBridgeOrder["status"] {
  const joined = texts.join("\n");
  if (/キャンセル|取消/.test(joined)) return "cancelled";
  if (/完了|配達済み|受け渡し済み/.test(joined)) return "completed";
  if (/準備完了|受け渡し待ち/.test(joined)) return "ready";
  if (/調理中|準備中/.test(joined)) return "preparing";
  return "new";
}

function findOrderIdentity(nodes: Array<UberBridgeNode & { id: string; value: string }>) {
  const explicit = nodes.find((node) => (
    node.id === "ub__ueo_order_history_order_item_order_id"
    || node.id.includes("order_details_order_id")
  ))?.value;
  const header = nodes.find((node) => node.id === "ub__ueo_order_details_header_title")?.value ?? "";
  const candidate = clean(explicit || header.split(/[•·]/).at(-1));
  const match = candidate.toUpperCase().match(/\b([A-Z0-9]{5,12})\b/);
  return match?.[1] ?? "";
}

function findCustomerName(nodes: Array<UberBridgeNode & { id: string; value: string }>) {
  const explicit = nodes.find((node) => node.id.includes("customer_name"))?.value;
  if (explicit) return explicit;
  const header = nodes.find((node) => node.id === "ub__ueo_order_details_header_title")?.value ?? "";
  return clean(header.split(/[•·]/)[0]);
}

export function parseUberBridgeSnapshot(
  rawNodes: UberBridgeNode[],
  capturedAt: Date
): ParsedUberBridgeOrder | null {
  const nodes = rawNodes.map((node) => ({
    ...node,
    id: idSuffix(node.viewId),
    value: clean(node.text || node.contentDescription)
  })).filter((node) => node.value);
  const orderNo = findOrderIdentity(nodes);
  if (!orderNo) return null;

  const allTexts = nodes.map((node) => node.value);
  const orderedAt = nodes
    .map((node) => parseJapaneseDate(node.value))
    .find((value): value is Date => Boolean(value)) ?? capturedAt;
  const items: UberBridgeItem[] = [];
  let pendingQuantity = 1;
  let currentItem: UberBridgeItem | null = null;
  let currentModifierGroup = "";
  let lastModifier: UberBridgeModifier | null = null;

  for (const node of nodes) {
    if (node.id === "ub__ueo_cart_item_quantity") {
      pendingQuantity = parseQuantity(node.value);
      continue;
    }
    if (node.id === "ub__ueo_cart_item_name") {
      currentItem = {
        name: node.value,
        quantity: pendingQuantity,
        unitPrice: 0,
        optionTotal: 0,
        lineTotal: 0,
        modifiers: []
      };
      pendingQuantity = 1;
      currentModifierGroup = "";
      lastModifier = null;
      items.push(currentItem);
      continue;
    }
    if (!currentItem) continue;
    if (node.id === "ub__ueo_cart_item_price") {
      currentItem.unitPrice = parseMoney(node.value);
      continue;
    }
    if (node.id === "ub__ueo_modifier_item_name") {
      currentModifierGroup = node.value;
      lastModifier = null;
      continue;
    }
    if (node.id === "ub__ueo_modifier_option_item_name") {
      lastModifier = { group: currentModifierGroup, name: node.value, price: 0 };
      currentItem.modifiers.push(lastModifier);
      continue;
    }
    if (node.id === "ub__ueo_modifier_option_item_price" && lastModifier) {
      lastModifier.price = parseMoney(node.value);
      lastModifier = null;
    }
  }

  for (const item of items) {
    item.optionTotal = item.modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
    item.lineTotal = Math.round(item.quantity * (item.unitPrice + item.optionTotal));
  }

  const totalNode = nodes.find((node) => (
    node.id.includes("order_details")
    && node.id.includes("total")
    && !node.id.includes("item")
  ));
  const derivedTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = parseMoney(totalNode?.value) || derivedTotal;
  const modifierCount = items.reduce((sum, item) => sum + item.modifiers.length, 0);
  const pricedModifierCount = items.reduce(
    (sum, item) => sum + item.modifiers.filter((modifier) => modifier.price !== 0).length,
    0
  );

  return {
    orderNo,
    customerName: findCustomerName(nodes),
    orderedAt,
    status: getOrderStatus(allTexts),
    items,
    total,
    completeness: (items.length * 100) + (modifierCount * 10) + pricedModifierCount + (total > 0 ? 5 : 0)
  };
}
