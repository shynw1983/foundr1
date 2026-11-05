import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSnsTextLayer, hitTestSnsText, layoutSnsText, type SnsTextLayer } from "../../lib/sns-typography.ts";
import { centerSnsTextLayer, getSnsTextVisibleBounds, snapSnsTextLayer, type SnsTextBounds } from "../../lib/sns-text-alignment.ts";

/** Distinct reference/ink metrics catch alignment to line boxes and side bearings. */
function context(): CanvasRenderingContext2D {
    const ctx = {
        font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic", letterSpacing: "0px",
        stack: [] as Array<Record<string, unknown>>,
        save() { this.stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, letterSpacing: this.letterSpacing }); },
        restore() { Object.assign(this, this.stack.pop()); },
        measureText(text: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
            const width = Array.from(text).reduce((sum, point) => sum + (point === " " ? .3 : .55) * size, 0);
            const reference = text === "Mgあ";
            return { width, actualBoundingBoxLeft: text.trim() ? -.05 * size : 0,
                actualBoundingBoxRight: text.trim() ? width - .03 * size : 0,
                actualBoundingBoxAscent: (reference ? .92 : text.trim() ? .7 : 0) * size,
                actualBoundingBoxDescent: (reference ? .26 : text.trim() ? .04 : 0) * size };
        }
    };
    return ctx as unknown as CanvasRenderingContext2D;
}
function layer(patch: Partial<SnsTextLayer> = {}): SnsTextLayer {
    return { id: "headline", text: "HEAT", x: 80, y: 180, width: 920, fontFamily: "sans", fontSize: 100,
        fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, align: "left", color: "#fff", shadow: false, ...patch };
}
function bounds(ctx: CanvasRenderingContext2D, input: SnsTextLayer): SnsTextBounds {
    const measured = getSnsTextVisibleBounds(layoutSnsText(ctx, input));
    assert.ok(measured);
    return measured;
}
function midpoint(rect: SnsTextBounds, axis: "x" | "y") {
    return axis === "x" ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < .001, `${actual} should equal ${expected}`); }

test("visible bounds use actual glyph ink, not the wide text frame or reference line box", () => {
    const ctx = context();
    const input = layer({ text: "HEAT\n\n", x: 80 });
    const layout = layoutSnsText(ctx, input);
    const ink = bounds(ctx, input);
    close(ink.x, 85);
    close(ink.width, 212);
    close(ink.y, 202);
    close(ink.height, 74);
    assert.ok(layout.height > ink.height * 3, "trailing blank lines occupy line slots but have no ink");
    assert.notEqual(midpoint(ink, "x"), layout.x + layout.width / 2);
    assert.notEqual(midpoint(ink, "y"), layout.y + layout.height / 2);
    assert.equal(getSnsTextVisibleBounds(layoutSnsText(ctx, layer({ text: " \n" }))), null);
});

test("horizontal and vertical center commands center real ink while preserving wrapping and tracking", () => {
    const ctx = context();
    const input = layer({ text: "HEAT\nYOUR BOWL\n", letterSpacing: 5 });
    const oldLines = layoutSnsText(ctx, input).lines.map(line => line.text);
    const centered = centerSnsTextLayer(ctx, input, "both");
    assert.equal(centered.align, "center");
    assert.equal(centered.width, input.width);
    assert.equal(centered.letterSpacing, input.letterSpacing);
    assert.deepEqual(layoutSnsText(ctx, centered).lines.map(line => line.text), oldLines);
    close(midpoint(bounds(ctx, centered), "x"), 540);
    close(midpoint(bounds(ctx, centered), "y"), 960);
    const horizontal = centerSnsTextLayer(ctx, input, "x");
    close(horizontal.y, input.y);
    const vertical = centerSnsTextLayer(ctx, input, "y");
    assert.equal(vertical.align, input.align);
    close(vertical.x, input.x);
    close(midpoint(bounds(ctx, vertical), "y"), 960);
});

test("punctuation wholly above the baseline keeps its negative descent and centers the visible mark", () => {
    const ctx = context();
    const measure = ctx.measureText.bind(ctx);
    ctx.measureText = (text: string) => {
        const metrics = measure(text);
        return text === "'" ? { ...metrics, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: -40 } : metrics;
    };
    const input = layer({ text: "'", width: 300 });
    close(bounds(ctx, input).height, 30);
    const centered = centerSnsTextLayer(ctx, input, "both");
    close(midpoint(bounds(ctx, centered), "x"), 540);
    close(midpoint(bounds(ctx, centered), "y"), 960);
});

