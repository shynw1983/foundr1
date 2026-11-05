'use client';

import { useEffect, useRef, useState } from 'react';
import { useOsTranslation } from '../../os/components/OsTranslationProvider';
import { usableScaleReading } from '../../../lib/store-relay-policy';
import type { PosScaleTarePresetId, PosScaleTareSettings, PosWeightMeasurement } from '../../../lib/pos-scale-tare';
import { normalizePosScaleFilterSettings } from '../../../lib/pos-scale-filter';
import type { RelayStation, useStoreRelay } from './useStoreRelay';

export type ReturnTypeRelay = ReturnType<typeof useStoreRelay>;
export type ScaleConfirmationValidity = { ready: boolean; scopeKey: string; stationId: string; ownerToken: string; epoch: number; recoveryVersion: number };
function filterIdentity(station: RelayStation | undefined) {
  const settings = normalizePosScaleFilterSettings(station?.scale_filter_settings);
  return `${settings.enabled}:${settings.revision}:${settings.toleranceGrams}:${settings.settleMs}`;
}
function filterAcceptsReading(station: RelayStation | undefined) {
  const settings = normalizePosScaleFilterSettings(station?.scale_filter_settings);
  const reading = station?.scale_reading;
  if (!settings.enabled) return !reading?.filter;
  return Boolean(settings.revision && reading?.filter?.source === 'software_window'
    && reading.filter.settingsRevision === settings.revision && reading.filter.accepted);
}
type ScaleSnapshotSafety = 'safe' | 'refresh' | 'unsafe';
// A cached reading can expire while the server confirms an immutable capture.
// Expiry pauses use of that capture; a changed load or lost evidence retires it.
function scaleSnapshotSafety(station: RelayStation | undefined, grams: number | null, now: number, expectedWindowId?: string | null): ScaleSnapshotSafety {
  if (!station?.enabled || !station.scale_enabled || !station.device_online || station.device_status?.scale !== 'connected') return 'unsafe';
  const clockKnown = Number.isFinite(now);
  const ownerUntil = Date.parse(station.owner_until || '');
  if (!Number.isFinite(ownerUntil) || clockKnown && ownerUntil <= now) return 'unsafe';
  const reading = station.scale_reading;
  if (!reading) return station.scale_session ? 'unsafe' : clockKnown ? 'safe' : 'refresh';
  const settings = normalizePosScaleFilterSettings(station.scale_filter_settings);
  if (settings.enabled && (!settings.revision || reading.filter?.source !== 'software_window' || reading.filter.settingsRevision !== settings.revision)) return 'unsafe';
  if (!settings.enabled && reading.filter) return 'unsafe';
  if (!Number.isFinite(reading.grams) || reading.overload || reading.grams > 3000) return 'unsafe';
  // Removing the full bowl (gross zero) is expected. A different object/empty
  // plate still on the scale must not make the old positive net weight usable.
  if (reading.mode === 'preset' && Number(reading.grossGrams) > 0 && reading.grams <= 0) return 'unsafe';
  if (reading.grams <= 0) return clockKnown ? 'safe' : 'refresh';
  if (settings.enabled && expectedWindowId !== undefined && (reading.filter?.windowId || null) !== expectedWindowId) return 'unsafe';
  if (!filterAcceptsReading(station) || !reading.stable || reading.grams !== grams) return 'unsafe';
  if (!clockKnown) return 'refresh';
  return usableScaleReading(reading, Date.parse(station.scale_received_at || ''), now) ? 'safe' : 'refresh';
}
// Parent checkout gates remain closed while freshness is being recovered.
export function scaleSnapshotBlocksConfirmation(station: RelayStation | undefined, grams: number | null, now = Number.NaN, expectedWindowId?: string | null) {
  return scaleSnapshotSafety(station, grams, now, expectedWindowId) !== 'safe';
}
type Props = {
  relay: ReturnTypeRelay;
  scopeKey: string;
  manualMode: boolean;
  onManualModeChange: (manual: boolean) => void;
  onValidityChange: (validity: ScaleConfirmationValidity) => void;
  onAdopt: (id: string, grams: number, measurement?: PosWeightMeasurement) => void;
  tareSettings?: PosScaleTareSettings;
  tarePresetId?: PosScaleTarePresetId | '';
  onTarePresetChange?: (id: PosScaleTarePresetId) => void;
};

