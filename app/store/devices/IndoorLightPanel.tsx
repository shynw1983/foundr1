"use client";

import { Lightbulb, RefreshCw, Sun, ToggleLeft, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { estimateIndoorLight, lightCommandCooldownMs, lightCommandObservation, type IndoorLightView, type LightCommand } from "../../../lib/store-light-state";

const stateLabels = { on: "点灯（推定）", off: "消灯（推定）", unknown: "状態を判定できません" };
const observationLabels = {
  none: "",
  waiting: "操作後の明るさを確認しています。続けて押さずにお待ちください。",
  changed: "操作後に明るさの変化を確認しました。表示は明るさからの推定です。",
  rejected: "操作を送信できませんでした。接続と機器の設定を確認してください。",
  unconfirmed: "操作後の変化を確認できません。現地で照明を確認してください。"
};

export function IndoorLightPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { t, language } = useOsTranslation();
  const [view, setView] = useState<IndoorLightView | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = useRef(true);
  const reading = useRef(false);
  const writing = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    reading.current = true;
    const current = generation.current;
    const controller = new AbortController();
    readController.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/store/indoor-light?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "照明の状態を取得できません。時間をおいて更新してください。");
      if (active.current && current === generation.current) { setView(body); setError(""); }
    } catch {
      if (active.current && current === generation.current) setError("照明の状態を取得できません。時間をおいて更新してください。");
    } finally {
      if (current === generation.current) {
        reading.current = false;
        if (active.current) setRefreshing(false);
      }
    }
  }, [storeId]);

  useEffect(() => {
    active.current = true;
    void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active.current = false; generation.current++; readController.current?.abort(); reading.current = false; window.clearInterval(clock); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const recentlyPressed = Boolean(view?.command && now-Date.parse(view.command.requestedAt)<lightCommandCooldownMs);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, recentlyPressed ? 6_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, recentlyPressed]);

  useEffect(() => {
    if (confirming && !dialog.current?.open) dialog.current?.showModal();
    if (!confirming && dialog.current?.open) dialog.current.close();
  }, [confirming]);

  const stale = !view?.fetchedAt || now-Date.parse(view.fetchedAt)>120_000;
  const estimate = !view || error || view.readError || stale || view.estimate === "unknown" ? "unknown" : estimateIndoorLight(view.sample?.lightLevel, view.fetchedAt, now);
  const cooldown = view?.blockedUntil ? Math.max(0, Math.ceil((Date.parse(view.blockedUntil)-now)/1000)) : 0;
  const canPress = Boolean(view?.canPress && !error && !stale && !cooldown && !sending && !refreshing);
  const observation = view ? lightCommandObservation(view, now) : "none";

  async function press() {
    if (writing.current || reading.current || !canPress) return;
    writing.current = true;
    generation.current++;
    setSending(true);
    setConfirming(false);
    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    let command: LightCommand = { id: requestId, requestedAt, finishedAt: null, result: "unknown", beforeState: estimate, reason: "response_lost" };
    try {
      const response = await fetch("/api/store/indoor-light", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, requestId, action: "press" }), signal: AbortSignal.timeout(25_000)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作結果を確認できません。再操作せず、状態を更新してください。");
      command = body.command;
      if (active.current) setError("");
    } catch (error) {
      if (active.current) setError(error instanceof Error && error.name === "Error" ? error.message : "操作結果を確認できません。再操作せず、状態を更新してください。");
    } finally {
      writing.current = false;
      if (active.current) {
        setView(previous => previous ? { ...previous, command, estimate: "unknown", canPress: false, blockedUntil: new Date(Date.parse(command.requestedAt)+lightCommandCooldownMs).toISOString() } : previous);
        setSending(false);
      }
    }
  }

  const time = view?.fetchedAt ? new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(view.fetchedAt)) : "—";
  return (
    <section className="store-light-panel" data-i18n-ignore>
      <div className="store-light-toolbar"><p>{storeName}<span>{t("店舗設備")}</span></p><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={refreshing || sending}><RefreshCw size={16} />{t(refreshing ? "更新中" : "状態を更新")}</button></div>
      {error ? <p className="store-light-notice is-error" role="alert">{t(error)}</p> : null}
      {!view ? <p className="store-light-loading" role="status">{t("照明の状態を読み込んでいます。")}</p> : !view.configured ? (
        <div className="store-light-empty"><Lightbulb size={26} /><h2>{t("この店舗の照明は未設定です。")}</h2><p>{t("接続設定が完了すると、ここから室内照明を操作できます。")}</p></div>
      ) : <>
        <article className="store-light-device">
          <div className="store-light-device-header"><div><Lightbulb size={22} /><h2>{t("室内照明")}</h2></div><span className="store-light-source">{t("明るさセンサーで推定")}</span></div>
          <div className={`store-light-main is-${estimate}`}>
            <p className="store-light-state" role="status">{t(sending ? "操作を送信しています。" : stateLabels[estimate])}</p>
            <p className="store-light-explanation">{t("室内の明るさから判断します。日差しや他の照明で変わる場合があります。")}</p>
          </div>
          <div className="store-light-meter">
            <div className="store-light-meter-heading"><span><Sun size={16} />{t("明るさレベル")}</span><strong>{view.readError || stale || error ? "—" : view.sample?.lightLevel ?? "—"}<small> / 20</small></strong></div>
            <div className="store-light-scale" aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} data-zone={index < 3 ? "off" : index < 9 ? "unknown" : "on"} data-current={!view.readError && !stale && !error && view.sample?.lightLevel === index+1} />)}</div>
            <div className="store-light-scale-labels"><span>{t("1–3：消灯の目安")}</span><span>{t("4–9：判定保留")}</span><span>{t("10–20：点灯の目安")}</span></div>
          </div>
          <dl className="store-light-details"><div><dt>{t("取得時刻")}</dt><dd>{time}</dd></div><div><dt>{t("スイッチの電池")}</dt><dd>{view.sample?.battery === null || view.sample?.battery === undefined ? "—" : `${view.sample.battery}%`}</dd></div></dl>
          {view.readError || stale ? <p className="store-light-notice">{t("明るさを取得できていません。接続を確認して状態を更新してください。")}</p> : null}
          {!view.controlEnabled ? <p className="store-light-notice">{t("照明の操作はまだ有効になっていません。")}</p> : view.sample && view.sample.botMode !== "pressMode" ? <p className="store-light-notice">{t("スイッチのモードが変わっています。設定を確認してください。")}</p> : null}
          {view.sample?.battery !== null && view.sample?.battery !== undefined && view.sample.battery < 20 ? <p className="store-light-notice">{t("スイッチの電池残量が少なくなっています。")}</p> : null}
          {observation !== "none" ? <p className={`store-light-notice ${observation === "changed" ? "is-success" : ""}`} role="status">{t(observationLabels[observation])}</p> : null}
          <div className="store-light-actions"><div><p>{t("スイッチを1回押して、点灯・消灯を切り替えます。")}</p><span>{cooldown ? t("次の操作まで {seconds} 秒", { seconds: cooldown }) : t("実行前に確認画面が表示されます。")}</span></div><button type="button" className="primary-button" onClick={() => setConfirming(true)} disabled={!canPress}><ToggleLeft size={19} />{t(sending ? "送信中" : "照明を切り替える")}</button></div>
        </article>
        <p className="store-light-calibration">{t("判定基準は昼間の実測値（消灯 2／点灯 12）による暫定値です。")}</p>
      </>}
      <dialog ref={dialog} className="store-light-dialog" onCancel={() => setConfirming(false)} onClose={() => setConfirming(false)} aria-labelledby="light-confirm-title">
        <button className="store-light-dialog-close" type="button" aria-label={t("閉じる")} onClick={() => setConfirming(false)}><X size={20} /></button>
        <h2 id="light-confirm-title">{t("室内照明を切り替えますか？")}</h2><p className="store-light-confirm-store">{storeName}</p>
        <p>{t(stateLabels[estimate])}</p><p>{t("スイッチを1回押します。送信後は明るさの変化を確認してください。")}</p>
        {estimate === "unknown" ? <p className="store-light-notice">{t("現在の点灯状態は不明です。現地で状態を確認してから操作してください。")}</p> : null}
        <div className="store-light-dialog-actions"><button className="secondary-button" type="button" autoFocus onClick={() => setConfirming(false)}>{t("キャンセル")}</button><button className="primary-button" type="button" onClick={() => void press()} disabled={!canPress}>{t("1回押して切り替える")}</button></div>
      </dialog>
    </section>
  );
}
