/** Store-owned standby layouts. Positions are percentages of the display canvas. */
export type PosDisplayStandbyFontFamily = 'standard' | 'georgia';

export type PosDisplayStandbyBlock = {
  id: string;
  /** Absent historical values remain visible; hidden blocks retain their full layout. */
  hidden?: boolean;
  type: 'clock' | 'text' | 'image' | 'storeName' | 'date' | 'weather' | 'wordCloud' | 'messages';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Percentage of the canvas's shorter side, independent of orientation. */
  fontSize: number;
  fontFamily: PosDisplayStandbyFontFamily;
  color: string;
  align: 'left' | 'center' | 'right';
  text: string;
  imageUrl: string;
  showDate: boolean;
  showYear?: boolean;
  /** Weather only; absent historical values retain the detailed display. */
  weatherDisplay?: 'details' | 'icon';
  motion?: 'gentle' | 'still';
  animationSeconds?: number;
  /** Per nonempty, trimmed phrase; null or an absent entry uses wordSizeMode. */
  wordFontSizes?: (number | null)[];
  wordSizeMode?: 'varied' | 'uniform';
  /** Cloud controls retain absent fields on older saved layouts. */
  wordDensity?: number;
  wordSizeContrast?: number;
  wordSpeedVariance?: number;
};

export type PosDisplayStandbySettings = {
  enabled: boolean;
  backgroundColor: string;
  layouts: {
    portrait: PosDisplayStandbyBlock[];
    landscape: PosDisplayStandbyBlock[];
  };
};

export const POS_DISPLAY_STANDBY_MAX_BLOCKS = 16;
const colorPattern = /^#[0-9a-f]{6}$/i;
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const blockTypes = new Set(['clock', 'text', 'image', 'storeName', 'date', 'weather', 'wordCloud', 'messages']);
const alignments = new Set(['left', 'center', 'right']);
const fontFamilies = new Set(['standard', 'georgia']);

