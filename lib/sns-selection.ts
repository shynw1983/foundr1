import { clampSnsTextLayer, getSnsTextVisibleBounds, layoutSnsText, SNS_TEXT_SAFE_BOTTOM, SNS_TEXT_SAFE_MARGIN, type SnsTextBounds, type SnsTextLayer } from './sns-typography.ts';
import { type SnsSnapGuide, type SnsTextSnapOptions, type SnsTextAnchor } from './sns-text-alignment.ts';

/** Stored groups are flat. Temporary multiselection always expands whole groups. */
export function expandSnsSelection(layers: readonly SnsTextLayer[], ids: readonly string[]) {
    const selected = new Set(ids);
    const groups = new Set(layers.filter(l => selected.has(l.id) && l.groupId).map(l => l.groupId));
    return layers.filter(l => selected.has(l.id) || (l.groupId && groups.has(l.groupId))).map(l => l.id);
}
export function cleanSnsGroups(layers: readonly SnsTextLayer[]): SnsTextLayer[] {
    const counts = new Map<string, number>();
    layers.forEach(l => { if (l.groupId) counts.set(l.groupId, (counts.get(l.groupId) ?? 0) + 1); });
    return layers.map(l => { if (!l.groupId || (counts.get(l.groupId) ?? 0) >= 2) return l; const copy = { ...l }; delete copy.groupId; return copy; });
}
export function getSnsSelectionBounds(ctx: CanvasRenderingContext2D, layers: readonly SnsTextLayer[], ids: readonly string[]): SnsTextBounds | null {
    const selected = new Set(ids);
    const bounds = layers.filter(l => selected.has(l.id)).map(l => getSnsTextVisibleBounds(layoutSnsText(ctx, l))).filter((b): b is SnsTextBounds => !!b);
    if (!bounds.length) return null;
    const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
    return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y };
}
/** Clamp ONE common translation against every member. Never spread a group at an edge. */
export function moveSnsSelection(ctx: CanvasRenderingContext2D, layers: readonly SnsTextLayer[], ids: readonly string[], dx: number, dy: number) {
    const selected = new Set(ids);
    let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
    const prepared = layers.map(l => selected.has(l.id) ? clampSnsTextLayer(ctx, l) : l);
    for (const l of prepared) {
        if (!selected.has(l.id)) continue;
        const layout = layoutSnsText(ctx, l), b = getSnsTextVisibleBounds(layout);
        if (!b) {
            minX = Math.max(minX, -l.width - l.x); maxX = Math.min(maxX, 1080 - l.x);
            minY = Math.max(minY, SNS_TEXT_SAFE_MARGIN - l.y); maxY = Math.min(maxY, SNS_TEXT_SAFE_BOTTOM - l.y);
            continue;
        }
        minX = Math.max(minX, SNS_TEXT_SAFE_MARGIN - b.x);
        maxX = Math.min(maxX, 1080 - SNS_TEXT_SAFE_MARGIN - b.x - b.width);
        minY = Math.max(minY, SNS_TEXT_SAFE_MARGIN - layout.y);
        maxY = Math.min(maxY, SNS_TEXT_SAFE_BOTTOM - layout.y - layout.height);
    }
    const x = Math.max(minX, Math.min(maxX, Number.isFinite(dx) ? dx : 0));
    const y = Math.max(minY, Math.min(maxY, Number.isFinite(dy) ? dy : 0));
    return prepared.map(l => selected.has(l.id) ? { ...l, x: l.x + x, y: l.y + y } : l);
}
function position(b: SnsTextBounds, axis: 'x' | 'y', anchor: SnsTextAnchor) {
    const size = axis === 'x' ? b.width : b.height;
    return b[axis] + (anchor === 'start' ? 0 : anchor === 'end' ? size : size / 2);
}
function same(a: SnsSnapGuide, b: SnsSnapGuide) {
    return a.axis === b.axis && a.kind === b.kind && a.layerId === b.layerId && a.anchor === b.anchor && a.sourceAnchor === b.sourceAnchor && Math.abs(a.position - b.position) <= .01;
}
export function snapSnsSelection(ctx: CanvasRenderingContext2D, input: readonly SnsTextLayer[], ids: readonly string[], dx: number, dy: number, options: SnsTextSnapOptions) {
    let layers = moveSnsSelection(ctx, input, ids, dx, dy);
    let bounds = getSnsSelectionBounds(ctx, layers, ids);
    const guides: SnsSnapGuide[] = [];
    if (!bounds || options.enabled === false || options.temporarilyDisabled) return { layers, bounds, guides };
    const selected = new Set(ids), scale = options.scale > 0 ? options.scale : 1;
    const others = input.filter(l => !selected.has(l.id)).map(l => ({ id: l.id, bounds: getSnsTextVisibleBounds(layoutSnsText(ctx, l)) })).filter((o): o is { id: string; bounds: SnsTextBounds } => !!o.bounds);
    const anchors: SnsTextAnchor[] = ['start', 'center', 'end'];
    for (const axis of ['x', 'y'] as const) {
        const candidates: SnsSnapGuide[] = [{ axis, position: axis === 'x' ? 540 : 960, kind: 'canvas', anchor: 'center', sourceAnchor: 'center' }];
        for (const other of others) for (const anchor of anchors) for (const sourceAnchor of anchors) candidates.push({ axis, position: position(other.bounds, axis, anchor), kind: 'layer', layerId: other.id, anchor, sourceAnchor });
        const active = bounds;
        const distance = (g: SnsSnapGuide) => g.position - position(active, axis, g.sourceAnchor);
        const previous = options.previousGuides?.find(g => g.axis === axis);
        const retained = previous && candidates.find(g => same(g, previous) && Math.abs(distance(g)) <= 10 / scale);
        const nearby = candidates.filter(g => Math.abs(distance(g)) <= 6 / scale).sort((a, b) => Number(b.kind === 'canvas') - Number(a.kind === 'canvas') || Math.abs(distance(a)) - Math.abs(distance(b)) || Number(b.anchor === b.sourceAnchor) - Number(a.anchor === a.sourceAnchor));
        const ordered = retained ? [retained, ...nearby.filter(g => !same(g, retained))] : nearby;
        for (const guide of ordered) {
            const d = distance(guide);
            const next = moveSnsSelection(ctx, layers, ids, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
            const b = getSnsSelectionBounds(ctx, next, ids);
            if (!b || Math.abs(position(b, axis, guide.sourceAnchor) - guide.position) > .01) continue;
            layers = next; bounds = b; guides.push(guide); break;
        }
    }
    return { layers, bounds, guides };
}
