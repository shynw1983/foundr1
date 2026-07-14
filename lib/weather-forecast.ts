export type StoreWeatherForecast = {
  date: string;
  weatherCode: number | null;
  label: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationProbabilityMax: number | null;
  precipitationSum: number | null;
  windSpeedMax: number | null;
  sourceUrl: string;
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

const forecastSourceUrl = "https://open-meteo.com/en/docs";

function toNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return value !== null && value !== undefined && Number.isFinite(numberValue) ? numberValue : null;
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

export async function getThreeDayWeatherForecast(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return [] satisfies StoreWeatherForecast[];
  }

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
    forecast_days: "3"
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      next: { revalidate: 30 * 60 },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return [];

    const payload = await response.json() as OpenMeteoDailyResponse;
    const daily = payload.daily;
    if (!daily?.time?.length) return [];

    return daily.time.slice(0, 3).flatMap((dateValue, index) => {
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
        sourceUrl: forecastSourceUrl
      }];
    });
  } catch {
    return [] satisfies StoreWeatherForecast[];
  }
}
