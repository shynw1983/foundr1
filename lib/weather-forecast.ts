export type StoreWeatherForecast = {
  date: string;
  weatherCode: number | null;
  label: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationProbabilityMax: number | null;
  precipitationSum: number | null;
  windSpeedMax: number | null;
  windLabel: string;
  reliability: "A" | "B" | "C" | null;
  sourceName: string;
  sourceUrl: string;
  updatedAt: string;
  isFallback: boolean;
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: unknown[];
    weather_code?: unknown[];
    temperature_2m_max?: unknown[];
    temperature_2m_min?: unknown[];
    precipitation_probability_max?: unknown[];
    precipitation_sum?: unknown[];
    wind_speed_10m_max?: unknown[];
  };
};

type JmaAreaData = {
  area?: { name?: string; code?: string };
  weatherCodes?: string[];
  weathers?: string[];
  winds?: string[];
  pops?: string[];
  reliabilities?: string[];
  temps?: string[];
  tempsMin?: string[];
  tempsMax?: string[];
};

type JmaTimeSeries = {
  timeDefines?: string[];
  areas?: JmaAreaData[];
};

type JmaForecastBlock = {
  reportDatetime?: string;
  timeSeries?: JmaTimeSeries[];
};

const openMeteoSourceUrl = "https://open-meteo.com/en/docs";
const jmaForecastApiUrl = "https://www.jma.go.jp/bosai/forecast/data/forecast/400000.json";
const jmaForecastSourceUrl = "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=400000";

function toNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(numberValue) ? numberValue : null;
}

function toDateKey(value: string | undefined) {
  return value?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? "";
}

function getCurrentJstDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeJmaText(value: string | undefined) {
  return value?.replace(/[\s　]+/g, " ").trim() ?? "";
}

function getJmaArea(series: JmaTimeSeries | undefined, areaCode: string) {
  return series?.areas?.find((item) => item.area?.code === areaCode) ?? null;
}

function getJmaSeries(block: JmaForecastBlock | undefined, areaCode: string, field: keyof JmaAreaData) {
  return block?.timeSeries?.find((series) => {
    const area = getJmaArea(series, areaCode);
    return Array.isArray(area?.[field]);
  }) ?? null;
}

function getJmaWeatherLabel(code: string | undefined) {
  const labels: Record<string, string> = {
    "100": "晴れ", "101": "晴れ時々曇り", "102": "晴れ時々雨", "110": "晴れ後曇り", "111": "晴れ後曇り", "112": "晴れ後雨",
    "200": "曇り", "201": "曇り時々晴れ", "202": "曇り時々雨", "210": "曇り後晴れ", "211": "曇り後晴れ", "212": "曇り後雨",
    "300": "雨", "301": "雨時々晴れ", "302": "雨時々止む", "311": "雨後晴れ", "313": "雨後曇り",
    "400": "雪", "401": "雪時々晴れ", "402": "雪時々止む", "411": "雪後晴れ", "413": "雪後曇り"
  };
  if (code && labels[code]) return labels[code];
  if (code?.startsWith("1")) return "晴れ";
  if (code?.startsWith("2")) return "曇り";
  if (code?.startsWith("3")) return "雨";
  if (code?.startsWith("4")) return "雪";
  return "予報なし";
}

function jmaCodeToWeatherCode(code: string | undefined) {
  if (!code) return null;
  if (code.startsWith("1")) return code === "101" || code === "110" || code === "111" ? 2 : 0;
  if (code.startsWith("2")) return code === "201" || code === "210" || code === "211" ? 2 : code === "202" || code === "212" ? 61 : 3;
  if (code.startsWith("3")) return 61;
  if (code.startsWith("4")) return 71;
  return null;
}

export function getWeatherCodeLabel(code: number | null) {
  if (code === null) return "予報なし";
  if (code === 0) return "晴れ";
  if (code === 1 || code === 2) return "晴れ時々曇り";
  if (code === 3) return "曇り";
  if (code === 45 || code === 48) return "霧";
  if (code >= 51 && code <= 57) return "霧雨";
  if (code === 61 || code === 63 || code === 80 || code === 81) return "雨";
  if (code === 65 || code === 82) return "大雨";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "雪";
  if (code >= 95) return "雷雨";
  return "変わりやすい天気";
}

