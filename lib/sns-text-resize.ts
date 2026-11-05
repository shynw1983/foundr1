import {
    SNS_TEXT_MAX_FONT_SIZE, SNS_TEXT_MAX_FRAME_WIDTH, SNS_TEXT_MAX_WIDTH,
    SNS_TEXT_SAFE_BOTTOM, SNS_TEXT_SAFE_MARGIN,
    clampSnsTextLayer, getSnsTextVisibleBounds, layoutSnsText,
    type SnsTextBounds, type SnsTextLayer, type SnsTextLayout
} from "./sns-typography.ts";

const MIN_DIMENSION = .1;
const WIDTH_TOLERANCE = 1;
const SOLVE_TOLERANCE = .08;
const MAX_RESIZE_STEPS = 16;
const MAX_WRAP_STEPS = 30;

export type SnsTextResizeResult = { layer: SnsTextLayer; width: number; limited: boolean };
export type SnsTextMatchWidthsResult = { layers: SnsTextLayer[]; width: number; limited: boolean; matched: boolean };

function bounded(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
function center(bounds: SnsTextBounds) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
function sameLines(layout: SnsTextLayout, lines: readonly string[]) {
    return layout.lines.length === lines.length && layout.lines.every((line, i) => line.text === lines[i]);
}

/** The first changed line tells us which side of the original wrap boundary we are on. */
function wrapDirection(layout: SnsTextLayout, lines: readonly string[]) {
    for (let i = 0; i < Math.min(layout.lines.length, lines.length); i++) {
        if (layout.lines[i].text !== lines[i]) return layout.lines[i].text.length < lines[i].length ? 1 : -1;
    }
    return layout.lines.length > lines.length ? 1 : -1;
}

/**
 * Font ink can round to whole pixels at a new size. Adjust only the wrapping frame
 * when that crosses a word boundary; the user's paragraphs are never rewritten.
 */
function retainWrapping(ctx: CanvasRenderingContext2D, layer: SnsTextLayer, lines: readonly string[]) {
    const first = layoutSnsText(ctx, layer);
    if (sameLines(first, lines)) return { layer, layout: first };
    let low = MIN_DIMENSION, high = SNS_TEXT_MAX_FRAME_WIDTH;
    if (wrapDirection(first, lines) > 0) low = layer.width;
    else high = layer.width;
    // Search nearest the ideal frame first. Usually only a fraction of a pixel is needed.
    let width = bounded(layer.width + wrapDirection(first, lines) * Math.max(.25, layer.fontSize * .02), low, high);
    for (let i = 0; i < MAX_WRAP_STEPS; i++) {
        const candidate = { ...layer, width };
        const layout = layoutSnsText(ctx, candidate);
        if (sameLines(layout, lines)) return { layer: candidate, layout };
        if (wrapDirection(layout, lines) > 0) low = width;
        else high = width;
        width = (low + high) / 2;
        if (high - low < .00001) break;
    }
    return null;
}

/**
 * Resize actual glyph ink uniformly. Font size, tracking and the wrapping frame
 * share one scale; line-height remains a ratio. Preview and exports use this same
 * layer data, with no CSS-only transform or inserted line breaks.
 */
export function resizeSnsTextToWidth(
    ctx: CanvasRenderingContext2D, input: SnsTextLayer, targetWidth: number
): SnsTextResizeResult {
    const original = { ...clampSnsTextLayer(ctx, input), text: input.text };
    const originalLayout = layoutSnsText(ctx, original);
    const originalBounds = getSnsTextVisibleBounds(originalLayout);
    if (!originalBounds || originalBounds.width <= 0) return { layer: input, width: 0, limited: true };
    if (!Number.isFinite(targetWidth)) return { layer: original, width: originalBounds.width, limited: true };
    const target = bounded(targetWidth, 1, SNS_TEXT_MAX_WIDTH);
    const oldCenter = center(originalBounds);
    const lines = originalLayout.lines.map(line => line.text);
    const maxScale = Math.min(
        SNS_TEXT_MAX_FONT_SIZE / original.fontSize,
        SNS_TEXT_MAX_FRAME_WIDTH / original.width,
        SNS_TEXT_MAX_WIDTH / originalBounds.width,
        (SNS_TEXT_SAFE_BOTTOM - SNS_TEXT_SAFE_MARGIN) / originalLayout.height
    );
    const minScale = Math.max(MIN_DIMENSION / original.fontSize, MIN_DIMENSION / original.width);
    let scale = bounded(target / originalBounds.width, minScale, maxScale);
    let low = minScale, high = maxScale;
    let best = { layer: original, width: originalBounds.width };
    let bestError = Math.abs(best.width - target);

    for (let i = 0; i < MAX_RESIZE_STEPS; i++) {
        const proposed = {
            ...original,
            fontSize: original.fontSize * scale,
            letterSpacing: original.letterSpacing * scale,
            width: original.width * scale
        };
        const wrapped = retainWrapping(ctx, proposed, lines);
        if (!wrapped) {
            // A pathological font may have no frame that retains every wrap at
            // this size. Approach the known-good original instead of changing copy.
            scale = (scale + 1) / 2;
            continue;
        }
        if (wrapped.layout.fontSize < proposed.fontSize - .00001) {
            // Safety fitting must reduce the whole geometry, not font size alone.
            high = Math.min(high, scale * wrapped.layout.fontSize / proposed.fontSize);
            scale = bounded(high, low, maxScale);
            continue;
        }
        let layer = clampSnsTextLayer(ctx, wrapped.layer);
        const beforeMove = getSnsTextVisibleBounds(layoutSnsText(ctx, layer));
        if (!beforeMove) break;
        const nextCenter = center(beforeMove);
        layer = clampSnsTextLayer(ctx, {
            ...layer, x: layer.x + oldCenter.x - nextCenter.x, y: layer.y + oldCenter.y - nextCenter.y
        });
        const layout = layoutSnsText(ctx, layer);
        const bounds = getSnsTextVisibleBounds(layout);
        if (!bounds || !sameLines(layout, lines)) break;
        const error = Math.abs(bounds.width - target);
        if (error < bestError || (error === bestError && Math.abs(scale - 1) < .000001)) {
            best = { layer, width: bounds.width };
            bestError = error;
        }
        if (error <= SOLVE_TOLERANCE) break;
        if (bounds.width < target) low = Math.max(low, scale);
        else high = Math.min(high, scale);
        const proportional = scale * target / bounds.width;
        const next = proportional > low && proportional < high ? proportional : (low + high) / 2;
        if (Math.abs(next - scale) < .00000001 || high - low < .00000001) break;
        scale = next;
    }
    return { layer: { ...best.layer, text: input.text }, width: best.width, limited: target !== targetWidth || bestError > WIDTH_TOLERANCE };
}

/** Match nonempty layers to the reference's visible width within their shared safe range. */
export function matchSnsTextWidths(
    ctx: CanvasRenderingContext2D, layers: readonly SnsTextLayer[], referenceId: string
): SnsTextMatchWidthsResult {
    const visible = layers.map(layer => ({ layer, bounds: getSnsTextVisibleBounds(layoutSnsText(ctx, layer)) }))
        .filter((item): item is { layer: SnsTextLayer; bounds: SnsTextBounds } => !!item.bounds && item.bounds.width > 0);
    const reference = visible.find(item => item.layer.id === referenceId);
    if (!reference || visible.length < 2) return { layers: [...layers], width: reference?.bounds.width ?? 0, limited: !reference, matched: !!reference };
    const minimum = Math.max(...visible.map(({ layer }) => resizeSnsTextToWidth(ctx, layer, 1).width));
    const maximum = Math.min(...visible.map(({ layer }) => resizeSnsTextToWidth(ctx, layer, SNS_TEXT_MAX_WIDTH).width));
    // There may be no common width for an extremely long single line and a
    // very tall block. Keep every original layer instead of partially applying.
    if (minimum > maximum + WIDTH_TOLERANCE) return { layers: [...layers], width: reference.bounds.width, limited: true, matched: false };
    let target = bounded(reference.bounds.width, minimum, Math.max(minimum, maximum));
    let results = visible.map(({ layer }) => resizeSnsTextToWidth(ctx, layer, target));
    for (let i = 0; i < 4; i++) {
        const widths = results.map(result => result.width);
        if (Math.max(...widths) - Math.min(...widths) <= WIDTH_TOLERANCE) break;
        // A common attained width avoids opposite rounding errors around a
        // fractional target, particularly for one-glyph layers.
        target = bounded(Math.min(...widths), minimum, Math.max(minimum, maximum));
        results = visible.map(({ layer }) => resizeSnsTextToWidth(ctx, layer, target));
    }
    const byId = new Map(results.map(result => [result.layer.id, result]));
    const width = byId.get(referenceId)!.width;
    const spread = Math.max(...results.map(result => result.width)) - Math.min(...results.map(result => result.width));
    if (spread > WIDTH_TOLERANCE) return { layers: [...layers], width: reference.bounds.width, limited: true, matched: false };
    return {
        layers: layers.map(layer => byId.get(layer.id)?.layer ?? layer), width,
        limited: Math.abs(width - reference.bounds.width) > WIDTH_TOLERANCE || results.some(result => result.limited), matched: true
    };
}