export function StoreRelayScale(props: Props) {
  const {t} = useOsTranslation();
  const { relay, manualMode, onManualModeChange, scopeKey } = props;
  const tareEnabled = props.tareSettings?.enabled === true;
  const tarePresetId = props.tarePresetId || '';
  const preset = props.tareSettings?.presets.find(p => p.id === tarePresetId);
  const tareReady = !tareEnabled || Boolean(preset?.grams && props.tareSettings?.revision);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const [measurement, setMeasurement] = useState<PosWeightMeasurement | null>(null);
  const [confirmationReady, setConfirmationReady] = useState(false);
  const readinessRef = useRef(false);
  const confirmedRef = useRef<(ScaleConfirmationValidity & { grams: number; filterKey: string; tareKey: string; windowId: string | null }) | null>(null);
  const pendingAdoptionRef = useRef<{ grams: number; windowId: string | null; unsafe: boolean } | null>(null);
  const [visible, setVisible] = useState(false);
  const s = relay.station;
  const filterSettings = normalizePosScaleFilterSettings(s?.scale_filter_settings);
  const filterKey = filterIdentity(s);
  const tareKey = tareEnabled ? `${props.tareSettings?.revision || ''}:${tarePresetId}` : '';
  const filterReady = !filterSettings.enabled || Boolean(filterSettings.revision && filterSettings.toleranceGrams >= 1
    && filterSettings.toleranceGrams <= 5 && filterSettings.settleMs >= 2000 && filterSettings.settleMs <= 5000);
  const tareSupported = !tareEnabled || Number(s?.device_status?.scaleTareVersion) >= 1;
  const configured = relay.stations.some(station => station.enabled && station.scale_enabled);
  const stationId = s?.id;
  const enabled = Boolean(s?.enabled && s.scale_enabled);
  const owner = relay.owner;

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    setError('');
    setCapturing(false);
    pendingAdoptionRef.current = null;
    const context = { scopeKey, stationId: stationId || '', ownerToken: owner?.token || '', epoch: owner?.epoch ?? -1, recoveryVersion: relay.recoveryVersion };
    const sameConfirmation = confirmedRef.current?.scopeKey === context.scopeKey && confirmedRef.current.stationId === context.stationId
      && confirmedRef.current.ownerToken === context.ownerToken && confirmedRef.current.epoch === context.epoch
      && confirmedRef.current.recoveryVersion === context.recoveryVersion
      && confirmedRef.current.filterKey === filterKey && confirmedRef.current.tareKey === tareKey;
    if (!sameConfirmation || manualMode) { confirmedRef.current = null; setConfirmed(null); setMeasurement(null); }
    const reportReady = (ready: boolean) => {
      readinessRef.current = ready;
      setConfirmationReady(ready);
      latest.current.onValidityChange({ ...context, ready });
    };
    reportReady(false);
    if (manualMode || !visible || !enabled || !stationId || !owner || !tareReady || !tareSupported || !filterReady) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let scaleSession: string | null = null;
    let lastGrams: number | null = confirmedRef.current?.grams ?? null;
    let attemptedReading = '';
    let blocked = false;
    let sessionObserved = false;
    let monitoringConfirmed = false;
    let startedAt = 0;
    let freshnessRefreshPending = false;
    let freshnessRefreshAt = -Infinity;
    let phase: 'start' | 'adopt' | 'idle' = 'idle';
    // Cleanup keeps the original owner and session, including after a store change.
    const action = relay.action;
    const originalOwner = owner;
    const end = (id: string) => action('scaleEnd', { scaleSession: id, owner: originalOwner }).catch(() => {});
    const isCurrent = () => active && document.visibilityState === 'visible' && !latest.current.manualMode && latest.current.scopeKey === scopeKey
      && latest.current.relay.owner?.token === originalOwner.token
      && latest.current.relay.owner?.epoch === originalOwner.epoch
      && latest.current.relay.recoveryVersion === context.recoveryVersion
      && filterIdentity(latest.current.relay.station) === filterKey;
    const refreshFreshness = () => {
      if (freshnessRefreshPending || performance.now() - freshnessRefreshAt < 1000) return;
      freshnessRefreshAt = performance.now();
      freshnessRefreshPending = true;
      void latest.current.relay.refresh().catch(() => {}).finally(() => { freshnessRefreshPending = false; });
    };
    const tick = async () => {
      let adoptionAttempt: { grams: number; windowId: string | null; unsafe: boolean } | null = null;
      try {
        if (!isCurrent() || blocked) return;
        const currentTime = latest.current.relay.now();
        if (!Number.isFinite(currentTime)) {
          if (readinessRef.current) reportReady(false);
          refreshFreshness();
          return;
        }
        const station = latest.current.relay.station;
        if (!station || station.id !== stationId || !station.enabled || !station.scale_enabled
          || station.epoch !== originalOwner.epoch || !(Date.parse(station.owner_until || '') > currentTime)) {
          if (readinessRef.current) reportReady(false);
          return;
        }
        if (!station.device_online || station.device_status?.scale !== 'connected') {
          if (readinessRef.current) reportReady(false);
          return;
        }
        if (readinessRef.current && scaleSnapshotBlocksConfirmation(station, lastGrams, currentTime, confirmedRef.current?.windowId)) reportReady(false);
        if (!scaleSession) {
          const id = window.crypto.randomUUID();
          scaleSession = id;
          sessionObserved = false;
          startedAt = performance.now();
          phase = 'start';
          try {
            await action('scaleStart', { scaleSession: id, expectedScaleSession: station.scale_session, owner: originalOwner, ...(tareEnabled ? {tarePresetId} : {}) });
          } catch (cause) {
            // The previous window's guarded cleanup may finish between our GET
            // and POST. Retry only that old-session -> empty transition, once.
            if ((cause as { status?: number }).status !== 409 || !station.scale_session) throw cause;
            const refreshed = await latest.current.relay.refresh();
            const current = refreshed?.find(candidate => candidate.id === stationId);
            if (!isCurrent() || !current || current.epoch !== originalOwner.epoch || current.scale_session !== null) throw cause;
            await action('scaleStart', { scaleSession: id, expectedScaleSession: null, owner: originalOwner, ...(tareEnabled ? {tarePresetId} : {}) });
          }
          phase = 'idle';
          if (!isCurrent()) await end(id);
          return;
        }
        if (station.scale_session !== scaleSession) {
          if (!sessionObserved && performance.now() - startedAt < 5000) return;
          blocked = true;
          reportReady(false);
          setError('計量の接続先が変わりました。もう一度試してください。');
          return;
        }
        sessionObserved = true;
        const safety = scaleSnapshotSafety(station, lastGrams, currentTime, confirmedRef.current?.windowId);
        if (monitoringConfirmed && safety === 'refresh') {
          if (readinessRef.current) reportReady(false);
          refreshFreshness();
          return;
        }
        if (monitoringConfirmed && safety === 'unsafe') {
          // Keep one accepted window alive while the load stays in range. A real
          // change/lost reading retires it once, then starts independent evidence.
          reportReady(false);
          monitoringConfirmed = false;
          scaleSession = null;
          return;
        }
        const sequence = Number(station.scale_sequence);
        const reading = station.scale_reading;
        if (!Number.isSafeInteger(sequence) || sequence < 0 || !reading) return;
        if (tareEnabled && (reading.mode !== 'preset' || reading.tarePresetId !== tarePresetId || reading.settingsRevision !== props.tareSettings?.revision)) {
          if (readinessRef.current) reportReady(false);
          return;
        }
        if (!Number.isFinite(reading.grams) || reading.overload || reading.grams > 3000) {
          if (readinessRef.current) reportReady(false);
          return;
        }
        if (reading.grams <= 0) return;
        if (!filterAcceptsReading(station)) {
          if (readinessRef.current) reportReady(false);
          return;
        }
        if (!usableScaleReading(reading, Date.parse(station.scale_received_at || ''), currentTime)) {
          if (readinessRef.current) reportReady(false);
          refreshFreshness();
          return;
        }
        const observedWindowId = reading.filter?.windowId || null;
        if (reading.grams === lastGrams && confirmedRef.current && confirmedRef.current.windowId === observedWindowId) {
          monitoringConfirmed = filterSettings.enabled;
          if (!readinessRef.current) reportReady(true);
          return;
        }
        const fingerprint = `${scaleSession}:${sequence}`;
        if (fingerprint === attemptedReading) return;
        attemptedReading = fingerprint;
        if (readinessRef.current) reportReady(false);
        setCapturing(true);
        const id = scaleSession;
        phase = 'adopt';
        adoptionAttempt = { grams: reading.grams, windowId: observedWindowId, unsafe: false };
        pendingAdoptionRef.current = adoptionAttempt;
        const result = await action('scaleAdopt', { scaleSession: id, scaleSequence: sequence, owner: originalOwner,
          ...(filterSettings.enabled ? { keepMonitoring: true } : {}),
          ...(observedWindowId ? { scaleWindowId: observedWindowId, scaleGrams: reading.grams } : {}) });
        phase = 'idle';
        if (!isCurrent()) return;
        if (filterSettings.enabled && (result.monitoring === false
          || (result.monitoring === true && latest.current.relay.station?.scale_session !== id))) {
          throw new Error('計量の接続先が変わりました。もう一度試してください。');
        }
        const responseSafety = scaleSnapshotSafety(latest.current.relay.station, adoptionAttempt.grams, latest.current.relay.now(), adoptionAttempt.windowId);
        if (adoptionAttempt.unsafe || responseSafety === 'unsafe') {
          // A changed load followed by zero must not make a delayed earlier
          // capture ready again. Requalify under a fresh guarded session.
          reportReady(false);
          monitoringConfirmed = false;
          scaleSession = null;
          return;
        }
        const grams = Number(result.capture?.grams);
        if (result.scaleSession !== id || !result.capture?.id || !Number.isFinite(grams) || grams <= 0 || grams > 3000) {
          throw new Error('重量を確認できません。もう一度試してください。');
        }
        const adoptedMeasurement = result.capture.weightMeasurement as PosWeightMeasurement | undefined;
        if (observedWindowId && (adoptedMeasurement?.filter?.windowId !== observedWindowId || grams !== reading.grams)) {
          throw new Error('重量を確認できません。もう一度試してください。');
        }
        if (tareEnabled && (adoptedMeasurement?.mode !== 'preset' || adoptedMeasurement.tarePresetId !== tarePresetId
          || adoptedMeasurement.settingsRevision !== props.tareSettings?.revision || adoptedMeasurement.netGrams !== grams)) {
          throw new Error('ボウルの重量設定が変わりました。商品を開き直してください。');
        }
        lastGrams = grams;
        monitoringConfirmed = result.monitoring === true;
        scaleSession = monitoringConfirmed ? id : null;
        confirmedRef.current = { ...context, ready: true, grams, filterKey, tareKey, windowId: observedWindowId };
        setConfirmed(grams);
        setMeasurement(adoptedMeasurement || null);
        setError('');
        latest.current.onAdopt(result.capture.id, grams, adoptedMeasurement);
        reportReady(responseSafety === 'safe');
        if (responseSafety === 'refresh') refreshFreshness();
      } catch (cause) {
        if (!isCurrent()) return;
        reportReady(false);
        if (phase === 'adopt' && (cause as { status?: number }).status === 409) {
          // The 1 Hz scale may have advanced while the POST was travelling. Read
          // again and try only a different sequence; never accept a different value.
          await latest.current.relay.refresh().catch(() => {});
          return;
        }
        setError(cause instanceof Error ? cause.message : '重量を確認できません。もう一度試してください。');
        // Unknown-result requests wait for an explicit retry. Accepted captures stay immutable.
        blocked = true;
      } finally {
        if (pendingAdoptionRef.current === adoptionAttempt) pendingAdoptionRef.current = null;
        if (active) {
          setCapturing(false);
          timer = setTimeout(() => void tick(), 400);
        }
      }
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
      reportReady(false);
      if (scaleSession) void end(scaleSession);
    };
  }, [manualMode, visible, enabled, stationId, owner?.token, owner?.epoch, relay.recoveryVersion, scopeKey, retry, tareEnabled, tarePresetId, tareReady, tareSupported, props.tareSettings?.revision, filterKey, filterReady, tareKey]);

  // Latch every observed unsafe snapshot, even if it is followed by zero before
  // the asynchronous capture loop next runs. An active empty reading is unsafe.
  useEffect(() => {
    const pending = pendingAdoptionRef.current;
    if (pending && scaleSnapshotSafety(s, pending.grams, relay.now(), pending.windowId) === 'unsafe') pending.unsafe = true;
    if (manualMode || !readinessRef.current) return;
    if (visible && confirmedRef.current && !scaleSnapshotBlocksConfirmation(s, confirmedRef.current.grams, relay.now(), confirmedRef.current.windowId)) return;
    readinessRef.current = false;
    setConfirmationReady(false);
    latest.current.onValidityChange({ ready: false, scopeKey, stationId: stationId || '', ownerToken: owner?.token || '', epoch: owner?.epoch ?? -1, recoveryVersion: relay.recoveryVersion });
  }, [manualMode, visible, s, confirmed, scopeKey, stationId, owner?.token, owner?.epoch, relay.recoveryVersion]);

  if (!configured && !tareEnabled) return null;
  const connected = Boolean(s?.device_online && s.device_status?.scale === 'connected');
  const state = s?.device_status?.scale;
  const status = !owner || !s ? '先に、この端末で会計を始めてください。'
    : manualMode ? tareEnabled ? '容器を差し引いた正味重量を手入力してください。ボウルの重さは再度差し引きません。' : '自動読取を一時停止しています。入力した重量を使用します。'
    : !tareReady ? 'ボウルのサイズを選んでください。'
    : !filterReady ? '揺れ対策の設定を確認してください。'
    : !visible ? '画面に戻ると、自動読取を再開します。'
    : !s.device_online ? '中継スマホが未接続です。'
    : !tareSupported ? 'ボウルの重さを自動で差し引くには、印刷用スマホの Store App を更新してください。'
    : connected ? capturing ? '安定した重量を確認しています。'
      : confirmed !== null && !confirmationReady ? '重量を再確認しています。安定するまで追加できません。'
      : '安定すると、重量を自動入力します。'
    : state === 'permission_required' || state === 'permission_denied' ? '中継スマホで Bluetooth の接続を許可してください。'
    : state === 'bluetooth_off' ? '中継スマホの Bluetooth をオンにしてください。'
    : state === 'not_selected' ? '中継スマホで使用する電子はかりを選んでください。'
    : state === 'unsupported_properties' ? 'この電子はかりの通信方法は未確認です。手入力を使用してください。'
    : ['connecting', 'bonding', 'discovering', 'subscribing'].includes(state || '') ? '電子はかりへの接続を確認しています。'
    : '電子はかりが未接続です。中継スマホで確認してください。';
  return <section className="store-relay-scale" aria-label="電子はかり">
    <strong>電子はかり</strong>
    {tareEnabled ? <fieldset className="store-relay-tare-presets"><legend>{t('ボウルのサイズ')}{!manualMode && tarePresetId === 'small' ? <small className="store-relay-tare-hint">{t('大きい場合は「大」を選択')}</small> : null}</legend>
      {props.tareSettings?.presets.map(p => <button key={p.id} type="button" className={tarePresetId === p.id ? 'primary-button' : 'secondary-button'}
        aria-pressed={tarePresetId === p.id} disabled={manualMode || !p.grams} onClick={() => props.onTarePresetChange?.(p.id)}>
        {t(p.id === 'small' ? '小' : '大')}{p.grams ? ` · ${p.grams} g` : ` · ${t('未設定')}`}
      </button>)}
    </fieldset> : null}
    <p role="status">{t(status)}</p>
    {s?.scale_reading ? <>
      <span>{s.scale_reading.grams} g · {t(s.scale_reading.overload ? '計量範囲を超えています。' : s.scale_reading.stable ? '安定' : '安定待ち')}</span>
      {s.scale_reading.filter?.source === 'software_window' ? <>
        <small>{t('ソフトウェア判定')} · {t(s.scale_reading.filter.accepted ? '安定' : '安定待ち')}</small>
        <details>
          <summary>{t('はかりの読取値')}</summary>
          <small>{t('はかり本体')} · {t(s.scale_reading.hardwareStable ? '安定' : '安定待ち')}</small>
          <small>{t('はかりの読取値')} {s.scale_reading.filter.rawGrams} g → {t('判定後の正味重量')} {s.scale_reading.grams} g</small>
        </details>
      </> : <small>{t('はかり本体の安定判定')}</small>}
    </> : null}
    {confirmed !== null && !manualMode ? <span>{confirmationReady ? '自動入力済み' : '前回の重量'} <strong>{confirmed} g</strong></span> : null}
    {measurement?.mode === 'preset' && !manualMode ? <small className="store-relay-tare-summary">
      {t(measurement.filter?.source === 'software_window' ? '判定後の総重量' : '総重量')} {measurement.grossGrams} g − {t(measurement.tarePresetId === 'small' ? 'ボウル（小）' : 'ボウル（大）')} {measurement.tareGrams} g ＝ {t('正味重量')} {measurement.netGrams} g
    </small> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="store-relay-scale-actions">
      <button type="button" className="secondary-button" onClick={() => onManualModeChange(!manualMode)}>{manualMode ? '自動読取に戻す' : '手入力に切り替える'}</button>
      {error ? <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>もう一度試す</button> : null}
    </div>
    <small>{tareEnabled ? t('ボウルの重さはシステムで差し引きます。はかりの風袋キーと自動風袋引きは使用しないでください。') : t('はかりで風袋引きした正味重量を使用します。手入力も利用できます。')}</small>
  </section>;
}
