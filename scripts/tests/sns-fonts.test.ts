import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    snsFonts, snsFontStack, isSnsFontId, ensureSnsFonts, areSnsFontsReady,
    SNS_FONT_LOAD_ERROR, type SnsFontId, type SnsFontWeight,
} from "../../lib/sns-fonts.ts";

const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const savedFontFace = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
let faceFailures = 0;
let activationFailures = 0;
let returnForeignFaces = false;
let checkResult = true;
let releaseFace: (() => void) | undefined;
let faceGate: Promise<void> | undefined;
let made: FakeFace[];
let activations: Array<{ css: string; text: string }>;
let fontSet: Set<FakeFace> & { load: (css: string, text: string) => Promise<FakeFace[]>; check: () => boolean };

class FakeFace {
    status = "unloaded";
    family: string;
    source: string;
    descriptors: { weight: string };
    constructor(family: string, source: string, descriptors: { weight: string }) {
        this.family = family; this.source = source; this.descriptors = descriptors; made.push(this);
    }
    async load() {
        this.status = "loading";
        if (faceGate) await faceGate;
        if (faceFailures-- > 0) { this.status = "error"; throw new Error("fixture asset failure"); }
        this.status = "loaded";
        return this;
    }
}
function request(fontFamily: SnsFontId, text = "YOUR BOWL", fontWeight: SnsFontWeight = 400) {
    return { fontFamily, text, fontWeight };
}
function installDocument() {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { fonts: fontSet } });
    Object.defineProperty(globalThis, "FontFace", { configurable: true, value: FakeFace });
}
beforeEach(() => {
    faceFailures = 0; activationFailures = 0; returnForeignFaces = false; checkResult = true;
    releaseFace = undefined; faceGate = undefined; made = []; activations = [];
    fontSet = Object.assign(new Set<FakeFace>(), {
        async load(css: string, text: string) {
            activations.push({ css, text });
            if (activationFailures-- > 0) throw new Error("fixture activation failure");
            if (returnForeignFaces) return [];
            const family = css.match(/"([^"]+)"$/)?.[1];
            return [...fontSet].filter(face => face.family === family && face.status === "loaded");
        },
        check: () => checkResult,
    });
    installDocument();
});
afterEach(() => {
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument); else Reflect.deleteProperty(globalThis, "document");
    if (savedFontFace) Object.defineProperty(globalThis, "FontFace", savedFontFace); else Reflect.deleteProperty(globalThis, "FontFace");
});

test("eleven stable IDs preserve all three historical system stacks", () => {
    assert.equal(snsFonts.length, 11);
    assert.equal(new Set(snsFonts.map(font => font.id)).size, 11);
    assert.equal(snsFonts.filter(font => font.selfHosted).length, 8);
    assert.ok(snsFonts.every(font => JSON.stringify(font.weights) === "[400,500,700]"));
    assert.equal(snsFontStack("sans"), '"Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif');
    assert.equal(snsFontStack("serif"), 'Georgia, "Times New Roman", "Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", serif');
    assert.equal(snsFontStack("mono"), '"SFMono-Regular", Menlo, Consolas, monospace');
    assert.equal(isSnsFontId("inter"), true);
    assert.equal(isSnsFontId("missing-font"), false);
});

test("legacy and empty layers need no FontFace APIs or remote assets", async () => {
    Reflect.deleteProperty(globalThis, "document"); Reflect.deleteProperty(globalThis, "FontFace");
    const layers = [request("sans"), request("serif"), request("mono"), request("noto-sans-jp", " \n")];
    assert.equal(areSnsFontsReady(layers), true);
    await ensureSnsFonts(layers);
    assert.equal(made.length, 0);
    assert.equal(areSnsFontsReady([request("inter")]), false);
    await assert.rejects(ensureSnsFonts([request("inter")]), { message: SNS_FONT_LOAD_ERROR });
});

test("Latin-only content loads its hosted variable face and verifies the actual text and weight", async () => {
    const layers = [request("inter", "MAKE IT YOUR BOWL", 500)];
    assert.equal(areSnsFontsReady(layers), false);
    await ensureSnsFonts(layers);
    assert.equal(areSnsFontsReady(layers), true);
    assert.equal(made.length, 1);
    assert.ok(made[0].source.includes("/fonts/sns/v1/inter/variable.woff2"));
    assert.equal(made[0].descriptors.weight, "400 700");
    assert.deepEqual(activations, [{ css: '500 32px "Foundr1 SNS v1 Inter"', text: "MAKE IT YOUR BOWL" }]);
});

