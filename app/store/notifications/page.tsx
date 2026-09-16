"use client";

import { BellRing, Check, MapPin, Settings, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { nativeOrderPush, type NativeOrderPushStatus } from "../../../lib/store-order-push-client";

type Rule = { storeId: string; storeName: string; key: string; enterRadius: number; exitRadius: number };
type Data = {
  config: { enabled: boolean; fcm: boolean; firebase: Record<string, string> | null };
  ready: boolean; canManage: boolean; stores: Array<{ id: string; name: string }>;
  employees?: Array<{ id: string; name: string }>;
  preferences?: Array<{ employeeId: string; storeId: string; enabled: boolean; enterRadius: number; exitRadius: number }>;
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
  const load = useCallback(async () => {
    let deviceId = "";
    if (window.Foundr1OrderPush) { const state = await nativeOrderPush("status"); setNative(state); deviceId = state.deviceId; }
    const response = await fetch(`/api/store/order-notifications?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "通知を取得できませんでした。");
    setData(body);
  }, []);
  useEffect(() => {
    void load().catch((error: Error) => setError(error.message));
    const refresh = () => { if (!document.hidden) void load().catch((error: Error) => setError(error.message)); };
    const timer = setInterval(refresh, 15_000); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  function selectRule(nextEmployeeId: string, nextStoreId: string) {
    setEmployeeId(nextEmployeeId); setStoreId(nextStoreId);
    const rule = data?.preferences?.find((item) => item.employeeId === nextEmployeeId && item.storeId === nextStoreId);
    setEnabled(rule?.enabled ?? false); setExitRadius(rule?.exitRadius ?? 500); setEnterRadius(rule?.enterRadius ?? 300);
  }
  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/store/order-notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "通知設定を保存できませんでした。");
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); } catch (error) { setError(error instanceof Error ? error.message : "通知設定を確認してください。"); }
    finally { setBusy(false); }
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
  return <main className="store-workbench-shell">
    <header className="store-workbench-topbar"><a className="brand-block" href="/store"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>{t("離店中の注文通知")}</h1></div></a><StoreNavTabs active="notifications" /></header>
    <div className="store-phone-notifications">
      {error ? <p className="store-push-message is-error" role="alert">{t(error)}</p> : null}
      {notice ? <p className="store-push-message" role="status">{t(notice)}</p> : null}
      {!data ? <p>{t("読み込み中…")}</p> : <>
        <section className="store-push-section"><h2><Smartphone size={20} />{t("この端末の通知")}</h2>
          <p>{t("店舗から離れたときだけ、新しい配達注文を音と振動でお知らせします。初回通知後、未確認なら30秒ごとに最大3回追加通知します。")}</p>
          {!available ? <p className="store-push-message">{t("通知機能は準備中です。まだ離店中の通知は届きません。")}</p> : null}
          {!native ? <p className="store-push-message">{t("自動の離店判定は、対応する STORE Android アプリで利用できます。iPhone・ブラウザでは利用できません。")}</p> : <>
            <dl className="store-push-status">
              <div><dt>{t("通知の許可")}</dt><dd>{t(native.notificationsAllowed ? "許可済み" : "許可が必要です")}</dd></div>
              <div><dt>{t("通知音")}</dt><dd>{t(native.soundEnabled ? "有効" : "設定を確認してください")}</dd></div>
              <div><dt>{t("バックグラウンドの位置情報")}</dt><dd>{t(native.locationAllowed && native.locationEnabled ? "許可済み" : "常に許可が必要です")}</dd></div>
              <div><dt>{t("端末登録")}</dt><dd>{t(registered ? "登録済み" : "未登録")}</dd></div>
              <div><dt>{t("この端末で最後に受信")}</dt><dd>{native.lastReceivedAt ? new Date(native.lastReceivedAt).toLocaleString("ja-JP") : t("未確認")}</dd></div>
            </dl>
            {(native.error || native.geoError || native.syncError || data.device?.lastError) ? <p className="store-push-message is-error">{t("通知または位置の同期に失敗しています。設定と通信状態を確認してください。")}</p> : null}
            <div className="store-push-actions">
              <button className="primary-button" disabled={busy || !available || !data.rules.length} onClick={() => void run(enablePhone)}>{t(registered ? "この端末を再登録" : "この端末を登録")}</button>
              <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await nativeOrderPush("settings"); })}>{t("通知設定")}</button>
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
            <div className="store-push-actions"><a className="secondary-button" href={`/store/orders?storeId=${alert.storeId}&orderId=${alert.orderId}`}>{t("注文を見る")}</a><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await post({ action: "acknowledge", eventId: alert.id }); setNotice("確認しました。すべての端末への追加通知を停止します。"); })}><Check size={16} />{t("注文通知を確認済みにする")}</button></div>
          </article>)}
          <p className="store-push-help">{t("確認済みにしても、注文の制作・完了状態は変更しません。送信済みの通知が行き違いで届く場合があります。")}</p>
        </section>
        {data.canManage ? <section className="store-push-section"><h2><Settings size={20} />{t("対象ユーザーと距離")}</h2>
          <p>{t("指定したユーザーだけが離店通知を利用できます。設定変更後は、対象のスマートフォンでアプリを開いてください。")}</p>
          <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await post({ action: "save_rule", employeeId, storeId, enabled, exitRadius, enterRadius }); setNotice("通知設定を保存しました。"); }); }}>
            <div className="store-push-fields">
              <label>{t("ユーザー")}<select required value={employeeId} onChange={(event) => selectRule(event.target.value, storeId)}><option value="">{t("選択してください")}</option>{data.employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <label>{t("店舗")}<select required value={storeId} onChange={(event) => selectRule(employeeId, event.target.value)}><option value="">{t("選択してください")}</option>{data.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
              <label>{t("離店と判定する距離（m）")}<input type="number" min={150} max={10000} required value={exitRadius} onChange={(event) => setExitRadius(Number(event.target.value))} /></label>
              <label>{t("帰店と判定する距離（m）")}<input type="number" min={100} max={exitRadius - 1} required value={enterRadius} onChange={(event) => setEnterRadius(Number(event.target.value))} /></label>
            </div>
            <label className="store-push-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{t("このユーザーの離店通知を有効にする")}</label>
            <button className="primary-button" disabled={busy || !data.ready || !employeeId || !storeId}>{t("設定を保存")}</button>
          </form>
        </section> : null}
      </>}
    </div>
  </main>;
}
