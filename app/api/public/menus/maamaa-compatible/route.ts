import { getMaamaaCompatibleMenu } from "../../../../../lib/maamaa-compatible-menu";
import { publicMenuCacheHeaders } from "../../../../../lib/public-cache";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || searchParams.get("storeId") || "";
    const { baseMenu } = await getMaamaaCompatibleMenu(store);
    return Response.json({
      ...baseMenu,
      generatedAt: new Date().toISOString()
    }, {
      headers: publicMenuCacheHeaders(Boolean(store))
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "menu not found" }, { status: 404 });
  }
}
