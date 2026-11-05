import type { ScaleReading } from './store-relay-policy';

/** Optional store-owned software stability policy. Off preserves the hardware ST rule. */
export type PosScaleFilterSettings = {
  enabled: boolean;
  revision: string;
  toleranceGrams: number;
  settleMs: number;
};
export type PosScaleFilterSample = { grams: number; at: number };
export type PosScaleFilterState = {
  contextKey?: string;
  samples?: PosScaleFilterSample[];
  /** Filtered gross weight; the backend applies the authoritative plate tare once. */
  acceptedGrams?: number;
  /** Server-generated identity of one continuously accepted window. */
  acceptedWindowId?: string;
};
export type PosScaleFilterMetadata = {
  source: 'software_window';
  settingsRevision: string;
  toleranceGrams: number;
  settleMs: number;
  sampleCount: number;
  spanMs: number;
  rawGrams: number;
  accepted: boolean;
  minGrams?: number;
  maxGrams?: number;
  windowId?: string;
};
export type PosFilteredScaleReading = ScaleReading & {
  rawGrams?: number;
  hardwareStable?: boolean;
  filter?: PosScaleFilterMetadata;
};
const minimumSamples = 3;
const maximumGapMs = 3000;
const maximumSamples = 32;
const epsilon = 0.000001;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const validTolerance = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
const validSettle = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 5000 && value % 1000 === 0;
const validWindowId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export function defaultPosScaleFilterSettings(): PosScaleFilterSettings {
  return { enabled: false, revision: '', toleranceGrams: 2, settleMs: 2000 };
}
export function validatePosScaleFilterSettings(value: unknown): { settings?: PosScaleFilterSettings; error?: string } {
  const source = record(value);
  if (typeof source.enabled !== 'boolean') return { error: '重量の揺れを抑える設定を確認してください。' };
  if (!validTolerance(source.toleranceGrams)) return { error: '許容する揺れ幅は1〜5gの整数で入力してください。' };
  if (!validSettle(source.settleMs)) return { error: '判定時間は2〜5秒の整数で入力してください。' };
  // A browser may edit policy values, but it cannot supply the authoritative revision.
  return { settings: { enabled: source.enabled, revision: '', toleranceGrams: source.toleranceGrams, settleMs: source.settleMs } };
}
export function normalizePosScaleFilterSettings(value: unknown): PosScaleFilterSettings {
  const source = record(value);
  const settings = validatePosScaleFilterSettings(value).settings ?? defaultPosScaleFilterSettings();
  settings.revision = typeof source.revision === 'string' ? source.revision.slice(0, 80) : '';
  // Invalid enabled configuration must not silently fall back to charging an ST frame.
  if (source.enabled === true && !validatePosScaleFilterSettings(value).settings) {
    settings.enabled = true;
    settings.toleranceGrams = 0;
    settings.settleMs = 0;
  }
  return settings;
}

function previousState(value: unknown, contextKey: string): PosScaleFilterState {
  const state = record(value);
  if (state.contextKey !== contextKey || !Array.isArray(state.samples) || state.samples.length > maximumSamples) return {};
  const samples: PosScaleFilterSample[] = [];
  for (const entry of state.samples) {
    const sample = record(entry);
    if (typeof sample.grams !== 'number' || !Number.isFinite(sample.grams) || sample.grams <= 0 || sample.grams > 3000
      || typeof sample.at !== 'number' || !Number.isSafeInteger(sample.at) || sample.at < 0
      || (samples.length && sample.at <= samples[samples.length - 1].at)) return {};
    samples.push({ grams: sample.grams, at: sample.at });
  }
  if (state.acceptedGrams !== undefined && (typeof state.acceptedGrams !== 'number' || !Number.isFinite(state.acceptedGrams)
    || state.acceptedGrams <= 0 || state.acceptedGrams > 3000)) return {};
  if (state.acceptedWindowId !== undefined && (!validWindowId(state.acceptedWindowId) || state.acceptedGrams === undefined)) return {};
  return { contextKey, samples, ...(state.acceptedGrams === undefined ? {} : { acceptedGrams: state.acceptedGrams as number }),
    ...(state.acceptedWindowId === undefined ? {} : { acceptedWindowId: state.acceptedWindowId as string }) };
}

/**
 * Only distinct native measuredAt samples count. Browser polls never enter this window.
 * The service stores this result using sequence/context/revision CAS under the station lock.
 * US may qualify here, but remains hardwareStable:false in the immutable capture evidence.
 */
