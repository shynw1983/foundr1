import sharp from "sharp";
import { requireOsSession } from "../../../lib/api-auth";
import { recordExternalServiceUsage } from "../../../lib/external-service-usage";
import { validateImageUpload } from "../../../lib/upload-security";

const maxImageSizeBytes = 8 * 1024 * 1024;
const maxScanEdge = 4096;
const minDetectedReceiptRatio = 0.2;

export const runtime = "nodejs";

type Point = {
  x: number;
  y: number;
};

type ReceiptDetection = {
  crop: sharp.Region;
  quad?: [Point, Point, Point, Point];
  source: "local" | "ai";
};

type EdgeProfile = {
  leftEdge: Point[];
  rightEdge: Point[];
  source: "local" | "ai";
  crop?: sharp.Region;
};

type AiReceiptShape = {
  documentType: "standard" | "long_receipt";
  quad?: [Point, Point, Point, Point];
  edgeProfile?: EdgeProfile;
};

type StraightenedImage = {
  buffer: Buffer;
  width: number;
  height: number;
};

type ScanMode = "auto" | "standard" | "long_receipt";
type ContrastMode = "standard" | "strong";
type OutputMode = "scan" | "debug_overlay";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("receipt");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "レシート写真を選択してください。" }, { status: 400 });
    }
    validateImageUpload(file, maxImageSizeBytes, "レシート写真");
    const boundaryMode = formData.get("boundaryMode") === "ai" ? "ai" : "auto";
    const scanMode = normalizeScanMode(formData.get("scanMode"));
    const contrastMode = formData.get("contrastMode") === "standard" ? "standard" : "strong";
    const outputMode: OutputMode = formData.get("outputMode") === "debug_overlay" ? "debug_overlay" : "scan";

    const input = Buffer.from(await file.arrayBuffer());
    const normalized = sharp(input, { failOn: "none" }).rotate().resize({
      width: maxScanEdge,
      height: maxScanEdge,
      fit: "inside",
      withoutEnlargement: true
    });
    const aiImage = boundaryMode === "ai" ? await normalized.clone().jpeg({ quality: 82 }).toBuffer() : null;
    const {
      data: raw,
      info: { width, height }
    } = await normalized.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!width || !height) {
      return Response.json({ error: "画像を読み込めませんでした。" }, { status: 400 });
    }

    const aiShape = aiImage ? await detectReceiptShapeWithAi(aiImage, raw, width, height) : undefined;
    const localDetection = detectReceipt(raw, width, height);
    const localEdgeProfile = detectReceiptEdges(raw, width, height, localDetection.crop);
    const useLongReceipt = shouldUseLongReceiptMode(scanMode, aiShape, width, height);
    const aiStatus = !aiImage ? "off" : aiShape ? "used" : "failed";

    if (outputMode === "debug_overlay") {
      const overlay = await renderDebugOverlay(raw, width, height, aiShape, localDetection, localEdgeProfile);
      return new Response(overlay, {
        headers: {
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "X-Receipt-Scanner-AI": aiStatus,
          "X-Receipt-Scanner-Mode": useLongReceipt ? "long_receipt" : "standard",
          "X-Receipt-Scanner-Debug": "overlay",
          "X-Receipt-Scanner-Size": `${width}x${height}`
        }
      });
    }

    const straightened = useLongReceipt
      ? await unwarpLongReceipt(
        raw,
        width,
        height,
        aiShape?.edgeProfile ?? localEdgeProfile,
        aiShape?.quad
      )
      : await straightenStandardReceipt(raw, width, height, aiShape?.quad, localDetection);
    const processed = await renderScannerStyleImage(straightened, contrastMode);
    const boundarySource = useLongReceipt
      ? (aiShape?.edgeProfile?.source ?? "local")
      : (aiShape?.quad ? "ai" : localDetection.source);

    return new Response(processed, {
      headers: {
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "X-Receipt-Scanner-Boundary": boundarySource,
        "X-Receipt-Scanner-Mode": useLongReceipt ? "long_receipt" : "standard",
        "X-Receipt-Scanner-AI": aiStatus,
        "X-Receipt-Scanner-Size": `${straightened.width}x${straightened.height}`
      }
    });
  } catch (error) {
    console.error("Receipt scanner failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "レシート写真の補正に失敗しました。" },
      { status: 400 }
    );
  }
}

function normalizeScanMode(value: FormDataEntryValue | null): ScanMode {
  return value === "standard" || value === "long_receipt" ? value : "auto";
}

function shouldUseLongReceiptMode(scanMode: ScanMode, aiShape: AiReceiptShape | undefined, width: number, height: number) {
  if (scanMode === "long_receipt") return true;
  if (scanMode === "standard") return false;
  if (aiShape?.documentType === "long_receipt") return true;
  return height / Math.max(1, width) >= 2.2;
}

async function straightenStandardReceipt(
  raw: Buffer,
  width: number,
  height: number,
  aiQuad: [Point, Point, Point, Point] | undefined,
  localDetection: ReceiptDetection
) {
  if (aiQuad) return warpPerspective(raw, width, height, aiQuad);
  return localDetection.quad
    ? warpPerspective(raw, width, height, localDetection.quad)
    : cropRaw(raw, width, localDetection.crop);
}

