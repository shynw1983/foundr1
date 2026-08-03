"use client";

import { Store } from "lucide-react";
import { useEffect, useState } from "react";

type StoreOption = {
  id: string;
  name: string;
};

type StoreContextResponse = {
  canSelectStore?: boolean;
  selectedStoreId?: string;
  stores?: StoreOption[];
};

export function OsStoreContextPicker() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [canSelectStore, setCanSelectStore] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    fetch("/api/os/store-context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<StoreContextResponse> : null)
      .then((body) => {
        if (!isMounted || !body) return;
        setCanSelectStore(body.canSelectStore === true);
        setStores(body.stores ?? []);
        setSelectedStoreId(String(body.selectedStoreId ?? ""));
      })
      .catch(() => {
        if (isMounted) setError("店舗一覧を読み込めませんでした。");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!canSelectStore) return null;

  async function changeStore(storeId: string) {
    setSelectedStoreId(storeId);
    setError("");
    if (!storeId) return;

    setIsChanging(true);
    const response = await fetch("/api/os/store-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId })
    }).catch(() => null);

    if (!response?.ok) {
      const body = await response?.json().catch(() => ({})) as { error?: string } | undefined;
      setError(body?.error ?? "店舗を切り替えられませんでした。");
      setIsChanging(false);
      return;
    }

    window.location.reload();
  }

  return (
    <label className="os-global-store-picker" title="すべてのOS機能に適用する店舗">
      <span className="os-global-store-picker-label">
        <Store size={14} aria-hidden="true" />
        対象店舗
      </span>
      <select
        aria-label="OS全体の対象店舗"
        aria-invalid={Boolean(error)}
        disabled={isChanging || stores.length === 0}
        value={selectedStoreId}
        onChange={(event) => void changeStore(event.target.value)}
      >
        <option value="" disabled>{stores.length ? "店舗を選択" : "店舗がありません"}</option>
        {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
      </select>
      {error ? <span className="os-global-store-picker-error" role="alert">{error}</span> : null}
    </label>
  );
}
