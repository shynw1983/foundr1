"use client";

import { type RefObject, useEffect } from "react";

export function useCloseOnOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClose: () => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      const element = ref.current;
      if (element && !element.contains(event.target as Node)) onClose();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [enabled, onClose, ref]);
}