function detectReceipt(raw: Buffer, width: number, height: number): ReceiptDetection {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    const red = raw[offset] ?? 0;
    const green = raw[offset + 1] ?? 0;
    const blue = raw[offset + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const saturation = max ? (max - min) / max : 0;
    if (luminance > 132 && saturation < 0.42) mask[index] = 1;
  }

  const minColumnPixels = Math.max(4, Math.floor(height * 0.08));
  const minRowPixels = Math.max(4, Math.floor(width * 0.08));
  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;

  for (let x = 0; x < width; x += 1) {
    if (countColumn(mask, width, height, x) >= minColumnPixels) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x -= 1) {
    if (countColumn(mask, width, height, x) >= minColumnPixels) {
      right = x;
      break;
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (countRow(mask, width, y) >= minRowPixels) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    if (countRow(mask, width, y) >= minRowPixels) {
      bottom = y;
      break;
    }
  }

  const detectedWidth = right - left + 1;
  const detectedHeight = bottom - top + 1;
  if (detectedWidth < width * minDetectedReceiptRatio || detectedHeight < height * minDetectedReceiptRatio) {
    return { crop: { left: 0, top: 0, width, height }, source: "local" };
  }

  const padding = Math.max(8, Math.round(Math.min(width, height) * 0.02));
  const paddedLeft = Math.max(0, left - padding);
  const paddedTop = Math.max(0, top - padding);
  const paddedRight = Math.min(width - 1, right + padding);
  const paddedBottom = Math.min(height - 1, bottom + padding);
  const crop = {
    left: paddedLeft,
    top: paddedTop,
    width: Math.max(1, paddedRight - paddedLeft + 1),
    height: Math.max(1, paddedBottom - paddedTop + 1)
  };
  const quad = detectReceiptQuad(mask, width, left, top, right, bottom);
  return quad ? { crop, quad, source: "local" } : { crop, source: "local" };
}

function countColumn(mask: Uint8Array, width: number, height: number, x: number) {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    count += mask[y * width + x] ?? 0;
  }
  return count;
}

function countRow(mask: Uint8Array, width: number, y: number) {
  let count = 0;
  const offset = y * width;
  for (let x = 0; x < width; x += 1) {
    count += mask[offset + x] ?? 0;
  }
  return count;
}

async function cropRaw(raw: Buffer, sourceWidth: number, crop: sharp.Region) {
  const buffer = Buffer.alloc(crop.width * crop.height * 3, 255);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.top + y) * sourceWidth + crop.left) * 3;
    const outputStart = y * crop.width * 3;
    raw.copy(buffer, outputStart, sourceStart, sourceStart + crop.width * 3);
  }
  return { buffer, width: crop.width, height: crop.height };
}

function cropFromQuad(quad: [Point, Point, Point, Point], imageWidth: number, imageHeight: number): sharp.Region {
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(imageWidth - 1, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(imageHeight - 1, Math.ceil(Math.max(...ys)));
  return {
    left,
    top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
}

function detectReceiptEdges(raw: Buffer, width: number, height: number, crop: sharp.Region): EdgeProfile {
  const mask = buildReceiptMask(raw, width, height);
  const bandCount = Math.max(12, Math.min(36, Math.round(crop.height / 56)));
  const leftEdge: Point[] = [];
  const rightEdge: Point[] = [];
  let previousLeft = crop.left;
  let previousRight = crop.left + crop.width - 1;

  for (let index = 0; index < bandCount; index += 1) {
    const ratio = bandCount === 1 ? 0 : index / (bandCount - 1);
    const centerY = Math.round(crop.top + ratio * (crop.height - 1));
    const halfBand = Math.max(4, Math.round(crop.height / bandCount / 2));
    const top = Math.max(crop.top, centerY - halfBand);
    const bottom = Math.min(crop.top + crop.height - 1, centerY + halfBand);
    const rowThreshold = Math.max(2, Math.round((bottom - top + 1) * 0.2));
    let left = -1;
    let right = -1;

    for (let x = crop.left; x < crop.left + crop.width; x += 1) {
      let count = 0;
      for (let y = top; y <= bottom; y += 1) count += mask[y * width + x] ?? 0;
      if (count >= rowThreshold) {
        left = x;
        break;
      }
    }
    for (let x = crop.left + crop.width - 1; x >= crop.left; x -= 1) {
      let count = 0;
      for (let y = top; y <= bottom; y += 1) count += mask[y * width + x] ?? 0;
      if (count >= rowThreshold) {
        right = x;
        break;
      }
    }

    if (left < 0) left = previousLeft;
    if (right < 0) right = previousRight;
    if (right - left < crop.width * 0.35) {
      left = previousLeft;
      right = previousRight;
    }
    previousLeft = left;
    previousRight = right;
    leftEdge.push({ x: left, y: centerY });
    rightEdge.push({ x: right, y: centerY });
  }

  return {
    leftEdge: smoothEdge(leftEdge, width, height),
    rightEdge: smoothEdge(rightEdge, width, height),
    source: "local",
    crop
  };
}

function buildReceiptMask(raw: Buffer, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    const red = raw[offset] ?? 0;
    const green = raw[offset + 1] ?? 0;
    const blue = raw[offset + 2] ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    const saturation = max ? (max - min) / max : 0;
    if (luminance > 128 && saturation < 0.45) mask[index] = 1;
  }
  return mask;
}

function smoothEdge(points: Point[], width: number, height: number) {
  return points.map((point, index) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(points.length - 1, index + 2);
    let x = 0;
    let y = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      x += points[cursor].x;
      y += points[cursor].y;
      count += 1;
    }
    return {
      x: Math.max(0, Math.min(width - 1, x / count)),
      y: Math.max(0, Math.min(height - 1, y / count))
    };
  });
}

