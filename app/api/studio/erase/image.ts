import sharp from 'sharp';
import { aiOutputDimensions } from '../../../../lib/studio-ai-policy.ts';
import { STUDIO_ERASE_MASK_EDGE, STUDIO_ERASE_MAX_MASK_BASE64, STUDIO_ERASE_MAX_MASK_BYTES, STUDIO_ERASE_MIN_OPAQUE_PIXELS, STUDIO_ERASE_MAX_SELECTION } from '../../../../lib/studio-erase-policy.ts';
import { prepareErasePoisson, applyErasePoisson, type ErasePoissonPlan } from './poisson.ts';

export async function decodeEraseMask(value: unknown): Promise<Buffer> {
  if (typeof value !== 'string' || !value.length || value.length > STUDIO_ERASE_MAX_MASK_BASE64 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('ai_invalid_mask');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > STUDIO_ERASE_MAX_MASK_BYTES || bytes.toString('base64') !== value) throw new Error('ai_invalid_mask');
  const metadata = await sharp(bytes, { limitInputPixels: STUDIO_ERASE_MASK_EDGE ** 2 }).metadata();
  if (metadata.format !== 'png' || metadata.width !== STUDIO_ERASE_MASK_EDGE || metadata.height !== STUDIO_ERASE_MASK_EDGE || !metadata.hasAlpha || (metadata.pages || 1) !== 1) throw new Error('ai_invalid_mask');
  const alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer();
  let selected = 0, opaque = 0;
  for (const value of alpha) { if (value > 0) selected++; if (value === 255) opaque++; }
  if (opaque < STUDIO_ERASE_MIN_OPAQUE_PIXELS || selected > alpha.length * STUDIO_ERASE_MAX_SELECTION) throw new Error('ai_invalid_mask');
  return bytes;
}

type EraseRegion = { left: number; top: number; width: number; height: number };
export type ErasePrepared = { image: Buffer; mask: Buffer; alpha: Buffer; width: number; height: number; region: EraseRegion; collar: number; poisson: ErasePoissonPlan; placement: { x: number; y: number; width: number; height: number }; provider: ReturnType<typeof aiOutputDimensions> };

