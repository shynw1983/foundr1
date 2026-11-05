'use client';
import Link from 'next/link';
import { createReadError } from '../../../../components/useReadRequest';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, Send } from 'lucide-react';
import { useOsTranslation } from '../../components/OsTranslationProvider';
import { useHqAlertRealtime, type HqAlertRealtime } from '../../../store/components/useHqAlertRealtime';
import { hqAlertMessageLimit, type HqAlert } from '../../../../lib/store-hq-alert-policy';
import { createStoreRefreshCoordinator } from '../../../../lib/store-polling-client';
import styles from './HqAlertConsole.module.css';
type Store = { id: string; name: string };
export function HqAlertConsole({ employeeId }: { employeeId: string }) {
  const { t } = useOsTranslation();
  const [stores, setStores] = useState<Store[]>([]), [storeId, setStoreId] = useState(''), [alerts, setAlerts] = useState<HqAlert[]>([]);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false), [loadingMore, setLoadingMore] = useState(false), [realtime, setRealtime] = useState<HqAlertRealtime>();
  const requestId = useRef(''), generation = useRef(0), mounted = useRef(true), selected = useRef(''), pending = useRef(false);
  const coordinator = useRef<ReturnType<typeof createStoreRefreshCoordinator> | null>(null);
  const draftKey = `foundr1:hq-alert-draft:${employeeId}`;
  const load = useCallback(async (id: string, older?: string, signal?: AbortSignal, propagate = false) => {
    const seq = generation.current;
    try {
      const r = await fetch(`/api/os/stores/alerts?${new URLSearchParams({ ...(id ? { storeId: id } : {}), ...(older ? { before: older } : {}) })}`, { cache: 'no-store', signal: signal ?? AbortSignal.timeout(12000) });
      const data = await r.json().catch(() => null); if (!r.ok) throw Object.assign(createReadError(r), { message: data?.error || '連絡履歴を読み込めませんでした。' });
      if (!mounted.current || seq !== generation.current || signal?.aborted) return;
      if (!data || (id && data.storeId !== id) || !Array.isArray(data.alerts)) throw Error('連絡履歴を読み込めませんでした。');
      setStores(data.stores); setRealtime(data.realtime);
      if (!id) { selected.current = data.storeId; setStoreId(data.storeId); }
      setAlerts(prev => older ? [...prev, ...data.alerts.filter((a: HqAlert) => !prev.some(p => p.id === a.id))] : [...data.alerts, ...prev.filter(p => !data.alerts.some((a: HqAlert) => a.id === p.id) && data.alerts.length && p.createdAt < data.alerts.at(-1).createdAt)]);
      setHasMore(data.hasMore); setError('');
    } catch (e) {
      if (mounted.current && seq === generation.current && !signal?.aborted) {
        setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : '連絡履歴を読み込めませんでした。');
        if ([401, 403].includes(Number((e as { status?: number })?.status))) {
          setAlerts([]); setStores([]); setRealtime(undefined); setHasMore(false);
          // Older-page requests share the same authority even though they have a separate cursor.
          if (!propagate) coordinator.current?.stop();
        }
      }
      if (propagate) throw e;
    }
    finally { if (mounted.current && seq === generation.current) { setLoading(false); setLoadingMore(false); } }
  }, []);
  const refresh = useCallback(() => { void coordinator.current?.refresh({ force: true }); }, []);
  useHqAlertRealtime(realtime, () => { void coordinator.current?.refresh(); }, healthy => { coordinator.current?.setRealtimeHealthy(healthy); if (healthy) void coordinator.current?.refresh({ force: true }); }, () => {
    coordinator.current?.stop(); setAlerts([]); setStores([]); setRealtime(undefined); setHasMore(false);
  });
  useEffect(() => {
    if (!storeId) return;
    const seq = generation.current;
    const reader = createStoreRefreshCoordinator(async signal => {
      if (!pending.current) await load(storeId, undefined, signal, true);
    }, {
      healthyIntervalMs: 60_000, fallbackIntervalMs: 30_000,
      onError: () => { if (mounted.current && generation.current === seq) setError('連絡履歴を読み込めませんでした。'); },
      onUnauthorized: () => { if (mounted.current && generation.current === seq) { setAlerts([]); setStores([]); setRealtime(undefined); setHasMore(false); } }
    });
    coordinator.current = reader; reader.start({ immediate: true });
    return () => { reader.stop(); if (coordinator.current === reader) coordinator.current = null; };
  }, [storeId, employeeId, load]);
  useEffect(() => {
    mounted.current = true;
    let restored = '';
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
      if (draft?.storeId && draft?.requestId && typeof draft.message === 'string') {
        restored = draft.storeId; selected.current = restored; requestId.current = draft.requestId;
        setStoreId(restored); setMessage(draft.message); setUncertain(true);
      }
    } catch { /* Storage is optional; server idempotency still protects retries. */ }
    if (!restored) void load('');
    return () => { mounted.current = false; generation.current++; };
  }, [draftKey, load]);
  function changeStore(id: string) {
    generation.current++; selected.current = id; setStoreId(id); setAlerts([]); setRealtime(undefined); setLoading(true); setNotice(''); setError('');
  }
  async function send() {
    if (busy || !storeId || !message.trim()) return;
    setBusy(true); pending.current = true; setError(''); setNotice('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const body = { storeId, requestId: requestId.current, message: message.trim() };
    try { sessionStorage.setItem(draftKey, JSON.stringify(body)); } catch { /* Nonpersistent browsers retain the in-memory retry identity. */ }
    try {
      const r = await fetch('/api/os/stores/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000), body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw Error(data.error || '送信できませんでした。');
      if (!mounted.current) return;
      setMessage(''); requestId.current = ''; setUncertain(false); setNotice('店舗へ送信しました。確認状況は自動で更新されます。');
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional storage. */ }
      pending.current = false; await coordinator.current?.refresh();
    } catch { if (mounted.current) { setUncertain(true); setError('送信結果を確認できません。内容を変えずに再試行すると、重複せずに確認できます。'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return <div data-i18n-ignore className={`os-interface ${styles.page}`}>
    <Link href="/os/stores" className={styles.back}><ArrowLeft size={16} />{t('店舗・ブランド')}</Link>
    <header><p className="eyebrow">STORE COMMUNICATION</p><h2>{t('本部からの即時連絡')}</h2><p>{t('店舗の作業画面に連絡を表示し、到達・確認状況を共有します。ベル通知とは別の連絡です。')}</p></header>
    <section className={styles.compose} aria-label={t('店舗へ連絡')}>
      <label className={styles.field}><span>{t('送信先店舗')}</span><select value={storeId} onChange={e => changeStore(e.target.value)} disabled={busy || uncertain || loading}>{!stores.length ? <option value="">{t(loading ? '読み込み中...' : '店舗がありません。')}</option> : stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className={styles.field}><span>{t('連絡内容')}</span><textarea value={message} onChange={e => { setMessage(e.target.value); requestId.current = ''; }} rows={3} maxLength={hqAlertMessageLimit} disabled={busy || uncertain} placeholder={t('気づいた点や、お願いしたいことを入力してください。')} /></label>
      <div className={styles.sendRow}><small>{message.length} / {hqAlertMessageLimit}</small><button type="button" className="primary-button" onClick={() => void send()} disabled={busy || loading || !storeId || !message.trim()}><Send size={16} />{t(busy ? '送信中...' : uncertain ? '同じ連絡を再試行' : '店舗へ送信')}</button></div>
      <p className={styles.help}>{t('客席の表示・呼出画面・中継専用画面には表示しません。店舗が未接続の場合は、作業画面を開くまで未到達のまま残ります。')}</p>
      {error ? <p role="alert" className={styles.error}>{t(error)}</p> : null}{notice ? <p role="status">{t(notice)}</p> : null}
    </section>
    <section aria-label={t('連絡履歴')}>
      <div className={styles.historyHeading}><h3>{t('連絡履歴')}</h3><button type="button" className="secondary-button" onClick={refresh} disabled={loading || busy}>{t('更新')}</button></div>
      <p className={styles.help}>{t('「到達」は作業画面への表示、「確認済み」はスタッフが「確認しました」を押した状態です。問題の解決を意味しません。')}</p>
      {!alerts.length ? <p className="empty-state">{t(loading ? '読み込み中...' : 'この店舗への連絡はまだありません。')}</p> : <div className={styles.history}>{alerts.map(a => <article key={a.id} className={styles.item}>
        <div className={styles.itemHeading}><span className={`${styles.status} ${a.readAt ? styles.read : ''}`}>{a.readAt ? <CheckCheck size={15} /> : null}{t(a.readAt ? '既読（スタッフ確認）' : a.deliveredAt ? '到達・未確認' : '未到達')}</span><time dateTime={a.createdAt}>{date(a.createdAt)}</time></div>
        <p className={styles.body} data-i18n-ignore>{a.message}</p><small>{t('送信者')} {a.senderName}</small>
        {a.deliveredAt ? <small>{t('到達')} {date(a.deliveredAt)}</small> : null}
        {a.readAt ? <small>{t('確認')} {a.readerName} · {a.readerDevice} · {date(a.readAt)}</small> : null}
      </article>)}</div>}
      {hasMore ? <button type="button" className="secondary-button" disabled={loadingMore || loading} onClick={() => { setLoadingMore(true); void load(storeId, alerts.at(-1)?.id); }}>{t(loadingMore ? '読み込み中...' : '以前の連絡を表示')}</button> : null}
    </section>
  </div>;
}
