import { getNanachaCompatibleMenu } from "../../../../../lib/nanacha-compatible-menu";

export async function GET(request: Request) {
  try {
    const { baseMenu } = await getNanachaCompatibleMenu(request.url);
    return Response.json({
      baseMenu,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "menu not found" }, { status: 404 });
  }
}
