import { test } from "node:test";
import assert from "node:assert/strict";
import { resizeSnsTextToWidth, matchSnsTextWidths } from "../../lib/sns-text-resize.ts";
import {
    SNS_TEXT_SAFE_MARGIN, SNS_TEXT_SAFE_BOTTOM, clampSnsTextLayer, getSnsTextVisibleBounds,
    layoutSnsText, type SnsTextLayer, type SnsTextBounds
} from "../../lib/sns-typography.ts";

function context(roundedInk = false): CanvasRenderingContext2D {
    const ctx = {
        font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic", letterSpacing: "0px",
        stack: [] as Array<Record<string, unknown>>,
        save() { this.stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, letterSpacing: this.letterSpacing }); },
        restore() { Object.assign(this, this.stack.pop()); },
        measureText(text: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
            const family = this.font.includes("Georgia") ? 1.08 : this.font.includes("Menlo") ? .95 : 1;
            const width = Array.from(text).reduce((sum, p) => sum + (p === " " ? .3 : /[\p{Mark}\uFE0F\u200D]/u.test(p) ? 0 : p === "W" ? .9 : /[A-Za-z]/.test(p) ? .55 : 1) * size * family, 0);
            const ink = (value: number) => roundedInk ? Math.round(value) : value;
            const blank = !text.trim();
            return { width, actualBoundingBoxLeft: blank ? 0 : ink((text.startsWith("j") ? .12 : -.04) * size),
                actualBoundingBoxRight: blank ? 0 : ink(width + (text.endsWith("f") ? .08 : -.025) * size),
                actualBoundingBoxAscent: ink((text === "'" ? .7 : .82) * size),
                actualBoundingBoxDescent: ink((text === "'" ? -.4 : .24) * size) };
        }
    };
    return ctx as unknown as CanvasRenderingContext2D;
}
function layer(patch: Partial<SnsTextLayer> = {}): SnsTextLayer {
    return { id: "headline", text: "HOT BOWL", x: 80, y: 180, width: 920, fontFamily: "sans", fontSize: 100,
        fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, align: "left", color: "#fff", shadow: false, ...patch };
}
function bounds(ctx: CanvasRenderingContext2D, value: SnsTextLayer): SnsTextBounds {
    const valueBounds = getSnsTextVisibleBounds(layoutSnsText(ctx, value));
    assert.ok(valueBounds);
    return valueBounds;
}
function close(actual: number, expected: number, tolerance = 1) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}
function safe(ctx: CanvasRenderingContext2D, value: SnsTextLayer) {
    const rect = bounds(ctx, value), layout = layoutSnsText(ctx, value);
    assert.ok(rect.x >= SNS_TEXT_SAFE_MARGIN - .01);
    assert.ok(rect.x + rect.width <= 1080 - SNS_TEXT_SAFE_MARGIN + .01);
    assert.ok(layout.y >= SNS_TEXT_SAFE_MARGIN - .01);
    assert.ok(layout.y + layout.height <= SNS_TEXT_SAFE_BOTTOM + .01);
}

test("actual-width resizing uniformly scales text, tracking and a wide wrapping frame", () => {
    const ctx = context();
    const input = layer({ text: "W", x: 494.25, letterSpacing: 3 });
    const original = clampSnsTextLayer(ctx, input), before = bounds(ctx, original);
    const resized = resizeSnsTextToWidth(ctx, input, 800);
    close(resized.width, 800);
    assert.equal(resized.limited, false);
    assert.ok(resized.layer.fontSize > 240, "short text is not held by the former font cap");
    assert.ok(resized.layer.width > 1016, "empty wrapping frame may exceed canvas width");
    const scale = resized.layer.fontSize / original.fontSize;
    close(resized.layer.width / original.width, scale, .00001);
    close(resized.layer.letterSpacing / original.letterSpacing, scale, .00001);
    assert.equal(resized.layer.lineHeight, original.lineHeight);
    assert.equal(resized.layer.text, input.text);
    const after = bounds(ctx, resized.layer);
    close(after.x + after.width / 2, before.x + before.width / 2, 1);
    safe(ctx, resized.layer);
});

