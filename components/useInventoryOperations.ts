"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A scope change hides the previous result immediately, including before its effect runs. */
export function useInventoryReadModel<T>(path: string, scope: string, active = true, refreshKey?: unknown) {
  const [result, setResult] = useState<{ scope: string; data: T } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const current = useRef(scope); current.current = scope;
  const sequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!active || !scope) return;
    const requestedScope = scope, run = ++sequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(path, { cache: "no-store", signal });
      const body = await response.json();
      if (signal?.aborted || current.current !== requestedScope || sequence.current !== run) return;
      if (!response.ok) { if (response.status === 401 || response.status === 403) setResult(null); throw new Error(body.error || "在庫情報を読み込めませんでした。"); }
      setResult({ scope: requestedScope, data: body });
      return body as T;
    } catch (failure) {
      if (!signal?.aborted && current.current === requestedScope && sequence.current === run) setError(failure instanceof Error ? failure.message : "在庫情報を読み込めませんでした。");
    } finally { if (!signal?.aborted && current.current === requestedScope && sequence.current === run) setLoading(false); }
  }, [active, scope, path]);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setLoading(false);
    void load(controller.signal);
    return () => { controller.abort(); ++sequence.current; };
  }, [load, refreshKey]);
  return { data: result?.scope === scope ? result.data : null, error, loading, load };
}

/** Keep an uncertain submission immutable across retries and reloads. A 409 requires explicit review. */
export function useInventoryOperation(path: string, storeId: string, onChanged?: () => void) {
  type Payload = Record<string, unknown> & { requestId: string };
  const [pendingState, setPendingState] = useState<{ storeId: string; payload: Payload } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const currentStore = useRef(storeId); currentStore.current = storeId;
  const busyRef = useRef(false), pendingRef = useRef<Payload | null>(null);
  const changedRef = useRef(onChanged); changedRef.current = onChanged;
  const storageKey = `foundr1:inventory-operation:${path}:${storeId}`;
  useEffect(() => {
    setError(""); setNotice(""); setBusy(false); setNeedsReview(false); pendingRef.current = null; setPendingState(null);
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved.requestId === "string" && typeof saved.action === "string") {
        pendingRef.current = saved; setPendingState({ storeId, payload: saved });
      }
    } catch { /* The original server nonce is never invented from an invalid draft. */ }
  }, [storeId, storageKey]);
  const pending = pendingState?.storeId === storeId ? pendingState.payload : null;
  async function submit(input: Record<string, unknown>) {
    if (busyRef.current || !storeId || (!pending && needsReview)) return false;
    const payload = pendingRef.current ?? { ...input, requestId: crypto.randomUUID() };
    const submittedStore = storeId, submittedKey = storageKey;
    try { window.localStorage.setItem(submittedKey, JSON.stringify(payload)); } catch { setError("送信内容を保存できませんでした。もう一度確認してください。"); return false; }
    pendingRef.current = payload; setPendingState({ storeId, payload }); busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (response.ok || response.status < 500) {
        try { window.localStorage.removeItem(submittedKey); } catch { /* Server nonce still prevents duplicates. */ }
      }
      if (currentStore.current !== submittedStore) return false;
      if (response.ok) {
        pendingRef.current = null; setPendingState(null); setNeedsReview(false);
        setNotice(body.replayed ? "この操作は登録済みです。重複して記録しません。" : "在庫の操作を記録しました。");
        changedRef.current?.(); return true;
      }
      if (response.status < 500) { pendingRef.current = null; setPendingState(null); if (response.status === 409) { setNeedsReview(true); changedRef.current?.(); } }
      setError(body.error || (response.status >= 500 ? "送信結果を確認できません。同じ内容で再送してください。" : "入力内容と最新の在庫を確認してください。"));
    } catch { if (currentStore.current === submittedStore) setError("送信結果を確認できません。同じ内容で再送してください。"); }
    finally { busyRef.current = false; setBusy(false); }
    return false;
  }
  return { pending, busy, error, notice, needsReview, submit, confirmReview: () => setNeedsReview(false) };
}