/** Font choices are an allowlist; saved values never become arbitrary CSS. */
export function getPosDisplayStandbyFontFamily(value: PosDisplayStandbyFontFamily | undefined): string {
  return value === 'georgia' ? 'Georgia, "Times New Roman", serif' : 'inherit';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function defaultPosDisplayStandbySettings(): PosDisplayStandbySettings {
  const block = (id: string, type: PosDisplayStandbyBlock['type'], values: Partial<PosDisplayStandbyBlock>): PosDisplayStandbyBlock => ({
    id, type, x: 5, y: 5, width: 90, height: 15, fontSize: 6, fontFamily: 'standard', color: '#20332e',
    align: 'center', text: '', imageUrl: '', showDate: false, ...values
  });
  return {
    enabled: false,
    backgroundColor: '#fbfbf8',
    layouts: {
      portrait: [
        block('clock', 'clock', { x: 6, y: 5, width: 58, height: 17, fontSize: 10, align: 'left', showDate: true }),
        block('image', 'image', { x: 72, y: 5, width: 22, height: 17 }),
        block('welcome', 'text', { x: 6, y: 39, width: 88, height: 18, fontSize: 7, text: 'いらっしゃいませ' }),
        block('store', 'storeName', { x: 6, y: 61, width: 88, height: 12, fontSize: 5 })
      ],
      landscape: [
        block('clock', 'clock', { x: 5, y: 6, width: 43, height: 24, fontSize: 10, align: 'left', showDate: true }),
        block('image', 'image', { x: 76, y: 6, width: 19, height: 24 }),
        block('welcome', 'text', { x: 10, y: 39, width: 80, height: 22, fontSize: 7, text: 'いらっしゃいませ' }),
        block('store', 'storeName', { x: 10, y: 65, width: 80, height: 15, fontSize: 5 })
      ]
    }
  };
}

/** Optional components are drafts only; existing layouts never gain blocks automatically. */
export function createPosDisplayStandbyBlock(type: PosDisplayStandbyBlock['type'], id: string): PosDisplayStandbyBlock {
  const block: PosDisplayStandbyBlock = { id, type, x: 10, y: 35, width: 80, height: 20,
    fontSize: 8, fontFamily: 'standard', color: '#20352d', align: 'center',
    text: type === 'text' ? 'いらっしゃいませ' : '', imageUrl: '', showDate: true };
  if (type === 'date') return { ...block, x: 6, y: 7, width: 70, height: 14, fontSize: 5, showYear: true };
  if (type === 'weather') return { ...block, x: 6, y: 7, width: 52, height: 28, fontSize: 5 };
  if (type === 'wordCloud') return { ...block, x: 0, y: 25, width: 100, height: 48, fontSize: 7, fontFamily: 'georgia',
    text: 'Welcome\nいらっしゃいませ\n欢迎光临\n歡迎光臨\n어서 오세요\nXin chào\nस्वागत छ', motion: 'gentle', animationSeconds: 24 };
  if (type === 'messages') return { ...block, x: 10, y: 72, width: 80, height: 18, fontSize: 5,
    text: 'ご来店ありがとうございます\nどうぞ、ゆっくりお過ごしください\n今日もおいしい時間を', motion: 'gentle', animationSeconds: 8 };
  return block;
}

/** Raster images only; callers render the URL in an image element, never HTML. */
export function isSafePosDisplayStandbyImageUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > 2048 || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  if (!value.startsWith('https://') && !(value.startsWith('/') && !value.startsWith('//'))) return false;
  try {
    const url = new URL(value, 'https://standby.invalid');
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const path = decodeURIComponent(url.pathname);
    return !/[\\\u0000-\u001f\u007f<>]/.test(path) && !/\.svgz?(?:$|[/?#])/i.test(path);
  } catch {
    return false;
  }
}

function finiteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** One shared, deterministic size calculation for editor and display. */
export function getPosDisplayStandbyWordFontSize(block: PosDisplayStandbyBlock, index: number): number {
  const base = block.fontSize;
  const explicit = block.wordFontSizes?.[index];
  if (finiteRange(explicit, 2, 20)) return explicit;
  const phrases = block.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (block.wordSizeMode === 'uniform' || phrases.length < 2 || index < 0 || index >= phrases.length) return base;
  const ranked = phrases.map((phrase, phraseIndex) => {
    let seed = 2166136261;
    for (const character of `${block.id}:${phraseIndex}:${phrase}`) seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619);
    seed ^= seed >>> 16;
    seed = Math.imul(seed, 0x7feb352d);
    seed ^= seed >>> 15;
    return { index: phraseIndex, seed: seed >>> 0 };
  }).sort((a, b) => a.seed - b.seed || a.index - b.index);
  const rank = ranked.findIndex(phrase => phrase.index === index);
  const contrast = (block.wordSizeContrast ?? 50) / 100;
  const factor = 1 - 0.7 * contrast + rank / (phrases.length - 1) * contrast;
  return Math.max(2, Math.min(20, Math.round(base * factor * 2) / 2));
}

/** Keep explicit sizes with matching phrase occurrences when the textarea changes. */
export function reconcilePosDisplayStandbyWordFontSizes(previousText: string, previousSizes: (number | null)[] | undefined, nextText: string): (number | null)[] | undefined {
  if (previousSizes === undefined) return undefined;
  const byPhrase = new Map<string, (number | null)[]>();
  previousText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((phrase, index) => {
    const sizes = byPhrase.get(phrase) ?? [];
    sizes.push(previousSizes[index] ?? null);
    byPhrase.set(phrase, sizes);
  });
  return nextText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(phrase => byPhrase.get(phrase)?.shift() ?? null);
}

export function validatePosDisplayStandbySettings(value: unknown): { settings?: PosDisplayStandbySettings; error?: string } {
  const source = record(value);
  if (typeof source.enabled !== 'boolean') return { error: '待機画面の有効・無効を選択してください。' };
  if (typeof source.backgroundColor !== 'string' || !colorPattern.test(source.backgroundColor)) {
    return { error: '待機画面の背景色を正しく選択してください。' };
  }
  const layouts = record(source.layouts);
  const settings: PosDisplayStandbySettings = { enabled: source.enabled, backgroundColor: source.backgroundColor, layouts: { portrait: [], landscape: [] } };
  for (const orientation of ['portrait', 'landscape'] as const) {
    const label = orientation === 'portrait' ? '縦向き' : '横向き';
    const blocks = layouts[orientation];
    if (!Array.isArray(blocks) || blocks.length > POS_DISPLAY_STANDBY_MAX_BLOCKS) {
      return { error: `${label}の待機画面には${POS_DISPLAY_STANDBY_MAX_BLOCKS}個まで配置できます。` };
    }
    const ids = new Set<string>();
    for (let i = 0; i < blocks.length; i++) {
      const item = record(blocks[i]);
      const name = `${label}の${i + 1}番目の表示`;
      if (typeof item.id !== 'string' || !idPattern.test(item.id) || ids.has(item.id)) return { error: `${name}の識別情報を確認してください。` };
      ids.add(item.id);
      if (Object.prototype.hasOwnProperty.call(item, 'hidden') && typeof item.hidden !== 'boolean') return { error: '部品の表示設定を確認してください。' };
      if (typeof item.type !== 'string' || !blockTypes.has(item.type)) return { error: `${name}の種類を選択してください。` };
      if (!finiteRange(item.x, 0, 100) || !finiteRange(item.y, 0, 100)
        || !finiteRange(item.width, 0.1, 100) || !finiteRange(item.height, 0.1, 100)
        || item.x + item.width > 100.000001 || item.y + item.height > 100.000001) {
        return { error: `${name}の位置と大きさを画面内に収めてください。` };
      }
      if (!finiteRange(item.fontSize, 2, 20)) return { error: `${name}の文字サイズは2〜20で設定してください。` };
      // Layouts saved before font selection had no field. Keep their geometry
      // and enabled status, while rejecting an explicitly invalid font choice.
      if (Object.prototype.hasOwnProperty.call(item, 'fontFamily')
        && (typeof item.fontFamily !== 'string' || !fontFamilies.has(item.fontFamily))) {
        return { error: `${name}のフォントを選択してください。` };
      }
      if (typeof item.color !== 'string' || !colorPattern.test(item.color)) return { error: `${name}の文字色を正しく選択してください。` };
      if (typeof item.align !== 'string' || !alignments.has(item.align)) return { error: `${name}の文字揃えを選択してください。` };
      if (typeof item.text !== 'string' || item.text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.text)) {
        return { error: `${name}のテキストは500文字以内で入力してください。` };
      }
      if (typeof item.imageUrl !== 'string' || !isSafePosDisplayStandbyImageUrl(item.imageUrl)) {
        return { error: `${name}の画像にはHTTPSまたはサイト内の画像URLを指定してください。SVG形式は使用できません。` };
      }
      if (typeof item.showDate !== 'boolean') return { error: `${name}の日付表示を選択してください。` };
      if (Object.prototype.hasOwnProperty.call(item, 'showYear') && typeof item.showYear !== 'boolean') {
        return { error: `${name}の年の表示を選択してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'weatherDisplay') && item.weatherDisplay !== 'details' && item.weatherDisplay !== 'icon') {
        return { error: `${name}の天気の表示方法を選択してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'motion') && item.motion !== 'gentle' && item.motion !== 'still') {
        return { error: `${name}の動きを選択してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'animationSeconds') && !finiteRange(item.animationSeconds, 8, 90)) {
        return { error: `${name}の切り替え・移動時間は8〜90秒で設定してください。` };
      }
      if (item.type === 'wordCloud' || item.type === 'messages') {
        const lines = (item.text as string).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (!lines.length || lines.length > 12 || lines.some(line => Array.from(line).length > 80)) {
          return { error: `${name}の表示する文字は1〜12行、1行80文字以内で入力してください。` };
        }
      }
      if (Object.prototype.hasOwnProperty.call(item, 'wordFontSizes')
        && (!Array.isArray(item.wordFontSizes) || item.wordFontSizes.length > 12
          || Array.from(item.wordFontSizes).some(size => size !== null && !finiteRange(size, 2, 20))
          || (item.type === 'wordCloud' && item.wordFontSizes.length > item.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length))) {
        return { error: `${name}の各行の文字サイズは2〜20で設定し、表示する文字の行数に合わせてください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'wordSizeMode') && item.wordSizeMode !== 'varied' && item.wordSizeMode !== 'uniform') {
        return { error: `${name}の文字サイズの並べ方を選択してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'wordDensity') && !finiteRange(item.wordDensity, 50, 180)) {
        return { error: `${name}の文字の密度は50〜180で設定してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'wordSizeContrast') && !finiteRange(item.wordSizeContrast, 0, 100)) {
        return { error: `${name}の文字サイズの差は0〜100で設定してください。` };
      }
      if (Object.prototype.hasOwnProperty.call(item, 'wordSpeedVariance') && !finiteRange(item.wordSpeedVariance, 0, 40)) {
        return { error: `${name}の速度の差は0〜40で設定してください。` };
      }
      settings.layouts[orientation].push({
        id: item.id, type: item.type as PosDisplayStandbyBlock['type'],
        ...(Object.prototype.hasOwnProperty.call(item, 'hidden') ? { hidden: item.hidden as boolean } : {}),
        x: item.x, y: item.y, width: item.width, height: item.height,
        fontSize: item.fontSize, fontFamily: (item.fontFamily ?? 'standard') as PosDisplayStandbyFontFamily,
        color: item.color, align: item.align as PosDisplayStandbyBlock['align'],
        text: item.text, imageUrl: item.imageUrl, showDate: item.showDate,
        ...(item.type === 'date' ? { showYear: item.showYear !== false } : {}),
        ...(item.type === 'weather' && Object.prototype.hasOwnProperty.call(item, 'weatherDisplay') ? { weatherDisplay: item.weatherDisplay as 'details' | 'icon' } : {}),
        ...(item.type === 'wordCloud' || item.type === 'messages' ? {
          motion: (item.motion ?? 'gentle') as 'gentle' | 'still',
          animationSeconds: Number(item.animationSeconds ?? (item.type === 'wordCloud' ? 24 : 8))
        } : {}),
        ...(item.type === 'wordCloud' && Object.prototype.hasOwnProperty.call(item, 'wordFontSizes') ? { wordFontSizes: [...item.wordFontSizes as (number | null)[]] } : {}),
        ...(item.type === 'wordCloud' && Object.prototype.hasOwnProperty.call(item, 'wordSizeMode') ? { wordSizeMode: item.wordSizeMode as 'varied' | 'uniform' } : {}),
        ...(item.type === 'wordCloud' && Object.prototype.hasOwnProperty.call(item, 'wordDensity') ? { wordDensity: item.wordDensity as number } : {}),
        ...(item.type === 'wordCloud' && Object.prototype.hasOwnProperty.call(item, 'wordSizeContrast') ? { wordSizeContrast: item.wordSizeContrast as number } : {}),
        ...(item.type === 'wordCloud' && Object.prototype.hasOwnProperty.call(item, 'wordSpeedVariance') ? { wordSpeedVariance: item.wordSpeedVariance as number } : {})
      });
    }
  }
  return { settings };
}

/** Invalid saved layouts fall back to the existing standby experience. */
export function normalizePosDisplayStandbySettings(value: unknown): PosDisplayStandbySettings {
  return validatePosDisplayStandbySettings(value).settings ?? defaultPosDisplayStandbySettings();
}
