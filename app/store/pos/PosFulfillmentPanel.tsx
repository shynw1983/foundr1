"use client";

import { BellRing, ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, RefreshCw, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PosOperatorProof } from "../../../lib/pos-operator-policy";
import { ModalHistoryScope } from "../../os/components/useModalHistory";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { useStoreDialog } from "../components/useStoreDialog";
import { usePosFulfillmentQueue, type PosFulfillmentTask } from "./usePosFulfillmentQueue";
import styles from "./PosFulfillmentPanel.module.css";

export type PosFulfillmentPanelProps = {
  storeId: string;
  enabled: boolean;
  disabled?: boolean;
  overdueMinutes?: number;
  checkoutRefreshKey?: string | number;
  prepareAction?: (payload: Record<string, unknown>) => Promise<PosOperatorProof | null | undefined>;
};

const preferenceKey = "foundr1-store:pos-fulfillment-side:v1:";

function parseTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PosFulfillmentPanel({ storeId, enabled, disabled = false, overdueMinutes = 15, checkoutRefreshKey, prepareAction }: PosFulfillmentPanelProps) {
  const { t } = useOsTranslation();
  const queue = usePosFulfillmentQueue({ storeId, enabled, disabled, refreshKey: checkoutRefreshKey, prepareAction });
  const [expanded, setExpanded] = useState(false);
  const [wide, setWide] = useState(false);
  const [preferredSide, setPreferredSide] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pinned = enabled && wide && preferredSide;
  const drawerOpen = enabled && expanded && !pinned;
  const dialogRef = useStoreDialog(drawerOpen, () => setExpanded(false));

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setExpanded(false);
    try { setPreferredSide(window.localStorage.getItem(`${preferenceKey}${storeId}`) === "true"); }
    catch { setPreferredSide(false); }
  }, [storeId]);

  useEffect(() => {
    if (!enabled) setExpanded(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const serverNow = now + queue.clockOffset;
  const waiting = useMemo(() => queue.tasks.filter(task => task.status === "waiting").sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt)), [queue.tasks]);
  const ready = useMemo(() => queue.tasks.filter(task => task.status === "ready").sort((a, b) => parseTime(a.readyAt || a.createdAt) - parseTime(b.readyAt || b.createdAt)), [queue.tasks]);
  const undoAvailable = queue.undo && parseTime(queue.undo.expiresAt) > serverNow;
  const notice = queue.serverDisabled ? "この店舗の提供管理は管理者が無効にしています。再開後に最新の状況を確認してください。"
    : queue.actionError || queue.readError || (!queue.online || disabled ? "オフラインです。接続後に提供状況を確認してください。" : "");
  const blocked = Boolean(queue.busyTaskId || queue.retryMutation || !queue.online || disabled || queue.serverDisabled);
  const threshold = Number.isFinite(overdueMinutes) ? Math.max(1, overdueMinutes) : 15;
  const countsKnown = Boolean(queue.lastSuccessAt);

  if (!enabled || !storeId) return null;

  function toggleSide() {
    const next = !preferredSide;
    setPreferredSide(next);
    setExpanded(!next);
    try { window.localStorage.setItem(`${preferenceKey}${storeId}`, String(next)); } catch {}
  }

  function taskCard(task: PosFulfillmentTask) {
    const waitingMinutes = Math.max(0, Math.floor((serverNow - parseTime(task.createdAt)) / 60000));
    const elapsed = parseTime(task.createdAt) ? waitingMinutes : 0;
    const overdue = task.status === "waiting" && elapsed >= threshold;
    const busy = queue.busyTaskId === task.id;
    return <li key={task.id} className={`${styles.ticket}${overdue ? ` ${styles.overdue}` : ""}`} data-fulfillment-task={task.id} data-fulfillment-status={task.status}>
      <div className={styles.ticketHead}>
        <strong className={styles.number} aria-label={t("受取番号 {code}", { code: task.pickupCode })}>{task.pickupCode || "—"}</strong>
        <div className={styles.ticketMeta}>
          {task.tableLabel ? <span>{task.tableLabel}</span> : null}
          <span>{t("{minutes}分経過", { minutes: elapsed })}</span>
          {overdue ? <span className={styles.overdueLabel}>{t("お待たせしています")}</span> : null}
        </div>
      </div>
      <p className={styles.summary}>{task.itemSummary}</p>
      {task.note ? <p className={styles.note}><span>{t("厨房メモ")}</span>{task.note}</p> : null}
      <div className={styles.ticketActions}>
        {task.status === "ready" ? <button className={`secondary-button ${styles.recall}`} type="button" disabled={blocked} onClick={() => void queue.act(task, "recall")} aria-label={t("{code}をもう一度呼ぶ", { code: task.pickupCode })}>
          <BellRing size={16} aria-hidden="true" />{t("もう一度呼ぶ")}
        </button> : null}
        <button className={`primary-button ${styles.mainAction}`} type="button" disabled={blocked} onClick={() => void queue.act(task, task.status === "waiting" ? "ready" : "handoff")} aria-label={t(task.status === "waiting" ? "{code}を呼び出す" : "{code}をお渡し済みにする", { code: task.pickupCode })}>
          {busy ? t("保存中…") : t(task.status === "waiting" ? "呼び出す" : "お渡し済み")}
        </button>
      </div>
    </li>;
  }

  const feedback = <>
    {notice ? <div className={`${styles.error}${queue.serverDisabled ? ` ${styles.warning}` : ""}`} role={queue.serverDisabled ? "status" : "alert"} data-fulfillment-error>
      <p>{t(notice)}</p>
      <div className={styles.noticeActions}>
        {queue.retryMutation ? <button className="secondary-button" type="button" onClick={() => void queue.retry()} disabled={Boolean(queue.busyTaskId) || !queue.online || disabled || queue.serverDisabled}>{t("同じ操作を再試行")}</button> : null}
        <button className="secondary-button" type="button" onClick={() => void queue.refresh()} disabled={queue.loading || Boolean(queue.busyTaskId) || !queue.online}>{t("最新の状況を確認")}</button>
      </div>
    </div> : null}
    {undoAvailable ? <div className={styles.undo} role="status" data-fulfillment-undo>
      <span>{t(queue.undo!.action === "ready" ? "{code}を呼び出しました。" : "{code}をお渡し済みにしました。", { code: queue.undo!.pickupCode })}</span>
      <button className="secondary-button" type="button" disabled={blocked} onClick={() => void queue.undoLast()}><Undo2 size={15} aria-hidden="true" />{t("元に戻す")}</button>
    </div> : null}
  </>;

  const board = <>
    <header className={styles.boardHeader}>
      <div><h3 id="store-pos-fulfillment-title">{t("提供状況")}</h3><p>{t("できあがったら呼び出し、実際にお渡ししたら完了にします。")}</p></div>
      <div className={styles.headerActions}>
        {wide ? <button className="secondary-button" type="button" onClick={toggleSide} title={t(pinned ? "常駐表示を解除" : "この端末で常駐表示")} aria-label={t(pinned ? "常駐表示を解除" : "この端末で常駐表示")}>
          {pinned ? <PanelRightClose size={19} aria-hidden="true" /> : <PanelRightOpen size={19} aria-hidden="true" />}
        </button> : null}
        {!pinned ? <button className="secondary-button" type="button" onClick={() => setExpanded(false)} aria-label={t("閉じる")}><X size={20} aria-hidden="true" /></button> : null}
      </div>
    </header>
    <div className={styles.boardBody}>
      {feedback}
      <div className={styles.columns}>
        <section className={styles.column} aria-label={t("提供待ち")}>
          <div className={styles.columnHead}><h4>{t("提供待ち")}</h4><span>{countsKnown ? waiting.length : "—"}</span></div>
          {waiting.length ? <ul className={styles.tickets}>{waiting.map(taskCard)}</ul> : queue.serverDisabled || queue.readError ? null : <p className={styles.empty}>{t(queue.loading && !queue.lastSuccessAt ? "読み込み中…" : "提供待ちはありません。")}</p>}
        </section>
        <section className={styles.column} aria-label={t("お渡し")}>
          <div className={styles.columnHead}><h4>{t("お渡し")}</h4><span>{countsKnown ? ready.length : "—"}</span></div>
          {ready.length ? <ul className={styles.tickets}>{ready.map(taskCard)}</ul> : queue.serverDisabled || queue.readError ? null : <p className={styles.empty}>{t(queue.loading && !queue.lastSuccessAt ? "読み込み中…" : "お渡し待ちはありません。")}</p>}
        </section>
      </div>
    </div>
  </>;

  return <section className={`${styles.root}${pinned ? ` ${styles.pinned}` : ""}`} data-pos-fulfillment-pinned={pinned ? "true" : "false"} aria-label={t("提供状況")}>
    <div className={styles.strip}>
      <button className={styles.expand} type="button" onClick={() => setExpanded(current => !current)} aria-expanded={drawerOpen || pinned} aria-controls="store-pos-fulfillment-board" disabled={pinned}>
        <span>{t("提供状況")}</span>
        <span className={styles.count}>{t("提供待ち")} <strong>{countsKnown ? waiting.length : "—"}</strong></span>
        <span className={styles.count}>{t("お渡し")} <strong>{countsKnown ? ready.length : "—"}</strong></span>
        {!pinned ? <span className={styles.expandLabel}>{t(drawerOpen ? "閉じる" : "開く")}{drawerOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span> : null}
      </button>
      <button className={`secondary-button ${styles.refresh}`} type="button" onClick={() => void queue.refresh()} disabled={queue.loading || Boolean(queue.busyTaskId) || !queue.online} title={t("提供状況を更新")} aria-label={t("提供状況を更新")}><RefreshCw size={16} aria-hidden="true" /></button>
      <span className={`${styles.connection}${queue.realtimeConnected && queue.online ? ` ${styles.connected}` : ""}`} title={t(queue.online ? "自動更新中" : "オフライン")} aria-label={t(queue.online ? "自動更新中" : "オフライン")} />
    </div>
    {!drawerOpen && !pinned ? feedback : null}
    {pinned ? <aside className={styles.sideBoard} id="store-pos-fulfillment-board">{board}</aside> : null}
    {drawerOpen ? <ModalHistoryScope historyKey="store-pos-fulfillment" onClose={() => setExpanded(false)}>
      <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
        <section ref={dialogRef} className={styles.drawer} id="store-pos-fulfillment-board" role="dialog" aria-modal="true" aria-labelledby="store-pos-fulfillment-title">{board}</section>
      </div>
    </ModalHistoryScope> : null}
  </section>;
}
