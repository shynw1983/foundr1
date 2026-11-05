"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createReadError } from "../../../components/useReadRequest";
import type { PosOperatorProof } from "../../../lib/pos-operator-policy";
import type { PosFulfillmentAction, PosFulfillmentTask, PosFulfillmentUndo } from "../../../lib/pos-fulfillment-policy";
import { bindStoreRealtimeChannels } from "../../../lib/store-realtime-refresh";
import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";
export type { PosFulfillmentAction, PosFulfillmentTask, PosFulfillmentUndo } from "../../../lib/pos-fulfillment-policy";

type Mutation = {
  storeId: string;
  taskId: string;
  action: PosFulfillmentAction;
  expectedVersion: string;
  mutationId: string;
  undoToken?: string;
  posOperator?: PosOperatorProof;
};
type QueueBody = {
  selectedStoreId?: string;
  tasks?: PosFulfillmentTask[];
  serverNow?: string;
  undo?: PosFulfillmentUndo;
  ok?: boolean;
  error?: string;
  settings?: { enabled?: boolean };
};
type SharedPusher = ReturnType<typeof import("../../../lib/shared-pusher-client")["acquireSharedPusher"]>;

const readFailure = "提供状況を更新できません。表示中の内容は保持しています。";
const uncertainFailure = "操作結果を確認できません。同じ操作を再試行して結果を確認してください。";

