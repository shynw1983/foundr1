export const relayOwnerSeconds = 45;
export const relayHeartbeatSeconds = 30;
export const relayReadingSeconds = 5;
export type RelayOwner = { stationId: string; token: string; epoch: number };
export type ScaleReading = { grams: number; stable: boolean; overload: boolean };
// A&D standard ASCII format (manual §10.3). Connection UUIDs are deliberately not guessed.
export function parseAndScaleLine(line: string): ScaleReading | null {
  const match = /^(ST|US|OL),([+-]\d+(?:\.\d+)?)\s*(kg|g)\r?\n?$/.exec(line.trim());
  if (!match) return null;
  const grams = Number(match[2]) * (match[3] === 'kg' ? 1000 : 1);
  if (!Number.isFinite(grams)) return null;
  return { grams, stable: match[1] === 'ST', overload: match[1] === 'OL' };
}
export function usableScaleReading(reading: ScaleReading | null, receivedAt: number, now = Date.now()) {
  return Boolean(reading?.stable && !reading.overload && reading.grams > 0 && reading.grams <= 3000
    && now >= receivedAt && now - receivedAt <= relayReadingSeconds * 1000);
}
export function relayEnabled(row: { enabled?: boolean; print_enabled?: boolean; scale_enabled?: boolean }) {
  return row.enabled === true && (row.print_enabled === true || row.scale_enabled === true);
}
