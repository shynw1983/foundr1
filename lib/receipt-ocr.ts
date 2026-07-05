import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { recordExternalServiceUsage } from "./external-service-usage";
import { buildSupplierDisplayName, resolveReceiptSupplierLink } from "./supplier-ocr-linking";
import sharp from "sharp";

export type ReceiptOcrItem = {
  name: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  taxRate: string;
  taxMode: string;
  category: string;
  accountTitle: string;
  amount: number | null;
};

export type ReceiptOcrResult = {
  documentType: string;
  financialPurpose: string;
  storeName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  purchaseDate: string;
  purchaseTime: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: ReceiptOcrItem[];
};

export type ReceiptOcrSource = {
  sourceType: "procurement" | "expense" | "voucher";
  sourceId?: string;
  storeId?: string;
  supplierName?: string;
  receiptPhotoUrl: string;
  uploadedFileName?: string;
  usageType?: "unclassified" | "shiire" | "keihi";
  paymentType?: "company" | "reimbursement";
  createProductCandidates?: boolean;
};

const receiptOcrSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: "string", description: "One of レシート, 領収書, 請求書, 納品書, 納付書, 振込明細, カード明細, 銀行明細, 給与社保資料, その他" },
    financialPurpose: { type: "string", description: "One of 仕入, 経費, 租税公課, 給与関連, 固定資産, 売上関連, 立替返金, 未分類" },
    storeName: { type: "string" },
    companyName: { type: "string", description: "Legal company or operating company name when visible, otherwise empty string" },
    brandName: { type: "string", description: "Retail chain, supermarket, restaurant, gas station, or public-facing brand name when visible, otherwise empty string" },
    locationName: { type: "string", description: "Store, branch, gas station, or location name when visible, otherwise empty string" },
    purchaseDate: { type: "string", description: "YYYY-MM-DD when visible, otherwise empty string" },
    purchaseTime: { type: "string", description: "HH:mm when visible, otherwise empty string" },
    subtotal: nullableNumberSchema(),
    tax: nullableNumberSchema(),
    total: nullableNumberSchema(),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: nullableNumberSchema(),
          unit: { type: "string" },
          unitPrice: nullableNumberSchema(),
          taxRate: { type: "string" },
          taxMode: { type: "string", description: "内税, 外税, 対象外, or 不明" },
          category: { type: "string" },
          accountTitle: { type: "string" },
          amount: nullableNumberSchema()
        },
        required: ["name", "quantity", "unit", "unitPrice", "taxRate", "taxMode", "category", "accountTitle", "amount"]
      }
    }
  },
  required: ["documentType", "financialPurpose", "storeName", "companyName", "brandName", "locationName", "purchaseDate", "purchaseTime", "subtotal", "tax", "total", "items"]
};

const receiptOcrBatchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    receipts: {
      type: "array",
      description: "Every independent accounting voucher or receipt visible in the uploaded scan. Return one item when only one document is visible.",
      items: receiptOcrSchema
    }
  },
  required: ["receipts"]
};

function nullableNumberSchema() {
  return {
    anyOf: [
      { type: "number" },
      { type: "null" }
    ]
  };
}

