"use client";

import { useEffect, useRef, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type PickupOrder = {
  pickupCode: string;
  status: string;
  orderType: string;
  createdTime: string;
};

type StoreOption = {
  id: string;
  name: string;
};

export default function StorePickupDisplayPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [preparing, setPreparing] = useState<PickupOrder[]>([]);
  const [ready, setReady] = useState<PickupOrder[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const selectedStoreIdRef = useRef(selectedStoreId);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  async function load(storeId = selectedStoreIdRef.current) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/pickup-display?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    const nextStoreId = String(body.selectedStoreId || storeId || "");
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setPreparing(body.preparing ?? []);
    setReady(body.ready ?? []);
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(selectedStoreIdRef.current), 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="store-workbench-shell store-pickup-display-page">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Pickup</p>
            <h1>取餐屏</h1>
          </div>
        </a>
        <StoreNavTabs active="pickup-display" />
      </header>

      <section className="store-pickup-toolbar">
        {stores.length > 1 ? (
          <select value={selectedStoreId} onChange={(event) => {
            const storeId = event.target.value;
            setSelectedStoreId(storeId);
            selectedStoreIdRef.current = storeId;
            setStoredStoreSelection(storeId);
            void load(storeId);
          }}>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        ) : null}
        <span>{lastUpdatedAt ? `更新 ${lastUpdatedAt}` : ""}</span>
      </section>

      <section className="store-pickup-board">
        <div className="store-pickup-column is-ready">
          <h2>準備完了</h2>
          <div className="store-pickup-code-grid">
            {ready.map((order) => <strong key={`${order.pickupCode}-${order.createdTime}`}>{order.pickupCode}</strong>)}
            {!ready.length ? <p>完成した注文はありません。</p> : null}
          </div>
        </div>
        <div className="store-pickup-column">
          <h2>制作中</h2>
          <div className="store-pickup-code-grid">
            {preparing.map((order) => <strong key={`${order.pickupCode}-${order.createdTime}`}>{order.pickupCode}</strong>)}
            {!preparing.length ? <p>制作中の注文はありません。</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
