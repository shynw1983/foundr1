"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useReadRequest(timeoutMs = 15000, retryMs = 5000) {
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState("");
  const mounted = useRef(true);
  const current = useRef<{ key: string; controller: AbortController; promise?: Promise<boolean> } | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current?.controller.abort();
      current.current = null;
      clearTimeout(retryTimer.current);
    };
  }, []);

  const cancel = useCallback(() => {
    const request = current.current;
    current.current = null;
    request?.controller.abort();
    clearTimeout(retryTimer.current);
    setRefreshing(false);
    setFailed(false);
    setLastSuccessAt("");
  }, []);

  const run = useCallback(function run<T>(key: string, read: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    const previous = current.current;
    if (previous?.key === key && previous.promise) return previous.promise;
    previous?.controller.abort();
    clearTimeout(retryTimer.current);
    const request = { key, controller: new AbortController(), promise: undefined as Promise<boolean> | undefined };
    current.current = request;
    if (previous?.key !== key) { setFailed(false); setLastSuccessAt(""); }
    setRefreshing(true);
    const timeout = setTimeout(() => request.controller.abort(), timeoutMs);
    request.promise = (async () => {
      try {
        const value = await read(request.controller.signal);
        if (!mounted.current || current.current !== request || request.controller.signal.aborted) return false;
        apply(value);
        setFailed(false);
        setLastSuccessAt(new Date().toISOString());
        return true;
      } catch {
        if (mounted.current && current.current === request) {
          setFailed(true);
          retryTimer.current = setTimeout(() => {
            if (mounted.current && current.current === request) void run(key, read, apply);
          }, retryMs);
        }
        return false;
      } finally {
        clearTimeout(timeout);
        request.promise = undefined;
        if (mounted.current && current.current === request) setRefreshing(false);
      }
    })();
    return request.promise;
  }, [timeoutMs, retryMs]);
  return { run, cancel, failed, refreshing, lastSuccessAt };
}

export async function readJson<T = any>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Read failed: ${response.status}`);
  return response.json() as Promise<T>;
}