export function normalizeReceiptProductName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}（）【】「」『』]/g, " ")
    .replace(/[¥￥,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeReceiptImage(file: File): Promise<{ result: ReceiptOcrResult; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません。");

  const model = process.env.OPENAI_RECEIPT_OCR_MODEL || "gpt-4.1-mini";
  const fileInput = await buildReceiptFileInput(file);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract Japanese accounting voucher data for a restaurant-focused backoffice system.",
                "Return JSON only and follow the schema exactly.",
                "Use visible receipt text only. Do not invent missing values.",
                "First classify the document from an accounting point of view, then apply restaurant-specific optimization only when it is a food-service purchase.",
                "For documentType, choose one of: レシート, 領収書, 請求書, 納品書, 納付書, 振込明細, カード明細, 銀行明細, 給与社保資料, その他.",
                "For financialPurpose, choose one of: 仕入, 経費, 租税公課, 給与関連, 固定資産, 売上関連, 立替返金, 未分類.",
                "Use documentType 納付書 and financialPurpose 租税公課 for tax payment slips, tax office/local government payment receipts, 納税, 申告所得税, 法人税, 消費税, 源泉所得税, 住民税, 固定資産税, 自動車税, 印紙税, 延滞税, 加算税, or public dues.",
                "Use financialPurpose 給与関連 for payroll, salary, social insurance, labor insurance, pension, health insurance, unemployment insurance, withholding tax payroll materials, and staff-related statutory payments.",
                "Use financialPurpose 固定資産 for durable equipment or high-value assets that may require capitalization instead of ordinary expense treatment.",
                "Use financialPurpose 仕入 only for goods bought for resale/menu production or restaurant operation inventory such as ingredients, packaging, and consumables.",
                "Separate companyName, brandName, and locationName when receipts show legal/operating company, public chain brand, and branch/store/site name.",
                "For example, if the receipt shows 相光石油株式会社 and セルフステーション平尾, set companyName to 相光石油株式会社, brandName to empty string, and locationName to セルフステーション平尾.",
                "For example, if the receipt shows 株式会社G-7スーパーマート, 業務スーパー, and 春吉店, set companyName to 株式会社G-7スーパーマート, brandName to 業務スーパー, and locationName to 春吉店.",
                "Set storeName to the best human-readable combined display name, usually brandName + locationName when brandName is visible, otherwise companyName + locationName.",
                "Ignore payment method lines, subtotal labels, discounts, and points as items.",
                "Do not ignore tax payment rows on 納付書, 領収済通知書, tax office payment receipts, or public dues documents. For those documents, create an item for the paid tax/public due amount.",
                "Treat each purchased product, service, fee, or expense row as a separate item. Do not merge different visible rows even when they share the same category, accountTitle, taxRate, or taxMode.",
                "If one item wraps across multiple printed lines, combine only those wrapped lines into one item. Preserve quantity, unit price, and amount from the same printed item.",
                "For PDFs that contain multiple independent receipts, still extract item rows separately for each receipt page instead of summarizing by receipt or by category.",
                "For item category, choose one of: 食材, 包材, 消耗品, 清掃用品, 設備, 税金, 給与社保, 家賃, 水道光熱, 通信, 広告, 交通, 車両, 保険, 手数料, 研修, 雑費, 未分類.",
                "For accountTitle, choose one Japanese accounting account from: 仕入高, 租税公課, 荷造運賃, 水道光熱費, 旅費交通費, 通信費, 広告宣伝費, 接待交際費, 損害保険料, 保険料, 修繕費, 消耗品費, 事務用品費, 減価償却費, 福利厚生費, 法定福利費, 給料賃金, 外注工賃, 支払報酬料, 利子割引料, 地代家賃, 貸倒金, 支払手数料, 車両費, リース料, 新聞図書費, 図書研修費, 研修採用費, 会議費, 諸会費, 衛生管理費, 雑費.",
                "Use 租税公課 for tax payments and public charges. These items are not restaurant product master items.",
                "Use 法定福利費 for social insurance, labor insurance, pension, health insurance, and employer statutory benefit payments.",
                "Use 給料賃金 for payroll and wage payments.",
                "Use 地代家賃 for rent, lease of premises, common area charges, and property management charges.",
                "Use 水道光熱費 for electricity, gas, water, utility bills, and similar store utilities.",
                "Use 通信費 for phone, internet, cloud subscriptions, and communication services.",
                "Use 支払報酬料 for professional fees such as tax accountant, lawyer, consultant, designer, or outsourced expert fees.",
                "Use 車両費 for gasoline, parking, tolls, vehicle maintenance, car-related purchases, and fuel station receipts when business vehicle use is likely.",
                "Use 旅費交通費 for trains, buses, taxis, business travel fares, and non-vehicle transportation.",
                "Use 消耗品費 for store supplies, stationery, packaging materials, small equipment under normal expense treatment, and daily-use consumables.",
                "Use 衛生管理費 for cleaning supplies, sanitation, pest control, waste disposal, and hygiene-related restaurant expenses.",
                "Use 支払手数料 for payment, banking, platform, delivery app, or transfer fees.",
                "Use 雑費 only when no other listed account clearly fits.",
                "For restaurant purchases, use 食材, 包材, 消耗品, 清掃用品, or 設備 categories to support product master matching. For non-purchase accounting documents such as taxes, payroll, rent, utilities, bank fees, or insurance, use the accounting-oriented category instead of forcing 食材 or 包材.",
                "Use YYYY-MM-DD for purchaseDate when the date is visible.",
                "Use HH:mm for purchaseTime when the time is visible.",
                "For each item taxRate, preserve visible 8% or 10% markers when present. Use 対象外 for tax payments, public dues, payroll, and other transactions outside Japanese consumption tax. Use 非課税 or 不課税 only when explicitly indicated.",
                "On Japanese supermarket receipts, a leading or adjacent ※ next to an item name often marks reduced consumption tax. Treat visible ※ as a strong hint that the item is 8% reduced tax, but not an absolute rule; if visible tax summaries, explicit 10% markers, or other receipt tax labels clearly contradict it, follow the clearer visible tax information.",
                "When a receipt prints quantity and unit price under an item, such as (数量 × 単価), (3 × 468), or 3点 × 468, that quantity/unit-price line belongs to the item immediately above it, not to the next item.",
                "For each item taxMode, use 内税 if tax is included in the displayed amount, 外税 if tax is added separately, 対象外 for tax payments/public dues/payroll/out-of-scope transactions, otherwise 不明."
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: fileInput.kind === "pdf" ? "Read every page of this receipt PDF and extract one combined receipt JSON. If the PDF has multiple pages of the same receipt, merge the visible information without duplicating totals." : "Read this receipt and extract store, date, totals, tax, and line items as JSON." },
            fileInput.content
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_ocr_result",
          strict: true,
          schema: receiptOcrSchema
        }
      },
      max_output_tokens: 5000
    })
  });

  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  if (!response.ok) throw new Error(body.error?.message || "レシート OCR に失敗しました。");

  const content = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((contentItem) => contentItem.text ?? "").join("\n").trim()
    ?? "";
  const parsed = JSON.parse(content) as ReceiptOcrResult;

  await recordExternalServiceUsage({
    serviceKey: "openai",
    metricKey: "tokens",
    quantity: Number(body.usage?.total_tokens ?? 0),
    unit: "tokens",
    source: "receipt_ocr",
    metadata: {
      model,
      inputTokens: body.usage?.input_tokens ?? null,
      outputTokens: body.usage?.output_tokens ?? null
    }
  });

  return { result: normalizeReceiptOcrResult(parsed), model };
}

