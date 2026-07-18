"use client";

import { useEffect, useRef } from "react";

type VisibleRefreshOptions = {
  intervalMs?: number;
  minIntervalMs?: number;
};

export function useVisibleRefresh(refresh: () => void, options: VisibleRefreshOptions = {}) {
  const refreshRef = useRef(refresh);
  const lastRunAtRef = useRef(Date.now());
  const intervalMs = options.intervalMs ?? 0;
  const minIntervalMs = options.minIntervalMs ?? 5000;

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const runWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRunAtRef.current < minIntervalMs) return;
      lastRunAtRef.current = now;
      refreshRef.current();
    };

    const runOnVisibleChange = () => {
      if (document.visibilityState === "visible") runWhenVisible();
    };

    window.addEventListener("online", runWhenVisible);
    window.addEventListener("focus", runWhenVisible);
    window.addEventListener("pageshow", runWhenVisible);
    document.addEventListener("visibilitychange", runOnVisibleChange);
    const timer = intervalMs > 0 ? window.setInterval(runWhenVisible, intervalMs) : 0;

    return () => {
      window.removeEventListener("online", runWhenVisible);
      window.removeEventListener("focus", runWhenVisible);
      window.removeEventListener("pageshow", runWhenVisible);
      document.removeEventListener("visibilitychange", runOnVisibleChange);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs, minIntervalMs]);
}
