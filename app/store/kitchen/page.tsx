"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type KitchenTask = {
  id: string;
  orderId: string;
  productionArea: string;
  productionAreaLabel: string;
  status: string;
  printStatus: string;
  itemSummary: string;
  pickupCode: string;
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
  new: "待ち",
  preparing: "制作中",
  ready: "完成"
};

const orderTypeLabels: Record<string, string> = {
  eat_in: "店内",
  takeout: "持ち帰り",
  delivery: "外送"
};

function splitLines(value: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
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
  const selectedStoreIdRef = useRef(selectedStoreId);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  async function load(storeId = selectedStoreIdRef.current, area = selectedArea) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (area) params.set("area", area);
    const response = await fetch(`/api/store/kitchen?${params.toString()}`, { cache: "no-store" });
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
    setLastUpdatedAt(new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    setLoading(false);
  }

  async function updateTask(task: KitchenTask, status: "preparing" | "ready") {
    setSavingId(task.id);
    const response = await fetch("/api/store/kitchen", {
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

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(selectedStoreIdRef.current, selectedArea), 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea]);

  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== "ready"), [tasks]);
  const readyTasks = useMemo(() => tasks.filter((task) => task.status === "ready"), [tasks]);

  return (
    <main className="store-workbench-shell store-kitchen-page">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Kitchen</p>
            <h1>制作屏</h1>
          </div>
        </a>
        <StoreNavTabs active="kitchen" />
      </header>

      <section className="store-kitchen-toolbar">
        {stores.length > 1 ? (
          <select value={selectedStoreId} onChange={(event) => {
            const storeId = event.target.value;
            setSelectedStoreId(storeId);
            selectedStoreIdRef.current = storeId;
            setStoredStoreSelection(storeId);
            void load(storeId, selectedArea);
          }}>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        ) : null}
        <select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)} aria-label="制作区">
          <option value="">全部</option>
          {areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}
        </select>
        <button className="secondary-button" type="button" onClick={() => void load()}>{loading ? "読み込み中" : "更新"}</button>
        <span>{lastUpdatedAt ? `更新 ${lastUpdatedAt}` : ""}</span>
      </section>

      <section className="store-kitchen-board">
        <div>
          <h2>待ち / 制作中</h2>
          <div className="store-kitchen-task-grid">
            {visibleTasks.map((task) => (
              <article className={`store-kitchen-task is-${task.status}`} key={task.id}>
                <div className="store-kitchen-task-head">
                  <strong>{task.pickupCode}</strong>
                  <span>{task.productionAreaLabel} / {statusLabels[task.status]}</span>
                </div>
                <p>{(orderTypeLabels[task.orderType] ?? task.orderType) || "受け取り"} / {task.createdTime}</p>
                <div className="store-kitchen-items">
                  {splitLines(task.itemSummary).map((line) => <span key={line}>{line}</span>)}
                </div>
                {task.note ? <p className="store-kitchen-note">{task.note}</p> : null}
                <div className="store-kitchen-actions">
                  {task.status === "new" ? (
                    <button className="secondary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "preparing")}>制作開始</button>
                  ) : null}
                  <button className="primary-button" type="button" disabled={savingId === task.id} onClick={() => updateTask(task, "ready")}>完成</button>
                </div>
              </article>
            ))}
            {!visibleTasks.length ? <p className="store-kitchen-empty">待ちの制作タスクはありません。</p> : null}
          </div>
        </div>

        <aside>
          <h2>完成</h2>
          <div className="store-kitchen-ready-list">
            {readyTasks.map((task) => (
              <div key={task.id}>
                <strong>{task.pickupCode}</strong>
                <span>{task.productionAreaLabel}</span>
              </div>
            ))}
            {!readyTasks.length ? <p>完成待ちです。</p> : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
