import { test } from "node:test";
import assert from "node:assert/strict";
import {
    cleanSnsGroups, expandSnsSelection, getSnsSelectionBounds, moveSnsSelection, snapSnsSelection,
} from "../../lib/sns-selection.ts";
import {
    clampSnsTextLayer, getSnsTextVisibleBounds, layoutSnsText,
    SNS_TEXT_SAFE_BOTTOM, SNS_TEXT_SAFE_MARGIN, type SnsTextLayer,
} from "../../lib/sns-typography.ts";

/** Deterministic metrics include left overhangs, positive side bearings, and punctuation above baseline. */
function context(): CanvasRenderingContext2D {
    const ctx = {
        font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic", letterSpacing: "0px",
        stack: [] as Array<Record<string, unknown>>,
        save() { this.stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, letterSpacing: this.letterSpacing }); },
        restore() { Object.assign(this, this.stack.pop()); },
        measureText(text: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
            const width = Array.from(text).reduce((sum, point) => sum + (point === " " ? .3 : point === "W" ? .9 : /[A-Za-z]/.test(point) ? .55 : 1) * size, 0);
            const blank = !text.trim();
            return {
                width,
                actualBoundingBoxLeft: blank ? 0 : (text.startsWith("j") ? .12 : -.04) * size,
                actualBoundingBoxRight: blank ? 0 : width + (text.endsWith("f") ? .08 : -.025) * size,
                actualBoundingBoxAscent: (text === "'" ? .7 : .82) * size,
                actualBoundingBoxDescent: (text === "'" ? -.4 : .24) * size,
            };
        },
    };
    return ctx as unknown as CanvasRenderingContext2D;
}
function layer(patch: Partial<SnsTextLayer> = {}): SnsTextLayer {
    return {
        id: "a", text: "HOT BOWL", x: 90, y: 100, width: 700, fontFamily: "sans", fontSize: 56,
        fontWeight: 700, letterSpacing: 2, lineHeight: 1.2, align: "left", color: "#ffffff", shadow: false, ...patch,
    };
}
function close(actual: number, expected: number, tolerance = .001) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}
function prepared(ctx: CanvasRenderingContext2D, values: SnsTextLayer[]) {
    return values.map(value => clampSnsTextLayer(ctx, value));
}
function bounds(ctx: CanvasRenderingContext2D, values: SnsTextLayer[], ids = values.map(value => value.id)) {
    const result = getSnsSelectionBounds(ctx, values, ids);
    assert.ok(result);
    return result;
}
function safe(ctx: CanvasRenderingContext2D, value: SnsTextLayer) {
    const layout = layoutSnsText(ctx, value), ink = getSnsTextVisibleBounds(layout);
    assert.ok(ink);
    assert.ok(ink.x >= SNS_TEXT_SAFE_MARGIN - .001);
    assert.ok(ink.x + ink.width <= 1080 - SNS_TEXT_SAFE_MARGIN + .001);
    assert.ok(layout.y >= SNS_TEXT_SAFE_MARGIN - .001);
    assert.ok(layout.y + layout.height <= SNS_TEXT_SAFE_BOTTOM + .001);
}
function sameTranslation(before: SnsTextLayer[], after: SnsTextLayer[], ids: string[]) {
    const chosen = before.filter(value => ids.includes(value.id));
    assert.ok(chosen.length);
    const first = after.find(value => value.id === chosen[0].id)!;
    const dx = first.x - chosen[0].x, dy = first.y - chosen[0].y;
    for (const value of before) {
        const result = after.find(next => next.id === value.id)!;
        assert.ok(result);
        if (ids.includes(value.id)) {
            close(result.x - value.x, dx); close(result.y - value.y, dy);
            assert.deepEqual({ ...result, x: value.x, y: value.y }, value, "translation preserves every style, group and text field");
        } else assert.equal(result, value, "unselected layers keep their original object");
    }
    return { dx, dy };
}

test("group selection expands every existing group once in draw order and ignores stale ids", () => {
    const values = [layer({ id: "a", groupId: "one" }), layer({ id: "b", groupId: "one" }),
        layer({ id: "c", groupId: "two" }), layer({ id: "d", groupId: "two" }), layer({ id: "e" })];
    assert.deepEqual(expandSnsSelection(values, ["b", "e", "c", "stale", "b"]), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(expandSnsSelection(values, []), []);
    assert.deepEqual(expandSnsSelection(values, ["stale"]), []);
});

test("union bounds use visible glyph ink for mixed alignments and ignore empty and unselected layers", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "jf", align: "right", width: 900, x: 40 }),
        layer({ id: "b", text: "'", align: "center", width: 800, x: 100, y: 700 }),
        layer({ id: "empty", text: " \n", y: 1500 }), layer({ id: "outside", text: "W", x: 500, y: 1200 })]);
    const result = bounds(ctx, values, ["a", "b", "empty"]);
    const a = getSnsTextVisibleBounds(layoutSnsText(ctx, values[0]))!;
    const b = getSnsTextVisibleBounds(layoutSnsText(ctx, values[1]))!;
    close(result.x, Math.min(a.x, b.x)); close(result.y, Math.min(a.y, b.y));
    close(result.width, Math.max(a.x + a.width, b.x + b.width) - result.x);
    close(result.height, Math.max(a.y + a.height, b.y + b.height) - result.y);
    assert.equal(getSnsSelectionBounds(ctx, values, ["empty", "stale"]), null);
});

