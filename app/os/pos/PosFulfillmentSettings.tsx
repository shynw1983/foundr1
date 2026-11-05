"use client";

import { useId } from "react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { normalizePosFulfillmentWorkspaceSettings, validatePosFulfillmentWorkspaceSettings, type PosFulfillmentWorkspaceSettings } from "../../../lib/pos-fulfillment-settings";
import styles from "./PosScaleFilterSettings.module.css";

export type PosFulfillmentFormState = { enabled: boolean; overdueMinutes: string };

export function createPosFulfillmentForm(value: unknown): PosFulfillmentFormState {
  const settings = normalizePosFulfillmentWorkspaceSettings(value);
  return { enabled: settings.enabled, overdueMinutes: String(settings.overdueMinutes) };
}

export function validatePosFulfillmentForm(value: PosFulfillmentFormState): { settings?: PosFulfillmentWorkspaceSettings; error?: string } {
  const minutes = value.overdueMinutes.normalize("NFKC").trim();
  return validatePosFulfillmentWorkspaceSettings({ enabled: value.enabled, overdueMinutes: /^\d+$/.test(minutes) ? Number(minutes) : NaN });
}

export function PosFulfillmentSettingsSection({ value, onChange, canManage, saving, onSave }: {
  value: PosFulfillmentFormState;
  onChange: (value: PosFulfillmentFormState) => void;
  canManage: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useOsTranslation();
  const id = useId();
  const validation = validatePosFulfillmentForm(value);
  const disabled = !canManage || saving;
  return <div className={styles.section} id="pos-fulfillment-settings">
    <div className="pos-admin-discount-heading">
      <div><h4>{t("POS の受け渡し")}</h4><p>{t("POS 画面で提供待ちと受け渡しをまとめて操作します。")}</p></div>
      <button className="secondary-button" type="button" disabled={disabled || Boolean(validation.error)} onClick={onSave}>{t(saving ? "保存中..." : "受け渡し設定を保存")}</button>
    </div>
    <label className={styles.toggle}>
      <input type="checkbox" checked={value.enabled} disabled={disabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
      <span>{t("POS に受け渡し一覧を表示")}</span>
    </label>
    {value.enabled ? <label className={styles.field} htmlFor={`${id}-minutes`} style={{ maxWidth: 280 }}>
      <span>{t("待ち時間の通知（分）")}</span>
      <input id={`${id}-minutes`} inputMode="numeric" autoComplete="off" value={value.overdueMinutes} disabled={disabled} aria-invalid={Boolean(validation.error)} aria-describedby={`${id}-help`} onChange={(event) => onChange({ ...value, overdueMinutes: event.target.value.normalize("NFKC") })} />
    </label> : null}
    {validation.error ? <p className={styles.error} role="alert">{t(validation.error)}</p> : null}
    <p className={styles.help} id={`${id}-help`}>{t("会計済みの注文を表示します。設定した時間を過ぎた提供待ちは色でお知らせします。")}</p>
  </div>;
}
