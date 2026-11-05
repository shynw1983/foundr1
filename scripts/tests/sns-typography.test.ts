import { test } from "node:test";
import assert from "node:assert/strict";
import { drawSns } from "../../lib/sns-composition.ts";
import {
    SNS_TEXT_SAFE_BOTTOM, SNS_TEXT_SAFE_MARGIN, clampSnsTextLayer, createSnsTextLayers,
    drawSnsText, getSnsTextVisibleBounds, hitTestSnsText, layoutSnsText, snsTextLayouts, type SnsTextLayer
} from "../../lib/sns-typography.ts";

/** Deterministic metrics exercise wrapping/geometry without relying on host fonts. */
function context() {
    const draws: Array<{ text: string; x: number; y: number; font: string }> = [];
    const operations: string[] = [];
    const ctx = {
        font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic", fillStyle: "", letterSpacing: "0px",
        shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        stack: [] as Array<Record<string, unknown>>,
        save() { this.stack.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, letterSpacing: this.letterSpacing }); },
        restore() { Object.assign(this, this.stack.pop()); },
        measureText(text: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
            const width = Array.from(text).reduce((sum, c) => sum + (c === " " ? .3 : /[A-Za-z]/.test(c) ? .55 : 1) * size, 0);
            return { width, actualBoundingBoxLeft: text.startsWith("j") ? .12 * size : 0,
                actualBoundingBoxRight: width + (text.endsWith("f") ? .08 * size : 0),
                actualBoundingBoxAscent: .82 * size, actualBoundingBoxDescent: .24 * size };
        },
        fillText(text: string, x: number, y: number) { draws.push({ text, x, y, font: this.font }); operations.push("text"); },
        fillRect() { operations.push("fill"); },
        drawImage(image: unknown) { operations.push(image === "logo" ? "logo" : "photo"); }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, operations };
}
function layer(patch: Partial<SnsTextLayer> = {}): SnsTextLayer {
    return { id: "test", text: "HOT BOWL", x: 80, y: 180, width: 800, fontFamily: "sans", fontSize: 100,
        fontWeight: 700, letterSpacing: 0, lineHeight: 1.2, align: "left", color: "#fff", shadow: false, ...patch };
}

test("English wraps at words; explicit and trailing newlines retain their line slots", () => {
    const { ctx } = context();
    const result = layoutSnsText(ctx, layer({ text: "HOT BOWL CLUB\nおいしい\n", width: 500 }));
    assert.deepEqual(result.lines.map(line => line.text), ["HOT BOWL", "CLUB", "おいしい", ""]);
    assert.ok(result.lines.every(line => line.width <= result.width));
    assert.ok(result.lines[3].y > result.lines[2].y);
    assert.equal(ctx.font, "10px sans-serif", "layout preserves context font");
});

test("Japanese and unspaced English wrap without losing characters", () => {
    const { ctx } = context();
    for (const text of ["今日の一杯を自分らしく", "EXTRASPICYGOODNESS", "麻辣湯\r\n今日の気分で"]) {
        const result = layoutSnsText(ctx, layer({ text, width: 220, letterSpacing: 4 }));
        assert.equal(result.lines.map(line => line.text).join(""), text.replace(/\r?\n/g, ""));
        assert.ok(result.lines.every(line => line.width <= result.width + .001));
    }
});

test("graphemes stay joined during wrapping and drawing", () => {
    const { ctx, draws } = context();
    const text = "A👩‍🍳e\u0301B";
    const result = layoutSnsText(ctx, layer({ text, width: 240, fontSize: 40 }));
    assert.equal(result.lines.map(line => line.text).join(""), text);
    assert.ok(!result.lines.some(line => /^[\u200d\p{Mark}]/u.test(line.text)));
    drawSnsText(ctx, [layer({ text, width: 240, fontSize: 40 })]);
    assert.deepEqual(draws.map(draw => draw.text), ["A", "👩‍🍳", "e\u0301", "B"]);
});

test("tracking and alignment use the same measured glyph bounds as drawing", () => {
    const { ctx, draws } = context();
    const plain = layoutSnsText(ctx, layer({ text: "AB", fontSize: 80, letterSpacing: 0 }));
    const tracked = layoutSnsText(ctx, layer({ text: "AB", fontSize: 80, letterSpacing: 12, align: "right" }));
    assert.equal(tracked.lines[0].width - plain.lines[0].width, 12);
    assert.equal(tracked.lines[0].x + tracked.lines[0].width, tracked.x + tracked.width);
    const input = layer({ text: "jf", width: 200, align: "center", fontSize: 80, letterSpacing: 5 });
    const layout = layoutSnsText(ctx, input);
    drawSnsText(ctx, [input]);
    assert.equal(draws[0].x - 80 * .12, layout.lines[0].x, "left overhang stays inside measured bounds");
    assert.ok(layout.lines[0].y - 80 * .82 >= layout.y - .001);
    assert.ok(layout.lines[0].y + 80 * .24 <= layout.y + layout.height + .001);
});

