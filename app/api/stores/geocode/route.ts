import { requireMasterOsSession } from "../../../../lib/api-auth";

type GsiAddressFeature = {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: {
    title?: unknown;
  };
};

function pickCoordinate(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function GET(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const address = String(url.searchParams.get("address") ?? "").trim();
  if (!address) {
    return Response.json({ error: "住所を入力してください。" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`, {
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Foundr1 OS geocoder"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return Response.json({ error: "住所から座標を取得できませんでした。" }, { status: 502 });
    }

    const features = await response.json() as GsiAddressFeature[];
    const feature = Array.isArray(features) ? features[0] : null;
    const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const longitude = pickCoordinate(coordinates[0]);
    const latitude = pickCoordinate(coordinates[1]);

    if (latitude === null || longitude === null) {
      return Response.json({ error: "該当する住所が見つかりませんでした。" }, { status: 404 });
    }

    return Response.json({
      latitude,
      longitude,
      label: String(feature?.properties?.title ?? address)
    });
  } catch {
    return Response.json({ error: "住所検索サービスに接続できませんでした。" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
