import { snsFontStack, type SnsFontId } from "./sns-fonts.ts";

/** Canvas typography shared by the editor, its hit targets, and image exports. */
export const SNS_TEXT_SAFE_BOTTOM = 1580;
export const SNS_TEXT_SAFE_MARGIN = 32;
export const SNS_TEXT_MAX_LAYERS = 8;
const CANVAS_WIDTH = 1080;
export const SNS_TEXT_MAX_WIDTH = CANVAS_WIDTH - 2 * SNS_TEXT_SAFE_MARGIN;
export const SNS_TEXT_MAX_FONT_SIZE = 4096;
// A short word may have a large empty frame after proportional scaling.
// The visible ink, rather than that empty frame, remains inside the canvas.
export const SNS_TEXT_MAX_FRAME_WIDTH = 1_000_000;

export type SnsTextLayer = {
    id: string;
    groupId?: string;
    text: string;
    x: number;
    y: number;
    width: number;
    fontFamily: SnsFontId;
    fontSize: number;
    fontWeight: 400 | 500 | 700;
    letterSpacing: number;
    lineHeight: number;
    align: "left" | "center" | "right";
    color: string;
    shadow: boolean;
};

export const snsTextLayouts = [
    { id: "cover", label: "モダン・カバー" },
    { id: "center", label: "セリフ・センター" },
    { id: "footer", label: "ミニマル・フッター" },
    { id: "split", label: "バイリンガル・スプリット" }
] as const;
export type SnsTextLayoutId = typeof snsTextLayouts[number]["id"];
export type SnsTextLine = {
    text: string; x: number; y: number; width: number;
    /** Actual glyph ink, excluding font side bearings and empty line slots. */
    inkLeft?: number; inkRight?: number; inkTop?: number; inkBottom?: number;
};
export type SnsTextLayout = {
    lines: SnsTextLine[];
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
};
export type SnsTextBounds = { x: number; y: number; width: number; height: number };

type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;
const segmenter = Segmenter ? new Segmenter("ja", { granularity: "grapheme" }) : null;
function graphemes(text: string) {
    if (segmenter) return Array.from(segmenter.segment(text), item => item.segment);
    // Code points are the portable fallback; attach combining marks and joined emoji.
    const result: string[] = [];
    for (const point of Array.from(text)) {
        if (result.length && (/^[\p{Mark}\uFE0F\u200D]$/u.test(point) || result[result.length - 1].endsWith("\u200D"))) {
            result[result.length - 1] += point;
        } else result.push(point);
    }
    return result;
}

