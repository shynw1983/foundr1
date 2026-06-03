import { getMaamaaCompatibleMenu } from "../../../../../lib/maamaa-compatible-menu";

const brandMenuCacheHeader = "s-maxage=300, stale-while-revalidate=3600";
const storeMenuCacheHeader = "s-maxage=15, stale-while-revalidate=60";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || searchParams.get("storeId") || "";
    const { baseMenu } = await getMaamaaCompatibleMenu(store);
    return Response.json({
      ...baseMenu,
      generatedAt: new Date().toISOString()
    }, {
      headers: {
        "Cache-Control": store ? storeMenuCacheHeader : brandMenuCacheHeader
      }
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "menu not found" }, { status: 404 });
  }
}