test("English, Japanese, side bearings, punctuation and joined graphemes retain their content and wraps", () => {
    const ctx = context();
    for (const text of ["HOT BOWL CLUB TODAY", "今日の一杯を自分らしく", "jf", "'", "。", "A👩‍🍳e\u0301B", "HOT\n\nBOWL\n"]) {
        for (const align of ["left", "center", "right"] as const) {
            const input = layer({ text, align, width: 310, letterSpacing: 2, fontSize: 65 });
            const oldLines = layoutSnsText(ctx, input).lines.map(line => line.text);
            const resized = resizeSnsTextToWidth(ctx, input, 360);
            close(resized.width, 360);
            assert.equal(resized.layer.text, text);
            assert.deepEqual(layoutSnsText(ctx, resized.layer).lines.map(line => line.text), oldLines);
            assert.equal(resized.layer.align, align);
            safe(ctx, resized.layer);
        }
    }
});

test("resizing preserves the visible center when it fits and translates only to keep boundary safety", () => {
    const ctx = context();
    const input = clampSnsTextLayer(ctx, layer({ text: "jf\nHOT BOWL", x: 200, y: 600, width: 680, letterSpacing: 4, align: "center" }));
    const before = bounds(ctx, input);
    const resized = resizeSnsTextToWidth(ctx, input, 560);
    const after = bounds(ctx, resized.layer);
    close(after.x + after.width / 2, before.x + before.width / 2, .001);
    close(after.y + after.height / 2, before.y + before.height / 2, .001);
    const edge = resizeSnsTextToWidth(ctx, layer({ text: "W", x: 32, y: 1540 }), 750);
    close(edge.width, 750);
    safe(ctx, edge.layer);
});

test("height and logo safety limit scaling without changing the original line breaks", () => {
    const ctx = context();
    const input = layer({ text: Array(12).fill("あ").join("\n"), fontSize: 25, width: 900 });
    const oldLines = layoutSnsText(ctx, input).lines.map(line => line.text);
    const result = resizeSnsTextToWidth(ctx, input, 900);
    assert.equal(result.limited, true);
    assert.ok(result.width < 150);
    assert.deepEqual(layoutSnsText(ctx, result.layer).lines.map(line => line.text), oldLines);
    safe(ctx, result.layer);
    assert.ok(result.layer.fontSize > input.fontSize, "returns the largest safe enlargement");
});

test("negative and positive tracking scale as a ratio, including shrink sizes below old manual limits", () => {
    const ctx = context();
    for (const letterSpacing of [-8, 35]) {
        const input = layer({ text: "AB CD EF", letterSpacing });
        const result = resizeSnsTextToWidth(ctx, input, 70);
        close(result.width, 70);
        close(result.layer.letterSpacing / result.layer.fontSize, input.letterSpacing / input.fontSize, .000001);
        assert.ok(result.layer.fontSize < 24);
        safe(ctx, result.layer);
    }
});

test("a size round trip is stable and repeated clamp keeps the scaled result", () => {
    const ctx = context();
    const input = clampSnsTextLayer(ctx, layer({ text: "YOUR BOWL\n今日の気分", width: 720, letterSpacing: 4, fontSize: 76, x: 120, y: 480 }));
    const original = bounds(ctx, input);
    const bigger = resizeSnsTextToWidth(ctx, input, 750);
    const back = resizeSnsTextToWidth(ctx, bigger.layer, original.width);
    close(back.width, original.width, .01);
    close(back.layer.fontSize, input.fontSize, .01);
    close(back.layer.letterSpacing, input.letterSpacing, .01);
    close(back.layer.width, input.width, .01);
    assert.deepEqual(clampSnsTextLayer(ctx, bigger.layer), bigger.layer);
});

test("whole-pixel glyph metrics still reach requested widths and preserve threshold wrapping", () => {
    const ctx = context(true);
    for (const input of [layer({ text: "W", fontSize: 76 }), layer({ text: "jf HOT BOWL\n今日の気分", width: 346.5, fontSize: 81, letterSpacing: 3 })]) {
        const oldLines = layoutSnsText(ctx, input).lines.map(line => line.text);
        const result = resizeSnsTextToWidth(ctx, input, 523.7);
        close(result.width, 523.7);
        assert.deepEqual(layoutSnsText(ctx, result.layer).lines.map(line => line.text), oldLines);
        safe(ctx, result.layer);
    }
});

