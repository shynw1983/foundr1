import type { PosScaleFilterMetadata } from './pos-scale-filter';
/** Store-owned plate presets. Browser callers never choose a tare token or server revision. */
export type PosScaleTarePresetId = 'small' | 'large';
export type PosScaleTareSettings = {
  enabled: boolean;
  revision: string;
  presets: [{ id: 'small'; grams: number | null }, { id: 'large'; grams: number | null }];
};
export type PosScaleTareContext = {
  mode: 'preset'; token: string; presetId: PosScaleTarePresetId; tareGrams: number; settingsRevision: string;
};
export type PosWeightMeasurement = ({
  mode: 'preset'; grossGrams: number; tareGrams: number; netGrams: number;
  tarePresetId: PosScaleTarePresetId; settingsRevision: string;
} | { mode: 'manual_net' } | { mode: 'device_net' }) & {
  filter?: PosScaleFilterMetadata; hardwareStable?: boolean; rawGrams?: number; rawGrossGrams?: number;
};
export function defaultPosScaleTareSettings(): PosScaleTareSettings {
  return { enabled: false, revision: '', presets: [{ id: 'small', grams: null }, { id: 'large', grams: null }] };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function validGrams(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 3000
    && Math.abs(value * 10 - Math.round(value * 10)) < 0.0000001;
}
export function validatePosScaleTareSettings(value: unknown): { settings?: PosScaleTareSettings; error?: string } {
  const source = record(value);
  if (typeof source.enabled !== 'boolean' || !Array.isArray(source.presets) || source.presets.length !== 2)
    return { error: 'ボウルの重量設定を確認してください。' };
  const presets = source.presets.map(record);
  if (presets.filter(p => p.id === 'small').length !== 1 || presets.filter(p => p.id === 'large').length !== 1)
    return { error: 'ボウル（小・大）の重量を設定してください。' };
  const settings = defaultPosScaleTareSettings();
  settings.enabled = source.enabled;
  for (const preset of settings.presets) {
    const grams = presets.find(p => p.id === preset.id)!.grams;
    if (grams !== null && !validGrams(grams)) return { error: '空のボウルの重さは0より大きく3000g以下、0.1g単位で入力してください。' };
    if (settings.enabled && grams === null) return { error: '有効にする前にボウル（小・大）の重さを設定してください。' };
    preset.grams = grams as number | null;
  }
  return { settings };
}
export function normalizePosScaleTareSettings(value: unknown): PosScaleTareSettings {
  const source=record(value);
  const settings=validatePosScaleTareSettings(value).settings ?? defaultPosScaleTareSettings();
  settings.revision=typeof source.revision==='string'?source.revision.slice(0,80):'';
  // Corrupt enabled data stays enabled but unusable: never silently charge gross as net.
  if(source.enabled===true)settings.enabled=true;
  return settings;
}
export function posWeightMeasurementFromReading(value: unknown): PosWeightMeasurement {
  const reading = record(value);
  let measurement:PosWeightMeasurement={mode:'device_net'};
  if (reading.mode === 'preset' && (reading.tarePresetId === 'small' || reading.tarePresetId === 'large')
      && validGrams(reading.tareGrams) && typeof reading.grossGrams === 'number' && Number.isFinite(reading.grossGrams)
      && typeof reading.grams === 'number' && Number.isFinite(reading.grams) && typeof reading.settingsRevision === 'string') {
    measurement={ mode: 'preset', grossGrams: reading.grossGrams, tareGrams: reading.tareGrams,
      netGrams: reading.grams, tarePresetId: reading.tarePresetId, settingsRevision: reading.settingsRevision };
  }
  const filter=record(reading.filter);
  if(filter.source==='software_window'&&typeof filter.settingsRevision==='string'&&filter.accepted===true){
    measurement.filter=filter as PosScaleFilterMetadata;
    if(typeof reading.hardwareStable==='boolean')measurement.hardwareStable=reading.hardwareStable;
    if(typeof reading.rawGrams==='number'&&Number.isFinite(reading.rawGrams))measurement.rawGrams=reading.rawGrams;
    if(typeof reading.rawGrossGrams==='number'&&Number.isFinite(reading.rawGrossGrams))measurement.rawGrossGrams=reading.rawGrossGrams;
  }
  return measurement;
}
