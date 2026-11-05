"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { createReadError } from "../../../components/useReadRequest";
import { bindStoreRealtimeChannels } from "../../../lib/store-realtime-refresh";
import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";

/** Refresh the read projection without reloading the menu or touching active input. */
export function usePosDailySummary<T extends { pendingSync?: boolean }>(storeId: string, enabled: boolean, initial: T) {
  const [state, setState] = useState<{ storeId: string; value: T }>({ storeId, value: initial });
  const [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), active = useRef({ storeId, enabled, pending: false });
  const coordinator = useRef<ReturnType<typeof createStoreRefreshCoordinator> | null>(null);
  const summary = state.storeId === storeId ? state.value : initial;
  active.current = { storeId, enabled, pending: summary.pendingSync === true };
  const setSummary = useCallback((value: SetStateAction<T>, scope = storeId) => {
    // A checkout/refund snapshot is newer than every GET started before it.
    generation.current++;
    setState(old => ({ storeId: scope, value: typeof value === "function" ? (value as (old: T) => T)(old.storeId === scope ? old.value : initial) : value }));
  }, [storeId, initial]);
  const refresh = useCallback(() => coordinator.current?.refresh({ force: true }) ?? Promise.resolve(), []);
  useEffect(() => {
    generation.current++;
    setRefreshing(false); setError("");
    if (!enabled || !storeId) return;
    let alive = true, unauthorized = false;
    let cleanupRealtime: (() => void) | undefined;
    let pusher: ReturnType<typeof import("../../../lib/shared-pusher-client")["acquireSharedPusher"]> | undefined;
    const configRequest = new AbortController();
    const denyAuthority: () => void = () => {
      unauthorized = true; reader.stop(); configRequest.abort(); cleanupRealtime?.(); pusher?.disconnect();
      if (alive) { generation.current++; setState({ storeId, value: initial }); setRefreshing(false); setError("売上集計を更新できませんでした。再試行してください。"); }
    };
    const reader = createStoreRefreshCoordinator(async signal => {
      if (active.current.pending || !active.current.enabled || active.current.storeId !== storeId) return;
      const revision = generation.current;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/store/pos/summary?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal });
        if (!response.ok) throw createReadError(response);
        const body = await response.json();
        if (body.selectedStoreId !== storeId || !Number.isFinite(body.todaySummary?.orderCount) || !Number.isFinite(body.todaySummary?.total)) throw new Error("summary unavailable");
        if (alive && !signal.aborted && active.current.enabled && active.current.storeId === storeId && generation.current === revision) {
          generation.current++; setState({ storeId, value: body.todaySummary }); setError("");
        }
      } finally { if (alive && !signal.aborted) setRefreshing(false); }
    }, {
      healthyIntervalMs: 5 * 60_000, fallbackIntervalMs: 60_000,
      onError: () => { if (alive) { setRefreshing(false); setError("売上集計を更新できませんでした。再試行してください。"); } },
      onUnauthorized: denyAuthority
    });
    coordinator.current = reader;
    reader.start({ immediate: true });
    const timeout = window.setTimeout(() => configRequest.abort(), 12_000);
    void fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: configRequest.signal })
      .then(response => response.ok ? response.json() : null).then(async config => {
        if (!alive || unauthorized || !config?.key || !config?.cluster || !Array.isArray(config.channels) || !config.channels.length) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!alive || unauthorized) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        cleanupRealtime = bindStoreRealtimeChannels(pusher, {
          channels: config.channels, events: ["order.created", "order.updated", "pos.reconciliation.updated"],
          onEvent: () => { void reader.refresh(); }, onUnauthorized: denyAuthority,
          onHealthChange: healthy => { reader.setRealtimeHealthy(healthy); if (healthy) void reader.refresh({ force: true }); }
        });
      }).catch(() => { /* Scoped HTTP fallback remains active when push cannot be configured. */ })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      alive = false; generation.current++; reader.stop();
      if (coordinator.current === reader) coordinator.current = null;
      configRequest.abort(); window.clearTimeout(timeout); cleanupRealtime?.(); pusher?.disconnect();
    };
  }, [storeId, enabled, initial]);
  return { summary, setSummary, refresh, refreshing, error };
}