export async function analyzeReceiptDocuments(file: File): Promise<{ results: ReceiptOcrResult[]; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません。");

  const model = process.env.OPENAI_RECEIPT_OCR_MODEL || "gpt-4.1-mini";
  const fileInput = await buildReceiptFileInput(file);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract Japanese accounting voucher data for a restaurant-focused backoffice system.",
                "Return JSON only and follow the schema exactly.",
                "Use visible receipt text only. Do not invent missing values.",
                "The uploaded file may be an A4 scanner page that contains multiple independent receipts, invoices, tax slips, or vouchers.",
                "Detect every independent document visible in the scan and return one receipts[] object for each document.",
                "If there is only one document, return receipts with exactly one object.",
                "Do not merge separate receipts into one result. Keep each receipt's store, date, totals, tax, and items independent.",
                "Do not split one long receipt into multiple receipts just because it wraps, folds, or continues across the same paper.",
                "For documentType, choose one of: レシート, 領収書, 請求書, 納品書, 納付書, 振込明細, カード明細, 銀行明細, 給与社保資料, その他.",
                "For financialPurpose, choose one of: 仕入, 経費, 租税公課, 給与関連, 固定資産, 売上関連, 立替返金, 未分類.",
                "Use financialPurpose 仕入 only for goods bought for resale/menu production or restaurant operation inventory such as ingredients, packaging, and consumables.",
                "Use documentType 納付書 and financialPurpose 租税公課 for tax payment slips, tax office/local government payment receipts, 納税, 消費税, 法人税, 源泉所得税, 住民税, 固定資産税, 自動車税, or public dues.",
                "Use financialPurpose 給与関連 for payroll, salary, social insurance, labor insurance, pension, health insurance, unemployment insurance, and staff-related statutory payments.",
                "Separate companyName, brandName, and locationName when receipts show legal/operating company, public chain brand, and branch/store/site name.",
                "Set storeName to the best human-readable combined display name, usually brandName + locationName when brandName is visible, otherwise companyName + locationName.",
                "Ignore payment method lines, subtotal labels, discounts, and points as items.",
                "Treat each purchased product, service, fee, or expense row as a separate item. Do not merge different visible rows even when they share the same category, accountTitle, taxRate, or taxMode.",
                "If one item wraps across multiple printed lines, combine only those wrapped lines into one item. Preserve quantity, unit price, and amount from the same printed item.",
                "For item category, choose one of: 食材, 包材, 消耗品, 清掃用品, 設備, 税金, 給与社保, 家賃, 水道光熱, 通信, 広告, 交通, 車両, 保険, 手数料, 研修, 雑費, 未分類.",
                "For accountTitle, choose one Japanese accounting account from: 仕入高, 租税公課, 荷造運賃, 水道光熱費, 旅費交通費, 通信費, 広告宣伝費, 接待交際費, 損害保険料, 保険料, 修繕費, 消耗品費, 事務用品費, 減価償却費, 福利厚生費, 法定福利費, 給料賃金, 外注工賃, 支払報酬料, 利子割引料, 地代家賃, 貸倒金, 支払手数料, 車両費, リース料, 新聞図書費, 図書研修費, 研修採用費, 会議費, 諸会費, 衛生管理費, 雑費.",
                "Use YYYY-MM-DD for purchaseDate and HH:mm for purchaseTime when visible.",
                "For each item taxRate, preserve visible 8% or 10% markers when present. Use 対象外 for tax payments, public dues, payroll, and other transactions outside Japanese consumption tax.",
                "For each item taxMode, use 内税 if tax is included in the displayed amount, 外税 if tax is added separately, 対象外 for tax payments/public dues/payroll/out-of-scope transactions, otherwise 不明."
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: fileInput.kind === "pdf" ? "Read this scanned PDF page and extract every independent receipt or voucher visible on the page as separate receipts[] entries." : "Read this scanned image and extract every independent receipt or voucher visible on the page as separate receipts[] entries." },
            fileInput.content
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_ocr_batch_result",
          strict: true,
          schema: receiptOcrBatchSchema
        }
      },
      max_output_tokens: 9000
    })
  });

  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  if (!response.ok) throw new Error(body.error?.message || "レシート OCR に失敗しました。");

  const content = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((contentItem) => contentItem.text ?? "").join("\n").trim()
    ?? "";
  const parsed = JSON.parse(content) as { receipts?: ReceiptOcrResult[] };
  const results = Array.isArray(parsed.receipts) ? parsed.receipts.map(normalizeReceiptOcrResult) : [];

  await recordExternalServiceUsage({
    serviceKey: "openai",
    metricKey: "tokens",
    quantity: Number(body.usage?.total_tokens ?? 0),
    unit: "tokens",
    source: "receipt_ocr",
    metadata: {
      model,
      inputTokens: body.usage?.input_tokens ?? null,
      outputTokens: body.usage?.output_tokens ?? null,
      batch: true,
      receiptCount: results.length
    }
  });

  if (!results.length) throw new Error("レシートを読み取れませんでした。1枚ずつ見えるようにスキャンしてください。");
  return { results, model };
}

export async function splitReceiptScanFile(file: File): Promise<File[]> {
  const mimeType = getReceiptMimeType(file);
  if (mimeType === "application/pdf" || !mimeType.startsWith("image/")) return [file];

  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight) return [file];

  const maxAnalysisEdge = 1600;
  const scale = Math.min(1, maxAnalysisEdge / Math.max(sourceWidth, sourceHeight));
  const analysis = image.clone().resize({
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    fit: "fill"
  });
  const { data, info } = await analysis.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const boxes = detectReceiptInkRegions(Buffer.from(data), info.width, info.height)
    .map((box) => scaleRegion(box, 1 / scale, sourceWidth, sourceHeight))
    .sort((first, second) => first.top - second.top || first.left - second.left);

  if (!boxes.length) return [file];
  const imageArea = sourceWidth * sourceHeight;
  const shouldCropSingle = boxes.length === 1 && boxes[0].width * boxes[0].height < imageArea * 0.88;
  if (boxes.length === 1 && !shouldCropSingle) return [file];

  const baseName = sanitizeReceiptFilename((file.name || "receipt").replace(/\.[^.]+$/, ""), "receipt");
  const crops: File[] = [];
  for (let index = 0; index < Math.min(boxes.length, 12); index += 1) {
    const box = boxes[index];
    const buffer = await image.clone().extract(box).png({ compressionLevel: 6 }).toBuffer();
    crops.push(new File([buffer], `${baseName}-crop-${String(index + 1).padStart(2, "0")}.png`, { type: "image/png" }));
  }
  return crops.length ? crops : [file];
}

async function buildReceiptFileInput(file: File): Promise<{
  kind: "image" | "pdf";
  content:
    | { type: "input_image"; image_url: string; detail: "high" }
    | { type: "input_file"; filename: string; file_data: string };
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = getReceiptMimeType(file);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  if (mimeType === "application/pdf") {
    return {
      kind: "pdf",
      content: {
        type: "input_file",
        filename: sanitizeReceiptFilename(file.name || "receipt.pdf", "receipt.pdf"),
        file_data: dataUrl
      }
    };
  }
  return {
    kind: "image",
    content: {
      type: "input_image",
      image_url: dataUrl,
      detail: "high"
    }
  };
}

function detectReceiptInkRegions(raw: Buffer, width: number, height: number): sharp.Region[] {
  const darkMask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    const red = raw[offset] ?? 255;
    const green = raw[offset + 1] ?? 255;
    const blue = raw[offset + 2] ?? 255;
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    if (luminance < 214) darkMask[index] = 1;
  }

  const block = Math.max(10, Math.round(Math.min(width, height) / 90));
  const gridWidth = Math.ceil(width / block);
  const gridHeight = Math.ceil(height / block);
  const grid = new Uint8Array(gridWidth * gridHeight);
  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const left = gx * block;
      const top = gy * block;
      const right = Math.min(width, left + block);
      const bottom = Math.min(height, top + block);
      let dark = 0;
      for (let y = top; y < bottom; y += 1) {
        const rowOffset = y * width;
        for (let x = left; x < right; x += 1) dark += darkMask[rowOffset + x] ?? 0;
      }
      if (dark >= Math.max(2, Math.round((right - left) * (bottom - top) * 0.012))) {
        grid[gy * gridWidth + gx] = 1;
      }
    }
  }

  const dilated = dilateGrid(grid, gridWidth, gridHeight, Math.max(2, Math.round(Math.min(gridWidth, gridHeight) / 34)));
  const boxes = connectedGridBoxes(dilated, gridWidth, gridHeight, block, width, height);
  return mergeNearbyReceiptBoxes(boxes, width, height)
    .filter((box) => box.width >= width * 0.12 && box.height >= height * 0.12)
    .filter((box) => box.width * box.height >= width * height * 0.025)
    .slice(0, 12);
}

