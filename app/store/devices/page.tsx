"use client";

import { useEffect, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection } from "../components/store-selection";
import { StoreDevicesPanel } from "./StoreDevicesPanel";

export default function StoreDevicesPage() {
  const [store, setStore] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const stored = getStoredStoreSelection();
    void fetch(`/api/store/context${stored ? `?storeId=${encodeURIComponent(stored)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("店舗情報を取得できません。ログインと店舗の選択を確認してください。");
        const body = await response.json() as { selectedStoreId: string; access: { stores: Array<{ id: string; name: string }> } };
        const selected = body.access.stores.find(item => item.id === body.selectedStoreId);
        if (!selected) throw new Error("操作できる店舗がありません。");
        if (!controller.signal.aborted) setStore(selected);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div><p className="eyebrow">Foundr1 STORE</p><h1>店舗設備</h1></div>
        </a>
        <StoreNavTabs active="devices" />
      </header>
      {error ? <p className="store-light-page-error" role="alert">{error}</p> : store ? <StoreDevicesPanel key={store.id} storeId={store.id} storeName={store.name} /> : <p className="store-light-loading" role="status">店舗情報を読み込んでいます。</p>}
    </main>
  );
}
