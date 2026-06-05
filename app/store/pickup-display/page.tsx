"use client";

import { useEffect, useRef, useState } from "react";
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
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [menuOpen, setMenuOpen] = useState(false);
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
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void load(selectedStoreIdRef.current);
      },
      realtimeStatus === "connected" ? 60000 : 8000
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    const storeId = selectedStoreIdRef.current;
    if (!storeId) {
      setRealtimeStatus("polling");
      return () => {
        active = false;
      };
    }
    const refreshFromEvent = () => {
      void load(selectedStoreIdRef.current);
    };
    setRealtimeStatus("connecting");
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active) return;
        if (!config?.key || !config?.cluster || !config?.channels?.length) {
          setRealtimeStatus("polling");
          return;
        }
        const { default: Pusher } = await import("pusher-js");
        if (!active) return;
        pusher = new Pusher(config.key, {
          cluster: config.cluster,
          channelAuthorization: {
            endpoint: "/api/store/realtime-auth",
            transport: "ajax"
          }
        });
        pusher.connection.bind("unavailable", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("failed", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("disconnected", () => {
          if (active) setRealtimeStatus("polling");
        });
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", () => {
            if (active) setRealtimeStatus("connected");
          });
          channel.bind("pusher:subscription_error", () => {
            if (active) setRealtimeStatus("polling");
          });
          channel.bind("order.created", refreshFromEvent);
          channel.bind("order.updated", refreshFromEvent);
          return channel;
        });
      })
      .catch(() => {
        if (active) setRealtimeStatus("polling");
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("order.created", refreshFromEvent);
        channel.unbind("order.updated", refreshFromEvent);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  return (
    <main className="store-pickup-display-shell store-pickup-display-page">
      <button className="store-display-menu-button" type="button" aria-label="メニュー" onClick={() => setMenuOpen((current) => !current)} />
      {menuOpen ? (
        <div className="store-display-menu">
          <strong>取餐屏</strong>
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
          <button className="secondary-button" type="button" onClick={() => void load()}>更新</button>
          <small>{realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <a className="secondary-button" href="/store/orders">注文ワーク台</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/os/logout">ログアウト</a>
        </div>
      ) : null}

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
