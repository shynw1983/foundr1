import assert from "node:assert/strict";
import test from "node:test";
import { createStoreThemePalette, defaultStoreThemeColor, normalizeStoreThemeColor, storeThemeContrast, getDefaultStoreTheme, normalizeStoreThemeTarget, storeThemeTargetForPath } from "./store-theme.ts";

test("theme input accepts only opaque six-digit colors and never CSS fragments", () => {
  assert.equal(normalizeStoreThemeColor(" #Ab01EF "), "#ab01ef");
  for (const value of [null, 123, {}, "red", "#fff", "#ffffffff", "#12zz34", "var(--green)", "#ffffff;background:url(https://example.test)"]) {
    assert.equal(normalizeStoreThemeColor(value), null);
    assert.deepEqual(createStoreThemePalette(value), createStoreThemePalette(defaultStoreThemeColor));
  }
});

test("arbitrary light, dark and low-saturation colors retain legible action and selection text", () => {
  // Cover the sRGB cube rather than only a few hand-selected brand colors.
  for (let red = 0; red <= 255; red += 17) for (let green = 0; green <= 255; green += 17) for (let blue = 0; blue <= 255; blue += 17) {
    const color = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
    const palette = createStoreThemePalette(color);
    assert.equal(palette["--store-primary"], color, "the user's chosen hue is retained");
    for (const background of ["--store-primary", "--store-primary-hover", "--store-primary-active"]) {
      assert.ok(storeThemeContrast(palette[background], palette["--store-on-primary"]) >= 4.5, `${color} ${background} label`);
    }
    for (const background of ["--store-bg", "--store-panel", "--store-primary-soft"]) {
      assert.ok(storeThemeContrast(palette[background], palette["--store-primary-text"]) >= 4.5, `${color} ${background} selected text`);
      assert.ok(storeThemeContrast(palette[background], palette["--store-focus-ring"]) >= 3, `${color} ${background} focus`);
    }
    assert.ok(storeThemeContrast(palette["--store-bg"], palette["--store-muted"]) >= 4.5, `${color} muted text`);
  }
});

test("success, errors and operational semantics stay stable when the brand becomes red or yellow", () => {
  const green = createStoreThemePalette(defaultStoreThemeColor);
  for (const color of ["#c30d23", "#f6df42", "#ffffff", "#000000", "#7c3aed"]) {
    const palette = createStoreThemePalette(color);
    for (const key of Object.keys(green).filter(key => /--store-(success|danger|warning|info|disabled)/.test(key))) {
      assert.equal(palette[key], green[key], `${key} independent of ${color}`);
    }
    assert.equal(palette["--store-display-accent"], color);
    assert.ok(storeThemeContrast(palette["--store-display-accent"], palette["--store-display-on-accent"]) >= 4.5);
  }
});


test("only exact customer screen routes leave the operations theme and explicit invalid targets are rejected", () => {
  assert.equal(normalizeStoreThemeTarget(undefined), "operations");
  for (const target of ["operations", "pickup", "customer", "courier"]) assert.equal(normalizeStoreThemeTarget(target), target);
  for (const target of [null, "", "kitchen", [], "__proto__", "constructor"]) assert.equal(normalizeStoreThemeTarget(target), null);
  for (const path of ["/store", "/store/display/kitchen", "/store/display/pickup/other", "/store/settings/appearance", "/store/pickup-display"]) assert.equal(storeThemeTargetForPath(path), "operations");
  assert.equal(storeThemeTargetForPath("/store/display/pickup/"), "pickup");
  assert.equal(storeThemeTargetForPath("/store/pos/customer-display"), "customer");
  assert.equal(storeThemeTargetForPath("/store/display/courier"), "courier");
  assert.equal(getDefaultStoreTheme("pickup").primaryColor, "#c30d23");
  assert.equal(getDefaultStoreTheme("pickup").mode, "brand");
  assert.equal(getDefaultStoreTheme("operations").mode, "custom");
});
