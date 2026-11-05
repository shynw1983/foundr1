"use client";

import { useId } from "react";
import { normalizePosScaleFilterSettings, validatePosScaleFilterSettings, type PosScaleFilterSettings } from "../../../lib/pos-scale-filter";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosScaleFilterSettings.module.css";

export type PosScaleFilterFormState = {
  enabled: boolean;
  revision: string;
  toleranceGrams: string;
  settleSeconds: string;
};

const toleranceError = "許容する揺れ幅は1〜5gの整数で入力してください。";
const settleError = "判定時間は2〜5秒の整数で入力してください。";

export function createPosScaleFilterForm(value: unknown): PosScaleFilterFormState {
  const settings = normalizePosScaleFilterSettings(value);
  return { enabled: settings.enabled, revision: settings.revision, toleranceGrams: String(settings.toleranceGrams), settleSeconds: String(settings.settleMs / 1000) };
}

function integerValue(value: string) {
  const normalized = value.normalize("NFKC").trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
}

export function validatePosScaleFilterForm(value: PosScaleFilterFormState): { settings?: PosScaleFilterSettings; error?: string } {
  const toleranceGrams = integerValue(value.toleranceGrams);
  const seconds = integerValue(value.settleSeconds);
  if (!Number.isSafeInteger(toleranceGrams) || toleranceGrams < 1 || toleranceGrams > 5) return { error: toleranceError };
  if (!Number.isSafeInteger(seconds) || seconds < 2 || seconds > 5) return { error: settleError };
  return validatePosScaleFilterSettings({ enabled: value.enabled, toleranceGrams, settleMs: seconds * 1000 });
}

export function PosScaleFilterSettingsSection({ value, onChange, canManage, saving, onSave }: {
  value: PosScaleFilterFormState;
  onChange: (value: PosScaleFilterFormState) => void;
  canManage: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useOsTranslation();
  const id = useId();
  const validation = validatePosScaleFilterForm(value);
  const disabled = !canManage || saving;
  const toleranceInvalid = validation.error === toleranceError;
  const settleInvalid = !validatePosScaleFilterForm({ ...value, toleranceGrams: "2" }).settings;

  return <div className={styles.section} id="pos-scale-filter-settings">
    <div className="pos-admin-discount-heading">
      <div>
        <h4>{t("重量の揺れ対策")}</h4>
        <p>{t("風などによる小さな揺れが続くときに、POSで重量の安定を判定します。")}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onSave} disabled={disabled || Boolean(validation.error)}>{t(saving ? "保存中..." : "揺れ対策を保存")}</button>
    </div>
    <label className={styles.toggle}>
      <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} disabled={disabled} />
      <span>{t("重量の揺れを抑える")}</span>
    </label>
    <div className={styles.fields}>
      <label className={styles.field} htmlFor={`${id}-tolerance`}>
        <span>{t("許容する揺れ幅（g）")}</span>
        <input id={`${id}-tolerance`} name="filter-tolerance" inputMode="numeric" autoComplete="off" value={value.toleranceGrams} onChange={(event) => onChange({ ...value, toleranceGrams: event.target.value.normalize("NFKC") })} disabled={disabled} aria-invalid={toleranceInvalid} aria-describedby={toleranceInvalid ? `${id}-validation` : `${id}-range-help`} />
      </label>
      <label className={styles.field} htmlFor={`${id}-settle`}>
        <span>{t("判定時間（秒）")}</span>
        <input id={`${id}-settle`} name="filter-settle" inputMode="numeric" autoComplete="off" value={value.settleSeconds} onChange={(event) => onChange({ ...value, settleSeconds: event.target.value.normalize("NFKC") })} disabled={disabled} aria-invalid={settleInvalid} aria-describedby={settleInvalid && !toleranceInvalid ? `${id}-validation` : `${id}-range-help`} />
      </label>
    </div>
    {validation.error ? <p className={styles.error} id={`${id}-validation`} role="alert">{t(validation.error)}</p> : null}
    <p className={styles.help} id={`${id}-range-help`}>{t("揺れ幅は1〜5g、判定時間は2〜5秒で設定できます。揺れ幅は、その間の最大値と最小値の差です。")}</p>
    <p className={styles.help}>{t("設定した時間と3回以上の読取で、範囲内の重量を確認します。通信状況により時間が延びることがあります。")}</p>
    <p className={styles.help}>{t("採用する正味重量は1g単位です。大きく動いたときは、もう一度安定を待ちます。")}</p>
    <p className={styles.help}>{t(value.enabled ? "実際のはかりで動作を確認してから使用してください。" : "オフの間は、はかり本体の安定判定を使います。")}</p>
    <p className={styles.help}>{t("設定を変更すると、計量中の重量は確認し直します。追加済みの商品は変わりません。")}</p>
  </div>;
}
