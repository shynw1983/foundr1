import { getNanachaCompatibleMenu } from "../../../../../lib/nanacha-compatible-menu";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || searchParams.get("storeId") || "";
    const { baseMenu } = await getNanachaCompatibleMenu(request.url, store);
    return Response.json({
      baseMenu,
      generatedAt: new Date().toISOString()
    }, {
      headers: {
        "Cache-Control": store ? "no-store" : "s-maxage=60, stale-while-revalidate=300"
      }
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "menu not found" }, { status: 404 });
  }
}
