import type { StoreWeatherForecast } from "./weather-forecast";

export const posDisplayWeatherRefreshMs = 30 * 60 * 1000;
export const posDisplayWeatherStaleMs = 90 * 60 * 1000;
export const posDisplayWeatherSourceStaleMs = 24 * 60 * 60 * 1000;

export type PosDisplayWeatherForecast = {
  kind: "daily_forecast";
  date: string;
  condition: string;
  weatherCode: number | null;
  highC: number | null;
  lowC: number | null;
  sourceName: string;
  sourceUrl: string;
  updatedAt: string;
  fetchedAt: string;
};

export type PosDisplayWeatherStatus = "ready" | "stale" | "not_configured" | "unavailable";
export type PosDisplayWeatherResponse = {
  storeId: string;
  date: string;
  fetchedAt: string;
  status: PosDisplayWeatherStatus;
  data: PosDisplayWeatherForecast | null;
};

export function getPosDisplayWeatherDate(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function finiteTemperature(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 65 ? value : null;
}

function safeIso(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

export function isPosDisplayWeatherStale(data: PosDisplayWeatherForecast, now = Date.now()) {
  const fetched = Date.parse(data.fetchedAt), updated = Date.parse(data.updatedAt);
  return !Number.isFinite(fetched) || !Number.isFinite(updated)
    || now - fetched > posDisplayWeatherStaleMs || now - updated > posDisplayWeatherSourceStaleMs
    || fetched - now > 5 * 60 * 1000 || updated - now > 5 * 60 * 1000;
}

export function toPosDisplayWeatherForecast(forecasts: StoreWeatherForecast[], now = new Date()): PosDisplayWeatherForecast | null {
  const forecast = forecasts.find(item => item.date === getPosDisplayWeatherDate(now));
  if (!forecast) return null;
  return readPosDisplayWeatherForecast({
    kind: "daily_forecast", date: forecast.date, condition: forecast.label,
    weatherCode: forecast.weatherCode, highC: forecast.temperatureMax, lowC: forecast.temperatureMin,
    sourceName: forecast.sourceName, sourceUrl: forecast.sourceUrl,
    updatedAt: forecast.updatedAt, fetchedAt: now.toISOString()
  }, now);
}

export function readPosDisplayWeatherForecast(value: unknown, now = new Date()): PosDisplayWeatherForecast | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.kind !== "daily_forecast" || item.date !== getPosDisplayWeatherDate(now)) return null;
  const condition = typeof item.condition === "string" ? item.condition.trim().slice(0, 240) : "";
  const sourceName = typeof item.sourceName === "string" ? item.sourceName.trim().slice(0, 80) : "";
  const updatedAt = safeIso(item.updatedAt), fetchedAt = safeIso(item.fetchedAt);
  let sourceUrl = "";
  try {
    const url = new URL(String(item.sourceUrl ?? ""));
    if (url.protocol === "https:" && (url.hostname === "www.jma.go.jp" || url.hostname === "open-meteo.com")) sourceUrl = url.href;
  } catch { /* A missing attribution must not be presented as a usable forecast. */ }
  const highC = finiteTemperature(item.highC), lowC = finiteTemperature(item.lowC);
  const weatherCode = typeof item.weatherCode === "number" && Number.isInteger(item.weatherCode) && item.weatherCode >= 0 && item.weatherCode <= 99 ? item.weatherCode : null;
  if (!condition || !sourceName || !sourceUrl || !updatedAt || !fetchedAt
    || (highC === null && lowC === null && weatherCode === null) || (highC !== null && lowC !== null && highC < lowC)) return null;
  return { kind: "daily_forecast", date: String(item.date), condition, weatherCode, highC, lowC,
    sourceName, sourceUrl, updatedAt, fetchedAt };
}

export function readPosDisplayWeatherResponse(value: unknown, storeId: string, now = new Date()): PosDisplayWeatherResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const date = getPosDisplayWeatherDate(now), fetchedAt = safeIso(item.fetchedAt);
  if (item.storeId !== storeId || item.date !== date || !fetchedAt) return null;
  if (item.status === "not_configured" || item.status === "unavailable") {
    return { storeId, date, fetchedAt, status: item.status, data: null };
  }
  if (item.status !== "ready" && item.status !== "stale") return null;
  const data = readPosDisplayWeatherForecast(item.data, now);
  if (!data) return null;
  return { storeId, date, fetchedAt, status: item.status === "stale" || isPosDisplayWeatherStale(data, now.getTime()) ? "stale" : "ready", data };
}
