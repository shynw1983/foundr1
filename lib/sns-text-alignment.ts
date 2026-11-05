import { clampSnsTextLayer, getSnsTextVisibleBounds, layoutSnsText, type SnsTextBounds, type SnsTextLayer } from "./sns-typography.ts";
export { getSnsTextVisibleBounds } from "./sns-typography.ts";
export type { SnsTextBounds } from "./sns-typography.ts";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const CAPTURE_SCREEN_PX = 6;
const RELEASE_SCREEN_PX = 10;
const POSITION_EPSILON = .01;

export type SnsTextAnchor = "start" | "center" | "end";
export type SnsTextSnapGuide = {
    axis: "x" | "y";
    position: number;
    kind: "canvas" | "layer";
    /** The target and dragged text anchors are separate for edge-to-edge alignment. */
    anchor: SnsTextAnchor;
    sourceAnchor: SnsTextAnchor;
    layerId?: string;
};
export type SnsSnapGuide = SnsTextSnapGuide;
export type SnsTextSnapOptions = {
    /** CSS pixels per composition pixel, e.g. preview.getBoundingClientRect().width / 1080. */
    scale: number;
    previousGuides?: readonly SnsTextSnapGuide[];
    enabled?: boolean;
    temporarilyDisabled?: boolean;
};
export type SnsTextSnapResult = {
    layer: SnsTextLayer;
    bounds: SnsTextBounds | null;
    guides: SnsTextSnapGuide[];
};

function anchorPosition(bounds: SnsTextBounds, axis: "x" | "y", anchor: SnsTextAnchor) {
    const start = axis === "x" ? bounds.x : bounds.y;
    const size = axis === "x" ? bounds.width : bounds.height;
    return start + (anchor === "start" ? 0 : anchor === "end" ? size : size / 2);
}
function visibleBounds(ctx: CanvasRenderingContext2D, layer: SnsTextLayer) {
    return getSnsTextVisibleBounds(layoutSnsText(ctx, layer));
}
function sameGuide(a: SnsTextSnapGuide, b: SnsTextSnapGuide) {
    return a.axis === b.axis && a.kind === b.kind && a.anchor === b.anchor &&
        a.sourceAnchor === b.sourceAnchor && a.layerId === b.layerId &&
        Math.abs(a.position - b.position) <= POSITION_EPSILON;
}

/**
 * Snap the ink, not the editable frame. Clamp every candidate and verify the result
 * before showing its line. Empty frame space may leave the canvas, but visible ink
 * remains safe; no resizing/reflow occurs while dragging.
 */
export function snapSnsTextLayer(
    ctx: CanvasRenderingContext2D,
    input: SnsTextLayer,
    otherLayers: readonly SnsTextLayer[],
    options: SnsTextSnapOptions
): SnsTextSnapResult {
    let layer = clampSnsTextLayer(ctx, input);
    let bounds = visibleBounds(ctx, layer);
    const guides: SnsTextSnapGuide[] = [];
    if (!bounds || options.enabled === false || options.temporarilyDisabled) return { layer, bounds, guides };
    const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
    const capture = CAPTURE_SCREEN_PX / scale;
    const release = RELEASE_SCREEN_PX / scale;
    const others = otherLayers.filter(other => other.id !== input.id).map(other => ({
        id: other.id, bounds: visibleBounds(ctx, other)
    })).filter((other): other is { id: string; bounds: SnsTextBounds } => !!other.bounds);
    const anchors: SnsTextAnchor[] = ["start", "center", "end"];

    for (const axis of ["x", "y"] as const) {
        const candidates: SnsTextSnapGuide[] = [{
            axis, kind: "canvas", position: (axis === "x" ? CANVAS_WIDTH : CANVAS_HEIGHT) / 2,
            anchor: "center", sourceAnchor: "center"
        }];
        for (const other of others) {
            for (const anchor of anchors) {
                for (const sourceAnchor of anchors) candidates.push({
                    axis, kind: "layer", layerId: other.id, anchor, sourceAnchor,
                    position: anchorPosition(other.bounds, axis, anchor)
                });
            }
        }
        const activeBounds = bounds;
        const distance = (guide: SnsTextSnapGuide) => guide.position - anchorPosition(activeBounds, axis, guide.sourceAnchor);
        const previous = options.previousGuides?.find(guide => guide.axis === axis);
        const retained = previous && candidates.find(guide => sameGuide(guide, previous) && Math.abs(distance(guide)) <= release);
        const nearby = candidates.filter(guide => Math.abs(distance(guide)) <= capture).sort((a, b) =>
            Number(b.kind === "canvas") - Number(a.kind === "canvas") ||
            Math.abs(distance(a)) - Math.abs(distance(b)) ||
            // Prefer like anchors when several candidates share an identical line.
            Number(b.anchor === b.sourceAnchor) - Number(a.anchor === a.sourceAnchor)
        );
        const ordered = retained ? [retained, ...nearby.filter(guide => !sameGuide(guide, retained))] : nearby;
        for (const guide of ordered) {
            const delta = distance(guide);
            const candidate = clampSnsTextLayer(ctx, { ...layer, [axis]: layer[axis] + delta });
            const candidateBounds = visibleBounds(ctx, candidate);
            if (!candidateBounds || Math.abs(anchorPosition(candidateBounds, axis, guide.sourceAnchor) - guide.position) > POSITION_EPSILON) continue;
            layer = candidate;
            bounds = candidateBounds;
            guides.push(guide);
            break;
        }
    }
    return { layer, bounds, guides };
}

/** Preserve wrapping and give every line the same visual center. */
export function centerSnsTextLayer(ctx: CanvasRenderingContext2D, input: SnsTextLayer, axis: "x" | "y" | "both"): SnsTextLayer {
    const horizontal = axis === "x" || axis === "both";
    const vertical = axis === "y" || axis === "both";
    let layer = clampSnsTextLayer(ctx, input);
    if (horizontal) layer = clampSnsTextLayer(ctx, { ...layer, align: "center", x: (CANVAS_WIDTH - layer.width) / 2 });
    const bounds = visibleBounds(ctx, layer);
    if (!bounds) return layer;
    layer = clampSnsTextLayer(ctx, {
        ...layer,
        x: layer.x + (horizontal ? CANVAS_WIDTH / 2 - anchorPosition(bounds, "x", "center") : 0),
        y: layer.y + (vertical ? CANVAS_HEIGHT / 2 - anchorPosition(bounds, "y", "center") : 0)
    });
    return layer;
}
