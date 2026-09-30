"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Blinds, Lightbulb, LockKeyhole, LockKeyholeOpen, Power, Radio, RefreshCw, Thermometer, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { deviceCommandLeaseMs, deviceCommandSkipped, deviceObservation, deviceObservationDelays, deviceStateLabel, type DeviceAction, type DeviceCommand, type StoreDevice, type StoreDevicesView } from "../../../lib/store-device-state";
import { StoreScenesPanel } from "./StoreScenesPanel";

const labels: Record<DeviceAction, string> = { press: "スイッチを押す", turnOn: "オンにする", turnOff: "オフにする", setPosition: "位置を指定", lock: "施錠する", unlock: "解錠する", deadbolt: "ラッチを解除する" };
const issueLabels: Record<string, string> = { sensor_unavailable: "測定値を確認できません。電池と接続を確認してください。", cloud_disabled: "SwitchBotアプリでクラウドサービスを有効にしてください。", status_unsupported: "この機器の状態取得には対応していません。", not_calibrated: "SwitchBotアプリで位置を校正してください。", door_not_closed: "ドアを閉めてから施錠してください。", lock_unavailable: "ドアとロックの状態を現地で確認してください。", unsupported_mode: "スイッチの動作モードを確認してください。",
  api_151: "機器の種類が一致しません（151）。設定を確認してください。", api_152: "機器が見つかりません（152）。設定を確認してください。", api_160: "機器がこの操作に対応していません（160）。", api_161: "機器がオフラインです（161）。電池と接続を確認してください。", api_171: "Hubがオフラインです（171）。接続を確認してください。", api_190: "機器が操作を受け付けませんでした（190）。SwitchBotアプリで接続・状態と操作設定を確認してください。" };
type Intent = { device: StoreDevice; action: DeviceAction; position?: number };
type Observation = { id: string; timers: ReturnType<typeof setTimeout>[] };