test("all four safety edges clamp one shared delta without spreading mixed-alignment group members", () => {
    const ctx = context();
    const values = prepared(ctx, [
        layer({ id: "a", groupId: "group", text: "jf", x: 80, y: 100, width: 500, fontSize: 70 }),
        layer({ id: "b", groupId: "group", text: "HOT BOWL", x: 200, y: 800, width: 700, fontSize: 50, align: "center" }),
        layer({ id: "c", groupId: "group", text: "W", x: 50, y: 1350, width: 900, fontSize: 90, align: "right" }),
        layer({ id: "untouched", text: "OTHER", x: 320, y: 500 }),
    ]);
    const ids = ["a", "b", "c"], original = structuredClone(values);
    for (const [dx, dy] of [[-99999, -99999], [99999, 99999], [-99999, 99999], [99999, -99999]]) {
        const result = moveSnsSelection(ctx, values, ids, dx, dy);
        const actual = sameTranslation(values, result, ids);
        assert.ok(Math.abs(actual.dx) < Math.abs(dx)); assert.ok(Math.abs(actual.dy) < Math.abs(dy));
        result.filter(value => ids.includes(value.id)).forEach(value => safe(ctx, value));
    }
    assert.deepEqual(values, original, "movement never mutates the input document");
});

test("later members of an eight-layer document move together while the first four remain untouched", () => {
    const ctx = context();
    const values = prepared(ctx, Array.from({ length: 8 }, (_, index) => layer({
        id: `layer-${index}`, groupId: index >= 4 ? "last-four" : undefined,
        text: index % 2 ? "jf" : "今日", x: 90 + index * 30, y: 90 + index * 140, fontSize: 40,
        align: index % 2 ? "right" : "left", width: 500,
    })));
    const ids = expandSnsSelection(values, ["layer-7"]);
    assert.deepEqual(ids, ["layer-4", "layer-5", "layer-6", "layer-7"]);
    const result = moveSnsSelection(ctx, values, ids, 22, 35);
    assert.equal(result.length, 8);
    assert.deepEqual(sameTranslation(values, result, ids), { dx: 22, dy: 35 });
});

test("empty members share coordinate constraints so post-movement normalization cannot spread their group", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "visible", groupId: "group", y: 100 }),
        layer({ id: "empty", groupId: "group", text: "", y: 1500 })]);
    const ids = ["visible", "empty"];
    const moved = moveSnsSelection(ctx, values, ids, 0, 100);
    assert.deepEqual(sameTranslation(values, moved, ids), { dx: 0, dy: 80 });
    const normalized = moved.map(value => clampSnsTextLayer(ctx, value));
    assert.deepEqual(normalized, moved, "the editor's later font-resolution clamp keeps both positions intact");
    sameTranslation(values, normalized, ids);

    const atEdges = prepared(ctx, [layer({ id: "a", text: "", x: 1070, y: 40 }),
        layer({ id: "b", text: " \n", x: -680, y: 1500 })]);
    for (const [dx, dy] of [[999, 999], [-999, -999]]) {
        const result = moveSnsSelection(ctx, atEdges, ["a", "b"], dx, dy);
        sameTranslation(atEdges, result, ["a", "b"]);
        assert.deepEqual(result.map(value => clampSnsTextLayer(ctx, value)), result, "all-empty selections also stay stable after normalization");
    }
});

test("snapping centers the union rather than centering either member and retains relative positions", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "HOT", x: 310, y: 500, width: 300, fontSize: 50 }),
        layer({ id: "b", text: "jf", x: 650, y: 1100, width: 300, fontSize: 50 })]);
    const ids = ["a", "b"], original = bounds(ctx, values), toCenter = 540 - original.x - original.width / 2;
    const result = snapSnsSelection(ctx, values, ids, toCenter - 10, 0, { scale: .5 });
    const union = bounds(ctx, result.layers);
    close(union.x + union.width / 2, 540);
    assert.ok(result.guides.some(guide => guide.axis === "x" && guide.kind === "canvas"));
    sameTranslation(values, result.layers, ids);
    for (const value of result.layers) {
        const ink = getSnsTextVisibleBounds(layoutSnsText(ctx, value))!;
        assert.ok(Math.abs(ink.x + ink.width / 2 - 540) > 50, "neither individual member was centered");
    }
});

