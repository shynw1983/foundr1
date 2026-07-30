"use client";

import { CheckCircle2, ChefHat, Clock3 } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";
import { useVisibleRefresh } from "../../components/useVisibleRefresh";

type PickupOrder = {
  id: string;
  pickupCode: string;
  orderSource: "uber_eats" | "demae_can" | "rocket_now" | "maamaa_web" | "nanacha_web";
  status: "new" | "preparing" | "ready";
  estimatedPrepMinutes: number;
  estimatedReadyAt: string;
  createdTime: string;
};

type StoreOption = {
  id: string;
  name: string;
};

type BrandLogo = {
  name: string;
  logoUrl: string;
};

const platformLabels: Record<PickupOrder["orderSource"], string> = {
  uber_eats: "Uber Eats",
  demae_can: "出前館",
  rocket_now: "Rocket Now",
  maamaa_web: "まぁ麻 Web予約",
  nanacha_web: "nanacha Web予約"
};

function countdownLabel(order: PickupOrder, now: number) {
  const target = new Date(order.estimatedReadyAt).getTime();
  if (!order.estimatedReadyAt || Number.isNaN(target)) return "制作中";
  const remainingMs = target - now;
  if (remainingMs <= 0) return "まもなく完成";
  return `あと ${Math.max(1, Math.ceil(remainingMs / 60000))}分`;
}

function OrderCard({ order, now, ready = false }: { order: PickupOrder; now: number; ready?: boolean }) {
  const codeLength = Math.max(1, Array.from(order.pickupCode).length);
  const cardStyle = {
    "--courier-code-width-font": `${130 / codeLength}cqw`
  } as CSSProperties;
  return (
    <article
      className={`store-courier-order platform-${order.orderSource}${ready ? " is-ready" : ""}`}
      style={cardStyle}
    >
      <strong>{order.pickupCode}</strong>
      <div>
        <span>{platformLabels[order.orderSource]}</span>
        <b>{ready ? "お渡しできます" : order.status === "preparing" ? countdownLabel(order, now) : "受付済み"}</b>
      </div>
    </article>
  );
}

function getOrderGridLayout(count: number, wide: boolean) {
  const maxColumns = wide
    ? (count > 3 ? 4 : 3)
    : (count > 2 ? 3 : 2);
  const columns = Math.max(1, Math.min(count || 1, maxColumns));
  const rows = Math.max(1, Math.ceil((count || 1) / columns));
  const density = rows >= 3 ? "is-compact" : rows === 2 ? "is-dense" : "is-comfortable";
  return {
    columns,
    rows,
    density,
    style: {
      "--courier-grid-columns": columns,
      "--courier-grid-rows": rows
    } as CSSProperties
  };
}

export default function StorePickupStatusDisplayPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [brandLogos, setBrandLogos] = useState<BrandLogo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedStoreIdRef = useRef(selectedStoreId);
  const serverOffsetRef = useRef(0);
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + serverOffsetRef.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function load(storeId = selectedStoreIdRef.current) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    params.set("ts", String(Date.now()));
    const response = await fetch(`/api/store/display/courier?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    const nextStoreId = String(body.selectedStoreId || storeId || "");
    const serverNow = new Date(String(body.serverNow || "")).getTime();
    if (Number.isFinite(serverNow)) {
      serverOffsetRef.current = serverNow - Date.now();
      setNow(serverNow);
    }
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setOrders(body.orders ?? []);
    setBrandLogos(body.brandLogos ?? []);
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date()));
  }

  useVisibleRefresh(() => {
    void load();
  });

  useEffect(() => {
    void load();
    if (realtimeStatus === "connected") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(selectedStoreIdRef.current);
    }, 5000);
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
        const { acquireSharedPusher } = await import("../../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        pusher.connection.bind("unavailable", () => active && setRealtimeStatus("polling"));
        pusher.connection.bind("failed", () => active && setRealtimeStatus("polling"));
        pusher.connection.bind("disconnected", () => active && setRealtimeStatus("polling"));
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", () => active && setRealtimeStatus("connected"));
          channel.bind("pusher:subscription_error", () => active && setRealtimeStatus("polling"));
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

  const readyOrders = useMemo(() => orders.filter((order) => order.status === "ready"), [orders]);
  const preparingOrders = useMemo(() => orders.filter((order) => order.status === "preparing"), [orders]);
  const waitingOrders = useMemo(() => orders.filter((order) => order.status === "new"), [orders]);
  const readyLayout = getOrderGridLayout(readyOrders.length, true);
  const preparingLayout = getOrderGridLayout(preparingOrders.length, false);
  const waitingLayout = getOrderGridLayout(waitingOrders.length, false);
  const workRows = Math.max(preparingLayout.rows, waitingLayout.rows);
  const displayLayoutStyle = {
    "--courier-ready-size": `${readyOrders.length ? readyLayout.rows + 0.5 : 0.5}fr`,
    "--courier-work-size": `${preparingOrders.length || waitingOrders.length ? workRows + 0.5 : 0.5}fr`
  } as CSSProperties;
  const workLayoutStyle = {
    "--courier-preparing-size": preparingOrders.length
      ? (waitingOrders.length ? "1fr" : "1.55fr")
      : "0.45fr",
    "--courier-waiting-size": waitingOrders.length
      ? (preparingOrders.length ? "1fr" : "1.55fr")
      : "0.45fr"
  } as CSSProperties;

  return (
    <main className="store-courier-display" style={displayLayoutStyle}>
      <button
        className="store-display-menu-button"
        type="button"
        aria-label="メニュー"
        onClick={() => {
          if (!menuOpen) void activateDisplayMode();
          setMenuOpen((current) => !current);
        }}
      />
      {menuOpen ? (
        <div className="store-display-menu">
          <strong>Pick Up 画面</strong>
          {stores.length > 1 ? (
            <label className="store-context-selector is-store is-compact">
              <span>表示店舗</span>
              <select value={selectedStoreId} onChange={(event) => {
                const storeId = event.target.value;
                setSelectedStoreId(storeId);
                selectedStoreIdRef.current = storeId;
                setStoredStoreSelection(storeId);
                void load(storeId);
              }}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="secondary-button" type="button" onClick={() => void load()}>更新</button>
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            全画面・常時点灯 ON
          </button>
          <small>{realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"}</small>
          <a className="secondary-button" href="/store/display/kitchen">キッチン</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
        </div>
      ) : null}

      <header className="store-courier-header">
        <div className="store-courier-brand-lockup">
          {brandLogos.length ? (
            <span className={`store-courier-brand-logos${brandLogos.length > 1 ? " is-multiple" : ""}`}>
              {brandLogos.map((brand) => (
                <Image
                  key={`${brand.name}-${brand.logoUrl}`}
                  className="store-courier-brand-logo"
                  src={brand.logoUrl}
                  alt={`${brand.name} ロゴ`}
                  width={brand.logoUrl.includes("slogan-landscape") ? 1772 : 512}
                  height={brand.logoUrl.includes("slogan-landscape") ? 591 : 512}
                  priority
                />
              ))}
            </span>
          ) : (
            <span className="store-courier-brand-mark">F1</span>
          )}
        </div>
        <div className="store-courier-title">
          <h1>Pick Up 状況</h1>
          <p>注文番号をご確認ください</p>
        </div>
        <span className="store-courier-live"><i />自動更新中</span>
      </header>

      <section className="store-courier-ready store-courier-status-panel is-ready">
        <div className="store-courier-section-head">
          <span className="store-courier-status-icon"><CheckCircle2 aria-hidden="true" /></span>
          <div className="store-courier-section-copy">
            <small>READY TO PICK UP</small>
            <div>
              <h2>お渡しできます</h2>
              <p>スタッフへお声がけください</p>
            </div>
          </div>
          <span className="store-courier-status-count">
            <strong>{readyOrders.length}</strong>
            <small>件</small>
          </span>
        </div>
        <div
          className={`store-courier-ready-grid ${readyLayout.density}`}
          style={readyLayout.style}
        >
          {readyOrders.map((order) => <OrderCard key={order.id} order={order} now={now} ready />)}
          {!readyOrders.length ? (
            <div className="store-courier-empty">
              <CheckCircle2 aria-hidden="true" />
              <p>現在、お渡しできる注文はありません</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="store-courier-work-grid" style={workLayoutStyle}>
        <section className="store-courier-status-panel is-preparing">
          <div className="store-courier-section-head">
            <span className="store-courier-status-icon"><ChefHat aria-hidden="true" /></span>
            <div className="store-courier-section-copy">
              <small>NOW PREPARING</small>
              <div>
                <h2>制作中</h2>
                <p>ただいま順番にお作りしています</p>
              </div>
            </div>
            <span className="store-courier-status-count">
              <strong>{preparingOrders.length}</strong>
              <small>件</small>
            </span>
          </div>
          <div
            className={`store-courier-order-grid ${preparingLayout.density}`}
            style={preparingLayout.style}
          >
            {preparingOrders.map((order) => <OrderCard key={order.id} order={order} now={now} />)}
            {!preparingOrders.length ? (
              <div className="store-courier-empty">
                <ChefHat aria-hidden="true" />
                <p>現在、制作中の注文はありません</p>
              </div>
            ) : null}
          </div>
        </section>
        <section className="store-courier-status-panel is-waiting">
          <div className="store-courier-section-head">
            <span className="store-courier-status-icon"><Clock3 aria-hidden="true" /></span>
            <div className="store-courier-section-copy">
              <small>ORDER RECEIVED</small>
              <div>
                <h2>制作前</h2>
                <p>ご注文を受け付けました</p>
              </div>
            </div>
            <span className="store-courier-status-count">
              <strong>{waitingOrders.length}</strong>
              <small>件</small>
            </span>
          </div>
          <div
            className={`store-courier-order-grid ${waitingLayout.density}`}
            style={waitingLayout.style}
          >
            {waitingOrders.map((order) => <OrderCard key={order.id} order={order} now={now} />)}
            {!waitingOrders.length ? (
              <div className="store-courier-empty">
                <Clock3 aria-hidden="true" />
                <p>現在、制作前の注文はありません</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
