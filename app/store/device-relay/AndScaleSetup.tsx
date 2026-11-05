'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, Download, Scale } from 'lucide-react';
import styles from './AndScaleSetup.module.css';

export type AndScaleDevice = { name: string; address: string; rssi?: number };
export type AndScaleStatus = {
  enabled: boolean; state: string; message?: string; selected: AndScaleDevice | null; devices: AndScaleDevice[];
  scanning: boolean; permissionsGranted: boolean; bluetoothEnabled: boolean;
  storeId: string; stationId: string; targetAgeMs: number;
  lastReadingAgeMs: number; lastReading: { grams: number; stable: boolean; overload: boolean; mode?: 'preset'; grossGrams?: number; tareGrams?: number } | null;
};
type ScaleBridge = {
  scaleScan: () => string; scaleSelect: (address: string) => string; scaleDisconnect: () => string;
  scaleForget: () => string; scaleStatus: () => string; scaleCancelScan?: () => string;
};
type Props = { enabled: boolean; storeId: string; stationId: string; scopeKey: string };
type Action = 'scan' | 'select' | 'reconnect' | 'disconnect' | 'forget' | 'cancel';
type Pending = { action: Action; address?: string; at: number };

export const AND_SCALE_COPY = {
  title: '電子はかりを接続',
  intro: 'A&D SH-3000AWP-BT を、このスマホにつなぎます。',
  preparation: 'はかりの準備',
  preparePower: 'はかりを水平に置き、電源を入れてください。',
  prepareCommand: 'はかりのデータ出力を「Prt=1（コマンドモード）」に設定してください。',
  prepareTare: 'POS で容器重量プリセットを使う場合は、本体で風袋引きせずに計量してください。使わない場合は、空の容器を載せて本体で風袋引きしてください。',
  grossWeight: '総重量',
  tareWeight: '容器重量',
  netWeight: '正味重量',
  preparePairing: 'スマホにペアリングの確認が表示されたら、内容を確認して許可してください。',
  disabled: 'この店舗では電子はかり連携がオフです。設備設定で有効にして保存してください。',
  browser: '電子はかりの接続は Android Store App で操作してください。',
  upgrade: '電子はかりに対応した Store App へ更新してください。',
  download: 'Android Store App をダウンロード',
  checking: 'このスマホの接続先を確認しています。先に、このスマホを選択中の店舗・レジへ接続してください。',
  different: 'このスマホの接続先が一致していません。選択中の店舗・レジに接続し直してください。',
  expired: '接続先を確認できません。通信を確認して、しばらく待ってください。',
  statusError: 'はかりの状態を確認できません。Store App を開き直してください。',
  scan: '近くのはかりを探す',
  cancel: '探索を止める',
  waitScan: '検出まで2分ほどかかる場合があります。見つからないときは、はかりの電源を入れ直してから探してください。',
  devices: '見つかったはかり',
  choose: '本体の名前と識別番号を確認して、使うはかりを選んでください。自動では選びません。',
  suffix: '識別番号（末尾）',
  unnamed: '名前のないはかり',
  connect: 'このはかりに接続',
  reconnect: '選択中のはかりに再接続',
  reconnectRequired: 'はかりの電源と Bluetooth を確認し、「選択中のはかりに再接続」を押してください。',
  selected: '選択中のはかり',
  empty: 'はかりが見つかりませんでした。',
  first: 'はかりの電源を入れてから、近くのはかりを探してください。',
  scanning: '電子はかりを探しています。',
  permission: 'Bluetooth の使用を許可してください。',
  denied: 'Bluetooth の権限がありません。Android の設定で許可してから、もう一度探してください。',
  bluetoothOff: 'Bluetooth がオフです。スマホの Bluetooth をオンにしてください。',
  locationOff: '位置情報がオフです。スマホの位置情報をオンにしてから、もう一度探してください。',
  notSelected: '接続するはかりを選んでください。',
  connecting: 'はかりに接続しています。',
  bonding: 'はかりとペアリングしています。スマホに表示される確認を完了してください。',
  preparing: 'はかりとの通信を準備しています。',
  waiting: 'はかりに接続しました。新しい重量を待っています。',
  reading: '重量を受信しています。',
  stable: '安定',
  unstable: '安定待ち',
  overload: '計量範囲を超えています。はかりから物を降ろしてください。',
  weightHelp: '重量は POS の計量画面で確定します。',
  disconnected: 'はかりとの接続が切れています。',
  failed: 'はかりに接続できません。電源と Bluetooth を確認して、もう一度操作してください。',
  unsupported: 'このはかりの通信方法は未確認です。手入力を使用し、接続状態を確認してください。',
  protocolError: '重量データを確認できません。はかりの表示と接続状態を確認してください。',
  advanced: '接続の詳細操作',
  disconnect: 'はかりとの接続を切る',
  forget: 'はかりの登録を解除',
  scanPending: '探索を開始しています。',
  selectPending: 'はかりへの接続を開始しています。',
  disconnectPending: 'はかりとの接続を終了しています。',
  forgetPending: 'はかりの登録を解除しています。',
  cancelPending: '探索を停止しています。',
  operationError: '操作を完了できません。接続状態を確認してから、もう一度お試しください。'
} as const;