function finite(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}
function bounded(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
function normalized(layer: SnsTextLayer): SnsTextLayer {
    // A fitted layer may be smaller than the editor's manual size range.
    const fontSize = bounded(finite(layer.fontSize, 90), .1, SNS_TEXT_MAX_FONT_SIZE);
    const width = bounded(finite(layer.width, 880), .1, SNS_TEXT_MAX_FRAME_WIDTH);
    return {
        ...layer,
        text: layer.text.replace(/\r\n?/g, "\n"),
        width,
        // Empty frame space may leave the canvas; layout clamps the visible ink.
        x: bounded(finite(layer.x, SNS_TEXT_SAFE_MARGIN), -width, CANVAS_WIDTH),
        y: bounded(finite(layer.y, SNS_TEXT_SAFE_MARGIN), SNS_TEXT_SAFE_MARGIN, SNS_TEXT_SAFE_BOTTOM),
        fontSize,
        letterSpacing: bounded(finite(layer.letterSpacing, 0), -fontSize * .12, fontSize * .5),
        lineHeight: bounded(finite(layer.lineHeight, 1.15), .8, 2.5)
    };
}

function configureFont(ctx: CanvasRenderingContext2D, layer: SnsTextLayer, fontSize: number) {
    ctx.font = `${layer.fontWeight} ${fontSize}px ${snsFontStack(layer.fontFamily)}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Tracking is drawn explicitly so preview/export also work in older WebViews.
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

type LineMeasure = { width: number; left: number; ascent: number; descent: number; inkLeft: number; inkRight: number; inkTop: number; inkBottom: number };
function measureLine(ctx: CanvasRenderingContext2D, text: string, tracking: number, fontSize: number): LineMeasure {
    let pen = 0, left = 0, right = 0, ascent = 0, descent = 0;
    let inkLeft = Infinity, inkRight = -Infinity;
    let inkTop = Infinity, inkBottom = -Infinity;
    const points = graphemes(text);
    for (let i = 0; i < points.length; i++) {
        const metric = ctx.measureText(points[i]);
        const glyphLeft = Number.isFinite(metric.actualBoundingBoxLeft) ? metric.actualBoundingBoxLeft : 0;
        const glyphRight = Number.isFinite(metric.actualBoundingBoxRight) ? metric.actualBoundingBoxRight : metric.width;
        left = Math.min(left, pen - glyphLeft);
        right = Math.max(right, pen + Math.max(metric.width, glyphRight));
        if (points[i].trim() && glyphLeft + glyphRight > 0) {
            inkLeft = Math.min(inkLeft, pen - glyphLeft);
            inkRight = Math.max(inkRight, pen + glyphRight);
            // Punctuation can live entirely above/below the baseline (negative
            // descent/ascent); the ink must not be padded back to baseline zero.
            inkTop = Math.min(inkTop, -finite(metric.actualBoundingBoxAscent, fontSize * .85));
            inkBottom = Math.max(inkBottom, finite(metric.actualBoundingBoxDescent, fontSize * .25));
        }
        ascent = Math.max(ascent, finite(metric.actualBoundingBoxAscent, fontSize * .85));
        descent = Math.max(descent, finite(metric.actualBoundingBoxDescent, fontSize * .25));
        pen += metric.width + (i < points.length - 1 ? tracking : 0);
    }
    return { width: right - left, left, ascent, descent, inkLeft, inkRight, inkTop, inkBottom };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number, tracking: number, fontSize: number) {
    const lines: string[] = [];
    const fits = (candidate: string) => measureLine(ctx, candidate, tracking, fontSize).width <= width + .001;
    for (const paragraph of text.split("\n")) {
        let current = "";
        for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
            if (/^\s+$/u.test(token)) {
                if (current && fits(current + token)) current += token;
                else if (current) { lines.push(current.trimEnd()); current = ""; }
                continue;
            }
            if (fits(current + token)) { current += token; continue; }
            if (current) { lines.push(current.trimEnd()); current = ""; }
            if (fits(token)) { current = token; continue; }
            for (const point of graphemes(token)) {
                if (current && !fits(current + point)) { lines.push(current); current = ""; }
                current += point;
            }
        }
        // Preserve explicit blank lines, including the final newline.
        lines.push(current.trimEnd());
    }
    return lines;
}

function measureLayout(ctx: CanvasRenderingContext2D, layer: SnsTextLayer, fontSize: number) {
    configureFont(ctx, layer, fontSize);
    const tracking = layer.letterSpacing * fontSize / layer.fontSize;
    const textLines = wrapText(ctx, layer.text, layer.width, tracking, fontSize);
    const measures = textLines.map(text => measureLine(ctx, text, tracking, fontSize));
    const reference = ctx.measureText("Mgあ");
    const ascent = Math.max(finite(reference.actualBoundingBoxAscent, fontSize * .85), ...measures.map(m => m.ascent));
    const descent = Math.max(finite(reference.actualBoundingBoxDescent, fontSize * .25), ...measures.map(m => m.descent));
    const step = fontSize * layer.lineHeight;
    const height = ascent + descent + Math.max(0, textLines.length - 1) * step;
    return { textLines, measures, ascent, height, tracking };
}

function localLineX(measure: LineMeasure, layer: SnsTextLayer) {
    const inkCenter = Number.isFinite(measure.inkLeft) ? (measure.inkLeft + measure.inkRight) / 2 - measure.left : measure.width / 2;
    return layer.align === "center" ? layer.width / 2 - inkCenter : layer.align === "right" ? layer.width - measure.width : 0;
}

function localInkBounds(measures: LineMeasure[], layer: SnsTextLayer) {
    const ink = measures.map(measure => ({
        left: localLineX(measure, layer) - measure.left + measure.inkLeft,
        right: localLineX(measure, layer) - measure.left + measure.inkRight
    })).filter(bounds => Number.isFinite(bounds.left) && Number.isFinite(bounds.right));
    if (!ink.length) return null;
    return { left: Math.min(...ink.map(bounds => bounds.left)), right: Math.max(...ink.map(bounds => bounds.right)) };
}

/** x/y describe a fixed-width block; line y positions are alphabetic baselines. */
export function layoutSnsText(ctx: CanvasRenderingContext2D, input: SnsTextLayer): SnsTextLayout {
    const layer = normalized(input);
    if (!layer.text.trim()) return { lines: [], x: layer.x, y: layer.y, width: layer.width, height: 0, fontSize: layer.fontSize };
    ctx.save();
    try {
        const maxHeight = SNS_TEXT_SAFE_BOTTOM - SNS_TEXT_SAFE_MARGIN;
        let fontSize = layer.fontSize;
        let measured = measureLayout(ctx, layer, fontSize);
        const fits = (candidate: ReturnType<typeof measureLayout>) => {
            const ink = localInkBounds(candidate.measures, layer);
            return candidate.height <= maxHeight && candidate.measures.every(line => line.width <= layer.width + .001) &&
                (!ink || ink.right - ink.left <= SNS_TEXT_MAX_WIDTH + .001);
        };
        // Keep every line: shrinking changes the wrapping too, so find the largest fit.
        if (!fits(measured)) {
            let low = .1, high = fontSize;
            for (let i = 0; i < 18; i++) {
                const mid = (low + high) / 2;
                const candidate = measureLayout(ctx, layer, mid);
                if (fits(candidate)) low = mid;
                else high = mid;
            }
            fontSize = low;
            measured = measureLayout(ctx, layer, fontSize);
        }
        const localX = measured.measures.map(measure => localLineX(measure, layer));
        const ink = localInkBounds(measured.measures, layer);
        const x = ink ? bounded(layer.x, SNS_TEXT_SAFE_MARGIN - ink.left, CANVAS_WIDTH - SNS_TEXT_SAFE_MARGIN - ink.right) : layer.x;
        const y = bounded(layer.y, SNS_TEXT_SAFE_MARGIN, SNS_TEXT_SAFE_BOTTOM - measured.height);
        return {
            x, y, width: layer.width, height: measured.height, fontSize,
            lines: measured.textLines.map((text, i) => {
                const measure = measured.measures[i];
                // Center each visible line on the same axis, including fonts with
                // asymmetric side bearings; wrapping still uses the unchanged frame.
                const lineX = x + localX[i];
                const baseline = y + measured.ascent + i * fontSize * layer.lineHeight;
                return {
                    text, x: lineX, y: baseline, width: measure.width,
                    ...(Number.isFinite(measure.inkLeft) ? {
                        inkLeft: lineX - measure.left + measure.inkLeft,
                        inkRight: lineX - measure.left + measure.inkRight,
                        inkTop: baseline + measure.inkTop,
                        inkBottom: baseline + measure.inkBottom
                    } : {})
                };
            })
        };
    } finally { ctx.restore(); }
}

export function clampSnsTextLayer(ctx: CanvasRenderingContext2D, input: SnsTextLayer): SnsTextLayer {
    const layer = normalized(input);
    const layout = layoutSnsText(ctx, layer);
    return {
        ...layer, x: layout.x, y: layout.y, width: layout.width, fontSize: layout.fontSize,
        letterSpacing: layer.letterSpacing * layout.fontSize / layer.fontSize
    };
}

/** Measured ink is shared by selection, snapping and drawing; empty line slots have no ink. */
export function getSnsTextVisibleBounds(layout: SnsTextLayout): SnsTextBounds | null {
    const lines = layout.lines.filter(line => line.text.trim() && line.width > 0);
    if (!lines.length) return null;
    const left = Math.min(...lines.map(line => line.inkLeft ?? line.x));
    const right = Math.max(...lines.map(line => line.inkRight ?? line.x + line.width));
    const top = Math.min(...lines.map(line => line.inkTop ?? layout.y));
    const bottom = Math.max(...lines.map(line => line.inkBottom ?? layout.y + layout.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export function drawSnsText(ctx: CanvasRenderingContext2D, layers: readonly SnsTextLayer[]) {
    for (const input of layers) {
        const layer = normalized(input);
        const layout = layoutSnsText(ctx, layer);
        if (!layout.lines.length) continue;
        ctx.save();
        try {
            configureFont(ctx, layer, layout.fontSize);
            ctx.fillStyle = layer.color;
            ctx.shadowColor = layer.shadow ? "rgba(0,0,0,.45)" : "transparent";
            ctx.shadowBlur = layer.shadow ? Math.min(12, layout.fontSize * .1) : 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = layer.shadow ? 2 : 0;
            const tracking = layer.letterSpacing * layout.fontSize / layer.fontSize;
            for (const line of layout.lines) {
                let pen = line.x - measureLine(ctx, line.text, tracking, layout.fontSize).left;
                for (const point of graphemes(line.text)) {
                    ctx.fillText(point, pen, line.y);
                    pen += ctx.measureText(point).width + tracking;
                }
            }
        } finally { ctx.restore(); }
    }
}

/** Last drawn visible block wins. Empty frame space cannot capture another layer. */
export function hitTestSnsText(ctx: CanvasRenderingContext2D, layers: readonly SnsTextLayer[], x: number, y: number) {
    for (let i = layers.length - 1; i >= 0; i--) {
        const bounds = getSnsTextVisibleBounds(layoutSnsText(ctx, layers[i]));
        if (bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) return layers[i].id;
    }
    return null;
}

export function createSnsTextLayers(layoutId: SnsTextLayoutId, headline: string, subline: string): SnsTextLayer[] {
    const base: Omit<SnsTextLayer, "id" | "text"> = {
        x: 80, y: 180, width: 920, fontFamily: "sans", fontSize: 128, fontWeight: 700,
        letterSpacing: 0, lineHeight: 1.02, align: "left", color: "#ffffff", shadow: true
    };
    const main: SnsTextLayer = { ...base, id: "headline", text: headline };
    const sub: SnsTextLayer = {
        ...base, id: "subline", text: subline, x: 86, y: 540, width: 908,
        fontFamily: "mono", fontSize: 28, fontWeight: 400, letterSpacing: 4, lineHeight: 1.4
    };
    if (layoutId === "center") {
        Object.assign(main, { x: 108, y: 700, width: 864, fontFamily: "serif", fontSize: 112, fontWeight: 400, letterSpacing: 1, lineHeight: 1.15, align: "center" });
        Object.assign(sub, { x: 140, y: 1060, width: 800, fontSize: 26, letterSpacing: 3, align: "center" });
    } else if (layoutId === "footer") {
        Object.assign(main, { x: 88, y: 1240, width: 904, fontSize: 88, fontWeight: 500, lineHeight: 1.1 });
        Object.assign(sub, { x: 92, y: 1480, width: 896, fontSize: 24, letterSpacing: 3 });
    } else if (layoutId === "split") {
        Object.assign(main, { fontSize: 128, lineHeight: 1 });
        Object.assign(sub, { y: 700, fontFamily: "serif", fontSize: 40, letterSpacing: 2, lineHeight: 1.45 });
    }
    return [main, sub];
}
