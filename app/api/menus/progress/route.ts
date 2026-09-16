import { requireOsSession, canAccessStore } from "../../../../lib/api-auth";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { readMenuProgress } from "../../../../lib/menu-progress";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !await roleHasPermission(session.role, "menus.edit")) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const brandId = params.get("brandId")?.trim() || "";
  const storeId = params.get("storeId")?.trim() || "";
  if (!brandId) return Response.json({ error: "ブランドを選択してください。" }, { status: 400 });
  if (storeId && !await canAccessStore(session, storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
  return Response.json(await readMenuProgress(brandId, storeId), { headers: { "Cache-Control": "no-store" } });
}