async function getJmaFukuokaForecast() {
  const response = await fetch(jmaForecastApiUrl, {
    next: { revalidate: 30 * 60 },
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "Foundr1-OS/1.0" }
  });
  if (!response.ok) throw new Error(`JMA forecast returned ${response.status}`);
  const payload = await response.json() as JmaForecastBlock[];
  const shortBlock = payload[0];
  const weeklyBlock = payload[1];
  if (!shortBlock || !weeklyBlock) throw new Error("JMA forecast response was incomplete");

  const weeklyWeatherSeries = getJmaSeries(weeklyBlock, "400000", "weatherCodes");
  const weeklyWeather = getJmaArea(weeklyWeatherSeries ?? undefined, "400000");
  const weeklyTempSeries = getJmaSeries(weeklyBlock, "82182", "tempsMax");
  const weeklyTemps = getJmaArea(weeklyTempSeries ?? undefined, "82182");
  const reportDatetime = weeklyBlock.reportDatetime ?? shortBlock.reportDatetime ?? "";
  const forecastByDate = new Map<string, StoreWeatherForecast>();

  for (const [index, rawTime] of (weeklyWeatherSeries?.timeDefines ?? []).entries()) {
    const date = toDateKey(rawTime);
    if (!date) continue;
    const jmaCode = weeklyWeather?.weatherCodes?.[index];
    const reliability = weeklyWeather?.reliabilities?.[index];
    forecastByDate.set(date, {
      date,
      weatherCode: jmaCodeToWeatherCode(jmaCode),
      label: getJmaWeatherLabel(jmaCode),
      temperatureMax: toNullableNumber(weeklyTemps?.tempsMax?.[index]),
      temperatureMin: toNullableNumber(weeklyTemps?.tempsMin?.[index]),
      precipitationProbabilityMax: toNullableNumber(weeklyWeather?.pops?.[index]),
      precipitationSum: null,
      windSpeedMax: null,
      windLabel: "",
      reliability: reliability === "A" || reliability === "B" || reliability === "C" ? reliability : null,
      sourceName: "気象庁",
      sourceUrl: jmaForecastSourceUrl,
      updatedAt: reportDatetime,
      isFallback: false
    });
  }

  const shortWeatherSeries = getJmaSeries(shortBlock, "400010", "weatherCodes");
  const shortWeather = getJmaArea(shortWeatherSeries ?? undefined, "400010");
  for (const [index, rawTime] of (shortWeatherSeries?.timeDefines ?? []).entries()) {
    const date = toDateKey(rawTime);
    if (!date) continue;
    const current = forecastByDate.get(date);
    const jmaCode = shortWeather?.weatherCodes?.[index];
    forecastByDate.set(date, {
      ...(current ?? {
        date,
        temperatureMax: null,
        temperatureMin: null,
        precipitationProbabilityMax: null,
        precipitationSum: null,
        windSpeedMax: null,
        reliability: null,
        sourceName: "気象庁",
        sourceUrl: jmaForecastSourceUrl,
        updatedAt: reportDatetime,
        isFallback: false
      }),
      weatherCode: jmaCodeToWeatherCode(jmaCode),
      label: normalizeJmaText(shortWeather?.weathers?.[index]) || getJmaWeatherLabel(jmaCode),
      windLabel: normalizeJmaText(shortWeather?.winds?.[index])
    });
  }

  const dailyPopMax = new Map<string, number>();
  const shortPopSeries = getJmaSeries(shortBlock, "400010", "pops");
  const shortPops = getJmaArea(shortPopSeries ?? undefined, "400010");
  for (const [index, rawTime] of (shortPopSeries?.timeDefines ?? []).entries()) {
    const date = toDateKey(rawTime);
    const pop = toNullableNumber(shortPops?.pops?.[index]);
    if (date && pop !== null) dailyPopMax.set(date, Math.max(dailyPopMax.get(date) ?? 0, pop));
  }
  for (const [date, pop] of dailyPopMax) {
    const current = forecastByDate.get(date);
    if (current) forecastByDate.set(date, { ...current, precipitationProbabilityMax: pop });
  }

  const shortTempSeries = getJmaSeries(shortBlock, "82182", "temps");
  const shortTemps = getJmaArea(shortTempSeries ?? undefined, "82182");
  for (const [index, rawTime] of (shortTempSeries?.timeDefines ?? []).entries()) {
    const date = toDateKey(rawTime);
    const temperature = toNullableNumber(shortTemps?.temps?.[index]);
    const current = forecastByDate.get(date);
    if (!current || temperature === null) continue;
    const hour = Number(rawTime.slice(11, 13));
    forecastByDate.set(date, {
      ...current,
      temperatureMin: hour === 0 ? temperature : current.temperatureMin,
      temperatureMax: hour === 9 ? temperature : current.temperatureMax
    });
  }

  const today = getCurrentJstDateKey();
  const forecasts = Array.from(forecastByDate.values())
    .filter((forecast) => forecast.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 7);
  if (!forecasts.length) throw new Error("JMA forecast did not contain Fukuoka data");
  return forecasts;
}

async function getOpenMeteoForecast(latitude: number, longitude: number, forecastDays = 7) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "wind_speed_10m_max"
    ].join(","),
    timezone: "Asia/Tokyo",
    forecast_days: String(forecastDays)
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    next: { revalidate: 30 * 60 },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) return [];
  const payload = await response.json() as OpenMeteoDailyResponse;
  const daily = payload.daily;
  if (!daily?.time?.length) return [];
  const updatedAt = new Date().toISOString();

  return daily.time.slice(0, forecastDays).flatMap((dateValue, index) => {
    const date = typeof dateValue === "string" ? dateValue : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const weatherCode = toNullableNumber(daily.weather_code?.[index]);
    return [{
      date,
      weatherCode,
      label: getWeatherCodeLabel(weatherCode),
      temperatureMax: toNullableNumber(daily.temperature_2m_max?.[index]),
      temperatureMin: toNullableNumber(daily.temperature_2m_min?.[index]),
      precipitationProbabilityMax: toNullableNumber(daily.precipitation_probability_max?.[index]),
      precipitationSum: toNullableNumber(daily.precipitation_sum?.[index]),
      windSpeedMax: toNullableNumber(daily.wind_speed_10m_max?.[index]),
      windLabel: "",
      reliability: null,
      sourceName: "Open-Meteo（予備）",
      sourceUrl: openMeteoSourceUrl,
      updatedAt,
      isFallback: true
    } satisfies StoreWeatherForecast];
  });
}

export async function getStoreWeatherForecast(input: {
  latitude: number | null;
  longitude: number | null;
  prefecture?: string;
}) {
  const { latitude, longitude } = input;
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return [] satisfies StoreWeatherForecast[];
  }

  if ((input.prefecture ?? "").includes("福岡")) {
    try {
      return await getJmaFukuokaForecast();
    } catch {
      // The store calendar must remain usable when the official source is temporarily unavailable.
    }
  }

  try {
    return await getOpenMeteoForecast(latitude, longitude, 7);
  } catch {
    return [] satisfies StoreWeatherForecast[];
  }
}
