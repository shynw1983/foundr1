"use client";

import { useEffect, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "./store-selection";

export function useStoreInventoryStore() {
  const [storeId, setStoreId] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const requested = new URLSearchParams(window.location.search).get("storeId")?.trim() || getStoredStoreSelection();
    void (async () => {
      try {
        const response = await fetch(`/api/store/context${requested ? `?storeId=${encodeURIComponent(requested)}` : ""}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!mounted.current || controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "この店舗の在庫を確認する権限がありません。");
        const selected = String(body.selectedStoreId ?? "");
        if (!selected || (requested && selected !== requested)) throw new Error("指定した店舗を確認できません。担当者に確認してください。");
        setStores(body.access?.stores ?? []); setStoreId(selected); setStoredStoreSelection(selected);
      } catch (failure) { if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "店舗を確認できませんでした。"); }
      finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  return { storeId, storeName: stores.find(store => store.id === storeId)?.name ?? "", stores, error, loading };
}