async function unwarpLongReceipt(
  raw: Buffer,
  width: number,
  height: number,
  edgeProfile: EdgeProfile,
  quad?: [Point, Point, Point, Point]
): Promise<StraightenedImage> {
  const leftEdge = ensureEdgeEndpoints(edgeProfile.leftEdge, height);
  const rightEdge = ensureEdgeEndpoints(edgeProfile.rightEdge, height);
  const [topLeft, topRight, bottomRight, bottomLeft] = quad ?? [
    interpolateEdge(leftEdge, 0),
    interpolateEdge(rightEdge, 0),
    interpolateEdge(rightEdge, 1),
    interpolateEdge(leftEdge, 1)
  ];
  const targetHeight = Math.max(
    1,
    Math.round((distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2)
  );
  const widths = Array.from({ length: 11 }, (_, index) => {
    const ratio = index / 10;
    const leftY = topLeft.y + (bottomLeft.y - topLeft.y) * ratio;
    const rightY = topRight.y + (bottomRight.y - topRight.y) * ratio;
    const left = { x: interpolateEdgeXAtY(leftEdge, leftY), y: leftY };
    const right = { x: interpolateEdgeXAtY(rightEdge, rightY), y: rightY };
    return distance(left, right);
  }).sort((a, b) => a - b);
  const cropWidthFloor = edgeProfile.crop?.width ? Math.round(edgeProfile.crop.width * 0.92) : 1;
  const quadWidthFloor = Math.round(((distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2) * 0.94);
  const targetWidth = Math.max(cropWidthFloor, quadWidthFloor, Math.round(widths[Math.floor(widths.length / 2)]));
  const output = Buffer.alloc(targetWidth * targetHeight * 3, 255);

  for (let y = 0; y < targetHeight; y += 1) {
    const ratio = targetHeight === 1 ? 0 : y / (targetHeight - 1);
    const leftY = topLeft.y + (bottomLeft.y - topLeft.y) * ratio;
    const rightY = topRight.y + (bottomRight.y - topRight.y) * ratio;
    const leftPoint = {
      x: interpolateEdgeXAtY(leftEdge, leftY),
      y: leftY
    };
    const rightPoint = {
      x: interpolateEdgeXAtY(rightEdge, rightY),
      y: rightY
    };
    for (let x = 0; x < targetWidth; x += 1) {
      const horizontalRatio = targetWidth === 1 ? 0 : x / (targetWidth - 1);
      const sourceX = leftPoint.x + (rightPoint.x - leftPoint.x) * horizontalRatio;
      const sourceY = leftPoint.y + (rightPoint.y - leftPoint.y) * horizontalRatio;
      sampleBilinear(raw, width, height, sourceX, sourceY, output, (y * targetWidth + x) * 3);
    }
  }

  return { buffer: output, width: targetWidth, height: targetHeight };
}

function ensureEdgeEndpoints(points: Point[], height: number) {
  const sorted = [...points].sort((a, b) => a.y - b.y);
  if (!sorted.length) return [{ x: 0, y: 0 }, { x: 0, y: height - 1 }];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.y > 0) sorted.unshift({ x: first.x, y: 0 });
  if (last.y < height - 1) sorted.push({ x: last.x, y: height - 1 });
  return sorted;
}

function interpolateEdge(points: Point[], ratio: number) {
  const targetY = ratio * (points[points.length - 1].y - points[0].y) + points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (targetY <= next.y) {
      const segmentRatio = (targetY - previous.y) / Math.max(1, next.y - previous.y);
      return {
        x: previous.x + (next.x - previous.x) * segmentRatio,
        y: targetY
      };
    }
  }
  const last = points[points.length - 1];
  return { x: last.x, y: targetY };
}

function interpolateEdgeXAtY(points: Point[], targetY: number) {
  if (!points.length) return 0;
  if (targetY <= points[0].y) return points[0].x;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (targetY <= next.y) {
      const ratio = (targetY - previous.y) / Math.max(1, next.y - previous.y);
      return previous.x + (next.x - previous.x) * ratio;
    }
  }
  return points[points.length - 1].x;
}