test("center alignment shares one visible center across lines with different font side bearings", () => {
    const ctx = context();
    const measure = ctx.measureText.bind(ctx);
    ctx.measureText = (text: string) => {
        const metrics = measure(text);
        return text === "O" ? { ...metrics, actualBoundingBoxLeft: -15, actualBoundingBoxRight: 54 } :
            text === "'" ? { ...metrics, actualBoundingBoxLeft: -20, actualBoundingBoxRight: 35,
                actualBoundingBoxAscent: 70, actualBoundingBoxDescent: -40 } : metrics;
    };
    const input = layer({ text: "HEAT\nOO\n'", x: 90, width: 800, align: "center" });
    const layout = layoutSnsText(ctx, input);
    assert.deepEqual(layout.lines.map(line => line.text), ["HEAT", "OO", "'"]);
    for (const line of layout.lines) close((line.inkLeft! + line.inkRight!) / 2, 490);
    const centered = centerSnsTextLayer(ctx, input, "x");
    for (const line of layoutSnsText(ctx, centered).lines) close((line.inkLeft! + line.inkRight!) / 2, 540);
});

test("capture distance is six screen pixels at both compact and full preview scales", () => {
    const ctx = context();
    const centered = centerSnsTextLayer(ctx, layer({ width: 300 }), "x");
    for (const scale of [1, .5, .25]) {
        const within = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 5.5 / scale }, [], { scale });
        assert.equal(within.guides.find(guide => guide.axis === "x")?.kind, "canvas");
        close(midpoint(within.bounds!, "x"), 540);
        const outside = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 6.5 / scale }, [], { scale });
        assert.equal(outside.guides.some(guide => guide.axis === "x"), false);
    }
});

test("snapping applies independently to each axis and prioritizes the canvas center over nearby text", () => {
    const ctx = context();
    const centered = centerSnsTextLayer(ctx, layer({ width: 300 }), "both");
    const other = { ...centered, id: "subline", x: centered.x - 4, y: 300 };
    const result = snapSnsTextLayer(ctx, { ...centered, x: centered.x - 5, y: centered.y + 4 }, [other], { scale: 1 });
    assert.deepEqual(result.guides.map(guide => [guide.axis, guide.kind]), [["x", "canvas"], ["y", "canvas"]]);
    close(midpoint(result.bounds!, "x"), 540);
    close(midpoint(result.bounds!, "y"), 960);
    const verticalOnly = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 20, y: centered.y + 4 }, [], { scale: 1 });
    assert.deepEqual(verticalOnly.guides.map(guide => guide.axis), ["y"]);
    close(verticalOnly.layer.x, centered.x + 20);
});

test("wide left and right aligned text can be dragged to the true canvas center without changing style or wrapping", () => {
    const ctx = context();
    for (const align of ["left", "right"] as const) {
        const input = layer({ text: "HEAT\nOO", align, letterSpacing: 5 });
        const oldLayout = layoutSnsText(ctx, input);
        const dragged = { ...input, x: input.x + 540 - midpoint(bounds(ctx, input), "x") + 5 };
        const result = snapSnsTextLayer(ctx, dragged, [], { scale: 1 });
        assert.equal(result.guides.find(guide => guide.axis === "x")?.kind, "canvas");
        close(midpoint(result.bounds!, "x"), 540);
        assert.equal(result.layer.align, align);
        assert.equal(result.layer.width, input.width);
        assert.equal(result.layer.fontSize, input.fontSize);
        assert.equal(result.layer.letterSpacing, input.letterSpacing);
        assert.deepEqual(layoutSnsText(ctx, result.layer).lines.map(line => line.text), oldLayout.lines.map(line => line.text));
        assert.ok(align === "left" ? result.layer.x + result.layer.width > 1080 : result.layer.x < 0,
            "only the frame's empty area leaves the canvas");
        assert.equal(hitTestSnsText(ctx, [result.layer], midpoint(result.bounds!, "x"), midpoint(result.bounds!, "y")), input.id);
        assert.equal(hitTestSnsText(ctx, [result.layer], align === "left" ? 1070 : 10, midpoint(result.bounds!, "y")), null,
            "blank frame space does not become an invisible drag target");
    }
});

test("horizontal clamps protect actual ink at both safe edges for every alignment and font size", () => {
    const ctx = context();
    const measure = ctx.measureText.bind(ctx);
    ctx.measureText = (text: string) => {
        const metrics = measure(text);
        const size = Number(ctx.font.match(/([\d.]+)px/)?.[1] ?? 10);
        return text === "j" ? { ...metrics, actualBoundingBoxLeft: .12 * size, actualBoundingBoxRight: metrics.width + .08 * size } : metrics;
    };
    for (const align of ["left", "center", "right"] as const) {
        for (const fontSize of [8, 100, 240]) {
            for (const x of [-99999, 99999]) {
                const result = clampSnsTextLayer(ctx, layer({ text: "jHEAT", align, fontSize, x }));
                const ink = bounds(ctx, result);
                assert.ok(ink.x >= 32 - .001);
                assert.ok(ink.x + ink.width <= 1048 + .001);
                close(x < 0 ? ink.x : ink.x + ink.width, x < 0 ? 32 : 1048);
                assert.deepEqual(clampSnsTextLayer(ctx, result), result);
            }
        }
    }
});

