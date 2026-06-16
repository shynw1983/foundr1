"use client";

import { PackageCheck, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";

type ReceivingItem = {
  id: string;
  name: string;
  requestedQuantity?: string | number | null;
  actualQuantity?: string | number | null;
  unit?: string | null;
  note?: string | null;
};

type ReceivingConfirmation = {
  id: string;
  type: "batch" | "items";
  batchId?: string | null;
  orderId: string;
  storeName: string;
  label: string;
  status: "delivered" | "received";
  deliveredLabel?: string | null;
  confirmedLabel?: string | null;
  items: ReceivingItem[];
};

function formatQuantity(value: string | number | null | undefined, unit: string | null | undefined) {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue) || numberValue === 0) return "";
  return `${numberValue}${unit ?? ""}`;
}

export default function StoreReceivingPage() {
  const [confirmations, setConfirmations] = useState<ReceivingConfirmation[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const pendingConfirmations = useMemo(() => confirmations.filter((item) => item.status === "delivered"), [confirmations]);
  const completedConfirmations = useMemo(() => confirmations.filter((item) => item.status === "received").slice(0, 10), [confirmations]);

  async function loadReceiving() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/store/procurement-receiving", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { confirmations?: ReceivingConfirmation[]; error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "納品確認を読み込めませんでした。");
      setLoading(false);
      return;
    }
    setConfirmations(body.confirmations ?? []);
    setLoading(false);
  }

  async function confirmReceiving(target: ReceivingConfirmation) {
    setSavingId(target.id);
    setMessage("");
    const response = await fetch("/api/store/procurement-receiving", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: target.type,
        batchId: target.batchId,
        itemIds: target.items.map((item) => item.id)
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "店舗確認を保存できませんでした。");
      setSavingId("");
      return;
    }
    setConfirmations((current) => current.map((item) => (
      item.id === target.id
        ? { ...item, status: "received", confirmedLabel: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()) }
        : item
    )));
    setMessage("店舗確認済みにしました。");
    setSavingId("");
  }

  useEffect(() => {
    void loadReceiving();
  }, []);

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>納品確認</h1>
          </div>
        </a>
        <StoreNavTabs active="receiving" />
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Receiving</p>
            <h2>到着した商品</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => void loadReceiving()} disabled={loading}>
            <RefreshCw size={16} />
            更新
          </button>
        </div>
        {message ? <div className="inline-alert">{message}</div> : null}
        {loading ? <p className="empty-state-text">読み込み中...</p> : null}
        {!loading && pendingConfirmations.length === 0 ? <p className="empty-state-text">店舗確認待ちの納品はありません。</p> : null}
        <div className="order-list">
          {pendingConfirmations.map((confirmation) => (
            <article className="order-row" key={confirmation.id}>
              <div>
                <div className="row-heading">
                  <strong>{confirmation.label}</strong>
                  <span className="status-pill is-warning">納品済み</span>
                </div>
                <p>{confirmation.storeName} / {confirmation.orderId}</p>
                {confirmation.deliveredLabel ? <small>納品記録: {confirmation.deliveredLabel}</small> : null}
              </div>
              <div className="store-confirmation-panel">
                <div className="store-confirmation-heading">
                  <strong>確認する商品</strong>
                  <span>{confirmation.items.length} 件</span>
                </div>
                <div className="staff-mini-list">
                  {confirmation.items.map((item) => {
                    const requested = formatQuantity(item.requestedQuantity, item.unit);
                    const actual = formatQuantity(item.actualQuantity, item.unit);
                    return (
                      <div className="staff-mini-row" key={item.id}>
                        <span>{item.name}</span>
                        <strong>{actual || requested || "-"}</strong>
                        {item.note ? <small>{item.note}</small> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={savingId === confirmation.id}
                  onClick={() => void confirmReceiving(confirmation)}
                >
                  <PackageCheck size={16} />
                  店舗確認済みにする
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {completedConfirmations.length ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent</p>
              <h2>確認済み</h2>
            </div>
          </div>
          <div className="delivery-batch-list">
            {completedConfirmations.map((confirmation) => (
              <div className="delivery-batch-row" key={confirmation.id}>
                <div className="delivery-batch-info">
                  <strong>{confirmation.label}</strong>
                  <span>{confirmation.storeName} · {confirmation.items.length} 件 · 店舗確認済み{confirmation.confirmedLabel ? ` ${confirmation.confirmedLabel}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
