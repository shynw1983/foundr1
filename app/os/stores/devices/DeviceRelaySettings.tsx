'use client';

import { useEffect, useRef, useState } from 'react';
import type { RelayStation } from '../../../store/components/useStoreRelay';
import styles from './DeviceRelaySettings.module.css';

type Draft = { name: string; enabled: boolean; printEnabled: boolean; scaleEnabled: boolean };
type RelayAction = 'save' | 'testPrint' | 'pair' | 'revoke';
type NativeSupport = 'app' | 'oldApp' | 'browser';
const emptyDraft = (name = 'レジ A'): Draft => ({ name, enabled: false, printEnabled: false, scaleEnabled: false });
const stationDraft = (station: RelayStation): Draft => ({ name: station.name, enabled: station.enabled, printEnabled: station.print_enabled, scaleEnabled: station.scale_enabled });

export function DeviceRelaySettings({ storeId, storeName }: { storeId: string; storeName?: string }) {
  const [stations, setStations] = useState<RelayStation[]>([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [manage, setManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<RelayAction | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [code, setCode] = useState('');
  const [statusKnown, setStatusKnown] = useState(false);
  const [nativeSupport, setNativeSupport] = useState<NativeSupport>('browser');
  const scopeRef = useRef(storeId);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  scopeRef.current = storeId;

  const saved = stations.find(station => station.id === selected);
  const dirty = !saved || saved.name !== draft.name || saved.enabled !== draft.enabled
    || saved.print_enabled !== draft.printEnabled || saved.scale_enabled !== draft.scaleEnabled;
  const dirtyRef = useRef(dirty);
  const selectedRef = useRef(selected);
  dirtyRef.current = dirty;
  selectedRef.current = selected;
  const ready = Boolean(storeId && !loading && !busy && saved?.enabled && !dirty);
  const connectionUrl = `/store/device-relay?${new URLSearchParams({ storeId, stationId: selected })}`;

  useEffect(() => {
    const nativeWindow = window as Window & { Foundr1DeviceRelay?: unknown; Foundr1Printer?: unknown };
    setNativeSupport(nativeWindow.Foundr1DeviceRelay ? 'app' : nativeWindow.Foundr1Printer ? 'oldApp' : 'browser');
  }, []);

  useEffect(() => {
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setStations([]); setSelected(''); setDraft(emptyDraft()); setManage(false);
    setCode(''); setMessage(''); setError(''); setPollError(''); setBusy(''); setStatusKnown(false); busyRef.current = false;
    setLoading(Boolean(storeId));
    if (storeId) {
      void fetch(`/api/os/stores/device-relay?storeId=${encodeURIComponent(storeId)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        const body = await response.json();
        if (scopeRef.current !== storeId || requestId !== requestRef.current) return;
        if (!response.ok) throw new Error(body.error || '接続状態を確認できません。');
        const next: RelayStation[] = body.stations || [];
        setStations(next); setManage(body.canManage === true); setStatusKnown(true);
        setSelected(next[0]?.id || ''); setDraft(next[0] ? stationDraft(next[0]) : emptyDraft());
      }).catch(reason => {
        if (!controller.signal.aborted && scopeRef.current === storeId && requestId === requestRef.current) {
          setError(reason instanceof Error ? reason.message : '接続状態を確認できません。');
        }
      }).finally(() => {
        if (scopeRef.current === storeId && requestId === requestRef.current) setLoading(false);
      });
    }
    return () => { controller.abort(); ++requestRef.current; };
  }, [storeId]);

  const shouldPoll = stations.some(station => station.enabled || station.device_paired);
  useEffect(() => {
    if (!storeId || !shouldPoll) return;
    let active = true;
    let polling = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!active || polling || busyRef.current || document.visibilityState !== 'visible') return;
      polling = true;
      const requestId = ++requestRef.current;
      try {
        const response = await fetch(`/api/os/stores/device-relay?storeId=${encodeURIComponent(storeId)}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!active || scopeRef.current !== storeId || requestId !== requestRef.current) return;
        if (!response.ok) throw new Error(body.error || '接続状態を確認できません。');
        const nextStations: RelayStation[] = body.stations || [];
        if (!dirtyRef.current) {
          const current = nextStations.find(station => station.id === selectedRef.current);
          if (current) setDraft(stationDraft(current));
        }
        setStations(nextStations); setManage(body.canManage === true); setStatusKnown(true); setPollError('');
      } catch (reason) {
        if (active && !controller.signal.aborted && scopeRef.current === storeId && requestId === requestRef.current) {
          setStatusKnown(false);
          setPollError(reason instanceof Error ? reason.message : '接続状態を確認できません。');
        }
      } finally { polling = false; }
    };
    const timer = window.setInterval(() => void refresh(), 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [storeId, shouldPoll]);

  function chooseStation(id: string) {
    if (dirty && saved && !window.confirm('保存していない変更を破棄して切り替えますか。')) return;
    const station = stations.find(item => item.id === id);
    setSelected(id); setDraft(station ? stationDraft(station) : emptyDraft(stations.length ? `レジ ${stations.length + 1}` : 'レジ A'));
    setCode(''); setMessage(''); setError('');
  }

  async function send(action: RelayAction) {
    if (busyRef.current || !storeId || !manage || loading) return;
    if (action !== 'save' && (!saved || dirty || (action !== 'revoke' && !saved.enabled))) return;
    if (action === 'testPrint' && (!statusKnown || !saved?.print_enabled || !saved.device_online)) return;
    if (action === 'save' && (!dirty || !draft.name.trim())) return;
    if (action === 'pair' && saved?.device_paired
      && !window.confirm('接続中のスマホを解除し、新しい接続コードを発行します。印刷中の用紙を確認してから続けてください。')) return;
    if (action === 'revoke' && !window.confirm('この店舗のスマホ接続を解除しますか。印刷中の用紙を確認してから続けてください。')) return;
    const requestId = ++requestRef.current;
    busyRef.current = true; setBusy(action); setMessage(''); setError('');
    if (action === 'pair') setCode('');
    try {
      const response = await fetch('/api/os/stores/device-relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, storeId, stationId: selected || undefined, ...draft }),
      });
      const body = await response.json();
      if (scopeRef.current !== storeId || requestId !== requestRef.current) return;
      if (!response.ok) throw new Error(body.error || '操作を完了できません。');
      if (action === 'pair') {
        if (typeof body.pairingCode !== 'string' || !/^[0-9]{6}$/.test(body.pairingCode)) throw new Error('接続コードは6桁の数字で入力してください。');
        setCode(body.pairingCode);
      }
      else if (action === 'save' || action === 'revoke') setCode('');
      const nextResponse = await fetch(`/api/os/stores/device-relay?storeId=${encodeURIComponent(storeId)}`, { cache: 'no-store' });
      const next = await nextResponse.json();
      if (scopeRef.current !== storeId || requestId !== requestRef.current) return;
      if (!nextResponse.ok) throw new Error(next.error || '最新の接続状態を確認できません。画面を再読み込みしてください。');
      const nextStations: RelayStation[] = next.stations || [];
      setStations(nextStations); setManage(next.canManage === true); setStatusKnown(true); setPollError('');
      if (action === 'save') {
        const stationId = body.stationId || selected;
        const station = nextStations.find(item => item.id === stationId);
        setSelected(stationId);
        if (station) setDraft(stationDraft(station));
      }
      setMessage({ save: '設定を保存しました。', pair: '接続コードを発行しました。', revoke: 'スマホとの接続を解除しました。', testPrint: 'テスト印刷を受け付けました。印刷された用紙を確認してください。' }[action]);
    } catch (reason) {
      if (scopeRef.current === storeId && requestId === requestRef.current) setError(reason instanceof Error ? reason.message : '操作を完了できません。');
    } finally {
      if (scopeRef.current === storeId && requestId === requestRef.current) { busyRef.current = false; setBusy(''); }
    }
  }

  const status = !statusKnown
    ? { label: '接続状態を確認できません', help: '通信環境を確認して、画面を再読み込みしてください。' }
    : !saved?.enabled
    ? { label: 'この店舗では未使用', help: '使う機能を選んで設定を保存してください。' }
    : !saved.device_paired
      ? { label: 'スマホ未接続', help: '手順 2 から、プリンターにつなぐ Android スマホを接続してください。' }
      : saved.device_online
        ? { label: 'スマホからの接続を確認', help: 'サーバーがスマホからの通信を確認しています。印刷結果は用紙で確認してください。' }
        : { label: 'スマホからの通信がありません', help: '接続済みのスマホで Android Store App を開き、接続画面から再開してください。' };
  const connectLabel = nativeSupport === 'app' ? 'このスマホの接続画面を開く' : 'Android Store App の接続手順を開く';

  return <section className={`panel ${styles.panel}`} aria-busy={loading || Boolean(busy)}>
    <header className={styles.header}>
      <h3>スマホで印刷・計量</h3>
      {storeName ? <p className={styles.storeName}>{storeName}</p> : null}
      {stations.length > 1 && saved ? <p className={styles.storeName}>{saved.name}</p> : null}
      <p>iPad などで受け付けた会計を、Android スマホからプリンターへ送ります。</p>
    </header>
    {loading ? <p role="status">接続状態を読み込み中…</p> : !storeId ? <p>店舗を選択してください。</p> : <>
      {!manage ? <p className={styles.note}>設定を変更する権限がありません。店舗管理者に依頼してください。</p> : null}
      <div className={styles.step}>
        <h4><span className={styles.stepNumber} aria-hidden="true">1</span>使う機能を保存</h4>
        <div className={styles.toggles}>
          <label className={styles.checkLabel}><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))} disabled={!manage || Boolean(busy)} /><span>この店舗でスマホ連携を使う</span></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={draft.printEnabled} onChange={event => setDraft(current => ({ ...current, printEnabled: event.target.checked }))} disabled={!manage || Boolean(busy)} /><span>印刷</span></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={draft.scaleEnabled} onChange={event => setDraft(current => ({ ...current, scaleEnabled: event.target.checked }))} disabled={!manage || Boolean(busy)} /><span>電子はかり <small className={styles.badge}>Android 接続</small></span></label>
        </div>
        <p className={styles.note}>印刷先・紙幅・伝票は、この店舗のプリンター設定を使います。</p>
        <p className={styles.note}>A&amp;D SH-3000AWP-BT は、対応する Android Store App で接続します。利用前に実機で重量を確認してください。</p>
        <div className={styles.actions}>
          <button type="button" className="primary-button" disabled={!manage || Boolean(busy) || !dirty || !draft.name.trim()} onClick={() => void send('save')}>{busy === 'save' ? '保存中…' : '設定を保存'}</button>
          <span className={styles.note}>{dirty ? '変更はまだ保存されていません。' : '設定は保存済みです。'}</span>
        </div>
        <p className={styles.note}>設定を変えて保存すると、POS で会計する端末を選び直す必要があります。</p>
      </div>

      <div className={styles.step}>
        <h4><span className={styles.stepNumber} aria-hidden="true">2</span>Android スマホを接続</h4>
        <p>{nativeSupport === 'app' ? 'このスマホをプリンターにつなぐ場合は、次の画面で接続を開始します。' : nativeSupport === 'oldApp' ? 'この Store App は更新が必要です。最新版の Android Store App で接続してください。' : 'このブラウザーではスマホからの印刷を開始できません。プリンターにつなぐスマホの Android Store App で接続してください。'}</p>
        {ready ? <a className={`primary-button ${styles.connectButton}`} href={connectionUrl}>{connectLabel}</a> : <button type="button" className={`primary-button ${styles.connectButton}`} disabled>{connectLabel}</button>}
        {!ready && !busy ? <p className={styles.note}>スマホ連携を有効にして保存すると、接続画面を開けます。</p> : null}
        <p className={styles.note}>会計に使う iPad では、POS から「この端末で会計する」を選びます。</p>
      </div>

      <div className={styles.step}>
        <h4><span className={styles.stepNumber} aria-hidden="true">3</span>接続と印刷を確認</h4>
        <div className={styles.status} role="status"><span className={`${styles.statusDot} ${statusKnown && saved?.enabled && saved.device_online ? styles.online : ''}`} aria-hidden="true" /><strong>{status.label}</strong></div>
        <p className={styles.note}>{status.help}</p>
        <button type="button" className="secondary-button" disabled={!manage || !ready || !statusKnown || !saved?.print_enabled || !saved.device_online} onClick={() => void send('testPrint')}>{busy === 'testPrint' ? '印刷を受け付け中…' : 'テスト印刷'}</button>
      </div>

      <details className={styles.details}>
        <summary>詳細設定</summary>
        <div className={styles.detailBody}>
          <p className={styles.note}>通常は 1 つのレジで使えます。レジが複数ある場合や、名前を変更するときに設定します。</p>
          <label className={styles.field}>設定するレジ<select value={selected} onChange={event => chooseStation(event.target.value)} disabled={Boolean(busy)}><option value="">新しいレジを追加</option>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
          <label className={styles.field}>レジ名<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} maxLength={60} disabled={!manage || Boolean(busy)} /></label>
          <p className={styles.note}>変更後は、手順 1 の「設定を保存」を押してください。</p>
        </div>
      </details>

      <details className={styles.details}>
        <summary>別のスマホを接続・詳細操作</summary>
        <div className={styles.detailBody}>
          <p className={styles.note}>別の Android スマホにコードを入力して接続する場合に使います。</p>
          <div className={styles.actions}>
            <button type="button" className="secondary-button" disabled={!manage || !ready} onClick={() => void send('pair')}>接続コードを発行</button>
            <button type="button" className="secondary-button" disabled={!manage || Boolean(busy) || dirty || !saved?.device_paired} onClick={() => void send('revoke')}>スマホの接続を解除</button>
          </div>
          <p className={styles.note}>新しいコードを発行すると、以前のスマホは接続できなくなります。印刷中の用紙を確認してから操作してください。</p>
          {code ? <div className={styles.code}><p>Android Store App の接続画面に6桁の数字を入力してください。有効期限は 10 分です。</p><code>{code}</code></div> : null}
        </div>
      </details>
    </>}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    {pollError ? <p className={styles.error} role="alert">{pollError}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}