export function StoreDevicesPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { t, language } = useOsTranslation();
  const [view, setView] = useState<StoreDevicesView | null>(null);
  const [error, setError] = useState("");
  const [allBusy, setAllBusy] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [intent, setIntent] = useState<Intent | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [sortOrder, setSortOrder] = useState<string[] | null>(null);
  const [sortSaving, setSortSaving] = useState(false);
  const [sortError, setSortError] = useState("");
  const [sortNotice, setSortNotice] = useState("");
  const [sceneRunning, setSceneRunning] = useState(false);
  const savingOrder = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(true), generation = useRef(0), allReading = useRef(false), sending = useRef(false), preparing = useRef(false);
  const busyKeys = useRef(new Set<string>()), versions = useRef(new Map<string, number>());
  const controllers = useRef(new Set<AbortController>()), observations = useRef(new Map<string, Observation>());
  const dialog = useRef<HTMLDialogElement>(null);

  const request = useCallback(async (key?: string) => {
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch(`/api/store/devices?storeId=${encodeURIComponent(storeId)}${key ? `&device=${encodeURIComponent(key)}` : ""}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "機器の状態を取得できません。時間をおいて更新してください。");
      return body as StoreDevicesView;
    } finally { controllers.current.delete(controller); }
  }, [storeId]);
  const clearObservation = useCallback((key: string) => {
    observations.current.get(key)?.timers.forEach(clearTimeout); observations.current.delete(key);
  }, []);
  const refreshAll = useCallback(async () => {
    if (allReading.current || busyKeys.current.size || sending.current) return;
    allReading.current = true; setAllBusy(true); const gen = generation.current;
    try {
      const body = await request();
      if (active.current && gen === generation.current) { setView(body); setError(""); setErrors({}); }
    } catch {
      if (active.current && gen === generation.current) setError("機器の状態を取得できません。時間をおいて更新してください。");
    } finally { if (gen === generation.current) { allReading.current = false; if (active.current) setAllBusy(false); } }
  }, [request]);

  useEffect(() => {
    active.current = true; void refreshAll();
    return () => {
      active.current = false; generation.current++; allReading.current = false;
      controllers.current.forEach(c => c.abort()); controllers.current.clear();
      observations.current.forEach(o => o.timers.forEach(clearTimeout)); observations.current.clear();
    };
  }, [refreshAll]);
  const ticking = Boolean(view?.devices.some(d => d.blockedUntil && Date.parse(d.blockedUntil) > now || d.command && deviceObservation(d, now) === "waiting"));
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000); // Local countdown only. No network polling.
    return () => window.clearInterval(timer);
  }, [ticking]);
  useEffect(() => {
    if (intent && !dialog.current?.open) dialog.current?.showModal();
    if (!intent && dialog.current?.open) dialog.current.close();
  }, [intent]);

  async function refreshOne(key: string, verification = false): Promise<StoreDevice | null> {
    if (busyKeys.current.has(key) || allReading.current) return null;
    busyKeys.current.add(key); if (!verification) setBusy(b => ({ ...b, [key]: true }));
    const version = versions.current.get(key) || 0, gen = generation.current;
    try {
      const device = (await request(key)).devices[0];
      if (!device || !active.current || gen !== generation.current || version !== (versions.current.get(key) || 0)) return null;
      setView(v => v ? { ...v, devices: v.devices.map(d => d.key === key ? device : d) } : v);
      setErrors(e => ({ ...e, [key]: device.readError ? issueLabels[device.issue] || "機器の状態を取得できません。時間をおいて更新してください。" : "" }));
      return device;
    } catch {
      if (active.current && gen === generation.current && version === (versions.current.get(key) || 0)) setErrors(e => ({ ...e, [key]: "機器の状態を取得できません。時間をおいて更新してください。" }));
      return null;
    } finally {
      busyKeys.current.delete(key); if (active.current) setBusy(b => ({ ...b, [key]: false }));
    }
  }
  async function prepare(device: StoreDevice, action: DeviceAction, position?: number) {
    if (sending.current || preparing.current || intent || sceneRunning) return;
    preparing.current = true;
    try {
      const fresh = await refreshOne(device.key);
      if (!fresh || fresh.readError) return;
      if (!fresh.controlEnabled || !fresh.actions.includes(action)) { setErrors(e => ({ ...e, [device.key]: "この機器では実行できない操作です。" })); return; }
      if (fresh.blockedUntil && Date.parse(fresh.blockedUntil) > Date.now()) return;
      setAcknowledged(false); setIntent({ device: fresh, action, position });
    } finally { preparing.current = false; }
  }
  function observe(key: string, command: DeviceCommand) {
    if (command.result === "rejected" || command.reason === "already_in_state") return;
    const observation: Observation = { id: command.id, timers: [] }; observations.current.set(key, observation);
    for (const delay of deviceObservationDelays) observation.timers.push(setTimeout(async () => {
      if (!active.current || document.hidden || observations.current.get(key)?.id !== command.id) return;
      const fresh = await refreshOne(key, true);
      if (fresh && (fresh.command?.id !== command.id || deviceObservation(fresh) === "observed")) clearObservation(key);
    }, delay));
  }
  async function execute() {
    if (!intent || sending.current || busyKeys.current.has(intent.device.key) || sceneRunning) return;
    const { device, action, position } = intent;
    if ((action === "unlock" || action === "deadbolt") && !acknowledged) return;
    sending.current = true; busyKeys.current.add(device.key); setBusy(b => ({ ...b, [device.key]: true })); setIntent(null);
    clearObservation(device.key); versions.current.set(device.key, (versions.current.get(device.key) || 0) + 1);
    const requestId = crypto.randomUUID(), requestedAt = new Date().toISOString();
    let command: DeviceCommand = { id: requestId, action, parameter: action === "setPosition" ? String(position) : "default", result: "unknown", requestedAt, finishedAt: null, before: device.sample, reason: "response_lost" };
    let blockedUntil = new Date(Date.now() + deviceCommandLeaseMs).toISOString();
    try {
      const response = await fetch("/api/store/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, device: device.key, action, position, requestId, confirmed: true }), signal: AbortSignal.timeout(35_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作結果を確認できません。再操作せず、状態を更新してください。");
      command = body.command; blockedUntil = body.blockedUntil;
      if (active.current) setErrors(e => ({ ...e, [device.key]: command.result === "rejected" ? issueLabels[command.reason] || "操作を送信できませんでした。接続と機器の設定を確認してください。" : command.result === "unknown" ? "操作結果を確認できません。再操作せず、状態を更新してください。" : "" }));
    } catch {
      if (active.current) setErrors(e => ({ ...e, [device.key]: "操作結果を確認できません。再操作せず、状態を更新してください。" }));
    } finally {
      sending.current = false; busyKeys.current.delete(device.key);
      if (active.current) {
        setNow(Date.now()); setBusy(b => ({ ...b, [device.key]: false }));
        setView(v => v ? { ...v, devices: v.devices.map(d => d.key === device.key ? { ...d, ...(command.reason === "already_in_state" ? { sample: command.before, fetchedAt: command.finishedAt, readError: false, issue: "" } : {}), command, blockedUntil } : d) } : v);
        observe(device.key, command);
      }
    }
  }
  function moveDevice(index: number, direction: number) {
    setSortOrder(order => {
      if (!order || index + direction < 0 || index + direction >= order.length) return order;
      const next = [...order]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next;
    });
  }
  async function saveOrder() {
    if (!sortOrder || savingOrder.current) return;
    savingOrder.current = true; setSortSaving(true); setSortError("");
    const gen = generation.current, controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch("/api/store/devices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, order: sortOrder }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "並び順を保存できません。もう一度お試しください。");
      if (active.current && gen === generation.current) {
        const ranks = new Map<string, number>((body.order as string[]).map((key, index) => [key, index]));
        setView(v => v ? { ...v, devices: [...v.devices].sort((a, b) => (ranks.get(a.key) ?? ranks.size) - (ranks.get(b.key) ?? ranks.size)) } : v);
        setSortOrder(null); setSortNotice("並び順を保存しました。");
      }
    } catch (error) {
      if (active.current && gen === generation.current) setSortError(error instanceof Error && error.message === "機器の一覧が変わりました。更新してから並び替えてください。" ? error.message : "並び順を保存できません。もう一度お試しください。");
    } finally { controllers.current.delete(controller); savingOrder.current = false; if (active.current && gen === generation.current) setSortSaving(false); }
  }
  const time = (value: string | null) => value ? new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(value)) : "—";
  const actionName = (action: DeviceAction, position?: number) => action === "setPosition" ? position === 0 ? t("全開にする") : position === 100 ? t("全閉にする") : `${t("閉じる割合")} ${position}%` : t(labels[action]);
  return <section className="store-devices-panel" data-i18n-ignore>
    <div className="store-devices-toolbar"><div><h2>{storeName} <span>{t("店舗設備")}</span></h2><p>{t("必要なときだけ状態を取得します。定期的な自動更新は行いません。")}</p></div><div className="store-devices-toolbar-actions">
      {!sortOrder && view?.configured && view.devices.length > 1 && <button className="secondary-button store-device-sort-start" disabled={sceneRunning || allBusy || Object.values(busy).some(Boolean)} onClick={() => { setSortOrder(view.devices.map(d => d.key)); setSortError(""); setSortNotice(""); }}><ArrowUpDown size={16}/>{t("並び順を変更")}</button>}
      <button className="secondary-button store-device-refresh-all" onClick={() => void refreshAll()} disabled={Boolean(sortOrder) || allBusy || Object.values(busy).some(Boolean)}><RefreshCw size={16}/>{t(allBusy ? "更新中" : "すべて更新")}</button></div></div>
    {error && <p className="store-device-notice is-error" role="alert">{t(error)}</p>}
    {sortNotice && <p className="store-device-notice is-success" role="status">{t(sortNotice)}</p>}
    {view?.configured && !sortOrder && <StoreScenesPanel storeId={storeId} storeName={storeName} devices={view.devices} disabled={allBusy || Object.values(busy).some(Boolean) || Boolean(intent)} onRunningChange={setSceneRunning} onFinished={refreshAll}/>}
    {!view ? <p role="status">{t("機器を読み込んでいます。")}</p> : !view.configured ? <p className="store-device-empty">{t("この店舗の機器は未設定です。")}</p> : !view.devices.length ? <p className="store-device-empty">{t("この店舗の機器が見つかりません。")}</p> : sortOrder ? <div className="store-device-sort">
      <p>{t("店舗の端末で同じ順番を使います。")}</p>
      <ol className="store-device-sort-list">{sortOrder.map((key, index) => { const device = view.devices.find(d => d.key === key); if (!device) return null; return <li key={key} data-sort-key={key}>
        <span className="store-device-sort-number">{index + 1}</span><div className="store-device-sort-name">{t(device.name)}<small>{device.type}</small></div>
        <div className="store-device-sort-buttons"><button className="secondary-button" aria-label={`${t(device.name)} ${t("上へ")}`} disabled={sortSaving || index === 0} onClick={() => moveDevice(index, -1)}><ArrowUp size={16}/></button><button className="secondary-button" aria-label={`${t(device.name)} ${t("下へ")}`} disabled={sortSaving || index === sortOrder.length - 1} onClick={() => moveDevice(index, 1)}><ArrowDown size={16}/></button></div>
      </li>; })}</ol>
      {sortError && <p className="store-device-notice is-error" role="alert">{t(sortError)}</p>}
      <div className="store-device-sort-footer"><button className="secondary-button" disabled={sortSaving} onClick={() => setSortOrder(null)}>{t("キャンセル")}</button><button className="primary-button" disabled={sortSaving} onClick={() => void saveOrder()}>{t(sortSaving ? "保存中" : "並び順を保存")}</button></div>
    </div> : <div className="store-device-grid">{view.devices.map(device => {
      const s = device.sample, cooldown = device.blockedUntil ? Math.max(0, Math.ceil((Date.parse(device.blockedUntil) - now) / 1000)) : 0;
      const observation = deviceObservation(device, now), position = positions[device.key] ?? s?.position ?? 50;
      const commandError = device.command?.result === "rejected" ? issueLabels[device.command.reason] || "操作を送信できませんでした。接続と機器の設定を確認してください。" : "";
      const deviceError = errors[device.key] || (device.issue && device.issue !== "status_unsupported" ? issueLabels[device.issue] || "機器の状態を取得できません。時間をおいて更新してください。" : commandError);
      const Icon = device.kind === "lock" ? LockKeyhole : device.kind === "shade" ? Blinds : device.kind === "indoorLight" || device.kind === "bot" || device.kind === "plug" ? Lightbulb : device.kind === "meter" || device.kind === "hub" ? Thermometer : Radio;
      const awaitingReading = device.command && device.command.result !== "rejected" && !deviceCommandSkipped(device.command) && (!device.fetchedAt || Date.parse(device.fetchedAt) < Date.parse(device.command.finishedAt || device.command.requestedAt) + 4_000);
      const lockState = !device.readError && !awaitingReading && observation !== "waiting" ? s?.lockState : undefined;
      const primaryLockAction = lockState === "locked" ? "unlock" : lockState === "unlocked" ? "lock" : null;
      const power = !device.readError && !awaitingReading && observation !== "waiting" ? s?.power : undefined;
      const primaryPowerAction = power === "on" ? "turnOff" : power === "off" ? "turnOn" : null;
      const disabled = sceneRunning || allBusy || busy[device.key] || !device.controlEnabled || cooldown > 0;
      return <article className="store-device-card" key={device.key} data-device-kind={device.kind} data-device-key={device.key}>
        <header><div><Icon size={20}/><h3>{t(device.name)}</h3></div><span>{device.type}</span></header>
        <p className="store-device-state">{t(awaitingReading ? "操作後の状態を確認中" : device.kind === "remote" || device.kind === "unsupported" ? "状態取得非対応" : deviceStateLabel(device))}</p>
        <p className="store-device-read-time">{t("最後に取得した状態")} · {time(device.fetchedAt)}</p>
        {s && <dl className="store-device-metrics">
          {s.lightLevel != null && <div><dt>{t("明るさレベル")}</dt><dd>{s.lightLevel}<small> / 20</small></dd></div>}
          {s.position != null && <div><dt>{t("閉じる割合")}</dt><dd>{s.position}%</dd></div>}
          {s.temperature != null && <div><dt>{t("温度")}</dt><dd>{s.temperature}°C</dd></div>}
          {s.humidity != null && <div><dt>{t("湿度")}</dt><dd>{s.humidity}%</dd></div>}
          {s.battery != null && <div><dt>{t("電池")}</dt><dd className={s.battery <= 20 ? "is-low" : ""}>{s.battery}%</dd></div>}
          {s.doorState && <div><dt>{t("ドア")}</dt><dd>{t(s.doorState === "closed" ? "閉じています" : s.doorState === "open" ? "開いています" : "不明")}</dd></div>}
        </dl>}
        {device.kind === "indoorLight" && <p className="store-device-help">{t("照度からの推定です。1–3は消灯、10–20は点灯、4–9は判定保留です。")}</p>}
        {device.kind === "bot" && s?.botMode === "pressMode" && <p className="store-device-help">{t("ボタンを1回押します。屋内の明るさでは点灯状態を判断しません。")}</p>}
        {device.kind === "keypad" && <p className="store-device-help">{t("解錠・施錠はロックのカードから操作できます。暗証番号の管理はSwitchBotアプリで行ってください。")}</p>}
        {device.kind === "remote" && <p className="store-device-help">{t("リモートボタンには遠隔操作の機能がありません。")}</p>}
        {deviceError && <p role="alert" className="store-device-notice is-error">{t(deviceError)}</p>}
        {device.command && <p className={`store-device-notice${observation === "observed" && !deviceCommandSkipped(device.command) ? " is-success" : ""}`} role="status">{t(device.command.reason === "already_in_state" ? "取得した状態がすでに指定状態だったため、操作を送信していません。" : deviceCommandSkipped(device.command) ? "照度を確認し、スイッチの操作をスキップしました。" : observation === "observed" ? "操作後の状態を確認しました。" : observation === "rejected" ? "操作は実行されませんでした。" : observation === "waiting" ? "操作後の状態を確認しています。" : "操作後の状態は未確認です。必要に応じて更新してください。")}</p>}
        {device.kind === "shade" && device.actions.length > 0 && <label className="store-device-position">{t("閉じる割合")} <output>{position}%</output><input type="range" min="0" max="100" value={position} disabled={disabled} onChange={e => setPositions(p => ({ ...p, [device.key]: Number(e.target.value) }))}/></label>}
        <div className="store-device-actions">{device.actions.flatMap(action => {
          if (action === "setPosition") return [0, 100, position].map((p, i) => <button key={i} className={i === 2 ? "primary-button" : "secondary-button"} disabled={disabled} onClick={() => void prepare(device, action, p)}>{i === 2 ? t("位置を適用") : actionName(action, p)}</button>);
          const isLockAction = action === "lock" || action === "unlock";
          const primary = isLockAction ? action === primaryLockAction : device.kind === "plug" ? action === primaryPowerAction : action !== "deadbolt";
          return <button key={action} data-device-action={action} className={primary ? "primary-button" : "secondary-button"} disabled={disabled} onClick={() => void prepare(device, action)}>
            {action === "lock" ? <LockKeyhole size={16} aria-hidden="true"/> : action === "unlock" ? <LockKeyholeOpen size={16} aria-hidden="true"/> : device.kind === "plug" ? <Power size={16} aria-hidden="true"/> : null}{actionName(action)}
          </button>;
        })}
          {device.kind !== "remote" && device.kind !== "unsupported" && <button className="store-device-refresh" disabled={allBusy || busy[device.key]} onClick={() => void refreshOne(device.key)}><RefreshCw size={14}/>{t("状態を更新")}</button>}
        </div>
        {busy[device.key] ? <p className="store-device-help" role="status">{t("状態確認・操作を処理しています。")}</p> : cooldown > 0 ? <p className="store-device-help" role="status">{t("次の操作まで")} {cooldown} {t("秒")}</p> : device.actions.length > 0 ? <p className="store-device-help">{t("操作前に最新の状態を確認します。")}</p> : null}
      </article>;
    })}</div>}
    <dialog ref={dialog} className="store-device-dialog" onCancel={() => setIntent(null)} onClose={() => setIntent(null)} aria-labelledby="device-confirm-title">
      {intent && <><div className="store-device-dialog-title"><h2 id="device-confirm-title">{t("機器の操作を確認")}</h2><button aria-label={t("閉じる")} onClick={() => setIntent(null)}><X size={20}/></button></div>
        <p className="store-device-dialog-name">{t(intent.device.name)}</p><p>{t("確認した状態")}: {t(deviceStateLabel(intent.device))} · {time(intent.device.fetchedAt)}</p>
        <p>{actionName(intent.action, intent.position)}</p>
        {intent.action === "press" && <p>{t("スイッチを1回だけ押します。照明の状態が不明な場合は現地で確認してください。")}</p>}
        {(intent.action === "unlock" || intent.action === "deadbolt") && <label className="store-device-confirm-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/><span>{t("ドアを開けられる状態になります。現地の安全を確認しました。")}</span></label>}
        <div className="store-device-dialog-actions"><button className="secondary-button" autoFocus onClick={() => setIntent(null)}>{t("キャンセル")}</button><button className="primary-button" disabled={(intent.action === "unlock" || intent.action === "deadbolt") && !acknowledged} onClick={() => void execute()}>{t("確認して実行")}</button></div>
      </>}
    </dialog>
  </section>;
}