async function detectReceiptShapeWithAi(
  imageBuffer: Buffer,
  raw: Buffer,
  width: number,
  height: number
): Promise<AiReceiptShape | undefined> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;

  try {
    const model = process.env.OPENAI_RECEIPT_SCANNER_MODEL || "gpt-4.1";
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
                  "You are planning geometry for a mobile document scanner.",
                  "Do not transcribe, rewrite, enhance, or infer receipt text. Return geometry only.",
                  "The final processed image must be a clean scanner-style receipt image:",
                  "1. The receipt/document is horizontally and vertically straight after correction.",
                  "2. No non-target background, surrounding objects, separate papers, hands, strong shadows, or unrelated surfaces remain inside the crop.",
                  "3. The crop is tight to the selected paper surface, with only a small safety margin if needed.",
                  "4. The paper area will later be rendered as pure white background with pure black text/graphics, so your coordinates must preserve all printed content.",
                  "Use the displayed image orientation.",
                  "Coordinates must be normalized between 0 and 1 relative to image width and height.",
                  "Select the scan target by visual dominance: choose the main foreground continuous receipt/document surface that is substantially visible and contains the transaction/item/total content.",
                  "Do not rely on any store name, logo, brand, language, or printed content to choose the target.",
                  "Exclude partially hidden, background, separate, rotated-away, or secondary papers even if they contain text.",
                  "Return corner points for the selected paper only: top_left, top_right, bottom_right, bottom_left.",
                  "Corner points must lie on the visible physical outer boundary of the selected paper.",
                  "Do not invent or extend paper edges beyond what is visible in the image.",
                  "If a paper edge is torn, curved, uneven, or angled, place the corner on that visible edge, not on a rectangular area around the text.",
                  "Corner points should be the scanner crop corners for flattening the selected paper, not the corners of the whole camera photo.",
                  "If the paper is tilted, choose points so a perspective transform makes the paper vertical and horizontal.",
                  "If the paper is curled, rolled, wavy, or a long receipt, still return the outer ideal corners, then provide leftEdge and rightEdge control points to flatten the curve.",
                  "For ordinary short receipts/documents with straight sides, documentType may be standard and edge arrays may be empty.",
                  "For long, narrow, curved, rolled, or non-straight receipts, documentType must be long_receipt.",
                  "For long_receipt, provide 16 to 24 leftEdge and rightEdge control points from top to bottom.",
                  "Each leftEdge point must be on the physical left outer paper edge; each rightEdge point must be on the physical right outer paper edge at the matching vertical level.",
                  "The edge points are used to unwarp curvature segment by segment, so do not place them on printed text columns, shadows, unrelated surfaces, or other objects.",
                  "If a paper edge is hidden or outside the photo, do not estimate far beyond the visible paper; keep the crop on the visible selected paper surface.",
                  "Prefer long_receipt when uncertain for tall receipt photos, because curved long receipts require perspective correction and edge-based flattening."
                ].join("\n")
              }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Return geometry for making the largest foreground receipt/document into a scanner-style output: straight, tightly cropped, no background, and ready for white-background/black-text rendering. For long or curved receipts, include enough leftEdge and rightEdge points to flatten the paper curvature." },
              { type: "input_image", image_url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`, detail: "high" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_boundary",
            strict: true,
            schema: receiptBoundarySchema()
          }
        },
        max_output_tokens: 1500
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
    if (!response.ok) throw new Error(body.error?.message || "AI 紙面検出に失敗しました。");
    const parsed = parseAiBoundaryResponse(body);
    await recordExternalServiceUsage({
      serviceKey: "openai",
      metricKey: "tokens",
      quantity: Number(body.usage?.total_tokens ?? 0),
      unit: "tokens",
      source: "receipt_scanner_boundary",
      metadata: {
        model,
        inputTokens: body.usage?.input_tokens ?? null,
        outputTokens: body.usage?.output_tokens ?? null
      }
    });
    const initialShape = normalizeAiShape(parsed, width, height);
    if (!initialShape) return undefined;
    const reviewedShape = await reviewReceiptShapeWithAi(apiKey, model, imageBuffer, raw, width, height, initialShape);
    return refineShapeToVisiblePaper(raw, width, height, reviewedShape ?? initialShape);
  } catch (error) {
    console.warn("AI receipt boundary detection skipped", error);
    return undefined;
  }
}

async function reviewReceiptShapeWithAi(
  apiKey: string,
  model: string,
  imageBuffer: Buffer,
  raw: Buffer,
  width: number,
  height: number,
  initialShape: AiReceiptShape
): Promise<AiReceiptShape | undefined> {
  if (!initialShape.quad) return undefined;

  try {
    const overlay = await renderAiReviewOverlay(raw, width, height, initialShape);
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
                  "You are reviewing and correcting document scanner geometry.",
                  "You will see the original photo and a second image with the previous proposed crop drawn in red.",
                  "Return geometry only. Do not transcribe text.",
                  "The selected target is the main foreground receipt/document surface that is substantially visible and contains transaction/item/total content.",
                  "Do not rely on any store name, logo, brand, language, or specific printed word.",
                  "The final crop must include only the selected paper surface and a tiny safety margin.",
                  "It is invalid if the red crop includes non-target background, unrelated objects, separate paper, shadows outside the paper, or blank space beyond the visible physical paper boundary.",
                  "It is invalid if any red corner is not on the visible physical outer edge of the selected paper.",
                  "It is invalid if the top edge, bottom edge, left edge, or right edge floats outside the selected paper surface.",
                  "If the red crop is invalid, return corrected corners on the visible physical boundary of the selected paper.",
                  "Do not extend hidden or ambiguous paper edges far into surrounding background.",
                  "If the visible paper edge is torn, curved, uneven, or angled, use the visible edge rather than an imagined perfect rectangle.",
                  "For short receipts with mostly straight sides, documentType should be standard and edge arrays can be empty.",
                  "For long, narrow, curled, rolled, or wavy receipts, documentType should be long_receipt and must include leftEdge and rightEdge points on the physical paper edges.",
                  "Coordinates must be normalized between 0 and 1 relative to the image width and height."
                ].join("\n")
              }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: "First image: original photo. Second image: previous crop drawn in red. Correct the crop so the final scanner output contains only the visible selected paper surface, with no unrelated surrounding area. Return the final geometry." },
              { type: "input_image", image_url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`, detail: "high" },
              { type: "input_image", image_url: `data:image/png;base64,${overlay.toString("base64")}`, detail: "high" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_boundary_review",
            strict: true,
            schema: receiptBoundarySchema()
          }
        },
        max_output_tokens: 1500
      })
    });
    const body = await response.json().catch(() => ({})) as AiResponseBody;
    if (!response.ok) throw new Error(body.error?.message || "AI 紙面検出レビューに失敗しました。");
    const parsed = parseAiBoundaryResponse(body);
    await recordExternalServiceUsage({
      serviceKey: "openai",
      metricKey: "tokens",
      quantity: Number(body.usage?.total_tokens ?? 0),
      unit: "tokens",
      source: "receipt_scanner_boundary_review",
      metadata: {
        model,
        inputTokens: body.usage?.input_tokens ?? null,
        outputTokens: body.usage?.output_tokens ?? null
      }
    });
    return normalizeAiShape(parsed, width, height);
  } catch (error) {
    console.warn("AI receipt boundary review skipped", error);
    return undefined;
  }
}