function bridge(): ScaleBridge | null {
  const candidate = (window as unknown as { Foundr1DeviceRelay?: Partial<ScaleBridge> }).Foundr1DeviceRelay;
  return candidate && ['scaleScan', 'scaleSelect', 'scaleDisconnect', 'scaleForget', 'scaleStatus']
    .every(key => typeof candidate[key as keyof ScaleBridge] === 'function') ? candidate as ScaleBridge : null;
}
function parseStatus(value: string): AndScaleStatus {
  const status = JSON.parse(value) as AndScaleStatus;
  if (!status || typeof status.enabled !== 'boolean' || typeof status.state !== 'string' || !Array.isArray(status.devices)) throw new Error(AND_SCALE_COPY.statusError);
  return { ...status, devices: status.devices.filter(device => device && typeof device.address === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.address)),
    selected: status.selected && typeof status.selected.address === 'string' ? status.selected : null };
}
function targetMatches(status: AndScaleStatus, props: Props) {
  return Boolean(props.enabled && props.storeId && props.stationId && status.enabled && status.storeId === props.storeId && status.stationId === props.stationId
    && Number.isFinite(status.targetAgeMs) && status.targetAgeMs >= 0 && status.targetAgeMs <= 15000);
}
function shortAddress(address: string) { return address.slice(-8).toUpperCase(); }
const transitional = new Set(['connecting', 'bonding', 'discovering', 'subscribing']);
function pendingAcknowledged(pending: Pending, status: AndScaleStatus) {
  if (Date.now() - pending.at >= 10000 || ['permission_required', 'permission_denied', 'bluetooth_off', 'location_off', 'error', 'protocol_error', 'unsupported_properties', 'reconnect_required', 'disabled', 'authorization_expired'].includes(status.state)) return true;
  if (pending.action === 'scan') return status.scanning || status.state === 'scanning';
  if (pending.action === 'select' || pending.action === 'reconnect') return transitional.has(status.state) || status.state === 'connected';
  if (pending.action === 'disconnect') return ['disconnected', 'not_selected'].includes(status.state);
  if (pending.action === 'forget') return !status.selected;
  return !status.scanning;
}