test("mixed Japanese loads self-hosted Noto fallback before declaring Latin or decorative fonts ready", async () => {
    for (const [id, fallback] of [["inter", "Noto Sans JP"], ["bodoni-moda", "Noto Serif JP"], ["zen-maru-gothic", "Noto Sans JP"]] as const) {
        const layers = [request(id, `${id} MY BOWL 今日の気分。`, 700)];
        const start = activations.length;
        await ensureSnsFonts(layers);
        assert.equal(areSnsFontsReady(layers), true);
        const checks = activations.slice(start);
        assert.ok(checks.some(check => check.css.includes(fallback) && check.css.startsWith("700 ")));
        assert.ok(checks.every(check => check.text === layers[0].text));
        assert.ok(snsFontStack(id).includes(`Foundr1 SNS v1 ${fallback}`));
    }
});

test("static families use the requested real weight; variable families reuse their face across weights", async () => {
    await ensureSnsFonts([request("barlow-condensed", "BOWL", 400), request("barlow-condensed", "BOWL", 500), request("barlow-condensed", "BOWL", 700)]);
    assert.deepEqual(made.map(face => face.descriptors.weight).sort(), ["400", "500", "700"]);
    for (const weight of [400, 500, 700]) assert.ok(made.some(face => face.source.includes(`/${weight}.woff2`)));
    await ensureSnsFonts([request("inter", "BOWL", 400)]);
    assert.equal(areSnsFontsReady([request("inter", "BOWL", 700)]), false);
    await ensureSnsFonts([request("inter", "BOWL", 700)]);
    assert.equal(made.filter(face => face.family.includes("Inter")).length, 1);
    assert.equal(activations.filter(check => check.css.includes("Inter")).length, 2);
});

test("parallel requests share loading but new text requires its own activation check", async () => {
    const layers = [request("ibm-plex-mono", "HOT BOWL", 500)];
    await Promise.all([ensureSnsFonts(layers), ensureSnsFonts(layers), ensureSnsFonts(layers)]);
    assert.equal(made.length, 1); assert.equal(activations.length, 1);
    const changed = [request("ibm-plex-mono", "LOVE IT", 500)];
    assert.equal(areSnsFontsReady(changed), false);
    await ensureSnsFonts(changed);
    assert.equal(made.length, 1); assert.equal(activations.length, 2);
});

test("readiness waits for FontFace loading and exact-text activation", async () => {
    faceGate = new Promise(resolve => { releaseFace = resolve; });
    const layers = [request("noto-sans-jp", "今日の気分", 700)];
    const loading = ensureSnsFonts(layers);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(areSnsFontsReady(layers), false);
    assert.equal(activations.length, 0);
    releaseFace!();
    await loading;
    assert.equal(areSnsFontsReady(layers), true);
});

test("asset failures reject and clear the face cache so a retry really loads again", async () => {
    faceFailures = 1;
    const layers = [request("shippori-mincho", "BOWL", 500)];
    await assert.rejects(ensureSnsFonts(layers), { message: SNS_FONT_LOAD_ERROR });
    assert.equal(areSnsFontsReady(layers), false);
    assert.equal(fontSet.size, 0);
    await ensureSnsFonts(layers);
    assert.equal(made.length, 2);
    assert.equal(areSnsFontsReady(layers), true);
});

test("font-set activation failure can retry and a check() fallback false-positive cannot pass", async () => {
    const layers = [request("inter")];
    activationFailures = 1;
    await assert.rejects(ensureSnsFonts(layers), { message: SNS_FONT_LOAD_ERROR });
    returnForeignFaces = true;
    await assert.rejects(ensureSnsFonts(layers), { message: SNS_FONT_LOAD_ERROR });
    assert.equal(areSnsFontsReady(layers), false);
    returnForeignFaces = false;
    await ensureSnsFonts(layers);
    assert.equal(areSnsFontsReady(layers), true);
    assert.equal(made.length, 1);
    assert.equal(activations.length, 3);
});

test("externally removed faces or a failed font check invalidate cached readiness", async () => {
    const layers = [request("noto-serif-jp", "BOWL")];
    await ensureSnsFonts(layers);
    fontSet.clear();
    assert.equal(areSnsFontsReady(layers), false);
    await ensureSnsFonts(layers);
    assert.equal(areSnsFontsReady(layers), true);
    checkResult = false;
    assert.equal(areSnsFontsReady(layers), false);
    await assert.rejects(ensureSnsFonts(layers));
    checkResult = true;
    await ensureSnsFonts(layers);
    assert.equal(areSnsFontsReady(layers), true);
});
