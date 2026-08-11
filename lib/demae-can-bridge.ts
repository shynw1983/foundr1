import type { UberBridgeNode, UberBridgeOperationalItem } from "./uber-bridge";

export type DemaeCanBridgeModifier = {
  name: string;
  quantity: number;
  price: number;
};

export type DemaeCanBridgeItem = {
  name: string;
  quantity: number;
  lineTotal: number;
  modifiers: DemaeCanBridgeModifier[];
};

export type ParsedDemaeCanBridgeOrder = {
  orderNo: string;
  pickupCode: string;
  customerName: string;
  customerNote: string;
  orderedAt: Date;
  status: "new" | "preparing" | "ready" | "completed" | "cancelled";
  orderType: "delivery";
  items: DemaeCanBridgeItem[];
  total: number;
  completeness: number;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/[\t\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourceLabel(value: string) {
  return clean(value).split(/[｜|]/)[0]?.trim() ?? "";
}

function parseMoney(value: unknown) {
  const normalized = clean(value).replace(/[,，\s]/g, "");
  const match = normalized.match(/(?:￥|¥)?(-?\d+)円?/);
  return match ? Number(match[1]) : 0;
}

function stripTrailingPrice(value: string) {
  return clean(value)
    .replace(/\s+(?:￥|¥)?-?[\d,，]+円\s*$/u, "")
    .replace(/\s+--\s*$/u, "")
    .trim();
}

function parseQuantity(value: string) {
  const match = clean(value).match(/^[xX×ｘＸ]\s*([\d０-９]+)$/u);
  if (!match) return 1;
  const normalized = match[1].replace(/[０-９]/g, (digit) => String("０１２３４５６７８９".indexOf(digit)));
  return Math.max(1, Number(normalized));
}

function extractOrderNo(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/注文番号\s*[：:]?\s*([0-9]{8,16})/);
    if (match) return match[1];
    if (/^注文番号\s*[：:]?$/.test(line) && /^[0-9]{8,16}$/.test(lines[index + 1] ?? "")) {
      return lines[index + 1];
    }
  }
  return "";
}

function extractPickupCode(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/受取用番号\s*[：:]?\s*([A-Z0-9]{4,10})/i);
    if (match) return match[1].toUpperCase();
    if (/^受取用番号\s*[：:]?$/.test(line) && /^[A-Z0-9]{4,10}$/i.test(lines[index + 1] ?? "")) {
      return lines[index + 1].toUpperCase();
    }
  }
  for (const line of lines) {
    const match = line.match(/\(([A-Z]{1,3}\d{3,6})\)/i);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

function parseOrderedAt(lines: string[], capturedAt: Date) {
  const joined = lines.join("\n");
  const match = joined.match(
    /(?:注文日時|注文時間|受付日時|受付時間)\s*[：:]?\s*(?:(\d{4})[\/.年-])?(\d{1,2})[\/.月-](\d{1,2})日?\s+(\d{1,2}):([0-5]\d)/
  );
  if (!match) return capturedAt;
  const year = Number(match[1] || new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric"
  }).format(capturedAt));
  return new Date(`${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${match[4].padStart(2, "0")}:${match[5]}:00+09:00`);
}

function modifierName(value: string) {
  let name = sourceLabel(stripTrailingPrice(value));
  name = name
    .replace(/^薬膳の有無を選ぶ\s*/u, "")
    .replace(/^.*?辛さレベルをお選びください(?:（[^）]*）)?\s*/u, "")
    .replace(/^.*?痺れレベルをお選びください\s*/u, "")
    .replace(/^[^\s]*麺の種類を選ぶ\s*/u, "")
    .replace(/^[^\s]*ベーシックトッピング\s*/u, "")
    .replace(/^[^\s]*スタンダードトッピング\s*/u, "")
    .replace(/^【リクエスト制[^】]*】お客様の推しトッピング[^\s]*\s*/u, "")
    .trim();
  return name;
}

