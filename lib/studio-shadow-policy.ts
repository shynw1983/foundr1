export type AssetShadow = {
  version: 1;
  enabled: boolean;
  mode: 'ground' | 'drop';
  view: 'front' | 'side' | 'overhead' | 'unknown';
  anchorX: number;
  anchorY: number;
  /** Degrees: zero points right and 90 points down in image coordinates. */
  angle: number;
  /** Projection length relative to image height. */
  length: number;
  width: number;
  flatten: number;
  /** Blur radius relative to the longer image dimension. */
  blur: number;
  opacity: number;
  contact: number;
  color: string;
  confidence?: 'low' | 'medium' | 'high';
  source: 'manual' | 'ai';
};

const keys = new Set(['version', 'enabled', 'mode', 'view', 'anchorX', 'anchorY', 'angle', 'length', 'width', 'flatten', 'blur', 'opacity', 'contact', 'color', 'confidence', 'source']);
function fail(): never { throw new Error('invalid_shadow'); }
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
}
/** Persisted values and model suggestions use the same strict, non-clamping boundary. */
export function validateAssetShadow(value: unknown): AssetShadow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const s = value as Record<string, unknown>;
  if (Object.keys(s).some(key => !keys.has(key)) || s.version !== 1 || typeof s.enabled !== 'boolean' ||
      typeof s.mode !== 'string' || !['ground', 'drop'].includes(s.mode) || typeof s.view !== 'string' || !['front', 'side', 'overhead', 'unknown'].includes(s.view) ||
      typeof s.source !== 'string' || !['manual', 'ai'].includes(s.source) || typeof s.color !== 'string' || !/^#[\da-f]{6}$/i.test(s.color) ||
      s.confidence !== undefined && (typeof s.confidence !== 'string' || !['low', 'medium', 'high'].includes(s.confidence))) return fail();
  return {
    version: 1, enabled: s.enabled, mode: s.mode as AssetShadow['mode'], view: s.view as AssetShadow['view'],
    anchorX: number(s.anchorX, 0, 1), anchorY: number(s.anchorY, 0, 1), angle: number(s.angle, -180, 180),
    length: number(s.length, 0, 1.5), width: number(s.width, .1, 2), flatten: number(s.flatten, .05, 1),
    blur: number(s.blur, 0, .2), opacity: number(s.opacity, 0, 1), contact: number(s.contact, 0, 1),
    color: s.color.toLowerCase(), source: s.source as AssetShadow['source'],
    ...(s.confidence !== undefined ? { confidence: s.confidence as AssetShadow['confidence'] } : {}),
  };
}
export function defaultAssetShadow(overrides: Partial<AssetShadow> = {}): AssetShadow {
  return validateAssetShadow({ version: 1, enabled: false, mode: 'ground', view: 'unknown', anchorX: .5, anchorY: .9,
    angle: 45, length: .35, width: 1, flatten: overrides.mode === 'drop' ? 1 : .18,
    blur: .035, opacity: .25, contact: .45, color: '#000000', source: 'manual', ...overrides });
}
