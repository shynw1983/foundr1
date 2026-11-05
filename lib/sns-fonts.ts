/** Versioned, self-hosted fonts for SNS Canvas previews and exports. */
export type SnsFontWeight = 400 | 500 | 700;
export type SnsFontId = "sans" | "serif" | "mono" |
    "noto-sans-jp" | "noto-serif-jp" | "zen-maru-gothic" | "shippori-mincho" |
    "inter" | "barlow-condensed" | "bodoni-moda" | "ibm-plex-mono";

type HostedFontId = Exclude<SnsFontId, "sans" | "serif" | "mono">;
type SnsFont = {
    id: SnsFontId;
    label: string;
    cssFamily: string;
    weights: readonly SnsFontWeight[];
    selfHosted: boolean;
};
const weights = [400, 500, 700] as const;
export const snsFonts: readonly SnsFont[] = [
    { id: "sans", label: "モダン・ゴシック", cssFamily: "Helvetica Neue", weights, selfHosted: false },
    { id: "serif", label: "エディトリアル・明朝", cssFamily: "Georgia", weights, selfHosted: false },
    { id: "mono", label: "ミニマル・等幅", cssFamily: "SFMono-Regular", weights, selfHosted: false },
    { id: "noto-sans-jp", label: "Noto Sans JP", cssFamily: "Foundr1 SNS v1 Noto Sans JP", weights, selfHosted: true },
    { id: "noto-serif-jp", label: "Noto Serif JP", cssFamily: "Foundr1 SNS v1 Noto Serif JP", weights, selfHosted: true },
    { id: "zen-maru-gothic", label: "Zen Maru Gothic", cssFamily: "Foundr1 SNS v1 Zen Maru Gothic", weights, selfHosted: true },
    { id: "shippori-mincho", label: "Shippori Mincho", cssFamily: "Foundr1 SNS v1 Shippori Mincho", weights, selfHosted: true },
    { id: "inter", label: "Inter", cssFamily: "Foundr1 SNS v1 Inter", weights, selfHosted: true },
    { id: "barlow-condensed", label: "Barlow Condensed", cssFamily: "Foundr1 SNS v1 Barlow Condensed", weights, selfHosted: true },
    { id: "bodoni-moda", label: "Bodoni Moda", cssFamily: "Foundr1 SNS v1 Bodoni Moda", weights, selfHosted: true },
    { id: "ibm-plex-mono", label: "IBM Plex Mono", cssFamily: "Foundr1 SNS v1 IBM Plex Mono", weights, selfHosted: true },
];

const legacyStacks = {
    sans: '"Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif',
    serif: 'Georgia, "Times New Roman", "Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", serif',
    mono: '"SFMono-Regular", Menlo, Consolas, monospace',
} as const;
const hosted: Record<HostedFontId, { variable: boolean; fallback?: "noto-sans-jp" | "noto-serif-jp"; generic: string }> = {
    "noto-sans-jp": { variable: true, generic: "sans-serif" },
    "noto-serif-jp": { variable: true, generic: "serif" },
    "zen-maru-gothic": { variable: false, fallback: "noto-sans-jp", generic: "sans-serif" },
    "shippori-mincho": { variable: false, fallback: "noto-serif-jp", generic: "serif" },
    inter: { variable: true, fallback: "noto-sans-jp", generic: "sans-serif" },
    "barlow-condensed": { variable: false, fallback: "noto-sans-jp", generic: "sans-serif" },
    "bodoni-moda": { variable: true, fallback: "noto-serif-jp", generic: "serif" },
    "ibm-plex-mono": { variable: false, fallback: "noto-sans-jp", generic: "monospace" },
};
const byId = new Map(snsFonts.map(font => [font.id, font]));
export function isSnsFontId(value: unknown): value is SnsFontId {
    return typeof value === "string" && byId.has(value as SnsFontId);
}
function definition(id: SnsFontId) {
    const font = byId.get(id);
    if (!font) throw new Error(`Unknown SNS font: ${String(id)}`);
    return font;
}
function isHosted(id: SnsFontId): id is HostedFontId {
    return Object.hasOwn(hosted, id);
}
export function snsFontStack(id: SnsFontId): string {
    const font = definition(id);
    if (!isHosted(id)) return legacyStacks[id];
    const config = hosted[id];
    const families = [font.cssFamily, ...(config.fallback ? [definition(config.fallback).cssFamily] : [])];
    return `${families.map(family => `"${family}"`).join(", ")}, ${config.generic}`;
}

export type SnsFontRequest = { fontFamily: SnsFontId; fontWeight: SnsFontWeight; text: string };
type Request = { id: HostedFontId; weight: SnsFontWeight; text: string };
type CheckedText = { ready: boolean; face?: FontFace; promise: Promise<void> };
type LoaderState = { faces: Map<string, Promise<FontFace>>; texts: Map<string, CheckedText> };
const states = new WeakMap<FontFaceSet, LoaderState>();
const MAX_TEXT_CHECKS = 256;
const LOAD_TIMEOUT_MS = 45_000;
export const SNS_FONT_LOAD_ERROR = "フォントを読み込めません。通信状態を確認して、もう一度お試しください。";
// Includes kana, CJK ideographs, full-width characters and Japanese punctuation.
const japaneseText = /[\u2e80-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3134f}]/u;