function parseItems(lines: string[]) {
  const items: DemaeCanBridgeItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\d+\.\s+(.+)$/);
    if (!heading) continue;
    let end = index + 1;
    while (end < lines.length && !/^\d+\.\s+/.test(lines[end]) && !/^◆.*割引/.test(lines[end])) end += 1;
    const block = lines.slice(index + 1, end);
    const quantityIndex = block.findIndex((line) => /^[xX×ｘＸ]\s*[\d０-９]+$/u.test(line));
    if (quantityIndex < 0) continue;
    const productLine = block.slice(0, quantityIndex).filter(Boolean).at(-1) ?? heading[1];
    const totalLine = block.slice(quantityIndex + 1).find((line) => /(?:￥|¥)?[\d,，]+円/.test(line));
    const totalIndex = totalLine ? block.indexOf(totalLine) : quantityIndex;
    const modifiers = block.slice(totalIndex + 1).flatMap((line) => {
      const name = modifierName(line);
      if (!name || /^(?:小計|合計|値引き|割引)/.test(name)) return [];
      const inlineQuantity = name.match(/^(.*?)\s*[xX×ｘＸ]\s*(\d+)$/u);
      return [{
        name: inlineQuantity?.[1]?.trim() || name,
        quantity: inlineQuantity ? Math.max(1, Number(inlineQuantity[2])) : 1,
        price: /--\s*$/.test(line) ? 0 : parseMoney(line)
      }];
    });
    items.push({
      name: sourceLabel(stripTrailingPrice(productLine)),
      quantity: parseQuantity(block[quantityIndex]),
      lineTotal: totalLine ? parseMoney(totalLine) : 0,
      modifiers
    });
    index = end - 1;
  }
  return items;
}

function extractCustomerNote(lines: string[]) {
  const labels = /^(?:お客様からの連絡事項|お客様のご要望|店舗への連絡事項|備考|注文メモ)$/;
  const index = lines.findIndex((line) => labels.test(line));
  if (index < 0) return "";
  return lines.slice(index + 1).find((line) => line && !/^(?:注文|配達|支払い|店舗)/.test(line)) ?? "";
}

export function parseDemaeCanBridgeSnapshot(
  rawNodes: UberBridgeNode[],
  capturedAt: Date
): ParsedDemaeCanBridgeOrder | null {
  const lines = rawNodes.flatMap((node) => {
    const raw = String(node.text || node.contentDescription || "");
    return raw.split(/\n+/).map(clean).filter(Boolean);
  });
  const orderNo = extractOrderNo(lines);
  if (!orderNo) return null;
  const detailStart = lines.findIndex((line) => line === "注文詳細");
  const detailEnd = detailStart >= 0
    ? lines.slice(detailStart + 1).findIndex((line) => line === "集計")
    : -1;
  const detailLines = detailStart >= 0
    ? lines.slice(detailStart + 1, detailEnd >= 0 ? detailStart + 1 + detailEnd : undefined)
    : lines;
  const items = parseItems(detailLines);
  const joined = lines.join("\n");
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
    || lines.map(parseMoney).find((value) => value > 0) || 0;
  const status: ParsedDemaeCanBridgeOrder["status"] = /キャンセル/.test(joined)
    ? "cancelled"
    : /配達完了|受け渡し完了/.test(joined)
      ? "completed"
      : /配達員待ち|配達員到着|受け渡し待ち|調理完了/.test(joined)
        ? "ready"
        : /調理中|調理開始|受注済み|配達員手配/.test(joined)
          ? "preparing"
          : "new";
  const customerName = lines.find((line) => /(?:様|さん)$/.test(line))?.replace(/(?:様|さん)$/, "").trim() ?? "";
  const modifierCount = items.reduce((sum, item) => sum + item.modifiers.length, 0);
  return {
    orderNo,
    pickupCode: extractPickupCode(lines),
    customerName,
    customerNote: extractCustomerNote(lines),
    orderedAt: parseOrderedAt(lines, capturedAt),
    status,
    orderType: "delivery",
    items,
    total,
    completeness: (items.length * 100) + (modifierCount * 10) + (total > 0 ? 5 : 0) + 3
  };
}

export function toDemaeCanBridgeOperationalItem(
  item: DemaeCanBridgeItem
): UberBridgeOperationalItem {
  const toppingLabels = item.modifiers.flatMap((modifier) => (
    Array.from({ length: Math.max(1, modifier.quantity) }, () => modifier.name)
  ));
  const isMaamaa = /マーラータン|麻辣[烫湯燙]/.test(item.name)
    || item.modifiers.some((modifier) => /辛|痺|シビレ|薬膳|麺/.test(modifier.name));
  return {
    itemName: item.name,
    quantity: Math.max(1, Math.round(item.quantity)),
    amount: Math.max(0, Math.round(item.lineTotal)),
    sizeKey: isMaamaa ? "maamaa_buildable" : "",
    optionLabel: toppingLabels.join(", "),
    toppingLabels
  };
}
