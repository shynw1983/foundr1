"use client";

import { MonitorSmartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";

type StoreOption = {
  id: string;
  name: string;
};

type DisplayItem = {
  name: string;
  optionLabel: string;
  weightLabel: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type DisplayState = {
  status: string;
  storeName: string;
  orderType: string;
  paymentMethod: string;
  paymentLabel: string;
  externalPaymentTerminalBrand: string;
  pickupCode: string;
  preferredLanguage: string;
  memberDisplayName: string;
  memberMessage: string;
  subtotal: number;
  cashTenderedAmount: number | null;
  cashChangeAmount: number | null;
  updatedLabel: string;
  updatedAt: string;
  items: DisplayItem[];
};

const idleState: DisplayState = {
  status: "idle",
  storeName: "",
  orderType: "",
  paymentMethod: "cash",
  paymentLabel: "現金",
  externalPaymentTerminalBrand: "PayCAS",
  pickupCode: "",
  preferredLanguage: "",
  memberDisplayName: "",
  memberMessage: "",
  subtotal: 0,
  cashTenderedAmount: null,
  cashChangeAmount: null,
  updatedLabel: "",
  updatedAt: "",
  items: []
};

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function getStatusLabel(state: DisplayState) {
  if (state.status === "advertising") return "いらっしゃいませ";
  if (state.status === "complete") return "決済完了";
  if (state.status === "cash_change") return "お釣りをお受け取りください";
  if (state.status === "external_wait") return "端末でお支払いください";
  if (state.items.length > 0) return "注文内容をご確認ください";
  return "いらっしゃいませ";
}

function getOrderTypeLabel(value: string) {
  if (value === "eat_in") return "店内";
  if (value === "takeout") return "持ち帰り";
  return "";
}

export default function CustomerDisplayPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [state, setState] = useState<DisplayState>(idleState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "polling">("connecting");
  const [clockDate, setClockDate] = useState(() => new Date());
  const selectedStoreIdRef = useRef("");
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  const visibleItems = useMemo(() => state.items.slice(0, 12), [state.items]);
  const hiddenItemCount = Math.max(0, state.items.length - visibleItems.length);
  const changeAmount = state.cashChangeAmount ?? 0;
  const advertisingActive = state.status === "advertising";
  const clockLabel = useMemo(() => new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(clockDate), [clockDate]);
  const clockSubLabel = useMemo(() => new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(clockDate), [clockDate]);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockDate(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function load(storeId = selectedStoreIdRef.current || getStoredStoreSelection()) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/pos/customer-display${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error || "客席表示データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const nextStoreId = body.selectedStoreId ?? storeId ?? "";
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setState({ ...idleState, ...(body.state ?? {}) });
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storeId = params.get("storeId") || getStoredStoreSelection();
    selectedStoreIdRef.current = storeId;
    void load(storeId);
    const interval = window.setInterval(() => {
      const currentStoreId = new URLSearchParams(window.location.search).get("storeId") || selectedStoreIdRef.current || getStoredStoreSelection();
      void load(currentStoreId);
    }, realtimeStatus === "connected" ? 60000 : 1200);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    const storeId = selectedStoreId;
    if (!storeId) {
      setRealtimeStatus("polling");
      return () => {
        active = false;
      };
    }

    const refreshDisplay = (payload?: { storeId?: string; state?: Partial<DisplayState> }) => {
      if (payload?.storeId && payload.storeId !== selectedStoreIdRef.current) return;
      if (payload?.state) {
        setState({ ...idleState, ...payload.state });
        setMessage("");
        setLoading(false);
        return;
      }
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
          channel.bind("pos.customer-display.updated", refreshDisplay);
          return channel;
        });
      })
      .catch(() => {
        if (active) setRealtimeStatus("polling");
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("pos.customer-display.updated", refreshDisplay);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    selectedStoreIdRef.current = storeId;
    setStoredStoreSelection(storeId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("storeId", storeId);
    window.history.replaceState(null, "", nextUrl.toString());
    void load(storeId);
  }

  return (
    <main className={advertisingActive ? "customer-display-page is-advertising" : "customer-display-page"}>
      <button
        className={`store-display-menu-button customer-display-menu-button ${realtimeStatus === "connected" ? "is-realtime" : "is-polling"}`}
        type="button"
        aria-label="メニュー"
        onClick={() => {
          if (!menuOpen) void activateDisplayMode();
          setMenuOpen((current) => !current);
        }}
      />
      {menuOpen ? (
        <div className="store-display-menu customer-display-menu">
          <strong>客席表示</strong>
          {stores.length > 1 ? (
            <select value={selectedStoreId} onChange={(event) => handleStoreChange(event.target.value)}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          ) : null}
          <button className="secondary-button" type="button" onClick={() => void load(selectedStoreIdRef.current)}>
            {loading ? "読み込み中" : "更新"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            全画面・常時点灯 ON
          </button>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"} / 同期 {realtimeStatus === "connected" ? "リアルタイム" : "自動更新"}</small>
          <a className="secondary-button" href="/store/pos">POS</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/os/logout">ログアウト</a>
        </div>
      ) : null}

      {advertisingActive ? (
        <section className="customer-display-advertising" aria-live="polite">
          <div className="customer-display-clock" aria-label={`${clockLabel} ${clockSubLabel}`}>
            <span>{clockLabel}</span>
            <small>{clockSubLabel}</small>
          </div>
          <div className="customer-display-advertising-copy">
            <strong>Welcome</strong>
            <p>ご来店ありがとうございます</p>
          </div>
        </section>
      ) : (
        <>
      <header className="customer-display-topbar">
        <div className="customer-display-clock" aria-label={`${clockLabel} ${clockSubLabel}`}>
          <span>{clockLabel}</span>
          <small>{clockSubLabel}</small>
        </div>
        <div className="customer-display-status-title">
          <h1>{getStatusLabel(state)}</h1>
        </div>
      </header>

      {message ? <div className="customer-display-message">{message}</div> : null}

      <section className="customer-display-layout">
        <div className="customer-display-items">
          <div className="customer-display-section-head">
            <span>ご注文内容</span>
            <strong>{state.items.reduce((sum, item) => sum + item.quantity, 0)} 点</strong>
          </div>

          {loading ? (
            <div className="customer-display-empty">
              <MonitorSmartphone />
              <p>読み込み中...</p>
            </div>
          ) : state.items.length === 0 ? (
            <div className="customer-display-empty">
              <MonitorSmartphone />
              <p>ご注文をお待ちしています。</p>
            </div>
          ) : (
            <div className="customer-display-item-list">
              {visibleItems.map((item, index) => (
                <div className="customer-display-item" key={`${item.name}-${index}`}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.weightLabel ? <span>{item.weightLabel}</span> : null}
                    {item.optionLabel ? <span>{item.optionLabel}</span> : null}
                  </div>
                  <em>{item.weightLabel ? "" : `x${item.quantity}`}</em>
                  <b>{formatYen(item.amount)}</b>
                </div>
              ))}
              {hiddenItemCount > 0 ? <div className="customer-display-more">ほか {hiddenItemCount} 点</div> : null}
            </div>
          )}
        </div>

        <aside className={`customer-display-payment is-${state.status || "idle"}`}>
          {state.memberDisplayName ? (
            <div className="customer-display-member">
              <span>{state.memberDisplayName}</span>
              <strong>{state.memberMessage || "いつもご利用いただきありがとうございます。"}</strong>
            </div>
          ) : null}

          <div className="customer-display-meta">
            {state.pickupCode ? <span>番号 {state.pickupCode}</span> : <span>{getOrderTypeLabel(state.orderType) || "店頭会計"}</span>}
            <span>{state.paymentLabel || "お支払い"}</span>
          </div>

          <div className="customer-display-total">
            <span>合計</span>
            <strong>{formatYen(state.subtotal)}</strong>
          </div>

          {state.paymentMethod === "cash" ? (
            <div className="customer-display-cash">
              <div>
                <span>お預り</span>
                <strong>{state.cashTenderedAmount === null ? "-" : formatYen(state.cashTenderedAmount)}</strong>
              </div>
              <div className={changeAmount < 0 ? "is-short" : ""}>
                <span>お釣り</span>
                <strong>{state.cashChangeAmount === null ? "-" : formatYen(Math.max(0, changeAmount))}</strong>
                {changeAmount < 0 ? <small>不足 {formatYen(Math.abs(changeAmount))}</small> : null}
              </div>
            </div>
          ) : (
            <div className="customer-display-terminal">
              <span>{state.externalPaymentTerminalBrand || state.paymentLabel || "決済端末"}</span>
              <strong>決済端末でお支払いください</strong>
              <small>カード・電子マネー・QR 決済</small>
            </div>
          )}

          {state.status === "complete" ? (
            <div className="customer-display-complete">
              <strong>ありがとうございました</strong>
              <span>商品をお受け取りください。</span>
            </div>
          ) : null}
        </aside>
      </section>
        </>
      )}
    </main>
  );
}
