"use client";
import { useEffect, useRef, useState } from 'react';
import { useOsTranslation } from '../../os/components/OsTranslationProvider';
import { invoiceRecipientLabel } from '../../../lib/pos-invoice';
import styles from './invoice-issuer.module.css';

type Status = { eligible: boolean; reason: string; issued: boolean; documentId?: string; receiptRecipientName: string; receiptPurposeText: string };
export default function PosInvoiceIssuer({ storeId, orderId, onIssued }: { storeId: string; orderId: string; onIssued: (result: { orderId: string; documentId: string; alreadyIssued: boolean }) => Promise<void> | void }) {
  const { t } = useOsTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState(''), [purpose, setPurpose] = useState('飲食代'), [error, setError] = useState('');
  const scope = useRef(''); scope.current = `${storeId}:${orderId}`;
  const operation = useRef('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { setOpen(false); setStatus(null); setError(''); operation.current = ''; }, [storeId, orderId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), captured = scope.current;
    const timeout = window.setTimeout(() => { controller.abort(); if (mounted.current && scope.current === captured) setError('接続を確認できません。発行状況を確認してから再操作してください。'); }, 15000);
    setStatus(null); setError(''); setName(''); setPurpose('飲食代'); operation.current = window.crypto.randomUUID();
    void fetch(`/api/store/pos/invoice?${new URLSearchParams({ storeId, orderId })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Status; })
      .then(body => { if (scope.current === captured) setStatus(body); })
      .catch(reason => { if (!controller.signal.aborted && scope.current === captured) setError(reason instanceof Error ? reason.message : '領収書を確認できませんでした。'); }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [open, storeId, orderId]);
  useEffect(() => {
    if (!open) return;
    const old = document.activeElement as HTMLElement | null; dialog.current?.focus();
    return () => old?.focus();
  }, [open]);
  async function issue() {
    if (busy || !status?.eligible || status.issued) return;
    const captured = scope.current;
    setBusy(true); setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/store/pos/invoice', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, orderId, operationId: operation.current, receiptRecipientName: name, receiptPurposeText: purpose }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '領収書を発行できませんでした。');
      if (!mounted.current || scope.current !== captured) return;
      setOpen(false); await onIssued(body);
    } catch (reason) { if (mounted.current && scope.current === captured) setError(controller.signal.aborted ? '接続を確認できません。発行状況を確認してから再操作してください。' : reason instanceof Error ? reason.message : '領収書を発行できませんでした。'); }
    finally { window.clearTimeout(timeout); if (mounted.current && scope.current === captured) setBusy(false); }
  }
  return <>
    <button type="button" className="secondary-button" data-pos-issue-invoice onClick={() => setOpen(true)}>{t('領収書を発行・確認')}</button>
    {open ? <div className={styles.overlay} onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('領収書を発行')} tabIndex={-1} ref={dialog} onKeyDown={event => {
        if (event.key === 'Escape' && !busy) setOpen(false);
        if (event.key === 'Tab') { const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]; const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
      }}>
        <header><h3>{t('領収書を発行')}</h3><button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>{t('閉じる')}</button></header>
        <p>{t('元のレシートを残して領収書を発行します。売上や会計は追加されません。')}</p>
        {error ? <p role="alert" className={styles.error}>{t(error)}</p> : null}
        {!status && !error ? <p role="status">{t('確認中…')}</p> : null}
        {status?.issued ? <><p>{t('この取引の領収書は発行済みです。再印刷は保存された領収書から行ってください。')}</p><p>{invoiceRecipientLabel(status.receiptRecipientName)} / {status.receiptPurposeText}</p><button type="button" className="primary-button" onClick={() => { setOpen(false); void onIssued({ orderId, documentId: status.documentId!, alreadyIssued: true }); }}>{t('領収書を確認・再印刷')}</button></> : status?.eligible ? <>
          <label>{t('宛名（敬称不要）')}<input data-invoice-recipient value={name} maxLength={120} placeholder={t('空欄の場合は上様')} onChange={event => setName(event.target.value)} disabled={busy} /></label>
          <label>{t('但し書き')}<input data-invoice-purpose value={purpose} maxLength={160} onChange={event => setPurpose(event.target.value)} disabled={busy} /></label>
          <p>{t('発行後の宛名は変更できません。内容を確認してください。')}</p>
          <button type="button" className="primary-button" data-invoice-submit disabled={busy} onClick={() => void issue()}>{t(busy ? '発行中…' : '領収書を発行')}</button>
        </> : status ? <p>{t(status.reason)}</p> : null}
      </section>
    </div> : null}
  </>;
}
