"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";
import { useVisibleRefresh } from "../../components/useVisibleRefresh";

type KitchenTask = {
  id: string;
  orderId: string;
  productionArea: string;
  productionAreaLabel: string;
  status: string;
  printStatus: string;
  itemSummary: string;
  pickupCode: string;
  tableLabel: string;
  orderSource: string;
  orderType: string;
  note: string;
  createdTime: string;
};

type StoreOption = {
  id: string;
  name: string;
};

const statusLabels: Record<string, string> = {
  new: "制作待ち",
  preparing: "制作中",
  ready: "完成"
};

const orderTypeLabels: Record<string, string> = {
  eat_in: "店内",
  takeout: "持ち帰り",
  delivery: "外送"
};

function splitLines(value: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => ({
    text: line,
    isModifier: line.startsWith("・") || line.startsWith("- ")
  }));
}

function splitQuantityLabel(text: string) {
  const match = text.match(/^(.*?)( x\d+)$/);
  if (!match) return { label: text, quantity: "" };
  return { label: match[1], quantity: match[2].trim() };
}

export default function StoreKitchenPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [tasks, setTasks] = useState<KitchenTask[]>([]);
  const [areas, setAreas] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedArea, setSelectedArea] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkedLineKeys, setCheckedLineKeys] = useState<Set<string>>(() => new Set());
  const selectedStoreIdRef = useRef(selectedStoreId);
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  async function load(storeId = selectedStoreIdRef.current, area = selectedArea) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (area) params.set("area", area);
    params.set("ts", String(Date.now()));
    const response = await fetch(`/api/store/display/kitchen?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setLoading(false);
      return;
    }
    const body = await response.json();
    const nextStoreId = String(body.selectedStoreId || storeId || "");
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setTasks(body.tasks ?? []);
    setAreas(body.areas ?? []);
    setCheckedLineKeys((current) => {
      const validKeys = new Set<string>();
      for (const task of (body.tasks ?? []) as KitchenTask[]) {
        splitLines(task.itemSummary).forEach((_, index) => validKeys.add(`${task.id}:${index}`));
      }
      return new Set(Array.from(current).filter((key) => validKeys.has(key)));
    });
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    setLoading(false);
  }

  useVisibleRefresh(() => {
    void load();
  });

  function toggleLineCheck(key: string) {
    setCheckedLineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function updateTask(task: KitchenTask, status: "preparing" | "ready") {
    setSavingId(task.id);
    const response = await fetch("/api/store/display/kitchen", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, taskId: task.id, status, area: selectedArea })
    });
    if (response.ok) {
      const body = await response.json();
      setTasks(body.tasks ?? []);
      setAreas(body.areas ?? areas);
    } else {
      await load();
    }
    setSavingId("");
  }

  async function completeHandoff(task: KitchenTask) {
    setSavingId(task.id);
    const response = await fetch("/api/store/display/kitchen", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, orderId: task.orderId, status: "completed", area: selectedArea })
    });
    if (response.ok) {
      const body = await response.json();
      setTasks(body.tasks ?? []);
      setAreas(body.areas ?? areas);
    } else {
      await load();
    }
    setSavingId("");
  }

  useEffect(() => {
    void load();
    if (realtimeStatus === "connected") return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void load(selectedStoreIdRef.current, selectedArea);
      },
      8000
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus, selectedArea]);

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
      void load(selectedStoreIdRef.current, selectedArea);
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
  }, [selectedArea, selectedStoreId]);

  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== "ready"), [tasks]);
  const readyTasks = useMemo(() => tasks.filter((task) => task.status === "ready"), [tasks]);

  return (
    <main className="store-kitchen-display store-kitchen-page">
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
          <strong>キッチン</strong>
          {stores.length > 1 ? (
            <label className="store-context-selector is-store is-compact">
              <span>表示店舗</span>
              <select value={selectedStoreId} onChange={(event) => {
                const storeId = event.target.value;
                setSelectedStoreId(storeId);
                selectedStoreIdRef.current = storeId;
                setStoredStoreSelection(storeId);
                void load(storeId, selectedArea);
              }}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          ) : null}
          <select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)} aria-label="制作区">
            <option value="">全部</option>
            {areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}
          </select>
          <button className="secondary-button" type="button" onClick={() => void load()}>{loading ? "読み込み中" : "更新"}</button>
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            全画面・常時点灯 ON
          </button>
          <small>{realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}{lastUpdatedAt ? ` / ${lastUpdatedAt}` : ""}</small>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"}</small>
          <a className="secondary-button" href="/store/orders">注文ワーク台</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
        </div>
      ) : null}

      <section className="store-kitchen-board">
        <div>
          <h2>制作待ち / 制作中</h2>
          <div className="store-kitchen-task-grid">
            {visibleTasks.map((task) => (
              <article className={`store-kitchen-task is-${task.status}`} key={task.id}>
                <div className="store-kitchen-task-head">
                  <strong>{task.pickupCode}</strong>
                  <span>{task.productionAreaLabel} / {statusLabels[task.status]}</span>
                </div>
                <p>{(orderTypeLabels[task.orderType] ?? task.orderType) || "受け取り"}{task.tableLabel ? ` / 座席 ${task.tableLabel}` : ""} / {task.createdTime}</p>
                <div className="store-kitchen-items">
                  {splitLines(task.itemSummary).map((line, index) => {
                    const lineKey = `${task.id}:${index}`;
                    const quantityParts = splitQuantityLabel(line.text);
                    return (
                      <button
                        className={[
                          "store-kitchen-item-line",
                          line.isModifier ? "store-kitchen-item-modifier" : "store-kitchen-item-name",
                          checkedLineKeys.has(lineKey) ? "is-checked" : ""
                        ].filter(Boolean).join(" ")}
                        key={lineKey}
                        type="button"
                        aria-pressed={checkedLineKeys.has(lineKey)}
                        onClick={() => toggleLineCheck(lineKey)}
                      >
                        <span>{quantityParts.label}</span>
                        {quantityParts.quantity ? <b>{quantityParts.quantity}</b> : null}
                      </button>
                    );
                  })}
                </div>
                {task.note ? <p className="store-kitchen-note">{task.note}</p> : null}
                <div className="store-kitchen-actions">
                  {task.status === "new" ? (
                    <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "preparing")}>制作開始</button>
                  ) : null}
                  <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "ready")}>{task.orderType === "eat_in" ? "提供完了" : "完成"}</button>
                </div>
              </article>
            ))}
            {!visibleTasks.length ? <p className="store-kitchen-empty">制作待ちの制作タスクはありません。</p> : null}
          </div>
        </div>

        <aside>
          <h2>完成</h2>
          <div className="store-kitchen-ready-list">
            {readyTasks.map((task, taskIndex) => (
              <div key={task.id}>
                <strong>{task.pickupCode}</strong>
                <span>{task.productionAreaLabel}</span>
                {readyTasks.findIndex((candidate) => candidate.orderId === task.orderId) === taskIndex && tasks.every((candidate) => candidate.orderId !== task.orderId || candidate.status === "ready") ? (
                  <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => void completeHandoff(task)}>受渡完了</button>
                ) : null}
              </div>
            ))}
            {!readyTasks.length ? <p>完成待ちです。</p> : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
