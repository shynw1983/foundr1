"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PosMenuVersions = {
  selectedStoreId: string;
  posMenuRevision: string;
  dineInMenuRevision: string;
  counterMenuPolicyRevision?: string;
};

const connectionError = "メニューの更新を確認できません。接続を確認して再試行してください。";

export function usePosMenuRefresh<T extends PosMenuVersions>({ storeId, enabled, debugMode = false, posMenuRevision, dineInMenuRevision, counterMenuPolicyRevision = "", validateSnapshot, prepareManualApply, apply }: {
  storeId: string;
  enabled: boolean;
  debugMode?: boolean;
  posMenuRevision: string;
  dineInMenuRevision: string;
  counterMenuPolicyRevision?: string;
  validateSnapshot: (snapshot: T) => boolean;
  prepareManualApply: () => boolean;
  apply: (snapshot: T) => void;
}) {
  const [pending, setPending] = useState<PosMenuVersions | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const options = useRef({ storeId, enabled, debugMode, posMenuRevision, dineInMenuRevision, counterMenuPolicyRevision, validateSnapshot, prepareManualApply, apply });
  options.current = { storeId, enabled, debugMode, posMenuRevision, dineInMenuRevision, counterMenuPolicyRevision, validateSnapshot, prepareManualApply, apply };
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const current = options.current;
    if (!current.enabled || !current.storeId || !navigator.onLine || activeRequest.current) return true;
    const scope = current.storeId, version = generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const isCurrent = () => version === generation.current && options.current.enabled && options.current.storeId === scope;
    const differs = (value: PosMenuVersions) => value.posMenuRevision !== options.current.posMenuRevision || value.dineInMenuRevision !== options.current.dineInMenuRevision
      || (value.counterMenuPolicyRevision ?? "") !== options.current.counterMenuPolicyRevision;
    async function read(revisionOnly: boolean) {
      const params = new URLSearchParams({ storeId: scope, ...(revisionOnly ? { menuRevisionOnly: "1" } : {}), ...(current.debugMode ? { debug: "1" } : {}) });
      const response = await fetch(`/api/store/pos?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || connectionError);
      if (body.selectedStoreId !== scope || typeof body.posMenuRevision !== "string" || typeof body.dineInMenuRevision !== "string"
        || (body.counterMenuPolicyRevision !== undefined && typeof body.counterMenuPolicyRevision !== "string")) throw new Error(connectionError);
      return body as T;
    }
    setChecking(true);
    try {
      const latest = await read(true);
      if (!isCurrent() || controller.signal.aborted) return true;
      setError("");
      if (!differs(latest)) {
        setPending(null);
      } else setPending({ selectedStoreId: scope, posMenuRevision: latest.posMenuRevision, dineInMenuRevision: latest.dineInMenuRevision, counterMenuPolicyRevision: latest.counterMenuPolicyRevision });
      const snapshot = await read(false);
      if (!isCurrent() || controller.signal.aborted) return true;
      if (!options.current.validateSnapshot(snapshot)) throw new Error(connectionError);
      // Recheck current checkout safety after reading; clearing a draft still
      // requires explicit confirmation from the operator who requested refresh.
      if (!options.current.prepareManualApply()) return true;
      if (!isCurrent()) return true;
      options.current.apply(snapshot);
      setPending(null);
      return true;
    } catch (cause) {
      if (isCurrent()) setError(controller.signal.aborted ? connectionError : cause instanceof Error ? cause.message : connectionError);
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (isCurrent()) setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    setError(""); setPending(null);
  }, [storeId]);

  useEffect(() => {
    generation.current += 1;
    activeRequest.current?.abort(); activeRequest.current = null;
    setChecking(false);
    return () => {
      generation.current += 1;
      activeRequest.current?.abort(); activeRequest.current = null;
    };
  }, [storeId, enabled]);

  const scopedPending = pending?.selectedStoreId === storeId ? pending : null;
  const posChanged = Boolean(scopedPending && scopedPending.posMenuRevision !== posMenuRevision);
  const dineInChanged = Boolean(scopedPending && scopedPending.dineInMenuRevision !== dineInMenuRevision);
  const counterPolicyChanged = Boolean(scopedPending && (scopedPending.counterMenuPolicyRevision ?? "") !== counterMenuPolicyRevision);
  return { checking: enabled && checking, error, updateAvailable: posChanged || dineInChanged || counterPolicyChanged, posChanged, dineInChanged, counterPolicyChanged, refresh };
}
