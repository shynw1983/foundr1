"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./scoped-settings.module.css";

type Closure = { id: string; startsAt: string; endsAt: string; reason: string; publicMessage: string };
type AffectedOrder = { id: string; pickupCode: string; pickupDate: string; pickupTime: string; customerName: string; customerPhone: string };

export function StoreTemporaryClosures({ storeId, canEdit, disabled, onBusyChange }: { storeId: string; canEdit: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const { t } = useOsTranslation();
  const [closures, setClosures] = useState<Closure[]>([]);
  const [orders, setOrders] = useState<AffectedOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("22:00");
  const [reason, setReason] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/os/store-temporary-closures?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "臨時休業を読み込めませんでした。");
    if (!signal?.aborted) { setClosures(body.temporaryClosures ?? []); setOrders(body.affectedOrders ?? []); }
  }, [storeId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  async function mutate(action: string, closureId?: string) {
    if (!canEdit || busy || disabled) return;
    setBusy(true); onBusyChange(true); setMessage("");
    try {
      const response = await fetch("/api/os/store-temporary-closures", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, storeId, closureId, closureDate: date, closureStartTime: start, closureEndTime: end, closureReason: reason, closurePublicMessage: publicMessage
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "臨時休業を保存できませんでした。");
      setDate("");
      setMessage("臨時休業を保存しました。受け付け済み予約がある場合は下の一覧で対応してください。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "臨時休業を保存できませんでした。"); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className={`panel ${styles.panel}`}>
    <h3>{t("臨時休業")}</h3>
    {message ? <p role="status">{t(message)}</p> : null}
    {loading ? <p>{t("読み込み中")}</p> : <>
      {closures.length ? <div className={styles.closures}>{closures.map(closure => <div key={closure.id}>
        <strong>{new Date(closure.startsAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} – {new Date(closure.endsAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</strong>
        <span>{closure.reason}</span><small>{closure.publicMessage}</small>
        {canEdit ? <button className="secondary-button" type="button" disabled={busy || disabled} onClick={() => { if (window.confirm(t("臨時休業を解除しますか？"))) void mutate("cancel_temporary_closure", closure.id); }}>{t("解除")}</button> : null}
      </div>)}</div> : <p>{t("予定されている臨時休業はありません。")}</p>}
      {orders.length ? <div className={styles.closures}><h4>{t("対応が必要な予約")}</h4>{orders.map(order => <div key={order.id}><strong>{order.pickupCode} / {order.pickupDate} {order.pickupTime}</strong><span>{order.customerName} / {order.customerPhone}</span></div>)}</div> : null}
      {canEdit ? <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void mutate("create_temporary_closure"); }}>
        <fieldset className={styles.fields} disabled={busy || disabled}>
          <div className={styles.coordinates}>
            <label><span>{t("日付")}</span><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
            <label><span>{t("開始時刻")}</span><input type="time" required value={start} onChange={event => setStart(event.target.value)} /></label>
            <label><span>{t("終了時刻")}</span><input type="time" required value={end} onChange={event => setEnd(event.target.value)} /></label>
          </div>
          <label><span>{t("理由")}</span><input maxLength={300} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label><span>{t("お客様への案内")}</span><input maxLength={1000} value={publicMessage} onChange={event => setPublicMessage(event.target.value)} /></label>
          <div><button type="submit" className="secondary-button" disabled={loading || !date}>{t("臨時休業を追加")}</button></div>
        </fieldset>
      </form> : null}
    </>}
  </section>;
}
