"use client";

import { useEffect, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";
import { useVisibleRefresh } from "../../components/useVisibleRefresh";

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

const voiceSettingKey = "store:pickup-display-voice-enabled";

function getStoredVoiceEnabled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(voiceSettingKey) === "1";
}

function getSpeechText(pickupCode: string) {
  const readableCode = pickupCode.replace("-", "、");
  return `番号 ${readableCode}、準備できました。`;
}

export default function StorePickupDisplayPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [preparing, setPreparing] = useState<PickupOrder[]>([]);
  const [ready, setReady] = useState<PickupOrder[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const selectedStoreIdRef = useRef(selectedStoreId);
  const voiceEnabledRef = useRef(false);
  const knownReadyCodesRef = useRef<Set<string>>(new Set());
  const hasInitializedReadyCodesRef = useRef(false);
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  async function load(storeId = selectedStoreIdRef.current) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    params.set("ts", String(Date.now()));
    const response = await fetch(`/api/store/display/pickup?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    const nextStoreId = String(body.selectedStoreId || storeId || "");
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setPreparing(body.preparing ?? []);
    const nextReady = (body.ready ?? []) as PickupOrder[];
    const nextReadyCodes = new Set(nextReady.map((order) => order.pickupCode));
    if (hasInitializedReadyCodesRef.current && voiceEnabledRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
      const newCodes = Array.from(nextReadyCodes).filter((code) => !knownReadyCodesRef.current.has(code));
      for (const code of newCodes) {
        const utterance = new SpeechSynthesisUtterance(getSpeechText(code));
        utterance.lang = "ja-JP";
        utterance.rate = 0.92;
        window.speechSynthesis.speak(utterance);
      }
    }
    knownReadyCodesRef.current = nextReadyCodes;
    hasInitializedReadyCodesRef.current = true;
    setReady(nextReady);
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  }

  useVisibleRefresh(() => {
    void load();
  });

  function enableVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechSupported(false);
      return;
    }
    window.localStorage.setItem(voiceSettingKey, "1");
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    const utterance = new SpeechSynthesisUtterance("音声案内を開始します。");
    utterance.lang = "ja-JP";
    utterance.rate = 0.92;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function disableVoice() {
    window.localStorage.removeItem(voiceSettingKey);
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function testVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechSupported(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance("番号 P、1234、準備できました。");
    utterance.lang = "ja-JP";
    utterance.rate = 0.92;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    const storedVoiceEnabled = getStoredVoiceEnabled();
    voiceEnabledRef.current = storedVoiceEnabled;
    setVoiceEnabled(storedVoiceEnabled);
  }, []);

  useEffect(() => {
    void load();
    if (realtimeStatus === "connected") return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void load(selectedStoreIdRef.current);
      },
      8000
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
        const { acquireSharedPusher } = await import("../../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
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
          <strong>受取表示</strong>
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
          <button
            className={voiceEnabled ? "secondary-button is-active" : "secondary-button"}
            type="button"
            onClick={voiceEnabled ? disableVoice : enableVoice}
            disabled={!speechSupported}
          >
            {voiceEnabled ? "音声 ON" : "音声 OFF"}
          </button>
          <button className="secondary-button" type="button" onClick={testVoice} disabled={!speechSupported}>
            音声テスト
          </button>
          <small>{realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"}</small>
          {!speechSupported ? <small>このブラウザは音声案内に対応していません。</small> : null}
          <a className="secondary-button" href="/store/orders">注文ワーク台</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
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
