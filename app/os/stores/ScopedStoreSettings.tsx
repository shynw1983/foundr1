"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { canonicalNavItems, OsNavList } from "../components/OsNavList";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { UserBadge } from "../components/UserBadge";
import { BusinessHoursEditor } from "./BusinessHoursEditor";
import { StoreTemporaryClosures } from "./StoreTemporaryClosures";
import { payrollPrefectures, type ScopedStoreSettingsInput, type StorePayrollSettings } from "../../../lib/store-settings-policy";
import styles from "./scoped-settings.module.css";

type Settings = ScopedStoreSettingsInput & { id: string; name: string };

export function ScopedStoreSettings() {
  const { t } = useOsTranslation();
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [stores, setStores] = useState<Settings[]>([]);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closureSaving, setClosureSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/stores/scoped-settings", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "店舗設定を読み込めませんでした。");
      if (controller.signal.aborted) return;
      setStores(body.stores ?? []);
      setDraft(body.stores?.[0] ?? null);
      setCanEdit(body.canEdit === true);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "店舗設定を読み込めませんでした。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function change(patch: Partial<Settings>) {
    setDraft(current => current ? { ...current, ...patch } : current);
    setDirty(true);
    clearNotice();
  }

  function changePayroll(patch: Partial<StorePayrollSettings>) {
    if (draft?.payroll) change({ payroll: { ...draft.payroll, ...patch } });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canEdit || saving || closureSaving) return;
    setSaving(true);
    setError("");
    const { id, name: _name, ...values } = draft;
    try {
      const response = await fetch("/api/stores/scoped-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, storeId: id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "店舗を保存できませんでした。");
      const next = { ...draft, reservationNote: draft.reservationNote.trim(), revision: body.revision };
      setDraft(next);
      setStores(current => current.map(store => store.id === id ? next : store));
      setDirty(false);
      showNotice("店舗設定を保存しました。");
    } catch (error) { setError(error instanceof Error ? error.message : "店舗を保存できませんでした。"); }
    finally { setSaving(false); }
  }

  return <main className="shell">
    <aside className="sidebar" aria-label={t("管理画面ナビゲーション")}>
      <a className="brand-block" href="/os"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 OS</p><h1>Foundr1 OS</h1></div></a>
      <MobileNavMenu navItems={canonicalNavItems} />
      <div className="sidebar-user"><UserBadge /></div>
      <OsNavList navItems={canonicalNavItems} />
    </aside>
    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">Foundr1 OS</p><h2>{t("所属店舗の設定")}</h2></div></header>
      <section className={`panel ${styles.panel}`}>
        {error ? <p className="login-error" role="alert">{t(error)}</p> : null}
        <ActionNotice notice={notice} onClose={clearNotice} />
        {loading ? <p role="status">{t("読み込み中")}</p> : !draft ? <p>{t("設定できる店舗がありません。")}</p> : <>
          <label className={styles.storePicker}><span>{t("店舗")}</span><select value={draft.id} disabled={saving || closureSaving} onChange={event => {
            if (dirty && !window.confirm(t("未保存の変更を破棄して店舗を切り替えますか？"))) return;
            setDraft(stores.find(store => store.id === event.target.value) ?? null);
            setDirty(false); setError(""); clearNotice();
          }}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          {!canEdit ? <p>{t("この店舗設定は閲覧のみです。")}</p> : null}
          <form onSubmit={save}>
            <fieldset disabled={!canEdit || saving || closureSaving} className={styles.fields}>
              <BusinessHoursEditor value={draft.businessHours} onChange={businessHours => change({ businessHours })} />
              <label><span>{t("予約画面メモ")}</span><textarea rows={3} maxLength={2000} value={draft.reservationNote} onChange={event => change({ reservationNote: event.target.value })} /></label>
              <div className={styles.location}>
                <h3>{t("モバイル打刻地点")}</h3>
                <label className={styles.check}><input type="checkbox" checked={draft.attendanceLocationEnabled} onChange={event => change({ attendanceLocationEnabled: event.target.checked })} /><span>{t("打刻時の位置制限を有効にする")}</span></label>
                <label><span>{t("打刻地点の住所")}</span><input maxLength={300} value={draft.attendanceAddress} onChange={event => change({ attendanceAddress: event.target.value })} /></label>
                <div className={styles.coordinates}>
                  <label><span>{t("緯度")}</span><input type="number" step="any" min={-90} max={90} required={draft.attendanceLocationEnabled} value={draft.attendanceLatitude ?? ""} onChange={event => change({ attendanceLatitude: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                  <label><span>{t("経度")}</span><input type="number" step="any" min={-180} max={180} required={draft.attendanceLocationEnabled} value={draft.attendanceLongitude ?? ""} onChange={event => change({ attendanceLongitude: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                  <label><span>{t("許容半径（m）")}</span><input type="number" min={10} max={2000} step={1} required value={draft.attendanceRadiusMeters} onChange={event => change({ attendanceRadiusMeters: Number(event.target.value) })} /></label>
                  <label><span>{t("位置精度の上限（m）")}</span><input type="number" min={10} max={2000} step={1} required value={draft.attendanceAccuracyThresholdMeters} onChange={event => change({ attendanceAccuracyThresholdMeters: Number(event.target.value) })} /></label>
                </div>
              </div>
              {draft.payroll ? <div className={styles.location}>
                <h3>{t("給与計算")}</h3>
                <div className={styles.coordinates}>
                  <label><span>{t("給与計算周期")}</span><select name="payrollCycleType" value={draft.payroll.payrollCycleType} onChange={event => changePayroll({ payrollCycleType: event.target.value as StorePayrollSettings["payrollCycleType"], payrollClosingDay: event.target.value === "month_end" ? 31 : Math.min(30, draft.payroll!.payrollClosingDay) })}>
                    <option value="month_end">{t("月末締め")}</option><option value="specified_day">{t("指定日締め")}</option>
                  </select></label>
                  <label><span>{t("締め日")}</span><input name="payrollClosingDay" type="number" min={1} max={30} required disabled={draft.payroll.payrollCycleType === "month_end"} value={draft.payroll.payrollCycleType === "month_end" ? "" : draft.payroll.payrollClosingDay} onChange={event => changePayroll({ payrollClosingDay: Number(event.target.value) })} /></label>
                  <label><span>{t("月所定労働時間")}</span><input name="prescribedMonthlyWorkHours" type="number" min={0} step="any" value={draft.payroll.prescribedMonthlyWorkMinutes === null ? "" : draft.payroll.prescribedMonthlyWorkMinutes / 60} onChange={event => changePayroll({ prescribedMonthlyWorkMinutes: event.target.value === "" || Number(event.target.value) === 0 ? null : Math.round(Number(event.target.value) * 60) })} /></label>
                  <label><span>{t("社保地区")}</span><select name="socialInsurancePrefecture" value={draft.payroll.socialInsurancePrefecture} onChange={event => changePayroll({ socialInsurancePrefecture: event.target.value })}>
                    {payrollPrefectures.map(prefecture => <option key={prefecture} value={prefecture}>{t(prefecture)}</option>)}
                  </select></label>
                  <label><span>{t("社会保険料の控除タイミング")}</span><select name="socialInsuranceDeductionTiming" value={draft.payroll.socialInsuranceDeductionTiming} onChange={event => changePayroll({ socialInsuranceDeductionTiming: event.target.value as StorePayrollSettings["socialInsuranceDeductionTiming"] })}>
                    <option value="next_month">{t("翌月徴収")}</option><option value="current_month">{t("当月徴収")}</option>
                  </select></label>
                </div>
                <h3>{t("希望シフト提出期限")}</h3>
                <div className={styles.coordinates}>
                  <label><span>{t("前半シフト締切日")}</span><input name="shiftFirstHalfSubmissionDeadlineDay" type="number" min={1} max={28} required value={draft.payroll.shiftFirstHalfSubmissionDeadlineDay} onChange={event => changePayroll({ shiftFirstHalfSubmissionDeadlineDay: Number(event.target.value) })} /></label>
                  <label><span>{t("後半シフト締切日")}</span><input name="shiftSecondHalfSubmissionDeadlineDay" type="number" min={1} max={28} required value={draft.payroll.shiftSecondHalfSubmissionDeadlineDay} onChange={event => changePayroll({ shiftSecondHalfSubmissionDeadlineDay: Number(event.target.value) })} /></label>
                  <label><span>{t("締切時刻")}</span><input name="shiftSubmissionDeadlineTime" type="time" required value={draft.payroll.shiftSubmissionDeadlineTime} onChange={event => changePayroll({ shiftSubmissionDeadlineTime: event.target.value })} /></label>
                </div>
              </div> : null}
            </fieldset>
            <div className={styles.actions}>
              {canEdit ? <button className="primary-button" disabled={saving || closureSaving || !dirty} type="submit">{t(saving ? "保存中" : "保存する")}</button> : null}
              <button className="secondary-button" type="button" disabled={saving || closureSaving} onClick={() => {
                if (!dirty || window.confirm(t("未保存の変更を破棄して再読み込みしますか？"))) window.location.reload();
              }}>{t("再読み込み")}</button>
            </div>
          </form>
        </>}
      </section>
      {draft ? <StoreTemporaryClosures key={draft.id} storeId={draft.id} canEdit={canEdit} disabled={saving} onBusyChange={setClosureSaving} /> : null}
    </section>
  </main>;
}
