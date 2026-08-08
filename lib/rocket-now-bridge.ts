import type {
  UberBridgeNode,
  UberBridgeOperationalItem
} from "./uber-bridge";

export type RocketNowBridgeModifier = {
  name: string;
  quantity: number;
  price: number;
};

export type RocketNowBridgeItem = {
  name: string;
  quantity: number;
  lineTotal: number;
  modifiers: RocketNowBridgeModifier[];
};

export type ParsedRocketNowBridgeOrder = {
  orderNo: string;
  customerName: string;
  customerNote: string;
  orderedAt: Date;
  status: "new" | "preparing" | "ready" | "completed" | "cancelled";
  orderType: "delivery";
  items: RocketNowBridgeItem[];
  total: number;
  completeness: number;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/[\t\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourceLabel(value: string) {
  return value.split(/[｜|]/)[0]?.trim() || value.trim();
}

function parseMoney(value: unknown) {
  const normalized = clean(value).replace(/[,，\s]/g, "");
  const match = normalized.match(/(?:￥|¥)?(-?\d+)円?/);
  return match ? Number(match[1]) : 0;
}

function parseQuantity(value: unknown) {
  const match = clean(value).match(/^(?:数量\s*)?(\d+)\s*(?:個|点|×|x|X)?$/);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function parseInlineQuantity(value: string) {
  const match = clean(value).match(/^(.*?)\s*[xX×ｘＸ]\s*([\d０-９]+)\s*$/u);
  if (!match || !match[1].trim()) return { name: clean(value), quantity: 1 };
  const normalizedQuantity = match[2].replace(/[０-９]/g, (digit) => String("０１２３４５６７８９".indexOf(digit)));
  return {
    name: match[1].trim(),
    quantity: Math.max(1, Number(normalizedQuantity))
  };
}

function extractOrderNo(values: string[]) {
  for (const value of values) {
    const explicit = value.match(/(?:注文(?:管理)?番号|注文番号)\s*[:：#]?\s*([A-Z0-9]{6,12})/i);
    if (explicit) return explicit[1].toUpperCase();
  }
  for (const value of values) {
    const candidates = value.toUpperCase().match(/\b[A-Z0-9]{6}\b/g) ?? [];
    const candidate = candidates.find((entry) => /[A-Z]/.test(entry) && /\d/.test(entry));
    if (candidate) return candidate;
  }
  return "";
}

function parseOrderedAt(values: string[], capturedAt: Date) {
  for (const value of values) {
    const full = value.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日[^\d]*(午前|午後)?\s*(\d{1,2}):([0-5]\d)/);
    if (!full) continue;
    const year = Number(full[1] || capturedAt.getFullYear());
    let hour = Number(full[5]);
    if (full[4] === "午後" && hour < 12) hour += 12;
    if (full[4] === "午前" && hour === 12) hour = 0;
    const parsed = new Date(Date.UTC(year, Number(full[2]) - 1, Number(full[3]), hour - 9, Number(full[6])));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  for (const value of values) {
    const time = value.match(/(午前|午後)\s*(\d{1,2}):([0-5]\d)/);
    if (!time) continue;
    let hour = Number(time[2]);
    if (time[1] === "午後" && hour < 12) hour += 12;
    if (time[1] === "午前" && hour === 12) hour = 0;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(capturedAt);
    return new Date(`${parts}T${String(hour).padStart(2, "0")}:${time[3]}:00+09:00`);
  }
  return capturedAt;
}

const ignoredLine = /^(?:新規注文|注文管理|処理中(?:\s*\d+)?|完了(?:\s*\d+)?|最新順|過去順|注文受諾|準備完了|準備遅延|注文キャンセル|調理時間変更|レシート出力|合計|小計|決済金額|お客様のご要望|店舗へのリクエスト|配達パートナー|ドライバー|お客様|注文番号|注文管理番号|税込)$/;

function isMoneyLine(value: string) {
  return /(?:￥|¥)\s*[\d,，]+|[\d,，]+\s*円/.test(value);
}

function isQuantityLine(value: string) {
  return /^(?:数量\s*)?\d+\s*(?:個|点|×|x|X)?$/.test(value);
}

function isCandidateName(value: string, orderNo: string) {
  return value.length > 1
    && value !== orderNo
    && !ignoredLine.test(value)
    && !isMoneyLine(value)
    && !isQuantityLine(value)
    && !/(?:午前|午後)?\s*\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日/.test(value)
    && !/^(?:あと)?\s*\d+\s*分/.test(value)
    && !/^(?:注文|商品)\s*\d+\s*(?:件|点)$/.test(value)
    && !/^(?:電話|印刷|閉じる|戻る)$/.test(value);
}

function parseItems(lines: string[], orderNo: string) {
  const items: RocketNowBridgeItem[] = [];
  const usedNames = new Set<string>();
  let previousMoneyIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isMoneyLine(lines[index])) continue;
    if (/\[メニュー\s*\d+個\]/.test(lines[index])) continue;
    if (lines.slice(Math.max(0, index - 2), index).some((line) => (
      /^(?:合計|決済金額|注文金額|総額|小計)/.test(line)
    ))) continue;
    const amount = parseMoney(lines[index]);
    const quantityIndex = index > 0 && isQuantityLine(lines[index - 1]) ? index - 1 : -1;
    let nameIndex = quantityIndex >= 0 ? quantityIndex - 1 : index - 1;
    while (nameIndex >= Math.max(0, index - 5) && !isCandidateName(lines[nameIndex], orderNo)) {
      nameIndex -= 1;
    }
    if (nameIndex < 0) continue;
    const name = lines[nameIndex];
    if (usedNames.has(`${nameIndex}:${name}:${amount}`)) continue;
    usedNames.add(`${nameIndex}:${name}:${amount}`);
    const quantity = quantityIndex >= 0 ? parseQuantity(lines[quantityIndex]) : 1;
    const previous = items.at(-1);
    if (previous && previousMoneyIndex >= 0) {
      for (let pendingIndex = previousMoneyIndex + 1; pendingIndex < nameIndex; pendingIndex += 1) {
        const pendingLine = lines[pendingIndex];
        if (!isCandidateName(pendingLine, orderNo)) continue;
        const pending = parseInlineQuantity(pendingLine);
        const alreadyParsed = previous.modifiers.some((modifier) => modifier.name === pending.name);
        if (!alreadyParsed) previous.modifiers.push({ name: pending.name, quantity: pending.quantity, price: 0 });
      }
    }
    const inline = parseInlineQuantity(name);
    const parsedQuantity = quantityIndex >= 0 ? quantity : inline.quantity;
    const parsedName = inline.name;
    const looksLikeNamedModifier = /追加|変更|選択|トッピング|辛さ|痺れ|しびれ|シビ|薬膳|カスタム/i.test(parsedName);
    const looksLikeModifier = Boolean(previous)
      && nameIndex > 0
      && (quantityIndex < 0 || looksLikeNamedModifier);
    if (looksLikeModifier && previous) {
      previous.modifiers.push({ name: parsedName, quantity: parsedQuantity, price: amount });
      previous.lineTotal += amount;
    } else {
      items.push({ name: parsedName, quantity: parsedQuantity, lineTotal: amount, modifiers: [] });
    }
    previousMoneyIndex = index;
  }
  return items;
}

function extractCustomerNote(lines: string[], orderNo: string) {
  const menuIndex = lines.findIndex((line) => line === "メニュー");
  const headerLines = menuIndex >= 0 ? lines.slice(0, menuIndex) : lines;
  const labeledIndex = headerLines.findIndex((line) => /^(?:お客様のご要望|店舗へのリクエスト|備考|注文メモ)$/.test(line));
  if (labeledIndex >= 0) {
    const labeledNote = headerLines.slice(labeledIndex + 1).find((line) => isCandidateName(line, orderNo));
    if (labeledNote) return labeledNote;
  }
  return headerLines.find((line) => /^\[(?:カトラリー|使い捨て(?:カトラリー|用品))[^\]]*\]\s*.+/i.test(line)) ?? "";
}

export function parseRocketNowBridgeSnapshot(
  rawNodes: UberBridgeNode[],
  capturedAt: Date
): ParsedRocketNowBridgeOrder | null {
  const lines = rawNodes.flatMap((node) => {
    const raw = String(node.text || node.contentDescription || "");
    return raw.split(/\n+/).map(clean).filter(Boolean);
  });
  const orderNo = extractOrderNo(lines);
  if (!orderNo) return null;
  const joined = lines.join("\n");
  const detailMenuIndex = lines.findLastIndex((line) => line === "メニュー");
  const detailLines = detailMenuIndex >= 0 ? lines.slice(detailMenuIndex + 1) : lines;
  const items = parseItems(detailLines, orderNo);
  const displayedTotalIndex = lines.findLastIndex((line) => /^(?:合計|決済金額|注文金額|総額)/.test(line));
  const displayedTotal = displayedTotalIndex >= 0
    ? lines.slice(displayedTotalIndex + 1, displayedTotalIndex + 4).map(parseMoney).find((value) => value > 0) ?? 0
    : 0;
  const overviewTotal = lines
    .map((line) => line.match(/\[メニュー\s*\d+個\]\s*(?:￥|¥)?([\d,，]+)円?/))
    .map((match) => match ? Number(match[1].replace(/[,，]/g, "")) : 0)
    .find((value) => value > 0) ?? 0;
  const derivedTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = displayedTotal || overviewTotal || derivedTotal;
  const status: ParsedRocketNowBridgeOrder["status"] = /キャンセル済み|注文キャンセル完了/.test(joined)
    ? "cancelled"
    : /配達完了|受け渡し完了|完了した注文/.test(joined)
      ? "completed"
      : /準備完了済み|配達パートナー.{0,12}(?:到着|待機)|受け渡し待ち/.test(joined)
        ? "ready"
        : /準備完了|準備遅延|調理中|配達パートナー.{0,12}(?:検索|割り当て)/.test(joined)
          ? "preparing"
          : "new";
  const customerNameLine = lines.find((line) => /(?:様|さん)$/.test(line) && isCandidateName(line, orderNo));
  const modifierCount = items.reduce((sum, item) => sum + item.modifiers.length, 0);
  return {
    orderNo,
    customerName: customerNameLine?.replace(/(?:様|さん)$/, "").trim() ?? "",
    customerNote: extractCustomerNote(lines, orderNo),
    orderedAt: parseOrderedAt(lines, capturedAt),
    status,
    orderType: "delivery",
    items,
    total,
    completeness: (items.length * 100) + (modifierCount * 10) + (total > 0 ? 5 : 0) + 2
  };
}

export function toRocketNowBridgeOperationalItem(
  item: RocketNowBridgeItem
): UberBridgeOperationalItem {
  const toppingLabels = item.modifiers.flatMap((modifier) => (
    Array.from({ length: Math.max(1, modifier.quantity) }, () => sourceLabel(modifier.name))
  ));
  const isMaamaa = /マーラータン|麻辣[烫湯燙]/.test(item.name)
    || item.modifiers.some((modifier) => /辛さ|痺れ|薬膳|麺/.test(modifier.name));
  return {
    itemName: sourceLabel(item.name),
    quantity: Math.max(1, Math.round(item.quantity)),
    amount: Math.max(0, Math.round(item.lineTotal)),
    sizeKey: isMaamaa ? "maamaa_buildable" : "",
    optionLabel: toppingLabels.join(", "),
    toppingLabels
  };
}
