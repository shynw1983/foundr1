export type SalesCsvOrder = {
  sourceExternalId: string;
  orderNo: string;
  storeName: string;
  orderedAt: Date;
  subtotal: number;
  tax: number;
  discount: number;
  adjustment: number;
  total: number;
  rowCount: number;
  rawRows: Record<string, string>[];
};

export type SalesCsvParseResult = {
  orders: SalesCsvOrder[];
  rawRows: Array<{
    rowIndex: number;
    sourceExternalId: string | null;
    orderNo: string | null;
    orderedAt: Date | null;
    raw: Record<string, string>;
  }>;
  skippedRowCount: number;
  detectedMonth: string | null;
};

export type UberCsvOrder = SalesCsvOrder;
export type UberCsvParseResult = SalesCsvParseResult;

export class SalesCsvParserUpdateRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesCsvParserUpdateRequiredError";
  }
}

const uberHeaderKeys = {
  orderNo: "注文 ID",
  workflowId: "ワークフロー ID",
  storeName: "店舗名",
  orderDate: "注文日付",
  acceptedTime: "注文の受付時間",
  subtotal: "売上（消費税を除く）",
  tax: "売上に対する消費税の合計額",
  total: "売上（消費税を含む）",
  adjustment: "注文エラーの調整額（消費税を含む）",
  discount: "商品のオファー（消費税を含む）"
};

const smaregiHeaderKeys = {
  transactionId: "取引ID",
  tradedAt: "取引日時",
  cancelFlag: "取消区分 (0:通常、1：取消)",
  total: "合計",
  tax: "内消費税",
  quantityTotal: "数量合計",
  returnedQuantityTotal: "返品数量合計"
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function findHeaderRow(rows: string[][]) {
  return rows.findIndex((row) => {
    const normalized = new Set(row.map(normalizeHeader));
    return normalized.has(normalizeHeader(uberHeaderKeys.orderNo))
      && normalized.has(normalizeHeader(uberHeaderKeys.workflowId))
      && normalized.has(normalizeHeader(uberHeaderKeys.orderDate));
  });
}

function findSmaregiHeaderRow(rows: string[][]) {
  return rows.findIndex((row) => {
    const normalized = new Set(row.map(normalizeHeader));
    return normalized.has(normalizeHeader(smaregiHeaderKeys.transactionId))
      && normalized.has(normalizeHeader(smaregiHeaderKeys.tradedAt))
      && normalized.has(normalizeHeader(smaregiHeaderKeys.total));
  });
}

function getHeaderDiagnostics(rows: string[][]) {
  const firstRows = rows.slice(0, 5).map((row) => row.map((cell) => cell.trim()).filter(Boolean));
  const flatCells = firstRows.flat();
  const matchedRequiredHeaders = Object.values(uberHeaderKeys).filter((header) => (
    flatCells.some((cell) => normalizeHeader(cell) === normalizeHeader(header))
  ));

  return {
    rowCount: rows.length,
    matchedRequiredHeaders,
    previewHeaders: firstRows.find((row) => row.length > 3)?.slice(0, 12) ?? []
  };
}

function getValue(row: Record<string, string>, key: string) {
  return row[key] ?? row[Object.keys(row).find((candidate) => normalizeHeader(candidate) === normalizeHeader(key)) ?? ""] ?? "";
}

function parseMoney(value: string) {
  const normalized = value.replace(/[,\s￥¥]/g, "");
  if (!normalized) return 0;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
}

function parseUberDateTime(dateValue: string, timeValue: string) {
  const dateMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(dateValue.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim());
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+09:00`
  );
}

function parseSmaregiDateTime(value: string) {
  const dateTimeMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!dateTimeMatch) return null;

  const [, year, month, day, hour, minute, second = "00"] = dateTimeMatch;
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}+09:00`
  );
}

