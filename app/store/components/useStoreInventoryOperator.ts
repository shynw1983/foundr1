"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StoreInventoryOperatorContext } from "../../../lib/store-inventory-access";
export type { StoreInventoryOperatorContext } from "../../../lib/store-inventory-access";
export type StoreInventoryOperator = NonNullable<StoreInventoryOperatorContext["operator"]>;

export function useStoreInventoryOperator(storeId: string) {
  const [context, setContext] = useState<{ storeId: string; data: StoreInventoryOperatorContext } | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const currentStore = useRef(storeId); currentStore.current = storeId;
  const sequence = useRef(0), writing = useRef(false);
  const load = useCallback(async () => {
    if (!storeId) return;
    const request = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/store/inventory/operator?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
      const body = await response.json();
      if (currentStore.current !== storeId || sequence.current !== request) return;
      if (!response.ok) throw new Error(body.error || "操作担当者を確認できませんでした。再確認してください。");
      setContext({ storeId, data: body });
    } catch (failure) {
      if (currentStore.current === storeId && sequence.current === request) { setContext(null); setError(failure instanceof Error ? failure.message : "操作担当者を確認できませんでした。再確認してください。"); }
    } finally { if (currentStore.current === storeId && sequence.current === request) setLoading(false); }
  }, [storeId]);
  useEffect(() => { setContext(null); setError(""); void load(); return () => { ++sequence.current; }; }, [load]);
  const data = context?.storeId === storeId ? context.data : null;
  useEffect(() => {
    if (!data?.operator?.expiresAt) return;
    const expires = Date.parse(data.operator.expiresAt);
    if (!Number.isFinite(expires)) { setContext(null); return; }
    const timer = window.setTimeout(() => { setContext(null); void load(); }, Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [data?.operator?.expiresAt, load]);
  async function change(method: "POST" | "DELETE", credentials?: { loginId: string; password: string }) {
    if (!storeId || writing.current) return false;
    writing.current = true; setBusy(true); setError("");
    const savedStore = storeId;
    try {
      const response = await fetch("/api/store/inventory/operator", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, ...credentials }) });
      const body = await response.json();
      if (currentStore.current !== savedStore) return false;
      if (!response.ok) throw new Error(body.error || "操作担当者を確認できませんでした。再確認してください。");
      setContext(null); await load(); return true;
    } catch (failure) {
      if (currentStore.current === savedStore) setError(failure instanceof Error ? failure.message : "操作担当者を確認できませんでした。再確認してください。");
      return false;
    } finally { writing.current = false; setBusy(false); }
  }
  function invalidate() { setContext(null); void load(); }
  const expiresAt = data?.operator?.expiresAt;
  const validTime = !expiresAt || (Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now());
  return { isTerminal: data?.baseRole === "store_terminal", operator: data?.operator ?? null, canOperate: Boolean(data?.canOperate && data.operator && validTime && !busy), requiresOperatorAuthentication: data?.requiresOperatorAuthentication ?? true, loading, busy, error, refresh: load, invalidate, authorize: (loginId: string, password: string) => change("POST", { loginId, password }), clear: () => change("DELETE") };
}
