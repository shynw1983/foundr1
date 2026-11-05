"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PosDisplayStandbyBlock } from "../../lib/pos-display-standby";
import type { PosDisplayWeatherForecast } from "../../lib/pos-display-weather";
import type { PosDisplayWeatherState } from "./usePosDisplayWeather";
import styles from "./PosDisplayStandbyWeather.module.css";

type WeatherIconKind = "sun" | "cloud" | "rain" | "snow" | "unknown";

function iconKind(code: number | null): WeatherIconKind {
  if (code === null) return "unknown";
  if (code === 0 || code === 1) return "sun";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if (code >= 51) return "rain";
  return "cloud";
}

function WeatherIcon({ kind }: { kind: WeatherIconKind }) {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "sun" ? <><circle cx="32" cy="32" r="12" /><path d="M32 6v7m0 38v7M6 32h7m38 0h7M14 14l5 5m26 26 5 5M14 50l5-5m26-26 5-5" /></> : <>
      <path d="M16 39h32a9 9 0 0 0 1-18 16 16 0 0 0-30-2 10 10 0 0 0-3 20Z" />
      {kind === "rain" ? <path d="m23 47-3 7m15-7-3 7m15-7-3 7" /> : null}
      {kind === "snow" ? <path d="M23 47v9m-4-7 8 5m-8 0 8-5m15-2v9m-4-7 8 5m-8 0 8-5" /> : null}
      {kind === "unknown" ? <><path d="M28 24a4 4 0 1 1 7 2.6c-2 1.4-3 1.5-3 4" /><path d="M32 35h.01" /></> : null}
    </>}
  </svg>;
}

function sourceLink(forecast: PosDisplayWeatherForecast) {
  try {
    const url = new URL(forecast.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || !["www.jma.go.jp", "open-meteo.com"].includes(url.hostname)) return null;
    return { url: url.href, jma: url.hostname === "www.jma.go.jp" };
  } catch { return null; }
}

/** The customer and editor share the same forecast; only its presentation changes. */
export function PosDisplayStandbyWeather({ block, weather, editing = false }: {
  block: PosDisplayStandbyBlock; weather: PosDisplayWeatherState; editing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const forecast = weather.data;
  const available = Boolean(forecast);
  const mode = block.weatherDisplay ?? "details";
  const stale = weather.status === "stale";
  useEffect(() => {
    const element = dialog.current;
    if (editing || !available) { if (open) setOpen(false); return; }
    if (!element || !open) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, [editing, open, available]);
  const kind = forecast ? iconKind(forecast.weatherCode) : "unknown";
  const temperatures = forecast ? [forecast.highC != null ? `最高 ${Math.round(forecast.highC)}度` : "", forecast.lowC != null ? `最低 ${Math.round(forecast.lowC)}度` : ""].filter(Boolean).join("、") : "";
  const description = forecast ? `今日の予報：${forecast.condition}${temperatures ? `、${temperatures}` : ""}${stale ? " · 更新待ち" : ""}` : "天気情報は準備中です";
  const icon = <span className={styles.weatherIcon} data-standby-weather-icon data-weather-icon={kind} aria-hidden="true"><WeatherIcon kind={kind} /></span>;
  if (!forecast) return mode === "icon"
    ? <div className={`${styles.weather} ${styles.iconOnly} ${styles.unavailableIcon}`} data-standby-weather={weather.status} data-weather-display={mode} role="img" aria-label={description}>{icon}</div>
    : <span className={styles.weatherUnavailable} data-standby-weather={weather.status} data-weather-display={mode}>{description}</span>;
  const source = sourceLink(forecast);
  return <>
    <div className={`${styles.weather} ${mode === "icon" ? styles.iconOnly : ""}`} data-standby-weather={weather.status} data-weather-kind="daily_forecast" data-weather-display={mode} data-weather-stale={stale}>
      {editing ? <span className={styles.iconPreview} role="img" aria-label={description}>{icon}</span> : <button type="button" className={styles.iconButton} data-standby-weather-trigger
        aria-label={`${description}。予報の詳細を開く`} title={`${description} · タップで詳細`} onClick={() => setOpen(true)}>{icon}</button>}
      {mode === "details" ? <div className={styles.weatherSummary}>
        <small className={styles.weatherHeading}>今日の予報</small>
        <span className={styles.weatherCondition}>{forecast.condition}</span>
        <span className={styles.weatherTemperatures}>
          {forecast.highC != null ? <span>最高 <strong>{Math.round(forecast.highC)}°</strong></span> : null}
          {forecast.lowC != null ? <span>最低 <strong>{Math.round(forecast.lowC)}°</strong></span> : null}
        </span>
        {stale ? <small className={styles.weatherStatus}>更新待ち</small> : null}
      </div> : null}
    </div>
    {!editing ? <dialog ref={dialog} className={styles.detailsDialog} data-standby-weather-details aria-labelledby={titleId} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
      {open ? <>
        <header className={styles.dialogHeading}><h2 id={titleId}>天気について</h2><button type="button" onClick={() => setOpen(false)}>閉じる</button></header>
        <p className={styles.forecastLabel}>今日の予報</p>
        <div className={styles.dialogForecast}><span className={styles.dialogIcon}><WeatherIcon kind={kind} /></span><strong>{forecast.condition}</strong></div>
        <p className={styles.dialogTemperatures}>{forecast.highC != null ? <span>最高 {Math.round(forecast.highC)}°</span> : null}{forecast.lowC != null ? <span>最低 {Math.round(forecast.lowC)}°</span> : null}</p>
        {stale ? <p className={styles.dialogStatus}>更新待ち · 本日の予報を表示しています。</p> : null}
        <div className={styles.credits} data-standby-weather-source>
          <p>出典：{source ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.jma ? "気象庁ホームページ" : forecast.sourceName}</a> : forecast.sourceName}</p>
          {source && !source.jma ? <p><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p> : null}
          <p>{forecast.sourceName}の予報データをもとに、Foundr1 OS が表示用に加工しています。</p>
        </div>
      </> : null}
    </dialog> : null}
  </>;
}
