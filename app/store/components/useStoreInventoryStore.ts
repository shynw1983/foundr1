"use client";

import { useEffect, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "./store-selection";
import { loadStoreInventoryStore } from "./store-inventory-store";

export function useStoreInventoryStore() {
  const [storeId, setStoreId] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const explicitStoreId = new URLSearchParams(window.location.search).get("storeId")?.trim() ?? null;
    void (async () => {
      try {
        const result = await loadStoreInventoryStore({ explicitStoreId, storedStoreId: explicitStoreId !== null ? "" : getStoredStoreSelection(), signal: controller.signal });
        if (!mounted.current || controller.signal.aborted) return;
        setStores(result.stores); setStoreId(result.storeId); setStoredStoreSelection(result.storeId);
      } catch (failure) { if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "店舗を確認できませんでした。"); }
      finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  return { storeId, storeName: stores.find(store => store.id === storeId)?.name ?? "", stores, error, loading };
}