function dilateGrid(grid: Uint8Array, width: number, height: number, radius: number) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!grid[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          output[ny * width + nx] = 1;
        }
      }
    }
  }
  return output;
}

function connectedGridBoxes(grid: Uint8Array, gridWidth: number, gridHeight: number, block: number, imageWidth: number, imageHeight: number) {
  const visited = new Uint8Array(grid.length);
  const boxes: sharp.Region[] = [];
  for (let start = 0; start < grid.length; start += 1) {
    if (!grid[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let minX = start % gridWidth;
    let maxX = minX;
    let minY = Math.floor(start / gridWidth);
    let maxY = minY;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const x = current % gridWidth;
      const y = Math.floor(current / gridWidth);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of receiptGridNeighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
        const next = ny * gridWidth + nx;
        if (!grid[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    const padding = Math.max(block * 2, Math.round(Math.min(imageWidth, imageHeight) * 0.018));
    const left = Math.max(0, minX * block - padding);
    const top = Math.max(0, minY * block - padding);
    const right = Math.min(imageWidth, (maxX + 1) * block + padding);
    const bottom = Math.min(imageHeight, (maxY + 1) * block + padding);
    boxes.push({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) });
  }
  return boxes;
}

function mergeNearbyReceiptBoxes(boxes: sharp.Region[], imageWidth: number, imageHeight: number) {
  const merged: sharp.Region[] = [];
  for (const box of boxes.sort((first, second) => first.top - second.top || first.left - second.left)) {
    const existing = merged.find((candidate) => shouldMergeReceiptBoxes(candidate, box, imageWidth, imageHeight));
    if (!existing) {
      merged.push({ ...box });
      continue;
    }
    const left = Math.min(existing.left, box.left);
    const top = Math.min(existing.top, box.top);
    const right = Math.max(existing.left + existing.width, box.left + box.width);
    const bottom = Math.max(existing.top + existing.height, box.top + box.height);
    existing.left = left;
    existing.top = top;
    existing.width = right - left;
    existing.height = bottom - top;
  }
  return merged;
}

function shouldMergeReceiptBoxes(first: sharp.Region, second: sharp.Region, imageWidth: number, imageHeight: number) {
  const horizontalGap = Math.max(0, Math.max(first.left, second.left) - Math.min(first.left + first.width, second.left + second.width));
  const verticalGap = Math.max(0, Math.max(first.top, second.top) - Math.min(first.top + first.height, second.top + second.height));
  const horizontalOverlap = Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left);
  const verticalOverlap = Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top);
  const maxGap = Math.max(18, Math.round(Math.min(imageWidth, imageHeight) * 0.025));
  if (horizontalGap <= maxGap && verticalOverlap > Math.min(first.height, second.height) * 0.25) return true;
  if (verticalGap <= maxGap && horizontalOverlap > Math.min(first.width, second.width) * 0.25) return true;
  return false;
}

function scaleRegion(region: sharp.Region, scale: number, imageWidth: number, imageHeight: number): sharp.Region {
  const left = Math.max(0, Math.floor(region.left * scale));
  const top = Math.max(0, Math.floor(region.top * scale));
  const right = Math.min(imageWidth, Math.ceil((region.left + region.width) * scale));
  const bottom = Math.min(imageHeight, Math.ceil((region.top + region.height) * scale));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

const receiptGridNeighbors = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
] as const;

function getReceiptMimeType(file: File) {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  return type || "image/jpeg";
}

function sanitizeReceiptFilename(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function saveReceiptOcrResult(source: ReceiptOcrSource, result: ReceiptOcrResult | null, model: string, session: EmployeeSession, errorMessage = "") {
  const vendorName = result ? buildSupplierDisplayName({
    vendorName: result.storeName || source.supplierName || "",
    companyName: result.companyName || "",
    brandName: result.brandName || "",
    locationName: result.locationName || ""
  }) : source.supplierName || "";
  const supplierLink = result && !errorMessage ? await resolveReceiptSupplierLink({
    vendorName,
    companyName: result.companyName || "",
    brandName: result.brandName || "",
    locationName: result.locationName || ""
  }) : { supplierId: "", supplierLocationId: "", matchStatus: "unmatched" };
  const rows = await sql`
    insert into receipt_ocr_results (
      source_type,
      source_id,
      store_id,
      supplier_id,
      supplier_location_id,
      supplier_match_status,
      supplier_name,
      receipt_photo_url,
      uploaded_file_name,
      usage_type,
      payment_type,
      reimbursement_status,
      status,
      model,
      raw_result,
      vendor_name,
      company_name,
      brand_name,
      location_name,
      purchase_date,
      purchase_time,
      subtotal,
      tax,
      total,
      error_message,
      created_by,
      updated_at
    )
    values (
      ${source.sourceType},
      ${source.sourceId || null},
      ${source.storeId || null},
      ${supplierLink.supplierId || null},
      ${supplierLink.supplierLocationId || null},
      ${supplierLink.matchStatus},
      ${source.supplierName || ""},
      ${source.receiptPhotoUrl},
      ${source.uploadedFileName || ""},
      ${source.usageType ?? (source.sourceType === "procurement" ? "shiire" : source.sourceType === "expense" ? "keihi" : "unclassified")},
      ${source.paymentType || "company"},
      ${source.paymentType === "reimbursement" ? "pending" : "none"},
      ${errorMessage ? "failed" : "draft"},
      ${model},
      ${JSON.stringify(result ?? {})}::jsonb,
      ${vendorName},
      ${result?.companyName || ""},
      ${result?.brandName || ""},
      ${result?.locationName || ""},
      ${coerceDate(result?.purchaseDate) || null},
      ${coerceTime(result?.purchaseTime) || null},
      ${result?.subtotal ?? null},
      ${result?.tax ?? null},
      ${result?.total ?? null},
      ${errorMessage},
      ${session.id},
      now()
    )
    returning id::text
  `;
  const ocrResultId = String(rows[0]?.id ?? "");
  if (ocrResultId && result && !errorMessage) {
    await saveReceiptOcrItems(ocrResultId, result.items, source.supplierName || result.storeName, session, Boolean(source.createProductCandidates));
  }
  return ocrResultId;
}

export async function createProductCandidatesForOcrResult(ocrResultId: string, session: EmployeeSession) {
  const resultRows = await sql`
    select
      coalesce(supplier_name, '') as "supplierName",
      coalesce(vendor_name, '') as "vendorName"
    from receipt_ocr_results
    where id::text = ${ocrResultId}
    limit 1
  `;
  const result = resultRows[0];
  if (!result) return;

  const supplierName = String(result.supplierName || result.vendorName || "").trim();
  const itemRows = await sql`
    select
      id::text,
      raw_name as "rawName",
      normalized_name as "normalizedName",
      quantity::float,
      unit,
      unit_price::float as "unitPrice",
      tax_rate as "taxRate",
      tax_mode as "taxMode",
      category,
      account_title as "accountTitle",
      amount::float,
      match_status as "matchStatus"
    from receipt_ocr_items
    where receipt_ocr_result_id::text = ${ocrResultId}
      and match_status in ('not_applicable', 'unmatched')
    order by line_index
  `;

  for (const row of itemRows) {
    const rawName = String(row.rawName ?? "").trim();
    if (!rawName) continue;
    const normalizedName = String(row.normalizedName || normalizeReceiptProductName(rawName));
    const match = await findProductMatch(supplierName, normalizedName);
    if (match.productId) {
      await sql`
        update receipt_ocr_items
        set matched_product_id = ${match.productId}, match_status = 'matched', updated_at = now()
        where id::text = ${String(row.id)}
      `;
      await recordReceiptItemPrice(String(row.id), String(match.productId), session.id);
      continue;
    }

    await sql`
      update receipt_ocr_items
      set match_status = 'unmatched', updated_at = now()
      where id::text = ${String(row.id)}
    `;
    await createProductCandidate(String(row.id), {
      name: rawName,
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      unit: String(row.unit ?? ""),
      unitPrice: row.unitPrice === null || row.unitPrice === undefined ? null : Number(row.unitPrice),
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      category: String(row.category ?? ""),
      accountTitle: String(row.accountTitle ?? ""),
      amount: row.amount === null || row.amount === undefined ? null : Number(row.amount)
    }, normalizedName, supplierName, session);
  }
}

async function saveReceiptOcrItems(ocrResultId: string, items: ReceiptOcrItem[], supplierName: string, session: EmployeeSession, createProductCandidates: boolean) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const rawName = String(item.name ?? "").trim();
    if (!rawName) continue;
    const normalizedName = normalizeReceiptProductName(rawName);
    const match = createProductCandidates ? await findProductMatch(supplierName, normalizedName) : { productId: "" };
    const itemRows = await sql`
      insert into receipt_ocr_items (
        receipt_ocr_result_id,
        line_index,
        raw_name,
        normalized_name,
        quantity,
        unit,
        unit_price,
        tax_rate,
        tax_mode,
        category,
        account_title,
        amount,
        matched_product_id,
        match_status,
        updated_at
      )
      values (
        ${ocrResultId},
        ${index},
        ${rawName},
        ${normalizedName},
        ${item.quantity ?? null},
        ${item.unit || ""},
        ${item.unitPrice ?? null},
        ${item.taxRate || ""},
        ${item.taxMode || ""},
        ${item.category || ""},
        ${item.accountTitle || ""},
        ${item.amount ?? null},
        ${match.productId || null},
        ${createProductCandidates ? match.productId ? "matched" : "unmatched" : "not_applicable"},
        now()
      )
      returning id::text
    `;
    if (createProductCandidates && !match.productId) {
      await createProductCandidate(String(itemRows[0]?.id ?? ""), item, normalizedName, supplierName, session);
    } else if (createProductCandidates && match.productId) {
      await recordReceiptItemPrice(String(itemRows[0]?.id ?? ""), String(match.productId), session.id);
    }
  }
}