type AiBoundaryResponse = {
  hasReceipt: boolean;
  confidence: number;
  documentType: "standard" | "long_receipt";
  points: Array<{ role: string; x: number; y: number }>;
  leftEdge: Array<{ x: number; y: number }>;
  rightEdge: Array<{ x: number; y: number }>;
};

type AiResponseBody = {
  error?: { message?: string };
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function parseAiBoundaryResponse(body: AiResponseBody): AiBoundaryResponse {
  const content = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((contentItem) => contentItem.text ?? "").join("\n").trim()
    ?? "";
  return JSON.parse(content) as AiBoundaryResponse;
}

function normalizeAiShape(parsed: AiBoundaryResponse, width: number, height: number): AiReceiptShape | undefined {
  if (!parsed.hasReceipt || parsed.confidence < 0.35 || parsed.points.length < 4) return undefined;

  const pointMap = new Map(parsed.points.map((point) => [point.role, point]));
  const orderedRoles = ["top_left", "top_right", "bottom_right", "bottom_left"];
  const quad = orderedRoles.map((role) => {
    const point = pointMap.get(role);
    if (!point) return null;
    return {
      x: normalizeAiCoordinate(point.x, width),
      y: normalizeAiCoordinate(point.y, height)
    };
  });
  if (quad.some((point) => !point)) return undefined;
  const typedQuad = quad as [Point, Point, Point, Point];
  const area = polygonArea(typedQuad);
  const edgeProfile = normalizeAiEdgeProfile(parsed.leftEdge, parsed.rightEdge, width, height);
  return {
    documentType: parsed.documentType,
    quad: area >= width * height * 0.12 ? typedQuad : undefined,
    edgeProfile
  };
}

function refineShapeToVisiblePaper(raw: Buffer, width: number, height: number, shape: AiReceiptShape): AiReceiptShape {
  if (shape.documentType !== "standard" || !shape.quad) return shape;
  const [topLeft, topRight, bottomRight, bottomLeft] = shape.quad;
  const verticalDistance = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  const horizontalDistance = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  if (verticalDistance < height * 0.12 || horizontalDistance < width * 0.12) return shape;

  const sampleRows = Math.max(80, Math.min(220, Math.round(verticalDistance / 6)));
  const rowScores = Array.from({ length: sampleRows }, (_, index) => {
    const ratio = sampleRows === 1 ? 0 : index / (sampleRows - 1);
    return {
      ratio,
      score: visiblePaperRowScore(raw, width, height, topLeft, topRight, bottomRight, bottomLeft, ratio)
    };
  });
  const topRatio = findVisiblePaperStartRatio(rowScores);
  const bottomRatio = findVisiblePaperEndRatio(rowScores);
  if (topRatio === null && bottomRatio === null) return shape;

  const safetyRatio = Math.min(0.018, Math.max(0.006, 10 / Math.max(1, verticalDistance)));
  const nextTopRatio = topRatio === null ? 0 : Math.max(0, topRatio - safetyRatio);
  const nextBottomRatio = bottomRatio === null ? 1 : Math.min(1, bottomRatio + safetyRatio);
  if (nextBottomRatio - nextTopRatio < 0.22) return shape;
  if (nextTopRatio < 0.045 && nextBottomRatio > 0.955) return shape;

  const nextTopLeft = interpolatePoint(topLeft, bottomLeft, nextTopRatio);
  const nextTopRight = interpolatePoint(topRight, bottomRight, nextTopRatio);
  const nextBottomRight = interpolatePoint(topRight, bottomRight, nextBottomRatio);
  const nextBottomLeft = interpolatePoint(topLeft, bottomLeft, nextBottomRatio);

  return {
    ...shape,
    quad: [nextTopLeft, nextTopRight, nextBottomRight, nextBottomLeft]
  };
}

function visiblePaperRowScore(
  raw: Buffer,
  width: number,
  height: number,
  topLeft: Point,
  topRight: Point,
  bottomRight: Point,
  bottomLeft: Point,
  verticalRatio: number
) {
  const left = interpolatePoint(topLeft, bottomLeft, verticalRatio);
  const right = interpolatePoint(topRight, bottomRight, verticalRatio);
  const rowWidth = distance(left, right);
  if (rowWidth < width * 0.08) return 0;

  const samples = Math.max(28, Math.min(96, Math.round(rowWidth / 18)));
  let paperPixels = 0;
  for (let index = 0; index < samples; index += 1) {
    const horizontalRatio = 0.08 + (index / Math.max(1, samples - 1)) * 0.84;
    const x = left.x + (right.x - left.x) * horizontalRatio;
    const y = left.y + (right.y - left.y) * horizontalRatio;
    if (isVisiblePaperPixel(raw, width, height, x, y)) paperPixels += 1;
  }
  return paperPixels / samples;
}

function isVisiblePaperPixel(raw: Buffer, width: number, height: number, x: number, y: number) {
  const roundedX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const roundedY = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (roundedY * width + roundedX) * 3;
  const red = raw[offset] ?? 0;
  const green = raw[offset + 1] ?? 0;
  const blue = raw[offset + 2] ?? 0;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  const saturation = max ? (max - min) / max : 0;
  return luminance > 142 && saturation < 0.5;
}

function findVisiblePaperStartRatio(rows: Array<{ ratio: number; score: number }>) {
  const threshold = 0.5;
  const consecutiveRows = 3;
  for (let index = 0; index <= rows.length - consecutiveRows; index += 1) {
    const window = rows.slice(index, index + consecutiveRows);
    if (window.every((row) => row.score >= threshold)) return rows[index].ratio;
  }
  return null;
}

function findVisiblePaperEndRatio(rows: Array<{ ratio: number; score: number }>) {
  const threshold = 0.5;
  const consecutiveRows = 3;
  for (let index = rows.length - consecutiveRows; index >= 0; index -= 1) {
    const window = rows.slice(index, index + consecutiveRows);
    if (window.every((row) => row.score >= threshold)) return rows[index + consecutiveRows - 1].ratio;
  }
  return null;
}

function interpolatePoint(start: Point, end: Point, ratio: number) {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio
  };
}

function receiptBoundarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      hasReceipt: { type: "boolean" },
      confidence: { type: "number" },
      documentType: { type: "string", enum: ["standard", "long_receipt"] },
      points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            role: { type: "string", enum: ["top_left", "top_right", "bottom_right", "bottom_left"] },
            x: { type: "number" },
            y: { type: "number" }
          },
          required: ["role", "x", "y"]
        }
      },
      leftEdge: {
        type: "array",
        items: edgePointSchema()
      },
      rightEdge: {
        type: "array",
        items: edgePointSchema()
      }
    },
    required: ["hasReceipt", "confidence", "documentType", "points", "leftEdge", "rightEdge"]
  };
}

function edgePointSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      x: { type: "number" },
      y: { type: "number" }
    },
    required: ["x", "y"]
  };
}

function normalizeAiEdgeProfile(
  leftEdge: Array<{ x: number; y: number }>,
  rightEdge: Array<{ x: number; y: number }>,
  width: number,
  height: number
): EdgeProfile | undefined {
  if (leftEdge.length < 4 || rightEdge.length < 4) return undefined;
  const left = leftEdge.map((point) => ({
    x: normalizeAiCoordinate(point.x, width),
    y: normalizeAiCoordinate(point.y, height)
  })).sort((a, b) => a.y - b.y);
  const right = rightEdge.map((point) => ({
    x: normalizeAiCoordinate(point.x, width),
    y: normalizeAiCoordinate(point.y, height)
  })).sort((a, b) => a.y - b.y);
  const sampleCount = Math.min(left.length, right.length);
  let validPairs = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    if ((right[index].x - left[index].x) > width * 0.25) validPairs += 1;
  }
  if (validPairs < Math.max(3, sampleCount * 0.65)) return undefined;
  return {
    leftEdge: smoothEdge(left, width, height),
    rightEdge: smoothEdge(right, width, height),
    source: "ai"
  };
}

