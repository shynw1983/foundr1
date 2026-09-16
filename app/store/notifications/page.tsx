"use client";

import { BellRing, Check, MapPin, Settings, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { nativeOrderPush, type NativeOrderPushStatus } from "../../../lib/store-order-push-client";

type Rule = { storeId: string; storeName: string; key: string; enterRadius: number; exitRadius: number };
type Preference = { employeeId: string; employeeName: string; storeId: string; storeName: string; enabled: boolean; enterRadius: number; exitRadius: number; updatedAt: string };
type Data = {
  config: { enabled: boolean; fcm: boolean; firebase: Record<string, string> | null };
  ready: boolean; canManage: boolean; stores: Array<{ id: string; name: string }>;
  employees?: Array<{ id: string; name: string }>;
  preferences?: Preference[];
  rules: Rule[]; device: { id: string; lastSuccessAt: string | null; lastError: string; revokedAt: string | null; presence: Array<{ storeId: string; ruleKey: string; state: string }> } | null;
  alerts: Array<{ id: string; orderId: string; storeId: string; storeName: string; source: string; pickupCode: string; amount: number; createdAt: string; lastError: string }>;
};
const platforms: Record<string, string> = { uber_eats: "Uber Eats", rocket_now: "Rocket Now", demae_can: "出前館" };

export default function StoreNotificationsPage() {
  const { t, language } = useOsTranslation();
  const [data, setData] = useState<Data | null>(null);
  const [native, setNative] = useState<NativeOrderPushStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [employeeId, setEmployeeId] = useState(""), [storeId, setStoreId] = useState("");
  const [exitRadius, setExitRadius] = useState(500), [enterRadius, setEnterRadius] = useState(300), [enabled, setEnabled] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [ruleFeedback, setRuleFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const savingRuleRef = useRef(false), loadVersion = useRef(0), deviceIdRef = useRef("");
  const ruleFormRef = useRef<HTMLFormElement>(null);
  const load = useCallback(async (refreshNative = true) => {
    if (savingRuleRef.current) return;
    const version = ++loadVersion.current;
    if (refreshNative && window.Foundr1OrderPush) {
      try { const state = await nativeOrderPush("status"); setNative(state); deviceIdRef.current = state.deviceId; }
      catch { /* Account settings remain usable when the native bridge is unavailable. */ }
    }
    const deviceId = deviceIdRef.current;
    const response = await fetch(`/api/store/order-notifications?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "通知を取得できませんでした。");
    if (version === loadVersion.current && !savingRuleRef.current) setData(body);
  }, []);
  useEffect(() => {
    void load().catch((error: Error) => setError(error.message));
    const refresh = () => { if (!document.hidden) void load().catch((error: Error) => setError(error.message)); };
    const timer = setInterval(refresh, 15_000); document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => {
    if (!native?.alarmVersion) return;
    const timer = setInterval(() => {
      if (!document.hidden) void nativeOrderPush("status").then(setNative).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [native?.alarmVersion]);
  function selectRule(nextEmployeeId: string, nextStoreId: string) {
    setRuleFeedback(null); setEmployeeId(nextEmployeeId); setStoreId(nextStoreId);
    const rule = data?.preferences?.find((item) => item.employeeId === nextEmployeeId && item.storeId === nextStoreId);
    setEnabled(rule?.enabled ?? false); setExitRadius(rule?.exitRadius ?? 500); setEnterRadius(rule?.enterRadius ?? 300);
  }
  async function post(body: Record<string, unknown>) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/store/order-notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error || "通知設定を保存できませんでした。");
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("通信がタイムアウトしました。設定を再読み込みして保存結果を確認してください。");
      if (error instanceof TypeError) throw new Error("通信できませんでした。通信状態を確認し、設定を再読み込みしてください。");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); } catch (error) { setError(error instanceof Error ? error.message : "通知設定を確認してください。"); }
    finally { setBusy(false); }
  }
  async function saveRule() {
    if (savingRuleRef.current || busy) return;
    setRuleFeedback(null);
    const invalid = !employeeId || !storeId ? "ユーザーと店舗を選択してください。"
      : !Number.isInteger(exitRadius) || exitRadius < 150 || exitRadius > 10000 ? "離店距離は150〜10000mの整数で入力してください。"
      : !Number.isInteger(enterRadius) || enterRadius < 100 || enterRadius >= exitRadius ? "帰店距離は100m以上、離店距離より小さい整数で入力してください。" : "";
    if (invalid) { setRuleFeedback({ error: true, message: invalid }); return; }
    savingRuleRef.current = true; loadVersion.current++; setSavingRule(true); setBusy(true);
    try {
      const result = await post({ action: "save_rule", employeeId, storeId, enabled, exitRadius, enterRadius });
      const saved = result.preference as Preference | undefined;
      if (!saved || saved.employeeId !== employeeId || saved.storeId !== storeId) throw new Error("保存結果を確認できませんでした。設定を再読み込みしてください。");
      setData((current) => current ? { ...current, preferences: [saved, ...(current.preferences ?? []).filter((item) => item.employeeId !== saved.employeeId || item.storeId !== saved.storeId)] } : current);
      setRuleFeedback({ error: false, message: saved.enabled ? "保存しました。離店通知は有効です。" : "保存しました。離店通知は無効です。有効にする場合はチェックを入れて保存してください。" });
    } catch (error) {
      setRuleFeedback({ error: true, message: error instanceof Error ? error.message : "通知設定を保存できませんでした。" });
    } finally {
      savingRuleRef.current = false; setSavingRule(false); setBusy(false);
      void load(false).catch(() => {});
    }
  }
  async function enablePhone() {
    if (!data?.config.firebase) return;
    let state = await nativeOrderPush("status");
    if (!state.googlePlayAvailable) throw new Error("Google Play 開発者サービスを確認してください。");
    if (!state.notificationsAllowed) throw new Error("このアプリの通知を許可してください。");
    if (!state.locationAllowed || !state.locationEnabled) throw new Error("正確な位置情報を常に許可し、端末の位置情報をオンにしてください。");
    state = await nativeOrderPush("configure", { firebase: data.config.firebase });
    for (let i = 0; !state.token && !state.error && i < 20; i++) { await new Promise((resolve) => setTimeout(resolve, 1000)); state = await nativeOrderPush("status"); }
    if (!state.token) throw new Error("端末登録に失敗しました。通信状態を確認して再試行してください。");
    const binding = await post({ action: "register", deviceId: state.deviceId || crypto.randomUUID(), token: state.token, language });
    await nativeOrderPush("bind", { binding });
    setNotice("端末を登録しました。位置の判定と通知テストを確認してください。");
  }
  const available = Boolean(data?.ready && data.config.enabled && data.config.fcm);
  const registered = Boolean(native?.bound && data?.device && !data.device.revokedAt);
  const presentationReady = (native?.presentationVersion ?? 0) >= 2;
  const alarmReady = (native?.alarmVersion ?? 0) >= 1;
  const alarmIds = native?.alarmActiveIds ?? [];
  return <main className="store-workbench-shell">
    <header className="store-workbench-topbar"><a className="brand-block" href="/store"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>{t("離店中の注文通知")}</h1></div></a><StoreNavTabs active="notifications" /></header>
    <div className="store-phone-notifications">
      {error ? <p className="store-push-message is-error" role="alert">{t(error)}</p> : null}
      {notice ? <p className="store-push-message" role="status">{t(notice)}</p> : null}
      {!data ? <p>{t("読み込み中…")}</p> : <>
        <section className="store-push-section"><h2><Smartphone size={20} />{t("この端末の通知")}</h2>
          <p>{t(native?.alarmEnabled ? "離店中に新しい注文を受信すると、確認するまで端末で音と振動を繰り返します。注文のキャンセルやキッチンでの対応開始もオンライン時に反映します。" : "店舗から離れたときだけ、新しい配達注文を音と振動でお知らせします。初回通知後、未確認なら30秒ごとに最大3回追加通知します。")}</p>
          {!available ? <p className="store-push-message">{t("通知機能は準備中です。まだ離店中の通知は届きません。")}</p> : null}
          {!native ? <p className="store-push-message">{t("自動の離店判定は、対応する STORE Android アプリで利用できます。iPhone・ブラウザでは利用できません。")}</p> : <>
            <dl className="store-push-status">
              <div><dt>{t("通知の許可")}</dt><dd>{t(native.notificationsAllowed ? "許可済み" : "許可が必要です")}</dd></div>
              <div><dt>{t("通知音")}</dt><dd>{presentationReady ? native.soundName : t(native.soundEnabled ? "有効" : "設定を確認してください")}</dd></div>
              {presentationReady ? <>
                <div><dt>{t("バナー通知の優先度")}</dt><dd>{t(native.highImportance ? "高（端末側の表示許可も必要です）" : "通知カテゴリの設定を確認してください")}</dd></div>
                <div><dt>{t(native.alarmEnabled ? "端末のアラーム音量" : "端末の通知音量")}</dt><dd>{native.alarmEnabled ? `${native.alarmVolume} / ${native.alarmVolumeMax}` : native.notificationVolume != null && native.notificationVolume >= 0 ? `${native.notificationVolume} / ${native.notificationVolumeMax}` : t("未確認")}{!native.alarmEnabled && native.ringerNormal === false ? ` · ${t("マナーモード・サイレント")}` : ""}</dd></div>
              </> : null}
              <div><dt>{t("バックグラウンドの位置情報")}</dt><dd>{t(native.locationAllowed && native.locationEnabled ? "許可済み" : "常に許可が必要です")}</dd></div>
              <div><dt>{t("端末登録")}</dt><dd>{t(registered ? "登録済み" : "未登録")}</dd></div>
              <div><dt>{t("この端末で最後に受信")}</dt><dd>{native.lastReceivedAt ? new Date(native.lastReceivedAt).toLocaleString("ja-JP") : t("未確認")}</dd></div>
            </dl>
            {(native.error || native.geoError || native.syncError || data.device?.lastError) ? <p className="store-push-message is-error">{t("通知または位置の同期に失敗しています。設定と通信状態を確認してください。")}</p> : null}
            {presentationReady && !native.alarmEnabled && (!native.soundEnabled || native.notificationVolume === 0 || native.ringerNormal === false) ? <p className="store-push-message">{t("音が鳴らない設定です。通知音を選び、通知音量・マナーモード・通知カテゴリのサイレント設定を確認してください。")}</p> : null}
            {presentationReady && native.doNotDisturb ? <p className="store-push-message">{t("おやすみモードがオンです。音やバナーが制限される場合があります。")}</p> : null}
            {native.soundError ? <p className="store-push-message is-error">{t("通知音を保存できませんでした。もう一度選ぶか、通知カテゴリ設定で変更してください。")}</p> : null}
            {alarmReady ? <div className="store-push-alarm-settings">
              <h3>{t("確認まで繰り返すアラーム")}</h3>
              <label className="store-push-checkbox"><input type="checkbox" checked={Boolean(native.alarmEnabled)} disabled={busy} onChange={(event) => { const enabled = event.target.checked; void run(async () => { await nativeOrderPush("alarmConfigure", { enabled, tone: native.alarmTone ?? "urgent" }); }); }} />{t("確認するまで鳴り続ける（アラーム音量を使用）")}</label>
              <div className="store-push-fields">
                <label>{t("アラーム音")}<select value={native.alarmTone ?? "urgent"} disabled={busy} onChange={(event) => { const tone = event.target.value; void run(async () => { await nativeOrderPush("alarmConfigure", { enabled: Boolean(native.alarmEnabled), tone }); }); }}><option value="urgent">{t("急ぎの注文ベル")}</option><option value="pulse">{t("二音のアラート")}</option></select></label>
              </div>
              <div className="store-push-actions">
                <button className="secondary-button" disabled={busy || !native.alarmAllowed || alarmIds.length > 0} onClick={() => void run(async () => { await nativeOrderPush("alarmPreview"); })}>{t("10秒間試聴する")}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("alarmStopPreview"); })}>{t("試聴を停止")}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("soundSettings"); })}>{t("アラーム音量を設定")}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("alarmSettings"); })}>{t("連続アラームの通知設定")}</button>
              </div>
              {native.alarmPreview ? <p role="status">{t("試聴中です。10秒後に自動停止します。")}</p> : null}
              {native.alarmVolume === 0 || !native.alarmAllowed ? <p className="store-push-message is-error">{t("アラーム音量と、連続アラームの通知許可を確認してください。現在は音が鳴らない設定です。")}</p> : null}
              {native.alarmError ? <p className="store-push-message is-error">{t(native.alarmError === "ALARM_SYNC_OFFLINE" ? "注文状態を同期できていません。受信済みのアラームは継続します。確認ボタンでこの端末を停止できます。" : native.alarmError === "ALARM_ACK_REJECTED" ? "この端末の音は停止しましたが、確認結果を保存できませんでした。注文一覧で確認してください。" : native.alarmError === "ALARM_ACK_PENDING" ? "この端末の音は停止しました。確認結果の送信を再試行しています。" : "連続アラームを開始できませんでした。通知許可・アラーム音量・端末のバックグラウンド制限を確認し、試聴してください。")}</p> : null}
              {alarmIds.length ? <p><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("alarmAcknowledge", { eventIds: alarmIds }); setNotice("この端末のアラームを停止しました。確認結果は通信でき次第、他の端末にも反映します。"); })}>{t("{count}件を確認してアラームを停止", { count: alarmIds.length })}</button></p> : null}
              <p className="store-push-help">{t("アラームは端末内で繰り返すため、通知を一度受信すれば画面を閉じても継続します。オンライン時は約15秒ごとに注文状態を確認します。通知が届く前の通信切断、アプリの強制停止、おやすみモードや省電力制限では鳴らない場合があります。")}</p>
            </div> : <p className="store-push-help">{t("確認まで繰り返すアラームと専用の注文ベルは、最新の STORE アプリで利用できます。")}{" "}<a href="/downloads/store/latest.apk">{t("最新版をダウンロード")}</a></p>}
            {presentationReady ? <>
              <div className="store-push-actions">
                {!native.alarmEnabled ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("chooseSound"); })}>{t("通知音を選ぶ")}</button> : null}
                <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("settings"); })}>{t("アプリ全体の通知設定")}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("channelSettings"); })}>{t("注文通知のカテゴリ設定")}</button>
                <button className="secondary-button" disabled={busy || !native.notificationsAllowed} onClick={() => void run(async () => { await nativeOrderPush("preview"); setNotice("この端末にテスト通知を表示しました。音・振動・バナーを確認してください。配信テストとは別の端末内テストです。"); })}>{t("この端末で通知を試す")}</button>
              </div>
              <p className="store-push-help">{t("OPPOでは、アプリ全体の通知設定でバナー・ロック画面の表示を確認し、注文通知カテゴリでサイレントを解除してください。スイッチだけが表示される場合は、端末の設定アプリから STORE の通知管理を開いてください。")}</p>
              <p className="store-push-help">{t("バナーの実際の表示許可は端末側で設定します。優先度が高くても、端末の制限で表示されない場合があります。")}</p>
            </> : <p className="store-push-message">{t("通知音の選択・詳しい通知設定には STORE アプリの更新が必要です。")}{" "}<a href="/downloads/store/latest.apk">{t("最新版をダウンロード")}</a></p>}
            <div className="store-push-actions">
              <button className="primary-button" disabled={busy || !available || !data.rules.length} onClick={() => void run(enablePhone)}>{t(registered ? "この端末を再登録" : "この端末を登録")}</button>
              {!presentationReady ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("settings"); })}>{t("通知設定")}</button> : null}
              <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("locationSettings"); })}>{t("位置情報の設定")}</button>
              <button className="secondary-button" disabled={busy || !registered || !available} onClick={() => void run(async () => { await post({ action: "test", deviceId: native.deviceId }); setNotice("テスト通知を送信しました。端末で音と通知を確認してください。このテストは店内でも届きます。"); })}><BellRing size={16} />{t("通知テスト")}</button>
              {registered ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await post({ action: "disable_device", deviceId: native.deviceId }); await nativeOrderPush("disable"); })}>{t("この端末の通知を停止")}</button> : null}
            </div>
          </>}
          <p className="store-push-help">{t("位置情報は端末で判定し、移動経路は保存しません。通知音は端末の音量・おやすみモード設定に従います。離店・帰店の判定には数分かかる場合があります。")}</p>
        </section>
        <section className="store-push-section"><h2><MapPin size={20} />{t("このユーザーの対象店舗")}</h2>
          {!data.rules.length ? <p>{t("このユーザーには離店通知が設定されていません。")}</p> : data.rules.map((rule) => {
            const state = native?.presence.find((item) => item.storeId === rule.storeId && item.ruleKey === rule.key)?.state || "unknown";
            const synced = data.device?.presence?.some((item) => item.storeId === rule.storeId && item.ruleKey === rule.key && item.state === state);
            const active = registered && available && native?.locationAllowed && native.locationEnabled && native.notificationsAllowed && state === "outside" && synced;
            return <div className="store-push-rule" key={rule.storeId}><div><strong>{rule.storeName}</strong><p>{t("離店")}: {rule.exitRadius} m / {t("帰店")}: {rule.enterRadius} m</p></div><span className={`status-pill ${active ? "is-active" : ""}`}>{t(!registered ? "未登録" : active ? "店外・通知対象" : state === "inside" ? "店内・通知停止" : "位置・通知設定を確認中")}</span></div>;
          })}
          {registered ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("refresh"); })}>{t("位置を再確認")}</button> : null}
        </section>
        <section className="store-push-section"><h2><BellRing size={20} />{t("未確認の注文")}</h2>
          {!data.alerts.length ? <p>{t("未確認の注文通知はありません。")}</p> : data.alerts.map((alert) => <article className="store-push-order" key={alert.id} id={`event-${alert.id}`}>
            <div><strong>{alert.storeName} · {platforms[alert.source] || alert.source}</strong><p>{alert.pickupCode} / ¥{alert.amount.toLocaleString("ja-JP")}</p></div>
            <div className="store-push-actions"><a className="secondary-button" href={`/store/orders?storeId=${alert.storeId}&orderId=${alert.orderId}`}>{t("注文を見る")}</a><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await post({ action: "acknowledge", eventId: alert.id }); if (alarmReady) await nativeOrderPush("alarmAcknowledge", { eventIds: [alert.id] }); setNotice("確認しました。すべての端末への追加通知を停止します。"); })}><Check size={16} />{t("注文通知を確認済みにする")}</button></div>
          </article>)}
          <p className="store-push-help">{t("確認済みにしても、注文の制作・完了状態は変更しません。送信済みの通知が行き違いで届く場合があります。")}</p>
        </section>
        {data.canManage ? <section className="store-push-section"><h2><Settings size={20} />{t("対象ユーザーと距離")}</h2>
          <p>{t("指定したユーザーだけが離店通知を利用できます。設定変更後は、対象のスマートフォンでアプリを開いてください。")}</p>
          <form ref={ruleFormRef} noValidate aria-busy={savingRule} onSubmit={(event) => { event.preventDefault(); void saveRule(); }}>
            <div className="store-push-fields">
              <label>{t("ユーザー")}<select required disabled={busy} value={employeeId} onChange={(event) => selectRule(event.target.value, storeId)}><option value="">{t("選択してください")}</option>{data.employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <label>{t("店舗")}<select required disabled={busy} value={storeId} onChange={(event) => selectRule(employeeId, event.target.value)}><option value="">{t("選択してください")}</option>{data.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
              <label>{t("離店と判定する距離（m）")}<input type="number" min={150} max={10000} required disabled={busy} value={exitRadius} onChange={(event) => { setRuleFeedback(null); setExitRadius(Number(event.target.value)); }} /></label>
              <label>{t("帰店と判定する距離（m）")}<input type="number" min={100} max={exitRadius - 1} required disabled={busy} value={enterRadius} onChange={(event) => { setRuleFeedback(null); setEnterRadius(Number(event.target.value)); }} /></label>
            </div>
            <label className="store-push-checkbox"><input type="checkbox" disabled={busy} checked={enabled} onChange={(event) => { setRuleFeedback(null); setEnabled(event.target.checked); }} />{t("このユーザーの離店通知を有効にする")}</label>
            {ruleFeedback ? <p className={`store-push-message${ruleFeedback.error ? " is-error" : ""}`} role={ruleFeedback.error ? "alert" : "status"}>{t(ruleFeedback.message)}</p> : null}
            {!data.ready ? <p className="store-push-message">{t("通知機能は準備中です。まだ設定を保存できません。")}</p> : null}
            <button className="primary-button" disabled={busy || !data.ready}>{t(savingRule ? "保存中…" : "設定を保存")}</button>
          </form>
          <div className="store-push-saved-rules">
            <h3>{t("保存済みの通知設定")}</h3>
            {!data.preferences?.length ? <p className="store-push-help">{t("保存済みの通知設定はありません。")}</p> : data.preferences.map((preference) => <article className="store-push-rule" key={`${preference.employeeId}:${preference.storeId}`}>
              <div><strong>{preference.employeeName} · {preference.storeName}</strong><p>{t("離店")}: {preference.exitRadius} m / {t("帰店")}: {preference.enterRadius} m</p><p className="store-push-help">{t("最終保存")}: {new Date(preference.updatedAt).toLocaleString(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p></div>
              <div className="store-push-actions"><span className={`status-pill${preference.enabled ? " is-active" : ""}`}>{t(preference.enabled ? "通知オン" : "通知オフ")}</span><button className="secondary-button" type="button" disabled={busy || !data.employees?.some((item) => item.id === preference.employeeId) || !data.stores.some((item) => item.id === preference.storeId)} onClick={() => { selectRule(preference.employeeId, preference.storeId); ruleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); ruleFormRef.current?.querySelector("select")?.focus({ preventScroll: true }); }}>{t("編集")}</button></div>
            </article>)}
          </div>
        </section> : null}
      </>}
    </div>
  </main>;
}
