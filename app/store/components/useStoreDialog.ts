"use client";

import { useEffect, useRef } from "react";

/** Focus and scroll containment for store overlays, including narrow-screen panels. */
export function useStoreDialog(open: boolean, onClose: () => void, mediaQuery?: string) {
  const ref = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const media = mediaQuery ? window.matchMedia(mediaQuery) : null;
    if (media && !media.matches) { closeRef.current(); return; }
    const panel = ref.current;
    if (!panel) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"]'));
      const topDialog = dialogs.at(-1);
      if (topDialog && topDialog !== panel && !panel.contains(topDialog)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = controls();
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const onResize = () => { if (media && !media.matches) closeRef.current(); };
    document.addEventListener("keydown", onKeyDown);
    media?.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      media?.removeEventListener("change", onResize);
      trigger?.focus({ preventScroll: true });
    };
  }, [open, mediaQuery]);
  return ref;
}