export async function recordReceiptItemPrice(
  itemId: string,
  productId: string,
  employeeId: string,
  override?: { price?: number; unit?: string }
) {
  if (!itemId || !productId) return;

  const rows = await sql`
    select
      receipt_ocr_items.id::text as "itemId",
      receipt_ocr_items.unit,
      receipt_ocr_items.unit_price::float as "unitPrice",
      receipt_ocr_items.quantity::float,
      receipt_ocr_items.amount::float,
      receipt_ocr_items.tax_rate as "taxRate",
      receipt_ocr_items.tax_mode as "taxMode",
      coalesce((accounting_line.value->>'taxAmount')::float, 0) as "lineTaxAmount",
      coalesce(accounting_line.value->>'taxMode', '') as "lineTaxMode",
      coalesce(receipt_ocr_results.supplier_name, '') as "supplierName",
      coalesce(receipt_ocr_results.vendor_name, '') as "vendorName"
    from receipt_ocr_items
    join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    left join lateral jsonb_array_elements(coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb)) as accounting_line(value)
      on accounting_line.value->>'ocrItemId' = receipt_ocr_items.id::text
    where receipt_ocr_items.id::text = ${itemId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return;

  const quantity = Number(row.quantity ?? 0);
  const amount = Number(row.amount ?? 0);
  const lineTaxAmount = Number(row.lineTaxAmount ?? 0);
  const taxMode = String(row.lineTaxMode || row.taxMode || "");
  const taxRateText = String(row.taxRate || "");
  const taxRate = taxRateText === "8%" ? 8 : taxRateText === "10%" ? 10 : 0;
  const fallbackTaxAmount = taxMode === "外税" && taxRate > 0 ? Math.round(amount * taxRate / 100) : 0;
  const taxAmount = lineTaxAmount > 0 ? lineTaxAmount : fallbackTaxAmount;
  const derivedTaxIncludedPrice = quantity > 0 && amount > 0
    ? Math.round(((taxMode === "外税" ? amount + Math.max(0, taxAmount) : amount) / quantity) * 100) / 100
    : 0;
  const price = Number(override?.price ?? (derivedTaxIncludedPrice > 0 ? derivedTaxIncludedPrice : row.unitPrice ?? row.amount ?? 0));
  if (!Number.isFinite(price) || price <= 0) return;
  const unit = String(override?.unit ?? row.unit ?? "").trim() || "個";
  const supplierName = String(row.supplierName || row.vendorName || "").trim();

  await sql`
    update receipt_ocr_items
    set
      unit_price = ${price},
      updated_at = now()
    where id::text = ${itemId}
      and (
        unit_price is null
        or abs(unit_price::float - ${price}) > 0.009
      )
  `;

  await sql`
    delete from price_records
    where source = 'receipt_ocr'
      and receipt_note = ${itemId}
  `;

  await sql`
    insert into price_records (
      product_id,
      supplier_id,
      price,
      unit,
      source,
      receipt_note,
      recorded_by
    )
    select
      ${productId},
      suppliers.id,
      ${price},
      ${unit},
      'receipt_ocr',
      ${itemId},
      ${employeeId}
    from (select 1) seed
    left join suppliers on suppliers.name = ${supplierName}
    limit 1
  `;

  await reconcileReceiptOcrItemWithPurchaseActual(itemId, productId);
}

export async function reconcileReceiptOcrItemWithPurchaseActual(itemId: string, productId: string) {
  if (!itemId || !productId) return;

  const rows = await sql`
    select
      receipt_ocr_items.id::text as "itemId",
      receipt_ocr_items.quantity::float,
      receipt_ocr_items.unit_price::float as "unitPrice",
      receipt_ocr_items.amount::float,
      receipt_ocr_items.purchase_actual_id::text as "purchaseActualId",
      coalesce(receipt_ocr_items.reconciliation_status, 'unmatched') as "reconciliationStatus",
      receipt_ocr_results.store_id::text as "storeId",
      receipt_ocr_results.supplier_id::text as "supplierId",
      receipt_ocr_results.purchase_date as "purchaseDate"
    from receipt_ocr_items
    join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    where receipt_ocr_items.id::text = ${itemId}
    limit 1
  `;
  const item = rows[0];
  if (String(item?.reconciliationStatus ?? "") === "manual_matched" && item?.purchaseActualId) return;
  const storeId = String(item?.storeId ?? "");
  const purchaseDate = item?.purchaseDate ? new Date(String(item.purchaseDate)) : null;
  if (!item || !storeId || !purchaseDate || Number.isNaN(purchaseDate.getTime())) {
    await markReceiptOcrItemReconciliation(itemId, null, "unmatched", "購入日または店舗が未設定です。");
    return;
  }

  const purchaseDateKey = purchaseDate.toISOString().slice(0, 10);
  const candidates = await sql`
    select
      purchase_actuals.id::text,
      abs(coalesce(purchase_actuals.actual_quantity::float, 0) - coalesce(${Number(item.quantity ?? 0)}, 0)) as "quantityDiff",
      abs((purchase_actuals.recorded_at at time zone 'Asia/Tokyo')::date - ${purchaseDateKey}::date) as "dateDiff",
      case when purchase_actuals.supplier_id::text = ${String(item.supplierId ?? "")} then 0 else 1 end as "supplierRank"
    from purchase_actuals
    join purchase_order_items on purchase_order_items.id = purchase_actuals.purchase_order_item_id
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    where purchase_orders.store_id::text = ${storeId}
      and purchase_order_items.product_id::text = ${productId}
      and date_trunc('month', purchase_actuals.recorded_at at time zone 'Asia/Tokyo') = date_trunc('month', ${purchaseDateKey}::date)
      and not exists (
        select 1
        from receipt_ocr_items existing_items
        where existing_items.purchase_actual_id = purchase_actuals.id
          and existing_items.id::text <> ${itemId}
          and existing_items.reconciliation_status in ('auto_matched', 'manual_matched')
      )
    order by "supplierRank" asc, "dateDiff" asc, "quantityDiff" asc, purchase_actuals.recorded_at desc
    limit 1
  `;
  const match = candidates[0];

  if (!match?.id) {
    await markReceiptOcrItemReconciliation(itemId, null, "unmatched", "同じ月の購入実績が見つかりません。");
    return;
  }

  const quantity = Number(item.quantity ?? 0);
  const unitPrice = Number(item.unitPrice ?? item.amount ?? 0);
  await sql`
    update purchase_actuals
    set
      actual_quantity = coalesce(actual_quantity, ${Number.isFinite(quantity) && quantity > 0 ? quantity : null}),
      actual_price = coalesce(actual_price, ${Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null})
    where id::text = ${String(match.id)}
  `;
  await markReceiptOcrItemReconciliation(itemId, String(match.id), "auto_matched", "レシート明細を購入実績に自動照合しました。");
}

async function markReceiptOcrItemReconciliation(
  itemId: string,
  purchaseActualId: string | null,
  status: "unmatched" | "auto_matched" | "manual_matched" | "ignored",
  note: string
) {
  await sql`
    update receipt_ocr_items
    set
      purchase_actual_id = ${purchaseActualId},
      reconciliation_status = ${status},
      reconciliation_note = ${note},
      updated_at = now()
    where id::text = ${itemId}
  `;
}

async function findProductMatch(supplierName: string, normalizedName: string) {
  const dictionaryRows = await sql`
    select product_id::text as "productId"
    from product_match_dictionary
    where normalized_name = ${normalizedName}
      and (supplier_name = ${supplierName} or supplier_name = '')
    order by case when supplier_name = ${supplierName} then 0 else 1 end
    limit 1
  `;
  if (dictionaryRows[0]?.productId) return { productId: String(dictionaryRows[0].productId) };

  const productRows = await sql`
    with candidates as (
      select
        id::text as "productId",
        case
          when lower(name) = lower(${normalizedName}) then 0
          when lower(name) = lower(${normalizedName.replace(/\s+/g, "")}) then 1
          when lower(coalesce(product_family_name, '')) = lower(${normalizedName}) and is_default_variant = true then 2
          when lower(replace(coalesce(product_family_name, ''), ' ', '')) = lower(${normalizedName.replace(/\s+/g, "")}) and is_default_variant = true then 3
          when lower(coalesce(product_family_name, '')) = lower(${normalizedName}) then 4
          when lower(replace(coalesce(product_family_name, ''), ' ', '')) = lower(${normalizedName.replace(/\s+/g, "")}) then 5
          else 9
        end as rank,
        count(*) over (partition by lower(coalesce(nullif(product_family_name, ''), name))) as family_count
      from products
      where lower(name) = lower(${normalizedName})
         or lower(name) = lower(${normalizedName.replace(/\s+/g, "")})
         or lower(coalesce(product_family_name, '')) = lower(${normalizedName})
         or lower(replace(coalesce(product_family_name, ''), ' ', '')) = lower(${normalizedName.replace(/\s+/g, "")})
    )
    select "productId"
    from candidates
    where rank <= 3 or family_count = 1
    order by rank asc
    limit 1
  `;
  return { productId: productRows[0]?.productId ? String(productRows[0].productId) : "" };
}

async function createProductCandidate(itemId: string, item: ReceiptOcrItem, normalizedName: string, supplierName: string, session: EmployeeSession) {
  const suggestedName = cleanSuggestedProductName(item.name);
  await sql`
    insert into product_candidates (
      receipt_ocr_item_id,
      raw_name,
      normalized_name,
      suggested_name,
      category,
      subcategory,
      unit,
      reference_price,
      supplier_name,
      status,
      created_by,
      updated_at
    )
    values (
      ${itemId || null},
      ${item.name},
      ${normalizedName},
      ${suggestedName},
      ${item.category || "未分類"},
      ${"未分類"},
      ${item.unit || "個"},
      ${item.unitPrice ?? item.amount ?? null},
      ${supplierName || ""},
      ${"pending"},
      ${session.id},
      now()
    )
    on conflict (normalized_name, supplier_name, status)
    do update set
      reference_price = coalesce(product_candidates.reference_price, excluded.reference_price),
      updated_at = now()
  `;
}

function normalizeReceiptOcrResult(value: ReceiptOcrResult): ReceiptOcrResult {
  const normalized = {
    documentType: normalizeDocumentType(value.documentType),
    financialPurpose: normalizeFinancialPurpose(value.financialPurpose),
    storeName: String(value.storeName ?? "").trim(),
    companyName: String(value.companyName ?? "").trim(),
    brandName: String(value.brandName ?? "").trim(),
    locationName: String(value.locationName ?? "").trim(),
    purchaseDate: coerceDate(value.purchaseDate) || "",
    purchaseTime: coerceTime(value.purchaseTime) || "",
    subtotal: coerceMoney(value.subtotal),
    tax: coerceMoney(value.tax),
    total: coerceMoney(value.total),
    items: Array.isArray(value.items) ? value.items.map((item) => ({
      name: String(item.name ?? "").trim(),
      quantity: coerceNullableNumber(item.quantity),
      unit: String(item.unit ?? "").trim(),
      unitPrice: coerceMoney(item.unitPrice),
      taxRate: normalizeTaxRate(item.taxRate),
      taxMode: normalizeTaxMode(item.taxMode),
      category: normalizeReceiptCategory(item.category),
      accountTitle: normalizeAccountTitle(item.accountTitle),
      amount: coerceMoney(item.amount)
    })).filter((item) => item.name) : []
  };
  return ensureFinancialDocumentItems(applyFinancialCorrections(applyReceiptLineCorrections(normalized)));
}

function applyReceiptLineCorrections(result: ReceiptOcrResult): ReceiptOcrResult {
  const items = result.items.map((item) => ({ ...item }));

  for (const item of items) {
    const markedReducedTax = /^[※*＊]/.test(item.name.trim());
    item.name = item.name.replace(/^[※*＊]\s*/, "").trim();
    if (markedReducedTax) {
      item.taxRate = "8%";
    }
  }

  for (let index = 0; index < items.length - 1; index += 1) {
    const current = items[index];
    const next = items[index + 1];
    if (!current || !next) continue;
    if (!isLikelyMisassignedQuantity(current, next)) continue;

    current.quantity = next.quantity;
    current.unit = next.unit || current.unit || "個";
    current.unitPrice = next.unitPrice;
    next.quantity = null;
    next.unit = "";
    next.unitPrice = null;
  }

  return { ...result, items };
}

function isLikelyMisassignedQuantity(current: ReceiptOcrItem, next: ReceiptOcrItem) {
  const nextQuantity = Number(next.quantity ?? NaN);
  const nextUnitPrice = Number(next.unitPrice ?? 0);
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 1) return false;
  if (!Number.isFinite(nextUnitPrice) || nextUnitPrice <= 0) return false;

  const quantityTotal = Math.round(nextQuantity * nextUnitPrice);
  const currentAmount = Number(current.amount ?? 0);
  const nextAmount = Number(next.amount ?? 0);
  if (!Number.isFinite(currentAmount) || currentAmount <= 0) return false;
  const currentQuantity = Number(current.quantity ?? 0);
  const currentUnitPrice = Number(current.unitPrice ?? 0);
  if (
    Number.isFinite(currentQuantity) &&
    currentQuantity > 1 &&
    Number.isFinite(currentUnitPrice) &&
    currentUnitPrice > 0 &&
    Math.abs(Math.round(currentQuantity * currentUnitPrice) - currentAmount) <= 1
  ) {
    return false;
  }
  if (Math.abs(quantityTotal - currentAmount) > 1) return false;
  if (Number.isFinite(nextAmount) && nextAmount > 0 && Math.abs(quantityTotal - nextAmount) <= 1) return false;
  return true;
}

function cleanSuggestedProductName(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|個|本|袋|枚|pack|pc)\b/gi, "")
    .trim() || String(value ?? "").trim();
}

function coerceMoney(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : null;
}

function coerceNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function coerceDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function coerceTime(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTaxMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode === "内税" || mode === "外税" || mode === "対象外" ? mode : "不明";
}

function normalizeTaxRate(value: unknown) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "不課税" || text === "対象外") return text;
  if (text === "0") return "非課税";
  return "";
}

function normalizeDocumentType(value: unknown) {
  const text = String(value ?? "").trim();
  return documentTypes.has(text) ? text : "その他";
}

function normalizeFinancialPurpose(value: unknown) {
  const text = String(value ?? "").trim();
  return financialPurposes.has(text) ? text : "未分類";
}

function normalizeReceiptCategory(value: unknown) {
  const text = String(value ?? "").trim();
  return receiptCategories.has(text) ? text : "未分類";
}

function normalizeAccountTitle(value: unknown) {
  const title = String(value ?? "").trim();
  return accountTitles.has(title) ? title : "雑費";
}

function applyFinancialCorrections(result: ReceiptOcrResult): ReceiptOcrResult {
  const haystack = [
    result.documentType,
    result.financialPurpose,
    result.storeName,
    result.companyName,
    result.brandName,
    result.locationName,
    ...result.items.flatMap((item) => [item.name, item.category, item.accountTitle])
  ].join(" ").normalize("NFKC");

  const inferredPurpose = inferFinancialPurpose(haystack, result.financialPurpose);
  const inferredDocumentType = inferDocumentType(haystack, result.documentType);
  const items = result.items.map((item) => correctFinancialItem(item, inferredPurpose, haystack));

  return {
    ...result,
    documentType: inferredDocumentType,
    financialPurpose: inferredPurpose,
    items
  };
}

function inferDocumentType(text: string, fallback: string) {
  if (/(納付書|納税|領収済通知書|払込取扱票|納入告知書|公金)/.test(text)) return "納付書";
  if (/(請求書|請求明細)/.test(text)) return "請求書";
  if (/(納品書|納品伝票)/.test(text)) return "納品書";
  if (/(振込|送金|払込|入出金)/.test(text)) return "振込明細";
  if (/(カード|クレジット|ご利用明細)/.test(text)) return "カード明細";
  return documentTypes.has(fallback) ? fallback : "その他";
}

function inferFinancialPurpose(text: string, fallback: string) {
  if (/(納付書|納税|租税|公課|消費税|法人税|所得税|源泉|住民税|市県民税|事業税|固定資産税|自動車税|印紙税|延滞税|加算税)/.test(text)) return "租税公課";
  if (/(社会保険|厚生年金|健康保険|雇用保険|労働保険|給与|給料|賃金|賞与)/.test(text)) return "給与関連";
  if (/(固定資産|減価償却|資産計上)/.test(text)) return "固定資産";
  return financialPurposes.has(fallback) ? fallback : "未分類";
}

function correctFinancialItem(item: ReceiptOcrItem, financialPurpose: string, documentText: string): ReceiptOcrItem {
  const text = [item.name, item.category, item.accountTitle, documentText].join(" ").normalize("NFKC");
  if (financialPurpose === "租税公課" || /(納税|租税|公課|消費税|法人税|所得税|源泉|住民税|事業税|固定資産税|自動車税|印紙税|延滞税|加算税)/.test(text)) {
    return { ...item, category: "税金", accountTitle: "租税公課", taxRate: "対象外", taxMode: "対象外" };
  }
  if (financialPurpose === "給与関連" || /(社会保険|厚生年金|健康保険|雇用保険|労働保険)/.test(text)) {
    return { ...item, category: "給与社保", accountTitle: "法定福利費", taxRate: "対象外", taxMode: "対象外" };
  }
  if (/(給与|給料|賃金|賞与)/.test(text)) {
    return { ...item, category: "給与社保", accountTitle: "給料賃金", taxRate: "対象外", taxMode: "対象外" };
  }
  if (/(家賃|賃料|共益費|管理費)/.test(text)) return { ...item, category: "家賃", accountTitle: "地代家賃" };
  if (/(電気|ガス|水道|上下水道|光熱)/.test(text)) return { ...item, category: "水道光熱", accountTitle: "水道光熱費" };
  if (/(電話|通信|インターネット|クラウド|サブスク|サブスクリプション)/.test(text)) return { ...item, category: "通信", accountTitle: "通信費" };
  if (/(振込手数料|決済手数料|銀行手数料|代引手数料|システム利用料|プラットフォーム手数料)/.test(text)) return { ...item, category: "手数料", accountTitle: "支払手数料" };
  if (/(税理士|会計士|弁護士|司法書士|行政書士|社労士|コンサル|顧問料|報酬)/.test(text)) return { ...item, category: "手数料", accountTitle: "支払報酬料" };
  if (/(保険料|損害保険|火災保険|自動車保険)/.test(text)) return { ...item, category: "保険", accountTitle: "保険料" };
  if (/(広告|宣伝|チラシ|印刷|販促|Google|Meta|Instagram|LINE広告)/i.test(text)) return { ...item, category: "広告", accountTitle: "広告宣伝費" };
  return item;
}

function ensureFinancialDocumentItems(result: ReceiptOcrResult): ReceiptOcrResult {
  const total = coerceMoney(result.total);
  const hasPositiveItem = result.items.some((item) => Number(item.amount ?? 0) > 0);
  if (!total || hasPositiveItem) return result;

  if (result.financialPurpose === "租税公課" || result.documentType === "納付書") {
    return {
      ...result,
      documentType: "納付書",
      financialPurpose: "租税公課",
      items: [{
        name: result.storeName ? `${result.storeName} 納付額` : "租税公課 納付額",
        quantity: 1,
        unit: "件",
        unitPrice: total,
        taxRate: "対象外",
        taxMode: "対象外",
        category: "税金",
        accountTitle: "租税公課",
        amount: total
      }]
    };
  }

  if (result.financialPurpose === "給与関連") {
    return {
      ...result,
      items: [{
        name: result.storeName ? `${result.storeName} 支払額` : "給与関連 支払額",
        quantity: 1,
        unit: "件",
        unitPrice: total,
        taxRate: "対象外",
        taxMode: "対象外",
        category: "給与社保",
        accountTitle: "法定福利費",
        amount: total
      }]
    };
  }

  return result;
}

const documentTypes = new Set([
  "レシート",
  "領収書",
  "請求書",
  "納品書",
  "納付書",
  "振込明細",
  "カード明細",
  "銀行明細",
  "給与社保資料",
  "その他"
]);

const financialPurposes = new Set([
  "仕入",
  "経費",
  "租税公課",
  "給与関連",
  "固定資産",
  "売上関連",
  "立替返金",
  "未分類"
]);

const receiptCategories = new Set([
  "食材",
  "包材",
  "消耗品",
  "清掃用品",
  "設備",
  "税金",
  "給与社保",
  "家賃",
  "水道光熱",
  "通信",
  "広告",
  "交通",
  "車両",
  "保険",
  "手数料",
  "研修",
  "雑費",
  "未分類"
]);

const accountTitles = new Set([
  "仕入高",
  "租税公課",
  "荷造運賃",
  "水道光熱費",
  "旅費交通費",
  "通信費",
  "広告宣伝費",
  "接待交際費",
  "損害保険料",
  "保険料",
  "修繕費",
  "消耗品費",
  "事務用品費",
  "減価償却費",
  "福利厚生費",
  "法定福利費",
  "給料賃金",
  "外注工賃",
  "支払報酬料",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "図書研修費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
]);
