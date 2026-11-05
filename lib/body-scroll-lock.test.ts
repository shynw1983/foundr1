import assert from "node:assert/strict";
import test from "node:test";
import { lockBodyScroll } from "./body-scroll-lock.ts";

// Minimal CSS declaration fixture; browser integration also exercises actual CSSStyleDeclaration.
function bodyFixture(overflow = "", priority = "") {
  const values = new Map<string, { value: string; priority: string }>();
  if (overflow) values.set("overflow", { value: overflow, priority });
  const style = {
    getPropertyValue: (name: string) => values.get(name)?.value ?? "",
    getPropertyPriority: (name: string) => values.get(name)?.priority ?? "",
    setProperty: (name: string, value: string, priority = "") => { values.set(name, { value, priority }); },
    removeProperty: (name: string) => { const old = values.get(name)?.value ?? ""; values.delete(name); return old; }
  };
  return { body: { style } as unknown as HTMLElement, style };
}

for (const order of [[0, 1], [1, 0]]) {
  test(`nested cart/options close order ${order.join(",")} restores scrolling only after both close`, () => {
    const { body, style } = bodyFixture();
    const release = [lockBodyScroll(body), lockBodyScroll(body)];
    release[order[0]]();
    assert.equal(style.getPropertyValue("overflow"), "hidden");
    release[order[1]]();
    assert.equal(style.getPropertyValue("overflow"), "");
  });
}

test("repeated POS option cycles never capture a stale hidden overflow", () => {
  const { body, style } = bodyFixture("auto", "important");
  for (let i = 0; i < 10; i++) {
    const first = lockBodyScroll(body), second = lockBodyScroll(body);
    first(); second();
    assert.equal(style.getPropertyValue("overflow"), "auto");
    assert.equal(style.getPropertyPriority("overflow"), "important");
  }
});

test("duplicate cleanup cannot release another visible dialog's lock", () => {
  const { body, style } = bodyFixture();
  const first = lockBodyScroll(body), second = lockBodyScroll(body);
  first(); first();
  assert.equal(style.getPropertyValue("overflow"), "hidden");
  second();
  assert.equal(style.getPropertyValue("overflow"), "");
});

test("a dialog transition acquires its next lock before releasing its previous one", () => {
  const { body, style } = bodyFixture("scroll");
  const cart = lockBodyScroll(body), options = lockBodyScroll(body);
  cart();
  const history = lockBodyScroll(body);
  options();
  assert.equal(style.getPropertyValue("overflow"), "hidden");
  history();
  assert.equal(style.getPropertyValue("overflow"), "scroll");
});

test("an existing external scroll lock is preserved", () => {
  const { body, style } = bodyFixture("hidden");
  lockBodyScroll(body)();
  assert.equal(style.getPropertyValue("overflow"), "hidden");
});