export function usePosFulfillmentQueue({ storeId, enabled, disabled = false, refreshKey, prepareAction }: {
  storeId: string;
  enabled: boolean;
  disabled?: boolean;
  refreshKey?: string | number;
  prepareAction?: (payload: Record<string, unknown>) => Promise<PosOperatorProof | null | undefined>;
}) {
  const [tasks, setTasks] = useState<PosFulfillmentTask[]>([]);
  const [dataStore, setDataStore] = useState("");
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [retryMutation, setRetryMutation] = useState<Mutation | null>(null);
  const [undo, setUndo] = useState<PosFulfillmentUndo | null>(null);
  const [online, setOnline] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState("");
  const [clockOffset, setClockOffset] = useState(0);
  const [serverDisabled, setServerDisabled] = useState(false);
  const scope = useRef({ storeId, enabled, generation: 0 });
  const readRequest = useRef<AbortController | null>(null);
  const coordinator = useRef<ReturnType<typeof createStoreRefreshCoordinator> | null>(null);
  const unauthorized = useRef(false);
  const denyAuthorityRef = useRef<() => void>(() => {});
  const cleanupRealtimeRef = useRef<(() => void) | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const writeEpoch = useRef(0);
  const prepareRef = useRef(prepareAction);
  const disabledRef = useRef(disabled);
  const serverDisabledRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  prepareRef.current = prepareAction;
  disabledRef.current = disabled;

  const accept = useCallback((body: QueueBody, targetStore: string) => {
    if (!Array.isArray(body.tasks) || (body.selectedStoreId && body.selectedStoreId !== targetStore)) {
      throw new Error(readFailure);
    }
    if (body.settings?.enabled === false) {
      // Disabled settings hide the server queue; that empty response must never
      // erase the last confirmed tickets or imply they were all handed over.
      serverDisabledRef.current = true;
      setServerDisabled(true);
      setReadError("");
      return;
    }
    serverDisabledRef.current = false;
    setServerDisabled(false);
    setTasks(body.tasks);
    setDataStore(targetStore);
    setLastSuccessAt(body.serverNow || new Date().toISOString());
    const serverTime = Date.parse(body.serverNow || "");
    if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now());
    setReadError("");
  }, []);

  const read = useCallback(async (signal: AbortSignal) => {
    const current = scope.current;
    if (!current.enabled || !current.storeId || saving.current) return;
    const controller = new AbortController();
    const abortRead = () => controller.abort();
    signal.addEventListener("abort", abortRead, { once: true });
    if (signal.aborted) controller.abort();
    readRequest.current = controller;
    const epoch = writeEpoch.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/store/pos/fulfillment?storeId=${encodeURIComponent(current.storeId)}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal
      });
      const body = await response.json().catch(() => ({})) as QueueBody;
      if (!response.ok) throw Object.assign(createReadError(response), { message: body.error || readFailure });
      if (scope.current !== current || epoch !== writeEpoch.current || controller.signal.aborted) return;
      accept(body, current.storeId);
    } catch (reason) {
      // A write invalidates and aborts its older read. It is not a transport failure.
      if (scope.current !== current || epoch !== writeEpoch.current) return;
      if (!signal.aborted) setReadError(reason instanceof Error && !(reason instanceof TypeError) && reason.name !== "AbortError" ? reason.message : readFailure);
      throw reason;
    } finally {
      signal.removeEventListener("abort", abortRead);
      if (readRequest.current === controller) {
        readRequest.current = null;
        setLoading(false);
      }
    }
  }, [accept]);
  const refresh = useCallback(() => coordinator.current?.refresh() ?? Promise.resolve(), []);
  refreshRef.current = refresh;

  useEffect(() => {
    const current = { storeId, enabled, generation: scope.current.generation + 1 };
    scope.current = current;
    unauthorized.current = false;
    readRequest.current?.abort();
    readRequest.current = null;
    setTasks([]);
    setDataStore("");
    setReadError("");
    setActionError("");
    setRetryMutation(null);
    setUndo(null);
    setBusyTaskId("");
    setLastSuccessAt("");
    setClockOffset(0);
    serverDisabledRef.current = false;
    setServerDisabled(false);
    saving.current = false;
    setLoading(false);
    const denyAuthority = () => {
      if (scope.current !== current) return;
      unauthorized.current = true; cleanupRealtimeRef.current?.(); reader?.stop();
      setTasks([]); setDataStore(""); setUndo(null); setRetryMutation(null); setRealtimeConnected(false); setReadError(readFailure); setLoading(false);
    };
    denyAuthorityRef.current = denyAuthority;
    const reader = enabled && storeId ? createStoreRefreshCoordinator(read, {
      healthyIntervalMs: 60_000, fallbackIntervalMs: 30_000,
      onError: () => { if (scope.current === current) { setLoading(false); setReadError(readFailure); } },
      onUnauthorized: denyAuthority
    }) : null;
    coordinator.current = reader;
    reader?.start({ immediate: true });
    return () => {
      reader?.stop();
      if (coordinator.current === reader) coordinator.current = null;
      if (scope.current === current) {
        scope.current = { storeId: "", enabled: false, generation: current.generation + 1 };
        readRequest.current?.abort();
        readRequest.current = null;
        writeRequest.current?.abort();
        writeRequest.current = null;
      }
    };
  }, [enabled, storeId, read]);

  useEffect(() => {
    if (enabled && storeId) void refresh();
  }, [enabled, refreshKey, storeId, refresh]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    setRealtimeConnected(false);
    if (!enabled || !storeId) return;
    let active = true;
    let pusher: SharedPusher | undefined;
    let cleanupRealtime: (() => void) | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const refreshNow = () => { if (active) void refreshRef.current(); };
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(storeId)}`, {
      cache: "no-store", credentials: "same-origin", signal: controller.signal
    }).then(response => response.ok ? response.json() : null).then(async config => {
      if (!active || unauthorized.current || !config?.key || !config?.cluster || !Array.isArray(config.channels)) return;
      const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
      if (!active || unauthorized.current) return;
      pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
      cleanupRealtime = bindStoreRealtimeChannels(pusher, {
        channels: config.channels, events: ["order.created", "order.updated"],
        onEvent: refreshNow,
        onUnauthorized: () => { if (active) denyAuthorityRef.current(); },
        onHealthChange: healthy => {
          if (!active || unauthorized.current) return;
          setRealtimeConnected(healthy);
          coordinator.current?.setRealtimeHealthy(healthy);
          if (healthy) void coordinator.current?.refresh({ force: true });
        }
      });
    }).catch(() => {}).finally(() => window.clearTimeout(timeout));
    const cleanup = () => {
      active = false; controller.abort(); window.clearTimeout(timeout);
      cleanupRealtime?.(); pusher?.disconnect();
    };
    cleanupRealtimeRef.current = cleanup;
    return () => { cleanup(); if (cleanupRealtimeRef.current === cleanup) cleanupRealtimeRef.current = null; };
  }, [enabled, storeId]);

  const sendMutation = useCallback(async (mutation: Mutation, alreadyPrepared = false) => {
    const current = scope.current;
    if (!current.enabled || unauthorized.current || current.storeId !== mutation.storeId || saving.current || disabledRef.current || serverDisabledRef.current || !navigator.onLine) return;
    saving.current = true;
    writeEpoch.current += 1;
    readRequest.current?.abort();
    readRequest.current = null;
    setLoading(false);
    setBusyTaskId(mutation.taskId);
    setActionError("");
    const controller = new AbortController();
    writeRequest.current = controller;
    let timeout = 0;
    let sent = false;
    try {
      if (!alreadyPrepared && prepareRef.current) {
        const proof = await prepareRef.current(mutation);
        if (proof) mutation.posOperator = proof;
      }
      if (scope.current !== current) return;
      if (disabledRef.current || serverDisabledRef.current || !navigator.onLine) throw new Error("オフラインです。接続後に提供状況を確認してください。");
      timeout = window.setTimeout(() => controller.abort(), 20000);
      sent = true;
      const response = await fetch("/api/store/pos/fulfillment", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(mutation)
      });
      const body = await response.json().catch(() => ({})) as QueueBody;
      if (scope.current !== current) return;
      if (!response.ok) {
        // A 5xx or interrupted response may follow a committed action. Keep its
        // mutation ID so explicit retry cannot perform the same action twice.
        setRetryMutation(response.status >= 500 ? mutation : null);
        setActionError(body.error || uncertainFailure);
        if (response.status === 409) void Promise.resolve().then(() => refreshRef.current());
        return;
      }
      if (!body.ok || !Array.isArray(body.tasks)) throw new Error(uncertainFailure);
      accept(body, current.storeId);
      setRetryMutation(null);
      setUndo(body.undo || null);
    } catch (reason) {
      if (scope.current === current) {
        setRetryMutation(sent ? mutation : null);
        setActionError(sent ? uncertainFailure : reason instanceof Error ? reason.message : uncertainFailure);
      }
    } finally {
      window.clearTimeout(timeout);
      if (writeRequest.current === controller) writeRequest.current = null;
      if (scope.current === current) {
        saving.current = false;
        setBusyTaskId("");
        void refreshRef.current();
      }
    }
  }, [accept]);

  const act = useCallback((task: PosFulfillmentTask, action: "ready" | "handoff" | "recall") => {
    if (saving.current) return;
    return sendMutation({
      storeId, taskId: task.id, action, expectedVersion: task.version, mutationId: crypto.randomUUID()
    });
  }, [sendMutation, storeId]);

  const undoLast = useCallback(() => {
    if (!undo || Date.now() + clockOffset >= Date.parse(undo.expiresAt) || saving.current) return;
    return sendMutation({
      storeId, taskId: undo.taskId, action: "undo", expectedVersion: undo.version,
      mutationId: crypto.randomUUID(), undoToken: undo.token
    });
  }, [clockOffset, sendMutation, storeId, undo]);

  return {
    tasks: dataStore === storeId ? tasks : [], readError, actionError, loading, busyTaskId,
    retryMutation, retry: () => retryMutation ? sendMutation(retryMutation, true) : undefined,
    undo, undoLast, online, realtimeConnected, lastSuccessAt, clockOffset, serverDisabled, refresh: () => coordinator.current?.refresh({ force: true }) ?? Promise.resolve(), act
  };
}
