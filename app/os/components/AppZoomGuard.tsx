"use client";

import { useEffect } from "react";

const PREVIEW_ZOOM_SELECTOR = ".voucher-preview-panel-body";

function isInsidePreviewZoomSurface(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(PREVIEW_ZOOM_SELECTOR));
}

export function AppZoomGuard() {
  useEffect(() => {
    const preventPageGestureZoom = (event: Event) => {
      if (isInsidePreviewZoomSurface(event.target)) return;
      event.preventDefault();
    };

    const preventPageTouchZoom = (event: TouchEvent) => {
      if (event.touches.length < 2 || isInsidePreviewZoomSurface(event.target)) return;
      event.preventDefault();
    };

    const preventPageWheelZoom = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || isInsidePreviewZoomSurface(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener("gesturestart", preventPageGestureZoom, { passive: false });
    document.addEventListener("gesturechange", preventPageGestureZoom, { passive: false });
    document.addEventListener("gestureend", preventPageGestureZoom, { passive: false });
    document.addEventListener("touchmove", preventPageTouchZoom, { passive: false });
    document.addEventListener("wheel", preventPageWheelZoom, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventPageGestureZoom);
      document.removeEventListener("gesturechange", preventPageGestureZoom);
      document.removeEventListener("gestureend", preventPageGestureZoom);
      document.removeEventListener("touchmove", preventPageTouchZoom);
      document.removeEventListener("wheel", preventPageWheelZoom);
    };
  }, []);

  return null;
}
