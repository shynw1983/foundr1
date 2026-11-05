"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isPosDebugId, posDebugChannel, POS_DEBUG_DISPLAY_EVENT, POS_DEBUG_DISPLAY_TTL_MS, type PosDebugDisplayMessage } from "../../../lib/pos-debug-display";

export type PosDebugDisplayStatus = "connecting" | "connected" | "waiting" | "disconnected" | "ended" | "error";
const unavailable = "テスト客席表示に接続できません。";

/** A transient, explicitly paired channel. No cache, offline queue or saved state. */
export function usePosDebugDisplay({ storeId, sessionId, role }: { storeId: string; sessionId: string; role: "pos" | "display" }) {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<PosDebugDisplayStatus>("waiting");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const latest = useRef<Record<string, unknown> | null>(null);
  const scope = useRef("");
  const outboundSequence = useRef(0);
  const inboundSequence = useRef(-1);
  const control = useRef<{ flush: () => void; end: () => Promise<void> } | null>(null);
  const publish = useCallback((value: Record<string, unknown>) => { latest.current = value; control.current?.flush(); }, []);
  const end = useCallback(async () => { await control.current?.end(); latest.current = null; }, []);
  const retry = useCallback(() => setRetryKey(value => value + 1), []);

  useEffect(() => {
    setState(null); setError(""); setStatus("waiting");
    if (!storeId || !sessionId) return;
    if (!isPosDebugId(storeId) || !isPosDebugId(sessionId)) { setStatus("error"); setError("テスト接続を確認してください。"); return; }
    const identity = `${storeId}:${sessionId}:${role}`;
    if (scope.current !== identity) {
      scope.current = identity; latest.current = null; outboundSequence.current = 0; inboundSequence.current = -1;
    }
    let active = true, ended = false, subscribed = false, sending = false, dirty = false;
    let lastPeerAt = 0, lastHeartbeatAt = 0, debounce = 0;
    let pusher: Awaited<ReturnType<typeof import("../../../lib/shared-pusher-client")["acquireSharedPusher"]>> | null = null;
    const controllers = new Set<AbortController>();
    const configController = new AbortController(); controllers.add(configController);
    const scopedStore = storeId, scopedSession = sessionId;
    setStatus("connecting");

    async function send(kind: PosDebugDisplayMessage["kind"], value?: Record<string, unknown>, replySequence?: number) {
      const controller = new AbortController(); controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), kind === "end" ? 1000 : 5000);
      const message: PosDebugDisplayMessage = { storeId: scopedStore, sessionId: scopedSession, kind,
        sequence: replySequence ?? ++outboundSequence.current, ...(value ? { state: value } : {}) };
      try {
        const response = await fetch("/api/store/pos/debug-display", { method: "POST", cache: "no-store", keepalive: kind === "end",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(message), signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || unavailable);
        if (active && !ended) setError("");
      } catch (cause) {
        if (active && !ended) { setStatus("error"); setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : unavailable); }
      } finally { window.clearTimeout(timeout); controllers.delete(controller); }
    }

    async function flush() {
      if (!active || ended || !subscribed || role !== "pos" || !latest.current) return;
      if (sending) { dirty = true; return; }
      sending = true; dirty = false;
      await send("state", latest.current);
      sending = false;
      if (dirty && active && !ended) schedule();
    }
    function schedule() {
      if (debounce || !active || ended) return;
      debounce = window.setTimeout(() => { debounce = 0; void flush(); }, 150);
    }
    async function finish() {
      if (ended) return;
      ended = true; latest.current = null; setState(null); setStatus("ended");
      window.clearTimeout(debounce);
      if (role === "pos") await send("end");
    }
    control.current = { flush: schedule, end: finish };
    function receive(message: PosDebugDisplayMessage) {
      if (!active || ended || message?.sessionId !== scopedSession || message.storeId !== scopedStore || !Number.isSafeInteger(message.sequence)) return;
      if (role === "pos") {
        if (message.kind === "hello") schedule();
        if (message.kind === "ack" && message.sequence <= outboundSequence.current) { lastPeerAt = performance.now(); setStatus("connected"); setError(""); }
        return;
      }
      if (!["state", "end"].includes(message.kind) || message.sequence <= inboundSequence.current) return;
      inboundSequence.current = message.sequence;
      if (message.kind === "end") { ended = true; setState(null); setStatus("ended"); return; }
      if (!message.state || !Array.isArray(message.state.items)) return;
      lastPeerAt = performance.now(); setState(message.state); setStatus("connected"); setError("");
      void send("ack", undefined, message.sequence);
    }
    const disconnected = () => {
      subscribed = false;
      if (active && !ended) { setStatus("disconnected"); if (role === "display") setState(null); }
    };
    const pageHide = () => { if (role === "pos") void finish(); };
    const pageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setState(null); setStatus("waiting"); setRetryKey(value => value + 1);
    };
    const online = () => { if (active && !ended) setRetryKey(value => value + 1); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", online);
    const timer = window.setInterval(() => {
      if (!active || ended) return;
      if (lastPeerAt && performance.now() - lastPeerAt > POS_DEBUG_DISPLAY_TTL_MS) {
        setStatus("disconnected"); if (role === "display") setState(null);
      }
      if (performance.now() - lastHeartbeatAt >= 5000) {
        lastHeartbeatAt = performance.now();
        if (subscribed && role === "pos") schedule();
        if (subscribed && role === "display") void send("hello");
      }
    }, 1000);
    const configTimeout = window.setTimeout(() => configController.abort(), 10000);
    void (async () => {
      try {
        const response = await fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(scopedStore)}`, { cache: "no-store", signal: configController.signal });
        const config = await response.json();
        if (!response.ok || !config.key || !config.cluster) throw new Error(unavailable);
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        for (const event of ["unavailable", "failed", "disconnected"]) pusher.connection.bind(event, disconnected);
        const channel = pusher.subscribe(posDebugChannel(scopedStore, scopedSession));
        channel.bind(POS_DEBUG_DISPLAY_EVENT, receive);
        channel.bind("pusher:subscription_succeeded", () => {
          if (!active || ended) return;
          subscribed = true; setStatus("waiting");
          if (role === "pos") schedule(); else void send("hello");
        });
        channel.bind("pusher:subscription_error", () => { disconnected(); if (active) setError(unavailable); });
      } catch (cause) { if (active && !ended) { setStatus("error"); setError(unavailable); } }
      finally { window.clearTimeout(configTimeout); controllers.delete(configController); }
    })();
    return () => {
      active = false; control.current = null;
      window.clearTimeout(debounce); window.clearTimeout(configTimeout); window.clearInterval(timer);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", online);
      controllers.forEach(controller => controller.abort());
      pusher?.disconnect();
    };
  }, [storeId, sessionId, role, retryKey]);
  return { state, status, error, publish, end, retry };
}
