"use client";

import { ArrowLeft, Check, Clock3, RotateCcw, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SeatStatus = "available" | "selecting" | "cooking" | "dining" | "cleaning";

type Seat = {
  id: string;
  kind: "table-a" | "table-b" | "counter";
  x: number;
  y: number;
  status: SeatStatus;
  partySize?: number;
  startedAt?: string;
};

type Selection =
  | { type: "seat"; id: string }
  | { type: "table"; id: "A" | "B" | "A+B" };

type SeatBoardTarget = {
  label: string;
  status: SeatStatus;
  partySize: number;
  startedAt: string;
};

type SeatBoardResponse = {
  store?: { id: string; name: string };
  targets?: SeatBoardTarget[];
  error?: string;
};

// This demo mirrors the current drawing. In production this array will come from
// the store layout settings, so seat count, type and placement are not fixed.
const initialSeats: Seat[] = [
  { id: "A1", kind: "table-a", x: 513, y: 289, status: "available" },
  { id: "A2", kind: "table-a", x: 512, y: 486, status: "available" },
  { id: "B1", kind: "table-b", x: 619, y: 289, status: "available" },
  { id: "B2", kind: "table-b", x: 619, y: 486, status: "available" },
  { id: "C8", kind: "counter", x: 235, y: 288, status: "available" },
  { id: "C7", kind: "counter", x: 235, y: 386, status: "available" },
  { id: "C6", kind: "counter", x: 235, y: 484, status: "available" },
  { id: "C5", kind: "counter", x: 235, y: 582, status: "available" },
  { id: "C4", kind: "counter", x: 235, y: 680, status: "available" },
  { id: "C3", kind: "counter", x: 235, y: 778, status: "available" },
  { id: "C2", kind: "counter", x: 235, y: 876, status: "available" },
  { id: "C1", kind: "counter", x: 235, y: 974, status: "available" }
];

const statusMeta: Record<SeatStatus, { label: string; action?: string; source: "staff" | "system" }> = {
  available: { label: "空席", action: "この席へ案内", source: "staff" },
  selecting: { label: "食材選択中", source: "system" },
  cooking: { label: "調理・提供待ち", source: "system" },
  dining: { label: "食事中", action: "退席・清掃待ち", source: "staff" },
  cleaning: { label: "清掃待ち", action: "清掃完了・空席へ", source: "staff" }
};

export default function StoreSeatsPage() {
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("桜並木店");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function applyBoard(data: SeatBoardResponse) {
    if (data.store) {
      setStoreId(data.store.id);
      setStoreName(data.store.name);
    }
    if (!data.targets) return;
    const targets = new Map(data.targets.map((target) => [target.label, target]));
    setSeats(initialSeats.map((seat) => {
      const target = targets.get(seat.kind === "counter" ? seat.id : seat.kind === "table-a" ? "A" : "B");
      return target ? { ...seat, status: target.status, partySize: target.partySize || undefined, startedAt: target.startedAt || undefined } : seat;
    }));
  }

  useEffect(() => {
    let active = true;
    async function load(showLoading = false) {
      if (showLoading) setLoading(true);
      try {
        const response = await fetch("/api/store/seats", { cache: "no-store" });
        const data = await response.json() as SeatBoardResponse;
        if (!response.ok) throw new Error(data.error || "座席情報を取得できませんでした。");
        if (active) {
          applyBoard(data);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "通信できません。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load(true);
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const counts = useMemo(() => ({
    available: seats.filter((seat) => seat.status === "available").length,
    selecting: seats.filter((seat) => seat.status === "selecting").length,
    cooking: seats.filter((seat) => seat.status === "cooking").length,
    dining: seats.filter((seat) => seat.status === "dining").length,
    cleaning: seats.filter((seat) => seat.status === "cleaning").length
  }), [seats]);
  const selectedSeats = selection?.type === "seat"
    ? seats.filter((seat) => seat.id === selection.id)
    : selection?.id === "A+B"
      ? seats.filter((seat) => seat.kind === "table-a" || seat.kind === "table-b")
      : selection?.type === "table"
        ? seats.filter((seat) => seat.kind === `table-${selection.id.toLowerCase()}`)
        : [];
  const selectedSeat = selectedSeats[0] ?? null;
  const selectedStatus = selectedSeat && selectedSeats.every((seat) => seat.status === selectedSeat.status)
    ? selectedSeat.status
    : null;

  async function runStaffAction() {
    if (!selection || !selectedStatus || !storeId || saving) return;
    const target = selection.type === "table" ? selection.id : selection.id;
    const isAssign = selectedStatus === "available";
    const action = selectedStatus === "dining" ? "vacate" : selectedStatus === "cleaning" ? "clean" : "";
    if (!isAssign && !action) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/store/seats", {
        method: isAssign ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, target, action })
      });
      const data = await response.json() as SeatBoardResponse;
      if (!response.ok) throw new Error(data.error || "座席を更新できませんでした。");
      applyBoard(data);
      setSelection(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "通信できません。");
    } finally {
      setSaving(false);
    }
  }

  async function refreshBoard() {
    setLoading(true);
    try {
      const response = await fetch("/api/store/seats", { cache: "no-store" });
      const data = await response.json() as SeatBoardResponse;
      if (!response.ok) throw new Error(data.error || "座席情報を取得できませんでした。");
      applyBoard(data);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "通信できません。");
    } finally {
      setLoading(false);
    }
  }

  function renderSeat(seat: Seat) {
    return (
      <button
        className={`seat-plan-seat is-${seat.status}`}
        type="button"
        key={seat.id}
        style={{ left: `${(seat.x / 800) * 100}%`, top: `${(seat.y / 1200) * 100}%` }}
        onClick={() => seat.kind === "counter" && setSelection({ type: "seat", id: seat.id })}
        tabIndex={seat.kind === "counter" ? 0 : -1}
        aria-disabled={seat.kind !== "counter"}
        aria-label={`${seat.id}席 ${statusMeta[seat.status].label}`}
      >
        <strong>{seat.id}</strong>
        <span>{statusMeta[seat.status].label}</span>
        {seat.startedAt ? <small>{seat.startedAt}-</small> : null}
      </button>
    );
  }

  function tableStatus(table: "A" | "B" | "A+B") {
    const tableSeats = table === "A+B"
      ? seats.filter((seat) => seat.kind !== "counter")
      : seats.filter((seat) => seat.kind === `table-${table.toLowerCase()}`);
    return tableSeats.every((seat) => seat.status === tableSeats[0]?.status) ? tableSeats[0]?.status : "mixed";
  }

  return (
    <main className="seat-management-page">
      <header className="seat-management-header">
        <a className="seat-management-back" href="/store" aria-label="店舗ホームへ戻る"><ArrowLeft size={20} /></a>
        <div>
          <p>まぁ麻 {storeName}</p>
          <h1>客席管理</h1>
        </div>
        <button type="button" className="seat-management-reset" onClick={() => void refreshBoard()} aria-label="座席情報を更新" disabled={loading}>
          <RotateCcw size={18} />
        </button>
      </header>

      {error ? <div className="seat-management-error" role="alert">{error}</div> : null}

      <section className="seat-management-summary" aria-label="客席状況">
        <div className="is-available"><strong>{counts.available}</strong><span>空席</span></div>
        <div className="is-selecting"><strong>{counts.selecting}</strong><span>食材選択</span></div>
        <div className="is-cooking"><strong>{counts.cooking}</strong><span>調理待ち</span></div>
        <div className="is-dining"><strong>{counts.dining}</strong><span>食事中</span></div>
        <div className="is-cleaning"><strong>{counts.cleaning}</strong><span>清掃待ち</span></div>
      </section>

      <section className="seat-floor-card">
        <div className="seat-floor-heading">
          <div>
            <span className="seat-live-dot" /> 店内リアルタイム
          </div>
          <small>{seats.length}席 / 座席をタップして更新</small>
        </div>

        <div className="seat-floor-plan">
          <img className="seat-floor-background" src="/store/maamaa-floor-background.svg" alt="" aria-hidden="true" />
          <div className="seat-plan-seat-layer">{seats.map(renderSeat)}</div>
          <div className="seat-plan-table-layer">
            {(["A", "B"] as const).map((table) => (
              <button
                className={`seat-plan-table is-${tableStatus(table)}`}
                type="button"
                key={table}
                style={{ left: `${((table === "A" ? 513 : 619) / 800) * 100}%` }}
                onClick={() => setSelection({ type: "table", id: table })}
                aria-label={`${table}テーブルを選択`}
              >{table}</button>
            ))}
            <button
              className={`seat-plan-table-combine is-${tableStatus("A+B")}`}
              type="button"
              onClick={() => setSelection({ type: "table", id: "A+B" })}
              aria-label="AとBテーブルを連結して選択"
            >A+B</button>
          </div>
        </div>
      </section>

      <section className="seat-management-legend" aria-label="座席状態の凡例">
        {(["available", "selecting", "cooking", "dining", "cleaning"] as SeatStatus[]).map((status) => (
          <span key={status}><i className={`is-${status}`} />{statusMeta[status].label}</span>
        ))}
      </section>

      {selectedSeat && selection ? (
        <div className="seat-action-backdrop" role="presentation" onClick={() => setSelection(null)}>
          <section className="seat-action-sheet" role="dialog" aria-modal="true" aria-labelledby="seat-action-title" onClick={(event) => event.stopPropagation()}>
            <div className="seat-action-handle" />
            <div className="seat-action-title-row">
              <div className={`seat-action-number is-${selectedStatus ?? "mixed"}`}>{selection.type === "table" ? selection.id : selectedSeat.id}</div>
              <div>
                <p>{selection.type === "table" ? `${selectedSeats.length}名テーブル` : "カウンター席"}</p>
                <h2 id="seat-action-title">{selectedStatus ? statusMeta[selectedStatus].label : "一部使用中"}</h2>
              </div>
            </div>
            {selectedStatus === "available" ? (
              <div className="seat-action-note"><Users size={18} /><span>{selection.type === "table" ? `${selection.id}テーブル` : "1名でこの席"}を確保します</span></div>
            ) : selectedStatus === "cleaning" ? (
              <div className="seat-action-note"><Sparkles size={18} /><span>清掃後に空席として開放します</span></div>
            ) : selectedStatus === "selecting" ? (
              <div className="seat-action-note is-system"><Sparkles size={18} /><span>会計すると自動で「調理・提供待ち」へ進みます</span></div>
            ) : selectedStatus === "cooking" ? (
              <div className="seat-action-note is-system"><Sparkles size={18} /><span>提供完了すると自動で「食事中」へ進みます</span></div>
            ) : selectedStatus === "dining" ? (
              <div className="seat-action-note"><Clock3 size={18} /><span>{selectedSeat.startedAt} から利用</span></div>
            ) : (
              <div className="seat-action-note"><Users size={18} /><span>各テーブルの状態が異なるため、AまたはBを個別に選択してください</span></div>
            )}
            {selectedStatus && statusMeta[selectedStatus].source === "staff" ? (
              <button className="seat-action-primary" type="button" onClick={() => void runStaffAction()} disabled={saving}>
                <Check size={20} /> {saving ? "更新中…" : statusMeta[selectedStatus].action}
              </button>
            ) : selectedStatus ? (
              <div className="seat-action-sync-status"><span className="seat-live-dot" /> システム連動中・操作不要</div>
            ) : null}
            <button className="seat-action-cancel" type="button" onClick={() => setSelection(null)}>閉じる</button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