test("matching uses actual widths for different fonts and leaves empty layers untouched", () => {
    const ctx = context(true);
    const empty = layer({ id: "empty", text: " \n", x: 88 });
    const layers = [layer({ id: "ref", text: "HOT BOWL", fontFamily: "serif" }), layer({ id: "short", text: "W", fontSize: 35 }),
        layer({ id: "ja", text: "今日の気分", fontFamily: "mono", letterSpacing: 6 }), empty];
    const result = matchSnsTextWidths(ctx, layers, "ref");
    const widths = result.layers.filter(value => value.text.trim()).map(value => bounds(ctx, value).width);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1);
    close(result.width, bounds(ctx, layers[0]).width);
    assert.equal(result.layers[3], empty);
    for (let i = 0; i < layers.length; i++) assert.equal(result.layers[i].text, layers[i].text);
    result.layers.filter(value => value.text.trim()).forEach(value => safe(ctx, value));
});

test("matching preserves all eight layers and accepts the eighth layer as its reference", () => {
    const ctx = context(true);
    const texts = ["W", "YOUR BOWL", "今日の気分", "MIX IT", " \n", "LOVE IT", "麻辣湯", "MY WAY"];
    const layers = texts.map((text, index) => layer({
        id: `layer-${index}`, text, y: 100 + index * 140,
        fontSize: 35 + index * 4, fontFamily: index % 2 ? "mono" : "serif", letterSpacing: index % 3
    }));
    const referenceWidth = bounds(ctx, layers[7]).width;
    const result = matchSnsTextWidths(ctx, layers, layers[7].id);
    assert.equal(result.matched, true);
    assert.deepEqual(result.layers.map(value => value.id), layers.map(value => value.id));
    assert.deepEqual(result.layers.map(value => value.text), texts);
    assert.equal(result.layers[4], layers[4], "the empty fifth layer stays untouched");
    close(result.width, referenceWidth);
    for (const value of result.layers.filter(value => value.text.trim())) {
        close(bounds(ctx, value).width, referenceWidth);
        safe(ctx, value);
    }
});

test("matching finds a shared feasible width when a tall layer cannot reach the reference", () => {
    const ctx = context();
    const layers = [layer({ id: "ref", text: "HOT BOWL" }), layer({ id: "tall", text: Array(10).fill("あ").join("\n"), fontSize: 30 })];
    const result = matchSnsTextWidths(ctx, layers, "ref");
    assert.equal(result.limited, true);
    close(bounds(ctx, result.layers[0]).width, bounds(ctx, result.layers[1]).width);
    assert.ok(result.width < bounds(ctx, layers[0]).width);
    result.layers.forEach(value => safe(ctx, value));
});

test("empty text, missing reference and nonfinite widths are safe no-ops", () => {
    const ctx = context();
    const input = layer();
    assert.equal(resizeSnsTextToWidth(ctx, input, NaN).limited, true);
    close(resizeSnsTextToWidth(ctx, input, Infinity).width, bounds(ctx, input).width);
    const empty = layer({ text: " \n" });
    assert.deepEqual(resizeSnsTextToWidth(ctx, empty, 600), { layer: empty, width: 0, limited: true });
    assert.deepEqual(matchSnsTextWidths(ctx, [input], "missing"), { layers: [input], width: 0, limited: true, matched: false });
    const result = resizeSnsTextToWidth(ctx, input, 5000);
    assert.equal(result.limited, true);
    assert.ok(result.width <= 1016 + .01);
});

test("CRLF paragraphs remain byte-for-byte user input throughout resizing and matching", () => {
    const ctx = context();
    const input = layer({ text: "HOT BOWL\r\n今日の一杯\r\n\r\n", width: 740 });
    const result = resizeSnsTextToWidth(ctx, input, 600);
    assert.equal(result.layer.text, input.text);
    assert.deepEqual(layoutSnsText(ctx, result.layer).lines.map(line => line.text), layoutSnsText(ctx, input).lines.map(line => line.text));
    const matched = matchSnsTextWidths(ctx, [input, layer({ id: "other", text: "MY BOWL\r\nMY WAY" })], input.id);
    assert.equal(matched.matched, true);
    assert.equal(matched.layers[0].text, input.text);
    assert.equal(matched.layers[1].text, "MY BOWL\r\nMY WAY");
});

test("incompatible size ranges leave every original layer intact instead of partially matching", () => {
    const ctx = context();
    const singleLine = layer({ id: "line", text: "あ".repeat(180), width: 100000, fontSize: 5 });
    const tall = layer({ id: "tall", text: Array(180).fill("あ").join("\n"), fontSize: 1 });
    const result = matchSnsTextWidths(ctx, [singleLine, tall], "line");
    assert.equal(result.matched, false);
    assert.equal(result.limited, true);
    assert.equal(result.layers[0], singleLine);
    assert.equal(result.layers[1], tall);
});
