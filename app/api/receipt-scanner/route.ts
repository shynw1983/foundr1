import sharp from "sharp";
import { requireOsSession } from "../../../lib/api-auth";
import { validateImageUpload } from "../../../lib/upload-security";

const maxImageSizeBytes = 8 * 1024 * 1024;
const maxScanEdge = 1800;
const minDetectedReceiptRatio = 0.2;

export const runtime = "nodejs";

type Point = {
  x: number;
  y: number;
};

type ReceiptDetection = {
  crop: sharp.Region;
  quad?: [Point, Point, Point, Point];
};

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "レシート写真を選択してください。" }, { status: 400 });
  }
  validateImageUpload(file, maxImageSizeBytes, "レシート写真");

  const input = Buffer.from(await file.arrayBuffer());
  const normalized = sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: maxScanEdge,
      height: maxScanEdge,
      fit: "inside",
      withoutEnlargement: true
    });
  const metadata = await normalized.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    return Response.json({ error: "画像を読み込めませんでした。" }, { status: 400 });
  }

  const raw = await normalized
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer();
  const detection = detectReceipt(raw, width, height);
  const straightened = detection.quad
    ? await warpPerspective(raw, width, height, detection.quad)
    : await cropRaw(raw, width, detection.crop);
  const processed = await sharp(straightened.buffer, {
    raw: {
      width: straightened.width,
      height: straightened.height,
      channels: 3
    }
  })
    .greyscale()
    .normalize()
    .linear(1.35, -18)
    .threshold(176)
    .png({ compressionLevel: 9 })
    .toBuffer();

  return new Response(processed, {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }
  });
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
    return { crop: { left: 0, top: 0, width, height } };
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
  return quad ? { crop, quad } : { crop };
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
