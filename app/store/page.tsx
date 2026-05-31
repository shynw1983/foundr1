"use client";

import { BookOpen, CheckCircle2, Clock3, ClipboardList, PauseCircle, ShoppingCart, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { StoreNavTabs } from "./components/StoreNavTabs";
import { formatBusinessHoursSummary } from "../../lib/store-business-hours";

const storeModules = [
  {
    title: "注文",
    description: "Web予約注文を確認し、制作開始から受け渡し完了まで処理します。",
    href: "/store/orders",
    icon: ClipboardList,
    status: "利用可能"
  },
  {
    title: "販売状態",
    description: "本日の売切、販売再開、現場メモを商品ごとに更新します。",
    href: "/store/menu",
    icon: Tags,
    status: "利用可能"
  },
  {
    title: "手順書",
    description: "公開中の作業手順を確認し、店舗オペレーションを進めます。",
    href: "/store/procedures",
    icon: BookOpen,
    status: "利用可能"
  },
  {
    title: "タイムカード",
    description: "出退勤、休憩、シフト確認を行います。",
    href: "/store/timecard",
    icon: Clock3,
    status: "準備中"
  },
  {
    title: "POS",
    description: "会計、販売、メニュー操作を行います。",
    href: "/store/pos",
    icon: ShoppingCart,
    status: "準備中"
  }
];

type StoreOption = {
  id: string;
  name: string;
};

type StoreOperation = {
  id: string;
  name: string;
  businessHours: unknown;
  reservationNote: string;
  reservationsEnabled: boolean;
  statusNote: string;
  receptionState?: {
    manualStatusLabel: string;
    statusLabel: string;
    detailLabel: string;
    nextOpenLabel: string;
    isManuallyAccepting: boolean;
    isWithinBusinessHours: boolean;
    isAcceptingNow: boolean;
    tone: "active" | "warning" | "off";
  };
};

export default function StoreHomePage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [operation, setOperation] = useState<StoreOperation | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadOperation(storeId = selectedStoreId) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/operations${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(body.selectedStoreId ?? "");
    setOperation(body.operation ?? null);
  }

  useEffect(() => {
    void loadOperation("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function saveOperation(patch: Partial<StoreOperation>) {
    if (!operation) return;
    const next = { ...operation, ...patch };
    setOperation(next);
    setSaving(true);
    try {
      const response = await fetch("/api/store/operations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          reservationsEnabled: next.reservationsEnabled,
          statusNote: next.statusNote
        })
      });
      if (!response.ok) throw new Error("save failed");
      await loadOperation(selectedStoreId);
      setMessage("営業状態を更新しました。");
    } catch {
      setOperation(operation);
      setMessage("営業状態を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>店舗ワークベンチ</h1>
          </div>
        </a>
        <StoreNavTabs active="home" />
      </header>

      <section className="panel store-operation-panel">
        <div className="store-operation-heading">
          <div>
            <p className="eyebrow">Store Operation</p>
            <h2>営業・予約受付</h2>
            <p>
              {operation ? `基本営業時間: ${formatBusinessHoursSummary(operation.businessHours)}` : "営業状態を読み込み中です。"}
              {operation?.reservationNote ? ` / ${operation.reservationNote}` : ""}
            </p>
          </div>
          {stores.length > 1 ? (
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              void loadOperation(event.target.value);
            }}>
              {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
          ) : null}
        </div>
        {operation ? (
          <>
            {operation.receptionState ? (
              <div className={`store-reception-state is-${operation.receptionState.tone}`}>
                <span>
                  受付モード: {operation.receptionState.manualStatusLabel}
                  {operation.receptionState.isManuallyAccepting ? "（営業時間に従う）" : ""}
                </span>
                <strong>{operation.receptionState.statusLabel}</strong>
                <small>{operation.receptionState.detailLabel}</small>
              </div>
            ) : null}
            <div className="store-operation-actions">
              <button
                className={operation.reservationsEnabled ? "store-status-button is-on" : "store-status-button"}
                type="button"
                disabled={saving}
                onClick={() => void saveOperation({ reservationsEnabled: true, statusNote: "" })}
              >
                <CheckCircle2 size={17} />
                通常受付
              </button>
              <button
                className={!operation.reservationsEnabled && operation.statusNote !== "本日休業" ? "store-status-button is-off" : "store-status-button"}
                type="button"
                disabled={saving}
                onClick={() => void saveOperation({ reservationsEnabled: false, statusNote: "一時休止" })}
              >
                <PauseCircle size={17} />
                一時休止
              </button>
              <button
                className={!operation.reservationsEnabled && operation.statusNote === "本日休業" ? "store-status-button is-off" : "store-status-button"}
                type="button"
                disabled={saving}
                onClick={() => void saveOperation({ reservationsEnabled: false, statusNote: "本日休業" })}
              >
                <PauseCircle size={17} />
                本日休業
              </button>
              <input
                value={operation.statusNote}
                onChange={(event) => setOperation({ ...operation, statusNote: event.target.value })}
                placeholder="予約画面に出すメモ"
              />
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void saveOperation({})}>
                メモ保存
              </button>
            </div>
          </>
        ) : null}
        {message ? <div className="inline-alert">{message}</div> : null}
      </section>

      <section className="store-workbench-grid">
        {storeModules.map((module) => {
          const Icon = module.icon;
          const content = (
            <>
              <div className="os-module-icon">
                <Icon size={24} />
              </div>
              <div>
                <div className="os-module-heading">
                  <h2>{module.title}</h2>
                  <span className={module.status === "利用可能" ? "status-pill is-active" : "status-pill"}>{module.status}</span>
                </div>
                <p>{module.description}</p>
              </div>
            </>
          );

          return module.status === "利用可能" ? (
            <a className="os-module-card" href={module.href} key={module.href}>{content}</a>
          ) : (
            <div className="os-module-card is-disabled" aria-disabled="true" key={module.href}>{content}</div>
          );
        })}
      </section>
    </main>
  );
}