function getJstMonth(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

export function parseUberSalesCsv(text: string): UberCsvParseResult {
  const csvRows = parseCsv(text);
  const headerIndex = findHeaderRow(csvRows);
  if (headerIndex < 0) {
    const diagnostics = getHeaderDiagnostics(csvRows);
    throw new SalesCsvParserUpdateRequiredError(
      `このCSV形式は現在のUber Eats解析器では読み取れません。解析器の更新が必要です。（一致した項目: ${diagnostics.matchedRequiredHeaders.length}件 / 行数: ${diagnostics.rowCount}）`
    );
  }

  const headers = csvRows[headerIndex].map((header) => header.trim());
  const rows = csvRows.slice(headerIndex + 1);
  const groupedOrders = new Map<string, UberCsvOrder>();
  const rawRows: UberCsvParseResult["rawRows"] = [];
  let skippedRowCount = 0;

  rows.forEach((cells, index) => {
    const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const sourceExternalId = getValue(raw, uberHeaderKeys.workflowId).trim();
    const orderNo = getValue(raw, uberHeaderKeys.orderNo).trim();
    const orderedAt = parseUberDateTime(getValue(raw, uberHeaderKeys.orderDate), getValue(raw, uberHeaderKeys.acceptedTime));
    rawRows.push({
      rowIndex: index + 1,
      sourceExternalId: sourceExternalId || null,
      orderNo: orderNo || null,
      orderedAt,
      raw
    });

    if (!sourceExternalId || !orderNo || !orderedAt) {
      skippedRowCount += 1;
      return;
    }

    const subtotal = parseMoney(getValue(raw, uberHeaderKeys.subtotal));
    const tax = parseMoney(getValue(raw, uberHeaderKeys.tax));
    const total = parseMoney(getValue(raw, uberHeaderKeys.total));
    const discount = parseMoney(getValue(raw, uberHeaderKeys.discount));
    const adjustment = parseMoney(getValue(raw, uberHeaderKeys.adjustment));
    const existing = groupedOrders.get(sourceExternalId);

    if (existing) {
      existing.subtotal += subtotal;
      existing.tax += tax;
      existing.discount += discount;
      existing.adjustment += adjustment;
      existing.total += total + adjustment;
      existing.rowCount += 1;
      existing.rawRows.push(raw);
      if (orderedAt < existing.orderedAt) existing.orderedAt = orderedAt;
      return;
    }

    groupedOrders.set(sourceExternalId, {
      sourceExternalId,
      orderNo,
      storeName: getValue(raw, uberHeaderKeys.storeName).trim(),
      orderedAt,
      subtotal,
      tax,
      discount,
      adjustment,
      total: total + adjustment,
      rowCount: 1,
      rawRows: [raw]
    });
  });

  const orders = Array.from(groupedOrders.values()).sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime());
  if (orders.length === 0 && rawRows.length > 0) {
    throw new SalesCsvParserUpdateRequiredError(
      "Uber Eats CSVのヘッダーは検出できましたが、注文ID・注文日付・受付時間を正しく解析できませんでした。CSV形式が変わっている可能性があるため、解析器の更新が必要です。"
    );
  }

  const monthCounts = new Map<string, number>();
  for (const order of orders) {
    const month = getJstMonth(order.orderedAt);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  const detectedMonth = Array.from(monthCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    orders,
    rawRows,
    skippedRowCount,
    detectedMonth
  };
}

export function parseSmaregiSalesCsv(text: string): SalesCsvParseResult {
  const csvRows = parseCsv(text);
  const headerIndex = findSmaregiHeaderRow(csvRows);
  if (headerIndex < 0) {
    throw new SalesCsvParserUpdateRequiredError(
      `このCSV形式は現在のSmaregi解析器では読み取れません。解析器の更新が必要です。（行数: ${csvRows.length}）`
    );
  }

  const headers = csvRows[headerIndex].map((header) => header.trim());
  const rows = csvRows.slice(headerIndex + 1);
  const groupedOrders = new Map<string, SalesCsvOrder>();
  const rawRows: SalesCsvParseResult["rawRows"] = [];
  let skippedRowCount = 0;

  rows.forEach((cells, index) => {
    const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const transactionId = getValue(raw, smaregiHeaderKeys.transactionId).trim();
    const cancelFlag = getValue(raw, smaregiHeaderKeys.cancelFlag).trim();
    const orderedAt = parseSmaregiDateTime(getValue(raw, smaregiHeaderKeys.tradedAt));
    const sourceExternalId = transactionId ? `smaregi:${transactionId}` : "";
    rawRows.push({
      rowIndex: index + 1,
      sourceExternalId: sourceExternalId || null,
      orderNo: transactionId || null,
      orderedAt,
      raw
    });

    if (!transactionId || !orderedAt || cancelFlag === "1") {
      skippedRowCount += 1;
      return;
    }
    if (groupedOrders.has(sourceExternalId)) {
      const existing = groupedOrders.get(sourceExternalId);
      if (existing) {
        existing.rowCount += 1;
        existing.rawRows.push(raw);
      }
      return;
    }

    const total = parseMoney(getValue(raw, smaregiHeaderKeys.total));
    const tax = parseMoney(getValue(raw, smaregiHeaderKeys.tax));
    groupedOrders.set(sourceExternalId, {
      sourceExternalId,
      orderNo: transactionId,
      storeName: "",
      orderedAt,
      subtotal: Math.max(0, total - tax),
      tax,
      discount: 0,
      adjustment: 0,
      total,
      rowCount: 1,
      rawRows: [raw]
    });
  });

  const orders = Array.from(groupedOrders.values()).sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime());
  if (orders.length === 0 && rawRows.length > 0) {
    throw new SalesCsvParserUpdateRequiredError(
      "Smaregi CSVのヘッダーは検出できましたが、取引ID・取引日時・合計を正しく解析できませんでした。CSV形式が変わっている可能性があるため、解析器の更新が必要です。"
    );
  }

  const monthCounts = new Map<string, number>();
  for (const order of orders) {
    const month = getJstMonth(order.orderedAt);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  const detectedMonth = Array.from(monthCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    orders,
    rawRows,
    skippedRowCount,
    detectedMonth
  };
}
