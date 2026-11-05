"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RelayOwner } from "../../../lib/store-relay-policy";

type DisplayState = Record<string, unknown>;
type Writer = { publish: (state: DisplayState) => void };

/** One ordered writer per visible POS/owner. Nothing is placed in an offline queue. */
export function useCustomerDisplayPublisher({ storeId, enabled, owner }: {
  storeId: string; enabled: boolean; owner: RelayOwner | null;
}) {
  const writer = useRef<Writer | null>(null);
  const publish = useCallback((state: DisplayState) => writer.current?.publish(state), []);

  useEffect(() => {
    if (!storeId || !enabled) return;
    let active = true, busy = false, dirty = false, paused = false;
    let streamId = "", sequence = 0;
    let latest: DisplayState | null = null;
    let rejectedState: DisplayState | null = null;
    let lastSentAt = 0;
    const request = async (body?: Record<string, unknown>) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`/api/store/pos/customer-display${body ? "" : `?storeId=${encodeURIComponent(storeId)}`}`, {
          method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal,
          ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, storeId, owner }) } : {})
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error("Customer display unavailable"), { status: response.status });
        return result;
      } finally { window.clearTimeout(timer); }
    };
    const visible = () => document.visibilityState === "visible" && navigator.onLine;
    const claim = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await request();
        if (!active || !visible()) return;
        try {
          const result = await request({ action: "claim", expectedRevision: Number(current.state?.revision ?? 0) });
          streamId = String(result.streamId || "");
          if (!streamId) throw new Error("Missing display stream");
          return;
        } catch (error) {
          if ((error as { status?: number }).status !== 409 || attempt > 0) throw error;
        }
      }
    };
    const flush = async () => {
      if (!active || busy || paused || !dirty || !latest || !visible()) return;
      busy = true;
      let delivered = false;
      let sentState: DisplayState | null = null;
      try {
        if (!streamId) await claim();
        if (!active || !visible() || !streamId || !latest) return;
        const state = latest;
        sentState = state;
        dirty = false;
        await request({ streamId, sequence: ++sequence, state });
        lastSentAt = Date.now();
        delivered = true;
      } catch (error) {
        const status = (error as { status?: number }).status;
        // A displaced writer cannot silently reclaim the customer's screen.
        if (status === 401 || status === 403 || status === 409) paused = true;
        else if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) rejectedState = sentState;
        else dirty = true;
      } finally {
        busy = false;
        // A newer cart/preview always supersedes the frame just sent.
        if (active && dirty && !paused && delivered) void flush();
      }
    };
    const clearPreview = () => {
      if (!streamId || paused || !latest?.weighing) return;
      const state = { ...latest, weighing: null, status: Array.isArray(latest.items) && latest.items.length ? "editing" : "idle" };
      // A higher sequence also fences an older request still in flight.
      void request({ streamId, sequence: ++sequence, state }).catch(() => undefined);
    };
    const control: Writer = { publish(state) { latest = state; dirty = true; void flush(); } };
    writer.current = control;
    const visibility = () => {
      if (!visible()) clearPreview();
      else { dirty = Boolean(latest); void flush(); }
    };
    const timer = window.setInterval(() => {
      if (latest?.weighing && latest !== rejectedState && Date.now() - lastSentAt >= 2000) dirty = true;
      void flush();
    }, 2000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", visibility);
    window.addEventListener("online", visibility);
    return () => {
      active = false;
      clearPreview();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", visibility);
      window.removeEventListener("online", visibility);
      if (writer.current === control) writer.current = null;
    };
  }, [storeId, enabled, owner?.stationId, owner?.token, owner?.epoch]);

  return publish;
}
