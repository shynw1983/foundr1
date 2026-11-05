"use client";

import { useId } from "react";
import { normalizePosScaleTareSettings, validatePosScaleTareSettings, type PosScaleTareSettings } from "../../../lib/pos-scale-tare";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosScaleTareSettings.module.css";

export type PosScaleTareFormState = {
  enabled: boolean;
  revision: string;
  smallGrams: string;
  largeGrams: string;
};

const invalidGramsMessage = "空のボウルの重さは、0より大きく3000g以下、小数第1位までで入力してください。";
const missingGramsMessage = "ボウル（小・大）の重さを登録してから有効にしてください。";

export function createPosScaleTareForm(value: unknown): PosScaleTareFormState {
  const settings = normalizePosScaleTareSettings(value);
  return {
    enabled: settings.enabled,
    revision: settings.revision,
    smallGrams: settings.presets.find((preset) => preset.id === "small")?.grams?.toString() ?? "",
    largeGrams: settings.presets.find((preset) => preset.id === "large")?.grams?.toString() ?? ""
  };
}

function parseGrams(value: string) {
  const text = value.normalize("NFKC").trim();
  if (!text) return null;
  if (!/^(?:\d+(?:\.\d)?|\.\d)$/.test(text)) return NaN;
  return Number(text);
}

export function validatePosScaleTareForm(value: PosScaleTareFormState): { settings?: PosScaleTareSettings; error?: string } {
  const small = parseGrams(value.smallGrams);
  const large = parseGrams(value.largeGrams);
  if ([small, large].some((grams) => grams != null && (!Number.isFinite(grams) || grams <= 0 || grams > 3000))) {
    return { error: invalidGramsMessage };
  }
  if (value.enabled && (small == null || large == null)) return { error: missingGramsMessage };
  return validatePosScaleTareSettings({
    enabled: value.enabled,
    revision: value.revision,
    presets: [{ id: "small", grams: small }, { id: "large", grams: large }]
  });
}

export function PosScaleTareSettingsSection({ value, onChange, canManage, saving, onSave }: {
  value: PosScaleTareFormState;
  onChange: (value: PosScaleTareFormState) => void;
  canManage: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useOsTranslation();
  const id = useId();
  const validation = validatePosScaleTareForm(value);
  const ready = Boolean(validatePosScaleTareForm({ ...value, enabled: true }).settings);
  const disabled = !canManage || saving;

  return (
    <div className={styles.section} id="pos-scale-tare-settings">
      <div className="pos-admin-discount-heading">
        <div>
          <h4>{t("ボウルの重さ・クイック風袋引き")}</h4>
          <p>{t("空のボウル（小・大）の重さを登録すると、POSでサイズを選ぶだけで差し引けます。")}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onSave} disabled={disabled || Boolean(validation.error)}>
          {t(saving ? "保存中..." : "ボウルの重さを保存")}
        </button>
      </div>
      <div className={styles.fields}>
        {(["small", "large"] as const).map((preset) => {
          const key = preset === "small" ? "smallGrams" : "largeGrams";
          const fieldError = value[key].trim() ? validatePosScaleTareForm({ ...value, enabled: false, smallGrams: preset === "small" ? value[key] : "", largeGrams: preset === "large" ? value[key] : "" }).error : "";
          return (
            <label key={preset} className={styles.field} htmlFor={`${id}-${preset}`}>
              <span>{t(preset === "small" ? "ボウル（小）の重さ（g）" : "ボウル（大）の重さ（g）")}</span>
              <input
                id={`${id}-${preset}`}
                name={`tare-${preset}`}
                inputMode="decimal"
                autoComplete="off"
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.target.value.normalize("NFKC") })}
                placeholder={t("未設定")}
                disabled={disabled}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? `${id}-validation` : `${id}-help`}
              />
            </label>
          );
        })}
      </div>
      <label className={styles.toggle}>
        <input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} disabled={disabled || (!value.enabled && !ready)} />
        <span>{t("POSでボウル（小・大）のクイック風袋引きを使う")}</span>
      </label>
      {validation.error ? <p className={styles.error} id={`${id}-validation`} role="alert">{t(validation.error)}</p> : null}
      {!ready && !validation.error ? <p className={styles.help}>{t(missingGramsMessage)}</p> : null}
      <p className={styles.help} id={`${id}-help`}>{t("重さは0より大きく3000g以下、0.1g単位で設定できます。空欄は未設定として保存します。")}</p>
      <p className={styles.notice}>{t("POSでボウルの重さを差し引きます。はかり本体で重ねて風袋引きしないでください。自動計量では本体の風袋を解除して読み取ります。")}</p>
      <p className={styles.help}>{t("設定を変更した後は、計量中のボウルを量り直してください。")}</p>
    </div>
  );
}
