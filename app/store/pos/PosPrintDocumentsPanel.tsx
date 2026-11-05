"use client";

import { ChevronRight, Printer, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PosPrintDocument, PosPrintDocumentKind } from "../../../lib/pos-print-document-contract";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { ModalHistoryScope } from "../../os/components/useModalHistory";
import { useStoreDialog } from "../components/useStoreDialog";
import type { PosPrintDocumentsController } from "./usePosPrintDocuments";
import styles from "./PosPrintDocumentsPanel.module.css";

const emptyDocuments: PosPrintDocument[] = [];
const kinds: Record<PosPrintDocumentKind, string> = { kitchen: "厨房伝票", finishing: "出品伝票", pickup: "お客様番号札", receipt: "レシート・領収書" };
const states = { not_requested: "印刷しない", pending: "印刷待ち", sending: "送信中・結果確認", sent: "送信済み", uncertain: "現物確認が必要", cancelled: "印刷対象外" };
function timeLabel(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }

export function PosPrintDocumentsPanel({ storeId, controller, requestedOrder, canPrint, showSummary = true }: {
  storeId: string;
  controller: PosPrintDocumentsController;
  requestedOrder: { id: string; request: number } | null;
  canPrint: boolean;
  showSummary?: boolean;
}) {
  const { t } = useOsTranslation();
  const [expanded, setExpanded] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [kind, setKind] = useState<PosPrintDocumentKind | "">("");
  const [selected, setSelected] = useState<string[]>([]);
  const dialogRef = useStoreDialog(expanded, () => setExpanded(false));
  const queue = controller.queue?.selectedStoreId === storeId ? controller.queue : null;
  const documents = queue?.documents || emptyDocuments;
  const visible = useMemo(() => documents.filter(doc => !kind || doc.kind === kind), [documents, kind]);
  const printable = visible.filter(doc => doc.eligible && !controller.needsPhysicalReview(doc) && !(doc.transport === "relay" && doc.state === "pending") && (doc.state === "pending" || doc.state === "not_requested"));
  const groups = useMemo(() => Array.from(new Set(visible.map(doc => doc.orderId))).map(id => ({ id, documents: visible.filter(doc => doc.orderId === id) })), [visible]);
  const notice = controller.actionError || controller.readError || (!controller.online ? "オフラインです。接続後に印刷状況を確認してください。" : "");
  const blocked = controller.busy || !controller.online;
  useEffect(() => { setExpanded(false); setOrderId(""); setKind(""); setSelected([]); }, [storeId]);
  useEffect(() => {
    if (!requestedOrder) return;
    setOrderId(requestedOrder.id); setExpanded(true); setSelected([]);
    void controller.refresh(requestedOrder.id);
  }, [requestedOrder?.request, requestedOrder?.id]);
  useEffect(() => { setSelected(current => current.filter(id => documents.some(doc => doc.id === id && doc.eligible && (doc.state === "pending" || doc.state === "not_requested")))); }, [documents]);
  if (!storeId || (!showSummary && !expanded)) return null;

  function open() { setExpanded(true); setOrderId(""); setSelected([]); void controller.refresh(""); }
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  async function printSelected() {
    const chosen = printable.filter(doc => selected.includes(doc.id));
    const withUnrequested = chosen.some(doc => doc.state === "not_requested");
    if (withUnrequested && !window.confirm(t("印刷しないで保存した伝票を印刷しますか。"))) return;
    await controller.printDocuments(chosen, { physicalConfirmed: withUnrequested, reprint: withUnrequested });
    setSelected([]);
  }
  function confirmPhysical(document: PosPrintDocument) {
    if (window.confirm(t("伝票の現物を確認し、印刷済みとして記録しますか。"))) void controller.confirmPrinted(document);
  }
  function reprint(document: PosPrintDocument) {
    if (window.confirm(t("現物と送信状況を確認しましたか。同じ番号で再印刷します。二重発行に注意してください。"))) void controller.printDocuments([document], { reprint: true, physicalConfirmed: true });
  }
  function closeIneligible(document: PosPrintDocument) {
    if (window.confirm(t("現物を確認しましたか。印刷結果が不明な伝票を印刷対象外として終了します。出力済み・遅れて出る伝票は使用しないでください。"))) void controller.voidIneligible(document);
  }

  return <section className={`${styles.root}${showSummary ? "" : ` ${styles.dialogOnly}`}`} data-pos-print-documents>
    {showSummary ? <div className={styles.strip}>
      <button type="button" className={styles.open} data-print-queue-open onClick={open} aria-expanded={expanded}>
        <Printer size={16} aria-hidden="true" /><span>{t("印刷待ち")}</span><strong>{queue ? queue.summary.pendingDocuments : "—"}</strong>
        {queue?.summary.needsReview ? <span className={styles.review}>{t("要確認")} {queue.summary.needsReview}</span> : null}
        <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      <button type="button" className={`secondary-button ${styles.refresh}`} onClick={() => void controller.refresh(orderId)} disabled={controller.loading || controller.busy} aria-label={t("最新の状況を確認")}><RefreshCw size={15} /></button>
    </div> : null}
    {showSummary && notice ? <div className={styles.stripError} role="alert" data-print-error><span>{t(notice)}</span><button type="button" onClick={open}>{t("確認する")}</button></div> : null}
    {expanded ? <ModalHistoryScope historyKey="store-pos-print-documents" onClose={() => setExpanded(false)}>
      <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
        <aside className={styles.drawer} ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("伝票・印刷待ち")}>
          <header className={styles.header}><div><h3>{t("伝票・印刷待ち")}</h3><p>{t("会計済みの伝票を確認します。印刷しても会計は追加されません。")}</p></div><button type="button" className="secondary-button" aria-label={t("閉じる")} onClick={() => setExpanded(false)}><X size={18} /></button></header>
          <div className={styles.body}>
            {notice ? <div className={styles.error} role="alert" data-print-error><p>{t(notice)}</p><button className="secondary-button" type="button" onClick={() => void controller.refresh(orderId)} disabled={controller.loading || blocked}>{t("最新の状況を確認")}</button></div> : null}
            {!canPrint ? <p className={styles.help}>{t("プリンターを接続すると印刷できます。印刷待ちは保存されています。")}</p> : null}
            <div className={styles.filters}>
              <label><span>{t("伝票の種類")}</span><select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setSelected([]); }}><option value="">{t("すべて")}</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
              <button type="button" className="secondary-button" onClick={() => { setOrderId(""); setSelected([]); void controller.refresh(""); }} disabled={blocked}>{t(orderId ? "店舗の印刷待ちに戻る" : "最新の状況を確認")}</button>
            </div>
            <div className={styles.selection}><label><input type="checkbox" checked={printable.length > 0 && printable.every(doc => selected.includes(doc.id))} disabled={blocked || !printable.length} onChange={event => setSelected(event.target.checked ? printable.map(doc => doc.id) : [])} />{t("表示中の伝票を選択")}</label><button type="button" className="primary-button" data-print-submit disabled={blocked || !canPrint || !selected.length} onClick={() => void printSelected()}>{t(controller.busy ? "送信中…" : "選択した伝票を印刷")} {selected.length || ""}</button></div>
            {groups.map(group => <section className={styles.order} key={group.id} data-print-order={group.id}>
              <header><label><input type="checkbox" disabled={blocked || !group.documents.some(doc => printable.includes(doc))} checked={group.documents.some(doc => printable.includes(doc)) && group.documents.filter(doc => printable.includes(doc)).every(doc => selected.includes(doc.id))} onChange={event => {
                const ids = group.documents.filter(doc => printable.includes(doc)).map(doc => doc.id);
                setSelected(current => event.target.checked ? Array.from(new Set([...current, ...ids])) : current.filter(id => !ids.includes(id)));
              }} /><strong>{group.documents[0]?.pickupCode || "—"}</strong></label><time>{timeLabel(group.documents[0]?.orderCreatedAt || "")}</time></header>
              <ul>{group.documents.map(doc => <li key={doc.id} data-print-document={doc.id} data-print-state={doc.state}>
                <label className={styles.document}><input type="checkbox" checked={selected.includes(doc.id)} disabled={blocked || !printable.includes(doc)} onChange={() => toggle(doc.id)} /><span><strong>{t(doc.label || kinds[doc.kind])} <b>{doc.pickupCode}</b>{doc.copyNumber > 1 ? ` ×${doc.copyNumber}` : ""}</strong><small>{t(doc.transport === "relay" && doc.state === "pending" ? "中継端末で送信待ち" : states[doc.state])}</small></span></label>
                {doc.blockedReason || doc.error ? <p className={styles.documentError}>{t(doc.blockedReason || doc.error)}</p> : null}
                {doc.eligible && doc.state !== "sending" && (["uncertain", "sent"].includes(doc.state) || controller.needsPhysicalReview(doc)) ? <div className={styles.documentActions}>
                  {["sending", "uncertain"].includes(doc.state) ? <button type="button" className="secondary-button" disabled={blocked} onClick={() => confirmPhysical(doc)}>{t("現物を確認・印刷済みにする")}</button> : null}
                  <button type="button" className="secondary-button" disabled={blocked || !canPrint} onClick={() => reprint(doc)}>{t("現物を確認・再印刷")}</button>
                </div> : null}
                {!doc.eligible && doc.state === "uncertain" ? <>
                  <p className={styles.documentError}>{t("現在の注文状態では再印刷できません。現物を確認して、印刷結果が不明な伝票を終了してください。")}</p>
                  <div className={styles.documentActions}><button type="button" className="secondary-button" data-print-void-ineligible disabled={blocked} onClick={() => closeIneligible(doc)}>{t("現物を確認・伝票を終了")}</button></div>
                </> : null}
              </li>)}</ul>
            </section>)}
            {!groups.length && !notice ? <p className={styles.empty}>{t(controller.loading ? "読み込み中…" : "印刷待ちはありません。")}</p> : null}
            {queue?.hasMore ? <button type="button" className="secondary-button" disabled={blocked || controller.loading} onClick={() => void controller.refresh(orderId, true)}>{t("続きを表示")}</button> : null}
            <p className={styles.help}>{t("「あとで印刷」の伝票は自動印刷しません。中継端末で送信待ちの伝票は接続後に送信します。送信済みでも現物を確認してください。")}</p>
          </div>
        </aside>
      </div>
    </ModalHistoryScope> : null}
  </section>;
}
