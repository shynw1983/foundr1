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
  quantity: number;
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
  orderType: "delivery" | "takeout" | "unknown";
  items: UberBridgeItem[];
  total: number;
  completeness: number;
};

export type UberBridgeOperationalItem = {
  itemName: string;
  quantity: number;
  amount: number;
  sizeKey: string;
  optionLabel: string;
  toppingLabels: string[];
};

type NormalizedUberBridgeNode = UberBridgeNode & {
  id: string;
  value: string;
  path: string;
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

function getOrderStatus(
  nodes: Array<UberBridgeNode & { id: string; value: string }>
): ParsedUberBridgeOrder["status"] {
  const operationalNodes = nodes.filter((node) => (
    !node.id.includes("cart_item")
    && !node.id.includes("modifier")
  ));
  const ids = operationalNodes.map((node) => node.id).join("\n");
  const joined = operationalNodes.map((node) => node.value).join("\n");
  if (/キャンセル|取消/.test(joined)) return "cancelled";
  if (
    /handed_off_delivery|courier_rating/.test(ids)
    || /配達済み|受け渡し済み|(^|\n)完了($|\n)/.test(joined)
  ) return "completed";
  if (
    /details_preparing/.test(ids)
    || /あと\s*\d+\s*分で準備完了/.test(joined)
  ) return "preparing";
  if (/準備完了|受け渡し待ち/.test(joined)) return "ready";
  if (/調理中|準備中/.test(joined)) return "preparing";
  return "new";
}

function getOrderType(
  nodes: NormalizedUberBridgeNode[]
): ParsedUberBridgeOrder["orderType"] {
  const operationalNodes = nodes.filter((node) => (
    !node.id.includes("cart_item")
    && !node.id.includes("modifier")
  ));
  const ids = operationalNodes.map((node) => node.id.toLowerCase()).join("\n");
  const texts = operationalNodes.map((node) => node.value).join("\n").toLowerCase();
  if (
    /(?:self|customer)[_-]?pickup|take[_-]?out/.test(ids)
    || /お持ち帰り|持ち帰り注文|店頭(?:で)?受け取り|注文者.{0,8}受け取り|お客様.{0,8}受け取り|自提|自取|customer\s+pick-?up|self\s+pick-?up|pick-?up\s+order|포장\s*주문|고객\s*픽업/.test(texts)
  ) return "takeout";
  if (
    /handed_off_delivery|details_courier|courier_arrival|courier_rating/.test(ids)
    || /配達中|配達予定|配送中|配送予定|配達パートナー|delivery\s+(?:person|partner|courier)|배달\s*(?:중|예정)/.test(texts)
  ) return "delivery";
  return "unknown";
}

function sourceLabel(value: string) {
  return value.split(/[｜|]/)[0]?.trim() || value.trim();
}

function modifierLabel(group: string, name: string) {
  const normalizedGroup = sourceLabel(group);
  const normalizedName = sourceLabel(name);
  if (/辛さ/.test(normalizedGroup)) return `辛さ：${normalizedName}`;
  if (/痺れ|しびれ/.test(normalizedGroup)) return `痺れ：${normalizedName}`;
  if (/味変/.test(normalizedGroup)) return `味変：${normalizedName}`;
  return normalizedName;
}

export function toUberBridgeOperationalItem(item: UberBridgeItem): UberBridgeOperationalItem {
  const compactLabels = item.modifiers.map((modifier) => {
    const label = modifierLabel(modifier.group, modifier.name);
    return modifier.quantity > 1 ? `${label} x${modifier.quantity}` : label;
  });
  const toppingLabels = item.modifiers.flatMap((modifier) => {
    const label = modifierLabel(modifier.group, modifier.name);
    return Array.from({ length: Math.max(1, Math.round(modifier.quantity)) }, () => label);
  });
  const isMaamaa = /マーラータン|麻辣[烫湯燙]/.test(item.name)
    || item.modifiers.some((modifier) => /辛さ|痺れ|薬膳|麺/.test(modifier.group));
  return {
    itemName: sourceLabel(item.name),
    quantity: Math.max(1, Math.round(item.quantity)),
    amount: Math.max(0, Math.round(item.lineTotal)),
    sizeKey: isMaamaa ? "maamaa_buildable" : "",
    optionLabel: compactLabels.join(", "),
    toppingLabels
  };
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

function parentPath(path: string) {
  const separator = path.lastIndexOf(".");
  return separator >= 0 ? path.slice(0, separator) : "";
}

function siblingIndex(path: string) {
  const value = Number(path.slice(path.lastIndexOf(".") + 1));
  return Number.isInteger(value) ? value : -1;
}

function parsePathBasedItems(nodes: NormalizedUberBridgeNode[]) {
  const itemNameNodes = nodes.filter((node) => (
    node.id === "ub__ueo_cart_item_name"
    && node.path
  ));
  if (!itemNameNodes.length) return [];
  return itemNameNodes.map((itemNode) => {
    const itemPath = parentPath(itemNode.path);
    const modifierPrefix = `${itemPath}.3.`;
    const modifierNodes = nodes.filter((node) => node.path.startsWith(modifierPrefix));
    const groupNodes = modifierNodes.filter((node) => node.id === "ub__ueo_modifier_item_name");
    const modifiers = modifierNodes
      .filter((node) => node.id === "ub__ueo_modifier_option_item_name")
      .map((optionNode) => {
        const optionPath = parentPath(optionNode.path);
        const optionIndex = siblingIndex(optionPath);
        const group = groupNodes
          .filter((node) => siblingIndex(parentPath(node.path)) < optionIndex)
          .sort((left, right) => (
            siblingIndex(parentPath(right.path)) - siblingIndex(parentPath(left.path))
          ))[0];
        const quantityNode = modifierNodes.find((node) => (
          node.id === "ub__ueo_modifier_option_item_quantity"
          && parentPath(node.path) === optionPath
        ));
        const priceNode = modifierNodes.find((node) => (
          node.id === "ub__ueo_modifier_option_item_price"
          && parentPath(node.path) === optionPath
        ));
        return {
          group: group?.value ?? "",
          name: optionNode.value,
          quantity: parseQuantity(quantityNode?.value),
          price: parseMoney(priceNode?.value)
        };
      });
    const quantityNode = nodes.find((node) => (
      node.id === "ub__ueo_cart_item_quantity"
      && node.path === `${itemPath}.0`
    ));
    const priceNode = nodes.find((node) => (
      node.id === "ub__ueo_cart_item_price"
      && node.path === `${itemPath}.2`
    ));
    const quantity = parseQuantity(quantityNode?.value);
    const unitPrice = parseMoney(priceNode?.value);
    const optionTotal = modifiers.reduce(
      (sum, modifier) => sum + (modifier.price * modifier.quantity),
      0
    );
    return {
      name: itemNode.value,
      quantity,
      unitPrice,
      optionTotal,
      lineTotal: Math.round(quantity * (unitPrice + optionTotal)),
      modifiers
    };
  });
}

function findDisplayedTotal(nodes: NormalizedUberBridgeNode[]) {
  const totalLabelIndex = nodes.findLastIndex((node) => (
    /^(?:合計|总计|總計|total|합계)$/i.test(node.value)
  ));
  if (totalLabelIndex >= 0) {
    const followingTotal = nodes.slice(totalLabelIndex + 1).find((node) => (
      !node.id.includes("cart_item")
      && !node.id.includes("modifier")
      && /^[￥¥]\s*[\d,，]+$/.test(node.value)
    ));
    const parsed = parseMoney(followingTotal?.value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export function parseUberBridgeSnapshot(
  rawNodes: UberBridgeNode[],
  capturedAt: Date
): ParsedUberBridgeOrder | null {
  const normalizedNodes: NormalizedUberBridgeNode[] = rawNodes.map((node) => ({
    ...node,
    id: idSuffix(node.viewId),
    value: clean(node.text || node.contentDescription),
    path: clean(node.path)
  }));
  const nodes = normalizedNodes.filter((node) => node.value);
  const orderNo = findOrderIdentity(nodes);
  if (!orderNo) return null;

  const allTexts = nodes.map((node) => node.value);
  const orderType = getOrderType(normalizedNodes);
  const orderedAt = nodes
    .map((node) => parseJapaneseDate(node.value))
    .find((value): value is Date => Boolean(value)) ?? capturedAt;
  let items: UberBridgeItem[] = [];
  let pendingQuantity = 1;
  let currentItem: UberBridgeItem | null = null;
  let currentModifierGroup = "";
  let pendingModifierQuantity = 1;
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
      pendingModifierQuantity = 1;
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
      pendingModifierQuantity = 1;
      lastModifier = null;
      continue;
    }
    if (node.id === "ub__ueo_modifier_option_item_quantity") {
      pendingModifierQuantity = parseQuantity(node.value);
      continue;
    }
    if (node.id === "ub__ueo_modifier_option_item_name") {
      lastModifier = {
        group: currentModifierGroup,
        name: node.value,
        quantity: pendingModifierQuantity,
        price: 0
      };
      pendingModifierQuantity = 1;
      currentItem.modifiers.push(lastModifier);
      continue;
    }
    if (node.id === "ub__ueo_modifier_option_item_price" && lastModifier) {
      lastModifier.price = parseMoney(node.value);
      lastModifier = null;
    }
  }

  const pathBasedItems = parsePathBasedItems(normalizedNodes);
  if (pathBasedItems.length) items = pathBasedItems;

  for (const item of items) {
    item.optionTotal = item.modifiers.reduce(
      (sum, modifier) => sum + (modifier.price * modifier.quantity),
      0
    );
    item.lineTotal = Math.round(item.quantity * (item.unitPrice + item.optionTotal));
  }

  const totalNode = nodes.find((node) => (
    node.id.includes("order_details")
    && node.id.includes("total")
    && !node.id.includes("item")
  ));
  const derivedTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = parseMoney(totalNode?.value) || findDisplayedTotal(normalizedNodes) || derivedTotal;
  const modifierCount = items.reduce(
    (sum, item) => sum + item.modifiers.reduce((count, modifier) => count + modifier.quantity, 0),
    0
  );
  const pricedModifierCount = items.reduce(
    (sum, item) => sum + item.modifiers.filter((modifier) => modifier.price !== 0).length,
    0
  );

  return {
    orderNo,
    customerName: findCustomerName(nodes),
    orderedAt,
    status: getOrderStatus(nodes),
    orderType,
    items,
    total,
    completeness: (items.length * 100)
      + (modifierCount * 10)
      + pricedModifierCount
      + (total > 0 ? 5 : 0)
      + (orderType !== "unknown" ? 2 : 0)
  };
}