export function AndScaleSetup(props: Props) {
  const [support, setSupport] = useState<'loading' | 'browser' | 'old' | 'ready'>('loading');
  const [status, setStatus] = useState<AndScaleStatus | null>(null), [error, setError] = useState(''), [readError, setReadError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null), [hasScanned, setHasScanned] = useState(false);
  const propsRef = useRef(props), generation = useRef(0), pendingRef = useRef<Pending | null>(null), previousState = useRef('');
  propsRef.current = props;
  const read = useCallback((expected: number) => {
    if (expected !== generation.current) return null;
    const native = bridge();
    if (!native) return null;
    try {
      const next = parseStatus(native.scaleStatus());
      if (expected !== generation.current) return null;
      setStatus(next); setReadError('');
      if (next.state !== previousState.current) { previousState.current = next.state; setError(''); }
      if (pendingRef.current && pendingAcknowledged(pendingRef.current, next)) { pendingRef.current = null; setPending(null); }
      return next;
    } catch {
      if (expected === generation.current) { setStatus(null); setReadError(AND_SCALE_COPY.statusError); pendingRef.current = null; setPending(null); }
      return null;
    }
  }, []);

  useEffect(() => {
    const expected = ++generation.current;
    setStatus(null); setError(''); setReadError(''); previousState.current = ''; setHasScanned(false); setPending(null); pendingRef.current = null;
    const native = bridge();
    setSupport(native ? 'ready' : (window as unknown as { Foundr1DeviceRelay?: unknown }).Foundr1DeviceRelay ? 'old' : 'browser');
    if (!native || !props.enabled) return;
    const tick = () => { if (document.visibilityState === 'visible') read(expected); };
    tick(); const timer = window.setInterval(tick, 2000);
    document.addEventListener('visibilitychange', tick);
    return () => { ++generation.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [props.enabled, props.scopeKey, props.storeId, props.stationId, read]);

  function act(action: Action, address?: string) {
    if (pendingRef.current || document.visibilityState !== 'visible') return;
    const expected = generation.current, native = bridge(), fresh = read(expected);
    if (!native || !fresh || !targetMatches(fresh, propsRef.current)) return;
    if (action === 'select' && (!fresh.permissionsGranted || !fresh.bluetoothEnabled || !address || !fresh.devices.some(device => device.address === address))) return;
    if (action === 'reconnect' && (!fresh.permissionsGranted || !fresh.bluetoothEnabled || !address || fresh.selected?.address !== address
      || fresh.scanning || fresh.state === 'connected' || transitional.has(fresh.state))) return;
    const nextPending = { action, address, at: Date.now() }; pendingRef.current = nextPending; setPending(nextPending); setError('');
    try {
      const value = action === 'scan' ? native.scaleScan() : action === 'select' || action === 'reconnect' ? native.scaleSelect(address!)
        : action === 'disconnect' ? native.scaleDisconnect() : action === 'forget' ? native.scaleForget() : native.scaleCancelScan?.();
      const result = value ? JSON.parse(value) as { ok?: boolean; error?: string } : null;
      if (expected !== generation.current) return;
      if (!result?.ok) throw new Error(result?.error || AND_SCALE_COPY.operationError);
      if (action === 'scan') setHasScanned(true);
      if (action === 'forget') setHasScanned(false);
    } catch {
      if (expected === generation.current) { pendingRef.current = null; setPending(null); read(expected); setError(AND_SCALE_COPY.operationError); }
    }
  }

  const sameIds = Boolean(status && status.storeId === props.storeId && status.stationId === props.stationId);
  const allowed = Boolean(status && targetMatches(status, props)), canOperate = allowed && !pending;
  const visibleStatus = allowed ? status : null;
  const reading = visibleStatus?.lastReading;
  const freshReading = Boolean(visibleStatus?.state === 'connected' && reading && Number.isFinite(reading.grams)
    && Number.isFinite(visibleStatus.lastReadingAgeMs) && visibleStatus.lastReadingAgeMs >= 0 && visibleStatus.lastReadingAgeMs <= 5000);
  const states: Record<string, string> = { disabled: AND_SCALE_COPY.disabled, authorization_expired: AND_SCALE_COPY.expired,
    permission_required: AND_SCALE_COPY.permission, permission_denied: AND_SCALE_COPY.denied, bluetooth_off: AND_SCALE_COPY.bluetoothOff,
    location_off: AND_SCALE_COPY.locationOff, scanning: AND_SCALE_COPY.scanning, not_selected: AND_SCALE_COPY.notSelected,
    connecting: AND_SCALE_COPY.connecting, bonding: AND_SCALE_COPY.bonding, discovering: AND_SCALE_COPY.preparing, subscribing: AND_SCALE_COPY.preparing,
    connected: freshReading ? AND_SCALE_COPY.reading : AND_SCALE_COPY.waiting, disconnected: AND_SCALE_COPY.disconnected,
    unsupported_properties: AND_SCALE_COPY.unsupported, reconnect_required: AND_SCALE_COPY.reconnectRequired, protocol_error: AND_SCALE_COPY.protocolError, error: AND_SCALE_COPY.failed };
  const pendingText: Record<Action, string> = { scan: AND_SCALE_COPY.scanPending, select: AND_SCALE_COPY.selectPending, reconnect: AND_SCALE_COPY.selectPending,
    disconnect: AND_SCALE_COPY.disconnectPending, forget: AND_SCALE_COPY.forgetPending, cancel: AND_SCALE_COPY.cancelPending };
  let statusText = AND_SCALE_COPY.checking as string;
  if (status && !sameIds && (status.storeId || status.stationId)) statusText = AND_SCALE_COPY.different;
  else if (status && sameIds && !allowed) statusText = AND_SCALE_COPY.expired;
  else if (visibleStatus) statusText = pending ? pendingText[pending.action] : states[visibleStatus.state] || AND_SCALE_COPY.failed;
  const scanning = Boolean(visibleStatus?.scanning || visibleStatus?.state === 'scanning');
  const busyConnection = Boolean(visibleStatus && transitional.has(visibleStatus.state));

  return <section className={`panel ${styles.panel}`} aria-label={AND_SCALE_COPY.title}>
    <header className={styles.heading}><Scale size={21} aria-hidden="true" /><h2>{AND_SCALE_COPY.title}</h2></header>
    <p>{AND_SCALE_COPY.intro}</p>
    <details className={styles.details}><summary>{AND_SCALE_COPY.preparation}</summary><p className={styles.help}>{AND_SCALE_COPY.preparePower}</p><ol className={styles.preparation}>
      <li>{AND_SCALE_COPY.prepareCommand}</li><li>{AND_SCALE_COPY.prepareTare}</li><li>{AND_SCALE_COPY.preparePairing}</li>
    </ol></details>
    {!props.enabled ? <p className={styles.notice}>{AND_SCALE_COPY.disabled}</p> : support === 'browser' || support === 'old' ? <>
      <p className={styles.notice}>{support === 'old' ? AND_SCALE_COPY.upgrade : AND_SCALE_COPY.browser}</p>
      <a className={`secondary-button ${styles.download}`} href="/downloads/foundr1-store-latest.apk"><Download size={17} aria-hidden="true" />{AND_SCALE_COPY.download}</a>
    </> : support === 'ready' ? <>
      <p className={styles.status} role="status" aria-live="polite">{statusText}</p>
      {visibleStatus ? <>
        {visibleStatus.selected ? <div className={styles.selected}><span>{AND_SCALE_COPY.selected}</span><strong>{visibleStatus.selected.name || AND_SCALE_COPY.unnamed}</strong><small>{AND_SCALE_COPY.suffix} <code>{shortAddress(visibleStatus.selected.address)}</code></small></div> : null}
        {freshReading && reading ? reading.overload ? <p className={styles.notice}>{AND_SCALE_COPY.overload}</p> : <>
          {reading.mode === 'preset' && Number.isFinite(reading.grossGrams) && Number.isFinite(reading.tareGrams) ? <p className={styles.help}><span>{AND_SCALE_COPY.grossWeight}</span> {reading.grossGrams} g − <span>{AND_SCALE_COPY.tareWeight}</span> {reading.tareGrams} g</p> : null}
          <div className={styles.weight}><strong>{reading.grams}<span> g</span></strong><span>{reading.mode === 'preset' ? <>{AND_SCALE_COPY.netWeight}<br /></> : null}{reading.stable ? AND_SCALE_COPY.stable : AND_SCALE_COPY.unstable}</span></div>
        </> : null}
        {visibleStatus.state === 'connected' ? <p className={styles.help}>{AND_SCALE_COPY.weightHelp}</p> : null}
        <div className={styles.actions}>
          {visibleStatus.selected && visibleStatus.state !== 'connected' ? <button type="button" className="primary-button"
            disabled={!canOperate || scanning || busyConnection || !visibleStatus.permissionsGranted || !visibleStatus.bluetoothEnabled}
            onClick={() => act('reconnect', visibleStatus.selected!.address)}>{AND_SCALE_COPY.reconnect}</button> : null}
          <button type="button" className="primary-button" disabled={!canOperate || scanning || busyConnection} onClick={() => act('scan')}><Bluetooth size={17} aria-hidden="true" />{AND_SCALE_COPY.scan}</button>
          {scanning && bridge()?.scaleCancelScan ? <button type="button" className="secondary-button" disabled={!canOperate} onClick={() => act('cancel')}>{AND_SCALE_COPY.cancel}</button> : null}
        </div>
        <p className={styles.help}>{AND_SCALE_COPY.waitScan}</p>
        {visibleStatus.devices.length ? <div className={styles.devices} aria-label={AND_SCALE_COPY.devices}>
          <h3>{AND_SCALE_COPY.devices}</h3><p className={styles.help}>{AND_SCALE_COPY.choose}</p>
          {visibleStatus.devices.map(device => <button type="button" className={styles.device} key={device.address}
            disabled={!canOperate || busyConnection || !visibleStatus.permissionsGranted || !visibleStatus.bluetoothEnabled}
            aria-pressed={visibleStatus.selected?.address === device.address} onClick={() => act('select', device.address)}>
            <strong>{device.name || AND_SCALE_COPY.unnamed}</strong><small>{AND_SCALE_COPY.suffix} <code>{shortAddress(device.address)}</code></small><span>{AND_SCALE_COPY.connect}</span>
          </button>)}
        </div> : !scanning && !visibleStatus.selected && !busyConnection ? <p className={styles.help}>{hasScanned ? AND_SCALE_COPY.empty : AND_SCALE_COPY.first}</p> : null}
        {visibleStatus.selected ? <details className={styles.details}><summary>{AND_SCALE_COPY.advanced}</summary><div className={styles.actions}>
          <button type="button" className="secondary-button" disabled={!canOperate} onClick={() => act('disconnect')}>{AND_SCALE_COPY.disconnect}</button>
          <button type="button" className="secondary-button" disabled={!canOperate} onClick={() => act('forget')}>{AND_SCALE_COPY.forget}</button>
        </div></details> : null}
      </> : null}
    </> : null}
    {readError || error ? <p className={styles.error} role="alert">{readError || error}</p> : null}
  </section>;
}