test("guides never claim vertical center when the protected logo region makes it unreachable", () => {
    const ctx = context();
    const tall = layer({ text: Array(11).fill("HEAT").join("\n"), y: 1500 });
    const initial = bounds(ctx, tall);
    assert.ok(Math.abs(midpoint(initial, "y") - 960) < 6 / .1, "candidate is inside snap range");
    const result = snapSnsTextLayer(ctx, tall, [], { scale: .1 });
    assert.equal(result.guides.some(guide => guide.axis === "y"), false);
    assert.ok(midpoint(result.bounds!, "y") < 960);
});

test("other text layers offer actual left, center, right and vertical alignment while excluding self/empty text", () => {
    const ctx = context();
    const input = layer({ x: 150, y: 180, width: 300 });
    const other = layer({ id: "other", x: 154, y: 500, width: 300 });
    const result = snapSnsTextLayer(ctx, input, [input, layer({ id: "empty", text: " " }), other], { scale: 1 });
    const horizontal = result.guides.find(guide => guide.axis === "x");
    assert.equal(horizontal?.kind, "layer");
    assert.equal(horizontal?.layerId, "other");
    close(bounds(ctx, result.layer).x, bounds(ctx, other).x);
    assert.deepEqual(snapSnsTextLayer(ctx, input, [input, layer({ id: "empty", text: " " })], { scale: 1 }).guides, []);
    const target = layer({ id: "target", text: "HEATHE", x: 400, y: 500, width: 400 });
    const targetBounds = bounds(ctx, target);
    const inputBounds = bounds(ctx, input);
    for (const anchor of ["center", "end"] as const) {
        const desiredX = anchor === "center" ? midpoint(targetBounds, "x") - inputBounds.width / 2 : targetBounds.x + targetBounds.width - inputBounds.width;
        const dragged = { ...input, x: input.x + desiredX - inputBounds.x - 4 };
        const aligned = snapSnsTextLayer(ctx, dragged, [target], { scale: 1 });
        const guide = aligned.guides.find(guide => guide.axis === "x");
        assert.equal(guide?.anchor, anchor);
        assert.equal(guide?.sourceAnchor, anchor);
        const actual = bounds(ctx, aligned.layer);
        close(anchor === "center" ? midpoint(actual, "x") : actual.x + actual.width,
            anchor === "center" ? midpoint(targetBounds, "x") : targetBounds.x + targetBounds.width);
    }
    const tallTarget = layer({ id: "tall-target", text: "HEAT\nHEAT\nHEAT", x: 700, y: 500, width: 300 });
    const tallBounds = bounds(ctx, tallTarget);
    const dragged = { ...input, y: input.y + tallBounds.y + tallBounds.height - inputBounds.height - inputBounds.y - 4 };
    const vertical = snapSnsTextLayer(ctx, dragged, [tallTarget], { scale: 1 });
    assert.equal(vertical.guides.find(guide => guide.axis === "y")?.anchor, "end");
    close(bounds(ctx, vertical.layer).y + bounds(ctx, vertical.layer).height, tallBounds.y + tallBounds.height);
});

test("hysteresis retains an existing guide through ten screen pixels then releases it", () => {
    const ctx = context();
    const centered = centerSnsTextLayer(ctx, layer({ width: 300 }), "x");
    for (const scale of [1, .5]) {
        const captured = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 5 / scale }, [], { scale });
        const retained = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 9 / scale }, [], { scale, previousGuides: captured.guides });
        close(midpoint(retained.bounds!, "x"), 540);
        assert.equal(retained.guides[0].axis, "x");
        const fresh = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 9 / scale }, [], { scale });
        assert.deepEqual(fresh.guides, [], "a fresh candidate must satisfy capture distance");
        const released = snapSnsTextLayer(ctx, { ...centered, x: centered.x + 11 / scale }, [], { scale, previousGuides: retained.guides });
        assert.deepEqual(released.guides, []);
    }
});

test("the persistent toggle and temporary Alt bypass both snapping and retained guides", () => {
    const ctx = context();
    const centered = centerSnsTextLayer(ctx, layer({ width: 300 }), "x");
    const input = { ...centered, x: centered.x + 4 };
    const captured = snapSnsTextLayer(ctx, input, [], { scale: 1 });
    for (const bypass of [{ enabled: false }, { temporarilyDisabled: true }]) {
        const result = snapSnsTextLayer(ctx, input, [], { scale: 1, previousGuides: captured.guides, ...bypass });
        assert.deepEqual(result.guides, []);
        close(result.layer.x, input.x);
    }
});
