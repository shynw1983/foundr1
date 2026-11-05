"use client";

import { useCallback, useEffect, type RefObject } from "react";
import styles from "./CustomerDisplayGuard.module.css";

const edgeWidth = 24;
const interactiveSelector = "a,button,input,select,textarea,summary,[role='button'],[role='link'],[contenteditable]:not([contenteditable='false']),[data-display-gesture-allow]";
const documentLocks = new WeakMap<HTMLElement, { count: number; value: string; priority: string }>();

function containHorizontalOverscroll(element: HTMLElement) {
  const existing = documentLocks.get(element);
  if (existing) existing.count += 1;
  else {
    documentLocks.set(element, {
      count: 1,
      value: element.style.getPropertyValue("overscroll-behavior-x"),
      priority: element.style.getPropertyPriority("overscroll-behavior-x")
    });
    element.style.setProperty("overscroll-behavior-x", "none", "important");
  }
  return () => {
    const lock = documentLocks.get(element);
    if (!lock || --lock.count > 0) return;
    documentLocks.delete(element);
    // Another mounted feature may have deliberately changed this property.
    if (element.style.getPropertyValue("overscroll-behavior-x") !== "none"
      || element.style.getPropertyPriority("overscroll-behavior-x") !== "important") return;
    if (lock.value) element.style.setProperty("overscroll-behavior-x", lock.value, lock.priority);
    else element.style.removeProperty("overscroll-behavior-x");
  };
}

/** Best-effort browser gesture containment; Safari's system navigation is not a web API. */
export function useCustomerDisplayGuard(
  rootRef: RefObject<HTMLElement | null>,
  { exitMessage }: { exitMessage: string }
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hadClass = root.classList.contains(styles.surface);
    root.classList.add(styles.surface);
    const releaseDocument = containHorizontalOverscroll(document.documentElement);
    const releaseBody = containHorizontalOverscroll(document.body);
    const onTouchStart = (event: TouchEvent) => {
      if (!event.cancelable || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !root.contains(target) || target.closest(interactiveSelector)) return;
      const width = document.documentElement.clientWidth || window.innerWidth;
      const x = event.touches[0].clientX;
      if (x <= edgeWidth || x >= width - edgeWidth) event.preventDefault();
    };
    // Safari needs an explicitly non-passive start listener. A middle-of-screen
    // vertical swipe and all controls keep their ordinary browser behavior.
    root.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    return () => {
      root.removeEventListener("touchstart", onTouchStart, true);
      if (!hadClass) root.classList.remove(styles.surface);
      releaseBody();
      releaseDocument();
    };
  }, [rootRef]);

  const confirmExit = useCallback((href: string) => {
    if (window.confirm(exitMessage)) window.location.assign(href);
  }, [exitMessage]);

  return { confirmExit, guardClassName: styles.surface };
}