function requests(layers: readonly SnsFontRequest[]): Request[] {
    const result = new Map<string, Request>();
    for (const layer of layers) {
        definition(layer.fontFamily);
        if (!weights.includes(layer.fontWeight)) throw new Error("Unsupported SNS font weight");
        if (!layer.text.trim() || !isHosted(layer.fontFamily)) continue;
        const request = { id: layer.fontFamily, weight: layer.fontWeight, text: layer.text };
        result.set(textKey(request), request);
        const fallback = hosted[layer.fontFamily].fallback;
        if (fallback && japaneseText.test(layer.text)) {
            const fallbackRequest = { ...request, id: fallback };
            result.set(textKey(fallbackRequest), fallbackRequest);
        }
    }
    return [...result.values()];
}
function textKey(request: Request) {
    return JSON.stringify([request.id, request.weight, request.text]);
}
function shorthand(request: Request) {
    return `${request.weight} 32px "${definition(request.id).cssFamily}"`;
}
function stateFor(fonts: FontFaceSet) {
    let state = states.get(fonts);
    if (!state) { state = { faces: new Map(), texts: new Map() }; states.set(fonts, state); }
    return state;
}
async function withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(SNS_FONT_LOAD_ERROR)), LOAD_TIMEOUT_MS);
        })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}
function ensureFace(request: Request, fonts: FontFaceSet, state: LoaderState) {
    const variable = hosted[request.id].variable;
    const key = `${request.id}:${variable ? "variable" : request.weight}`;
    let promise = state.faces.get(key);
    if (!promise) {
        promise = Promise.resolve().then(async () => {
            const source = `/fonts/sns/v1/${request.id}/${variable ? "variable" : request.weight}.woff2`;
            const face = new FontFace(definition(request.id).cssFamily, `url("${source}") format("woff2")`, {
                style: "normal", weight: variable ? "400 700" : String(request.weight), display: "block",
            });
            await withTimeout(face.load());
            if (face.status !== "loaded") throw new Error(SNS_FONT_LOAD_ERROR);
            // Add only after successful loading; a timed-out request cannot activate later.
            fonts.add(face);
            return face;
        }).catch(error => {
            if (state.faces.get(key) === promise) state.faces.delete(key);
            throw error;
        });
        state.faces.set(key, promise);
    }
    return promise.then(face => { if (!fonts.has(face)) fonts.add(face); return face; });
}
function textReady(request: Request, fonts: FontFaceSet, checked?: CheckedText) {
    return !!checked?.ready && checked.face?.status === "loaded" && fonts.has(checked.face) &&
        fonts.check(shorthand(request), request.text);
}
async function ensureText(request: Request, fonts: FontFaceSet, state: LoaderState) {
    const key = textKey(request);
    const previous = state.texts.get(key);
    if (previous && (!previous.ready || textReady(request, fonts, previous))) return previous.promise;
    const checked: CheckedText = { ready: false, promise: Promise.resolve() };
    checked.promise = Promise.resolve().then(async () => {
        const face = await ensureFace(request, fonts, state);
        const loaded = await withTimeout(fonts.load(shorthand(request), request.text));
        // check() alone can return true for a nonexistent family. Require our
        // registered FontFace in the actual-text load result before rendering.
        if (!loaded.includes(face) || !fonts.has(face) || !fonts.check(shorthand(request), request.text)) {
            throw new Error(SNS_FONT_LOAD_ERROR);
        }
        checked.face = face;
        checked.ready = true;
        // Bound per-keystroke text caching without evicting in-flight work.
        for (const [oldKey, old] of state.texts) {
            if (state.texts.size <= MAX_TEXT_CHECKS) break;
            if (old.ready && oldKey !== key) state.texts.delete(oldKey);
        }
    }).catch(() => {
        if (state.texts.get(key) === checked) state.texts.delete(key);
        throw new Error(SNS_FONT_LOAD_ERROR);
    });
    state.texts.set(key, checked);
    return checked.promise;
}

/** Load only used hosted families/weights and activate them for the exact text. */
export async function ensureSnsFonts(layers: readonly SnsFontRequest[]): Promise<void> {
    const needed = requests(layers);
    if (!needed.length) return;
    if (typeof document === "undefined" || !document.fonts || typeof FontFace === "undefined") {
        throw new Error(SNS_FONT_LOAD_ERROR);
    }
    const fonts = document.fonts;
    const state = stateFor(fonts);
    await Promise.all(needed.map(request => ensureText(request, fonts, state)));
}

/** False until every used hosted face and actual-text/weight check has completed. */
export function areSnsFontsReady(layers: readonly SnsFontRequest[]): boolean {
    try {
        const needed = requests(layers);
        if (!needed.length) return true;
        if (typeof document === "undefined" || !document.fonts || typeof FontFace === "undefined") return false;
        const fonts = document.fonts;
        const state = states.get(fonts);
        return !!state && needed.every(request => textReady(request, fonts, state.texts.get(textKey(request))));
    } catch { return false; }
}
