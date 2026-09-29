export const lightReadingMaxAgeMs = 120_000;
export const lightCommandCooldownMs = 90_000;
export type LightEstimate = "on" | "off" | "unknown";
export type LightSample = { lightLevel: number; battery: number | null; botMode: string };
export type LightCommand = {
  id: string;
  result: "pending" | "accepted" | "rejected" | "unknown";
  requestedAt: string;
  finishedAt: string | null;
  beforeState: LightEstimate;
  reason: string;
};
export type IndoorLightView = {
  configured: boolean;
  storeId: string;
  sample: LightSample | null;
  fetchedAt: string | null;
  estimate: LightEstimate;
  readError: boolean;
  canPress: boolean;
  controlEnabled: boolean;
  blockedUntil: string | null;
  command: LightCommand | null;
  offMax: number;
  onMin: number;
};

// Daytime calibration: off 2 -> on 12 -> off 2. This is an inference,
// never the Bot's reported power, and never a retained state in the dead band.
export function estimateIndoorLight(level: unknown, fetchedAt: string | null, now = Date.now()): LightEstimate {
  const time = fetchedAt ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(time) || now - time > lightReadingMaxAgeMs || time > now + 5_000) return "unknown";
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 20) return "unknown";
  if (level <= 3) return "off";
  if (level >= 10) return "on";
  return "unknown";
}

export function lightCommandObservation(view: IndoorLightView, now = Date.now()) {
  const command = view.command;
  if (!command) return "none";
  if (command.result === "rejected") return "rejected";
  const age = now - Date.parse(command.requestedAt);
  const estimate = view.readError ? "unknown" : estimateIndoorLight(view.sample?.lightLevel, view.fetchedAt, now);
  const responseTime = command.finishedAt ? Date.parse(command.finishedAt) : Date.parse(command.requestedAt) + lightCommandCooldownMs;
  const readAfterPress = view.fetchedAt && Date.parse(view.fetchedAt) >= responseTime + 5_000;
  if (readAfterPress && command.beforeState !== "unknown" && estimate !== "unknown" && estimate !== command.beforeState) return "changed";
  if (age < lightCommandCooldownMs) return "waiting";
  return "unconfirmed";
}