async function renderDebugOverlay(
  raw: Buffer,
  width: number,
  height: number,
  aiShape: AiReceiptShape | undefined,
  localDetection: ReceiptDetection,
  localEdgeProfile: EdgeProfile
) {
  const base = await sharp(raw, {
    raw: {
      width,
      height,
      channels: 3
    }
  })
    .png()
    .toBuffer();
  const overlay = Buffer.from(buildDebugOverlaySvg(width, height, aiShape, localDetection, localEdgeProfile));
  return sharp(base)
    .composite([{ input: overlay, blend: "over" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderAiReviewOverlay(raw: Buffer, width: number, height: number, aiShape: AiReceiptShape) {
  const base = await sharp(raw, {
    raw: {
      width,
      height,
      channels: 3
    }
  })
    .png()
    .toBuffer();
  const strokeWidth = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  const pointRadius = Math.max(10, Math.round(Math.min(width, height) * 0.014));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none"/>`
  ];
  if (aiShape.quad) {
    parts.push(polygon(aiShape.quad, "#ef4444", strokeWidth, "PREVIOUS AI CROP"));
    parts.push(...pointMarkers(aiShape.quad, "#ef4444", pointRadius));
  }
  if (aiShape.edgeProfile) {
    parts.push(polyline(aiShape.edgeProfile.leftEdge, "#2563eb", strokeWidth, "PREVIOUS LEFT EDGE"));
    parts.push(polyline(aiShape.edgeProfile.rightEdge, "#06b6d4", strokeWidth, "PREVIOUS RIGHT EDGE"));
  }
  parts.push("</svg>");

  return sharp(base)
    .composite([{ input: Buffer.from(parts.join("")), blend: "over" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildDebugOverlaySvg(
  width: number,
  height: number,
  aiShape: AiReceiptShape | undefined,
  localDetection: ReceiptDetection,
  localEdgeProfile: EdgeProfile
) {
  const strokeWidth = Math.max(3, Math.round(Math.min(width, height) * 0.005));
  const pointRadius = Math.max(8, Math.round(Math.min(width, height) * 0.012));
  const labelSize = Math.max(24, Math.round(Math.min(width, height) * 0.026));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none"/>`
  ];

  const localCrop = localDetection.crop;
  parts.push(
    `<rect x="${localCrop.left}" y="${localCrop.top}" width="${localCrop.width}" height="${localCrop.height}" fill="none" stroke="#f59e0b" stroke-width="${strokeWidth}" stroke-dasharray="${strokeWidth * 3} ${strokeWidth * 2}"/>`,
    textLabel("LOCAL CROP", localCrop.left + strokeWidth, Math.max(labelSize, localCrop.top - strokeWidth), "#f59e0b", labelSize)
  );
  if (localDetection.quad) {
    parts.push(polygon(localDetection.quad, "#f97316", strokeWidth, "LOCAL QUAD"));
    parts.push(...pointMarkers(localDetection.quad, "#f97316", pointRadius));
  }
  if (localEdgeProfile.leftEdge.length || localEdgeProfile.rightEdge.length) {
    parts.push(polyline(localEdgeProfile.leftEdge, "#f59e0b", strokeWidth, "LOCAL LEFT"));
    parts.push(polyline(localEdgeProfile.rightEdge, "#f59e0b", strokeWidth, "LOCAL RIGHT"));
  }

  if (aiShape?.quad) {
    parts.push(polygon(aiShape.quad, "#ef4444", strokeWidth, "AI QUAD"));
    parts.push(...pointMarkers(aiShape.quad, "#ef4444", pointRadius));
  }
  if (aiShape?.edgeProfile) {
    parts.push(polyline(aiShape.edgeProfile.leftEdge, "#2563eb", strokeWidth, "AI LEFT"));
    parts.push(polyline(aiShape.edgeProfile.rightEdge, "#06b6d4", strokeWidth, "AI RIGHT"));
    parts.push(...pointMarkers(aiShape.edgeProfile.leftEdge, "#2563eb", Math.max(4, Math.round(pointRadius * 0.62))));
    parts.push(...pointMarkers(aiShape.edgeProfile.rightEdge, "#06b6d4", Math.max(4, Math.round(pointRadius * 0.62))));
  }

  if (!aiShape) {
    parts.push(textLabel("AI NOT USED OR FAILED", strokeWidth * 3, labelSize * 1.4, "#ef4444", labelSize));
  }
  parts.push("</svg>");
  return parts.join("");
}

function polygon(points: [Point, Point, Point, Point], color: string, strokeWidth: number, label: string) {
  const path = [...points, points[0]].map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
  const first = points[0];
  return [
    `<polyline points="${path}" fill="rgba(239,68,68,0.08)" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`,
    textLabel(label, first.x + strokeWidth, Math.max(strokeWidth * 3, first.y - strokeWidth), color, Math.max(18, strokeWidth * 5))
  ].join("");
}

function polyline(points: Point[], color: string, strokeWidth: number, label: string) {
  if (points.length < 2) return "";
  const path = points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
  const first = points[0];
  return [
    `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    textLabel(label, first.x + strokeWidth, first.y + strokeWidth * 4, color, Math.max(18, strokeWidth * 4))
  ].join("");
}

function pointMarkers(points: Point[], color: string, radius: number) {
  return points.map((point) => (
    `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${radius}" fill="${color}" fill-opacity="0.88" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(radius * 0.22))}"/>`
  ));
}

function textLabel(text: string, x: number, y: number, color: string, fontSize: number) {
  return `<text x="${round(x)}" y="${round(y)}" fill="${color}" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(fontSize * 0.12))}" paint-order="stroke" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(text)}</text>`;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeAiCoordinate(value: number, size: number) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 0 && value <= 1) return Math.max(0, Math.min(size - 1, value * (size - 1)));
  return Math.max(0, Math.min(size - 1, value));
}

async function renderScannerStyleImage(image: StraightenedImage, contrastMode: ContrastMode) {
  const { data: grayscale } = await sharp(image.buffer, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 3
    }
  })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = boxBlurGrayscale(grayscale, image.width, image.height, Math.max(18, Math.round(Math.min(image.width, image.height) * 0.08)));
  const corrected = Buffer.alloc(image.width * image.height, 255);

  for (let index = 0; index < image.width * image.height; index += 1) {
    const paperLevel = Math.max(18, background[index] ?? 255);
    const localValue = (grayscale[index] ?? 255) / paperLevel;
    let value = clampByte(localValue * 255);
    const contrast = contrastMode === "strong" ? 1.34 : 1.18;
    value = clampByte((value - 128) * contrast + 128);
    corrected[index] = value;
  }

  const localMean = boxBlurGrayscale(corrected, image.width, image.height, Math.max(10, Math.round(Math.min(image.width, image.height) * 0.028)));
  const output = Buffer.alloc(image.width * image.height * 3, 255);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const value = corrected[index] ?? 255;
    const mean = localMean[index] ?? 255;
    const thresholdOffset = contrastMode === "strong" ? 19 : 13;
    const threshold = Math.max(118, Math.min(238, mean - thresholdOffset));
    const binary = value < threshold ? 0 : 255;
    const offset = index * 3;
    output[offset] = binary;
    output[offset + 1] = binary;
    output[offset + 2] = binary;
  }

  return sharp(output, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 3
    }
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function boxBlurGrayscale(input: Buffer, width: number, height: number, radius: number) {
  const integralWidth = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += input[y * width + x] ?? 0;
      const integralIndex = (y + 1) * integralWidth + x + 1;
      integral[integralIndex] = integral[y * integralWidth + x + 1] + rowSum;
    }
  }

  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (right - left + 1) * (bottom - top + 1);
      const sum = integral[(bottom + 1) * integralWidth + right + 1]
        - integral[top * integralWidth + right + 1]
        - integral[(bottom + 1) * integralWidth + left]
        + integral[top * integralWidth + left];
      output[y * width + x] = sum / area;
    }
  }
  return output;
}

