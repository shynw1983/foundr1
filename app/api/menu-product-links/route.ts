import { requireOsSession } from "../../../lib/api-auth";
import { roleHasPermission } from "../../../lib/role-permissions";
import { canManageMenuProductLinks, MenuProductLinksError } from "../../../lib/menu-product-link-policy";
import { readMenuProductLinks, replaceMenuProductLinks } from "../../../lib/menu-product-links";

async function authorizedSession() {
  const session = await requireOsSession();
  if (!session || !canManageMenuProductLinks(session.role, await roleHasPermission(session.role, "menus.edit"))) return null;
  return session;
}

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof MenuProductLinksError ? error.message : "関連付けを処理できませんでした。" },
    { status: error instanceof MenuProductLinksError ? error.status : 500 });
}

export async function GET(request: Request) {
  const session = await authorizedSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const url = new URL(request.url);
  try {
    return Response.json(await readMenuProductLinks(url.searchParams.get("kind"), url.searchParams.get("targetId")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  const session = await authorizedSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MenuProductLinksError("保存内容が不正です。");
    return Response.json(await replaceMenuProductLinks(session, body));
  } catch (error) { return errorResponse(error); }
}
