'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createReadError } from '../../../components/useReadRequest';
import { Check, ChevronDown, ChevronUp, MessageSquareWarning } from 'lucide-react';
import { useOsTranslation } from '../../os/components/OsTranslationProvider';
import { hqAlertUuid, type HqAlert } from '../../../lib/store-hq-alert-policy';
import { useStoreTheme } from './StoreThemeProvider';
import { useHqAlertRealtime, type HqAlertRealtime } from './useHqAlertRealtime';
import { createStoreRefreshCoordinator } from '../../../lib/store-polling-client';
import styles from './StoreHqAlert.module.css';

function deviceId() {
  try {
    const key = 'foundr1:store:hq-alert-device'; const saved = localStorage.getItem(key);
    if (saved && hqAlertUuid.test(saved)) return saved;
    const value = crypto.randomUUID(); localStorage.setItem(key, value); return value;
  } catch { return crypto.randomUUID(); }
}
export function StoreHqAlert() {
  const { context, employeeId, loading } = useStoreTheme();
  // Theme context is reset on store/principal changes; a keyed mount drops all stale UI.
  const storeId = !loading && context?.storeId;
  return storeId && employeeId ? <StoreHqAlertInbox key={`${employeeId}:${storeId}`} storeId={storeId} /> : null;
}
export function StoreHqAlertInbox({ storeId }: { storeId: string }) {
  const { t } = useOsTranslation();
  const [alerts, setAlerts] = useState<HqAlert[]>([]), [realtime, setRealtime] = useState<HqAlertRealtime>();
  const [collapsed, setCollapsed] = useState(false), [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const identity = useRef(''), delivered = useRef(new Set<string>());
  const coordinator = useRef<ReturnType<typeof createStoreRefreshCoordinator> | null>(null);
  const panel = useRef<HTMLDivElement>(null), active = useRef(true);
  const readIds = useRef(new Set<string>());
  const alert = alerts[0];
  const refresh = useCallback(() => coordinator.current?.refresh() ?? Promise.resolve(), []);
  useHqAlertRealtime(realtime, () => { void refresh(); }, healthy => { coordinator.current?.setRealtimeHealthy(healthy); if (healthy) void coordinator.current?.refresh({ force: true }); }, () => {
    coordinator.current?.stop(); setAlerts([]); setRealtime(undefined); setOffline(true);
  });
  useEffect(() => {
    active.current = true; identity.current = deviceId();
    const reader = createStoreRefreshCoordinator(async signal => {
      const r = await fetch(`/api/store/hq-alerts?storeId=${encodeURIComponent(storeId)}`, { cache: 'no-store', signal });
      if (!r.ok) {
        if (r.status === 404 && active.current && !signal.aborted) { setAlerts([]); setRealtime(undefined); }
        throw createReadError(r);
      }
      const data = await r.json();
      if (!active.current || signal.aborted) return;
      if (data.storeId !== storeId || !Array.isArray(data.alerts)) throw Error('hq alert scope mismatch');
      setAlerts(data.alerts.filter((a: HqAlert) => !readIds.current.has(a.id))); setRealtime(data.realtime); setOffline(false);
    }, {
      healthyIntervalMs: 60_000, fallbackIntervalMs: 30_000,
      onError: () => { if (active.current) setOffline(true); },
      onUnauthorized: () => { if (active.current) { setAlerts([]); setRealtime(undefined); setOffline(true); } }
    });
    coordinator.current = reader; reader.start({ immediate: true });
    return () => { active.current = false; reader.stop(); if (coordinator.current === reader) coordinator.current = null; };
  }, [storeId]);
  useEffect(() => { setCollapsed(false); setExpanded(false); setError(''); }, [alert?.id]);
  // A receipt means a visible, focused work page actually rendered this card.
  useEffect(() => {
    if (!alert || collapsed || delivered.current.has(alert.id)) return;
    let cancelled = false, sending = false;
    const check = async () => {
      const bounds = panel.current?.getBoundingClientRect();
      if (cancelled || sending || delivered.current.has(alert.id) || document.visibilityState !== 'visible' || !document.hasFocus() || !bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      const hit = document.elementFromPoint(Math.max(0, bounds.left + 24), Math.max(0, bounds.top + 20));
      if (!hit || !panel.current?.contains(hit)) return;
      sending = true;
      try {
        const r = await fetch('/api/store/hq-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ storeId, alertId: alert.id, deviceId: identity.current, action: 'delivered' }) });
        if (r.ok && !cancelled) delivered.current.add(alert.id);
      } catch { /* Retry without turning delivery into a read receipt. */ }
      finally { sending = false; }
    };
    const observer = new IntersectionObserver(() => { void check(); }); if (panel.current) observer.observe(panel.current);
    const timer = setInterval(() => { void check(); }, 8000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check); void check();
    return () => { cancelled = true; observer.disconnect(); clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [alert?.id, collapsed, storeId]);
  async function acknowledge() {
    if (!alert || saving) return;
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/store/hq-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000), body: JSON.stringify({ storeId, alertId: alert.id, deviceId: identity.current, action: 'read' }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error || '確認を保存できませんでした。もう一度お試しください。');
      readIds.current.add(alert.id);
      if (active.current) { setAlerts(list => list.filter(a => a.id !== alert.id)); void refresh(); }
    } catch (e) { if (active.current) setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : '確認を保存できませんでした。もう一度お試しください。'); }
    finally { if (active.current) setSaving(false); }
  }
  if (!alert) return null;
  return <aside data-i18n-ignore className={styles.rail} aria-label={t('本部からの連絡')}>
    <div className={styles.card} ref={panel} data-collapsed={collapsed}>
      <div className={styles.heading}>
        <span className={styles.icon}><MessageSquareWarning size={18} aria-hidden="true" /></span>
        <strong>{t('本部からの連絡')}</strong><span className={styles.count}>{alerts.length}{alerts.length === 50 ? '+' : ''}{t('件未確認')}</span>
        <button type="button" className={styles.iconButton} aria-label={t(collapsed ? '連絡を開く' : 'あとで確認')} aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>{collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>
      </div>
      {!collapsed ? <>
        <p className={`${styles.message} ${expanded ? styles.expanded : ''}`} aria-live="polite" data-i18n-ignore>{alert.message}</p>
        <div className={styles.actions}>
          <span className={styles.sender} data-i18n-ignore>{alert.senderName}</span>
          <button type="button" className={styles.detailButton} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{t(expanded ? '短く表示' : '全文を見る')}</button>
          <button type="button" className={styles.confirm} onClick={() => void acknowledge()} disabled={saving}><Check size={16} aria-hidden="true" />{t(saving ? '保存中...' : '確認しました')}</button>
        </div>
        {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
        {offline ? <p className={styles.error} role="status">{t('連絡を再接続中です。確認結果は通信回復後に保存してください。')}</p> : null}
      </> : <button type="button" className={styles.collapsedPreview} data-i18n-ignore onClick={() => setCollapsed(false)}>{alert.message}</button>}
    </div>
  </aside>;
}
