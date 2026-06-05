"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export function useDisplayMode() {
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockSupported, setWakeLockSupported] = useState(true);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockRequestedRef = useRef(false);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) {
      setWakeLockSupported(false);
      return;
    }
    try {
      wakeLockRef.current = await wakeLock.request("screen");
      wakeLockRequestedRef.current = true;
      setWakeLockSupported(true);
      setWakeLockActive(true);
      wakeLockRef.current.addEventListener("release", () => {
        wakeLockRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const activateDisplayMode = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen requires a direct user gesture and may be blocked by the browser.
    }
    await requestWakeLock();
  }, [requestWakeLock]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreenActive(Boolean(document.fullscreenElement));
    const restoreWakeLock = () => {
      if (document.visibilityState === "visible" && wakeLockRequestedRef.current && !wakeLockRef.current) {
        void requestWakeLock();
      }
    };
    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen);
    document.addEventListener("visibilitychange", restoreWakeLock);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
      document.removeEventListener("visibilitychange", restoreWakeLock);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [requestWakeLock]);

  return {
    activateDisplayMode,
    fullscreenActive,
    wakeLockActive,
    wakeLockSupported
  };
}
