"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useReadRequest(timeoutMs = 15000, retryMs = 5000, propagateErrors = false) {
  const [failed, setFailed] = useState(false);
  const [failureStatus, setFailureStatus] = useState<number | undefined>(undefined);
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
    setFailureStatus(undefined);
    setLastSuccessAt("");
  }, []);

  const reportFailure = useCallback((status: number) => {
    setFailed(true);
    setFailureStatus(Number.isFinite(status) ? status : undefined);
  }, []);

  const run = useCallback(function run<T>(key: string, read: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, externalSignal?: AbortSignal): Promise<boolean> {
    if (externalSignal?.aborted) return Promise.resolve(false);
    const previous = current.current;
    if (previous?.key === key && previous.promise) return previous.promise;
    previous?.controller.abort();
    clearTimeout(retryTimer.current);
    const request = { key, controller: new AbortController(), promise: undefined as Promise<boolean> | undefined };
    current.current = request;
    if (previous?.key !== key) { setFailed(false); setFailureStatus(undefined); setLastSuccessAt(""); }
    setRefreshing(true);
    const abortFromCaller = () => request.controller.abort();
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => request.controller.abort(), timeoutMs);
    request.promise = (async () => {
      try {
        const value = await read(request.controller.signal);
        if (!mounted.current || current.current !== request || externalSignal?.aborted) return false;
        if (request.controller.signal.aborted) throw new DOMException("Read timed out", "TimeoutError");
        apply(value);
        setFailed(false);
        setFailureStatus(undefined);
        setLastSuccessAt(new Date().toISOString());
        return true;
      } catch (error) {
        if (externalSignal?.aborted || !mounted.current || current.current !== request) return false;
        if (mounted.current && current.current === request) {
          setFailed(true);
          const status = Number((error as { status?: number })?.status);
          setFailureStatus(Number.isFinite(status) ? status : undefined);
          if (retryMs > 0 && ![401, 403].includes(Number((error as { status?: number })?.status))) retryTimer.current = setTimeout(() => {
            if (mounted.current && current.current === request) void run(key, read, apply);
          }, retryMs);
        }
        if (propagateErrors) throw error;
        return false;
      } finally {
        externalSignal?.removeEventListener("abort", abortFromCaller);
        clearTimeout(timeout);
        request.promise = undefined;
        if (mounted.current && current.current === request) setRefreshing(false);
      }
    })();
    return request.promise;
  }, [timeoutMs, retryMs, propagateErrors]);
  return { run, cancel, reportFailure, failed, failureStatus, refreshing, lastSuccessAt };
}

export async function readJson<T = any>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw createReadError(response);
  return response.json() as Promise<T>;
}

export function createReadError(response: Response) {
  const error = new Error(`Read failed: ${response.status}`) as Error & { status: number; retryAfterMs?: number };
  error.status = response.status;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) error.retryAfterMs = Math.max(0, delay);
  }
  return error;
}
