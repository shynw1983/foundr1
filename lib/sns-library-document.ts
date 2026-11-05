export const snsLibraryFontIds = ["sans", "serif", "mono", "noto-sans-jp", "noto-serif-jp", "zen-maru-gothic", "shippori-mincho", "inter", "barlow-condensed", "bodoni-moda", "ibm-plex-mono"] as const;
export type SnsLibraryTextLayer = {
  id: string; text: string; x: number; y: number; width: number;
  fontFamily: typeof snsLibraryFontIds[number]; fontSize: number; fontWeight: 400 | 500 | 700;
  letterSpacing: number; lineHeight: number; align: "left" | "center" | "right";
  color: string; shadow: boolean; groupId?: string;
};
export type SnsLibraryDocument = {
  version: 1; presetId: "A" | "B"; logoColor: "black" | "white";
  crop: { zoom: number; x: number; y: number }; textLayers: SnsLibraryTextLayer[];
  format: "image/png" | "image/jpeg"; caption: string; photoWidth: number; photoHeight: number;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const number = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const layerId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function normalizeSnsColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
}
export function normalizeSnsTemplateName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80 ? value.trim() : null;
}
export function normalizeSnsLibraryDocument(value: unknown): SnsLibraryDocument | null {
  if (!record(value)) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) return null; } catch { return null; }
  const { crop } = value;
  if (value.version !== 1 || !["A", "B"].includes(String(value.presetId)) || !["black", "white"].includes(String(value.logoColor)) ||
    !record(crop) || !number(crop.zoom, 1, 4) || !number(crop.x, -100000, 100000) || !number(crop.y, -100000, 100000) ||
    !["image/png", "image/jpeg"].includes(String(value.format)) || typeof value.caption !== "string" || value.caption.length > 4000 ||
    !number(value.photoWidth, 1, 16000) || !Number.isInteger(value.photoWidth) || !number(value.photoHeight, 1, 16000) || !Number.isInteger(value.photoHeight) ||
    value.photoWidth * value.photoHeight > 80000000 || Math.max(value.photoWidth, value.photoHeight) / Math.min(value.photoWidth, value.photoHeight) > 8 ||
    !Array.isArray(value.textLayers) || value.textLayers.length > 8) return null;
  const layers: SnsLibraryTextLayer[] = [], ids = new Set<string>();
  for (const item of value.textLayers) {
    if (!record(item) || !layerId(item.id) || ids.has(item.id) || typeof item.text !== "string" || item.text.length > 180 ||
      !number(item.x, -1000000, 1080) || !number(item.y, 32, 1580) || !number(item.width, .1, 1000000) ||
      !snsLibraryFontIds.includes(item.fontFamily as typeof snsLibraryFontIds[number]) || !number(item.fontSize, .1, 4096) ||
      ![400, 500, 700].includes(item.fontWeight as number) || !number(item.letterSpacing, -500, 2048) || !number(item.lineHeight, .8, 2.5) ||
      !["left", "center", "right"].includes(String(item.align)) || typeof item.shadow !== "boolean" || !normalizeSnsColor(item.color) ||
      (item.groupId !== undefined && !layerId(item.groupId))) return null;
    ids.add(item.id);
    layers.push({ id: item.id, text: item.text, x: item.x, y: item.y, width: item.width,
      fontFamily: item.fontFamily as SnsLibraryTextLayer["fontFamily"], fontSize: item.fontSize, fontWeight: item.fontWeight as SnsLibraryTextLayer["fontWeight"],
      letterSpacing: item.letterSpacing, lineHeight: item.lineHeight, align: item.align as SnsLibraryTextLayer["align"],
      color: normalizeSnsColor(item.color)!, shadow: item.shadow, ...(item.groupId ? { groupId: item.groupId as string } : {}) });
  }
  return { version: 1, presetId: value.presetId as "A" | "B", logoColor: value.logoColor as "black" | "white",
    crop: { zoom: crop.zoom, x: crop.x, y: crop.y }, textLayers: layers, format: value.format as SnsLibraryDocument["format"],
    caption: value.caption, photoWidth: value.photoWidth, photoHeight: value.photoHeight };
}