function clampByte(value: number) {
  if (!Number.isFinite(value)) return 255;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function detectReceiptQuad(
  mask: Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): [Point, Point, Point, Point] | undefined {
  let topLeft: Point | undefined;
  let topRight: Point | undefined;
  let bottomLeft: Point | undefined;
  let bottomRight: Point | undefined;
  let topLeftScore = Number.POSITIVE_INFINITY;
  let topRightScore = Number.NEGATIVE_INFINITY;
  let bottomLeftScore = Number.NEGATIVE_INFINITY;
  let bottomRightScore = Number.NEGATIVE_INFINITY;
  let detectedPixels = 0;

  for (let y = top; y <= bottom; y += 1) {
    const offset = y * width;
    for (let x = left; x <= right; x += 1) {
      if (!mask[offset + x]) continue;
      detectedPixels += 1;
      const sum = x + y;
      const diff = x - y;
      if (sum < topLeftScore) {
        topLeftScore = sum;
        topLeft = { x, y };
      }
      if (diff > topRightScore) {
        topRightScore = diff;
        topRight = { x, y };
      }
      if (-diff > bottomLeftScore) {
        bottomLeftScore = -diff;
        bottomLeft = { x, y };
      }
      if (sum > bottomRightScore) {
        bottomRightScore = sum;
        bottomRight = { x, y };
      }
    }
  }

  const boxArea = Math.max(1, (right - left + 1) * (bottom - top + 1));
  if (!topLeft || !topRight || !bottomLeft || !bottomRight || detectedPixels / boxArea < 0.28) {
    return undefined;
  }

  const quad: [Point, Point, Point, Point] = [topLeft, topRight, bottomRight, bottomLeft];
  const area = polygonArea(quad);
  if (area < boxArea * 0.18) return undefined;
  return padQuad(quad, width);
}

function padQuad(quad: [Point, Point, Point, Point], width: number): [Point, Point, Point, Point] {
  const center = quad.reduce(
    (current, point) => ({ x: current.x + point.x / 4, y: current.y + point.y / 4 }),
    { x: 0, y: 0 }
  );
  const padding = Math.max(6, Math.round(width * 0.01));
  return quad.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / distance) * padding,
      y: point.y + (dy / distance) * padding
    };
  }) as [Point, Point, Point, Point];
}

function polygonArea(points: [Point, Point, Point, Point]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

async function warpPerspective(
  raw: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  quad: [Point, Point, Point, Point]
) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const targetWidth = Math.max(
    1,
    Math.round((distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2)
  );
  const targetHeight = Math.max(
    1,
    Math.round((distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2)
  );
  const transform = solveHomography(
    [
      { x: 0, y: 0 },
      { x: targetWidth - 1, y: 0 },
      { x: targetWidth - 1, y: targetHeight - 1 },
      { x: 0, y: targetHeight - 1 }
    ],
    quad
  );
  const buffer = Buffer.alloc(targetWidth * targetHeight * 3, 255);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const denominator = transform[6] * x + transform[7] * y + 1;
      if (Math.abs(denominator) < 0.000001) continue;
      const sourceX = (transform[0] * x + transform[1] * y + transform[2]) / denominator;
      const sourceY = (transform[3] * x + transform[4] * y + transform[5]) / denominator;
      sampleBilinear(raw, sourceWidth, sourceHeight, sourceX, sourceY, buffer, (y * targetWidth + x) * 3);
    }
  }

  return { buffer, width: targetWidth, height: targetHeight };
}

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function solveHomography(source: Point[], target: Point[]) {
  const matrix = source.flatMap((point, index) => {
    const targetPoint = target[index];
    return [
      [point.x, point.y, 1, 0, 0, 0, -point.x * targetPoint.x, -point.y * targetPoint.x, targetPoint.x],
      [0, 0, 0, point.x, point.y, 1, -point.x * targetPoint.y, -point.y * targetPoint.y, targetPoint.y]
    ];
  });
  return gaussianElimination(matrix);
}

function gaussianElimination(matrix: number[][]) {
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  for (let column = 0; column < rows; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < rows; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) pivotRow = row;
    }
    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
    const pivot = matrix[column][column] || 1;
    for (let cell = column; cell < columns; cell += 1) matrix[column][cell] /= pivot;
    for (let row = 0; row < rows; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let cell = column; cell < columns; cell += 1) {
        matrix[row][cell] -= factor * matrix[column][cell];
      }
    }
  }
  return [...matrix.map((row) => row[columns - 1]), 1];
}

function sampleBilinear(
  raw: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  output: Buffer,
  outputOffset: number
) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return;
  const left = Math.floor(x);
  const top = Math.floor(y);
  const xRatio = x - left;
  const yRatio = y - top;
  for (let channel = 0; channel < 3; channel += 1) {
    const topLeft = raw[(top * width + left) * 3 + channel] ?? 255;
    const topRight = raw[(top * width + left + 1) * 3 + channel] ?? 255;
    const bottomLeft = raw[((top + 1) * width + left) * 3 + channel] ?? 255;
    const bottomRight = raw[((top + 1) * width + left + 1) * 3 + channel] ?? 255;
    const topValue = topLeft * (1 - xRatio) + topRight * xRatio;
    const bottomValue = bottomLeft * (1 - xRatio) + bottomRight * xRatio;
    output[outputOffset + channel] = Math.round(topValue * (1 - yRatio) + bottomValue * yRatio);
  }
}