test("union snap hysteresis captures at six screen pixels and releases after ten", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "HOT", x: 310, y: 500, width: 300, fontSize: 50 }),
        layer({ id: "b", text: "jf", x: 650, y: 1100, width: 300, fontSize: 50 })]);
    const ids = ["a", "b"], original = bounds(ctx, values), toCenter = 540 - original.x - original.width / 2;
    const first = snapSnsSelection(ctx, values, ids, toCenter - 10, 0, { scale: .5 });
    const retained = snapSnsSelection(ctx, values, ids, toCenter - 18, 0, { scale: .5, previousGuides: first.guides });
    assert.ok(retained.guides.some(guide => guide.axis === "x"));
    close(bounds(ctx, retained.layers).x + bounds(ctx, retained.layers).width / 2, 540);
    const released = snapSnsSelection(ctx, values, ids, toCenter - 22, 0, { scale: .5, previousGuides: retained.guides });
    assert.ok(!released.guides.some(guide => guide.axis === "x"));
    close(bounds(ctx, released.layers).x + bounds(ctx, released.layers).width / 2, 518);
});

test("group snapping uses outside visible edges and never targets its own members", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "HOT", x: 100, y: 450, width: 250, fontSize: 40 }),
        layer({ id: "b", text: "jf", x: 300, y: 1100, width: 250, fontSize: 40 }),
        layer({ id: "outside", text: "W", x: 730, y: 350, width: 250, fontSize: 40 })]);
    const ids = ["a", "b"], original = bounds(ctx, values, ids);
    const target = getSnsTextVisibleBounds(layoutSnsText(ctx, values[2]))!;
    const result = snapSnsSelection(ctx, values, ids, target.x - original.x - 5, 0, { scale: 1 });
    close(bounds(ctx, result.layers, ids).x, target.x);
    assert.ok(result.guides.some(guide => guide.axis === "x" && guide.layerId === "outside"));
    assert.ok(result.guides.every(guide => !guide.layerId || !ids.includes(guide.layerId)));
    sameTranslation(values, result.layers, ids);
    const selfOnly = snapSnsSelection(ctx, values.slice(0, 2), ids, 0, 0, { scale: 1 });
    assert.ok(selfOnly.guides.every(guide => guide.kind === "canvas"));
});

test("Alt bypass and a disabled toggle skip union snapping but retain safe common translation", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "HOT", x: 310, y: 500, width: 300, fontSize: 50 }),
        layer({ id: "b", text: "jf", x: 650, y: 1100, width: 300, fontSize: 50 })]);
    const ids = ["a", "b"], original = bounds(ctx, values), dx = 540 - original.x - original.width / 2 - 4;
    const ordinary = snapSnsSelection(ctx, values, ids, dx, 0, { scale: 1 });
    for (const options of [{ temporarilyDisabled: true }, { enabled: false }]) {
        const result = snapSnsSelection(ctx, values, ids, dx, 0, { scale: 1, previousGuides: ordinary.guides, ...options });
        assert.deepEqual(result.guides, []);
        assert.deepEqual(result.layers, moveSnsSelection(ctx, values, ids, dx, 0));
        close(bounds(ctx, result.layers).x + bounds(ctx, result.layers).width / 2, 536);
        sameTranslation(values, result.layers, ids);
    }
});

test("logo protection limits the whole group and never displays an unreachable vertical-center guide", () => {
    const ctx = context();
    const values = prepared(ctx, [layer({ id: "a", text: "TOP", x: 200, y: 32, fontSize: 40 }),
        layer({ id: "b", text: "BOTTOM", x: 250, y: 1500, fontSize: 60 })]);
    const ids = ["a", "b"], original = bounds(ctx, values);
    const result = snapSnsSelection(ctx, values, ids, 0, 960 - original.y - original.height / 2, { scale: .25 });
    sameTranslation(values, result.layers, ids);
    result.layers.forEach(value => safe(ctx, value));
    assert.ok(!result.guides.some(guide => guide.axis === "y" && guide.kind === "canvas"));
});

test("deleting one group member clears only the leftover singleton, and explicit ungrouping keeps coordinates", () => {
    const values = [layer({ id: "a", groupId: "one" }), layer({ id: "b", groupId: "one" }),
        layer({ id: "c", groupId: "two", x: 200 }), layer({ id: "d", groupId: "two", y: 900 }), layer({ id: "plain" })];
    const original = structuredClone(values);
    const cleaned = cleanSnsGroups(values.filter(value => value.id !== "b"));
    assert.equal(cleaned[0].groupId, undefined);
    assert.equal(cleaned[1], values[2]); assert.equal(cleaned[2], values[3]); assert.equal(cleaned[3], values[4]);
    const ids = new Set(expandSnsSelection(cleaned, ["d"]));
    const ungrouped = cleanSnsGroups(cleaned.map(value => {
        if (!ids.has(value.id)) return value;
        const next = { ...value }; delete next.groupId; return next;
    }));
    for (let index = 0; index < cleaned.length; index++) {
        const before = { ...cleaned[index] }, after = { ...ungrouped[index] };
        delete before.groupId; delete after.groupId;
        assert.deepEqual(after, before);
    }
    assert.ok(ungrouped.every(value => !value.groupId));
    assert.deepEqual(values, original, "group cleanup and ungrouping do not mutate original layers");
});