export function evaluatePosScaleFilter(input: {
  settings: PosScaleFilterSettings;
  state: unknown;
  contextKey: string;
  reading: ScaleReading | null;
  measuredAt: number;
  tareGrams?: number;
  /** A server-only candidate; ignored until a fresh sample completes acceptance. */
  newWindowId?: string;
}): { state: PosScaleFilterState; reading: PosFilteredScaleReading | null } {
  const { settings, reading, measuredAt } = input;
  if (!settings.enabled) return { state: {}, reading: reading ? { ...reading } : null };
  if (!reading) return { state: {}, reading: null };
  const filtered: PosFilteredScaleReading = { ...reading, stable: false, hardwareStable: reading.stable, rawGrams: reading.grams,
    filter: { source: 'software_window', settingsRevision: settings.revision, toleranceGrams: settings.toleranceGrams,
      settleMs: settings.settleMs, sampleCount: 0, spanMs: 0, rawGrams: reading.grams, accepted: false } };
  const tare = input.tareGrams ?? 0;
  if (!validTolerance(settings.toleranceGrams) || !validSettle(settings.settleMs) || !settings.revision || !input.contextKey
    || !Number.isFinite(tare) || tare < 0 || tare >= 3000 || !Number.isSafeInteger(measuredAt) || measuredAt < 0
    || !Number.isFinite(reading.grams) || reading.overload || reading.grams > 3000 || reading.grams - tare <= 0) {
    return { state: {}, reading: filtered };
  }
  const contextKey = JSON.stringify([input.contextKey, settings.revision, settings.toleranceGrams, settings.settleMs, tare]);
  const previous = previousState(input.state, contextKey);
  let samples = previous.samples ?? [];
  let accepted = previous.acceptedGrams;
  let windowId = previous.acceptedWindowId;
  const last = samples[samples.length - 1];
  if (last && measuredAt <= last.at) return { state: {}, reading: filtered };
  if (last && measuredAt - last.at > maximumGapMs) { samples = []; accepted = undefined; windowId = undefined; }
  samples = [...samples, { grams: reading.grams, at: measuredAt }];
  // A change in load immediately blocks adoption, rather than smoothing it into the old bowl.
  const range = samples.map(sample => sample.grams);
  if (accepted !== undefined) range.push(accepted);
  if (Math.max(...range) - Math.min(...range) > settings.toleranceGrams + epsilon) {
    samples = [samples[samples.length - 1]];
    accepted = undefined;
    windowId = undefined;
  }
  // Keep one boundary sample at/before the requested span, plus at least three
  // independent samples. Slower uploads must not trim the window back to two forever.
  const boundary = measuredAt - settings.settleMs;
  while (samples.length > minimumSamples && samples[1].at <= boundary) samples.shift();
  if (samples.length > maximumSamples) samples = samples.slice(-maximumSamples);
  const spanMs = measuredAt - samples[0].at;
  const values = samples.map(sample => sample.grams);
  const minGrams = Math.min(...values), maxGrams = Math.max(...values);
  Object.assign(filtered.filter!, { sampleCount: samples.length, spanMs, minGrams, maxGrams });
  const state: PosScaleFilterState = { contextKey, samples };
  if (samples.length < minimumSamples || spanMs < settings.settleMs) return { state, reading: filtered };
  if (accepted === undefined) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const medianNet = Math.round((median - tare) * 1000) / 1000;
    if (Math.round(medianNet) <= 0) return { state, reading: filtered };
    // Round NET to 1g, never the plate tare. The returned gross remains exactly net + tare.
    const minimumNet = Math.max(1, Math.ceil(maxGrams - tare - settings.toleranceGrams - epsilon));
    const maximumNet = Math.min(Math.floor(3000 - tare + epsilon), Math.floor(minGrams - tare + settings.toleranceGrams + epsilon));
    if (minimumNet > maximumNet) return { state, reading: filtered };
    const net = Math.max(minimumNet, Math.min(maximumNet, Math.round(medianNet)));
    accepted = Math.round((net + tare) * 1000) / 1000;
  }
  state.acceptedGrams = accepted;
  // Existing pre-upgrade windows gain an identity only on a newly measured,
  // validated frame. Browser polls and request payloads never mint evidence.
  if (!windowId && validWindowId(input.newWindowId)) windowId = input.newWindowId;
  if (windowId) { state.acceptedWindowId = windowId; filtered.filter!.windowId = windowId; }
  filtered.grams = accepted;
  filtered.stable = true;
  filtered.filter!.accepted = true;
  return { state, reading: filtered };
}
