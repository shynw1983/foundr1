import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../../lib/store-order-access";
import { getStoreWeatherForecast } from "../../../../../../lib/weather-forecast";
import { getPosDisplayWeatherDate, isPosDisplayWeatherStale, toPosDisplayWeatherForecast, type PosDisplayWeatherResponse } from "../../../../../../lib/pos-display-weather";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function coordinate(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  const access = await getStoreOrderAccess(session);
  const selected = getScopedStoreFilter(access, new URL(request.url).searchParams.get("storeId"));
  const storeId = selected ?? access.stores[0]?.id ?? "";
  if (storeId === "__forbidden__" || !storeId || !access.stores.some(store => store.id === storeId)) {
    return Response.json({ error: "権限がありません。" }, { status: 403, headers: responseHeaders });
  }
  // Coordinates belong to the store settings. Customer devices never supply a location.
  const rows = await sql`
    select weather_latitude::float as "weatherLatitude", weather_longitude::float as "weatherLongitude",
      attendance_latitude::float as "attendanceLatitude", attendance_longitude::float as "attendanceLongitude",
      coalesce(social_insurance_prefecture, '') as prefecture
    from stores where id::text = ${storeId} and status = 'active' limit 1
  `;
  const store = rows[0];
  if (!store) return Response.json({ error: "権限がありません。" }, { status: 403, headers: responseHeaders });
  const now = new Date();
  const base = { storeId, date: getPosDisplayWeatherDate(now), fetchedAt: now.toISOString() };
  const weatherLat = coordinate(store.weatherLatitude, -90, 90), weatherLon = coordinate(store.weatherLongitude, -180, 180);
  // Use a complete saved coordinate pair; never mix two independently configured locations.
  const latitude = weatherLat !== null && weatherLon !== null ? weatherLat : coordinate(store.attendanceLatitude, -90, 90);
  const longitude = weatherLat !== null && weatherLon !== null ? weatherLon : coordinate(store.attendanceLongitude, -180, 180);
  if (latitude === null || longitude === null) {
    return Response.json({ ...base, status: "not_configured", data: null } satisfies PosDisplayWeatherResponse, { headers: responseHeaders });
  }
  try {
    const forecasts = await getStoreWeatherForecast({ latitude, longitude, prefecture: String(store.prefecture ?? "") });
    // Re-evaluate the JST date after the provider call, including a midnight rollover.
    const received = new Date(), data = toPosDisplayWeatherForecast(forecasts, received);
    return Response.json({ storeId, date: getPosDisplayWeatherDate(received), fetchedAt: received.toISOString(),
      status: data ? isPosDisplayWeatherStale(data, received.getTime()) ? "stale" : "ready" : "unavailable", data
    } satisfies PosDisplayWeatherResponse, { headers: responseHeaders });
  } catch {
    const received = new Date();
    return Response.json({ storeId, date: getPosDisplayWeatherDate(received), fetchedAt: received.toISOString(), status: "unavailable", data: null } satisfies PosDisplayWeatherResponse, { headers: responseHeaders });
  }
}