test("out-of-bounds blocks and long text fit above the complete-logo region", () => {
    const { ctx } = context();
    const input = layer({ text: Array(60).fill("一杯に、あなたらしさ。").join("\n"), x: -999, y: 1900, width: 1800, fontSize: 180, lineHeight: 1.4 });
    const result = layoutSnsText(ctx, input);
    const ink = getSnsTextVisibleBounds(result);
    assert.ok(ink);
    assert.ok(ink.x >= SNS_TEXT_SAFE_MARGIN - .001);
    assert.ok(ink.x + ink.width <= 1080 - SNS_TEXT_SAFE_MARGIN + .001);
    assert.ok(ink.width <= 1080 - 2 * SNS_TEXT_SAFE_MARGIN + .001, "empty frame space may extend beyond the canvas; visible ink stays safe");
    assert.ok(result.y >= SNS_TEXT_SAFE_MARGIN - .001);
    assert.ok(result.y + result.height <= SNS_TEXT_SAFE_BOTTOM + .001);
    assert.ok(result.fontSize < input.fontSize);
    assert.equal(result.lines.map(line => line.text).join(""), input.text.replaceAll("\n", ""));
    const clamped = clampSnsTextLayer(ctx, input);
    const stable = layoutSnsText(ctx, clamped);
    assert.ok(Math.abs(stable.height - result.height) < .01, "clamping does not change tracking or effective text size");
});

test("empty text has no hit target; overlapping layers select the last drawn block", () => {
    const { ctx } = context();
    const layers = [layer({ id: "back" }), layer({ id: "front", text: "今日の一杯" }), layer({ id: "empty", text: " \n" })];
    assert.equal(hitTestSnsText(ctx, layers, 100, 200), "front");
    assert.equal(hitTestSnsText(ctx, layers, 20, 20), null);
    assert.deepEqual(layoutSnsText(ctx, layers[2]).lines, []);
});

test("all eight text layers draw in order and remain individually selectable", () => {
    const { ctx, draws } = context();
    const layers = Array.from({ length: 8 }, (_, index) => layer({
        id: `layer-${index}`, text: String.fromCharCode(65 + index),
        x: 80, y: 100 + index * 170, fontSize: 40
    }));
    drawSnsText(ctx, layers);
    assert.deepEqual(draws.map(draw => draw.text), layers.map(value => value.text));
    for (const value of layers) {
        const bounds = getSnsTextVisibleBounds(layoutSnsText(ctx, value));
        assert.ok(bounds);
        assert.equal(hitTestSnsText(ctx, layers, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2), value.id);
    }
    const overlapping = layers.map(value => ({ ...value, y: 200 }));
    assert.equal(hitTestSnsText(ctx, overlapping, 90, 220), "layer-7", "the eighth layer remains on top when blocks overlap");
});

test("repeated clamping retains a fitted size below the manual editor range", () => {
    const { ctx } = context();
    const input = layer({ text: Array(180).fill("あ").join("\n"), fontSize: 180 });
    const first = clampSnsTextLayer(ctx, input);
    assert.ok(first.fontSize < 8);
    const second = clampSnsTextLayer(ctx, first);
    assert.deepEqual(second, first);
    const result = layoutSnsText(ctx, second);
    assert.ok(result.y + result.height <= SNS_TEXT_SAFE_BOTTOM + .001);
});

test("four templates retain editable content and draw above photo but beneath logo", () => {
    const { ctx, operations } = context();
    for (const preset of snsTextLayouts) {
        const layers = createSnsTextLayers(preset.id, "MAKE IT YOURS", "今日の気分で。");
        assert.deepEqual(layers.map(layer => layer.id), ["headline", "subline"]);
        assert.deepEqual(layers.map(layer => layer.text), ["MAKE IT YOURS", "今日の気分で。"]);
        for (const layer of layers) {
            const clamped = clampSnsTextLayer(ctx, layer);
            assert.deepEqual(clampSnsTextLayer(ctx, clamped), clamped);
            const layout = layoutSnsText(ctx, clamped);
            assert.ok(layout.y + layout.height <= SNS_TEXT_SAFE_BOTTOM);
        }
    }
    assert.equal(layoutSnsText(ctx, createSnsTextLayers("cover", "今日の気分を、", "SPICE YOUR DAY")[0]).lines.length, 1);
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const image = "photo" as unknown as CanvasImageSource, logo = "logo" as unknown as CanvasImageSource;
    const preset = { id: "A", label: "A · 原版ロゴ", x: 345, y: 1658, width: 390, height: 130 } as const;
    drawSns(canvas, image, { width: 1080, height: 1920 }, logo, preset, { zoom: 1, x: 0, y: 0 });
    assert.deepEqual(operations, ["fill", "photo", "logo"], "omitting overlay preserves old draw path");
    operations.length = 0;
    drawSns(canvas, image, { width: 1080, height: 1920 }, logo, preset, { zoom: 1, x: 0, y: 0 }, [layer()]);
    assert.equal(operations[0], "fill");
    assert.equal(operations[1], "photo");
    assert.equal(operations[2], "text");
    assert.equal(operations.at(-1), "logo");
});