/** A close photographic context at the existing provider aspect, without changing its billed canvas size. */
export function eraseContextRegion(alpha: Uint8Array, width: number, height: number, providerWidth: number, providerHeight: number): EraseRegion {
  const full = { left: 0, top: 0, width, height };
  let left = width, top = height, right = -1, bottom = -1;
  for (let n = 0; n < alpha.length; n++) if (alpha[n]) { const x = n % width, y = Math.floor(n / width); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (right < 0 || Math.min(width, height) < 64) return full;
  const bw = right - left + 1, bh = bottom - top + 1, margin = Math.max(32, Math.ceil(Math.max(bw, bh) * .75)), ratio = providerWidth / providerHeight;
  let desiredWidth = Math.max(bw + margin * 2, (bh + margin * 2) * ratio), desiredHeight = desiredWidth / ratio;
  const fit = Math.min(1, width / desiredWidth, height / desiredHeight); desiredWidth *= fit; desiredHeight *= fit;
  let rh = Math.min(height, Math.max(1, Math.round(desiredHeight))), rw = Math.max(1, Math.round(rh * ratio));
  if (rw > width) { rw = width; rh = Math.max(1, Math.round(rw / ratio)); }
  // If a tiny/extreme photograph cannot supply a real crop of this aspect, keep the old contain geometry.
  if (rw < bw || rh < bh || rh > height || Math.abs(rw - rh * ratio) > 1 || rw < 32 || rh < 32 || rw * rh >= width * height * .95) return full;
  return { left: Math.min(width - rw, Math.max(0, Math.round((left + right + 1 - rw) / 2))), top: Math.min(height - rh, Math.max(0, Math.round((top + bottom + 1 - rh) / 2))), width: rw, height: rh };
}

export async function prepareEraseImage(source: Buffer, selection: Buffer, width: number, height: number): Promise<ErasePrepared> {
  // The normalized square avoids rounding mismatches when source dimensions are resized.
  const alpha = await sharp(selection).extractChannel('alpha').resize(width, height, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer();
  let sourceSelected = 0; for (const value of alpha) if (value > 0) sourceSelected++;
  if (sourceSelected === 0 || sourceSelected > alpha.length * STUDIO_ERASE_MAX_SELECTION) throw new Error('ai_invalid_mask');
  const poisson = prepareErasePoisson(alpha, width, height);
  const provider = aiOutputDimensions(width, height), region = eraseContextRegion(alpha, width, height, provider.width, provider.height);
  const full = region.left === 0 && region.top === 0 && region.width === width && region.height === height;
  const scale = Math.min(provider.width / width, provider.height / height);
  const placement = full ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), x: 0, y: 0 } : { width: provider.width, height: provider.height, x: 0, y: 0 };
  placement.x = Math.floor((provider.width - placement.width) / 2); placement.y = Math.floor((provider.height - placement.height) / 2);
  const resized = await sharp(source).extract(region).resize(placement.width, placement.height, { fit: 'fill' }).flatten({ background: '#ffffff' }).png().toBuffer();
  const image = full ? await sharp(resized).extend({ left: placement.x, top: placement.y, right: provider.width - placement.width - placement.x, bottom: provider.height - placement.height - placement.y, background: '#ffffff' }).png().toBuffer() : resized;
  // Let the model repair a small collar outside the final selection. The final compositor
  // still writes only the user's alpha mask, so the model's outer edit seam is not pasted in.
  const collar = Math.max(4, Math.min(12, Math.round(Math.min(region.width, region.height) * .025))), binary = Buffer.alloc(alpha.length);
  for (let n = 0; n < alpha.length; n++) if (alpha[n]) binary[n] = 255;
  // Installed Sharp/libvips morphology treats black as foreground: erode expands white.
  const providerAlpha = await sharp(binary, { raw: { width, height, channels: 1 } }).erode(collar).extract(region).resize(placement.width, placement.height, { fit: 'fill', kernel: 'nearest' }).greyscale().raw().toBuffer();
  const rawMask = Buffer.alloc(provider.width * provider.height * 4, 255);
  for (let y = 0; y < placement.height; y++) for (let x = 0; x < placement.width; x++) {
    // OpenAI edits fully transparent mask pixels. Every selected antialiased pixel is editable;
    // only the source-relative weights below decide which returned pixels are finally applied.
    if (providerAlpha[y * placement.width + x] > 0) rawMask[((y + placement.y) * provider.width + x + placement.x) * 4 + 3] = 0;
  }
  const mask = await sharp(rawMask, { raw: { width: provider.width, height: provider.height, channels: 4 } }).png().toBuffer();
  return { image, mask, alpha, width, height, region, collar, poisson, placement, provider };
}

/** Clone model gradients with true outside Dirichlet values; never use original object RGB as an interior anchor. */
export async function compositeEraseImage(source: Buffer, generated: Buffer, prepared: ErasePrepared): Promise<Buffer> {
  const { width, height, placement, alpha, provider, region } = prepared;
  const meta = await sharp(generated, { limitInputPixels: 8_294_400 }).metadata();
  if (meta.width !== provider.width || meta.height !== provider.height || (meta.pages || 1) !== 1) throw new Error('ai_failed');
  const original = await sharp(source).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const edited = await sharp(generated).extract({ left: placement.x, top: placement.y, width: placement.width, height: placement.height }).resize(region.width, region.height, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const cloned = Buffer.from(original);
  for (let y = 0; y < region.height; y++) edited.copy(cloned, ((y + region.top) * width + region.left) * 4, y * region.width * 4, (y + 1) * region.width * 4);
  applyErasePoisson(original, cloned, alpha, prepared.poisson);
  const output = Buffer.from(original);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const n = (y + region.top) * width + x + region.left;
    if (alpha[n] === 0) continue;
    const t = alpha[n] / 255, i = n * 4, before = original[i + 3] / 255, after = cloned[i + 3] / 255;
    const resultAlpha = (1 - t) * before + t * after;
    for (let c = 0; c < 3; c++) output[i + c] = resultAlpha > 0 ? Math.round(((1 - t) * before * original[i + c] + t * after * cloned[i + c]) / resultAlpha) : cloned[i + c];
    output[i + 3] = Math.round(resultAlpha * 255);
  }
  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
